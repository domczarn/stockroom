// Pip's bigger tricks: Snap to stock (photos → a complete item), Flaw finder, and Tell Pip (plain English → changes you confirm).
import {readBody, HttpError} from './security.js';
import {ask, jsonFrom, imageFromDataUrl, aiAllowance} from './llm.js';
import {lookupIndex, garmentType} from './grow.js';

const text = (v, max) => typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';
const money = v => { if (v == null || String(v).trim() === '') return null; const n = Number(String(v).replace(/[£,\s]/g, '')); return Number.isFinite(n) && n >= 0 && n < 100000 ? Math.round(n * 100) / 100 : null; };
const CONDITIONS = ['New with tags', 'New without tags', 'Very good', 'Good', 'Satisfactory'];
const photosFrom = (body, max = 3) => (Array.isArray(body.images) ? body.images : []).slice(0, max).map(i => imageFromDataUrl(i, 2_000_000)).filter(Boolean);
const flawList = list => (Array.isArray(list) ? list : []).map(f => typeof f === 'string' ? f : [text(f?.what, 60), text(f?.where, 60)].filter(Boolean).join(' on ')).map(f => text(f, 120)).filter(Boolean).slice(0, 6);

// ---------- Snap to stock ----------
export async function snapRoute(request, env, user) {
  if (request.method !== 'POST') throw new HttpError(405, 'Method not allowed.');
  const body = await readBody(request, 7_000_000) || {};
  const images = photosFrom(body);
  if (!images.length) throw new HttpError(400, 'Add a photo of the item first.');
  await aiAllowance(env, user);
  const prompt = `You are an expert UK clothing reseller. These ${images.length} photo(s) show ONE second-hand item the seller just bought, possibly including its care/size label and close-ups.
Work out everything a Vinted listing needs. Read the label text exactly when visible (brand, size, material). Never guess a brand or size you cannot see or clearly recognise; use "" instead.
Look carefully for flaws: stains, marks, holes, pulls, bobbling/pilling, fading, cracked prints, missing buttons, broken zips, frayed cuffs or hems. Only report flaws you can actually see.

Reply with ONLY this JSON:
{"name": "short descriptive title like 'Navy Ralph Lauren Quarter Zip'", "brand": string, "garment": "item type e.g. Quarter zip, Hoodie, Jacket, Jeans", "size": string, "colour": string,
 "material": string (only from a readable label, else ""), "condition": one of ${JSON.stringify(CONDITIONS)},
 "flaws": [{"what": string, "where": string}], "resale": {"low": number, "high": number} (realistic Vinted UK sold prices in GBP for this exact item in this condition),
 "listingTitle": string (max 70 chars: Brand + line/model + type + standout detail + colour + "Size X"),
 "listingDescription": string (British English, 70-120 words: hook line, blank line, "• " bullets for brand, size, colour, condition, material if known, 2-3 visible details, then a plain flaws line, then "Posted within 1–2 working days. Bundle for a discount."),
 "hashtags": [6-8 lowercase tags starting with #], "labelSeen": boolean, "confidence": "low" | "medium" | "high", "tip": string (one short sentence: what extra photo would improve this, or "")}`;
  const data = jsonFrom(await ask(env, {prompt, image: images, maxTokens: 1200}), 'Pip couldn’t read those photos. Try one clear photo of the whole item and one of the label.');
  let low = money(data.resale?.low), high = money(data.resale?.high);
  const brand = text(data.brand, 60), garment = text(data.garment, 40);
  const community = await lookupIndex(env, brand, garmentType({name: data.name, garment})).catch(() => null);
  if (community && low != null && high != null) { low = Math.round((low + community.low) / 2); high = Math.round((high + community.high) / 2); }
  if (low != null && high != null && low > high) [low, high] = [high, low];
  const flaws = flawList(data.flaws);
  const tags = (Array.isArray(data.hashtags) ? data.hashtags : []).map(t => '#' + String(t).toLowerCase().replace(/[^a-z0-9]/g, '')).filter(t => t.length > 2).slice(0, 8);
  return {item: {
    name: text(data.name, 120), brand, garment, size: text(data.size, 20), color: text(data.colour, 30), material: text(data.material, 120),
    condition: CONDITIONS.includes(data.condition) ? data.condition : '', flaws: flaws.join('; '),
    listingTitle: text(data.listingTitle, 90), listingDescription: String(data.listingDescription || '').replace(/\r/g, '').trim().slice(0, 1800) + (tags.length ? '\n\n' + [...new Set(tags)].join(' ') : '')
  }, resale: low != null && high != null ? {low, high, suggest: Math.round((low + high) / 2)} : null, flawsFound: flaws,
  community: community ? {median: community.median, n: community.n} : null, labelSeen: !!data.labelSeen,
  confidence: ['low', 'medium', 'high'].includes(data.confidence) ? data.confidence : 'low', tip: text(data.tip, 160)};
}

