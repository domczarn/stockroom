'use strict';
// Phone Home: a store-dashboard layout. Stats strip, glowing sales chart, a light activity sheet and Pip Pulse.

const phoneHome = () => matchMedia('(max-width: 800px)').matches;
let mhRange = (() => { try { return Number(localStorage.getItem('mh-range')) || 30; } catch { return 30; } })();
let mhPulse = 0;

// When a row happened, to the hour where we know it (sales recorded from Vinted emails or on the day).
// Older sales only have a date: they count at midday, or just before now if that's later than now.
function mhRowTime(r, now = Date.now()) {
  if (r.time) { const t = Date.parse(r.time); if (Number.isFinite(t)) return t; }
  if (!r.date) return NaN;
  return Math.min(Date.parse(r.date + 'T12:00:00Z'), now - 60000);
}
const mhHour = 36e5, mhDayMs = 864e5;
// Buckets for the chart: days for 7D/30D/90D, hours for 24H. Each knows its own revenue, profit and sales,
// and v is the running total so the line ends on the Sales figure above it.
function mhSeries(rows, days, endIso, now = Date.now()) {
  const sales = rows.filter(r => r.kind === 'Sale' || r.kind === 'Sale refund');
  let pts;
  if (days === 1) {
    const last = Math.floor(now / mhHour) * mhHour;
    pts = Array.from({length: 24}, (_, i) => ({from: last - (23 - i) * mhHour, to: last - (22 - i) * mhHour, hourly: true}));
    pts[23].to = now + 1;
    const start = now - 24 * mhHour;
    for (const p of pts) p.from = Math.max(p.from, start);
    for (const r of sales) { const t = mhRowTime(r, now); const p = pts.find(p => t >= p.from && t < p.to); if (p) (p.rows ||= []).push(r); }
  } else {
    const end = Date.parse(endIso + 'T00:00:00Z');
    pts = Array.from({length: days}, (_, i) => ({date: new Date(end - (days - 1 - i) * mhDayMs).toISOString().slice(0, 10)}));
    const index = new Map(pts.map((p, i) => [p.date, i]));
    for (const r of sales) { const i = index.get(r.date); if (i != null) (pts[i].rows ||= []).push(r); }
  }
  let run = 0;
  for (const p of pts) {
    const t = reportTotals(p.rows || []);
    p.rev = t.revenue; p.profit = t.profit; p.n = (p.rows || []).filter(r => r.kind === 'Sale').length;
    run += t.revenue; p.v = Math.round(run * 100) / 100;
    delete p.rows;
  }
  return pts;
}
const mhUk = (t, opts) => new Date(t).toLocaleString('en-GB', {timeZone: 'Europe/London', ...opts});
function mhPointLabel(p) {
  return p.hourly ? mhUk(p.from, {weekday: 'short', hour: '2-digit', minute: '2-digit'}) + '–' + mhUk(Math.min(p.to, p.from + mhHour), {hour: '2-digit', minute: '2-digit'})
    : new Date(p.date + 'T12:00:00Z').toLocaleDateString('en-GB', {weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC'});
}
let mhPoints = [];
function mhChart(points) {
  mhPoints = points;
  const W = 340, H = 150, top = 14, bottom = 128;
  const max = Math.max(10, ...points.map(p => p.v));
  const nice = max <= 50 ? Math.ceil(max / 10) * 10 : max <= 200 ? Math.ceil(max / 50) * 50 : Math.ceil(max / 100) * 100;
  const x = i => points.length < 2 ? W / 2 : i * W / (points.length - 1), y = v => bottom - (bottom - top) * v / nice;
  // Straight segments between points: honest, never overshoots, same shape at every range.
  const P = points.map((p, i) => [x(i), y(Math.max(0, p.v))]);
  const d = P.map((p, i) => (i ? ' L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('');
  const hourly = points[0]?.hourly;
  const label = p => hourly ? mhUk(p.from, {hour: '2-digit', minute: '2-digit'}) : new Date(p.date + 'T12:00:00Z').toLocaleDateString('en-GB', {day: 'numeric', month: 'short', timeZone: 'UTC'});
  const mid = points[Math.floor(points.length / 2)];
  return '<svg class="mh-chart" viewBox="-34 0 ' + (W + 40) + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="Total sales over the last ' + (hourly ? '24 hours' : points.length + ' days') + '. Touch and drag for each ' + (hourly ? 'hour' : 'day') + '.">' +
    '<defs><linearGradient id="mhLine" x1="0" x2="1"><stop offset="0" stop-color="#7f9dff"/><stop offset="1" stop-color="#b9a9ff"/></linearGradient><linearGradient id="mhFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#8fa6ff" stop-opacity=".28"/><stop offset="1" stop-color="#8fa6ff" stop-opacity="0"/></linearGradient>' +
    '<filter id="mhGlow" x="-10%" y="-30%" width="120%" height="160%"><feGaussianBlur stdDeviation="3.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>' +
    [nice, nice / 2, 0].map(v => '<line x1="0" x2="' + W + '" y1="' + y(v) + '" y2="' + y(v) + '" class="mh-grid"/><text x="-8" y="' + (y(v) + 3.5) + '" text-anchor="end" class="mh-axis">£' + (v >= 1000 ? (v / 1000) + 'k' : v) + '</text>').join('') +
    '<path d="' + d + ' L' + W + ' ' + bottom + ' L0 ' + bottom + 'Z" fill="url(#mhFill)" class="mh-area"/>' +
    '<path d="' + d + '" fill="none" stroke="url(#mhLine)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" filter="url(#mhGlow)" class="mh-line" pathLength="1"/>' +
    '<line class="mh-cursor" x1="0" x2="0" y1="' + top + '" y2="' + bottom + '" visibility="hidden"/><circle class="mh-dot" r="4.5" cx="0" cy="0" visibility="hidden"/>' +
    '<text x="0" y="' + (H - 2) + '" class="mh-axis">' + label(points[0]) + '</text><text x="' + W / 2 + '" y="' + (H - 2) + '" text-anchor="middle" class="mh-axis">' + label(mid) + '</text><text x="' + W + '" y="' + (H - 2) + '" text-anchor="end" class="mh-axis">' + (hourly ? 'Now' : 'Today') + '</text></svg>' +
    '<div class="mh-tip" role="status" hidden></div>';
}
// Touch (or hover) the chart: a line follows your finger with that hour or day's revenue, profit and sales.
(() => {
  let active = null;
  const show = (wrap, clientX) => {
    const svg = wrap.querySelector('.mh-chart'), tip = wrap.querySelector('.mh-tip');
    if (!svg || !tip || !mhPoints.length) return;
    const r = svg.getBoundingClientRect(), vbW = 380, W = 340, top = 14, bottom = 128;
    const fx = (clientX - r.left) / r.width * vbW - 34;
    const i = Math.max(0, Math.min(mhPoints.length - 1, Math.round(fx / (W / Math.max(1, mhPoints.length - 1)))));
    const p = mhPoints[i], max = Math.max(10, ...mhPoints.map(q => q.v));
    const nice = max <= 50 ? Math.ceil(max / 10) * 10 : max <= 200 ? Math.ceil(max / 50) * 50 : Math.ceil(max / 100) * 100;
    const x = mhPoints.length < 2 ? W / 2 : i * W / (mhPoints.length - 1), y = bottom - (bottom - top) * Math.max(0, p.v) / nice;
    const cur = svg.querySelector('.mh-cursor'), dot = svg.querySelector('.mh-dot');
    cur.setAttribute('x1', x); cur.setAttribute('x2', x); cur.setAttribute('visibility', 'visible');
    dot.setAttribute('cx', x); dot.setAttribute('cy', y); dot.setAttribute('visibility', 'visible');
    tip.innerHTML = '<b>' + esc(mhPointLabel(p)) + '</b><dl><div><dt><i class="rev"></i>Revenue</dt><dd>' + gbp(p.rev) + '</dd></div><div><dt><i class="pro"></i>Profit</dt><dd>' + gbp(p.profit) + '</dd></div><div><dt>Sales</dt><dd>' + p.n + '</dd></div><div class="run"><dt>Running total</dt><dd>' + gbp(p.v) + '</dd></div></dl>';
    tip.hidden = false;
    const left = r.left + (x + 34) / vbW * r.width - wrap.getBoundingClientRect().left;
    tip.style.setProperty('--x', Math.max(8, Math.min(wrap.clientWidth - tip.offsetWidth - 8, left - tip.offsetWidth / 2)) + 'px');
    tip.classList.toggle('on', true);
    if (active !== i && navigator.vibrate) try { navigator.vibrate(3); } catch {}
    active = i;
  };
  const hide = wrap => { const svg = wrap?.querySelector('.mh-chart'); wrap?.querySelector('.mh-tip')?.setAttribute('hidden', ''); svg?.querySelector('.mh-cursor')?.setAttribute('visibility', 'hidden'); svg?.querySelector('.mh-dot')?.setAttribute('visibility', 'hidden'); active = null; };
  document.addEventListener('pointerdown', e => { const wrap = e.target.closest('.mh-chart-wrap'); if (wrap) { wrap.setPointerCapture?.(e.pointerId); show(wrap, e.clientX); } });
  document.addEventListener('pointermove', e => { const wrap = e.target.closest('.mh-chart-wrap'); if (wrap && (e.pointerType === 'mouse' || e.buttons)) show(wrap, e.clientX); });
  document.addEventListener('pointerup', e => { const wrap = e.target.closest('.mh-chart-wrap'); if (wrap && e.pointerType !== 'mouse') setTimeout(() => hide(wrap), 1600); });
  // Only leaving the chart itself hides it (moving between its parts, or the press capturing the pointer, doesn't).
  document.addEventListener('pointerleave', e => { if (e.target?.classList?.contains('mh-chart-wrap') && e.pointerType === 'mouse' && !e.target.hasPointerCapture?.(e.pointerId)) hide(e.target); }, true);
})();
function mhPulses(today) {
  const out = [];
  const items = db.items.filter(i => !i.deletedAt);
  const shipping = items.filter(i => i.status === 'Sold').map(i => lastTrade(db, i.id)).filter(t => t && tradeStatus(t) === 'Sold' && saleRemaining(t) > 0);
  const due = typeof shipInfo === 'function' ? shipping.map(t => shipInfo(t, today)).filter(s => s.level === 'urgent').length : 0;
  if (due) out.push({title: due + ' parcel' + (due === 1 ? '' : 's') + ' must go out today', body: 'Vinted cancels orders that aren’t posted within <b>5 working days</b>. Get ' + (due === 1 ? 'it' : 'them') + ' to the drop-off before close.', cta: 'See what to post', act: 'data-mh-scroll="todo"'});
  const age = i => i.listedAt ? Math.round((Date.parse(today) - Date.parse([i.priceChangedAt, i.listedAt].filter(Boolean).sort().pop())) / 864e5) : 0;
  const stale = items.filter(i => i.status === 'In Stock' && i.listedAt && age(i) >= 30);
  if (stale.length) { const cash = stale.reduce((n, i) => n + (Number(i.cost) || 0), 0); out.push({title: 'Free up ' + gbp(cash) + ' sitting on the rail', body: '<b>' + stale.length + ' listing' + (stale.length === 1 ? ' has' : 's have') + '</b> gone 30+ days without a sale. Pip has a new price ready for each one.', cta: 'Open repricing coach', act: 'data-tab="Repricing"'}); }
  // Best brand by average profit, with how much is left in stock.
  const sold = items.filter(i => i.status === 'Sold' && Number.isFinite(i.sale) && i.brand);
  const brands = Object.values(sold.reduce((acc, i) => { const b = acc[i.brand] ||= {brand: i.brand, n: 0, profit: 0}; b.n++; b.profit += i.sale - (Number(i.cost) || 0); return acc; }, {}))
    .filter(b => b.n >= 3).map(b => ({...b, avg: b.profit / b.n, left: items.filter(i => i.status === 'In Stock' && i.brand === b.brand).length})).sort((a, b) => b.avg - a.avg);
  if (brands[0]) { const b = brands[0]; out.push({title: esc(b.brand) + ' is your money-maker', body: 'Your <b>' + esc(b.brand) + '</b> pieces make <b>' + gbp(b.avg) + '</b> profit each on average across ' + b.n + ' sales, and you have <b>' + b.left + '</b> left in stock. Snap the next one you see to check the price.', cta: 'Open Buy or pass', act: 'data-scan-open'}); }
  const unlisted = items.filter(i => i.status === 'In Stock' && !i.listedAt && i.receivedAt && (Date.parse(today) - Date.parse(i.receivedAt)) / 864e5 >= 7);
  if (unlisted.length) out.push({title: unlisted.length + ' piece' + (unlisted.length === 1 ? '' : 's') + ' ready but not listed', body: 'Stock can’t sell until it’s live. <b>Write with Pip</b> drafts each listing from the photo in seconds.', cta: 'Show unlisted stock', act: 'data-tab="Stock"'});
  if (!out.length) out.push({title: 'Snap your next find', body: 'At a charity shop or car boot? Point your camera at a piece and Pip tells you <b>what it sells for</b> and <b>the most to pay</b>.', cta: 'Open Buy or pass', act: 'data-scan-open'});
  return out;
}
// Phone and web share one chart range: 24H = 24H, 7D = 1W, 30D = 1M, 90D = 3M.
const MH_TO_RC = {1: '24H', 7: '1W', 30: '1M', 90: '3M'}, RC_TO_MH = {'24H': 1, '1W': 7, '1M': 30, '3M': 90};
function mobileHome() {
  if (typeof rc !== 'undefined' && RC_TO_MH[rc.range]) mhRange = RC_TO_MH[rc.range];
  const today = todayUK(), rows = accountingRows(db), day = 864e5, end = Date.parse(today + 'T00:00:00Z');
  const iso = t => new Date(t).toISOString().slice(0, 10);
  const inRange = (from, to) => rows.filter(r => r.date >= iso(from) && r.date <= iso(to));
  const nowMs = Date.now(), within = (from, to) => rows.filter(r => { const t = mhRowTime(r, nowMs); return t > from && t <= to; });
  // 24H uses each sale's time; 7D/30D/90D use whole days.
  const now = mhRange === 1 ? within(nowMs - day, nowMs) : inRange(end - (mhRange - 1) * day, end);
  const before = mhRange === 1 ? within(nowMs - 2 * day, nowMs - day) : inRange(end - (2 * mhRange - 1) * day, end - mhRange * day);
  // Home profit is profit on sales (sale price − item cost − sale costs). Business expenses like packaging
  // are dated when you bought them, so they made profit jump between 7D/30D/90D; they stay in Money → Reports.
  const onSales = saleRows;
  const tNow = reportTotals(onSales(now)), tBefore = reportTotals(onSales(before));
  const soldNow = now.filter(r => r.kind === 'Sale').length, soldBefore = before.filter(r => r.kind === 'Sale').length;
  const pct = (a, b) => b ? Math.round((a - b) / Math.abs(b) * 100) : null;
  // No green/red change percentages on Home: they read as noise on small numbers.
  const delta = () => '';
  const inStock = db.items.filter(i => !i.deletedAt && i.status === 'In Stock').length;
  const trades = db.trades || [];
  const owed = trades.filter(t => ['Sold', 'Posted', 'Completed'].includes(tradeStatus(t))).reduce((n, t) => n + saleRemaining(t), 0);
  const toPost = trades.filter(t => tradeStatus(t) === 'Sold' && saleRemaining(t) > 0).length;
  const hour = Number(new Intl.DateTimeFormat('en-GB', {timeZone: 'Europe/London', hour: 'numeric', hourCycle: 'h23'}).format(new Date()));
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const pulses = mhPulses(today), p = pulses[mhPulse % pulses.length];
  const ro = isReadOnly();
  return '<section class="mh">' +
    '<div class="mh-stats">' +
      '<div class="mh-stat"><small><i class="mh-live"></i>In stock</small><b>' + inStock + '</b></div>' +
      '<div class="mh-stat mh-main"><small>Sales</small><b>' + gbp(tNow.revenue) + '</b>' + delta(pct(tNow.revenue, tBefore.revenue)) + '</div>' +
      '<div class="mh-stat"><small>Profit on sales</small><b>' + gbp(tNow.profit) + '</b>' + delta(pct(tNow.profit, tBefore.profit)) + '</div>' +
      '<div class="mh-stat"><small>Sold</small><b>' + soldNow + '</b>' + delta(pct(soldNow, soldBefore)) + '</div>' +
    '</div>' +
    '<p class="mh-range-note">' + (mhRange === 1 ? 'Last 24 hours' : 'Last ' + mhRange + ' days') + '</p>' +
    '<div class="mh-chart-wrap">' + mhChart(mhSeries(rows, mhRange, today)) + '</div>' +
    '<div class="mh-pills"><div class="mh-range" role="group" aria-label="Chart range">' + [1, 7, 30, 90].map(r => '<button type="button" data-mh-range="' + r + '" aria-pressed="' + (r === mhRange) + '">' + (r === 1 ? '24H' : r + 'D') + '</button>').join('') + '</div>' +
      '<button type="button" class="mh-pill" data-tab="Reports"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h10l4 4v12H5z"/><path d="M9 13h6M9 17h4"/></svg>View report</button></div>' +
    '<div class="mh-sheet">' +
      '<h2>' + greeting + '! Here’s your activity</h2>' +
      '<div class="mh-tiles">' +
        '<button type="button" class="mh-tile" data-tab="Activity"><small>Money on the way</small><b>' + gbp(owed) + '</b><span aria-hidden="true">£</span></button>' +
        '<button type="button" class="mh-tile" data-mh-scroll="todo"><small>Parcels to post</small><b>' + toPost + '</b><span aria-hidden="true">📦</span></button>' +
      '</div>' +
      '<div class="mh-pulse"><div class="mh-pulse-head"><span class="mh-pulse-orb"></span>Pip’s tip' + (pulses.length > 1 ? '<span class="mh-dots">' + pulses.map((_, i) => '<i class="' + (i === mhPulse % pulses.length ? 'on' : '') + '"></i>').join('') + '</span>' : '') + '</div>' +
        '<div class="mh-pulse-body" ' + (pulses.length > 1 ? 'data-mh-next' : '') + '><h3>' + p.title + '</h3><p>' + p.body + '</p></div>' +
        '<button type="button" class="mh-pulse-cta" ' + p.act + '>' + p.cta + '<span aria-hidden="true">→</span></button></div>' +
      (ro ? '' : '<div class="mh-quick"><button type="button" data-scan-open><span>📷</span>Buy or pass</button><button type="button" data-shot-import><span>🖼️</span>Screenshots</button><button type="button" data-mh-add><span>＋</span>Add stock</button></div>') +
    '</div>' +
    '<button class="action" id="add" type="button" hidden>＋ Add stock</button>' +
  '</section>';
}
// Switching 24H/7D/30D/90D: only the numbers, the note and the chart change, smoothly. Nothing else is rebuilt.
function mhSwitchRange() {
  const home = document.querySelector('#view .mh');
  if (!home) { render(); return; }
  const tmp = document.createElement('div');
  tmp.innerHTML = mobileHome();
  const fresh = tmp.querySelector('.mh');
  home.querySelectorAll('.mh-stat b').forEach((el, i) => { const next = fresh.querySelectorAll('.mh-stat b')[i]?.textContent; if (next != null) { const before = el.textContent; el.textContent = next; srCountTo(el, before, next); } });
  const note = home.querySelector('.mh-range-note'); if (note) note.textContent = fresh.querySelector('.mh-range-note')?.textContent || '';
  home.querySelectorAll('[data-mh-range]').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.mhRange) === mhRange)));
  srSwap(home.querySelector('.mh-chart-wrap'), fresh.querySelector('.mh-chart-wrap').innerHTML, {line: '.mh-line', area: '.mh-area'});
}
function dashboardPhone() {
  return (isReadOnly() ? '' : '<section class="daily-actions" aria-labelledby="dailyActionTitle"><div class="daily-heading"><h2 id="dailyActionTitle">To do</h2></div><div class="daily-grid" id="dailyActionCards"></div></section>') + pipBrainView();
}
document.addEventListener('click', event => {
  const t = event.target;
  const range = t.closest('[data-mh-range]');
  if (range) { mhRange = Number(range.dataset.mhRange); try { localStorage.setItem('mh-range', String(mhRange)); } catch {} if (typeof rc !== 'undefined') { rc.range = MH_TO_RC[mhRange]; rc.grain = ''; rc.selected = -1; if (typeof rcSave === 'function') rcSave(); } mhSwitchRange(); return; }
  if (t.closest('[data-mh-next]')) { mhPulse++; render(); return; }
  if (t.closest('[data-mh-add]')) { openItem(null); return; }
  const scroll = t.closest('[data-mh-scroll]');
  if (scroll) document.querySelector('.daily-actions')?.scrollIntoView({behavior: 'smooth', block: 'start'});
});
// Header: Pip avatar on the left and the workspace name in a centre pill, on the phone Home only.
function mhHeader() {
  const header = document.querySelector('.app-header');
  if (!header) return;
  if (!header.querySelector('.mh-avatar')) {
    header.insertAdjacentHTML('afterbegin', '<button type="button" class="mh-avatar" data-tab="Profile" aria-label="Your profile"><img src="/favicon.svg" alt=""></button>');
    header.querySelector('.header-actions')?.insertAdjacentHTML('beforebegin', '<span class="mh-store"><img src="/favicon.svg" alt="">Stockroom</span>');
  }
  const on = typeof tab !== 'undefined' && tab === 'Dashboard' && phoneHome();
  document.body.classList.toggle('home-phone', on);
  const name = account?.role === 'admin' ? 'Dom’s stock' : (account?.email || 'Stockroom').split('@')[0].split(/[._-]/)[0] + '’s stock';
  header.querySelector('.mh-store').lastChild.textContent = name.charAt(0).toUpperCase() + name.slice(1);
}
if (typeof render === 'function') {
  onHook('afterRender', mhHeader);
  matchMedia('(max-width: 800px)').addEventListener?.('change', () => { if (typeof tab !== 'undefined' && tab === 'Dashboard') render(); });
}
