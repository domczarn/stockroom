'use strict';
// App shell: section navigation (Stripe-style sub-tabs) and Pip's brain (insights from the workspace).

const SECTIONS = [
  {key:'home', label:'Home', tabs:[['Dashboard','Overview'],['Vinted updates','Vinted updates'],['Sale receipts','Sale receipts','admin']]},
  {key:'stock', label:'Stock', tabs:[['Stock','Collection'],['Repricing','Not selling'],['Sourcing','Where I buy','pro-tools'],['Orders','Bulk buys','pro-tools'],['Buying insights','What sells best','pro-tools'],['Buying research','Market trends','pro-tools']]},
  {key:'money', label:'Money', tabs:[['Activity','Transactions'],['Expenses','Expenses'],['Reports','Reports']]},
  {key:'care', label:'Customer care', tabs:[['Customer care','Customer care']]},
  {key:'studio', label:'Photo studio', tabs:[['Studio','Photo studio']]},
  {key:'account', label:'Account', tabs:[['Account','Settings'],['Profile','Community'],['Leaderboard','Leaderboard'],['Admin','Admin','admin']]}
];
// Beginner mode: the advanced stock tools stay out of the way until you've got going (10+ items or 3+ sales),
// or you switch them on in Settings → Advanced. They're always reachable if you're already on one.
function proToolsSetting() { try { return localStorage.getItem('sr-pro-tools:' + (account?.id || '')); } catch { return null; } }
function showProTools() {
  const pref = proToolsSetting();
  if (pref === 'on') return true;
  if (pref === 'off') return ['Sourcing', 'Orders', 'Buying insights', 'Buying research'].includes(typeof tab === 'string' ? tab : '');
  const items = (db?.items || []).filter(i => !i.deletedAt).length, sales = (db?.trades || []).length;
  return items >= 10 || sales >= 3 || ['Sourcing', 'Orders', 'Buying insights', 'Buying research'].includes(typeof tab === 'string' ? tab : '');
}
const sectionOf = name => SECTIONS.find(section => section.tabs.some(([id]) => id === name)) || SECTIONS[0];

function subnavView(current) {
  const section = sectionOf(current);
  const tabs = section.tabs.filter(([, , role]) => role === 'pro-tools' ? showProTools() : role !== 'admin' || (account?.role === 'admin' && !isReadOnly()));
  if (tabs.length < 2) return '';
  return '<nav class="subnav" aria-label="' + section.label + '">' + tabs.map(([id, label]) =>
    '<button type="button" data-tab="' + esc(id) + '"' + (id === current ? ' class="active" aria-current="page"' : '') + '>' + esc(label) + '</button>'
  ).join('') + '</nav>';
}

