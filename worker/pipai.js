// Pip's AI helpers: offer advice, Ask Pip chat, buy-or-pass verdicts and the weekly report.
import {lookupIndex, garmentType} from './grow.js';
import {HttpError, readBody} from './security.js';
import {ask, jsonFrom, aiAllowance, imageFromDataUrl} from './llm.js';
import seed from './market-seed.json' with {type: 'json'};
import {loadWorkspace} from './workspace-store.js';

const money = v => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n < 100000 ? Math.round(n * 100) / 100 : null; };
const text = (v, max) => typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';
// Claude sometimes returns a list or object where we asked for text: turn it into readable lines.
export function flat(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map(x => { const t = flat(x); return /^\s*[-•]/.test(t) || t.includes('\n') ? t : '- ' + t; }).join('\n');
  if (typeof v === 'object') return Object.entries(v).map(([k, x]) => '- **' + k.replace(/_/g, ' ') + '**: ' + flat(x).replace(/\n/g, ' ')).join('\n');
  return '';
}
const gbp = n => '£' + (Math.round(n * 100) / 100).toFixed(2);
const VINTED_RULES = 'Context: UK Vinted seller. Sellers pay no selling fee; the buyer pays postage and buyer protection, so the seller keeps the full item price.';

// ---------- Offer helper ----------
export async function offerRoute(request, env, user) {
  if (request.method !== 'POST') throw new HttpError(405, 'Method not allowed.');
  const body = await readBody(request, 20000) || {};
  const offer = money(body.offer), cost = money(body.cost), asking = money(body.asking);
  if (offer == null || offer <= 0) throw new HttpError(400, 'Enter the offer amount.');
  if (cost == null) throw new HttpError(400, 'This item needs a purchase cost first.');
  const days = Number.isInteger(body.daysListed) && body.daysListed >= 0 ? body.daysListed : null;
  const goal = money(body.goal) ?? 0;
  const facts = {
    item: text(body.name, 120), brand: text(body.brand, 60), size: text(body.size, 20), condition: text(body.condition, 40),
    cost, asking, offer, days, goal, message: text(body.message, 800),
    medianDays: Number.isFinite(body.medianDaysToSell) ? Math.round(body.medianDaysToSell) : null,
    typicalDiscount: Number.isFinite(body.typicalDiscount) ? Math.round(body.typicalDiscount) : null,
  };
  // Hard maths first, so the advice can never lose money by mistake.
  const floor = Math.ceil((cost + Math.max(1, goal * .5)) * 2) / 2; // never counter below cost plus a little
  const profit = offer - cost;
  let verdict = asking != null && offer >= asking ? 'accept' : profit <= 0 ? 'decline' : null;
  await aiAllowance(env, user);
  const prompt = `${VINTED_RULES}
You are Pip, a sharp, friendly reselling coach. Decide how the seller should respond to a buyer's offer.
Facts:
- Item: ${facts.item || 'unknown'}${facts.brand ? ' (' + facts.brand + ')' : ''}${facts.size ? ', size ' + facts.size : ''}${facts.condition ? ', ' + facts.condition : ''}
- Seller paid: ${gbp(cost)}. Asking price: ${asking != null ? gbp(asking) : 'not set'}. Offer: ${gbp(offer)} (profit ${gbp(profit)}).
- Listed for: ${days != null ? days + ' days' : 'unknown'}. Seller's median days to sell: ${facts.medianDays ?? 'unknown'}. Seller usually sells ${facts.typicalDiscount != null ? facts.typicalDiscount + '% below asking' : 'at an unknown discount'}.
- Seller's target profit per item: ${gbp(goal)}. Never suggest a counter below ${gbp(floor)}.
${facts.message ? '- Buyer wrote: "' + facts.message + '"' : ''}
${verdict ? 'The decision is already "' + verdict + '"; explain it and write the reply.' : ''}
Reply with ONLY JSON: {"verdict": "accept" | "counter" | "decline", "counter": number or null, "reason": string (max 2 short sentences, mention profit in £), "reply": string (the message to send the buyer: British English, friendly, max 45 words, no emojis unless the buyer used them)}`;
  const data = jsonFrom(await ask(env, {prompt, maxTokens: 400, temperature: .4}), 'Pip couldn’t weigh that up. Try again.');
  verdict = verdict || (['accept', 'counter', 'decline'].includes(data.verdict) ? data.verdict : 'counter');
  let counter = verdict === 'counter' ? money(data.counter) : null;
  if (verdict === 'counter') {
    if (counter == null || counter <= offer) counter = Math.max(floor, Math.round((offer + (asking ?? offer * 1.2)) / 2));
    if (asking != null) counter = Math.min(counter, asking);
    counter = Math.max(counter, floor);
    if (counter <= offer) verdict = 'accept', counter = null;
  }
  // If the maths overruled Pip, swap in wording that matches the final decision.
  let reason = text(flat(data.reason), 300), reply = flat(data.reply).trim().slice(0, 600);
  const claudeCounter = money(data.counter);
  if (verdict !== data.verdict || (verdict === 'counter' && claudeCounter !== counter)) {
    if (verdict === 'accept') { reason = 'That leaves you ' + gbp(profit) + ' profit, so it’s worth taking.'; reply = 'Hi! Yes, happy to accept that. I’ll get it posted quickly.'; }
    else if (verdict === 'decline') { reason = 'At ' + gbp(offer) + ' you’d lose ' + gbp(-profit) + ' on what you paid.'; reply = 'Hi, thanks for the offer, but I can’t go that low on this one. ' + (asking != null ? 'The lowest I could do is ' + gbp(Math.max(floor, Math.min(asking, floor + 2))) + '.' : ''); }
    else { reason = 'Countering at ' + gbp(counter) + ' still makes you ' + gbp(counter - cost) + '.'; reply = 'Hi! Thanks for the offer. The lowest I can do is ' + gbp(counter) + '. Happy to post quickly if that works?'; }
  }
  return {verdict, counter, profit: Math.round(profit * 100) / 100, counterProfit: counter != null ? Math.round((counter - cost) * 100) / 100 : null, reason, reply};
}

