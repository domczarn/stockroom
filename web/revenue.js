'use strict';
// Revenue studio: the Home chart. Range, metric, grain, comparison, running total, tap-for-detail.
// Replaces revenueChart() from finance-insights.js (same signature, so dashboard() is unchanged).

const RC_RANGES = [['1W', 7], ['1M', 30], ['3M', 91], ['6M', 182], ['1Y', 365], ['All', 0]];
const RC_METRICS = {
  revenue: {label: 'Revenue', color: '#3987e5', kind: 'money', additive: true},
  profit: {label: 'Net profit', color: '#d95926', kind: 'money', additive: true},
  margin: {label: 'Margin', color: '#d95926', kind: 'pct', additive: false},
  sold: {label: 'Items sold', color: '#3987e5', kind: 'count', additive: true},
  avg: {label: 'Avg sale', color: '#3987e5', kind: 'money', additive: false}
};
const RC_GRAINS = {day: 'Daily', week: 'Weekly', month: 'Monthly'};
const rc = {range: '1M', metric: 'revenue', grain: '', compare: true, running: false, selected: -1};
try { Object.assign(rc, JSON.parse(localStorage.getItem('stockroom-chart') || '{}'), {selected: -1}); } catch {}
const rcSave = () => { try { localStorage.setItem('stockroom-chart', JSON.stringify({range: rc.range, metric: rc.metric, grain: rc.grain, compare: rc.compare, running: rc.running})); } catch {} };

const rcDay = 86400000;
const rcT = date => Date.parse(date + 'T00:00:00Z');
const rcD = time => new Date(time).toISOString().slice(0, 10);
const rcFmt = (opts) => new Intl.DateTimeFormat('en-GB', {...opts, timeZone: 'UTC'});
const rcDayFmt = rcFmt({day: 'numeric', month: 'short'}), rcMonFmt = rcFmt({month: 'short', year: '2-digit'}), rcLongFmt = rcFmt({day: 'numeric', month: 'short', year: 'numeric'}), rcMonthLong = rcFmt({month: 'long', year: 'numeric'});

function rcStats(rows) {
  const t = reportTotals(rows);
  const sales = rows.filter(row => row.kind === 'Sale');
  const saleRevenue = pounds(sales.reduce((n, row) => n + cents(row.revenue), 0));
  return {
    revenue: t.revenue, profit: t.profit, expense: t.expense, cost: t.cost, missing: t.missing,
    margin: t.revenue > 0 ? 100 * t.profit / t.revenue : null,
    sold: sales.length, avg: sales.length ? saleRevenue / sales.length : null
  };
}

function rcWindow(rows, today) {
  const span = RC_RANGES.find(([key]) => key === rc.range)?.[1];
  const end = rcT(today);
  let start;
  if (span) start = end - (span - 1) * rcDay;
  else {
    const first = rows.map(row => row.date).filter(Boolean).sort()[0] || today;
    start = Math.min(rcT(first), end - 6 * rcDay);
  }
  const days = Math.round((end - start) / rcDay) + 1;
  const auto = days <= 31 ? 'day' : days <= 200 ? 'week' : 'month';
  let grain = rc.grain || auto;
  if (grain === 'day' && days > 400) grain = 'week';
  return {start, end, days, grain, auto, comparable: Boolean(span)};
}

function rcBuckets(start, end, grain) {
  const out = [];
  let cursor = start;
  while (cursor <= end) {
    const d = new Date(cursor);
    let next;
    if (grain === 'day') next = cursor + rcDay;
    else if (grain === 'week') next = cursor + (7 - ((d.getUTCDay() + 6) % 7)) * rcDay; // next Monday
    else next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    const to = Math.min(next - rcDay, end);
    out.push({from: rcD(cursor), to: rcD(to)});
    cursor = next;
  }
  return out;
}

function rcLabel(bucket, grain, long = false) {
  if (grain === 'day') return (long ? rcLongFmt : rcDayFmt).format(rcT(bucket.from));
  if (grain === 'month') return long ? rcMonthLong.format(rcT(bucket.from)) : rcMonFmt.format(rcT(bucket.from));
  return bucket.from === bucket.to ? rcDayFmt.format(rcT(bucket.from)) : rcDayFmt.format(rcT(bucket.from)) + ' – ' + rcDayFmt.format(rcT(bucket.to));
}

