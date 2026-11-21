// Pip's AI helpers in the app: offer advice (more to come: Ask Pip, buy-or-pass).
function pipStats() {
  const pieces = typeof pfPieces === 'function' ? pfPieces() : [];
  const sold = pieces.filter(p => p.state === 'sold');
  const days = sold.map(p => p.daysToSell).filter(Number.isFinite).sort((a, b) => a - b);
  const discounts = sold.filter(p => Number(p.item.price) > 0 && Number.isFinite(p.revenue)).map(p => 100 * (p.item.price - p.revenue) / p.item.price);
  return {medianDaysToSell: days.length ? days[Math.floor(days.length / 2)] : null,
    typicalDiscount: discounts.length ? discounts.reduce((a, b) => a + b, 0) / discounts.length : null};
}

document.addEventListener('click', async event => {
  const button = event.target.closest('[data-pip-offer]');
  if (!button) return;
  if (account?.plan !== 'pro') { openUpgrade('Pip’s offer advice is part of Stockroom Pro.'); return; }
  const item = db.items.find(row => row.id === openTradeItem); if (!item) return;
  const fields = $('tradeForm').elements, box = $('offerPip');
  const expenses = total(db.expenses.filter(row => row[6] === item.id), row => row[1]);
  const offer = Number(fields.amount.value);
  if (!(offer > 0)) { toast('Enter the offer amount first.'); fields.amount.focus(); return; }
  button.disabled = true; box.hidden = false; box.className = 'offer-pip thinking';
  box.innerHTML = '<span class="qa-pip"></span><div><strong>Pip is weighing it up…</strong><small>Checking your margin and how fast this kind of item sells.</small></div>';
  try {
    const r = await api('/api/pip/offer', {method: 'POST', body: JSON.stringify({
      name: item.name, brand: item.brand, size: item.size, condition: item.condition,
      cost: item.cost + expenses + Number(fields.extra.value || 0), asking: item.price, offer, goal: Number(fields.goal.value || 0),
      daysListed: typeof daysListed === 'function' ? daysListed(item) : null, message: fields.buyerMessage.value, ...pipStats()})});
    const label = {accept: 'Accept', counter: 'Counter at ' + gbp(r.counter), decline: 'Decline'}[r.verdict];
    box.className = 'offer-pip ' + r.verdict;
    box.innerHTML = '<div class="offer-verdict"><b>' + esc(label) + '</b><small>' + (r.verdict === 'counter' ? 'You’d make ' + gbp(r.counterProfit) : 'You’d make ' + gbp(r.profit)) + '</small></div>' +
      '<p>' + esc(r.reason) + '</p>' + (r.reply ? '<div class="offer-reply"><span class="eyebrow">Reply to send</span><p>' + esc(r.reply) + '</p><button type="button" class="secondary" data-copy-offer>Copy reply</button></div>' : '');
    box.querySelector('[data-copy-offer]')?.addEventListener('click', async e => { try { await navigator.clipboard.writeText(r.reply); e.target.textContent = 'Copied'; } catch { toast('Couldn’t copy. Select the text instead.'); } });
  } catch (error) { box.className = 'offer-pip'; box.innerHTML = '<p>' + esc(error.message) + '</p>'; }
  finally { button.disabled = false; }
});

