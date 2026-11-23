'use strict';
// Applies Vinted email updates (sold, completed, delivered, refund, label) to stock,
// then Pip shows a short summary. Unsure matches are skipped quietly, never guessed or asked about.

const AU_DONE_KEY = 'stockroom-email-updates';
const auDone = new Set((() => { try { return JSON.parse(localStorage.getItem(AU_DONE_KEY) || '[]'); } catch { return []; } })());
// Handled emails are remembered on this device and on the server, so your phone and laptop never ask twice.
let auSynced = new Set(), auServerLoaded = false, auPushTimer = 0;
const auSaveDone = () => {
  try { localStorage.setItem(AU_DONE_KEY, JSON.stringify([...auDone].slice(-400))); } catch {}
  clearTimeout(auPushTimer);
  auPushTimer = setTimeout(() => {
    const ids = [...auDone].filter(id => !auSynced.has(id));
    if (!ids.length) return;
    api('/api/gmail/done', {method: 'POST', body: JSON.stringify({ids})}).then(() => ids.forEach(id => auSynced.add(id))).catch(() => {});
  }, 800);
};
async function auLoadServerDone() {
  if (auServerLoaded) return;
  try {
    const {ids} = await api('/api/gmail/done');
    ids.forEach(id => { auDone.add(id); auSynced.add(id); });
    auServerLoaded = true;
    if ([...auDone].some(id => !auSynced.has(id))) auSaveDone();
  } catch {}
}
let auBusy = false, auSignature = '';