const rcValue = (value, kind) => value === null || value === undefined ? '—' :
  kind === 'pct' ? value.toFixed(1) + '%' : kind === 'count' ? String(Math.round(value)) : gbp(value);
const rcTick = (value, kind) => kind === 'pct' ? Math.round(value) + '%' : kind === 'count' ? String(Math.round(value)) :
  (Math.abs(value) >= 1000 ? '£' + (value / 1000).toFixed(value % 1000 ? 1 : 0) + 'k' : '£' + Math.round(value));

function rcNiceMax(max, kind) {
  if (max <= 0) return kind === 'count' ? 2 : kind === 'pct' ? 100 : 10;
  const raw = max / 3, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw);
  return Math.max(kind === 'count' ? 3 : 0, step * 3);
}

function rcDelta(now, before, kind) {
  if (now === null || before === null || before === undefined) return '';
  if (kind === 'pct') {
    const diff = now - before;
    if (Math.abs(diff) < 0.05) return '<span class="rc-delta flat">No change</span>';
    return '<span class="rc-delta ' + (diff > 0 ? 'up' : 'down') + '">' + (diff > 0 ? '▲ ' : '▼ ') + Math.abs(diff).toFixed(1) + ' pts</span>';
  }
  if (!before) return now ? '<span class="rc-delta up">▲ New</span>' : '<span class="rc-delta flat">No change</span>';
  const pct = 100 * (now - before) / Math.abs(before);
  if (Math.abs(pct) < 0.5) return '<span class="rc-delta flat">No change</span>';
  return '<span class="rc-delta ' + (pct > 0 ? 'up' : 'down') + '">' + (pct > 0 ? '▲ ' : '▼ ') + Math.abs(pct).toFixed(0) + '%</span>';
}

function rcModel(rows, today) {
  const win = rcWindow(rows, today);
  const meta = RC_METRICS[rc.metric];
  const inRange = (from, to) => rows.filter(row => row.date && row.date >= from && row.date <= to);
  const buckets = rcBuckets(win.start, win.end, win.grain).map(b => ({...b, rows: inRange(b.from, b.to)}));
  buckets.forEach(b => { b.stats = rcStats(b.rows); });
  const shift = win.days * rcDay;
  const prevBuckets = win.comparable ? buckets.map(b => {
    const from = rcD(rcT(b.from) - shift), to = rcD(rcT(b.to) - shift);
    return rcStats(inRange(from, to));
  }) : [];
  const total = rcStats(inRange(rcD(win.start), rcD(win.end)));
  const prevTotal = win.comparable ? rcStats(inRange(rcD(win.start - shift), rcD(win.end - shift))) : null;
  let series = buckets.map(b => b.stats[rc.metric]);
  let prevSeries = prevBuckets.map(s => s[rc.metric]);
  const running = rc.running && meta.additive;
  if (running) {
    const acc = list => { let sum = 0; return list.map(v => (sum += v || 0)); };
    series = acc(series); prevSeries = acc(prevSeries);
  }
  return {win, meta, buckets, series, prevSeries, total, prevTotal, running};
}