// ---------- Ask Pip: chat about your own numbers ----------
let askPipLog = [], askPipBusy = false;
const askPipFormat = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').split('\n').map(line => /^\s*[-•]\s+/.test(line) ? '<li>' + line.replace(/^\s*[-•]\s+/, '') + '</li>' : line ? '<p>' + line + '</p>' : '').join('').replace(/(<li>.*?<\/li>)+/g, m => '<ul>' + m + '</ul>');
function askPipSheet() {
  let d = document.getElementById('askPipDialog');
  if (d) return d;
  d = document.createElement('dialog'); d.id = 'askPipDialog'; d.className = 'utility-dialog ask-pip-dialog';
  d.innerHTML = '<div class="sheet-heading"><div class="ask-pip-head"><img src="/pip.svg" alt="" width="40" height="38"><div><span class="eyebrow">ASK PIP</span><h2>Your numbers, answered</h2></div></div><button type="button" class="close-panel" data-close-dialog="askPipDialog" aria-label="Close">×</button></div>' +
    '<div class="ask-pip-log" id="askPipLog" aria-live="polite"></div>' +
    '<form class="ask-pip-bar in-sheet" data-ask-pip-form><input name="q" autocomplete="off" maxlength="500" placeholder="Ask a follow-up…" aria-label="Ask Pip"><button type="submit" aria-label="Ask">↑</button></form>';
  document.body.append(d);
  return d;
}
function askPipRender() {
  const log = document.getElementById('askPipLog'); if (!log) return;
  log.innerHTML = askPipLog.map((t, i) => '<div class="ask-q">' + esc(t.q) + '</div>' +
    (t.a == null ? '<div class="ask-a thinking"><span class="qa-pip"></span><span>Pip is looking through your numbers…</span></div>'
      : '<div class="ask-a' + (t.error ? ' error' : '') + '">' + askPipFormat(t.a) + '</div>' +
        (i === askPipLog.length - 1 && t.suggestions?.length ? '<div class="ask-pip-starters">' + t.suggestions.map(q => '<button type="button" data-ask-pip="' + esc(q) + '">' + esc(q) + '</button>').join('') + '</div>' : ''))).join('');
  log.scrollTop = log.scrollHeight;
}
async function askPip(question) {
  question = String(question || '').trim(); if (!question || askPipBusy) return;
  if (account?.plan !== 'pro') { openUpgrade('Ask Pip is part of Stockroom Pro.'); return; }
  const d = askPipSheet(); if (!d.open) d.showModal();
  askPipBusy = true;
  const history = askPipLog.filter(t => t.a && !t.error).slice(-6).map(t => ({q: t.q, a: t.a}));
  const turn = {q: question, a: null}; askPipLog.push(turn); askPipRender();
  try { const r = await api('/api/pip/ask', {method: 'POST', body: JSON.stringify({question, history})}); turn.a = r.answer; turn.suggestions = r.suggestions; }
  catch (error) { turn.a = error.message; turn.error = true; }
  askPipBusy = false; askPipRender();
  d.querySelector('[data-ask-pip-form] input')?.focus();
}
document.addEventListener('submit', event => {
  const form = event.target.closest('[data-ask-pip-form]'); if (!form) return;
  event.preventDefault(); const input = form.elements.q; const q = input.value; input.value = ''; void askPip(q);
});
document.addEventListener('click', event => { const b = event.target.closest('[data-ask-pip]'); if (b) void askPip(b.dataset.askPip); });

