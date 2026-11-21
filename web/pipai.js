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
