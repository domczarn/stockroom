'use strict';
// Professional exports: one CSV writer and one print layout for every report Stockroom produces.

// ---------- CSV ----------
// UTF-8 with BOM (Excel shows £ and accents correctly), CRLF line endings, ISO dates, money as plain 2-dp numbers.
// Text that starts like a formula is escaped so spreadsheets never run it.
function exportCell(value, type) {
  if (value === null || value === undefined || value === '') return '';
  if (type === 'money') { const n = Number(value); return Number.isFinite(n) ? (Math.round(n * 100) / 100).toFixed(2) : ''; }
  if (type === 'date') return /^\d{4}-\d{2}-\d{2}/.test(String(value)) ? String(value).slice(0, 10) : '';
  if (type === 'number') return Number.isFinite(Number(value)) ? String(value) : '';
  let text = String(value).replace(/\r?\n/g, ' ').trim();
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return /[",]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}
// columns: [{label, type: 'text'|'money'|'date'|'number', get: row => value}]; totals: labels of money columns to sum.
function exportCsv(filename, columns, rows, {total = false} = {}) {
  const lines = [columns.map(c => exportCell(c.label)).join(',')];
  for (const row of rows) lines.push(columns.map(c => exportCell(c.get(row), c.type)).join(','));
  if (total && rows.length) lines.push(columns.map((c, i) => i === 0 ? 'TOTAL' : c.type === 'money' ? exportCell(rows.reduce((n, r) => n + (Number(c.get(r)) || 0), 0), 'money') : '').join(','));
  const blob = new Blob(['﻿' + lines.join('\r\n') + '\r\n'], {type: 'text/csv;charset=utf-8'});
  const a = Object.assign(document.createElement('a'), {href: URL.createObjectURL(blob), download: filename.replace(/[\\/:*?"<>|]+/g, '-') + '.csv'});
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  if (typeof toast === 'function') toast('Downloaded ' + a.download);
}
const exportStamp = () => new Date().toLocaleDateString('en-GB', {day: 'numeric', month: 'long', year: 'numeric'});

// ---------- Print ----------
// Builds a clean A4 document (#printDoc) and prints only that. The app is display:none while printing,
// so nothing behind it adds blank pages. Styles live in app.css (page rules block inline styles).
const printMoney = n => n === null || n === undefined || !Number.isFinite(Number(n)) ? '–' : (Number(n) < 0 ? '−£' : '£') + Math.abs(Number(n)).toLocaleString('en-GB', {minimumFractionDigits: 2, maximumFractionDigits: 2});
function printTable(head, rows, {foot, numeric = []} = {}) {
  const cls = i => numeric.includes(i) ? ' class="num"' : '';
  return '<table><thead><tr>' + head.map((h, i) => '<th' + cls(i) + '>' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' +
    rows.map(r => '<tr>' + r.map((c, i) => '<td' + cls(i) + '>' + c + '</td>').join('') + '</tr>').join('') + '</tbody>' +
    (foot ? '<tfoot><tr>' + foot.map((c, i) => '<td' + cls(i) + '>' + c + '</td>').join('') + '</tr></tfoot>' : '') + '</table>';
}
function printDocument(title, subtitle, sections, meta = []) {
  document.getElementById('printDoc')?.remove();
  const doc = document.createElement('div');
  doc.id = 'printDoc';
  doc.innerHTML =
    '<header class="pd-head"><div><p class="pd-brand">Booked &amp; Paid Stockroom</p><h1>' + esc(title) + '</h1>' + (subtitle ? '<p class="pd-sub">' + esc(subtitle) + '</p>' : '') + '</div>' +
      '<dl class="pd-meta">' + [...meta, ['Prepared', exportStamp()]].map(([k, v]) => '<div><dt>' + esc(k) + '</dt><dd>' + esc(v) + '</dd></div>').join('') + '</dl></header>' +
    sections.join('');
  document.body.append(doc);
  document.body.classList.add('printing-doc');
  const done = () => { document.body.classList.remove('printing-doc'); doc.remove(); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  // Print styles only apply while printing, so leaving the class on screen is harmless (iOS fires afterprint late).
  setTimeout(() => window.print(), 50);
}