// ---------- Buy-or-pass scanner ----------
let scanState = {photo: null, result: null, busy: false};
function scanSheet() {
  let d = document.getElementById('scanDialog');
  if (d) return d;
  d = document.createElement('dialog'); d.id = 'scanDialog'; d.className = 'utility-dialog scan-dialog';
  document.body.append(d);
  return d;
}
function scanRender() {
  const d = scanSheet(), s = scanState, r = s.result;
  const verdictText = r ? ({buy: 'Buy it', maybe: 'Only if you love it', pass: 'Pass', unknown: 'Pay up to ' + gbp(r.maxBuy)})[r.verdict] : '';
  d.innerHTML = '<div class="sheet-heading"><div><span class="eyebrow">BUY OR PASS</span><h2>' + (r ? esc(r.name) : 'Snap the item') + '</h2></div><button type="button" class="close-panel" data-close-dialog="scanDialog" aria-label="Close">×</button></div>' +
    (s.photo ? '<div class="scan-photo"><img src="' + s.photo + '" alt="Item photo">' + (s.busy ? '<div class="scan-sweep"></div>' : '') + '</div>'
      : '<label class="scan-drop"><input type="file" accept="image/*" capture="environment" id="scanFile" hidden><span class="scan-drop-icon">📷</span><b>Take a photo</b><small>The item, or its label for a sharper answer</small></label>') +
    '<label class="scan-price">Price in the shop <small>optional</small><input type="number" inputmode="decimal" min="0" step="0.01" id="scanPrice" placeholder="e.g. 4.00" value="' + (s.price ?? '') + '"></label>' +
    (s.busy ? '<div class="offer-pip thinking"><span class="qa-pip"></span><div><strong>Pip is pricing it…</strong><small>Checking the brand, Vinted prices and your own sales.</small></div></div>' : '') +
    (r ? '<div class="scan-result ' + r.verdict + '"><div class="scan-verdict"><b>' + esc(verdictText) + '</b>' + (r.price != null ? '<small>' + (r.profitAtPrice >= 0 ? 'About ' + gbp(r.profitAtPrice) + ' profit' : 'You’d lose money') + '</small>' : '') + '</div>' +
      '<div class="metrics scan-figs"><div class="metric"><span>Likely sells for</span><strong>' + gbp(r.low) + '–' + gbp(r.high).slice(1) + '</strong><small>' + esc(r.confidence) + ' confidence</small></div><div class="metric"><span>Pay up to</span><strong>' + gbp(r.maxBuy) + '</strong><small>To make it worth it</small></div></div>' +
      '<p class="scan-reason">' + esc(r.reason) + '</p>' +
      (r.yourHistory ? '<p class="scan-history">You’ve sold <b>' + r.yourHistory.sold + '</b> ' + esc(r.brand) + (r.yourHistory.avgSale != null ? ' at <b>' + gbp(r.yourHistory.avgSale) + '</b> on average' : '') + (r.yourHistory.medianDaysToSell != null ? ', usually in ' + r.yourHistory.medianDaysToSell + ' days' : '') + (r.yourHistory.inStock ? '. ' + r.yourHistory.inStock + ' still in stock.' : '.') + '</p>' : '') +
      (r.checks.length ? '<ul class="scan-checks">' + r.checks.map(c => '<li>' + esc(c) + '</li>').join('') + '</ul>' : '') + '</div>' : '') +
    '<p class="footnote" id="scanError" role="alert">' + esc(s.error || '') + '</p>' +
    (r ? '<div class="scan-actions"><button type="button" class="action" data-scan-bought>I bought it · add to stock</button><button type="button" class="secondary" data-scan-again>Scan another</button></div>'
      : s.photo && !s.busy ? '<button type="button" class="action scan-go" data-scan-go>Ask Pip</button><button type="button" class="link" data-scan-again>Retake photo</button>' : '');
}
async function scanResize(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, fail) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => fail(Error('Couldn’t open that photo.')); i.src = url; });
    const scale = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', .85);
  } finally { URL.revokeObjectURL(url); }
}
function openScan() {
  if (account?.plan !== 'pro') { openUpgrade('Buy or pass is part of Stockroom Pro.'); return; }
  scanState = {photo: null, result: null, busy: false}; scanRender();
  const d = scanSheet(); if (!d.open) d.showModal();
}
async function runScan() {
  scanState.busy = true; scanState.error = ''; scanRender();
  try { scanState.result = await api('/api/pip/scan', {method: 'POST', body: JSON.stringify({image: scanState.photo, price: scanState.price})}); }
  catch (error) { scanState.error = error.message; }
  scanState.busy = false; scanRender();
}
document.addEventListener('input', event => {
  if (event.target.id !== 'scanPrice') return;
  const v = event.target.value.trim(); scanState.price = v === '' || !(Number(v) >= 0) ? null : Number(v);
});
document.addEventListener('change', async event => {
  if (event.target.id !== 'scanFile' || !event.target.files[0]) return;
  try { scanState.photo = await scanResize(event.target.files[0]); scanRender(); void runScan(); } catch (error) { scanState.error = error.message; scanRender(); }
});
document.addEventListener('click', event => {
  if (event.target.closest('[data-scan-open]')) { openScan(); return; }
  if (event.target.closest('[data-scan-go]')) { void runScan(); return; }
  if (event.target.closest('[data-scan-again]')) { scanState = {photo: null, result: null, busy: false}; scanRender(); return; }
  if (event.target.closest('[data-scan-bought]') && scanState.result) {
    const r = scanState.result, price = scanState.price;
    document.getElementById('scanDialog').close();
    openItem(null);
    setTimeout(() => {
      const form = document.getElementById('quickAddForm'); if (!form) return;
      const set = (name, value) => { const el = form.elements[name]; if (el && value != null && value !== '' && !el.value) el.value = value; };
      set('name', r.name); set('brand', r.brand); set('garment', r.category); if (price != null) set('cost', price.toFixed(2));
      set('price', Math.round((r.low + r.high) / 2));
      form.dispatchEvent(new Event('input', {bubbles: true}));
    }, 60);
  }
});
