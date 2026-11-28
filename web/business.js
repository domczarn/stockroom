'use strict';
// Business details: sole trader or limited company. Drives which bookkeeping and tax screens appear.
// Stored in the workspace as db.business (optional; missing means "not set up yet", treated as sole trader).

const PAID_BY = {
  ltd: [['company', 'Company account'], ['director-card', 'Director personal card'], ['director-cash', 'Director cash']],
  sole: [['business', 'Business account'], ['personal', 'Personal']],
};
const PURCHASE_SOURCES = ['Vinted', 'Charity shop', 'Car boot', 'Kilo sale', 'eBay', 'Depop', 'Wholesale', 'Market', 'Other'];

function business() {
  const b = (typeof db !== 'undefined' && db?.business) || {};
  const structure = b.structure === 'ltd' ? 'ltd' : 'sole';
  const pot = Number.isFinite(b.taxPot) ? b.taxPot : ratesOn(todayUK()).taxPot[structure];
  return {...b, structure, taxPot: pot, setUp: Boolean(b.structure)};
}
const isLtd = () => business().structure === 'ltd';
const paidByOptions = () => PAID_BY[business().structure];
const paidByLabel = value => [...PAID_BY.ltd, ...PAID_BY.sole].find(([v]) => v === value)?.[1] || '';
// Paid by the director personally: the company owes it back (director's loan credit).
const paidByDirector = value => value === 'director-card' || value === 'director-cash';

function businessPanel() {
  const b = business(), ltd = b.structure === 'ltd', num = v => Number.isFinite(v) ? v : '';
  const yearEnd = b.yearEnd ? '2000-' + b.yearEnd : '';
  const row = (label, input, hint = '', only = '') => '<label class="biz-field"' + (only ? ' data-biz-only="' + only + '"' + ((only === 'ltd') !== ltd ? ' hidden' : '') : '') + '><span>' + label + '</span>' + input + (hint ? '<small>' + hint + '</small>' : '') + '</label>';
  return '<form id="businessForm" class="biz-form" novalidate>' +
    '<fieldset class="biz-structure"><legend>Business structure</legend><div class="stock-view-switch" role="radiogroup" aria-label="Business structure">' +
      [['sole', 'Sole trader'], ['ltd', 'Limited company']].map(([v, l]) => '<button type="button" role="radio" data-biz-structure="' + v + '" aria-checked="' + (b.structure === v) + '" aria-pressed="' + (b.structure === v) + '">' + l + '</button>').join('') +
    '</div><input type="hidden" name="structure" value="' + b.structure + '"></fieldset>' +
    row('Business name', '<input name="name" maxlength="160" autocomplete="organization" value="' + esc(b.name || '') + '" placeholder="Trading or company name">') +
    row('Company number', '<input name="companyNumber" maxlength="8" inputmode="text" autocapitalize="characters" value="' + esc(b.companyNumber || '') + '" placeholder="8 characters, e.g. 12345678">', '', 'ltd') +
    row('Company year end', '<input name="yearEnd" type="date" value="' + yearEnd + '">', 'Only the day and month are used. The tax year is always 6 April to 5 April.', 'ltd') +
    row('Profit kept from earlier years (£)', '<input name="retainedProfit" type="number" inputmode="decimal" step=".01" value="' + num(b.retainedProfit) + '" placeholder="0">', 'Retained profit brought forward, from your last accounts. Used to check dividends.', 'ltd') +
    row('Other company profit this year (£)', '<input name="otherCompanyProfit" type="number" inputmode="decimal" step=".01" value="' + num(b.otherCompanyProfit) + '" placeholder="0">', 'Profit from anything else the company does. Sets the corporation tax rate.', 'ltd') +
    row('Your other income this tax year (£)', '<input name="otherIncome" type="number" inputmode="decimal" min="0" step="100" value="' + num(b.otherIncome) + '" placeholder="e.g. 24000">', 'Job pay or pension before tax. Sets your income tax band.') +
    row('Tax pot', '<span class="biz-suffix"><input name="taxPot" type="number" inputmode="decimal" min="0" max="60" step="1" value="' + b.taxPot + '">%</span>', 'Share of profit to set aside for tax. Suggested: ' + ratesOn(todayUK()).taxPot.ltd + '% for a company, ' + ratesOn(todayUK()).taxPot.sole + '% for a sole trader.') +
    '<label class="adm-switch biz-switch"><input type="checkbox" name="vat"' + (b.vat ? ' checked' : '') + '><span></span><div><b>VAT registered</b><small>Turn on only if you have a VAT number.</small></div></label>' +
    '<label class="adm-switch biz-switch" data-biz-only="ltd"' + (ltd ? '' : ' hidden') + '><input type="checkbox" name="useOfHome"' + (b.useOfHome ? ' checked' : '') + '><span></span><div><b>Use-of-home allowance</b><small>£' + ratesOn(todayUK()).useOfHomeWeekly + ' a week the company owes you for working from home.</small></div></label>' +
    '<p class="biz-error" id="businessError" role="alert"></p>' +
    '<div class="biz-actions"><button class="action" id="businessSave">Save business details</button></div>' +
    '<p class="footnote">Tax rates last updated ' + new Date(RATES_UPDATED + 'T12:00:00Z').toLocaleDateString('en-GB', {day: 'numeric', month: 'long', year: 'numeric'}) + '. Estimates only, not tax advice.</p>' +
  '</form>';
}

