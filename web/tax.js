'use strict';
// Self Assessment helper: UK tax year totals (6 April to 5 April) and a CSV of every line.

// £1,000 up to 2026-27; £3,000 from 6 April 2027 (Finance Bill 2026-27).
const taxAllowance = start => start >= 2027 ? 3000 : 1000;
const taxPounds = n => '£' + n.toLocaleString('en-GB');
let taxYear = null;

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

function taxCard() {
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
    '<div class="tax-actions"><button type="button" class="action" data-tax-csv>Download CSV for ' + taxLabel(taxYear) + '</button><button type="button" class="secondary" data-tax-print>Print summary</button></div>' +
    '<p class="footnote">Stockroom gives you the numbers, not tax advice. Check HMRC guidance or an accountant if you’re unsure which option to use.</p></section>';
}

function taxCsv(start) {
  const s = taxSummary(start);
  const cell = v => { const t = String(v ?? ''); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  const money = v => (Math.round((v || 0) * 100) / 100).toFixed(2);
  const out = [['Date', 'Type', 'Item', 'Money in (£)', 'Cost of goods (£)', 'Expenses (£)', 'Profit (£)'].join(',')];
  for (const r of s.rows.slice().sort((a, b) => a.date.localeCompare(b.date)))
    out.push([r.date, r.kind, r.name, money(r.revenue), money(r.cost), money(r.expense), money((r.revenue || 0) - (r.cost || 0) - (r.expense || 0))].map(cell).join(','));
  out.push('', ['Tax year', taxLabel(start) + ' (' + s.from + ' to ' + s.to + ')'].map(cell).join(','),
    ['Turnover', money(s.turnover)].join(','), ['Cost of goods sold', money(s.goods)].join(','), ['Other allowable expenses', money(s.expenses)].join(','),
    ['Profit using actual costs', money(s.actual)].join(','), ['Profit using ' + taxPounds(s.allowance) + ' trading allowance', money(s.withAllowance)].map(cell).join(','));
  return out.join('\n');
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
    const blob = new Blob([taxCsv(taxYear)], {type: 'text/csv;charset=utf-8'});
    const a = Object.assign(document.createElement('a'), {href: URL.createObjectURL(blob), download: 'stockroom-tax-year-' + taxLabel(taxYear) + '.csv'});
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('CSV downloaded');
  }
  if (event.target.closest('[data-tax-print]')) {
    document.body.classList.add('printing-tax');
    window.print();
    setTimeout(() => document.body.classList.remove('printing-tax'), 500);
  }
});
