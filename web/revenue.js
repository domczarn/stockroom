'use strict';
// Revenue studio: the Home chart. Range, metric, grain, comparison, running total, tap-for-detail.

const RC_RANGES = [['24H', 1], ['1W', 7], ['1M', 30], ['3M', 90], ['6M', 182], ['1Y', 365], ['All', 0]];
const RC_ICON_CAL = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>';
const RC_METRICS = {
  revenue: {label: 'Revenue', color: '#3987e5', kind: 'money', additive: true},
  profit: {label: 'Profit on sales', color: '#d95926', kind: 'money', additive: true},
  margin: {label: 'Margin', color: '#d95926', kind: 'pct', additive: false},
  sold: {label: 'Items sold', color: '#3987e5', kind: 'count', additive: true},
  avg: {label: 'Avg sale', color: '#3987e5', kind: 'money', additive: false}
};
const RC_GRAINS = {day: 'Daily', week: 'Weekly', month: 'Monthly'};
const rcHour = 3600000;
// A sale's time to the minute where known (from the Vinted email or when recorded), else midday that day.
const rcRowTime = (row, now) => { const t = row.time ? Date.parse(row.time) : NaN; return Number.isFinite(t) ? t : row.date ? Math.min(Date.parse(row.date + 'T12:00:00Z'), now - 60000) : NaN; };
const rcHourFmt = t => new Date(t).toLocaleString('en-GB', {timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit'});
const rcHourLong = t => new Date(t).toLocaleString('en-GB', {timeZone: 'Europe/London', weekday: 'short', hour: '2-digit', minute: '2-digit'});
const rc = {range: '1M', metric: 'revenue', grain: '', compare: true, running: false, selected: -1};
try { Object.assign(rc, JSON.parse(localStorage.getItem('stockroom-chart') || '{}'), {selected: -1}); } catch {}
const rcSave = () => { try { localStorage.setItem('stockroom-chart', JSON.stringify({range: rc.range, metric: rc.metric, grain: rc.grain, compare: rc.compare, running: rc.running, from: rc.from, to: rc.to})); } catch {} };

const rcDay = 86400000;
const rcT = date => Date.parse(date + 'T00:00:00Z');
const rcD = time => new Date(time).toISOString().slice(0, 10);
const rcFmt = (opts) => new Intl.DateTimeFormat('en-GB', {...opts, timeZone: 'UTC'});
const rcDayFmt = rcFmt({day: 'numeric', month: 'short'}), rcMonFmt = rcFmt({month: 'short', year: '2-digit'}), rcLongFmt = rcFmt({day: 'numeric', month: 'short', year: 'numeric'}), rcMonthLong = rcFmt({month: 'long', year: 'numeric'});

function rcStats(rows) {
  const t = {...reportTotals(saleRows(rows)), expense: reportTotals(rows.filter(row => row.kind === 'Expense')).expense};
  const sales = rows.filter(row => row.kind === 'Sale');
  const saleRevenue = pounds(sales.reduce((n, row) => n + cents(row.revenue), 0));
  return {
    revenue: t.revenue, profit: t.profit, expense: t.expense, cost: t.cost, missing: t.missing,
    margin: t.revenue > 0 ? 100 * t.profit / t.revenue : null,
    sold: sales.length, avg: sales.length ? saleRevenue / sales.length : null
  };
}

const rcFirstDate = (rows, today) => rows.map(row => row.date).filter(Boolean).sort()[0] || today;
function rcWindow(rows, today) {
  if (rc.range === '24H') { const end = Date.now(); return {start: end - 24 * rcHour, end, days: 1, grain: 'hour', auto: 'hour', custom: false, comparable: true, hourly: true}; }
  const custom = rc.range === 'Custom' && rc.from && rc.to;
  const span = RC_RANGES.find(([key]) => key === rc.range)?.[1];
  let end = rcT(today), start;
  if (custom) { start = rcT(rc.from < rc.to ? rc.from : rc.to); end = Math.min(end, rcT(rc.from < rc.to ? rc.to : rc.from)); if (start > end) start = end; }
  else if (span) start = end - (span - 1) * rcDay;
  else start = Math.min(rcT(rcFirstDate(rows, today)), end - 6 * rcDay);
  const days = Math.round((end - start) / rcDay) + 1;
  const auto = days <= 45 ? 'day' : days <= 200 ? 'week' : 'month';
  let grain = rc.grain || auto;
  if (grain === 'day' && days > 400) grain = 'week';
  return {start, end, days, grain, auto, custom: Boolean(custom), comparable: Boolean(span) || Boolean(custom)};
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
  if (grain === 'hour') return long ? rcHourLong(bucket.fromMs) + '–' + rcHourFmt(Math.min(bucket.toMs, bucket.fromMs + rcHour)) : rcHourFmt(bucket.fromMs);
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

// Change badges (▲/▼ %) are switched off on the chart; the comparison line stays when Compare is on.
function rcDelta(now, before, kind) {
  return '';
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
  if (win.hourly) return rcHourModel(rows, win, meta);
  const inRange = (from, to) => rows.filter(row => row.date && row.date >= from && row.date <= to);
  const buckets = rcBuckets(win.start, win.end, win.grain).map(b => ({...b, rows: inRange(b.from, b.to)}));
  buckets.forEach(b => { b.stats = rcStats(b.rows); });
  const shift = win.days * rcDay;
  const prevBuckets = win.comparable ? buckets.map(b => {
    const from = rcD(rcT(b.from) - shift), to = rcD(rcT(b.to) - shift);
    return rcStats(inRange(from, to));
  }) : [];
  // All time means everything: undated sales can't be plotted, but they still count in the totals.
  const total = rcStats([...inRange(rcD(win.start), rcD(win.end)), ...(rc.range === 'All' ? rows.filter(row => !row.date) : [])]);
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

// Last 24 hours, hour by hour (uses each sale's time).
function rcHourModel(rows, win, meta) {
  const now = win.end, timed = rows.map(row => ({row, t: rcRowTime(row, now)})).filter(x => Number.isFinite(x.t));
  const within = (from, to) => timed.filter(x => x.t > from && x.t <= to).map(x => x.row);
  const last = Math.floor(now / rcHour) * rcHour;
  const buckets = Array.from({length: 24}, (_, i) => {
    const fromMs = Math.max(last - (23 - i) * rcHour, win.start), toMs = i === 23 ? now : last - (22 - i) * rcHour;
    const d = rcD(fromMs);
    return {fromMs, toMs, from: d, to: d, rows: within(fromMs, toMs)};
  });
  buckets.forEach(b => { b.stats = rcStats(b.rows); });
  const prevBuckets = buckets.map(b => rcStats(within(b.fromMs - 24 * rcHour, b.toMs - 24 * rcHour)));
  const total = rcStats(within(win.start, now)), prevTotal = rcStats(within(win.start - 24 * rcHour, win.start));
  let series = buckets.map(b => b.stats[rc.metric]), prevSeries = prevBuckets.map(x => x[rc.metric]);
  const running = rc.running && meta.additive;
  if (running) { const acc = list => { let sum = 0; return list.map(v => (sum += v || 0)); }; series = acc(series); prevSeries = acc(prevSeries); }
  return {win, meta, buckets, series, prevSeries, total, prevTotal, running};
}

// Monotone cubic (Fritsch–Carlson): smooth like Stripe, never overshoots the data.
function rcCurve(pts) {
  if (pts.length < 2) return pts.length ? 'M' + pts[0][0] + ',' + pts[0][1] : '';
  const n = pts.length, dx = [], m = [], t = [];
  for (let i = 0; i < n - 1; i++) { dx[i] = pts[i + 1][0] - pts[i][0]; m[i] = (pts[i + 1][1] - pts[i][1]) / (dx[i] || 1); }
  t[0] = m[0]; t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : 3 * (dx[i - 1] + dx[i]) / ((2 * dx[i] + dx[i - 1]) / m[i - 1] + (dx[i] + 2 * dx[i - 1]) / m[i]);
  let d = 'M' + pts[0][0].toFixed(1) + ',' + pts[0][1].toFixed(1);
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += 'C' + (pts[i][0] + h).toFixed(1) + ',' + (pts[i][1] + t[i] * h).toFixed(1) + ' ' + (pts[i + 1][0] - h).toFixed(1) + ',' + (pts[i + 1][1] - t[i + 1] * h).toFixed(1) + ' ' + pts[i + 1][0].toFixed(1) + ',' + pts[i + 1][1].toFixed(1);
  }
  return d;
}
const rcSegments = pts => { const segs = []; let cur = []; pts.forEach(p => { if (p) cur.push(p); else if (cur.length) { segs.push(cur); cur = []; } }); if (cur.length) segs.push(cur); return segs; };

function rcSvg(model, width) {
  const {buckets, series, prevSeries, meta, win} = model;
  const H = width < 600 ? 250 : 300, padL = 4, padR = 4, padT = 28, padB = 30;
  const plotW = Math.max(120, width - padL - padR), plotH = H - padT - padB;
  const showPrev = rc.compare && prevSeries.length;
  const values = [...series, ...(showPrev ? prevSeries : [])].filter(v => v !== null && Number.isFinite(v));
  const hi = Math.max(0, ...values), lo = Math.min(0, ...values);
  const unit = rcNiceMax(Math.max(hi, -lo), meta.kind) / 3;
  const top = Math.max(unit, Math.ceil(hi / unit - 1e-9) * unit), bottom = -Math.ceil(-lo / unit - 1e-9) * unit;
  const y = v => padT + plotH * (top - v) / (top - bottom || 1);
  const n = buckets.length;
  const cx = i => n === 1 ? padL + plotW / 2 : padL + plotW * i / (n - 1);
  const cur = series.map((v, i) => v === null ? null : [cx(i), y(v)]);
  const prev = showPrev ? prevSeries.map((v, i) => v === null ? null : [cx(i), y(v)]) : [];
  const id = 'rcg' + rc.metric, glow = 'rcglow' + rc.metric;
  const r1 = p => p && [+p[0].toFixed(1), +p[1].toFixed(1)];
  let svg = '<svg class="rc-svg" width="' + width + '" height="' + H + '" viewBox="0 0 ' + width + ' ' + H + '" role="img" aria-label="' + esc(meta.label + ' line chart. Drag or hover to see each ' + ({day: 'day', week: 'week', month: 'month'})[win.grain]) + '"' +
    ' data-cur="' + esc(JSON.stringify(cur.map(r1))) + '" data-prev="' + esc(JSON.stringify(prev.map(r1))) + '" data-pl="' + padL + '" data-pw="' + plotW + '" data-n="' + n + '" data-top="' + padT + '" data-bottom="' + (padT + plotH) + '">' +
    '<defs><linearGradient id="' + id + '" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="' + meta.color + '" stop-opacity=".34"/><stop offset=".55" stop-color="' + meta.color + '" stop-opacity=".08"/><stop offset="1" stop-color="' + meta.color + '" stop-opacity="0"/></linearGradient>' +
    '<linearGradient id="rcx" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity="0"/><stop offset=".25" stop-color="currentColor" stop-opacity=".55"/><stop offset="1" stop-color="currentColor" stop-opacity=".1"/></linearGradient>' +
    '<filter id="' + glow + '" x="-5%" y="-30%" width="110%" height="160%"><feGaussianBlur stdDeviation="5" result="b"/><feColorMatrix in="b" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .55 0" result="a"/><feFlood flood-color="' + meta.color + '"/><feComposite in2="a" operator="in"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>';
  // Quiet frame: three faint guides with values tucked on the right.
  const guides = []; for (let v = bottom; v <= top + unit / 2; v += unit) guides.push(v);
  svg += guides.map(v => '<line class="' + (Math.abs(v) < 1e-9 ? 'rc-zero' : 'rc-grid') + '" x1="' + padL + '" x2="' + (width - padR) + '" y1="' + y(v).toFixed(1) + '" y2="' + y(v).toFixed(1) + '"/>' +
    (Math.abs(v) < 1e-9 && bottom === 0 ? '' : '<text class="rc-ytick" x="' + (width - padR) + '" y="' + (y(v) - 6).toFixed(1) + '" text-anchor="end">' + esc(rcTick(v, meta.kind)) + '</text>')).join('');
  if (showPrev) svg += rcSegments(prev).map(sg => '<path class="rc-prev" pathLength="1" d="' + rcCurve(sg) + '"/>').join('');
  const base = y(Math.max(bottom, 0)).toFixed(1);
  const segs = rcSegments(cur);
  svg += segs.map(sg => sg.length > 1 ? '<path class="rc-area" fill="url(#' + id + ')" d="' + rcCurve(sg) + 'L' + sg[sg.length - 1][0].toFixed(1) + ',' + base + 'L' + sg[0][0].toFixed(1) + ',' + base + 'Z"/>' : '').join('');
  svg += segs.map(sg => sg.length > 1 ? '<path class="rc-line" stroke="' + meta.color + '" filter="url(#' + glow + ')" pathLength="1" d="' + rcCurve(sg) + '"/>' : '<circle class="rc-solo" fill="' + meta.color + '" cx="' + sg[0][0].toFixed(1) + '" cy="' + sg[0][1].toFixed(1) + '" r="4"/>').join('');
  const last = [...cur].reverse().find(Boolean);
  if (last && !win.custom && rc.range !== 'All') svg += '<circle class="rc-now-halo" fill="' + meta.color + '" cx="' + last[0].toFixed(1) + '" cy="' + last[1].toFixed(1) + '" r="9"/><circle class="rc-now" fill="' + meta.color + '" cx="' + last[0].toFixed(1) + '" cy="' + last[1].toFixed(1) + '" r="4"/>';
  // Crosshair, moved by scrubbing.
  svg += '<g class="rc-cross" visibility="hidden"><line class="rc-cross-line" stroke="url(#rcx)" y1="' + (padT - 10) + '" y2="' + (padT + plotH) + '"/>' +
    (showPrev ? '<circle class="rc-cross-prev" r="4"/>' : '') + '<circle class="rc-cross-ring" r="11" fill="' + meta.color + '"/><circle class="rc-cross-dot" r="5" fill="' + meta.color + '"/></g>';
  // X labels: evenly spaced, never crowded.
  const label = b => win.grain === 'week' ? rcDayFmt.format(rcT(b.from)) : rcLabel(b, win.grain);
  const slots = Math.max(2, Math.min(n, Math.floor(plotW / 92)));
  const xs = n > 1 ? [...new Set(Array.from({length: slots}, (_, k) => Math.round(k * (n - 1) / (slots - 1))))] : [0];
  svg += xs.map(i => '<text class="rc-xtick" x="' + cx(i).toFixed(1) + '" y="' + (H - 9) + '" text-anchor="' + (n === 1 ? 'middle' : i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle') + '">' + esc(label(buckets[i])) + '</text>').join('');
  svg += '<rect class="rc-scrub" x="0" y="0" width="' + width + '" height="' + H + '"/>';
  return svg + '</svg>';
}

// Timeline strip under the chart: the whole history, with a window you can drag, stretch or tap to move.
function rcNavigator(rows, today, width, win) {
  const t0 = Math.min(rcT(rcFirstDate(rows, today)), rcT(today) - 89 * rcDay), t1 = rcT(today);
  const days = Math.round((t1 - t0) / rcDay) + 1;
  const daily = new Array(days).fill(0);
  for (const row of rows) if (row.date && row.kind === 'Sale') { const i = Math.round((rcT(row.date) - t0) / rcDay); if (i >= 0 && i < days) daily[i] += row.revenue || 0; }
  const per = Math.max(1, Math.ceil(days / 160)), pts = [];
  for (let i = 0; i < days; i += per) pts.push(daily.slice(i, i + per).reduce((a, b) => a + b, 0));
  const H = 54, max = Math.max(1, ...pts), x = t => (t - t0) / (t1 - t0 || 1) * width;
  const line = pts.map((v, i) => [pts.length === 1 ? 0 : i / (pts.length - 1) * width, H - 6 - (H - 14) * v / max]);
  const d = rcCurve(line);
  const wx0 = Math.max(0, x(win.start)), wx1 = Math.min(width, x(win.end));
  return '<div class="rc-nav" data-t0="' + t0 + '" data-t1="' + t1 + '" data-w="' + width + '">' +
    '<svg width="' + width + '" height="' + H + '" viewBox="0 0 ' + width + ' ' + H + '" aria-hidden="true">' +
      '<path class="rc-nav-area" d="' + d + 'L' + width + ',' + H + 'L0,' + H + 'Z"/><path class="rc-nav-line" d="' + d + '"/>' +
      '<rect class="rc-nav-dim" x="0" y="0" width="' + wx0.toFixed(1) + '" height="' + H + '"/>' +
      '<rect class="rc-nav-dim" x="' + wx1.toFixed(1) + '" y="0" width="' + Math.max(0, width - wx1).toFixed(1) + '" height="' + H + '"/>' +
      '<rect class="rc-nav-win" x="' + wx0.toFixed(1) + '" y="1" width="' + Math.max(6, wx1 - wx0).toFixed(1) + '" height="' + (H - 2) + '" rx="6"/>' +
      '<rect class="rc-nav-handle" data-h="l" x="' + (wx0 - 3).toFixed(1) + '" y="' + (H / 2 - 11) + '" width="6" height="22" rx="3"/>' +
      '<rect class="rc-nav-handle" data-h="r" x="' + (wx1 - 3).toFixed(1) + '" y="' + (H / 2 - 11) + '" width="6" height="22" rx="3"/>' +
    '</svg><div class="rc-nav-labels"><span>' + esc(rcLongFmt.format(t0)) + '</span><span>Drag to scroll · stretch the edges to zoom</span><span>Today</span></div></div>';
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
    (sel ? '<div class="rc-sum">' + chip('rev', 'Revenue', gbp(st.revenue)) + chip('pro', 'Profit on sales', gbp(st.profit)) + chip('', 'Margin', rcValue(st.margin, 'pct')) + chip('', 'Sold', st.sold) + '</div>' : '') +
    (sales.length || costs.length
      ? (sales.length ? '<p class="rc-detail-sub">Sales · ' + sales.length + '</p><ul class="rc-list">' + sales.slice(0, rc.all ? 999 : 6).map(line).join('') + '</ul>' : '') +
        (sales.length > 6 ? '<button type="button" class="link rc-more" data-rc-all>' + (rc.all ? 'Show fewer' : 'Show all ' + sales.length + ' sales') + '</button>' : '') +
        (costs.length ? '<p class="rc-detail-sub">Expenses · ' + costs.length + '</p><ul class="rc-list">' + costs.slice(0, rc.all ? 999 : 4).map(line).join('') + '</ul>' : '')
      : '<p class="rc-empty">Nothing sold or spent ' + (sel ? 'in this ' + esc((RC_GRAINS[model.win.grain] || 'Hourly').replace('ly', '').replace('Dai', 'day').toLowerCase()) : 'in this period') + '.</p>') +
    '</div>';
}

function rcInsights(model) {
  const {buckets, total, win} = model;
  const grainWord = {hour: 'hour', day: 'day', week: 'week', month: 'month'}[win.grain];
  const best = buckets.reduce((top, b, i) => b.stats.revenue > (top ? buckets[top.i].stats.revenue : 0) ? {i} : top, null);
  const active = buckets.filter(b => b.stats.sold > 0).length;
  const perDay = total.revenue / win.days;
  const cell = (label, value, sub) => '<div><span>' + label + '</span><strong>' + value + '</strong>' + (sub ? '<small>' + sub + '</small>' : '') + '</div>';
  return '<div class="rc-insights">' +
    cell('Best ' + grainWord, best ? gbp(buckets[best.i].stats.revenue) : '—', best ? esc(rcLabel(buckets[best.i], win.grain)) : 'No sales yet') +
    (win.hourly ? cell('Revenue per hour', gbp(total.revenue / 24), '24 hours') : cell('Revenue per day', gbp(perDay), win.days + ' days')) +
    cell(grainWord[0].toUpperCase() + grainWord.slice(1) + 's with sales', active + ' / ' + buckets.length, buckets.length ? Math.round(100 * active / buckets.length) + '% hit rate' : '') +
    cell('Expenses', gbp(total.expense), total.missing ? total.missing + ' sale cost' + (total.missing === 1 ? '' : 's') + ' missing' : 'Not in Home profit · see Money → Reports') +
    '</div>';
}

function revenueChart(rows, today) {
  const model = rcModel(rows, today);
  const {meta, total, prevTotal, win} = model;
  const host = document.getElementById('financeChart');
  const width = Math.round(host?.querySelector('.rc-plot')?.clientWidth || host?.clientWidth || Math.min(window.innerWidth - 64, 1100)) || 640;
  const span = rcLongFmt.format(win.start) + ' – ' + rcLongFmt.format(win.end);
  const rangeText = win.hourly ? 'Last 24 hours' : win.custom ? span + ' · ' + win.days + ' days' : rc.range === 'All' ? 'All time · since ' + rcLongFmt.format(win.start) : 'Last ' + win.days + ' days';
  const tabs = Object.entries(RC_METRICS).map(([key, m]) => {
    const v = total[key];
    return '<button type="button" class="rc-metric" data-rc-metric="' + key + '" aria-pressed="' + (rc.metric === key) + '">' +
      '<span><i class="rc-key ' + (key === 'profit' || key === 'margin' ? 'pro' : 'rev') + '"></i>' + m.label + '</span><strong>' + rcValue(v, m.kind) + '</strong>' +
      (prevTotal ? rcDelta(v, prevTotal[key], m.kind) : '') + '</button>';
  }).join('');
  const customLabel = win.custom ? rcDayFmt.format(win.start) + ' – ' + rcDayFmt.format(win.end) : 'Custom';
  const sub = '<span class="rc-hero-label">' + esc(meta.label) + '</span>' + '';
  return '<section class="revenue-studio" aria-label="Revenue chart" data-accent="' + rc.metric + '">' +
    '<header class="rc-head"><div class="rc-hero-wrap"><p class="rc-eyebrow" data-base="' + esc(rangeText) + '">' + esc(rangeText) + '</p>' +
      '<h2 class="rc-hero" data-base="' + esc(rcValue(total[rc.metric], meta.kind)) + '">' + rcValue(total[rc.metric], meta.kind) + '</h2>' +
      '<p class="rc-hero-sub">' + sub + '</p></div>' +
      '<div class="rc-range-wrap"><div class="rc-ranges" role="group" aria-label="Time range">' + RC_RANGES.map(([key]) => '<button type="button" data-rc-range="' + key + '" aria-pressed="' + (rc.range === key) + '">' + (key === 'All' ? 'All time' : key) + '</button>').join('') +
        '<button type="button" class="rc-custom-btn" data-rc-custom aria-expanded="false" aria-pressed="' + win.custom + '">' + RC_ICON_CAL + '<span>' + esc(customLabel) + '</span></button></div>' +
        '<div class="rc-pop" hidden><div class="rc-pop-presets">' +
          [['month', 'This month'], ['lastmonth', 'Last month'], ['ytd', 'Year to date'], ['tax', 'This tax year'], ['lasttax', 'Last tax year']].map(([k, l]) => '<button type="button" data-rc-preset="' + k + '">' + l + '</button>').join('') +
        '</div><div class="rc-pop-dates"><label>From<input type="date" data-rc-from value="' + rcD(win.start) + '" min="' + rcFirstDate(rows, today) + '" max="' + today + '"></label>' +
          '<label>To<input type="date" data-rc-to value="' + rcD(win.end) + '" min="' + rcFirstDate(rows, today) + '" max="' + today + '"></label></div>' +
          '<div class="rc-pop-foot"><button type="button" class="secondary" data-rc-pop-close>Cancel</button><button type="button" class="action" data-rc-apply>Apply</button></div></div></div>' +
    '</header>' +
    '<div class="rc-metrics" role="group" aria-label="Chart metric">' + tabs + '</div>' +
    '<div class="rc-toolbar"><div class="rc-grains" role="group" aria-label="Group by"' + (win.hourly ? ' hidden' : '') + '>' +
      Object.entries(RC_GRAINS).map(([key, label]) => '<button type="button" data-rc-grain="' + key + '" aria-pressed="' + (win.grain === key) + '"' + (key === 'day' && win.days > 400 ? ' disabled' : '') + '>' + label + '</button>').join('') + '</div>' +
      '<div class="rc-toggles">' +
        (win.comparable ? '<button type="button" class="rc-toggle" data-rc-compare aria-pressed="' + rc.compare + '"><i class="rc-key prev"></i>Previous period</button>' : '') +
        (meta.additive ? '<button type="button" class="rc-toggle" data-rc-running aria-pressed="' + rc.running + '">Running total</button>' : '') +
      '</div></div>' +
    '<div class="rc-plot">' + rcSvg(model, width) + '<div class="rc-tip" role="status" hidden></div><div class="rc-flag" hidden></div></div>' +
    rcNavigator(rows, today, width, win) +
    rcInsights(model) + rcDetail(model) +
    rcUndated(rows) +
    (total.missing ? '<p class="finance-note">Provisional · ' + total.missing + ' sale cost' + (total.missing === 1 ? '' : 's') + ' missing, so profit may be overstated.</p>' : '') +
    '</section>';
}

function rcUndated(rows) {
  const undated = rows.filter(row => (row.estimated || !row.date) && row.kind === 'Sale');
  if (!undated.length) return '';
  const items = db.items.filter(item => item.status === 'Sold' && !item.soldAt && Number.isFinite(item.sale));
  return '<div class="rc-undated"><strong>' + undated.length + ' sale' + (undated.length === 1 ? '' : 's') + ' missing a sale date (' + gbp(undated.reduce((n, row) => n + row.revenue - (row.cost || 0) - (row.expense || 0), 0)) + ' profit)</strong>' +
    '<span>Placed on its last known date for now, so totals match across ranges. Add the real sale date to make the chart exact.</span>' +
    items.map(item => '<label class="rc-fix-row"><span>#' + esc(item.id) + ' ' + esc(item.name) + ' · ' + gbp(item.sale) + '</span>' +
      '<span class="rc-fix-ctl"><input type="date" max="' + todayUK() + '" data-rc-date="' + esc(item.id) + '" aria-label="Sale date"><button type="button" class="action" data-rc-fix="' + esc(item.id) + '">Save date</button></span></label>').join('') + '</div>';
}

let rcLastModel = null;
// Range, metric or step changes on the web chart: morph instead of redrawing.
function rcRefreshSmooth() {
  const host = document.getElementById('financeChart');
  if (!host || !db || !host.querySelector('.rc-line')) return rcRefresh();
  const today = todayUK();
  srSwap(host, revenueChart(accountingRows(db), today), {line: '.rc-line', area: '.rc-area, .rc-prev, .rc-now, .rc-now-halo', numbers: ['.rc-hero']});
  rcLastModel = rcModel(accountingRows(db), today);
  const plot = host.querySelector('.rc-plot');
  if (plot && rc.selected >= 0) { rcCross(rc.selected, plot); rcLive(rc.selected); }
}
function rcRefresh(animate = true) {
  const host = document.getElementById('financeChart');
  if (!host || !db) return;
  const today = todayUK();
  host.innerHTML = revenueChart(accountingRows(db), today);
  rcLastModel = rcModel(accountingRows(db), today);
  const studio = host.querySelector('.revenue-studio');
  if (animate && studio) studio.classList.add('rc-draw');
  const plot = host.querySelector('.rc-plot');
  if (plot && rc.selected >= 0) { rcCross(rc.selected, plot); rcLive(rc.selected); }
}
// While dragging the timeline, swap everything except the timeline itself so the drag keeps going.
function rcRefreshLive() {
  const host = document.getElementById('financeChart'), studio = host?.querySelector('.revenue-studio');
  if (!studio) return;
  const today = todayUK(), rows = accountingRows(db);
  const tmp = document.createElement('div');
  tmp.innerHTML = revenueChart(rows, today);
  const fresh = tmp.firstElementChild;
  [...studio.children].forEach((child, i) => { if (!child.classList.contains('rc-nav') && fresh.children[i]) child.replaceWith(fresh.children[i].cloneNode(true)); });
  rcLastModel = rcModel(rows, today);
}

function rcCross(i, plot) {
  const svg = plot.querySelector('.rc-svg'), cross = svg?.querySelector('.rc-cross');
  if (!cross) return 0;
  if (i < 0) { cross.setAttribute('visibility', 'hidden'); plot.querySelector('.rc-flag').hidden = true; plot.classList.remove('scrubbing'); return 0; }
  const cur = JSON.parse(svg.dataset.cur || '[]'), prev = JSON.parse(svg.dataset.prev || '[]');
  const n = Number(svg.dataset.n), pl = Number(svg.dataset.pl), pw = Number(svg.dataset.pw);
  const x = cur[i]?.[0] ?? (n === 1 ? pl + pw / 2 : pl + pw * i / (n - 1));
  const lineEl = cross.querySelector('.rc-cross-line'); lineEl.setAttribute('x1', x); lineEl.setAttribute('x2', x);
  for (const sel of ['.rc-cross-dot', '.rc-cross-ring']) {
    const dot = cross.querySelector(sel);
    if (cur[i]) { dot.setAttribute('cx', cur[i][0]); dot.setAttribute('cy', cur[i][1]); dot.setAttribute('visibility', 'visible'); } else dot.setAttribute('visibility', 'hidden');
  }
  const pd = cross.querySelector('.rc-cross-prev');
  if (pd) { if (prev[i]) { pd.setAttribute('cx', prev[i][0]); pd.setAttribute('cy', prev[i][1]); pd.setAttribute('visibility', 'visible'); } else pd.setAttribute('visibility', 'hidden'); }
  cross.setAttribute('visibility', 'visible');
  plot.classList.add('scrubbing');
  // Date flag riding along the top of the crosshair.
  const flag = plot.querySelector('.rc-flag'), model = rcLastModel;
  if (model?.buckets[i]) {
    flag.innerHTML = esc(rcLabel(model.buckets[i], model.win.grain, true)) + ' <b>' + esc(rcValue(model.series[i], model.meta.kind)) + '</b>';
    flag.hidden = false;
    const w = flag.offsetWidth;
    flag.style.left = Math.max(0, Math.min(plot.clientWidth - w, x - w / 2)) + 'px';
  }
  return x;
}

// The big number follows your finger / cursor.
function rcLive(i) {
  const studio = document.querySelector('.revenue-studio'), model = rcLastModel;
  if (!studio || !model) return;
  const hero = studio.querySelector('.rc-hero'), eyebrow = studio.querySelector('.rc-eyebrow'), sub = studio.querySelector('.rc-hero-sub');
  if (!sub.dataset.base) sub.dataset.base = sub.innerHTML;
  if (i < 0 || !model.buckets[i]) {
    hero.textContent = hero.dataset.base; eyebrow.textContent = eyebrow.dataset.base; sub.innerHTML = sub.dataset.base;
    studio.classList.remove('live'); return;
  }
  const b = model.buckets[i], v = model.series[i], p = model.prevSeries[i];
  hero.textContent = rcValue(v, model.meta.kind);
  eyebrow.textContent = rcLabel(b, model.win.grain, true) + (model.running ? ' · running total' : '');
  sub.innerHTML = '<span class="rc-hero-label">' + esc(model.meta.label) + '</span>' + (rc.compare && model.prevSeries.length ? ' <span class="rc-vs">vs ' + rcValue(p, model.meta.kind) + ' before</span>' : '') +
    ' <span class="rc-vs">· ' + b.stats.sold + ' sold</span>';
  studio.classList.add('live');
}

function rcShowTip(i, plot) {
  const tip = plot.querySelector('.rc-tip');
  if (!rcLastModel) rcLastModel = rcModel(accountingRows(db), todayUK());
  if (i < 0 || !rcLastModel.buckets[i]) { tip.hidden = true; rcCross(-1, plot); rcLive(-1); return; }
  const x = rcCross(i, plot);
  rcLive(i);
  if (window.matchMedia('(hover: none)').matches) { tip.hidden = true; return; }
  tip.innerHTML = rcTooltip(rcLastModel, i);
  tip.hidden = false;
  const w = tip.offsetWidth;
  tip.style.left = Math.max(4, Math.min(plot.clientWidth - w - 4, x + 18 + w > plot.clientWidth ? x - w - 18 : x + 18)) + 'px';
}
function rcHideTip(plot) {
  plot.querySelector('.rc-tip').hidden = true;
  if (rc.selected >= 0) { rcCross(rc.selected, plot); rcLive(rc.selected); } else { rcCross(-1, plot); rcLive(-1); }
}
function rcIndexAt(svg, clientX) {
  const r = svg.getBoundingClientRect(), n = Number(svg.dataset.n), pl = Number(svg.dataset.pl), pw = Number(svg.dataset.pw);
  if (n <= 1) return 0;
  return Math.max(0, Math.min(n - 1, Math.round((clientX - r.left - pl) / pw * (n - 1))));
}

// ---- presets ----
function rcPreset(key, today) {
  const t = new Date(rcT(today)), y = t.getUTCFullYear(), m = t.getUTCMonth();
  const d = (yy, mm, dd) => rcD(Date.UTC(yy, mm, dd));
  const taxStartYear = (t.getUTCMonth() > 3 || (t.getUTCMonth() === 3 && t.getUTCDate() >= 6)) ? y : y - 1;
  return {
    month: [d(y, m, 1), today], lastmonth: [d(y, m - 1, 1), d(y, m, 0)], ytd: [d(y, 0, 1), today],
    tax: [d(taxStartYear, 3, 6), today], lasttax: [d(taxStartYear - 1, 3, 6), d(taxStartYear, 3, 5)]
  }[key];
}
function rcSetCustom(from, to) {
  rc.range = 'Custom'; rc.from = from < to ? from : to; rc.to = from < to ? to : from; rc.grain = ''; rc.selected = -1; rcSave();
}

document.addEventListener('click', event => {
  const t = event.target;
  const pop = document.querySelector('.revenue-studio .rc-pop');
  if (t.closest('[data-rc-custom]')) { const open = pop.hidden; pop.hidden = !open; t.closest('[data-rc-custom]').setAttribute('aria-expanded', String(open)); return; }
  if (pop && !pop.hidden && !t.closest('.rc-pop')) pop.hidden = true;
  if (t.closest('[data-rc-pop-close]')) { pop.hidden = true; return; }
  const preset = t.closest('[data-rc-preset]');
  if (preset) { const [f, to] = rcPreset(preset.dataset.rcPreset, todayUK()); rcSetCustom(f, to); rcRefreshSmooth(); return; }
  if (t.closest('[data-rc-apply]')) {
    const f = pop.querySelector('[data-rc-from]').value, to = pop.querySelector('[data-rc-to]').value;
    if (!f || !to) { toast('Pick both dates.'); return; }
    rcSetCustom(f, to); rcRefreshSmooth(); return;
  }
  const range = t.closest('[data-rc-range]');
  if (range) { rc.range = range.dataset.rcRange; rc.grain = ''; rc.selected = -1; rcSave(); rcRefreshSmooth(); return; }
  const metric = t.closest('[data-rc-metric]');
  if (metric) { rc.metric = metric.dataset.rcMetric; rcSave(); rcRefreshSmooth(); return; }
  const grain = t.closest('[data-rc-grain]');
  if (grain) { rc.grain = grain.dataset.rcGrain; rc.selected = -1; rcSave(); rcRefreshSmooth(); return; }
  if (t.closest('[data-rc-compare]')) { rc.compare = !rc.compare; rcSave(); rcRefreshSmooth(); return; }
  if (t.closest('[data-rc-running]')) { rc.running = !rc.running; rcSave(); rcRefreshSmooth(); return; }
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
  if (t.closest('[data-rc-all]')) { rc.all = !rc.all; rcRefresh(false); return; }
  if (t.closest('[data-rc-clear]')) { rc.selected = -1; rcRefresh(false); }
});

// ---- scrubbing: hover with a mouse, drag with a finger (vertical swipes still scroll the page) ----
let rcScrub = null;
document.addEventListener('pointerdown', event => {
  const svg = event.target.closest?.('.revenue-studio .rc-svg');
  if (!svg || event.button > 0) return;
  rcScrub = {id: event.pointerId, x: event.clientX, y: event.clientY, moved: false, i: rcIndexAt(svg, event.clientX), svg};
  if (event.pointerType !== 'mouse') rcShowTip(rcScrub.i, svg.closest('.rc-plot'));
});
document.addEventListener('pointermove', event => {
  if (rcScrub && event.pointerId === rcScrub.id) {
    if (Math.abs(event.clientX - rcScrub.x) > 6) rcScrub.moved = true;
    const plot = rcScrub.svg.closest('.rc-plot');
    if (!plot.isConnected) { rcScrub = null; return; }
    const i = rcIndexAt(rcScrub.svg, event.clientX);
    if (i !== rcScrub.i || event.pointerType !== 'mouse') { rcScrub.i = i; rcShowTip(i, plot); }
    return;
  }
  if (event.pointerType !== 'mouse') return;
  const svg = event.target.closest?.('.revenue-studio .rc-svg');
  if (svg) { rcShowTip(rcIndexAt(svg, event.clientX), svg.closest('.rc-plot')); return; }
  const p = document.querySelector('.revenue-studio .rc-plot.scrubbing');
  if (p) rcHideTip(p);
});
const rcEndScrub = event => {
  if (!rcScrub || event.pointerId !== rcScrub.id) return;
  const {moved, i, svg} = rcScrub; rcScrub = null;
  const plot = svg.closest('.rc-plot');
  if (!moved && event.type === 'pointerup') {
    rc.selected = rc.selected === i ? -1 : i;
    const host = document.getElementById('financeChart'), studio = host?.querySelector('.revenue-studio');
    const tmp = document.createElement('div'); tmp.innerHTML = revenueChart(accountingRows(db), todayUK());
    studio.querySelector('.rc-detail').replaceWith(tmp.querySelector('.rc-detail'));
    if (rc.selected >= 0) { rcShowTip(i, plot); if (window.matchMedia('(max-width: 800px)').matches) studio.querySelector('.rc-detail')?.scrollIntoView({behavior: 'smooth', block: 'nearest'}); }
    else rcHideTip(plot);
    return;
  }
  if (event.pointerType !== 'mouse') rcHideTip(plot);
};
document.addEventListener('pointerup', rcEndScrub);
document.addEventListener('pointercancel', rcEndScrub);

// ---- timeline strip: drag the window to scroll, edges to zoom, tap to jump ----
let rcNavDrag = null, rcNavFrame = 0;
document.addEventListener('pointerdown', event => {
  const nav = event.target.closest?.('.revenue-studio .rc-nav');
  if (!nav) return;
  const svg = nav.querySelector('svg'), r = svg.getBoundingClientRect();
  const t0 = Number(nav.dataset.t0), t1 = Number(nav.dataset.t1), W = r.width;
  const win = rcWindow(accountingRows(db), todayUK());
  const toX = t => (t - t0) / (t1 - t0 || 1) * W, x = event.clientX - r.left;
  const xl = toX(win.start), xr = toX(win.end);
  const mode = Math.abs(x - xl) < 14 ? 'l' : Math.abs(x - xr) < 14 ? 'r' : x > xl && x < xr ? 'move' : 'jump';
  rcNavDrag = {id: event.pointerId, mode, x0: x, start: win.start, end: win.end, t0, t1, W, left: r.left};
  try { nav.setPointerCapture(event.pointerId); } catch {}
  nav.classList.add('dragging');
  if (mode === 'jump') { const len = win.end - win.start; rcNavDrag.mode = 'move'; rcNavDrag.start = Math.round((t0 + x / W * (t1 - t0) - len / 2) / rcDay) * rcDay; rcNavDrag.end = rcNavDrag.start + len; rcNavDrag.x0 = x; rcNavApply(rcNavDrag.start, rcNavDrag.end); }
  event.preventDefault();
});
function rcNavApply(start, end) {
  const d = rcNavDrag; if (!d) return;
  const len = Math.max(6 * rcDay, end - start);
  if (start < d.t0) { start = d.t0; if (d.mode === 'move') end = start + len; }
  if (end > d.t1) { end = d.t1; if (d.mode === 'move') start = Math.max(d.t0, end - len); }
  if (end - start < 6 * rcDay) { if (d.mode === 'l') start = end - 6 * rcDay; else end = Math.min(d.t1, start + 6 * rcDay); }
  rc.range = 'Custom'; rc.from = rcD(start); rc.to = rcD(end); rc.grain = ''; rc.selected = -1;
  const nav = document.querySelector('.revenue-studio .rc-nav'), svg = nav.querySelector('svg');
  const x0 = (start - d.t0) / (d.t1 - d.t0) * d.W, x1 = (end - d.t0) / (d.t1 - d.t0) * d.W;
  const [dimL, dimR] = svg.querySelectorAll('.rc-nav-dim'), winEl = svg.querySelector('.rc-nav-win'), [hl, hr] = svg.querySelectorAll('.rc-nav-handle');
  dimL.setAttribute('width', x0); dimR.setAttribute('x', x1); dimR.setAttribute('width', Math.max(0, d.W - x1));
  winEl.setAttribute('x', x0); winEl.setAttribute('width', Math.max(6, x1 - x0)); hl.setAttribute('x', x0 - 3); hr.setAttribute('x', x1 - 3);
  cancelAnimationFrame(rcNavFrame); rcNavFrame = requestAnimationFrame(rcRefreshLive);
}
document.addEventListener('pointermove', event => {
  const d = rcNavDrag; if (!d || event.pointerId !== d.id) return;
  const dt = Math.round(((event.clientX - d.left) - d.x0) / d.W * (d.t1 - d.t0) / rcDay) * rcDay;
  if (d.mode === 'move') rcNavApply(d.start + dt, d.end + dt);
  else if (d.mode === 'l') rcNavApply(Math.min(d.start + dt, d.end - 6 * rcDay), d.end);
  else rcNavApply(d.start, Math.max(d.end + dt, d.start + 6 * rcDay));
});
const rcNavEnd = event => {
  if (!rcNavDrag || event.pointerId !== rcNavDrag.id) return;
  rcNavDrag = null; cancelAnimationFrame(rcNavFrame); rcSave(); rcRefresh(false);
};
document.addEventListener('pointerup', rcNavEnd);
document.addEventListener('pointercancel', rcNavEnd);

// Redraw only when the chart's width really changes (iOS fires resize for keyboards and date wheels).
let rcResize = 0;
window.addEventListener('resize', () => {
  clearTimeout(rcResize);
  rcResize = setTimeout(() => {
    const plot = document.querySelector('.revenue-studio .rc-plot'), svg = plot?.querySelector('.rc-svg');
    if (!plot || !svg || Math.abs(plot.clientWidth - Number(svg.getAttribute('width'))) < 2) return;
    if (document.querySelector('.revenue-studio .rc-pop:not([hidden])') || rcScrub || rcNavDrag) return;
    rcRefresh(false);
  }, 150);
});
// First paint happens before the container has a width; redraw once at the real size.
new MutationObserver(() => {
  const host = document.getElementById('financeChart');
  if (host && !host.dataset.rcSized && host.querySelector('.revenue-studio')) { host.dataset.rcSized = '1'; requestAnimationFrame(rcRefresh); }
}).observe(document.getElementById('view') || document.body, {childList: true, subtree: true});
