'use strict';
// Self Assessment helper: UK tax year totals (6 April to 5 April) and a CSV of every line.

// Rates come from taxrates.js (one file, keyed by tax year).
const taxAllowance = start => ratesFor(start).tradingAllowance;
const taxPounds = n => '£' + n.toLocaleString('en-GB');
let taxYear = null;

// How much to put aside: rest-of-UK income tax bands and Class 4 NI (frozen from 2021-22 to 2030-31).
// Income tax on the side profit is the extra tax on top of other income (a job's pay), so the band matters.
function incomeTaxOn(income, r = ratesFor(taxYear ?? taxYearOf(todayUK()))) {
  const pa = Math.max(0, r.personalAllowance - Math.max(0, income - r.allowanceTaperFrom) / 2);
  const taxable = Math.max(0, income - pa), basicBand = r.basicRateLimit - r.personalAllowance;
  return Math.min(taxable, basicBand) * r.incomeTax.basic + Math.max(0, Math.min(taxable, r.higherRateLimit - pa) - basicBand) * r.incomeTax.higher + Math.max(0, taxable - (r.higherRateLimit - pa)) * r.incomeTax.additional;
}
function taxToPutAside(profit, other = 0, r = ratesFor(taxYear ?? taxYearOf(todayUK()))) {
  profit = Math.max(0, Number(profit) || 0); other = Math.max(0, Number(other) || 0);
  const incomeTax = incomeTaxOn(other + profit, r) - incomeTaxOn(other, r);
  const c4 = r.class4, ni = Math.max(0, Math.min(profit, c4.upper) - c4.lower) * c4.main + Math.max(0, profit - c4.upper) * c4.above;
  const total = Math.round((incomeTax + ni) * 100) / 100;
  return {incomeTax: Math.round(incomeTax * 100) / 100, ni: Math.round(ni * 100) / 100, total, rate: profit ? total / profit : 0};
}
const otherIncome = () => { const b = typeof db !== 'undefined' ? db?.business : null; if (b && Number.isFinite(b.otherIncome)) return b.otherIncome; try { const v = localStorage.getItem('stockroom-other-income'); return v === null ? null : Number(v); } catch { return null; } };

function taxYearOf(date) {
  const [y, m, d] = String(date).slice(0, 10).split('-').map(Number);
  return m > 4 || (m === 4 && d >= 6) ? y : y - 1;
}
const taxLabel = start => start + '–' + String(start + 1).slice(2);
const taxBounds = start => [start + '-04-06', (start + 1) + '-04-05'];

function taxSummary(start) {
  const [from, to] = taxBounds(start);
  const rows = accountingRows(db).filter(row => row.date && row.date >= from && row.date <= to);
  const turnover = rows.reduce((n, r) => n + (r.revenue || 0), 0);
  const goods = rows.reduce((n, r) => n + (r.cost || 0), 0);
  const expenses = rows.reduce((n, r) => n + (r.expense || 0), 0);
  const actual = turnover - goods - expenses;
  const allowance = taxAllowance(start), withAllowance = Math.max(0, turnover - allowance);
  const missing = rows.filter(r => r.kind === 'Sale' && r.cost === null).length;
  const undated = accountingRows(db).filter(r => !r.date || r.estimated).length;
  return {allowance, from, to, rows, turnover, goods, expenses, actual, withAllowance, missing, undated,
    best: turnover <= allowance ? 'allowance-free' : withAllowance < actual ? 'allowance' : 'actual'};
}

// HMRC platform reporting: a platform reports a seller for a calendar year after 30 sales or about £1,700 (€2,000).
// The busiest platform decides: each platform reports you separately (see reportingPlatforms in grow.js).
function reportingStatus(year = todayUK().slice(0, 4)) {
  const top = [...reportingPlatforms(year).entries()].sort((a, b) => b[1].sales - a[1].sales || b[1].gross - a[1].gross)[0] || ['Vinted', {sales: 0, gross: 0}];
  const [platform, {sales, gross}] = top;
  return {year, platform, sales, money: gross, reported: sales >= REPORT_SALES || gross >= REPORT_GROSS, close: sales >= 20 || gross >= 1000};
}
function reportingNudgeHtml() {
  if (typeof reportingPlatforms !== 'function') return '';   // grow.js may still be loading on the very first render
  const r = reportingStatus();
  if (!r.close) return '';
  const text = r.reported ? r.platform + ' will report your ' + r.year + ' sales to HMRC' : (REPORT_SALES - r.sales) + ' sales or ' + gbp(Math.max(0, REPORT_GROSS - r.money)) + ' until ' + r.platform + ' reports you to HMRC';
  return '<button type="button" class="hmrc-nudge" data-hmrc-open><span aria-hidden="true">' + uiIcon('receipt') + '</span><span>' + esc(text) + '</span><b>Tax pack →</b></button>';
}
onHook('afterRender', () => {
  // Page rules block inline styles, so meter widths are set here.
  document.querySelectorAll('.hmrc-card .track > span[data-w]').forEach(el => { el.style.width = el.dataset.w + '%'; });
  if (tab !== 'Dashboard' || document.querySelector('.hmrc-nudge')) return;
  const html = reportingNudgeHtml(), view = document.getElementById('view');
  const anchor = view?.querySelector('.mh-stats') || view?.querySelector('.kpi-strip');
  if (html && anchor) anchor.insertAdjacentHTML('afterend', html);
});
document.addEventListener('click', event => { if (event.target.closest('[data-hmrc-open]')) { navigate('Reports'); setTimeout(() => document.querySelector('.hmrc-card')?.scrollIntoView({block: 'start'}), 50); } });