function rcSvg(model, width) {
  const {buckets, series, prevSeries, meta, win, running} = model;
  const H = 240, padL = 44, padR = 8, padT = 12, padB = 26;
  const plotW = Math.max(120, width - padL - padR), plotH = H - padT - padB;
  const values = [...series, ...(rc.compare ? prevSeries : [])].filter(v => v !== null && Number.isFinite(v));
  const hi = Math.max(0, ...values), lo = Math.min(0, ...values);
  const unit = rcNiceMax(Math.max(hi, -lo), meta.kind) / 3;
  const top = Math.max(unit, Math.ceil(hi / unit - 1e-9) * unit), bottom = -Math.ceil(-lo / unit - 1e-9) * unit;
  const y = v => padT + plotH * (top - v) / (top - bottom || 1);
  const n = buckets.length, step = plotW / n;
  const cx = i => padL + step * (i + 0.5);
  const asLine = running || !meta.additive || n > 120;
  const ticks = []; for (let v = bottom; v <= top + unit / 2; v += unit) ticks.push(v);
  let svg = '<svg class="rc-svg" width="' + width + '" height="' + H + '" viewBox="0 0 ' + width + ' ' + H + '" role="img" aria-label="' + esc(meta.label + ' chart') + '">';
  svg += ticks.map(v => '<line class="rc-grid" x1="' + padL + '" x2="' + (width - padR) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '"/>' +
    '<text class="rc-ytick" x="' + (padL - 8) + '" y="' + (y(v) + 4).toFixed(1) + '" text-anchor="end">' + esc(rcTick(v, meta.kind)) + '</text>').join('');
  svg += '<line class="rc-zero" x1="' + padL + '" x2="' + (width - padR) + '" y1="' + y(0).toFixed(1) + '" y2="' + y(0).toFixed(1) + '"/>';
  // average reference
  const real = series.filter(v => v !== null);
  if (!running && real.length > 1 && meta.additive) {
    const avg = real.reduce((a, b) => a + b, 0) / real.length;
    if (avg > 0) svg += '<line class="rc-avg" x1="' + padL + '" x2="' + (width - padR) + '" y1="' + y(avg).toFixed(1) + '" y2="' + y(avg).toFixed(1) + '"/>' +
      '<text class="rc-avg-label" x="' + (padL + 4) + '" y="' + (y(avg) - 5).toFixed(1) + '" text-anchor="start">avg ' + esc(rcValue(avg, meta.kind)) + '</text>';
  }
  // previous period ghost
  if (rc.compare && prevSeries.length) {
    const pts = prevSeries.map((v, i) => v === null ? null : cx(i).toFixed(1) + ',' + y(v).toFixed(1));
    const segs = []; let cur = [];
    pts.forEach(p => { if (p) cur.push(p); else if (cur.length) { segs.push(cur); cur = []; } });
    if (cur.length) segs.push(cur);
    svg += segs.map(s => s.length > 1 ? '<polyline class="rc-prev" points="' + s.join(' ') + '"/>' : '').join('');
  }
  // main series
  if (asLine) {
    const pts = series.map((v, i) => v === null ? null : [cx(i), y(v)]);
    const segs = []; let cur = [];
    pts.forEach(p => { if (p) cur.push(p); else if (cur.length) { segs.push(cur); cur = []; } });
    if (cur.length) segs.push(cur);
    if (running && segs[0]) {
      const s = segs[0];
      svg += '<polygon class="rc-area" fill="' + meta.color + '" points="' + s[0][0].toFixed(1) + ',' + y(0).toFixed(1) + ' ' + s.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ') + ' ' + s[s.length - 1][0].toFixed(1) + ',' + y(0).toFixed(1) + '"/>';
    }
    svg += segs.map(s => '<polyline class="rc-line" stroke="' + meta.color + '" points="' + s.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ') + '"/>').join('');
    if (n <= 60) svg += pts.map((p, i) => p ? '<circle class="rc-dot" data-i="' + i + '" fill="' + meta.color + '" cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="4"/>' : '').join('');
  } else {
    const bw = Math.max(2, Math.min(32, step - 2));
    svg += series.map((v, i) => {
      if (!v) return '';
      const x = cx(i) - bw / 2, y0 = y(0), y1 = y(v), h = Math.max(1.5, Math.abs(y1 - y0));
      const r = Math.min(4, bw / 2, h);
      const yTop = v > 0 ? y0 - h : y0;
      // rounded on the data end only
      const path = v > 0
        ? 'M' + x + ',' + y0 + 'V' + (yTop + r) + 'Q' + x + ',' + yTop + ' ' + (x + r) + ',' + yTop + 'H' + (x + bw - r) + 'Q' + (x + bw) + ',' + yTop + ' ' + (x + bw) + ',' + (yTop + r) + 'V' + y0 + 'Z'
        : 'M' + x + ',' + y0 + 'V' + (y0 + h - r) + 'Q' + x + ',' + (y0 + h) + ' ' + (x + r) + ',' + (y0 + h) + 'H' + (x + bw - r) + 'Q' + (x + bw) + ',' + (y0 + h) + ' ' + (x + bw) + ',' + (y0 + h - r) + 'V' + y0 + 'Z';
      return '<path class="rc-bar" data-i="' + i + '" fill="' + meta.color + '" d="' + path + '"/>';
    }).join('');
  }
  // selection marker
  if (rc.selected >= 0 && rc.selected < n) svg += '<line class="rc-sel" x1="' + cx(rc.selected).toFixed(1) + '" x2="' + cx(rc.selected).toFixed(1) + '" y1="' + padT + '" y2="' + (padT + plotH) + '"/>';
  // x labels: about 6, never colliding
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(plotW / 74))));
  svg += buckets.map((b, i) => ((i % every === 0 && n - 1 - i >= every * 0.6) || i === n - 1)
    ? '<text class="rc-xtick" x="' + cx(i).toFixed(1) + '" y="' + (H - 6) + '" text-anchor="' + (i === 0 && n > 1 ? 'start' : i === n - 1 && n > 1 ? 'end' : 'middle') + '">' + esc(win.grain === 'week' ? rcDayFmt.format(rcT(b.from)) : rcLabel(b, win.grain)) + '</text>' : '').join('');
  // hit targets (full height, wider than marks)
  svg += buckets.map((b, i) => '<rect class="rc-hit" data-i="' + i + '" x="' + (padL + step * i).toFixed(1) + '" y="' + padT + '" width="' + step.toFixed(1) + '" height="' + plotH + '"/>').join('');
  return svg + '</svg>';
}

