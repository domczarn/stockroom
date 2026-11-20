'use strict';
// Performance: what's working. Every bought piece, how it sold, how fast, and what earns.
// Replaces insightsView() (tab id stays 'Buying insights'; shown as "Performance").

const pf = {range: 'all', dim: 'brand', sort: 'profit'};
try { Object.assign(pf, JSON.parse(localStorage.getItem('stockroom-performance') || '{}')); } catch {}
const pfSave = () => { try { localStorage.setItem('stockroom-performance', JSON.stringify(pf)); } catch {} };

const PF_RANGES = [['30', '30 days'], ['90', '90 days'], ['365', '1 year'], ['all', 'All time']];
const PF_DIMS = [['brand', 'Brand'], ['type', 'Item type'], ['delivery', 'Delivery'], ['band', 'Buy price'], ['size', 'Size'], ['month', 'Month bought']];
const PF_BANDS = [[0, 5, 'Under £5'], [5, 10, '£5–10'], [10, 20, '£10–20'], [20, 30, '£20–30'], [30, Infinity, '£30+']];
const pfDay = 86400000;
const pfDays = (from, to) => from && to ? Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / pfDay)) : null;
const pfMedian = list => { const s = list.filter(v => v !== null).sort((a, b) => a - b); if (!s.length) return null; const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const pfAvg = list => { const s = list.filter(v => v !== null && Number.isFinite(v)); return s.length ? s.reduce((a, b) => a + b, 0) / s.length : null; };
const pfTitle = text => String(text || '').trim().replace(/\s+/g, ' ').toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());

// One row per piece you bought.
function pfPieces() {
  const today = todayUK();
  const trades = db.trades || [];
  return db.items.filter(item => !item.deletedAt).map(item => {
    const facts = typeof listingFacts === 'function' ? listingFacts(item) : {};
    const trade = trades.filter(t => t.itemId === item.id).at(-1);
    const refunded = trade ? trade.refunds.reduce((n, r) => n + (r.amount || 0), 0) : 0;
    const returned = trade && trade.refunds.at(-1)?.restock;
    let state = 'unsold', revenue = null, soldAt = null, listedAt = item.listedAt || trade?.listedAt || null;
    if (item.status === 'Refunded' || item.status === 'Refund pending') state = 'cancelled';
    else if (trade && !returned) { state = 'sold'; revenue = pounds(cents(trade.amount) - cents(refunded)); soldAt = trade.soldAt; }
    else if (item.status === 'Sold' && Number.isFinite(item.sale)) { state = 'sold'; revenue = item.sale; soldAt = item.soldAt || null; }
    const cost = Number.isFinite(item.cost) ? item.cost : null;
    const profit = state === 'sold' && cost !== null ? pounds(cents(revenue) - cents(cost)) : state === 'cancelled' && Number.isFinite(item.refund) && cost !== null ? -pounds(cents(cost) - cents(item.refund)) : null;
    const boughtAt = item.purchasedAt ? String(item.purchasedAt).slice(0, 10) : null;
    const band = cost === null ? 'Unknown' : PF_BANDS.find(([lo, hi]) => cost >= lo && cost < hi)[2];
    return {
      item, state, cost, revenue, profit, boughtAt, soldAt, listedAt,
      roi: profit !== null && cost > 0 && state === 'sold' ? profit / cost : null,
      daysToSell: state === 'sold' ? pfDays(boughtAt, soldAt) : null,
      daysListed: state === 'sold' && listedAt && soldAt && listedAt <= soldAt ? pfDays(listedAt, soldAt) : null,
      age: state === 'unsold' ? pfDays(item.receivedAt || boughtAt, today) : null,
      listedAge: state === 'unsold' && listedAt ? pfDays(listedAt, today) : null,
      keys: {
        brand: pfTitle(item.brand) || 'No brand',
        type: pfTitle(item.garment || facts.garment) || 'Other',
        band,
        size: String(item.size || facts.size || '').trim().toUpperCase() || 'Unknown',
        month: boughtAt ? boughtAt.slice(0, 7) : 'Unknown',
        delivery: item.bulkOrderId && typeof orderSource === 'function' ? (orderSource(item) || 'Bulk order') : 'Single buys'
      }
    };
  });
}