function taxCard() {
  // Companies don't use Self Assessment for trading profit, the trading allowance or Class 4: show the company view instead.
  if (typeof isLtd === 'function' && isLtd()) {
    const b = business();
    return '<section class="panel tax-card tax-company"><div class="tax-head"><div><h2>' + esc(b.name || 'Your company') + '</h2><p>Sales go in the company’s accounts and Corporation Tax return, not your Self Assessment. The trading allowance doesn’t apply to companies.</p></div></div>' +
      '<p class="tax-verdict">The corporation tax estimate, tax pot, director’s loan and dividends arrive in the next Reports update. Until then, Export CSV gives your accountant every sale and expense.</p>' +
      (b.setUp ? '' : '<p><button type="button" class="secondary" data-open-business>Add your company details</button></p>') + '</section>';
  }
  const years = [...new Set([taxYearOf(todayUK()), ...accountingRows(db).filter(r => r.date).map(r => taxYearOf(r.date))])].sort((a, b) => b - a);
  if (taxYear === null || !years.includes(taxYear)) taxYear = years[0];
  const s = taxSummary(taxYear);
  const line = (label, value, sub) => '<div class="tax-line"><span>' + label + (sub ? '<small>' + sub + '</small>' : '') + '</span><strong>' + value + '</strong></div>';
  const verdict = s.best === 'allowance-free'
    ? 'Your sales are under ' + taxPounds(s.allowance) + ' this tax year, so the trading allowance covers them. You usually don’t need to declare them.'
    : s.best === 'allowance'
      ? 'Claiming the ' + taxPounds(s.allowance) + ' trading allowance gives a lower taxable profit than your actual costs (' + gbp(s.withAllowance) + ' vs ' + gbp(s.actual) + ').'
      : 'Deducting your actual costs gives a lower taxable profit than the ' + taxPounds(s.allowance) + ' allowance (' + gbp(s.actual) + ' vs ' + gbp(s.withAllowance) + ').';
  return '<section class="tax-card panel"><header><div><h2>Self Assessment</h2><p>Totals for the UK tax year, ready for the self-employment pages.</p></div>' +
    '<label class="tax-year">Tax year<select data-tax-year>' + years.map(y => '<option value="' + y + '"' + (y === taxYear ? ' selected' : '') + '>' + taxLabel(y) + ' (6 Apr ' + y + ' – 5 Apr ' + (y + 1) + ')</option>').join('') + '</select></label></header>' +
    '<div class="tax-lines">' +
      line('Turnover', gbp(s.turnover), 'sales minus refunds to buyers') +
      line('Cost of goods sold', gbp(s.goods), 'what you paid for pieces you sold') +
      line('Other allowable expenses', gbp(s.expenses), 'packaging, postage, tools, return costs') +
      line('Profit using actual costs', gbp(s.actual)) +
      line('Profit using ' + taxPounds(s.allowance) + ' trading allowance', gbp(s.withAllowance), 'you can’t claim both') +
    '</div><p class="tax-verdict">' + esc(verdict) + '</p>' +
    (s.missing || s.undated ? '<p class="tax-warn">' + [s.missing ? s.missing + ' sale' + (s.missing === 1 ? ' has' : 's have') + ' no purchase cost' : '', s.undated ? s.undated + ' line' + (s.undated === 1 ? ' is' : 's are') + ' missing an exact date' : ''].filter(Boolean).join(' · ') + '. Fix these for accurate figures.</p>' : '') +
    taxAsideHtml(s) +
    '<div class="tax-actions"><button type="button" class="action" data-tax-csv>Download CSV for ' + taxLabel(taxYear) + '</button><button type="button" class="secondary" data-tax-print>Print summary</button></div>' +
    '<p class="footnote">Stockroom gives you the numbers, not tax advice. Check HMRC guidance or an accountant if you’re unsure which option to use.</p></section>';
}

