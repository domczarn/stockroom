// Pip's AI helpers: offer advice, Ask Pip chat, buy-or-pass verdicts and the weekly report.
import {HttpError, readBody} from './security.js';
import {ask, jsonFrom, aiAllowance, imageFromDataUrl} from './llm.js';

const money = v => { const n = Number(v); return Number.isFinite(n) && n >= 0 && n < 100000 ? Math.round(n * 100) / 100 : null; };
const text = (v, max) => typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';
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
  let reason = text(data.reason, 300), reply = String(data.reply || '').trim().slice(0, 600);
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
  const row = await env.DB.prepare('SELECT payload FROM workspaces WHERE owner_id = ?').bind(user.id).first();
  const digest = workspaceDigest(row ? JSON.parse(row.payload) : {});
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
  const raw = await ask(env, {system, history, prompt: `QUESTION: ${question}\nReply with ONLY JSON: {"answer": string, "suggestions": [two short follow-up questions they might ask next]}`, maxTokens: 500, temperature: .2});
  let data;
  try { data = jsonFrom(raw); } catch { data = {answer: raw.slice(0, 900), suggestions: []}; }
  return {answer: String(data.answer || '').trim().slice(0, 1500) || 'I couldn’t work that out. Try asking another way.',
    suggestions: (Array.isArray(data.suggestions) ? data.suggestions : []).map(s => text(s, 80)).filter(Boolean).slice(0, 3)};
}