function pfGroupStats(list) {
  const sold = list.filter(p => p.state === 'sold'), unsold = list.filter(p => p.state === 'unsold');
  const decided = list.filter(p => p.state !== 'cancelled');
  const profits = sold.map(p => p.profit).filter(v => v !== null);
  const spent = sold.reduce((n, p) => n + (p.cost || 0), 0);
  return {
    bought: list.length, sold: sold.length, unsold: unsold.length, cancelled: list.length - decided.length,
    sellThrough: decided.length ? sold.length / decided.length : null,
    avgProfit: pfAvg(profits), totalProfit: profits.reduce((a, b) => a + b, 0),
    roi: spent > 0 ? profits.reduce((a, b) => a + b, 0) / spent : null,
    days: pfMedian(sold.map(p => p.daysToSell)), avgBuy: pfAvg(list.map(p => p.cost)), avgSale: pfAvg(sold.map(p => p.revenue)),
    tiedUp: unsold.reduce((n, p) => n + (p.cost || 0), 0),
    ...pfWinner(list, sold, decided, profits, spent)
  };
}

// Winning category test: sells quickly, good margin per piece, in profit before half has sold.
const PF_FAST_DAYS = 14, PF_MIN_ROI = 0.5, PF_MIN_PROFIT = 5;
function pfWinner(list, sold, decided, profits, spent) {
  const totalCost = decided.reduce((n, p) => n + (p.cost || 0), 0);
  const ordered = [...sold].sort((a, b) => String(a.soldAt || '').localeCompare(String(b.soldAt || '')));
  let cum = 0, paidAt = null;
  ordered.forEach((p, i) => { cum += p.revenue || 0; if (paidAt === null && cum >= totalCost) paidAt = i + 1; });
  const recovered = totalCost > 0 ? Math.min(1, ordered.reduce((n, p) => n + (p.revenue || 0), 0) / totalCost) : (sold.length ? 1 : null);
  const days = pfMedian(sold.map(p => p.daysToSell)), avgProfit = pfAvg(profits), roi = spent > 0 ? profits.reduce((a, b) => a + b, 0) / spent : null;
  const enough = sold.length >= 2;
  const fast = enough && days !== null && days <= PF_FAST_DAYS;
  const margin = enough && avgProfit !== null && avgProfit >= PF_MIN_PROFIT && (roi === null ? spent === 0 : roi >= PF_MIN_ROI);
  const paidEarly = paidAt !== null && decided.length > 0 && paidAt / decided.length <= 0.5;
  return {fast, margin, paidEarly, paidAt, paidShare: paidAt !== null && decided.length ? paidAt / decided.length : null, recovered,
    signs: [fast, margin, paidEarly].filter(Boolean).length, enough, inProfit: recovered !== null && recovered >= 1};
}
function pfBadge(s) {
  if (!s.enough && !s.paidEarly) return '<span class="pf-badge muted">Too early</span>';
  const dots = [['Fast', s.fast], ['Margin', s.margin], ['Paid back early', s.paidEarly]].map(([l, ok]) => '<i class="' + (ok ? 'ok' : '') + '" title="' + l + (ok ? ' ✓' : ' ✗') + '"></i>').join('');
  const label = s.signs === 3 ? 'Winner' : s.signs === 2 ? 'Promising' : s.inProfit ? 'Slow earner' : 'Not yet';
  return '<span class="pf-badge s' + s.signs + '"><span class="pf-dots">' + dots + '</span>' + label + '</span>';
}
function pfPaid(s) {
  if (s.paidAt !== null) return 'After ' + s.paidAt + ' sold <small>' + pfPct(s.paidShare) + ' of pieces</small>';
  return s.recovered === null ? '—' : pfPct(s.recovered) + ' back <small>not paid off yet</small>';
}