document.addEventListener('click', event => {
  const pick = event.target.closest('[data-biz-structure]');
  if (!pick) return;
  const form = pick.closest('form'), value = pick.dataset.bizStructure;
  form.elements.structure.value = value;
  form.querySelectorAll('[data-biz-structure]').forEach(b => { const on = b === pick; b.setAttribute('aria-pressed', String(on)); b.setAttribute('aria-checked', String(on)); });
  form.querySelectorAll('[data-biz-only]').forEach(el => { el.hidden = el.dataset.bizOnly !== value; });
  const pot = form.elements.taxPot, defaults = ratesOn(todayUK()).taxPot;
  if (!pot.dataset.touched) pot.value = defaults[value];
});
document.addEventListener('input', event => { if (event.target.name === 'taxPot' && event.target.closest('#businessForm')) event.target.dataset.touched = '1'; });

document.addEventListener('submit', async event => {
  if (event.target.id !== 'businessForm') return;
  event.preventDefault();
  if (typeof isReadOnly === 'function' && isReadOnly()) return;
  const f = event.target.elements, ltd = f.structure.value === 'ltd', err = $('businessError');
  const money = (v, allowNegative = false) => v === '' ? undefined : (Number.isFinite(Number(v)) && (allowNegative || Number(v) >= 0) ? Math.round(Number(v) * 100) / 100 : NaN);
  const next = {structure: ltd ? 'ltd' : 'sole', name: f.name.value.trim(), vat: f.vat.checked,
    otherIncome: money(f.otherIncome.value), taxPot: money(f.taxPot.value)};
  if (ltd) Object.assign(next, {companyNumber: f.companyNumber.value.trim().toUpperCase(), yearEnd: f.yearEnd.value ? f.yearEnd.value.slice(5) : '',
    retainedProfit: money(f.retainedProfit.value, true), otherCompanyProfit: money(f.otherCompanyProfit.value, true), useOfHome: f.useOfHome.checked});
  if (ltd && next.companyNumber && !/^[A-Z0-9]{8}$/.test(next.companyNumber)) { err.textContent = 'A company number is 8 characters, e.g. 12345678 or SC123456.'; return; }
  if (Object.values(next).some(v => Number.isNaN(v))) { err.textContent = 'Check the amounts: numbers only.'; return; }
  if (next.taxPot !== undefined && (next.taxPot < 0 || next.taxPot > 60)) { err.textContent = 'Tax pot must be between 0% and 60%.'; return; }
  for (const k of Object.keys(next)) if (next[k] === undefined || next[k] === '') delete next[k];
  // Keep anything the form doesn't show (e.g. when switching structure, company details stay for later).
  const kept = {...(db.business || {})};
  if (!ltd) for (const k of ['companyNumber', 'yearEnd', 'retainedProfit', 'otherCompanyProfit', 'useOfHome']) if (k in kept) next[k] = kept[k];
  $('businessSave').disabled = true; err.textContent = '';
  try { await persist({...db, business: next}); toast('Business details saved.'); render(); }
  catch (error) { err.textContent = error.message; }
  finally { if ($('businessSave')) $('businessSave').disabled = false; }
});

// Shortcut from other screens straight to Settings → Business.
document.addEventListener('click', event => {
  if (!event.target.closest('[data-open-business]')) return;
  settingsSection = 'business'; navigate('Account'); render();
});

