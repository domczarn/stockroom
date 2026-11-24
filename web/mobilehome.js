'use strict';
// Phone Home: a store-dashboard layout. Stats strip, glowing sales chart, a light activity sheet and Pip Pulse.

const phoneHome = () => matchMedia('(max-width: 800px)').matches;
let mhRange = (() => { try { return Number(localStorage.getItem('mh-range')) || 30; } catch { return 30; } })();
let mhPulse = 0;

function mhSeries(rows, days, endIso) {
  const end = Date.parse(endIso + 'T00:00:00Z'), day = 864e5;
  const pts = Array.from({length: days}, (_, i) => ({date: new Date(end - (days - 1 - i) * day).toISOString().slice(0, 10), v: 0}));
  const index = new Map(pts.map((p, i) => [p.date, i]));
  for (const r of rows) if (r.kind === 'Sale' || r.kind === 'Sale refund') { const i = index.get(r.date); if (i != null) pts[i].v += Number(r.revenue) || 0; }
  // Running total, so the line ends exactly on the Sales figure above it and 7D / 30D / 90D always agree.
  let run = 0;
  for (const p of pts) { run += p.v; p.v = Math.round(run * 100) / 100; }
  return pts;
}
function mhChart(points) {
  const W = 340, H = 150, top = 14, bottom = 128;
  const max = Math.max(10, ...points.map(p => p.v));
  const nice = max <= 50 ? Math.ceil(max / 10) * 10 : max <= 200 ? Math.ceil(max / 50) * 50 : Math.ceil(max / 100) * 100;
  const x = i => points.length < 2 ? W / 2 : i * W / (points.length - 1), y = v => bottom - (bottom - top) * v / nice;
  // Straight segments between days: honest, never overshoots, same shape at every range.
  const P = points.map((p, i) => [x(i), y(Math.max(0, p.v))]);
  const d = P.map((p, i) => (i ? ' L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('');
  const label = iso => new Date(iso + 'T12:00:00Z').toLocaleDateString('en-GB', {day: 'numeric', month: 'short', timeZone: 'UTC'});
  const mid = points[Math.floor(points.length / 2)];
  return '<svg class="mh-chart" viewBox="-34 0 ' + (W + 40) + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="Total sales over the last ' + points.length + ' days">' +
    '<defs><linearGradient id="mhLine" x1="0" x2="1"><stop offset="0" stop-color="#7f9dff"/><stop offset="1" stop-color="#b9a9ff"/></linearGradient><linearGradient id="mhFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#8fa6ff" stop-opacity=".28"/><stop offset="1" stop-color="#8fa6ff" stop-opacity="0"/></linearGradient>' +
    '<filter id="mhGlow" x="-10%" y="-30%" width="120%" height="160%"><feGaussianBlur stdDeviation="3.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>' +
    [nice, nice / 2, 0].map(v => '<line x1="0" x2="' + W + '" y1="' + y(v) + '" y2="' + y(v) + '" class="mh-grid"/><text x="-8" y="' + (y(v) + 3.5) + '" text-anchor="end" class="mh-axis">£' + (v >= 1000 ? (v / 1000) + 'k' : v) + '</text>').join('') +
    '<path d="' + d + ' L' + W + ' ' + bottom + ' L0 ' + bottom + 'Z" fill="url(#mhFill)" class="mh-area"/>' +
    '<path d="' + d + '" fill="none" stroke="url(#mhLine)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" filter="url(#mhGlow)" class="mh-line" pathLength="1"/>' +
    '<text x="0" y="' + (H - 2) + '" class="mh-axis">' + label(points[0].date) + '</text><text x="' + W / 2 + '" y="' + (H - 2) + '" text-anchor="middle" class="mh-axis">' + label(mid.date) + '</text><text x="' + W + '" y="' + (H - 2) + '" text-anchor="end" class="mh-axis">Today</text></svg>';
}
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
function mobileHome() {
  const today = todayUK(), rows = accountingRows(db), day = 864e5, end = Date.parse(today + 'T00:00:00Z');
  const iso = t => new Date(t).toISOString().slice(0, 10);
  const inRange = (from, to) => rows.filter(r => r.date >= iso(from) && r.date <= iso(to));
  const now = inRange(end - (mhRange - 1) * day, end), before = inRange(end - (2 * mhRange - 1) * day, end - mhRange * day);
  const tNow = reportTotals(now), tBefore = reportTotals(before);
  const soldNow = now.filter(r => r.kind === 'Sale').length, soldBefore = before.filter(r => r.kind === 'Sale').length;
  const pct = (a, b) => b ? Math.round((a - b) / Math.abs(b) * 100) : null;
  const delta = v => v == null ? '' : '<span class="mh-delta ' + (v >= 0 ? 'up' : 'down') + '">' + (v >= 0 ? '+' : '') + v + '%</span>';
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
      '<div class="mh-stat"><small>Profit</small><b>' + gbp(tNow.profit) + '</b>' + delta(pct(tNow.profit, tBefore.profit)) + '</div>' +
      '<div class="mh-stat"><small>Sold</small><b>' + soldNow + '</b>' + delta(pct(soldNow, soldBefore)) + '</div>' +
    '</div>' +
    '<p class="mh-range-note">Last ' + mhRange + ' days · % vs the ' + mhRange + ' days before</p>' +
    '<div class="mh-chart-wrap">' + mhChart(mhSeries(rows, mhRange, today)) + '</div>' +
    '<div class="mh-pills"><div class="mh-range" role="group" aria-label="Chart range">' + [7, 30, 90].map(r => '<button type="button" data-mh-range="' + r + '" aria-pressed="' + (r === mhRange) + '">' + r + 'D</button>').join('') + '</div>' +
      '<button type="button" class="mh-pill" data-tab="Reports"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h10l4 4v12H5z"/><path d="M9 13h6M9 17h4"/></svg>View report</button></div>' +
    '<div class="mh-sheet">' +
      '<h2>' + greeting + '! Here’s your activity</h2>' +
      '<div class="mh-tiles">' +
        '<button type="button" class="mh-tile" data-tab="Activity"><small>Money on the way</small><b>' + gbp(owed) + '</b><span aria-hidden="true">£</span></button>' +
        '<button type="button" class="mh-tile" data-mh-scroll="todo"><small>Parcels to post</small><b>' + toPost + '</b><span aria-hidden="true">📦</span></button>' +
      '</div>' +
      '<div class="mh-pulse"><div class="mh-pulse-head"><span class="mh-pulse-orb"></span>Pip Pulse' + (pulses.length > 1 ? '<span class="mh-dots">' + pulses.map((_, i) => '<i class="' + (i === mhPulse % pulses.length ? 'on' : '') + '"></i>').join('') + '</span>' : '') + '</div>' +
        '<div class="mh-pulse-body" ' + (pulses.length > 1 ? 'data-mh-next' : '') + '><h3>' + p.title + '</h3><p>' + p.body + '</p></div>' +
        '<button type="button" class="mh-pulse-cta" ' + p.act + '>' + p.cta + '<span aria-hidden="true">→</span></button></div>' +
      (ro ? '' : '<div class="mh-quick"><button type="button" data-scan-open><span>📷</span>Buy or pass</button><button type="button" data-shot-import><span>🖼️</span>Screenshots</button><button type="button" data-mh-add><span>＋</span>Add stock</button></div>') +
    '</div>' +
    '<button class="action" id="add" type="button" hidden>＋ Add stock</button>' +
  '</section>';
}
function dashboardPhone() {
  return (isReadOnly() ? '' : '<section class="daily-actions" aria-labelledby="dailyActionTitle"><div class="daily-heading"><h2 id="dailyActionTitle">To do</h2></div><div class="daily-grid" id="dailyActionCards"></div></section>') + pipBrainView();
}
document.addEventListener('click', event => {
  const t = event.target;
  const range = t.closest('[data-mh-range]');
  if (range) { mhRange = Number(range.dataset.mhRange); try { localStorage.setItem('mh-range', String(mhRange)); } catch {} render(); return; }
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
  const baseRenderMh = render;
  // eslint-disable-next-line no-global-assign
  render = function (...args) { const out = baseRenderMh.apply(this, args); mhHeader(); return out; };
  matchMedia('(max-width: 800px)').addEventListener?.('change', () => { if (typeof tab !== 'undefined' && tab === 'Dashboard') render(); });
}
