'use strict';
// App shell: section navigation (Stripe-style sub-tabs) and Pip's brain (insights from the workspace).

const SECTIONS = [
  {key:'home', label:'Home', tabs:[['Dashboard','Overview'],['Vinted updates','Vinted updates'],['Sale receipts','Sale receipts','admin']]},
  {key:'stock', label:'Stock', tabs:[['Stock','Collection'],['Orders','Bulk orders'],['Buying insights','Insights'],['Buying research','Market research']]},
  {key:'money', label:'Money', tabs:[['Activity','Transactions'],['Expenses','Expenses'],['Reports','Reports']]},
  {key:'sourcing', label:'Sourcing', tabs:[['Resources','Suppliers'],['Customer care','Customer care']]},
  {key:'account', label:'Account', tabs:[['Account','Settings'],['Profile','Profile'],['Leaderboard','Leaderboard'],['Admin','Members','admin']]}
];
const sectionOf = name => SECTIONS.find(section => section.tabs.some(([id]) => id === name)) || SECTIONS[0];

function subnavView(current) {
  const section = sectionOf(current);
  const tabs = section.tabs.filter(([, , role]) => role !== 'admin' || (account?.role === 'admin' && !isReadOnly()));
  if (tabs.length < 2) return '';
  return '<nav class="subnav" aria-label="' + section.label + '">' + tabs.map(([id, label]) =>
    '<button type="button" data-tab="' + esc(id) + '"' + (id === current ? ' class="active" aria-current="page"' : '') + '>' + esc(label) + '</button>'
  ).join('') + '</nav>';
}

function markSections(current) {
  const active = sectionOf(current).key;
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
  return {summary, signals:signals.slice(0, 4), stats:{tiedUp, inStock:inStock.length, margin}};
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
    '<div class="pip-brain-copy"><span class="pip-brain-eyebrow"><span class="pip-live"></span>Pip · live analysis</span>' +
    '<h2 id="pipBrainTitle">Pip’s brain</h2><p class="pip-brain-summary">' + esc(brain.summary) + '</p>' +
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
  const span = (from, to) => reportTotals(rows.filter(row => row.date >= iso(from) && row.date <= iso(to)));
  const now = span(end - 29 * day, end), before = span(end - 59 * day, end - 30 * day);
  const all = reportTotals(rows);
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
    tile('Net profit', gbp(all.profit), 'all time', null, 'profit') +
    tile('Revenue', gbp(now.revenue), 'last 30 days', delta(now.revenue, before.revenue), 'revenue') +
    tile('Net margin', now.revenue > 0 ? Math.round(now.profit / now.revenue * 100) + '%' : '—', 'last 30 days', null) +
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