const EXPENSE_CATEGORIES = ['Packaging', 'Postage', 'Platform subscription', 'Promotion', 'Equipment', 'Phone & internet', 'Software', 'Cleaning', 'Repairs', 'Other'];
// Fill a "Paid by" select for the current business structure, keeping an old value that belongs to the other structure.
function fillPaidBy(select, value = '') {
  if (!select) return;
  const options = paidByOptions(), known = options.some(([v]) => v === value);
  select.innerHTML = '<option value="">Not recorded</option>' + options.map(([v, l]) => '<option value="' + v + '">' + l + '</option>').join('') +
    (value && !known ? '<option value="' + esc(value) + '">' + esc(paidByLabel(value) || value) + '</option>' : '');
  select.value = value || '';
}
function fillPurchaseSource(select, value = '') {
  if (!select) return;
  const list = value && !PURCHASE_SOURCES.includes(value) ? [...PURCHASE_SOURCES, value] : PURCHASE_SOURCES;
  select.innerHTML = '<option value="">Choose where</option>' + list.map(v => '<option>' + esc(v) + '</option>').join('');
  select.value = value || '';
}
// Receipt picker: shows a thumbnail, stores the photo (compressed) in a hidden input; the server moves it to private storage.
function setReceipt(box, url) {
  if (!box) return;
  const hidden = box.querySelector('input[type=hidden]'), img = box.querySelector('.receipt-thumb'), remove = box.querySelector('[data-receipt-remove]'), pick = box.querySelector('.receipt-pick');
  hidden.value = url || '';
  img.hidden = !url; if (url) img.src = url; else img.removeAttribute('src');
  remove.hidden = !url;
  pick.firstChild.textContent = url ? 'Replace photo' : 'Add receipt photo';
}
document.addEventListener('change', async event => {
  const input = event.target.closest?.('[data-receipt-input]');
  if (!input || !input.files?.[0]) return;
  const box = input.closest('.receipt-field');
  try { setReceipt(box, await compressPhoto(input.files[0])); }
  catch (error) { toast(error.message); }
  finally { input.value = ''; }
});
document.addEventListener('click', event => {
  const remove = event.target.closest('[data-receipt-remove]');
  if (remove) setReceipt(remove.closest('.receipt-field'), '');
});

// ---------- Live spreadsheet links (Settings → Data & backups) ----------
const FEED_NAMES = [['sold', 'Sold items'], ['stock', 'Stock on hand'], ['expenses', 'Expenses']];
async function loadFeeds(reset = false) {
  const box = $('feedsList');
  if (!box) return;
  try {
    const r = await fetch('/api/feeds', {method: reset ? 'POST' : 'GET', credentials: 'same-origin'});
    if (!r.ok) throw Error('Could not load your links.');
    const {links} = await r.json();
    box.innerHTML = FEED_NAMES.map(([k, label]) => '<div class="feed-row"><span><b>' + label + '</b><code>' + esc(links[k]) + '</code></span><button type="button" class="secondary" data-feed-copy="' + esc(links[k]) + '">Copy link</button></div>').join('') +
      '<details class="feed-how"><summary>How to set it up</summary><ul>' +
        '<li><b>Google Sheets:</b> new sheet → one tab per link → in cell A1 type <code>=IMPORTDATA("</code> paste the link <code>")</code> → Enter. It refreshes about every hour.</li>' +
        '<li><b>Excel:</b> Data → From Web → paste the link → Load. Refresh with Data → Refresh All.</li>' +
        '<li>Anyone with a link can see that data. Don’t share them. If one leaks, reset them.</li></ul></details>' +
      '<button type="button" class="link" data-feed-reset>Reset links (old ones stop working)</button>';
  } catch (error) { box.innerHTML = '<p class="footnote">' + esc(error.message) + '</p>'; }
}
document.addEventListener('click', async event => {
  const copy = event.target.closest('[data-feed-copy]');
  if (copy) { try { await navigator.clipboard.writeText(copy.dataset.feedCopy); toast('Link copied.'); } catch { toast('Copy failed. Press and hold the link to copy it.'); } return; }
  if (event.target.closest('[data-feed-reset]') && confirmReset()) void loadFeeds(true).then(() => toast('New links made. Update your spreadsheet.'));
});
function confirmReset() { return window.confirm ? window.confirm('Reset your spreadsheet links? Spreadsheets using the old links will stop updating until you paste the new ones.') : true; }