function pfInRange(pieces) {
  if (pf.range === 'all') return pieces;
  const from = new Date(Date.parse(todayUK()) - (Number(pf.range) - 1) * pfDay).toISOString().slice(0, 10);
  return pieces.filter(p => p.boughtAt && p.boughtAt >= from);
}

const pfMoney = v => v === null ? '—' : gbp(v);
const pfPct = v => v === null ? '—' : Math.round(v * 100) + '%';
const pfDaysLabel = v => v === null ? '—' : Math.round(v) + (Math.round(v) === 1 ? ' day' : ' days');

function pfVerdicts(pieces, groups) {
  const out = [];
  const all = pfGroupStats(pieces);
  const solid = groups.filter(g => g.stats.sold >= 2);
  const dimWord = PF_DIMS.find(([k]) => k === pf.dim)[1].toLowerCase();
  if (all.sold) out.push({tone: 'info', title: 'You make ' + pfMoney(all.avgProfit) + ' per piece sold', body: 'Median ' + pfDaysLabel(all.days) + ' from buying to selling, ' + pfPct(all.roi) + ' return on what you paid.'});
  const winners = groups.filter(g => g.stats.signs === 3);
  if (winners.length) out.push({tone: 'go', title: 'Winning ' + (winners.length === 1 ? dimWord + ': ' + winners[0].name : dimWord + 's: ' + winners.slice(0, 3).map(g => g.name).join(', ')),
    body: 'Sells within ' + PF_FAST_DAYS + ' days, good margin per piece, and paid for itself before half had sold. Buy more of ' + (winners.length === 1 ? 'it' : 'these') + '.'});
  const priced = groups.filter(g => g.stats.bought >= 3 && !g.stats.inProfit && g.stats.sold >= 1 && g.stats.fast)[0];
  if (priced) out.push({tone: 'info', title: priced.name + ' sells fast but isn’t profitable yet', body: 'It may still be a winner at a higher price. Try listing the rest higher and watch if it still sells.'});
  const best = [...solid].sort((a, b) => b.stats.avgProfit - a.stats.avgProfit)[0];
  if (best && best.stats.avgProfit > 0 && !winners.includes(best)) out.push({tone: 'go', title: 'Buy more: ' + best.name, body: pfMoney(best.stats.avgProfit) + ' average profit across ' + best.stats.sold + ' sales' + (best.stats.days !== null ? ', sells in about ' + pfDaysLabel(best.stats.days) : '') + '.'});
  const fastest = [...solid].filter(g => g.stats.days !== null && g !== best && !winners.includes(g)).sort((a, b) => a.stats.days - b.stats.days)[0];
  if (fastest) out.push({tone: 'go', title: 'Fastest seller: ' + fastest.name, body: 'Median ' + pfDaysLabel(fastest.stats.days) + ' to sell, ' + pfMoney(fastest.stats.avgProfit) + ' each.'});
  const weak = groups.filter(g => g.stats.bought >= 3 && ((g.stats.sellThrough !== null && g.stats.sellThrough < 0.34) || (g.stats.sold >= 2 && g.stats.avgProfit < 3)))
    .sort((a, b) => (a.stats.avgProfit ?? 0) - (b.stats.avgProfit ?? 0))[0];
  if (weak) out.push({tone: 'warn', title: 'Go easy on ' + weak.name, body: weak.stats.sold + ' of ' + (weak.stats.bought - weak.stats.cancelled) + ' sold' + (weak.stats.avgProfit !== null ? ', ' + pfMoney(weak.stats.avgProfit) + ' average profit' : '') + (weak.stats.tiedUp ? ', ' + pfMoney(weak.stats.tiedUp) + ' still tied up' : '') + '.'});
  const bands = PF_BANDS.map(([, , label]) => ({label, s: pfGroupStats(pieces.filter(p => p.keys.band === label))})).filter(b => b.s.sold >= 2 && b.s.roi !== null);
  if (bands.length >= 2) {
    const top = [...bands].sort((a, b) => b.s.roi - a.s.roi)[0];
    out.push({tone: 'info', title: 'Best buy price: ' + top.label, body: 'Pieces bought at ' + top.label + ' return ' + pfPct(top.s.roi) + ' on cost, the best of any price range.'});
  }
  const stale = pieces.filter(p => p.state === 'unsold' && (p.listedAge ?? p.age ?? 0) >= 30);
  if (stale.length) out.push({tone: 'warn', title: stale.length + ' slow mover' + (stale.length === 1 ? '' : 's') + ' (30+ days)', body: pfMoney(stale.reduce((n, p) => n + (p.cost || 0), 0)) + ' tied up. Drop the price or bundle them.'});
  if (!solid.length && all.sold) out.push({tone: 'info', title: 'Needs more sales to compare', body: 'Pip compares each ' + dimWord + ' once it has 2 or more sales.'});
  return out.slice(0, 5);
}