function taxAsideHtml(s) {
  const other = otherIncome(), taxable = s.best === 'allowance-free' ? 0 : Math.min(s.actual, s.withAllowance);
  const est = taxToPutAside(taxable, other || 0), due = '31 January ' + (taxYear + 2);
  // The next £ of profit is taxed at the top rate it lands in, not the average so far.
  const next = Math.round((taxToPutAside(taxable + 100, other || 0).total - est.total));
  const input = '<label class="tax-other">Your other income this tax year, before tax <small>Job pay, pension, etc. Leave at 0 if Vinted is your only income.</small>' +
    '<span class="tax-other-row">£<input type="number" inputmode="decimal" min="0" step="100" data-tax-other value="' + (other ?? '') + '" placeholder="e.g. 24000"></span></label>';
  if (other === null) return '<div class="tax-aside"><h3>How much to put aside</h3><p>Pip works out your tax bill from your profit and your other income.</p>' + input + '</div>';
  const body = taxable <= 0
    ? '<p class="tax-aside-big">£0 so far</p><p>No tax to pay on your selling yet' + (s.best === 'allowance-free' ? ': the trading allowance covers it.' : '.') + '</p>'
    : '<p class="tax-aside-big">' + gbp(est.total) + ' <small>so far this tax year</small></p>' +
      '<p>From now on, put aside <b>' + next + 'p of every £1 profit</b>.</p>' +
      '<div class="tax-lines">' + [['Income tax', est.incomeTax, 'on ' + gbp(taxable) + ' taxable profit'], ['Class 4 National Insurance', est.ni, '6% of profit over £12,570']]
        .map(([label, value, sub]) => '<div class="tax-line"><span>' + label + '<small>' + sub + '</small></span><strong>' + gbp(value) + '</strong></div>').join('') + '</div>' +
      '<p class="footnote">Due by ' + due + '. If the bill is over £1,000 and most of your tax isn’t already taken from pay, HMRC also asks for half next year’s bill in advance. Scotland has different income tax bands.</p>';
  return '<div class="tax-aside"><h3>How much to put aside</h3>' + body + input + '</div>';
}

let taxOtherTimer = 0;
document.addEventListener('input', event => {
  const field = event.target.closest?.('[data-tax-other]');
  if (!field) return;
  clearTimeout(taxOtherTimer);
  taxOtherTimer = setTimeout(() => {
    const v = Math.max(0, Number(field.value) || 0);
    try { localStorage.setItem('stockroom-other-income', String(v)); } catch {}
    const card = document.querySelector('.tax-card');
    if (card) { card.outerHTML = taxCard(); const f = document.querySelector('[data-tax-other]'); if (f) { f.focus({preventScroll: true}); const n = f.value.length; try { f.setSelectionRange(n, n); } catch {} } }
  }, 600);
});