// ---------- Shared: a compact, factual digest of someone's workspace ----------
export function workspaceDigest(data, now = Date.now()) {
  const trades = new Map((data.trades || []).map(t => [t.itemId, t]));
  const day = 86400000, round = n => Math.round(n * 100) / 100;
  const days = (a, b) => { const x = Date.parse(a), y = Date.parse(b); return Number.isFinite(x) && Number.isFinite(y) && y >= x ? Math.round((y - x) / day) : null; };
  const pieces = (data.items || []).filter(i => !i.deletedAt).map(item => {
    const trade = trades.get(item.id);
    const sold = item.status === 'Sold';
    const revenue = sold ? Number(trade?.amount ?? item.sale) : null;
    const soldAt = sold ? (trade?.soldAt || item.soldAt || null) : null;
    return {name: item.name, brand: item.brand || 'Unbranded', type: item.garment || 'Other', size: item.size || '', status: item.status,
      cost: Number(item.cost) || 0, asking: Number.isFinite(item.price) ? item.price : null, revenue: Number.isFinite(revenue) ? revenue : null,
      profit: Number.isFinite(revenue) ? round(revenue - (Number(item.cost) || 0)) : null, boughtAt: item.purchasedAt || null, listedAt: item.listedAt || null, soldAt,
      daysToSell: sold ? days(item.purchasedAt, soldAt) : null, daysListed: !sold && item.listedAt ? days(item.listedAt, new Date(now).toISOString()) : null};
  });
  const sold = pieces.filter(p => p.revenue != null);
  const group = key => Object.values(pieces.reduce((acc, p) => {
    const g = acc[p[key]] ||= {name: p[key], bought: 0, sold: 0, revenue: 0, profit: 0, inStock: 0, daysToSell: []};
    g.bought++; if (p.status === 'In Stock') g.inStock++;
    if (p.revenue != null) { g.sold++; g.revenue += p.revenue; g.profit += p.profit; if (p.daysToSell != null) g.daysToSell.push(p.daysToSell); }
    return acc;
  }, {})).map(g => ({...g, revenue: round(g.revenue), profit: round(g.profit), medianDaysToSell: g.daysToSell.length ? g.daysToSell.sort((a, b) => a - b)[Math.floor(g.daysToSell.length / 2)] : null, daysToSell: undefined}))
    .sort((a, b) => b.revenue - a.revenue);
  const months = Object.values(sold.reduce((acc, p) => {
    const m = (p.soldAt || '').slice(0, 7) || 'undated';
    const g = acc[m] ||= {month: m, sold: 0, revenue: 0, profit: 0};
    g.sold++; g.revenue = round(g.revenue + p.revenue); g.profit = round(g.profit + p.profit); return acc;
  }, {})).sort((a, b) => a.month.localeCompare(b.month)).slice(-12);
  const expenses = (data.expenses || []).reduce((s, r) => s + (Number(r[1]) || 0), 0);
  return {
    today: new Date(now).toISOString().slice(0, 10),
    totals: {items: pieces.length, sold: sold.length, inStock: pieces.filter(p => p.status === 'In Stock').length, revenue: round(sold.reduce((s, p) => s + p.revenue, 0)),
      itemProfit: round(sold.reduce((s, p) => s + p.profit, 0)), businessExpenses: round(expenses), stockAtCost: round(pieces.filter(p => p.status === 'In Stock').reduce((s, p) => s + p.cost, 0))},
    byMonth: months, byBrand: group('brand').slice(0, 25), byType: group('type').slice(0, 15),
    recentSales: sold.sort((a, b) => (b.soldAt || '').localeCompare(a.soldAt || '')).slice(0, 25).map(({name, brand, revenue, profit, soldAt, daysToSell}) => ({name, brand, revenue, profit, soldAt, daysToSell})),
    oldestStock: pieces.filter(p => p.status === 'In Stock').sort((a, b) => (a.boughtAt || '').localeCompare(b.boughtAt || '')).slice(0, 25).map(({name, brand, cost, asking, boughtAt, daysListed}) => ({name, brand, cost, asking, boughtAt, daysListed})),
  };
}

