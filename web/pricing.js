'use strict';
// Pip's price: what similar pieces actually sold for in your own history.

const PG_STOP = new Set(['the', 'and', 'with', 'a', 'of', 'for', 'in', 'size', 'mens', 'men', 'womens', 'women', 'ladies', 'uk', 's', 'new', 'vintage', 'black', 'white', 'grey', 'gray', 'navy', 'blue', 'red', 'green', 'xs', 'm', 'l', 'xl', 'xxl', 'small', 'medium', 'large']);
const PG_SYN = {qzip: 'quarter zip', quaterzip: 'quarter zip', quarterzip: 'quarter zip', hoody: 'hoodie', tee: 't shirt', tshirt: 't shirt', windcheater: 'windbreaker'};
function pgTokens(text) {
  let t = String(text || '').toLowerCase().replace(/[’']/g, '');
  for (const [a, b] of Object.entries(PG_SYN)) t = t.replace(new RegExp('\\b' + a + '\\b', 'g'), b);
  return new Set(t.replace(/[^a-z0-9]+/g, ' ').split(' ').filter(w => w && !PG_STOP.has(w)));
}
const pgNorm = s => String(s || '').trim().toLowerCase().replace(/^polo\s+/, '');

// Sold pieces with what they went for and how fast.
function pgSoldPieces() {
  const trades = db.trades || [];
  return db.items.filter(item => !item.deletedAt).map(item => {
    const t = trades.filter(x => x.itemId === item.id).at(-1);
    if (t && !t.refunds.at(-1)?.restock) {
      const refunded = t.refunds.reduce((n, r) => n + (r.amount || 0), 0);
      return {item, price: t.amount - refunded, soldAt: t.soldAt, days: item.purchasedAt ? Math.round((Date.parse(t.soldAt) - Date.parse(String(item.purchasedAt).slice(0, 10))) / 86400000) : null};
    }
    if (item.status === 'Sold' && Number.isFinite(item.sale) && item.sale > 0) return {item, price: item.sale, soldAt: item.soldAt, days: null};
    return null;
  }).filter(p => p && p.price > 0);
}

function priceGuide(target) {
  const want = pgTokens([target.name, target.garment].join(' '));
  const brand = pgNorm(target.brand);
  if (!want.size && !brand) return null;
  const scored = pgSoldPieces().filter(p => p.item.id !== target.id).map(p => {
    const have = pgTokens([p.item.name, p.item.garment, p.item.listingTitle].join(' '));
    const common = [...want].filter(w => have.has(w)).length;
    const words = want.size && have.size ? common / Math.min(want.size, have.size) : 0;
    const sameBrand = brand && pgNorm(p.item.brand) && (pgNorm(p.item.brand) === brand || pgNorm(p.item.brand).includes(brand) || brand.includes(pgNorm(p.item.brand)));
    const sameType = target.garment && p.item.garment && pgNorm(p.item.garment) === pgNorm(target.garment);
    const typeOf = it => pgNorm(it.garment) || [...pgTokens(it.name)].find(w => ['hoodie', 'jacket', 'quarter', 'zip', 'jumper', 'sweatshirt', 'shirt', 'shorts', 'trousers', 'jeans', 'coat', 'fleece', 'windbreaker', 'top', 'gilet'].includes(w)) || '';
    const tA = typeOf(target), tB = typeOf(p.item);
    const clash = tA && tB && tA !== tB && !tA.includes(tB) && !tB.includes(tA);
    return {...p, score: words * 0.6 + (sameBrand ? 0.3 : 0) + (sameType ? 0.2 : 0) - (clash ? 0.35 : 0)};
  }).filter(p => p.score >= 0.45).sort((a, b) => b.score - a.score).slice(0, 8);
  if (!scored.length) return null;
  const prices = scored.map(p => p.price).sort((a, b) => a - b);
  const mid = prices.length >> 1;
  const median = prices.length % 2 ? prices[mid] : (prices[mid - 1] + prices[mid]) / 2;
  const days = scored.map(p => p.days).filter(d => d !== null && d >= 0).sort((a, b) => a - b);
  // Round to a Vinted-friendly price (whole pounds, or .50 under £10).
  const suggest = median < 10 ? Math.round(median * 2) / 2 : Math.round(median);
  return {suggest, low: prices[0], high: prices.at(-1), count: scored.length, days: days.length ? days[days.length >> 1] : null, examples: scored.slice(0, 3)};
}

function priceGuideHtml(target, cost) {
  const g = priceGuide(target);
  const community = typeof communityLine === 'function' ? communityLine(target, cost) : '';
  if (!g) return community || '<span class="pg-line pg-ask-row"><span class="pg-pip" aria-hidden="true"></span><span><strong>Not sure what to charge?</strong><small>Pip estimates what it sells for on Vinted.</small></span><button type="button" class="pg-ask" data-pg-ask>Ask Pip</button></span>';
  const profit = Number.isFinite(cost) && cost !== null ? g.suggest - cost : null;
  return '<span class="pg-line"><span class="pg-pip" aria-hidden="true"></span><span><strong>Pip suggests ' + gbp(g.suggest) + '</strong>' +
    '<small>' + g.count + ' similar sale' + (g.count === 1 ? '' : 's') + (g.count > 1 ? ' · ' + gbp(g.low) + '–' + gbp(g.high) : '') + (g.days !== null ? ' · sold in about ' + g.days + ' day' + (g.days === 1 ? '' : 's') : '') +
    (profit !== null ? ' · ' + (profit >= 0 ? '+' : '') + gbp(profit) + ' profit' : '') + '</small>' +
    '<small class="pg-ex">Like: ' + g.examples.map(e => esc(e.item.name) + ' (' + gbp(e.price) + ')').join(', ') + '</small></span>' +
    '<button type="button" class="pg-use" data-pg-use="' + g.suggest + '">Use ' + gbp(g.suggest) + '</button></span>' + community;
}

// Live hint under the price field: Add stock sheet and the full item editor.
let pgTimer = 0;
function pgRefresh(form) {
  const box = form.querySelector('.pg-hint');
  if (!box || !db) return;
  const f = form.elements;
  const target = {id: f.id?.value || '', name: f.name?.value || '', brand: f.brand?.value || '', garment: f.garment?.value || ''};
  const cost = f.cost && f.cost.value !== '' ? Number(String(f.cost.value).replace(/[£,\s]/g, '')) : null;
  box.innerHTML = priceGuideHtml(target, Number.isFinite(cost) ? cost : null);
}
document.addEventListener('input', event => {
  const form = event.target.closest?.('form');
  if (!form || !form.querySelector('.pg-hint') || !['name', 'brand', 'garment', 'cost'].includes(event.target.name)) return;
  clearTimeout(pgTimer); pgTimer = setTimeout(() => pgRefresh(form), 250);
});
document.addEventListener('click', event => {
  const use = event.target.closest('[data-pg-use]');
  if (!use) return;
  const form = use.closest('form'), price = form?.elements.price;
  if (!price) return;
  price.value = Number(use.dataset.pgUse).toFixed(2);
  price.dispatchEvent(new Event('input', {bubbles: true}));
  const row = price.closest('.qa-row, label'); row?.classList.remove('qa-flash'); void row?.offsetWidth; row?.classList.add('qa-flash');
});

// No sales of anything similar yet: ask Pip for an estimate from the details (and first photo).
document.addEventListener('click', async event => {
  const btn = event.target.closest('[data-pg-ask]');
  if (!btn) return;
  const form = btn.closest('form'), f = form?.elements, box = btn.closest('.pg-hint');
  if (!form || !box) return;
  const item = {brand: f.brand?.value || '', garment: f.garment?.value || '', name: f.name?.value || '', size: f.size?.value || '', color: f.color?.value || '', condition: f.condition?.value || (form.querySelector('[data-qa-cond][aria-pressed="true"]')?.dataset.qaCond || ''), flaws: f.flaws?.value || ''};
  const photo = (typeof quick !== 'undefined' && form.id === 'quickAddForm' ? quick.photos?.[0] : (typeof draftPhotos !== 'undefined' ? draftPhotos?.[0] : '')) || '';
  btn.disabled = true; btn.textContent = 'Pricing…';
  try {
    const r = await api('/api/pip/price', {method: 'POST', body: JSON.stringify({item, ...(String(photo).startsWith('data:image/') ? {photo} : {})})});
    const cost = f.cost && f.cost.value !== '' ? Number(String(f.cost.value).replace(/[£,\s]/g, '')) : null;
    const profit = Number.isFinite(cost) && cost !== null ? r.suggested - cost : null;
    box.innerHTML = '<span class="pg-line"><span class="pg-pip" aria-hidden="true"></span><span><strong>Pip suggests ' + gbp(r.suggested) + '</strong>' +
      '<small>Usually sells for ' + gbp(r.low) + '–' + gbp(r.high) + (r.community?.days != null ? ' · sells in about ' + r.community.days + ' days' : '') + (profit !== null ? ' · ' + (profit >= 0 ? '+' : '') + gbp(profit) + ' profit' : '') + '</small>' +
      (r.why ? '<small class="pg-why">' + esc(r.why) + '</small>' : '') + '</span><button type="button" class="pg-use" data-pg-use="' + r.suggested + '">Use ' + gbp(r.suggested) + '</button></span>';
  } catch (error) { btn.disabled = false; btn.textContent = 'Ask Pip'; if (error.status === 402 && typeof openUpgrade === 'function') openUpgrade(error.message); else toast(error.message || 'Pip couldn’t price that.'); }
});
