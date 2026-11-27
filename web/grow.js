'use strict';
// Growth features: repricing coach, ship-by countdown, sourcing trips, HMRC reporting tracker,
// Stockroom price index, measurements from a photo and Depop/eBay listing copy.

const growDay = 864e5;
const growIso = d => d.toISOString().slice(0, 10);
const growRound = n => n < 10 ? Math.round(n * 2) / 2 : Math.round(n);

// ---------- Ship-by countdown (Vinted: 5 business days from the sale) ----------
const UK_BANK_HOLIDAYS = new Set(['2026-01-01', '2026-04-03', '2026-04-06', '2026-05-04', '2026-05-25', '2026-08-31', '2026-12-25', '2026-12-28',
  '2027-01-01', '2027-03-26', '2027-03-29', '2027-05-03', '2027-05-31', '2027-08-30', '2027-12-27', '2027-12-28',
  '2028-01-03', '2028-04-14', '2028-04-17', '2028-05-01', '2028-05-29', '2028-08-28', '2028-12-25', '2028-12-26']);
const growWorkday = d => d.getUTCDay() % 6 !== 0 && !UK_BANK_HOLIDAYS.has(growIso(d));
function shipDeadline(soldAt, days = 5) {
  const d = new Date(String(soldAt).slice(0, 10) + 'T12:00:00Z');
  if (!Number.isFinite(d.getTime())) return null;
  for (let left = days; left > 0;) { d.setTime(d.getTime() + growDay); if (growWorkday(d)) left--; }
  return growIso(d);
}
function workdaysBetween(from, to) {
  if (to <= from) return to === from ? 0 : -1;
  let n = 0; const d = new Date(from + 'T12:00:00Z');
  while (growIso(d) < to) { d.setTime(d.getTime() + growDay); if (growWorkday(d)) n++; }
  return n;
}
function shipInfo(trade, today = todayUK()) {
  const by = shipDeadline(trade.soldAt);
  if (!by) return {by: null, label: 'Sold ' + dateLabel(trade.soldAt), level: ''};
  const left = workdaysBetween(today, by);
  const day = new Date(by + 'T12:00:00Z').toLocaleDateString('en-GB', {weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC'});
  const label = by < today ? 'Overdue · deadline was ' + day : by === today ? 'Post today · last day' : 'Post by ' + day + ' · ' + left + ' working day' + (left === 1 ? '' : 's') + ' left';
  return {by, left, label, level: by <= today ? 'urgent' : left <= 1 ? 'soon' : ''};
}

// ---------- Stockroom price index (anonymous, from all sellers) ----------
let priceIndex = null, priceIndexLoading = null;
const growBrand = b => String(b || '').trim().toLowerCase().replace(/[^a-z0-9&]+/g, ' ').replace(/\s+/g, ' ').trim();
const GROW_TYPES = [
  [/q(?:uarter)?[ -]?zip|qzip|1\/4 zip/i, 'Quarter zip'], [/hood(?:ie|y)/i, 'Hoodie'], [/sweat(?:shirt|er)?|crew ?neck|jumper|knit/i, 'Jumper'],
  [/fleece/i, 'Fleece'], [/gilet|vest\b/i, 'Gilet'], [/windbreaker|windrunner|anorak|cagoule/i, 'Windbreaker'], [/puffer|down jacket/i, 'Puffer'],
  [/jacket|coat|parka|bomber|harrington|overshirt/i, 'Jacket'], [/full[ -]?zip|zip[ -]?up|track ?top/i, 'Full zip'], [/polo/i, 'Polo'],
  [/t[ -]?shirt|\btee\b/i, 'T-shirt'], [/\bshirt\b/i, 'Shirt'], [/jeans|denim/i, 'Jeans'], [/joggers|track ?pants|trousers|chinos|cargos?/i, 'Trousers'],
  [/shorts/i, 'Shorts'], [/trainers|sneakers|shoes|boots/i, 'Footwear'], [/cap|hat|beanie|bag|belt|scarf/i, 'Accessory']
];
const growType = item => GROW_TYPES.find(([re]) => re.test(String(item.garment || '') + ' ' + String(item.name || '')))?.[1] || '';
function loadPriceIndex() {
  if (priceIndex || priceIndexLoading) return priceIndexLoading;
  priceIndexLoading = api('/api/price-index').then(r => { priceIndex = {rows: new Map(r.rows.map(x => [x.key, x])), all: r.rows, updatedAt: r.updatedAt}; }).catch(() => { priceIndex = {rows: new Map(), all: []}; }).finally(() => { priceIndexLoading = null; });
  return priceIndexLoading;
}
function communityPrice(item) {
  if (!priceIndex) return null;
  const b = growBrand(item.brand), t = growType(item);
  return (b && t && priceIndex.rows.get(b + '|' + t)) || (b && priceIndex.rows.get(b + '|')) || (t && priceIndex.rows.get('|' + t)) || null;
}
function communityLine(item, cost) {
  const c = communityPrice(item);
  if (!c) return '';
  const what = [c.label, c.type].filter(Boolean).join(' ') || 'Similar pieces';
  const use = growRound(c.median);
  const profit = Number.isFinite(cost) && cost !== null ? use - cost : null;
  return '<span class="pg-line pg-community"><span class="pg-net" aria-hidden="true"></span><span><strong>Stockroom sellers: ' + gbp(c.median) + '</strong>' +
    '<small>' + esc(what) + ' · ' + c.n + ' sales by ' + c.sellers + ' sellers · usually ' + gbp(c.low) + '–' + gbp(c.high) + (c.days != null ? ' · sells in about ' + c.days + ' days' : '') +
    (profit !== null ? ' · ' + (profit >= 0 ? '+' : '') + gbp(profit) + ' profit' : '') + '</small></span>' +
    '<button type="button" class="pg-use" data-pg-use="' + use + '">Use ' + gbp(use) + '</button></span>';
}

// ---------- Repricing coach ----------
const COACH_STAGES = [
  {key: 'nudge', from: 14, to: 29, title: 'Give it a nudge', note: '14–29 days without a sale. A fresh cover photo or a small drop usually wakes a listing up.', cut: .9},
  {key: 'drop', from: 30, to: 59, title: 'Drop the price', note: '30–59 days. Buyers have seen it at this price and passed. Move it closer to what similar pieces sell for.', cut: .85},
  {key: 'clear', from: 60, to: Infinity, title: 'Clear it', note: '60+ days. Cash beats a full rail. Cut it, bundle it or relist it fresh.', cut: .75}
];
function coachClock(item) {
  const since = [item.priceChangedAt, item.listedAt].filter(Boolean).sort().pop();
  return since ? Math.max(0, Math.round((Date.parse(todayUK()) - Date.parse(since)) / growDay)) : null;
}
function coachSuggestion(item, stage) {
  const price = Number.isFinite(item.price) ? item.price : null;
  const own = typeof priceGuide === 'function' ? priceGuide(item) : null;
  const community = communityPrice(item);
  const ref = own?.suggest ?? (community ? growRound(community.median) : null);
  const floor = Number.isFinite(item.cost) ? Math.ceil(item.cost) : 0;
  const tips = {
    nudge: 'Reshoot the cover photo in daylight, then send an offer to anyone who liked it.',
    drop: 'Drop the price, then send offers to likers so they get notified.',
    clear: 'Delete and relist it with new photos, or offer it as a bundle deal.'
  };
  if (price == null) return {target: ref, reason: ref ? 'No asking price saved. Similar pieces sell for about ' + gbp(ref) + '.' : 'No asking price saved yet.', tip: tips[stage.key], ref};
  let target = growRound(price * stage.cut);
  if (ref != null && ref < price) target = Math.min(target, Math.max(ref, growRound(price * (stage.key === 'clear' ? .6 : .75))));
  if (stage.key !== 'clear') target = Math.max(target, floor);
  target = Math.max(1, target);
  const reason = ref != null ? (ref < price ? 'Similar pieces sell for about ' + gbp(ref) + '.' : 'Your price is in line with similar sales (' + gbp(ref) + '), so focus on photos and offers.') : '';
  if (target >= price) return {target: null, reason: reason || 'Price is already low for what you paid.', tip: tips[stage.key], ref};
  const belowCost = Number.isFinite(item.cost) && target < item.cost;
  return {target, reason: (reason + (belowCost ? ' This is below what you paid, but it frees ' + gbp(target) + ' to buy better stock.' : '')).trim(), tip: tips[stage.key], ref};
}
function coachRows() {
  return db.items.filter(item => !item.deletedAt && item.status === 'In Stock' && stockWorkflow(item) === 'listed')
    .map(item => ({item, days: coachClock(item)})).filter(r => r.days != null && r.days >= 14)
    .map(r => ({...r, stage: COACH_STAGES.find(s => r.days >= s.from && r.days <= s.to)}))
    .map(r => ({...r, s: coachSuggestion(r.item, r.stage)})).sort((a, b) => b.days - a.days);
}
function repricingView() {
  if (!priceIndex) void loadPriceIndex()?.then(() => { if (tab === 'Repricing') render(); });
  const rows = coachRows();
  const unlisted = db.items.filter(i => !i.deletedAt && i.status === 'In Stock' && ['photos', 'ready'].includes(stockWorkflow(i)))
    .map(i => ({item: i, days: Math.round((Date.parse(todayUK()) - Date.parse(i.receivedAt || i.purchasedAt || todayUK())) / growDay)})).filter(r => r.days >= 14).sort((a, b) => b.days - a.days);
  const tied = rows.reduce((n, r) => n + (Number(r.item.cost) || 0), 0) + unlisted.reduce((n, r) => n + (Number(r.item.cost) || 0), 0);
  const asking = rows.reduce((n, r) => n + (Number(r.item.price) || 0), 0);
  const ro = isReadOnly();
  const card = r => '<article class="coach-item"><div class="coach-head"><button type="button" class="link" data-edit="' + esc(r.item.id) + '"><b>' + esc(r.item.name) + '</b></button>' +
    '<span class="coach-age">' + r.days + ' days</span></div>' +
    '<p class="coach-prices"><span>Now <b>' + (Number.isFinite(r.item.price) ? gbp(r.item.price) : 'no price') + '</b></span><span>Paid ' + gbp(r.item.cost || 0) + '</span>' + (r.s.target != null ? '<span class="coach-new">Try <b>' + gbp(r.s.target) + '</b></span>' : '') + '</p>' +
    (r.s.reason ? '<p class="coach-why">' + esc(r.s.reason) + '</p>' : '') + '<p class="coach-tip">' + esc(r.s.tip) + '</p>' +
    (ro ? '' : '<div class="coach-actions">' + (r.s.target != null ? '<button type="button" class="action" data-coach-price="' + esc(r.item.id) + '" data-price="' + r.s.target + '">Set ' + gbp(r.s.target) + '</button>' : '') +
      '<button type="button" class="secondary" data-coach-fresh="' + esc(r.item.id) + '">I refreshed it</button><button type="button" class="secondary" data-edit="' + esc(r.item.id) + '">Edit</button></div>') + '</article>';
  const groups = COACH_STAGES.map(stage => {
    const list = rows.filter(r => r.stage === stage), drops = list.filter(r => r.s.target != null);
    if (!list.length) return '';
    return '<section class="coach-group coach-' + stage.key + '"><header><div><h2>' + stage.title + ' <span class="daily-count">' + list.length + '</span></h2><p>' + stage.note + '</p></div>' +
      (!ro && drops.length > 1 ? '<button type="button" class="secondary" data-coach-all="' + stage.key + '">Apply all ' + drops.length + ' suggestions</button>' : '') + '</header>' +
      '<div class="coach-grid">' + list.map(card).join('') + '</div></section>';
  }).join('');
  return '<div class="metrics coach-metrics">' + metric('Cash tied up', gbp(tied), 'What you paid for stock sitting 14+ days', 'featured') +
    metric('Listings to fix', String(rows.length), 'Listed 14+ days since the last price change') + metric('Asking value', gbp(asking), 'Current prices on those listings') +
    metric('Not listed yet', String(unlisted.length), 'In stock 14+ days, not listed') + '</div>' +
    (unlisted.length ? '<section class="panel coach-unlisted"><h2>List these first</h2><p>Stock you can’t sell until it’s listed.</p>' + unlisted.slice(0, 8).map(r =>
      '<button type="button" class="daily-row" data-edit="' + esc(r.item.id) + '"><span><strong>' + esc(r.item.name) + '</strong><small>In stock ' + r.days + ' days · paid ' + gbp(r.item.cost || 0) + '</small></span><span aria-hidden="true">↗</span></button>').join('') +
      (unlisted.length > 8 ? '<p class="footnote">And ' + (unlisted.length - 8) + ' more in Stock → Ready to list.</p>' : '') + '</section>' : '') +
    (groups || '<section class="panel"><h2>Nothing stale</h2><p>Every listing has sold or changed price in the last 14 days. Nice.</p></section>') +
    '<p class="footnote">The clock restarts when you change the price or tap “I refreshed it”. Suggestions use your own sales first, then Stockroom-wide prices.</p>';
}
async function coachSave(change, message) {
  const next = cloneWorkspace(db);
  change(next);
  await persist(next);
  toast(message);
}

// ---------- Sourcing trips ----------
const SOURCE_KINDS = ['Charity shop', 'Car boot', 'Kilo sale', 'Wholesale', 'Online', 'Market', 'Other'];
const MILEAGE_RATE = .45; // HMRC approved mileage rate for cars, first 10,000 business miles
const runs = () => db.sourcingRuns || [];
function soldValue(item) {
  const t = lastTrade(db, item.id);
  if (t) return Math.max(0, (Number(t.amount) || 0) - (t.refunds || []).reduce((n, r) => n + (Number(r.amount) || 0), 0));
  return item.status === 'Sold' && Number.isFinite(item.sale) ? item.sale : null;
}
function runStats(list) {
  const ids = new Set(list.map(r => r.id));
  const items = db.items.filter(i => !i.deletedAt && ids.has(i.sourcingRunId));
  const sold = items.map(i => ({i, v: soldValue(i)})).filter(x => x.v != null);
  const goods = items.reduce((n, i) => n + (Number(i.cost) || 0), 0);
  const spend = list.reduce((n, r) => n + (r.spend ?? 0), 0) || goods;
  const miles = list.reduce((n, r) => n + (r.miles || 0), 0), minutes = list.reduce((n, r) => n + (r.minutes || 0), 0);
  const revenue = sold.reduce((n, x) => n + x.v, 0), soldCost = sold.reduce((n, x) => n + (Number(x.i.cost) || 0), 0);
  const travel = miles * MILEAGE_RATE, profit = revenue - soldCost - travel;
  const unsold = items.filter(i => i.status === 'In Stock');
  return {trips: list.length, items: items.length, sold: sold.length, spend, miles, minutes, revenue, profit, travel,
    perHour: minutes >= 15 && sold.length ? profit / (minutes / 60) : null, sellThrough: items.length ? sold.length / items.length : null,
    unsoldCost: unsold.reduce((n, i) => n + (Number(i.cost) || 0), 0)};
}
function sourcingView() {
  const list = runs().slice().sort((a, b) => b.date.localeCompare(a.date));
  const places = [...new Set(list.map(r => r.place.trim()))];
  const byPlace = places.map(p => ({place: p, kind: list.find(r => r.place.trim() === p).kind, ...runStats(list.filter(r => r.place.trim() === p))}))
    .sort((a, b) => (b.perHour ?? -1e9) - (a.perHour ?? -1e9) || b.profit - a.profit);
  const all = runStats(list), ro = isReadOnly();
  const linked = new Set(list.map(r => r.id)), unlinked = db.items.filter(i => !i.deletedAt && !linked.has(i.sourcingRunId)).length;
  const pct = v => v == null ? '–' : Math.round(v * 100) + '%';
  const head = '<div class="sourcing-bar">' + (ro ? '' : '<button type="button" class="action" data-run-new>＋ Log a sourcing trip</button>') + '</div>';
  if (!list.length) return head + '<section class="panel sourcing-empty"><h2>Which shops actually make you money?</h2><p>Log each charity shop, car boot or wholesale run with what you spent, the miles and the time. Link the pieces you bought. Stockroom then ranks every place by profit per hour, after travel at ' + Math.round(MILEAGE_RATE * 100) + 'p a mile.</p></section>';
  return head + '<div class="metrics">' + metric('Profit from trips', all.sold ? gbp(all.profit) : '–', all.sold ? 'Sold pieces, after cost and travel' : 'Shows once a linked piece sells', 'featured') + metric('Profit per hour', all.perHour != null ? gbp(all.perHour) : '–', all.minutes ? Math.round(all.minutes / 60 * 10) / 10 + ' hours sourcing' : 'Add time to your trips') +
    metric('Sell-through', pct(all.sellThrough), all.sold + ' of ' + all.items + ' linked pieces sold') + metric('Still to sell', gbp(all.unsoldCost), 'Cost of unsold pieces from trips') + '</div>' +
    '<section class="panel"><h2>Best places</h2><p>Ranked by profit per hour. Profit counts sold pieces only, minus what they cost and ' + Math.round(MILEAGE_RATE * 100) + 'p a mile.</p>' +
    table(['Place', 'Trips', 'Pieces', 'Sold', 'Spent', 'Profit', 'Per hour'], byPlace.map(p => '<tr><td><b>' + esc(p.place) + '</b><small class="muted"> · ' + esc(p.kind) + '</small></td><td>' + p.trips + '</td><td>' + p.items + '</td><td>' + pct(p.sellThrough) + '</td><td>' + gbp(p.spend) + '</td><td class="' + (p.profit >= 0 ? 'pos' : 'neg') + '">' + (p.sold ? gbp(p.profit) : '–') + '</td><td>' + (p.perHour != null ? gbp(p.perHour) : '–') + '</td></tr>').join('')) + '</section>' +
    '<section class="panel"><h2>Trips</h2>' + list.map(r => { const s = runStats([r]); return '<button type="button" class="daily-row" ' + (ro ? 'disabled' : 'data-run-edit="' + esc(r.id) + '"') + '><span><strong>' + esc(r.place) + ' · ' + esc(dateLabel(r.date)) + '</strong><small>' +
      [esc(r.kind), gbp(s.spend) + ' spent', s.items + ' piece' + (s.items === 1 ? '' : 's'), r.miles ? r.miles + ' mi' : '', r.minutes ? Math.round(r.minutes / 6) / 10 + ' h' : '', s.sold ? s.sold + ' sold · ' + gbp(s.profit) + ' profit' : ''].filter(Boolean).join(' · ') + '</small></span><span aria-hidden="true">›</span></button>'; }).join('') + '</section>' +
    (unlinked && !ro ? '<p class="footnote">' + unlinked + ' piece' + (unlinked === 1 ? ' isn’t' : 's aren’t') + ' linked to a trip. Open a trip to tick what you bought there, or set it in each item’s editor.</p>' : '');
}
function runDialog() {
  let d = document.getElementById('runDialog');
  if (d) return d;
  d = document.createElement('dialog'); d.id = 'runDialog'; d.className = 'run-dialog';
  document.body.appendChild(d);
  if (window.dialogPolyfill && !d.showModal) window.dialogPolyfill.registerDialog(d);
  return d;
}
function openRun(id) {
  const r = runs().find(x => x.id === id) || {id: '', place: '', kind: 'Charity shop', date: todayUK(), spend: null, miles: null, minutes: null, notes: ''};
  const near = (a, b) => Math.abs(Date.parse(a) - Date.parse(b)) <= 3 * growDay;
  const candidatesFor = date => db.items.filter(i => !i.deletedAt && ((r.id && i.sourcingRunId === r.id) || (!i.sourcingRunId && !i.bulkOrderId && (!i.purchasedAt || near(i.purchasedAt, date)))))
    .sort((a, b) => (b.sourcingRunId === r.id && !!r.id) - (a.sourcingRunId === r.id && !!r.id) || String(b.purchasedAt).localeCompare(String(a.purchasedAt))).slice(0, 80);
  const itemList = (date, checked) => { const list = candidatesFor(date); return list.length ? list.map(i => '<label class="run-item"><input type="checkbox" name="item" value="' + esc(i.id) + '"' + (checked.has(i.id) ? ' checked' : '') + '><span>' + esc(i.name) + '<small>' + [gbp(i.cost || 0), i.purchasedAt ? dateLabel(i.purchasedAt) : ''].filter(Boolean).join(' · ') + '</small></span></label>').join('') : '<p class="footnote">No unlinked stock bought around this date. Add the pieces first, then come back.</p>'; };
  const initial = new Set(r.id ? db.items.filter(i => i.sourcingRunId === r.id).map(i => i.id) : []);
  const places = [...new Set(runs().map(x => x.place))];
  const n = v => v == null ? '' : v;
  const d = runDialog();
  d.innerHTML = '<form id="runForm"><div class="sheet-heading"><div><span class="eyebrow">SOURCING TRIP</span><h2>' + (r.id ? 'Edit trip' : 'Log a trip') + '</h2></div><button type="button" class="close-panel" data-close-dialog="runDialog" aria-label="Close">×</button></div>' +
    '<label>Where<input name="place" required maxlength="150" list="runPlaces" value="' + esc(r.place) + '" placeholder="e.g. British Heart Foundation, Ringwood"><datalist id="runPlaces">' + places.map(p => '<option value="' + esc(p) + '">').join('') + '</datalist></label>' +
    '<div class="run-grid"><label>Type<select name="kind">' + SOURCE_KINDS.map(k => '<option' + (k === r.kind ? ' selected' : '') + '>' + k + '</option>').join('') + '</select></label>' +
    '<label>Date<input name="date" type="date" required max="' + todayUK() + '" value="' + esc(r.date) + '"></label>' +
    '<label>Spent (£)<input name="spend" type="number" inputmode="decimal" min="0" step=".01" value="' + n(r.spend) + '" placeholder="Optional"></label>' +
    '<label>Miles (round trip)<input name="miles" type="number" inputmode="decimal" min="0" step=".1" value="' + n(r.miles) + '"></label>' +
    '<label>Time (minutes)<input name="minutes" type="number" inputmode="numeric" min="0" step="5" value="' + n(r.minutes) + '"></label></div>' +
    '<label>Notes<textarea name="notes" rows="2" maxlength="2000" placeholder="What was good, what to skip next time">' + esc(r.notes || '') + '</textarea></label>' +
    '<fieldset class="run-items"><legend>What you bought here</legend><div id="runItems">' + itemList(r.date, initial) + '</div></fieldset>' +
    '<p class="footnote" id="runError" role="alert"></p><div class="run-actions"><button class="action" type="submit">Save trip</button>' + (r.id ? '<button type="button" class="secondary stock-delete" data-run-delete="' + esc(r.id) + '">Delete trip</button>' : '') + '</div></form>';
  const f = d.querySelector('#runForm');
  f.date.onchange = () => { const keep = new Set([...f.querySelectorAll('input[name=item]:checked')].map(x => x.value)); d.querySelector('#runItems').innerHTML = itemList(f.date.value || r.date, keep); };
  f.onsubmit = async e => {
    e.preventDefault();
    const num = v => v === '' ? null : Math.max(0, Number(v));
    const run = {id: r.id || newId(), place: f.place.value.trim(), kind: f.kind.value, date: f.date.value, spend: num(f.spend.value), miles: num(f.miles.value), minutes: num(f.minutes.value), notes: f.notes.value.trim()};
    if (!run.place) { d.querySelector('#runError').textContent = 'Add where you went.'; return; }
    const chosen = new Set([...f.querySelectorAll('input[name=item]:checked')].map(x => x.value));
    try {
      await coachSave(next => {
        next.sourcingRuns = (next.sourcingRuns || []).filter(x => x.id !== run.id).concat(run);
        for (const item of next.items) { if (chosen.has(item.id)) item.sourcingRunId = run.id; else if (item.sourcingRunId === run.id) item.sourcingRunId = ''; }
      }, 'Trip saved');
      d.close();
    } catch (error) { d.querySelector('#runError').textContent = error.message; }
  };
  typeof openPanel === 'function' ? openPanel(d) : d.showModal();
}
function fillSourcingSelect(item) {
  const select = form.elements.sourcingRunId;
  if (!select) return;
  const list = runs().slice().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 200);
  select.innerHTML = '<option value="">Not linked</option>' + list.map(r => '<option value="' + esc(r.id) + '">' + esc(r.place + ' · ' + dateLabel(r.date)) + '</option>').join('');
  select.value = item?.sourcingRunId && list.some(r => r.id === item.sourcingRunId) ? item.sourcingRunId : '';
  select.closest('label').hidden = !list.length;
}

// ---------- HMRC platform reporting tracker ----------
const REPORT_SALES = 30, REPORT_GROSS = 1700;
function reportingPlatforms(year = todayUK().slice(0, 4)) {
  const items = new Map(db.items.map(i => [i.id, i]));
  const platforms = new Map();
  const add = (platform, amount) => { const p = platforms.get(platform) || {sales: 0, gross: 0}; p.sales++; p.gross += amount; platforms.set(platform, p); };
  for (const t of db.trades || []) if (String(t.soldAt).startsWith(year)) add(items.get(t.itemId)?.platform || 'Vinted', Number(t.amount) || 0);
  const traded = new Set((db.trades || []).map(t => t.itemId));
  for (const i of db.items) if (!traded.has(i.id) && i.status === 'Sold' && Number.isFinite(i.sale) && String(i.soldAt || '').startsWith(year)) add(i.platform || 'Vinted', i.sale);
  for (const row of db.sales) if (String(row[4] || '').startsWith(year)) add('Vinted', Number(row[1]) || 0);
  if (!platforms.size) platforms.set('Vinted', {sales: 0, gross: 0});
  return platforms;
}
function reportingCard() {
  const year = todayUK().slice(0, 4), platforms = reportingPlatforms(year);
  const bar = (v, max) => '<span class="track"><span class="' + (v >= max ? 'hmrc-over' : 'green') + '" data-w="' + Math.min(100, Math.round(v / max * 100)) + '"></span></span>';
  const rows = [...platforms.entries()].sort((a, b) => b[1].sales - a[1].sales).map(([name, p]) => {
    const hit = p.sales >= REPORT_SALES || p.gross >= REPORT_GROSS;
    return '<div class="hmrc-row"><div class="hmrc-name"><b>' + esc(name) + '</b><span class="tag' + (hit ? ' pending' : '') + '">' + (hit ? 'Will be reported' : 'Under the limits') + '</span></div>' +
      '<div class="hmrc-meter"><small>' + p.sales + ' of ' + REPORT_SALES + ' sales</small>' + bar(p.sales, REPORT_SALES) + '</div>' +
      '<div class="hmrc-meter"><small>' + gbp(p.gross) + ' of ~' + gbp(REPORT_GROSS) + '</small>' + bar(p.gross, REPORT_GROSS) + '</div></div>';
  }).join('');
  return '<section class="panel hmrc-card"><h2>HMRC platform reporting · ' + year + '</h2><p>Selling platforms send HMRC your details once you make 30 sales or receive about £1,700 (€2,000) with them in a calendar year. Being reported isn’t a tax bill: tax depends on whether you’re trading, and the trading allowance below.</p>' + rows +
    '<p class="footnote">Counts sales recorded in Stockroom for ' + year + ', by each item’s selling platform. Not tax advice.</p></section>';
}

// ---------- Measurements from a photo ----------
function mountMeasure() {
  const input = form?.elements?.measurements;
  if (!input || document.getElementById('measureBtn')) return;
  const wrap = document.createElement('div');
  wrap.className = 'measure-tool';
  wrap.innerHTML = '<label class="secondary measure-btn" id="measureBtn">' + uiIcon('ruler', 16) + ' Measure from a photo<input type="file" accept="image/*" capture="environment" hidden></label><small id="measureNote">Lay the item flat with an A4 sheet next to it and shoot from straight above.</small>';
  input.closest('label').after(wrap);
  wrap.querySelector('input').onchange = async e => {
    const file = e.target.files[0]; e.target.value = '';
    if (!file) return;
    if (account?.plan !== 'pro') { openUpgrade('Measuring from a photo is part of Stockroom Pro.'); return; }
    const note = document.getElementById('measureNote'), btn = document.getElementById('measureBtn');
    btn.classList.add('is-busy'); note.textContent = 'Pip is measuring…';
    try {
      const image = await scanResize(file);
      const r = await api('/api/pip/measure', {method: 'POST', body: JSON.stringify({image, garment: form.elements.garment?.value || ''})});
      input.value = r.text; input.dispatchEvent(new Event('input', {bubbles: true}));
      note.textContent = 'Done · ' + r.confidence + ' confidence. Check with a tape if it’s close to a size boundary.' + (r.tip ? ' Tip: ' + r.tip : '');
    } catch (error) { note.textContent = error.message; }
    finally { btn.classList.remove('is-busy'); }
  };
}

// ---------- Depop and eBay versions of the listing ----------
function mountCrosslist() {
  const pane = document.getElementById('listingPane');
  if (!pane || document.getElementById('crosslist')) return;
  const box = document.createElement('details');
  box.className = 'listing-details crosslist'; box.id = 'crosslist';
  box.innerHTML = '<summary>Also selling on Depop or eBay?</summary><p class="footnote">Pip rewrites this listing in each platform’s style: short and tagged for Depop, keyword-rich with item specifics for eBay.</p>' +
    '<button type="button" class="action" id="crosslistGo"><span class="pw-spark" aria-hidden="true"></span>Write Depop &amp; eBay versions</button><p class="footnote" id="crosslistNote" role="status"></p><div id="crosslistOut"></div>';
  pane.querySelector('.listing-actions')?.after(box) || pane.appendChild(box);
  box.querySelector('#crosslistGo').onclick = async () => {
    if (account?.plan !== 'pro') { openUpgrade('Depop and eBay listings are part of Stockroom Pro.'); return; }
    const note = box.querySelector('#crosslistNote'), btn = box.querySelector('#crosslistGo');
    const f = form.elements, item = {};
    for (const k of ['brand', 'name', 'garment', 'size', 'color', 'condition', 'flaws', 'material', 'measurements', 'listingTitle', 'listingDescription']) item[k] = f[k]?.value || '';
    btn.disabled = true; note.textContent = 'Pip is writing…';
    try {
      const r = await api('/api/pip/crosslist', {method: 'POST', body: JSON.stringify({item})});
      const copy = (label, text) => '<div class="crosslist-block"><div class="crosslist-head"><b>' + label + '</b><button type="button" class="secondary" data-copy-text="' + esc(text) + '">Copy</button></div><pre>' + esc(text) + '</pre></div>';
      const specifics = Object.entries(r.ebay.specifics).map(([k, v]) => k + ': ' + v).join('\n');
      box.querySelector('#crosslistOut').innerHTML = '<h3>Depop</h3>' + copy('Description', r.depop.description + (r.depop.hashtags.length ? '\n\n' + r.depop.hashtags.join(' ') : '')) +
        '<h3>eBay</h3>' + copy('Title (' + r.ebay.title.length + '/80)', r.ebay.title) + copy('Description', r.ebay.description) + (specifics ? copy('Item specifics', specifics) : '');
      note.textContent = 'Check size, condition and flaws before you post.';
    } catch (error) { note.textContent = error.message; }
    finally { btn.disabled = false; }
  };
}

// ---------- Events ----------
document.addEventListener('click', async event => {
  const t = event.target;
  const copyBtn = t.closest('[data-copy-text]');
  if (copyBtn) { try { await navigator.clipboard.writeText(copyBtn.dataset.copyText); copyBtn.textContent = 'Copied'; setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500); } catch { toast('Couldn’t copy. Select the text instead.'); } return; }
  if (t.closest('[data-run-new]')) { openRun(''); return; }
  const runEdit = t.closest('[data-run-edit]');
  if (runEdit) { openRun(runEdit.dataset.runEdit); return; }
  const runDel = t.closest('[data-run-delete]');
  if (runDel) {
    const id = runDel.dataset.runDelete;
    if (runDel.dataset.confirm !== '1') { runDel.dataset.confirm = '1'; runDel.textContent = 'Tap again to delete'; return; }
    try { await coachSave(next => { next.sourcingRuns = (next.sourcingRuns || []).filter(r => r.id !== id); for (const i of next.items) if (i.sourcingRunId === id) i.sourcingRunId = ''; }, 'Trip deleted'); runDialog().close(); }
    catch (error) { toast(error.message); }
    return;
  }
  const setPrice = t.closest('[data-coach-price]');
  if (setPrice && !isReadOnly()) {
    const id = setPrice.dataset.coachPrice, price = Number(setPrice.dataset.price);
    try { await coachSave(next => { const i = next.items.find(x => x.id === id); if (i) Object.assign(i, {price, priceChangedAt: todayUK()}); }, 'Price set to ' + gbp(price) + '. Update it on Vinted too.'); }
    catch (error) { toast(error.message); }
    return;
  }
  const fresh = t.closest('[data-coach-fresh]');
  if (fresh && !isReadOnly()) {
    const id = fresh.dataset.coachFresh;
    try { await coachSave(next => { const i = next.items.find(x => x.id === id); if (i) i.priceChangedAt = todayUK(); }, 'Clock restarted for this listing.'); }
    catch (error) { toast(error.message); }
    return;
  }
  const all = t.closest('[data-coach-all]');
  if (all && !isReadOnly()) {
    if (all.dataset.confirm !== '1') { all.dataset.confirm = '1'; all.textContent = 'Tap again to confirm'; return; }
    const picks = new Map(coachRows().filter(r => r.stage.key === all.dataset.coachAll && r.s.target != null).map(r => [r.item.id, r.s.target]));
    try { await coachSave(next => { for (const i of next.items) if (picks.has(i.id)) Object.assign(i, {price: picks.get(i.id), priceChangedAt: todayUK()}); }, picks.size + ' prices updated. Update them on Vinted too.'); }
    catch (error) { toast(error.message); }
  }
});
// Mount editor tools once the page is ready, and load the price index in the background.
setTimeout(() => { mountMeasure(); mountCrosslist(); }, 0);
setTimeout(() => { if (typeof account !== 'undefined' && account) void loadPriceIndex(); }, 4000);