function pfSpeedChart(pieces) {
  const sold = pieces.filter(p => p.state === 'sold' && p.daysToSell !== null);
  const buckets = [['0–3', 0, 3], ['4–7', 4, 7], ['8–14', 8, 14], ['15–30', 15, 30], ['31–60', 31, 60], ['60+', 61, Infinity]]
    .map(([label, lo, hi]) => ({label, count: sold.filter(p => p.daysToSell >= lo && p.daysToSell <= hi).length,
      profit: pfAvg(sold.filter(p => p.daysToSell >= lo && p.daysToSell <= hi).map(p => p.profit))}));
  const max = Math.max(1, ...buckets.map(b => b.count));
  return '<section class="pf-card"><header><h3>How quickly things sell</h3><small>Days from buying to selling · ' + sold.length + ' sold</small></header>' +
    (sold.length ? '<div class="pf-speed">' + buckets.map(b => '<div class="pf-speed-col" title="' + b.count + ' sold in ' + b.label + ' days' + (b.profit !== null ? ', ' + gbp(b.profit) + ' avg profit' : '') + '">' +
      '<span class="pf-speed-n">' + (b.count || '') + '</span><div class="pf-speed-track"><i class="pf-h' + Math.round(100 * b.count / max / 5) * 5 + '"></i></div>' +
      '<span class="pf-speed-l">' + b.label + '</span><span class="pf-speed-p">' + (b.profit !== null ? gbp(b.profit) : '') + '</span></div>').join('') + '</div>' +
      '<p class="pf-foot">Bottom row: average profit for pieces that sold that fast.</p>'
      : '<p class="pf-empty">No sales yet in this range.</p>') + '</section>';
}

function pfRankList(title, sub, list, kind) {
  return '<section class="pf-card"><header><h3>' + title + '</h3><small>' + sub + '</small></header>' + (list.length ? '<ol class="pf-rank">' + list.map(p =>
    '<li><button type="button" data-edit="' + esc(p.item.id) + '"><span class="pf-rank-name">' + esc(p.item.name) + '<small>' + esc(p.keys.brand) + ' · bought ' + pfMoney(p.cost) +
    (kind === 'stale' ? ' · ' + pfDaysLabel(p.listedAge ?? p.age) + (p.listedAge !== null ? ' listed' : ' in stock') : ' · sold ' + pfMoney(p.revenue) + (p.daysToSell !== null ? ' in ' + pfDaysLabel(p.daysToSell) : '')) + '</small></span>' +
    '<strong class="' + (kind === 'stale' ? '' : p.profit >= 0 ? 'pos' : 'neg') + '">' + (kind === 'stale' ? pfMoney(p.cost) : (p.profit >= 0 ? '+' : '') + pfMoney(p.profit)) + '</strong></button></li>').join('') + '</ol>'
    : '<p class="pf-empty">Nothing here yet.</p>') + '</section>';
}