function rcTooltip(model, i) {
  const b = model.buckets[i], s = b.stats, prev = model.prevSeries[i];
  const meta = model.meta;
  return '<strong>' + esc(rcLabel(b, model.win.grain, true)) + '</strong>' +
    '<dl>' +
    '<div><dt><i class="rc-key rev"></i>Revenue</dt><dd>' + gbp(s.revenue) + '</dd></div>' +
    '<div><dt><i class="rc-key pro"></i>Net profit</dt><dd>' + gbp(s.profit) + '</dd></div>' +
    '<div><dt>Margin</dt><dd>' + rcValue(s.margin, 'pct') + '</dd></div>' +
    '<div><dt>Items sold</dt><dd>' + s.sold + '</dd></div>' +
    (s.expense ? '<div><dt>Expenses</dt><dd>' + gbp(s.expense) + '</dd></div>' : '') +
    (model.running ? '<div><dt>Running ' + esc(meta.label.toLowerCase()) + '</dt><dd>' + rcValue(model.series[i], meta.kind) + '</dd></div>' : '') +
    (rc.compare && model.prevSeries.length ? '<div class="rc-tip-prev"><dt>Previous period</dt><dd>' + rcValue(prev, meta.kind) + '</dd></div>' : '') +
    '</dl>';
}