function markSections(current) {
  const active = sectionOf(current).key;
  document.querySelectorAll('.aura-btn[data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === current));
  document.querySelectorAll('.sidebar nav [data-tab]').forEach(button => {
    const on = sectionOf(button.dataset.tab).key === active;
    button.classList.toggle('active', on);
    if (on) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
}

// ---------- Pip's brain ----------
function pipSignals() {
  const today = todayUK();
  const live = db.items.filter(item => !item.deletedAt);
  const inStock = live.filter(item => item.status === 'In Stock');
  const flow = {ready:0, photos:0, arriving:0, listed:0};
  for (const item of inStock) { const step = stockWorkflow(item); if (step in flow) flow[step]++; }
  const tiedUp = total(inStock, item => Number(item.cost) || 0);
  const stale = inStock.map(item => ({item, days:daysListed(item, today)})).filter(row => row.days >= 30).sort((a, b) => b.days - a.days);

  const rows = accountingRows(db);
  const monthStart = today.slice(0, 7) + '-01';
  const day = Number(today.slice(8, 10));
  const prev = new Date(Date.parse(monthStart + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
  const prevStart = prev.slice(0, 7) + '-01';
  const prevSameDay = prev.slice(0, 8) + String(Math.min(day, Number(prev.slice(8, 10)))).padStart(2, '0');
  const thisMonth = reportTotals(rows.filter(row => row.date >= monthStart && row.date <= today));
  const lastMonth = reportTotals(rows.filter(row => row.date >= prevStart && row.date <= prevSameDay));

  const sales = (db.trades || []).filter(trade => Number.isFinite(trade.amount) && Number.isFinite(trade.cost));
  const byBrand = new Map();
  for (const trade of sales) {
    const brand = (db.items.find(item => item.id === trade.itemId)?.brand || '').trim();
    if (!brand) continue;
    const entry = byBrand.get(brand) || {brand, profit:0, revenue:0, count:0};
    entry.profit += trade.amount - trade.cost; entry.revenue += trade.amount; entry.count++;
    byBrand.set(brand, entry);
  }
  const bestBrand = [...byBrand.values()].sort((a, b) => b.profit - a.profit)[0];
  const margin = sales.length ? total(sales, trade => trade.amount - trade.cost) / Math.max(1, total(sales, trade => trade.amount)) : null;

  const signals = [];
  if (flow.ready) signals.push({tone:'go', title:flow.ready + ' ready to list', detail:'Photographed and waiting. Listing them turns ' + gbp(total(inStock.filter(item => stockWorkflow(item) === 'ready'), item => Number(item.cost) || 0)) + ' of stock into sales.', tab:'Stock'});
  if (stale.length) signals.push({tone:'warn', title:stale.length + ' listed 30+ days', detail:stale[0].item.name + ' has been up ' + stale[0].days + ' days. A price drop or relist usually moves these.', tab:'Stock'});
  if (thisMonth.revenue || lastMonth.revenue) {
    const change = lastMonth.revenue ? (thisMonth.revenue - lastMonth.revenue) / lastMonth.revenue : null;
    signals.push({tone:change !== null && change < 0 ? 'warn' : 'go', title:gbp(thisMonth.revenue) + ' sold this month',
      detail:change === null ? 'No sales in the same period last month to compare.' : (change >= 0 ? 'Up ' : 'Down ') + Math.abs(Math.round(change * 100)) + '% on the same point last month.', tab:'Reports'});
  }
  if (bestBrand && bestBrand.count >= 1) signals.push({tone:'info', title:bestBrand.brand + ' earns most', detail:gbp(bestBrand.profit) + ' profit from ' + bestBrand.count + ' sale' + (bestBrand.count === 1 ? '' : 's') + '. Worth sourcing more.', tab:'Buying insights'});
  if (flow.arriving) signals.push({tone:'info', title:flow.arriving + ' on the way', detail:'Mark them received when they land so Pip can track their age.', tab:'Stock'});
  if (flow.photos) signals.push({tone:'warn', title:flow.photos + ' need photos', detail:'Items without photos can’t be listed yet.', tab:'Stock'});

  const summary = inStock.length
    ? gbp(tiedUp) + ' is tied up in ' + inStock.length + ' item' + (inStock.length === 1 ? '' : 's') + (margin !== null ? '. Sold items average a '  + Math.round(margin * 100) + '% gross margin.' : '.')
    : 'No stock in yet. Add your first item and Pip will start learning your numbers.';
  return {summary, signals:signals.slice(0, 3), stats:{tiedUp, inStock:inStock.length, margin}};
}

// Deterministic neural network drawn around Pip.
function pipBrainArt() {
  const nodes = [];
  let seed = 7;
  const rand = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  for (let i = 0; i < 44; i++) {
    const angle = (i / 44) * Math.PI * 2 + rand() * .5, radius = 54 + rand() * 50;
    nodes.push([120 + Math.cos(angle) * radius, 120 + Math.sin(angle) * radius]);
  }
  const links = [];
  nodes.forEach((a, i) => nodes.forEach((b, j) => { if (j > i && Math.hypot(a[0] - b[0], a[1] - b[1]) < 38) links.push([a, b]); }));
  return '<svg class="pip-brain-net" viewBox="0 0 240 240" aria-hidden="true">' +
    '<defs><radialGradient id="pipCore" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#9b8cff" stop-opacity=".55"/><stop offset=".55" stop-color="#3987e5" stop-opacity=".12"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient></defs>' +
    '<circle cx="120" cy="120" r="118" fill="url(#pipCore)"/>' +
    '<circle class="pip-ring" cx="120" cy="120" r="100" fill="none"/><circle class="pip-ring pip-ring-2" cx="120" cy="120" r="78" fill="none"/>' +
    '<g class="pip-links">' + links.map(([a, b]) => '<line x1="' + a[0].toFixed(1) + '" y1="' + a[1].toFixed(1) + '" x2="' + b[0].toFixed(1) + '" y2="' + b[1].toFixed(1) + '"/>').join('') + '</g>' +
    '<g class="pip-nodes">' + nodes.map(([x, y], i) => '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' + (i % 5 === 0 ? 2.6 : 1.6) + '" class="n' + (i % 7) + '"/>').join('') + '</g></svg>';
}

function pipBrainView() {
  const brain = pipSignals();
  const tone = {go:'Opportunity', warn:'Needs attention', info:'Signal'};
  return '<section class="pip-brain" aria-labelledby="pipBrainTitle">' +
    '<div class="pip-brain-visual">' + pipBrainArt() + '<img class="pip-brain-face" src="/pip.svg" alt="" width="96" height="90"></div>' +
    '<div class="pip-brain-copy"><span class="pip-brain-eyebrow"><span class="pip-live"></span>About your numbers</span>' +
    '<h2 id="pipBrainTitle">Ask Pip</h2><p class="pip-brain-summary">' + esc(brain.summary) + '</p>' +
    '<form class="ask-pip-bar" data-ask-pip-form><span class="ask-pip-spark" aria-hidden="true">✦</span><input name="q" autocomplete="off" maxlength="500" placeholder="Ask Pip about your numbers…" aria-label="Ask Pip a question"><button type="submit" aria-label="Ask">↑</button></form>' +
    '<div class="ask-pip-starters">' + ['What made me most money this month?', 'Which brands should I buy more of?', 'What should I reprice?'].map(q => '<button type="button" data-ask-pip="' + esc(q) + '">' + esc(q) + '</button>').join('') + '</div>' +
    (brain.signals.length ? '<ul class="pip-signals">' + brain.signals.map(signal =>
      '<li><button type="button" class="pip-signal" data-tone="' + signal.tone + '" data-tab="' + esc(signal.tab) + '"><span class="pip-signal-tag">' + tone[signal.tone] + '</span>' +
      '<strong>' + esc(signal.title) + '</strong><small>' + esc(signal.detail) + '</small><span class="pip-signal-go" aria-hidden="true">→</span></button></li>').join('') + '</ul>'
      : '<p class="pip-brain-quiet">Nothing needs you right now.</p>') +
    '<button class="secondary pip-dashboard-action" type="button" data-guide>Open full review <span aria-hidden="true">→</span></button></div></section>';
}

// ---------- Dashboard KPIs ----------
function kpiStrip() {
  const rows = accountingRows(db);
  const today = todayUK();
  const day = 86400000, end = Date.parse(today + 'T00:00:00Z');
  const iso = t => new Date(t).toISOString().slice(0, 10);
  const span = (from, to) => reportTotals(saleRows(rows).filter(row => row.date >= iso(from) && row.date <= iso(to)));
  const now = span(end - 29 * day, end), before = span(end - 59 * day, end - 30 * day);
  const all = reportTotals(saleRows(rows));
  const f = finances(db);
  const delta = (a, b) => b ? Math.round((a - b) / Math.abs(b) * 100) : null;
  const spark = key => {
    const points = Array.from({length:10}, (_, i) => span(end - (29 - i * 3) * day, end - (27 - i * 3) * day)[key]);
    const max = Math.max(1, ...points.map(Math.abs)), min = Math.min(0, ...points);
    return '<svg class="kpi-spark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true"><polyline points="' +
      points.map((v, i) => (i * 100 / 9).toFixed(1) + ',' + (26 - 24 * (v - min) / (max - min || 1)).toFixed(1)).join(' ') + '"/></svg>';
  };
  const tile = (label, value, note, change, sparkKey) => '<div class="kpi"><span class="kpi-label">' + label + '</span><strong class="kpi-value">' + value + '</strong>' +
    '<span class="kpi-note">' + (change === null || change === undefined ? '' : '<span class="kpi-delta ' + (change >= 0 ? 'up' : 'down') + '">' + (change >= 0 ? '↑' : '↓') + ' ' + Math.abs(change) + '%</span> ') + note + '</span>' +
    (sparkKey ? spark(sparkKey) : '') + '</div>';
  return '<section class="kpi-strip" aria-label="Key numbers">' +
    tile('Profit on sales', gbp(all.profit), 'all time', null, 'profit') +
    tile('Revenue', gbp(now.revenue), 'last 30 days', delta(now.revenue, before.revenue), 'revenue') +
    tile('Margin', now.revenue > 0 ? Math.round(now.profit / now.revenue * 100) + '%' : '—', 'last 30 days', null) +
    tile('Stock at cost', gbp(f.inventory), f.active.length + ' items in stock', null) + '</section>';
}

// In-page view tabs (Expenses: Overview/Clothing/Business costs, Transactions: All/Sales/...).
document.addEventListener('click', event => {
  const view = event.target.closest('[data-view-expense],[data-view-activity],[data-expense-category]');
  if (!view || !db) return;
  if (view.dataset.viewExpense) { expenseView = view.dataset.viewExpense; expenseCategory = 'All'; }
  else if (view.dataset.viewActivity) activityView = view.dataset.viewActivity;
  else expenseCategory = view.dataset.expenseCategory;
  render();
});

// CSP forbids inline style attributes; size elements through the CSSOM instead.
function applySizes(root) {
  root.querySelectorAll('[data-w]').forEach(el => { el.style.width = el.dataset.w + '%'; });
}

// ---------- Automatic updates ----------
// An installed (home-screen) app stays open and never reloads by itself, so check for a new build
// whenever it comes back to the foreground and every few minutes, then refresh when it is safe.
const loadedVersion = document.querySelector('meta[name="stockroom-version"]')?.content || '';
let updateBanner = null;
function updateIsSafe() {
  return !document.querySelector('dialog[open]') && !document.querySelector('input:focus, textarea:focus, select:focus') &&
    !(typeof pendingLocal !== 'undefined' && pendingLocal);
}
function offerUpdate() {
  if (updateBanner) return;
  updateBanner = document.createElement('button');
  updateBanner.type = 'button';
  updateBanner.className = 'update-banner';
  updateBanner.textContent = 'New version ready · Tap to refresh';
  updateBanner.onclick = () => location.reload();
  document.body.append(updateBanner);
}
async function checkForUpdate() {
  if (!loadedVersion || document.visibilityState !== 'visible') return;
  try {
    const response = await fetch('/version.json', {cache:'no-store'});
    if (!response.ok) return;
    const {version} = await response.json();
    if (!version || version === loadedVersion) return;
    if (updateIsSafe()) location.reload(); else offerUpdate();
  } catch {}
}
document.addEventListener('visibilitychange', checkForUpdate);
window.addEventListener('pageshow', event => { if (event.persisted) checkForUpdate(); });
window.addEventListener('focus', checkForUpdate);
setInterval(checkForUpdate, 5 * 60 * 1000);

// ---------- Pip notifications: in-app card + synthesised chime ----------
let pipAudio = null;
const soundOn = () => { try { return localStorage.getItem('stockroom-sound') !== 'off'; } catch { return true; } };
function unlockAudio() {
  try {
    pipAudio ||= new (window.AudioContext || window.webkitAudioContext)();
    if (pipAudio.state === 'suspended') pipAudio.resume();
  } catch {}
}
['pointerdown', 'keydown', 'touchstart'].forEach(type => document.addEventListener(type, unlockAudio, {passive:true}));

// A short rising "data received" tone: three glassy partials with a pitch glide, a band-passed shimmer
// sweep, and a soft echo. Kept under 1.2s and quiet.
function pipChime() {
  if (!soundOn()) return;
  try {
    unlockAudio();
    const ctx = pipAudio; if (!ctx) return;
    const t = ctx.currentTime + 0.02;
    const master = ctx.createGain(); master.gain.value = 0.55;
    const echo = ctx.createDelay(); echo.delayTime.value = 0.16;
    const feedback = ctx.createGain(); feedback.gain.value = 0.28;
    const wet = ctx.createGain(); wet.gain.value = 0.35;
    master.connect(ctx.destination); master.connect(echo); echo.connect(feedback); feedback.connect(echo); echo.connect(wet); wet.connect(ctx.destination);
    [[659.25, 0, 'sine'], [987.77, 0.085, 'triangle'], [1567.98, 0.17, 'sine']].forEach(([freq, at, type]) => {
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq * 0.92, t + at);
      osc.frequency.exponentialRampToValueAtTime(freq, t + at + 0.06);
      gain.gain.setValueAtTime(0.0001, t + at);
      gain.gain.exponentialRampToValueAtTime(0.16, t + at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.55);
      osc.connect(gain); gain.connect(master);
      osc.start(t + at); osc.stop(t + at + 0.6);
    });
    const length = Math.floor(ctx.sampleRate * 0.5), buffer = ctx.createBuffer(1, length, ctx.sampleRate), data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const noise = ctx.createBufferSource(), band = ctx.createBiquadFilter(), ng = ctx.createGain();
    noise.buffer = buffer; band.type = 'bandpass'; band.Q.value = 9;
    band.frequency.setValueAtTime(900, t); band.frequency.exponentialRampToValueAtTime(7000, t + 0.42);
    ng.gain.setValueAtTime(0.0001, t); ng.gain.exponentialRampToValueAtTime(0.05, t + 0.05); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.48);
    noise.connect(band); band.connect(ng); ng.connect(master); noise.start(t); noise.stop(t + 0.5);
  } catch {}
}

let pipStack = null;
function pipNotify({title, body, tab, tone = 'info'}) {
  if (!title) return;
  pipStack ||= Object.assign(document.createElement('div'), {className:'pip-toasts', role:'status'});
  pipStack.setAttribute('aria-live', 'polite');
  if (!pipStack.isConnected) document.body.append(pipStack);
  const card = document.createElement('div');
  card.className = 'pip-toast';
  card.dataset.tone = tone;
  card.innerHTML = '<span class="pip-toast-orb"><img src="/pip-orb.svg" alt="" width="44" height="44"></span>' +
    '<span class="pip-toast-copy"><span class="pip-toast-eyebrow">Pip · ' + (tone === 'go' ? 'Stock update' : 'Update') + '</span>' +
    '<strong>' + esc(title) + '</strong>' + (body ? '<small>' + esc(body) + '</small>' : '') + '</span>' +
    '<span class="pip-toast-actions">' + (tab ? '<button type="button" class="pip-toast-open">View</button>' : '') +
    '<button type="button" class="pip-toast-close" aria-label="Dismiss">✕</button></span><span class="pip-toast-timer"></span>';
  const close = () => { card.classList.add('leaving'); setTimeout(() => card.remove(), 260); };
  card.querySelector('.pip-toast-close').onclick = close;
  card.querySelector('.pip-toast-open')?.addEventListener('click', () => { close(); navigate(tab); });
  pipStack.prepend(card);
  while (pipStack.children.length > 3) pipStack.lastElementChild.remove();
  requestAnimationFrame(() => card.classList.add('shown'));
  setTimeout(close, 8000);
  pipChime();
}

navigator.serviceWorker?.addEventListener('message', event => {
  const data = event.data || {};
  // Purchases are announced by refreshImports once the items are actually in stock.
  if (data.type === 'stockroom-update' && data.kind && data.kind !== 'purchase' && data.title) pipNotify({title:data.title, body:data.body, tab:data.tab});
});

document.addEventListener('click', event => {
  if (event.target.closest('[data-sound-test]')) { unlockAudio(); const was = soundOn(); if (!was) try { localStorage.removeItem('stockroom-sound'); } catch {} ; pipNotify({title:'This is Pip', body:'You’ll hear this when new stock or Vinted updates land.', tone:'go'}); if (!was) try { localStorage.setItem('stockroom-sound','off'); } catch {} }
  const toggle = event.target.closest('[data-sound-toggle]');
  if (toggle) { try { localStorage.setItem('stockroom-sound', soundOn() ? 'off' : 'on'); } catch {} toggle.textContent = soundOn() ? 'On' : 'Off'; toggle.setAttribute('aria-pressed', String(soundOn())); }
});

// Card/list "⋯" menus float above the page so cards and tables can't clip them.
(() => {
  const place = details => {
    const menu = details.querySelector(':scope > div'), button = details.querySelector('summary');
    if (!menu || !button) return;
    menu.classList.add('floating-menu');
    const r = button.getBoundingClientRect();
    menu.style.top = '0px'; menu.style.left = '0px';
    const h = menu.offsetHeight, w = menu.offsetWidth;
    const below = r.bottom + 6 + h <= window.innerHeight - 8;
    menu.style.top = Math.max(8, below ? r.bottom + 6 : r.top - 6 - h) + 'px';
    menu.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w)) + 'px';
    menu.classList.toggle('opens-up', !below);
  };
  const closeAll = except => document.querySelectorAll('details.stock-more[open]').forEach(d => { if (d !== except) d.open = false; });
  document.addEventListener('toggle', event => {
    const details = event.target;
    if (!(details instanceof HTMLDetailsElement) || !details.classList.contains('stock-more')) return;
    if (details.open) { closeAll(details); place(details); }
  }, true);
  document.addEventListener('click', event => {
    const open = document.querySelector('details.stock-more[open]');
    if (!open) return;
    if (!open.contains(event.target)) open.open = false;
    else if (event.target.closest('.floating-menu button')) setTimeout(() => { open.open = false; }, 0);
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeAll(); });
  window.addEventListener('scroll', () => { const open = document.querySelector('details.stock-more[open]'); if (open) place(open); }, {passive: true, capture: true});
  window.addEventListener('resize', () => closeAll());
})();

// Remove the right-edge fade once the chip row is scrolled to the end.
document.addEventListener('scroll', event => {
  const row = event.target;
  if (row instanceof Element && row.classList.contains('stock-filters')) row.classList.toggle('at-end', row.scrollLeft + row.clientWidth >= row.scrollWidth - 4);
}, true);

// Offline banner: the app keeps working from the last synced copy; saves wait until you're back online.
(() => {
  const bar = document.createElement('div');
  bar.className = 'offline-bar'; bar.setAttribute('role', 'status'); bar.hidden = navigator.onLine;
  bar.textContent = 'Offline · last synced copy. Changes save when you’re back online.';
  document.body.append(bar);
  addEventListener('offline', () => { bar.hidden = false; });
  addEventListener('online', () => { bar.hidden = true; if (typeof syncCloud === 'function') syncCloud(true).catch(() => {}); });
})();

// Register the service worker for everyone (offline copy), not only when notifications are switched on.
if ('serviceWorker' in navigator) addEventListener('load', () => { navigator.serviceWorker.register('/stockroom-sw.js').catch(() => {}); });

// ---------- Large title: the header shows the page name once its big heading scrolls away ----------
(() => {
  const header = document.querySelector('.app-header');
  if (!header) return;
  let frame = 0;
  const update = () => {
    frame = 0;
    const h1 = document.querySelector('#view h1');
    header.classList.toggle('has-title', Boolean(h1));
    const edge = header.getBoundingClientRect().bottom;
    header.classList.toggle('scrolled', h1 ? h1.getBoundingClientRect().bottom < edge + 4 : window.scrollY > 8);
  };
  const queue = () => { if (!frame) frame = requestAnimationFrame(update); };
  window.addEventListener('scroll', queue, {passive: true});
  window.addEventListener('resize', queue, {passive: true});
  const view = document.getElementById('view');
  if (view) new MutationObserver(queue).observe(view, {childList: true});
  queue();
})();

// ---------- Figures count up when a screen opens ----------
(() => {
  const view = document.getElementById('view');
  if (!view || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const pattern = /^([−-]?)(£?)([\d,]+)(\.\d+)?(%?)$/;
  const run = () => {
    if (!view.classList.contains('view-arriving')) return;
    view.querySelectorAll('.metric strong, .kpi-value, .pf-card strong').forEach(el => {
      if (el.children.length || el.dataset.counted) return;
      const text = el.textContent.trim(), m = text.match(pattern);
      if (!m) return;
      const target = Number(m[3].replace(/,/g, '') + (m[4] || ''));
      if (!Number.isFinite(target) || target === 0) return;
      el.dataset.counted = '1';
      const decimals = m[4] ? m[4].length - 1 : 0, start = performance.now(), duration = 700;
      const fmt = v => m[1] + m[2] + v.toLocaleString('en-GB', {minimumFractionDigits: decimals, maximumFractionDigits: decimals}) + m[5];
      const step = now => {
        const t = Math.min(1, (now - start) / duration), eased = 1 - Math.pow(1 - t, 3);
        el.textContent = t < 1 ? fmt(target * eased) : text;
        if (t < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  };
  new MutationObserver(run).observe(view, {attributes: true, attributeFilter: ['class']});
})();