// eslint-disable-next-line no-global-assign
insightsView = function performanceView() {
  const pieces = pfInRange(pfPieces());
  const all = pfGroupStats(pieces);
  const keyed = new Map();
  for (const p of pieces) { const k = p.keys[pf.dim]; if (!keyed.has(k)) keyed.set(k, []); keyed.get(k).push(p); }
  const sorters = {
    profit: (a, b) => (b.stats.avgProfit ?? -1e9) - (a.stats.avgProfit ?? -1e9), total: (a, b) => b.stats.totalProfit - a.stats.totalProfit,
    bought: (a, b) => b.stats.bought - a.stats.bought, through: (a, b) => (b.stats.sellThrough ?? -1) - (a.stats.sellThrough ?? -1),
    roi: (a, b) => (b.stats.roi ?? -1e9) - (a.stats.roi ?? -1e9), signs: (a, b) => b.stats.signs - a.stats.signs || (b.stats.avgProfit ?? -1e9) - (a.stats.avgProfit ?? -1e9), days: (a, b) => (a.stats.days ?? 1e9) - (b.stats.days ?? 1e9)
  };
  let groups = [...keyed].map(([name, list]) => ({name, stats: pfGroupStats(list)}));
  if (pf.dim === 'month') groups.sort((a, b) => b.name.localeCompare(a.name)); else groups.sort(sorters[pf.sort] || sorters.profit);
  if (pf.dim === 'band') groups.sort((a, b) => PF_BANDS.findIndex(x => x[2] === a.name) - PF_BANDS.findIndex(x => x[2] === b.name));
  const monthLabel = key => /^\d{4}-\d{2}$/.test(key) ? new Intl.DateTimeFormat('en-GB', {month: 'short', year: 'numeric', timeZone: 'UTC'}).format(Date.parse(key + '-01')) : key;
  const kpi = (label, value, sub) => '<div class="pf-kpi"><span>' + label + '</span><strong>' + value + '</strong><small>' + sub + '</small></div>';
  const head = (key, label) => '<th><button type="button" data-pf-sort="' + key + '" aria-pressed="' + (pf.sort === key) + '">' + label + (pf.sort === key ? ' ↓' : '') + '</button></th>';
  const sold = pieces.filter(p => p.state === 'sold' && p.profit !== null);
  const best = [...sold].sort((a, b) => b.profit - a.profit).slice(0, 5);
  const worst = [...sold].sort((a, b) => a.profit - b.profit).filter(p => !best.includes(p)).slice(0, 5);
  const stale = pieces.filter(p => p.state === 'unsold').sort((a, b) => (b.listedAge ?? b.age ?? 0) - (a.listedAge ?? a.age ?? 0)).slice(0, 6);
  const verdicts = pfVerdicts(pieces, groups);
  return '<section class="pf">' +
    '<div class="pf-top"><p class="pf-sub">Pieces bought ' + (pf.range === 'all' ? 'since you started' : 'in the last ' + PF_RANGES.find(([k]) => k === pf.range)[1]) + '</p>' +
      '<div class="rc-ranges" role="group" aria-label="Bought in">' + PF_RANGES.map(([k, l]) => '<button type="button" data-pf-range="' + k + '" aria-pressed="' + (pf.range === k) + '">' + l + '</button>').join('') + '</div></div>' +
    '<div class="pf-kpis">' +
      kpi('Pieces bought', all.bought, pfMoney(all.avgBuy) + ' average buy') +
      kpi('Sold', all.sold + ' <em>' + pfPct(all.sellThrough) + '</em>', 'sell-through' + (all.cancelled ? ' · ' + all.cancelled + ' cancelled' : '')) +
      kpi('Profit per piece', pfMoney(all.avgProfit), pfMoney(all.totalProfit) + ' from sales') +
      kpi('Return on cost', pfPct(all.roi), 'profit ÷ what you paid') +
      kpi('Time to sell', pfDaysLabel(all.days), 'median, bought → sold') +
      kpi('Still in stock', all.unsold, pfMoney(all.tiedUp) + ' tied up') +
    '</div>' +
    (verdicts.length ? '<div class="pf-verdicts"><div class="pf-verdict-head"><span class="pu-pip" aria-hidden="true"></span><strong>Pip’s verdict</strong></div>' + verdicts.map(v => '<div class="pf-verdict ' + v.tone + '"><strong>' + esc(v.title) + '</strong><span>' + esc(v.body) + '</span></div>').join('') + '</div>' : '') +
    '<section class="pf-card pf-break"><header><div><h3>Breakdown</h3><small>Compare by</small></div><div class="rc-grains pf-dims" role="group" aria-label="Compare by">' +
      PF_DIMS.map(([k, l]) => '<button type="button" data-pf-dim="' + k + '" aria-pressed="' + (pf.dim === k) + '">' + l + '</button>').join('') + '</div></header>' +
      (groups.length ? '<div class="pf-table-wrap"><table class="pf-table"><thead><tr><th>' + PF_DIMS.find(([k]) => k === pf.dim)[1] + '</th>' + head('bought', 'Bought') + head('through', 'Sold') + head('profit', 'Profit / piece') + head('roi', 'ROI') + head('days', 'Days to sell') + head('total', 'Total profit') + head('signs', 'Winner?') + '<th>Paid back</th><th>Unsold</th></tr></thead><tbody>' +
        groups.map(g => { const s = g.stats; return '<tr><th scope="row">' + esc(pf.dim === 'month' ? monthLabel(g.name) : g.name) + (s.sold && s.sold < 2 ? '<small>1 sale, early signal</small>' : '') + '</th>' +
          '<td data-l="Bought">' + s.bought + '</td>' +
          '<td data-l="Sold"><span class="pf-through"><span>' + s.sold + ' · ' + pfPct(s.sellThrough) + '</span><i><b class="pf-w' + Math.round((s.sellThrough || 0) * 20) * 5 + '"></b></i></span></td>' +
          '<td data-l="Profit / piece" class="' + (s.avgProfit === null ? '' : s.avgProfit >= 0 ? 'pos' : 'neg') + '">' + pfMoney(s.avgProfit) + '</td>' +
          '<td data-l="ROI">' + pfPct(s.roi) + '</td><td data-l="Days to sell">' + pfDaysLabel(s.days) + '</td>' +
          '<td data-l="Total profit">' + pfMoney(s.sold ? s.totalProfit : null) + '</td><td data-l="Winner?">' + pfBadge(s) + '</td><td data-l="Paid back">' + pfPaid(s) + '</td><td data-l="Unsold">' + (s.unsold ? s.unsold + ' · ' + pfMoney(s.tiedUp) : '—') + '</td></tr>'; }).join('') +
        '</tbody></table></div>' : '<p class="pf-empty">No pieces bought in this range.</p>') + '</section>' +
    '<div class="pf-grid">' + pfSpeedChart(pieces) +
      pfRankList('Best flips', 'Highest profit per piece', best, 'best') + '</div>' +
    '<div class="pf-grid">' + pfRankList('Weakest flips', sold.length > 5 ? 'Lowest profit per piece' : 'Shows once you have more than 5 sales', worst, 'worst') +
      pfRankList('Slowest movers', 'Unsold the longest', stale, 'stale') + '</div>' +
    '<p class="pf-foot">Profit here is sale price minus what you paid for the piece. Packaging and other business costs are in Money → Reports. Tap any item to open it.</p>' +
    '</section>';
};

document.addEventListener('click', event => {
  const t = event.target;
  const range = t.closest('[data-pf-range]'), dim = t.closest('[data-pf-dim]'), sort = t.closest('[data-pf-sort]');
  if (!range && !dim && !sort) return;
  if (range) pf.range = range.dataset.pfRange;
  if (dim) pf.dim = dim.dataset.pfDim;
  if (sort) pf.sort = sort.dataset.pfSort;
  pfSave();
  const y = window.scrollY; render(); window.scrollTo({top: y, behavior: 'instant'});
});
