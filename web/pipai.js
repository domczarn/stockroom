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