// ---------- Ask Pip ----------
export async function askRoute(request, env, user) {
  if (request.method !== 'POST') throw new HttpError(405, 'Method not allowed.');
  const body = await readBody(request, 30000) || {};
  const question = text(body.question, 500);
  if (question.length < 2) throw new HttpError(400, 'Ask Pip a question.');
  const digest = workspaceDigest((await loadWorkspace(env, user.id))?.data || {});
  const history = (Array.isArray(body.history) ? body.history : []).slice(-6).flatMap(turn => [
    {role: 'user', content: text(turn.q, 500)}, {role: 'assistant', content: text(turn.a, 1200)}]).filter(m => m.content);
  await aiAllowance(env, user);
  const system = `${VINTED_RULES}
You are Pip, the assistant inside Booked & Paid Stockroom, a resale stock and profit tracker. Answer the seller's questions about THEIR OWN business using only the data below.
- Be specific: quote £ figures, counts and item names from the data. Round money to 2 decimals.
- If the data can't answer it, say what's missing in one sentence. Never invent numbers.
- Keep answers short: at most 90 words. Use **bold** for key figures and "- " for lists of up to 5 lines.
- "Profit" means item profit (sale minus what they paid) unless they ask about business expenses.
DATA (JSON): ${JSON.stringify(digest)}`;
  const raw = await ask(env, {system, history, prompt: `QUESTION: ${question}
Write your answer as plain text (no JSON, no code). Then on a new line write FOLLOW-UPS: and two short follow-up questions they might ask next, each on its own line starting with "- ".`, maxTokens: 500, temperature: .2});
  return parseAnswer(raw);
}