const AU_SYNONYMS = {qzip: 'quarter zip', '1/4': 'quarter', hoody: 'hoodie', tee: 't shirt', tshirt: 't shirt', windcheater: 'windbreaker', quaterzip: 'quarter zip', quarterzip: 'quarter zip'};
const AU_STOP = new Set(['the', 'and', 'with', 'a', 'of', 'for', 'in', 'size', 'mens', 'men', 'womens', 'women', 'ladies', 'uk', 's', 'new', 'vintage']);
function auTokens(text) {
  let t = String(text || '').toLowerCase().replace(/[’']/g, '');
  for (const [from, to] of Object.entries(AU_SYNONYMS)) t = t.replace(new RegExp('\\b' + from.replace('/', '\\/') + '\\b', 'g'), to);
  return new Set(t.replace(/[^a-z0-9]+/g, ' ').split(' ').filter(w => w && !AU_STOP.has(w)));
}
function auScore(title, item) {
  const a = auTokens(title);
  let best = 0;
  for (const text of [item.listingTitle, item.name, [item.brand, item.name].join(' ')]) {
    const b = auTokens(text);
    if (!a.size || !b.size) continue;
    const common = [...a].filter(w => b.has(w)).length;
    const jaccard = common / new Set([...a, ...b]).size, contain = common / Math.min(a.size, b.size);
    best = Math.max(best, 0.6 * jaccard + 0.4 * contain);
  }
  return best;
}
function auRank(title, items, bonus = () => 0) {
  return items.map(item => ({item, score: Math.min(1, auScore(title, item) + bonus(item))})).filter(r => r.score > 0.4).sort((x, y) => y.score - x.score);
}
const auConfident = ranked => { const [a, b] = ranked; if (!a) return false; const gap = b ? a.score - b.score : 1; return (a.score >= 0.6 && gap >= 0.2) || (a.score >= 0.85 && gap >= 0.12); };
const auDays = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) / 86400000;

function auCandidates(event, data) {
  const live = data.items.filter(item => !item.deletedAt);
  const trades = data.trades || [];
  const lastTradeOf = id => trades.filter(t => t.itemId === id).at(-1);
  switch (event.type) {
    case 'sold': return live.filter(item => item.status === 'In Stock');
    case 'completed': return live.filter(item => { const t = lastTradeOf(item.id); return item.status === 'Sold' && t && !t.completedAt && !t.paidAt; });
    case 'delivered': case 'refund': return live.filter(item => item.status === 'In Stock' && !item.receivedAt);
    case 'label': return live.filter(item => { const t = lastTradeOf(item.id); return item.status === 'Sold' && t && !t.postedAt; });
  }
  return [];
}

// Already reflected in stock (recorded by hand, on another device, or earlier)?
function auAlreadyDone(event, data) {
  const trades = data.trades || [];
  if (trades.some(t => t.emailId === event.id)) return true;
  if (event.type === 'sold') return data.items.some(item => item.status === 'Sold' && Math.abs((item.sale || 0) - event.amount) < 0.01 &&
    item.soldAt && auDays(item.soldAt, event.date) <= 4 && auScore(event.title, item) >= 0.3);
  if (event.type === 'completed') return trades.some(t => (event.transactionId && t.orderId === event.transactionId && (t.completedAt || t.paidAt)));
  return false;
}

function auApply(event, item, data) {
  const today = todayUK();
  const date = event.date && event.date <= today ? event.date : today;
  switch (event.type) {
    case 'sold': {
      const next = recordSale(data, item.id, event.amount, date < (item.purchasedAt || '') ? item.purchasedAt : date);
      const trade = next.trades.at(-1); trade.emailId = event.id;
      return {next, line: {icon: '£', tone: 'go', title: 'Sold · ' + gbp(event.amount), body: '#' + item.id + ' ' + item.name + (event.buyer ? ' to ' + event.buyer : '')}};
    }
    case 'completed': {
      const trade = (data.trades || []).filter(t => t.itemId === item.id).at(-1);
      const when = date < (trade.postedAt || trade.soldAt) ? (trade.postedAt || trade.soldAt) : date;
      let next = advanceOrder(data, item.id, 'Completed', when);
      const t = next.trades.filter(x => x.itemId === item.id).at(-1);
      if (event.transactionId && !t.orderId && !(next.trades.some(x => x.orderId === event.transactionId))) t.orderId = event.transactionId;
      return {next, line: {icon: '✓', tone: 'go', title: 'Sale completed', body: '#' + item.id + ' ' + item.name + ' · money is in your Vinted balance'}};
    }
    case 'delivered': {
      const next = cloneWorkspace(data), current = next.items.find(row => row.id === item.id);
      Object.assign(current, {receivedAt: date, stage: current.photos?.some(photoUrl) ? 'Ready to list' : 'Ready to photograph'});
      return {next, line: {icon: '📦', tone: 'info', title: 'Delivered', body: '#' + item.id + ' ' + item.name + ' · marked received'}};
    }
    case 'refund': {
      const next = cloneWorkspace(data), current = next.items.find(row => row.id === item.id);
      Object.assign(current, {status: 'Refunded', refund: current.cost, refundedAt: date, stage: ''});
      return {next, line: {icon: '↩', tone: 'warn', title: 'Refunded · ' + gbp(item.cost), body: '#' + item.id + ' ' + item.name + ' · purchase cancelled. Check the amount.'}};
    }
    case 'label': {
      if (!event.tracking && !event.labelMedia) return {next: data, line: {icon: '🏷', tone: 'info', title: 'Label ready', body: '#' + item.id + ' ' + item.name + ' · post it within 5 days'}};
      const next = cloneWorkspace(data), current = next.items.find(row => row.id === item.id);
      if (event.tracking && !next.items.some(row => row.id !== item.id && row.shipTracking === event.tracking)) Object.assign(current, {shipTracking: event.tracking, shipCarrier: auCarrier(event.tracking)});
      if (event.deadline) current.shipDeadline = event.deadline;
      if (event.labelMedia) current.shipLabel = event.labelMedia;
      return {next, line: {icon: '🏷', tone: 'info', title: 'Label ready · ' + (current.shipCarrier || 'Vinted'), body: '#' + item.id + ' ' + item.name + ' · label saved to the item'}};
    }
  }
  return null;
}

// Courier emails (InPost, Evri, Royal Mail…) are matched by tracking number only, never by guessing.
const auCarrier = t => /^JJD/.test(t) ? 'InPost' : /^H\d/.test(t) ? 'Evri' : /GB$/.test(t) ? 'Royal Mail' : '';
function auTrackingApply(event, data) {
  const item = data.items.find(row => !row.deletedAt && row.shipTracking && row.shipTracking === event.tracking);
  if (!item) return null;
  const trade = lastTrade(data, item.id);
  if (!trade) return null;
  const today = todayUK(), date = event.date && event.date <= today ? event.date : today;
  const next = cloneWorkspace(data), current = next.items.find(row => row.id === item.id);
  if (event.carrier && !current.shipCarrier) current.shipCarrier = event.carrier;
  if (event.type === 'qr') {
    if (!event.qrMedia || current.shipQr) return null;
    Object.assign(current, {shipQr: event.qrMedia, shipQrAt: date, ...(event.code ? {shipCode: event.code.slice(0, 40)} : {})});
    return {next, line: {icon: '▦', tone: 'info', title: 'QR code added', body: '#' + item.id + ' ' + item.name + ' · ready to scan at the drop-off'}};
  }
  if (event.type === 'posted') {
    if (trade.postedAt || current.shipPostedAt) return null;
    const when = date < trade.soldAt ? trade.soldAt : date;
    const posted = advanceOrder(next, item.id, 'Posted', when);
    const row = posted.items.find(r => r.id === item.id);
    row.shipPostedAt = when;
    return {next: posted, line: {icon: '📮', tone: 'go', title: 'Posted · ' + (current.shipCarrier || 'parcel'), body: '#' + item.id + ' ' + item.name + ' · ' + (current.shipCarrier || 'the courier') + ' has it'}};
  }
  if (event.type === 'parcel-delivered') {
    if (current.shipDeliveredAt) return null;
    let out = next;
    if (!trade.postedAt) { try { out = advanceOrder(next, item.id, 'Posted', date < trade.soldAt ? trade.soldAt : date); } catch {} }
    const row = out.items.find(r => r.id === item.id);
    row.shipDeliveredAt = date; if (!row.shipPostedAt) row.shipPostedAt = lastTrade(out, item.id)?.postedAt || date;
    return {next: out, line: {icon: '✓', tone: 'go', title: 'Delivered to buyer', body: '#' + item.id + ' ' + item.name + ' · waiting for them to confirm'}};
  }
  return null;
}


async function auRun() {
  if (auBusy || !db || !account || isReadOnly() || document.getElementById('pipUpdates')) return;
  const receipts = (typeof personalGmail !== 'undefined' ? personalGmail?.connection?.receipts : null) || [];
  const events = receipts.filter(r => r.event && !auDone.has(r.id + (r.event.type === 'label' && r.event.tracking ? ':t' : ''))).map(r => ({...r.event, id: r.id + (r.event.type === 'label' && r.event.tracking ? ':t' : '')}))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const signature = events.map(e => e.id).join(',') + '|' + (db.items.length) + '|' + ((db.trades || []).length);
  if (!events.length || signature === auSignature) return;
  auSignature = signature;
  auBusy = true;
  const before = db;
  let next = db;
  const lines = [], applied = [];
  let skipped = 0;
  try {
    for (const event of events) {
      if (auAlreadyDone(event, next)) { auDone.add(event.id); continue; }
      if (['qr', 'posted', 'parcel-delivered'].includes(event.type)) {
        let result = null;
        try { result = auTrackingApply(event, next); } catch {}
        if (result) { next = result.next; lines.push(result.line); applied.push(event); auDone.add(event.id); }
        // No match yet: the label email may not be in yet. Keep trying for 3 days, then leave it (it's probably a parcel coming to you).
        else if (auDays(event.date, todayUK()) > 3 || next.items.some(row => row.shipTracking === event.tracking)) auDone.add(event.id);
        continue;
      }
      const ranked = auRank(event.title, auCandidates(event, next),
        item => event.type !== 'sold' ? 0 : (Number.isFinite(item.price) && Math.abs(item.price - event.amount) < 0.01 ? 0.15 : 0) - ((typeof stockWorkflow === 'function' ? stockWorkflow(item) === 'arriving' : !item.receivedAt && !item.listedAt) ? 0.2 : 0));
      // Only act when Pip is sure. Anything else is skipped quietly and never asked about.
      if (ranked.length && auConfident(ranked)) {
        try { const result = auApply(event, ranked[0].item, next); next = result.next; lines.push(result.line); applied.push(event); }
        catch { skipped++; }
      } else if (event.type !== 'label') skipped++;
      auDone.add(event.id);
    }
    const changed = next !== before;
    if (changed) { await persist(next); render(); }
    auSaveDone();
    if (applied.length) auPanel(lines, changed ? before : null, applied, skipped);
  } catch (error) {
    auSignature = '';
    console.warn('Email updates not applied', error);
  } finally { auBusy = false; }
}

function auPanel(lines, undoFrom, events = [], skipped = 0) {
  document.getElementById('pipUpdates')?.remove();
  const count = type => events.filter(e => e.type === type);
  const sold = count('sold'), money = sold.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  const stats = [
    sold.length && ['Sold', sold.length + (sold.length === 1 ? ' item' : ' items'), gbp(money)],
    count('completed').length && ['Paid out', String(count('completed').length), 'sales completed'],
    count('delivered').length && ['Arrived', String(count('delivered').length), 'marked received'],
    count('refund').length && ['Refunds', String(count('refund').length), 'purchases cancelled'],
    count('posted').length && ['Posted', String(count('posted').length), 'parcels on their way'],
    count('parcel-delivered').length && ['Delivered', String(count('parcel-delivered').length), 'to your buyers'],
  ].filter(Boolean);
  const panel = document.createElement('section');
  panel.id = 'pipUpdates';
  panel.className = 'pip-updates summary';
  panel.setAttribute('role', 'status');
  panel.setAttribute('aria-label', 'Pip’s summary of your Vinted updates');
  panel.innerHTML = '<header><span class="pu-pip" aria-hidden="true"></span><div><strong>' + (sold.length ? 'You made ' + gbp(money) + '!' : 'Pip updated your stock') + '</strong><small>From your latest Vinted emails</small></div>' +
      '<button type="button" class="pu-x" data-pu-close aria-label="Close">✕</button></header>' +
    '<div class="pu-stats">' + stats.map(([label, value, sub]) => '<div><span>' + label + '</span><b>' + esc(value) + '</b><small>' + esc(sub) + '</small></div>').join('') + '</div>' +
    '<details class="pu-more"><summary>See what changed</summary><ul class="pu-lines">' + lines.map(l => '<li class="' + l.tone + '"><i>' + l.icon + '</i><div><strong>' + esc(l.title) + '</strong><small>' + esc(l.body) + '</small></div></li>').join('') + '</ul></details>' +
    (skipped ? '<p class="pu-skipped">' + skipped + (skipped === 1 ? ' email didn’t' : ' emails didn’t') + ' match your stock, so Pip left ' + (skipped === 1 ? 'it' : 'them') + ' alone.</p>' : '') +
    '<footer>' + (undoFrom ? '<button type="button" class="secondary" data-pu-undo>Undo</button>' : '') + '<button type="button" class="action" data-pu-close>Nice</button></footer>';
  panel._undo = undoFrom;
  document.body.append(panel);
  if (typeof pipChime === 'function' && localStorage.getItem('stockroom-sound') !== 'off') { try { pipChime(); } catch {} }
}

document.addEventListener('click', async event => {
  const panel = event.target.closest('#pipUpdates');
  if (!panel) return;
  if (event.target.closest('[data-pu-close]')) { panel.classList.add('leaving'); setTimeout(() => panel.remove(), 220); return; }
  if (event.target.closest('[data-pu-undo]')) {
    const button = event.target.closest('[data-pu-undo]'); button.disabled = true;
    try { await persist(panel._undo); render(); toast('Updates undone. Pip won’t apply those emails again.'); panel.remove(); }
    catch (e) { toast(e.message || 'Could not undo.'); button.disabled = false; }
    return;
  }
});

// Keep Gmail results fresh in the background (the server checks the inbox every 10 minutes),
// then apply anything new. Also runs after pull-to-refresh and push notifications update personalGmail.
let auFetched = 0;
async function auRefreshGmail() {
  if (!db || !account || isReadOnly() || document.hidden) return;
  if (Date.now() - auFetched < 120000) return;
  auFetched = Date.now();
  try { personalGmail = await api('/api/gmail'); } catch {}
}
setInterval(() => { void auLoadServerDone().then(auRefreshGmail).then(auRun); }, 4000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { auFetched = 0; void auRefreshGmail().then(auRun); } });