function taxPrint(start) {
  const s = taxSummary(start), m = printMoney, today = todayUK();
  const lower = s.best === 'allowance-free' ? 0 : Math.min(s.actual, s.withAllowance);
  const basis = s.best === 'allowance-free' ? 'Covered by the trading allowance' : s.best === 'allowance' ? 'Trading allowance' : 'Actual costs';
  const key = printTable(['', 'Amount'], [
    ['Turnover <span class="pd-note">sales minus refunds to buyers</span>', m(s.turnover)],
    ['Cost of goods sold <span class="pd-note">what you paid for pieces you sold</span>', m(s.goods)],
    ['Other allowable expenses <span class="pd-note">packaging, postage, promotion, return costs</span>', m(s.expenses)],
    ['Net profit using actual costs', m(s.actual)],
    ['Trading allowance', m(s.allowance)],
    ['Profit using the trading allowance <span class="pd-note">you can’t claim both</span>', m(s.withAllowance)],
  ], {foot: ['Taxable profit (' + basis.toLowerCase() + ')', m(lower)], numeric: [1]}).replace('<table>', '<table class="pd-key">');
  // Month by month, April to March.
  // Months to date while the tax year is still running; all twelve once it has ended.
  const months = Array.from({length: 12}, (_, i) => new Date(Date.UTC(start, 3 + i, 1)).toISOString().slice(0, 7)).filter(mo => mo <= today.slice(0, 7));
  const monthRows = months.map(mo => {
    const r = s.rows.filter(x => x.date.startsWith(mo)), sum = k => r.reduce((n, x) => n + (Number(x[k]) || 0), 0);
    return [new Date(mo + '-01T12:00:00Z').toLocaleDateString('en-GB', {month: 'short', year: 'numeric'}), m(sum('revenue')), m(sum('cost')), m(sum('expense')), m(sum('revenue') - sum('cost') - sum('expense'))];
  });
  const monthTable = printTable(['Month', 'Turnover', 'Cost of goods', 'Expenses', 'Profit'], monthRows, {foot: ['Total', m(s.turnover), m(s.goods), m(s.expenses), m(s.actual)], numeric: [1, 2, 3, 4]});
  // Expenses by category: business costs from the expenses list, plus costs tied to sales and returns.
  const cats = new Map();
  for (const row of db.expenses) if (row[4] && row[4] >= s.from && row[4] <= s.to) cats.set(row[2] || 'Other', (cats.get(row[2] || 'Other') || 0) + (Number(row[1]) || 0));
  const listed = [...cats.values()].reduce((n, v) => n + v, 0), saleCosts = Math.round((s.expenses - listed) * 100) / 100;
  if (Math.abs(saleCosts) >= .005) cats.set('Sale and return costs', saleCosts);
  const catTable = cats.size ? printTable(['Category', 'Amount'], [...cats].sort((a, b) => b[1] - a[1]).map(([c, v]) => [esc(c), m(v)]), {foot: ['Total', m(s.expenses)], numeric: [1]}) : '<p class="pd-note">No expenses recorded in this tax year.</p>';
  const other = otherIncome(), est = other === null ? null : taxToPutAside(lower, other);
  const aside = est ? '<h2>Estimated tax on this profit</h2>' + printTable(['', 'Amount'], [['Income tax <span class="pd-note">on top of £' + Math.round(other).toLocaleString('en-GB') + ' other income</span>', m(est.incomeTax)], ['Class 4 National Insurance <span class="pd-note">6% of profit over £12,570</span>', m(est.ni)]], {foot: ['Estimated total', m(est.total)], numeric: [1]}).replace('<table>', '<table class="pd-key">') +
    '<p class="pd-note">Due by 31 January ' + (start + 2) + '. Rest-of-UK income tax bands; Scotland differs. If the bill is over £1,000 and most of your tax isn’t taken from pay, HMRC may also ask for payments on account.</p>' : '';
  const warn = s.missing || s.undated ? '<p class="pd-callout pd-warn">' + [s.missing ? s.missing + ' sale' + (s.missing === 1 ? ' has' : 's have') + ' no purchase cost' : '', s.undated ? s.undated + ' entr' + (s.undated === 1 ? 'y has' : 'ies have') + ' an estimated or missing date' : ''].filter(Boolean).join('; ') + '. Fix these before filing.</p>' : '';
  const verdict = s.best === 'allowance-free' ? 'Turnover is under the ' + taxPounds(s.allowance) + ' trading allowance, so it is usually tax-free and doesn’t need declaring.'
    : s.best === 'allowance' ? 'Claiming the ' + taxPounds(s.allowance) + ' trading allowance gives the lower taxable profit.' : 'Deducting actual costs gives the lower taxable profit.';
  printDocument('Self Assessment summary', 'Tax year ' + taxLabel(start) + ' · 6 April ' + start + ' to 5 April ' + (start + 1), [
    '<h2>Self-employment figures</h2>' + key + '<p class="pd-callout">' + esc(verdict) + '</p>' + warn,
    aside,
    '<h2>Month by month</h2>' + monthTable,
    '<h2>Expenses by category</h2>' + catTable,
  ], [['Account', account?.email || ''], ['Tax year', taxLabel(start)], ['Status', today > s.to ? 'Tax year ended' : 'In progress (to date)']]);
}

function taxCsv(start) {
  const s = taxSummary(start);
  exportCsv('Stockroom Self Assessment ' + taxLabel(start), LEDGER_COLUMNS, byDate(s.rows), {total: true});
}

document.addEventListener('change', event => {
  const sel = event.target.closest?.('[data-tax-year]');
  if (!sel) return;
  taxYear = Number(sel.value);
  const card = document.querySelector('.tax-card');
  if (card) card.outerHTML = taxCard();
});
document.addEventListener('click', event => {
  if (event.target.closest('[data-tax-csv]')) {
    taxCsv(taxYear);
  }
  if (event.target.closest('[data-tax-print]')) {
    taxPrint(taxYear);
  }
});