function rcDetail(model) {
  const sel = rc.selected >= 0 ? model.buckets[rc.selected] : null;
  const rows = sel ? sel.rows : model.buckets.flatMap(b => b.rows);
  const label = sel ? rcLabel(sel, model.win.grain, true) : 'this period';
  const sales = rows.filter(row => row.kind !== 'Expense' && row.kind !== 'Purchase refund').sort((a, b) => b.date.localeCompare(a.date));
  const costs = rows.filter(row => row.kind === 'Expense' || row.kind === 'Purchase refund').sort((a, b) => b.date.localeCompare(a.date));
  const line = row => {
    const profit = row.cost === null ? null : pounds(cents(row.revenue) - cents(row.cost) - cents(row.expense));
    return '<li><span class="rc-li-name">' + esc(row.name || row.kind) + '<small>' + esc(rcDayFmt.format(rcT(row.date))) + (row.kind !== 'Sale' ? ' · ' + esc(row.kind) : '') + '</small></span>' +
      '<span class="rc-li-num">' + (row.kind === 'Expense' || row.kind === 'Purchase refund' ? '−' + gbp(row.expense) : gbp(row.revenue)) +
      (profit !== null && row.kind !== 'Expense' && row.kind !== 'Purchase refund' ? '<small>' + (profit >= 0 ? '+' : '') + gbp(profit) + ' profit</small>' : '') + '</span></li>';
  };
  const st = sel ? sel.stats : model.total;
  const chip = (k, l, v) => '<div><span>' + (k ? '<i class="rc-key ' + k + '"></i>' : '') + l + '</span><strong>' + v + '</strong></div>';
  return '<div class="rc-detail"><div class="rc-detail-head"><h3>' + (sel ? esc(label) : 'Everything in ' + esc(label)) + '</h3>' +
    (sel ? '<button type="button" class="link" data-rc-clear>Show whole period</button>' : '') + '</div>' +
    (sel ? '<div class="rc-sum">' + chip('rev', 'Revenue', gbp(st.revenue)) + chip('pro', 'Net profit', gbp(st.profit)) + chip('', 'Margin', rcValue(st.margin, 'pct')) + chip('', 'Sold', st.sold) + '</div>' : '') +
    (sales.length || costs.length
      ? (sales.length ? '<p class="rc-detail-sub">Sales · ' + sales.length + '</p><ul class="rc-list">' + sales.slice(0, rc.all ? 999 : 6).map(line).join('') + '</ul>' : '') +
        (sales.length > 6 ? '<button type="button" class="link rc-more" data-rc-all>' + (rc.all ? 'Show fewer' : 'Show all ' + sales.length + ' sales') + '</button>' : '') +
        (costs.length ? '<p class="rc-detail-sub">Expenses · ' + costs.length + '</p><ul class="rc-list">' + costs.slice(0, rc.all ? 999 : 4).map(line).join('') + '</ul>' : '')
      : '<p class="rc-empty">Nothing sold or spent ' + (sel ? 'in this ' + esc(RC_GRAINS[model.win.grain].replace('ly', '').replace('Dai', 'day').toLowerCase()) : 'in this period') + '.</p>') +
    '</div>';
}

function rcInsights(model) {
  const {buckets, total, win} = model;
  const grainWord = {day: 'day', week: 'week', month: 'month'}[win.grain];
  const best = buckets.reduce((top, b, i) => b.stats.revenue > (top ? buckets[top.i].stats.revenue : 0) ? {i} : top, null);
  const active = buckets.filter(b => b.stats.sold > 0).length;
  const perDay = total.revenue / win.days;
  const cell = (label, value, sub) => '<div><span>' + label + '</span><strong>' + value + '</strong>' + (sub ? '<small>' + sub + '</small>' : '') + '</div>';
  return '<div class="rc-insights">' +
    cell('Best ' + grainWord, best ? gbp(buckets[best.i].stats.revenue) : '—', best ? esc(rcLabel(buckets[best.i], win.grain)) : 'No sales yet') +
    cell('Revenue per day', gbp(perDay), win.days + ' days') +
    cell(grainWord[0].toUpperCase() + grainWord.slice(1) + 's with sales', active + ' / ' + buckets.length, buckets.length ? Math.round(100 * active / buckets.length) + '% hit rate' : '') +
    cell('Expenses', gbp(total.expense), total.missing ? total.missing + ' sale cost' + (total.missing === 1 ? '' : 's') + ' missing' : 'Included in net profit') +
    '</div>';
}