// ---------- Flaw finder ----------
export async function flawsRoute(request, env, user) {
  if (request.method !== 'POST') throw new HttpError(405, 'Method not allowed.');
  const body = await readBody(request, 7_000_000) || {};
  const images = photosFrom(body, 4);
  if (!images.length) throw new HttpError(400, 'Add a photo of the item first.');
  await aiAllowance(env, user);
  const prompt = `You inspect second-hand clothing photos for a Vinted seller, so buyers aren't surprised and don't open a "not as described" return.
Check every photo closely for: stains or marks, holes, pulls or snags, bobbling/pilling, fading or discolouration, cracked or peeling prints, missing buttons, broken or stiff zips, frayed cuffs, collars or hems, stretched necklines, odd creases that won't come out, pet hair or lint.
Only report what you can actually see. Be specific about where. Ignore photo lighting and creases from folding.
Reply with ONLY JSON: {"flaws": [{"what": string, "where": string, "severity": "minor" | "noticeable" | "major"}], "clean": boolean, "conditionHint": one of ${JSON.stringify(CONDITIONS)} or "", "photoTip": string (one sentence on a photo that would help check better, or "")}`;
  const data = jsonFrom(await ask(env, {prompt, image: images, maxTokens: 700}), 'Pip couldn’t check those photos. Try clearer, closer shots in daylight.');
  const flaws = (Array.isArray(data.flaws) ? data.flaws : []).map(f => ({what: text(f?.what, 60), where: text(f?.where, 60), severity: ['minor', 'noticeable', 'major'].includes(f?.severity) ? f.severity : 'minor'})).filter(f => f.what).slice(0, 8);
  return {flaws, clean: !flaws.length, conditionHint: CONDITIONS.includes(data.conditionHint) ? data.conditionHint : '', photoTip: text(data.photoTip, 160),
    text: flaws.map(f => f.what + (f.where ? ' on ' + f.where : '') + (f.severity !== 'minor' ? ' (' + f.severity + ')' : '')).join('; ')};
}