// Splits Pip's reply into the answer and follow-up suggestions. Copes with JSON replies too.
export function parseAnswer(raw) {
  let answer = String(raw || '').replace(/```(?:json)?/gi, '').trim(), suggestions = [];
  if (/^\{[\s\S]*"answer"/.test(answer)) {
    try { const data = jsonFrom(answer); answer = flat(data.answer); suggestions = (Array.isArray(data.suggestions) ? data.suggestions : []).map(flat); }
    catch { const m = answer.match(/"answer"\s*:\s*"([\s\S]*?)"\s*,\s*"suggestions"/); if (m) answer = m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"'); }
  }
  const marker = answer.match(/\n?\s*\**\s*follow[- ]?ups?\s*:?\**\s*:?/i);
  if (marker) {
    const split = marker.index;
    suggestions = answer.slice(split + marker[0].length).split('\n').map(l => l.replace(/^\s*[-•*\d.)]+\s*/, '').replace(/^"|"$/g, '').trim()).filter(Boolean);
    answer = answer.slice(0, split).trim();
  }
  return {answer: answer.slice(0, 1500) || 'I couldn’t work that out. Try asking another way.',
    suggestions: suggestions.map(s => text(s, 80)).filter(s => s && s.length > 3).slice(0, 3)};
}

// ---------- Buy-or-pass scanner ----------
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export function scanVerdict({low, high, ownAvg, ownCount, price}) {
  let resale = (low + high) / 2;
  if (ownAvg != null && ownCount >= 2) resale = ownAvg * .6 + resale * .4; // lean on what this seller actually achieves
  resale = Math.round(resale * 2) / 2;
  const maxBuy = Math.max(0, Math.floor(Math.min(resale * .4, resale - 5) * 2) / 2);
  let verdict = 'unknown';
  if (price != null) verdict = price <= maxBuy ? 'buy' : price <= Math.max(maxBuy, Math.min(resale * .55, resale - 5)) ? 'maybe' : 'pass';
  return {resale, maxBuy, verdict, profitAtPrice: price != null ? Math.round((resale - price) * 100) / 100 : null};
}
export async function scanRoute(request, env, user) {
  if (request.method !== 'POST') throw new HttpError(405, 'Method not allowed.');
  const body = await readBody(request, 6_000_000) || {};
  const image = imageFromDataUrl(body.image, 5_600_000);
  if (!image) throw new HttpError(400, 'Take a photo of the item first.');
  const price = money(body.price);
  const digest = workspaceDigest((await loadWorkspace(env, user.id))?.data || {});
  const market = await env.DB.prepare("SELECT payload FROM market_research WHERE id='vinted-uk'").first().then(r => r ? JSON.parse(r.payload) : seed).catch(() => seed);
  await aiAllowance(env, user);
  const prompt = `${VINTED_RULES}
You are Pip, helping a reseller decide on the spot whether to buy this second-hand item while sourcing (charity shop, car boot, sale). Look at the photo (it may show the item, its label or tag).
UK Vinted market reference (${market.periodStart} to ${market.periodEnd}): brands ${JSON.stringify((market.brands || []).slice(0, 15).map(b => ({name: b.name, avgPrice: b.price})))}; categories ${JSON.stringify((market.categories || []).slice(0, 12).map(c => ({name: c.name, avgPrice: c.price, daysToSell: c.days})))}.
This seller's own best brands: ${JSON.stringify(digest.byBrand.slice(0, 10).map(b => ({brand: b.name, sold: b.sold, avgSale: b.sold ? Math.round(b.revenue / b.sold * 100) / 100 : null, medianDaysToSell: b.medianDaysToSell})))}.
Estimate what it would realistically SELL for on Vinted UK (not asking price) in typical used condition, as a range.
Reply with ONLY JSON: {"name": string (short item name, e.g. "Ralph Lauren quarter zip"), "brand": string or "", "category": string, "condition": string (your best guess from the photo), "low": number, "high": number, "confidence": "low" | "medium" | "high", "reason": string (max 2 short sentences, specific), "checks": [up to 3 short things to check before buying, e.g. "Check the label for size", "Look for bobbling under the arms"]}
If you can't tell what it is, set confidence to "low", give a wide range and say what photo would help.`;
  const data = jsonFrom(await ask(env, {prompt, image, maxTokens: 450, temperature: .2}), 'Pip couldn’t make out that item. Try a clearer photo or the label.');
  let low = money(data.low), high = money(data.high);
  if (low == null || high == null || high <= 0) throw new HttpError(502, 'Pip couldn’t price that item. Try a photo of the label.');
  if (low > high) [low, high] = [high, low];
  const community = await lookupIndex(env, data.brand, garmentType({name: data.name, garment: data.category})).catch(() => null);
  if (community) { low = Math.round((low + community.low) / 2 * 2) / 2; high = Math.round((high + community.high) / 2 * 2) / 2; if (low > high) [low, high] = [high, low]; }
  const brand = text(data.brand, 60), own = digest.byBrand.find(b => brand && norm(b.name) === norm(brand));
  const ownAvg = own?.sold ? own.revenue / own.sold : null;
  const v = scanVerdict({low, high, ownAvg, ownCount: own?.sold || 0, price});
  return {name: text(data.name, 80) || 'This item', brand, category: text(data.category, 40), condition: text(data.condition, 40),
    low, high, confidence: ['low', 'medium', 'high'].includes(data.confidence) ? data.confidence : 'low', reason: text(flat(data.reason), 300),
    checks: (Array.isArray(data.checks) ? data.checks : []).map(c => text(flat(c), 80)).filter(Boolean).slice(0, 3),
    yourHistory: own ? {sold: own.sold, avgSale: ownAvg != null ? Math.round(ownAvg * 100) / 100 : null, medianDaysToSell: own.medianDaysToSell, inStock: own.inStock} : null,
    community: community ? {median: community.median, low: community.low, high: community.high, n: community.n, days: community.days, label: [community.label, community.type].filter(Boolean).join(' ')} : null,
    price, ...v};
}