// eslint-disable-next-line no-global-assign
revenueChart = function revenueStudio(rows, today) {
  const model = rcModel(rows, today);
  const {meta, total, prevTotal, win} = model;
  const host = document.getElementById('financeChart');
  const width = Math.round(host?.querySelector('.rc-plot')?.clientWidth || host?.clientWidth || Math.min(window.innerWidth - 64, 1100)) || 640;
  const rangeText = rc.range === 'All' ? 'All time · since ' + rcLongFmt.format(win.start) : 'Last ' + win.days + ' days';
  const tabs = Object.entries(RC_METRICS).map(([key, m]) => {
    const v = total[key];
    return '<button type="button" class="rc-metric" data-rc-metric="' + key + '" aria-pressed="' + (rc.metric === key) + '">' +
      '<span><i class="rc-key ' + (key === 'profit' || key === 'margin' ? 'pro' : 'rev') + '"></i>' + m.label + '</span><strong>' + rcValue(v, m.kind) + '</strong>' +
      (prevTotal ? rcDelta(v, prevTotal[key], m.kind) : '') + '</button>';
  }).join('');
  return '<section class="revenue-studio" aria-label="Revenue chart">' +
    '<header class="rc-head"><div><p class="rc-eyebrow">' + esc(rangeText) + '</p>' +
      '<h2 class="rc-hero">' + rcValue(total[rc.metric], meta.kind) + '</h2>' +
      '<p class="rc-hero-sub">' + esc(meta.label) + (prevTotal ? ' ' + rcDelta(total[rc.metric], prevTotal[rc.metric], meta.kind) + ' <span class="rc-vs">vs previous ' + win.days + ' days</span>' : '') + '</p></div>' +
      '<div class="rc-ranges" role="group" aria-label="Time range">' + RC_RANGES.map(([key]) => '<button type="button" data-rc-range="' + key + '" aria-pressed="' + (rc.range === key) + '">' + (key === 'All' ? 'All time' : key) + '</button>').join('') + '</div>' +
    '</header>' +
    '<div class="rc-metrics" role="group" aria-label="Chart metric">' + tabs + '</div>' +
    '<div class="rc-toolbar"><div class="rc-grains" role="group" aria-label="Group by">' +
      Object.entries(RC_GRAINS).map(([key, label]) => '<button type="button" data-rc-grain="' + key + '" aria-pressed="' + (win.grain === key) + '"' + (key === 'day' && win.days > 400 ? ' disabled' : '') + '>' + label + '</button>').join('') + '</div>' +
      '<div class="rc-toggles">' +
        (win.comparable ? '<button type="button" class="rc-toggle" data-rc-compare aria-pressed="' + rc.compare + '"><i class="rc-key prev"></i>Previous period</button>' : '') +
        (meta.additive ? '<button type="button" class="rc-toggle" data-rc-running aria-pressed="' + rc.running + '">Running total</button>' : '') +
      '</div></div>' +
    '<div class="rc-plot">' + rcSvg(model, width) + '<div class="rc-tip" role="status" hidden></div></div>' +
    '<p class="rc-hint">Tap or hover a ' + {day: 'day', week: 'week', month: 'month'}[win.grain] + ' for the breakdown.</p>' +
    rcInsights(model) + rcDetail(model) +
    rcUndated(rows) +
    (total.missing ? '<p class="finance-note">Provisional · ' + total.missing + ' sale cost' + (total.missing === 1 ? '' : 's') + ' missing, so profit may be overstated.</p>' : '') +
    '</section>';
};

function rcUndated(rows) {
  const undated = rows.filter(row => !row.date && row.revenue);
  if (!undated.length) return '';
  const items = db.items.filter(item => item.status === 'Sold' && !item.soldAt && Number.isFinite(item.sale));
  return '<div class="rc-undated"><strong>' + undated.length + ' sale' + (undated.length === 1 ? '' : 's') + ' with no date (' + gbp(undated.reduce((n, row) => n + row.revenue, 0)) + ')</strong>' +
    '<span>Not on the chart, but counted in Reports. Add the sale date to fix.</span>' +
    items.map(item => '<label class="rc-fix-row"><span>#' + esc(item.id) + ' ' + esc(item.name) + ' · ' + gbp(item.sale) + '</span>' +
      '<span class="rc-fix-ctl"><input type="date" max="' + todayUK() + '" data-rc-date="' + esc(item.id) + '" aria-label="Sale date"><button type="button" class="action" data-rc-fix="' + esc(item.id) + '">Save date</button></span></label>').join('') + '</div>';
}

let rcLastModel = null;
function rcRefresh() {
  const host = document.getElementById('financeChart');
  if (!host || !db) return;
  const today = todayUK();
  host.innerHTML = revenueChart(accountingRows(db), today);
  rcLastModel = rcModel(accountingRows(db), today);
}

