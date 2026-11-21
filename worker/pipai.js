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