// ---------- Tell Pip ----------
const ACTIONS = ['add_item', 'mark_sold', 'set_price', 'mark_listed', 'mark_received', 'log_expense'];
export function cleanActions(list, ids, today) {
  const date = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && String(v) <= today ? String(v) : today;
  const out = [];
  for (const a of Array.isArray(list) ? list.slice(0, 25) : []) {
    if (!a || !ACTIONS.includes(a.type)) continue;
    if (['mark_sold', 'set_price', 'mark_listed', 'mark_received'].includes(a.type) && !ids.has(String(a.itemId))) continue;
    if (a.type === 'add_item') { const cost = money(a.cost), qty = Math.min(20, Math.max(1, Math.round(Number(a.quantity) || 1))); const name = text(a.name, 120); if (!name || cost == null) continue;
      out.push({type: a.type, name, brand: text(a.brand, 60), garment: text(a.garment, 40), size: text(a.size, 20), color: text(a.colour || a.color, 30), cost, quantity: qty, purchasedAt: date(a.date), place: text(a.place, 150)}); }
    if (a.type === 'mark_sold') { const amount = money(a.amount); if (!amount) continue; out.push({type: a.type, itemId: String(a.itemId), amount, buyer: text(a.buyer, 60), soldAt: date(a.date)}); }
    if (a.type === 'set_price') { const price = money(a.price); if (price == null) continue; out.push({type: a.type, itemId: String(a.itemId), price}); }
    if (a.type === 'mark_listed') out.push({type: a.type, itemId: String(a.itemId), listedAt: date(a.date)});
    if (a.type === 'mark_received') out.push({type: a.type, itemId: String(a.itemId), receivedAt: date(a.date)});
    if (a.type === 'log_expense') { const amount = money(a.amount); const description = text(a.description, 120); if (!amount || !description) continue;
      out.push({type: a.type, description, amount, category: ['Packaging', 'Postage', 'Cleaning', 'Repairs', 'Promotion', 'Other'].includes(a.category) ? a.category : 'Other', date: date(a.date)}); }
  }
  return out;
}
export async function commandRoute(request, env, user) {
  if (request.method !== 'POST') throw new HttpError(405, 'Method not allowed.');
  const body = await readBody(request, 120_000) || {};
  const said = text(body.text, 600);
  if (said.length < 3) throw new HttpError(400, 'Tell Pip what happened.');
  const today = /^\d{4}-\d{2}-\d{2}$/.test(body.today || '') ? body.today : new Date().toISOString().slice(0, 10);
  const stock = (Array.isArray(body.items) ? body.items : []).slice(0, 500).map(i => ({id: text(String(i?.id ?? ''), 40), name: text(i?.name, 100), brand: text(i?.brand, 40), size: text(i?.size, 15),
    status: text(i?.status, 20), price: money(i?.price), cost: money(i?.cost), listed: !!i?.listed, received: !!i?.received, daysListed: Number.isFinite(i?.daysListed) ? i.daysListed : null})).filter(i => i.id && i.name);
  await aiAllowance(env, user);
  const prompt = `You are Pip inside Booked & Paid Stockroom. The seller told you, in their own words, what happened in their resale business. Turn it into a list of changes for them to confirm.
Today is ${today}. Dates like "yesterday" or "Saturday" are relative to today.
The seller's stock (id, name, brand, size, status, asking price, cost, listed?, received?, days listed):
${stock.map(i => [i.id, i.name, i.brand, i.size, i.status, i.price ?? '', i.cost ?? '', i.listed ? 'listed' : 'unlisted', i.received ? 'received' : 'not received', i.daysListed ?? ''].join(' | ')).join('\n')}

The seller said: "${said}"

Possible changes (use the exact item id from the list; only "In Stock" items can be sold, priced, listed or received):
- {"type":"add_item","name":string,"brand":string,"garment":string,"size":string,"colour":string,"cost":number (per item, GBP),"quantity":number,"date":"YYYY-MM-DD","place":string (where they bought it, if said)}
- {"type":"mark_sold","itemId":string,"amount":number,"buyer":string,"date":"YYYY-MM-DD"}
- {"type":"set_price","itemId":string,"price":number}
- {"type":"mark_listed","itemId":string,"date":"YYYY-MM-DD"}
- {"type":"mark_received","itemId":string,"date":"YYYY-MM-DD"}
- {"type":"log_expense","description":string,"amount":number,"category":"Packaging"|"Postage"|"Cleaning"|"Repairs"|"Promotion"|"Other","date":"YYYY-MM-DD"}
Rules: if the seller paid one total for several items, split the cost evenly per item. For "drop the price by X%" on a group, compute each new price rounded to the nearest 50p. Match items by name, brand, colour and size; if two items match equally, pick neither and ask. Never invent amounts.
Reply with ONLY JSON: {"actions": [ ... ], "summary": string (one short sentence of what you'll do), "question": string (if something is unclear or not a change, ask or answer briefly; else "")}`;
  const data = jsonFrom(await ask(env, {prompt, maxTokens: 1400}), 'Pip didn’t catch that. Try saying it a different way, like “sold the black Nike hoodie for £25”.');
  const ids = new Set(stock.filter(i => i.status === 'In Stock').map(i => i.id));
  const actions = cleanActions(data.actions, ids, today);
  return {actions, summary: text(data.summary, 200), question: text(data.question, 300)};
}