function rcShowTip(i, plot) {
  const tip = plot.querySelector('.rc-tip');
  if (!rcLastModel) rcLastModel = rcModel(accountingRows(db), todayUK());
  if (i < 0 || !rcLastModel.buckets[i]) { tip.hidden = true; return; }
  tip.innerHTML = rcTooltip(rcLastModel, i);
  tip.hidden = false;
  const hit = plot.querySelector('.rc-hit[data-i="' + i + '"]');
  const x = Number(hit.getAttribute('x')) + Number(hit.getAttribute('width')) / 2;
  const w = tip.offsetWidth, max = plot.clientWidth - w - 4;
  tip.style.left = Math.max(4, Math.min(max, x - w / 2)) + 'px';
  plot.querySelectorAll('.rc-bar, .rc-dot').forEach(el => el.classList.toggle('dim', el.dataset.i !== String(i)));
}
function rcHideTip(plot) {
  plot.querySelector('.rc-tip').hidden = true;
  plot.querySelectorAll('.dim').forEach(el => el.classList.remove('dim'));
}

document.addEventListener('click', event => {
  const t = event.target;
  const range = t.closest('[data-rc-range]');
  if (range) { rc.range = range.dataset.rcRange; rc.grain = ''; rc.selected = -1; rcSave(); rcRefresh(); return; }
  const metric = t.closest('[data-rc-metric]');
  if (metric) { rc.metric = metric.dataset.rcMetric; rcSave(); rcRefresh(); return; }
  const grain = t.closest('[data-rc-grain]');
  if (grain) { rc.grain = grain.dataset.rcGrain; rc.selected = -1; rcSave(); rcRefresh(); return; }
  if (t.closest('[data-rc-compare]')) { rc.compare = !rc.compare; rcSave(); rcRefresh(); return; }
  if (t.closest('[data-rc-running]')) { rc.running = !rc.running; rcSave(); rcRefresh(); return; }
  const fix = t.closest('[data-rc-fix]');
  if (fix) {
    const id = fix.dataset.rcFix, input = document.querySelector('[data-rc-date="' + CSS.escape(id) + '"]');
    if (!input?.value) { input?.focus(); toast('Pick the date it sold.'); return; }
    const next = structuredClone(db), item = next.items.find(row => row.id === id);
    if (!item) return;
    item.soldAt = input.value; fix.disabled = true;
    persist(next).then(() => { rcRefresh(); toast('Sale date saved'); }).catch(e => { fix.disabled = false; toast(e.message || 'Could not save.'); });
    return;
  }
  if (t.closest('[data-rc-all]')) { rc.all = !rc.all; rcRefresh(); return; }
  if (t.closest('[data-rc-clear]')) { rc.selected = -1; rcRefresh(); return; }
  const hit = t.closest('.rc-hit');
  if (hit) {
    const i = Number(hit.dataset.i);
    rc.selected = rc.selected === i ? -1 : i;
    rcRefresh();
    const touch = window.matchMedia('(hover: none)').matches;
    if (rc.selected >= 0) {
      const plot = document.querySelector('.revenue-studio .rc-plot');
      if (!touch) rcShowTip(i, plot);
      else plot.querySelectorAll('.rc-bar, .rc-dot').forEach(el => el.classList.toggle('dim', el.dataset.i !== String(i)));
      if (window.matchMedia('(max-width: 800px)').matches) document.querySelector('.rc-detail')?.scrollIntoView({behavior: 'smooth', block: 'nearest'});
    }
  }
});
document.addEventListener('pointermove', event => {
  if (event.pointerType !== 'mouse') return;
  const plot = event.target.closest?.('.revenue-studio .rc-plot');
  const open = document.querySelector('.revenue-studio .rc-tip:not([hidden])');
  if (!plot) { if (open && rc.selected < 0) rcHideTip(open.parentElement); return; }
  const hit = event.target.closest('.rc-hit');
  if (hit) rcShowTip(Number(hit.dataset.i), plot);
});
let rcResize = 0;
window.addEventListener('resize', () => {
  clearTimeout(rcResize);
  rcResize = setTimeout(() => { if (document.querySelector('.revenue-studio')) rcRefresh(); }, 150);
});
// First paint happens before the container has a width; redraw once at the real size.
new MutationObserver(() => {
  const host = document.getElementById('financeChart');
  if (host && !host.dataset.rcSized && host.querySelector('.revenue-studio')) { host.dataset.rcSized = '1'; requestAnimationFrame(rcRefresh); }
}).observe(document.getElementById('view') || document.body, {childList: true, subtree: true});
