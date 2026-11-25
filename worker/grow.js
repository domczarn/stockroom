// Growth features: the Stockroom price index (anonymous sold prices across all sellers),
// measurements from a photo, and cross-platform listing copy.
import {readBody, HttpError} from './security.js';
import {ask, jsonFrom, imageFromDataUrl, aiAllowance} from './llm.js';

// ---------- Price index ----------
// Only groups with at least MIN_SALES sales from MIN_SELLERS different sellers are published, so no one's
// individual prices can be read back out.
export const MIN_SALES = 5, MIN_SELLERS = 3;
const REBUILD_MS = 6 * 3600 * 1000;
const TYPES = [
  [/q(?:uarter)?[ -]?zip|qzip|1\/4 zip/i, 'Quarter zip'], [/hood(?:ie|y)/i, 'Hoodie'], [/sweat(?:shirt|er)?|crew ?neck|jumper|knit/i, 'Jumper'],
  [/fleece/i, 'Fleece'], [/gilet|vest\b/i, 'Gilet'], [/windbreaker|windrunner|anorak|cagoule/i, 'Windbreaker'], [/puffer|down jacket/i, 'Puffer'],
  [/jacket|coat|parka|bomber|harrington|overshirt/i, 'Jacket'], [/full[ -]?zip|zip[ -]?up|track ?top/i, 'Full zip'], [/polo/i, 'Polo'],
  [/t[ -]?shirt|\btee\b/i, 'T-shirt'], [/\bshirt\b/i, 'Shirt'], [/jeans|denim/i, 'Jeans'], [/joggers|track ?pants|trousers|chinos|cargos?/i, 'Trousers'],
  [/shorts/i, 'Shorts'], [/trainers|sneakers|shoes|boots/i, 'Footwear'], [/cap|hat|beanie|bag|belt|scarf/i, 'Accessory']
];
export const garmentType = item => {
  const given = String(item.garment || '').trim();
  const text = given + ' ' + String(item.name || '');
  return TYPES.find(([re]) => re.test(text))?.[1] || '';
};
export const normBrand = b => String(b || '').trim().toLowerCase().replace(/[^a-z0-9&]+/g, ' ').replace(/\s+/g, ' ').trim();
const quantile = (sorted, q) => { if (!sorted.length) return null; const i = (sorted.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i); return Math.round((sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo)) * 100) / 100; };
const dayDiff = (a, b) => { const x = Date.parse(a), y = Date.parse(b); return Number.isFinite(x) && Number.isFinite(y) && y >= x ? Math.round((y - x) / 864e5) : null; };

// Pure: every sold piece in one workspace as {brand, type, price, days}.
export function soldPieces(data) {
  const items = new Map((data?.items || []).map(i => [i.id, i])), out = [], seen = new Set();
  for (const t of data?.trades || []) {
    const item = items.get(t.itemId) || {name: t.name};
    const refunds = (t.refunds || []).reduce((n, r) => n + (Number(r.amount) || 0), 0);
    const price = (Number(t.amount) || 0) - refunds;
    seen.add(t.itemId);
    if (price > 0 && price < 5000) out.push({brand: normBrand(item.brand), label: String(item.brand || '').trim(), type: garmentType(item), price, days: dayDiff(t.listedAt || item.listedAt, t.soldAt)});
  }
  for (const item of data?.items || []) if (!seen.has(item.id) && item.status === 'Sold' && Number(item.sale) > 0 && item.sale < 5000)
    out.push({brand: normBrand(item.brand), label: String(item.brand || '').trim(), type: garmentType(item), price: Number(item.sale), days: dayDiff(item.listedAt, item.soldAt)});
  return out;
}

// Pure: workspaces [{owner, pieces}] -> published rows.
export function buildIndex(workspaces) {
  const groups = new Map();
  const add = (key, brand, label, type, owner, p) => {
    let g = groups.get(key);
    if (!g) groups.set(key, g = {key, brand, label, type, prices: [], days: [], sellers: new Set(), labels: new Map()});
    g.prices.push(p.price); if (p.days != null) g.days.push(p.days); g.sellers.add(owner);
    if (label) g.labels.set(label, (g.labels.get(label) || 0) + 1);
  };
  for (const {owner, pieces} of workspaces) for (const p of pieces) {
    if (p.brand) { add(p.brand + '|', p.brand, p.label, '', owner, p); if (p.type) add(p.brand + '|' + p.type, p.brand, p.label, p.type, owner, p); }
    if (p.type) add('|' + p.type, '', '', p.type, owner, p);
  }
  const rows = [];
  for (const g of groups.values()) {
    if (g.prices.length < MIN_SALES || g.sellers.size < MIN_SELLERS) continue;
    const prices = g.prices.sort((a, b) => a - b), days = g.days.sort((a, b) => a - b);
    const label = [...g.labels.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || g.brand;
    rows.push({key: g.key, brand: g.brand, label, type: g.type, n: prices.length, sellers: g.sellers.size,
      median: quantile(prices, .5), low: quantile(prices, .25), high: quantile(prices, .75), days: days.length >= 3 ? quantile(days, .5) : null});
  }
  return rows.sort((a, b) => b.n - a.n);
}

async function ensureTable(env) {
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS price_index (key TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL)').run();
}
export async function rebuildPriceIndex(env, {force = false} = {}) {
  await ensureTable(env);
  const last = await env.DB.prepare("SELECT value FROM app_settings WHERE key='price_index_built'").first().catch(() => null);
  if (!force && last?.value && Date.now() - Date.parse(last.value) < REBUILD_MS) return null;
  const {results = []} = await env.DB.prepare('SELECT owner_id, payload FROM workspaces').all();
  const workspaces = [];
  for (const r of results) { try { workspaces.push({owner: r.owner_id, pieces: soldPieces(JSON.parse(r.payload))}); } catch {} }
  const rows = buildIndex(workspaces), now = new Date().toISOString();
  const statements = [env.DB.prepare('DELETE FROM price_index'), ...rows.slice(0, 3000).map(r => env.DB.prepare('INSERT INTO price_index (key, payload, updated_at) VALUES (?, ?, ?)').bind(r.key, JSON.stringify(r), now)),
    env.DB.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES ('price_index_built', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").bind(now, now)];
  for (let i = 0; i < statements.length; i += 90) await env.DB.batch(statements.slice(i, i + 90));
  return rows.length;
}
export async function priceIndexRoute(request, env, user) {
  if (!user) throw new HttpError(401, 'Sign in first.');
  await ensureTable(env);
  // Built by the scheduled job only, so a user's request never pays for scanning every workspace.
  const {results = []} = await env.DB.prepare('SELECT payload, updated_at FROM price_index').all();
  return {rows: results.map(r => JSON.parse(r.payload)), updatedAt: results[0]?.updated_at || null, minSales: MIN_SALES, minSellers: MIN_SELLERS};
}
export async function lookupIndex(env, brand, type) {
  const b = normBrand(brand), keys = [b && type ? b + '|' + type : null, b ? b + '|' : null, type ? '|' + type : null].filter(Boolean);
  for (const key of keys) {
    const row = await env.DB.prepare('SELECT payload FROM price_index WHERE key = ?').bind(key).first().catch(() => null);
    if (row) return JSON.parse(row.payload);
  }
  return null;
}

// ---------- Measurements from a photo ----------
const text = (v, max) => typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';
const cm = v => { const n = Number(String(v ?? '').replace(/[^0-9.]/g, '')); return Number.isFinite(n) && n > 5 && n < 200 ? Math.round(n) : null; };
export function formatMeasurements(m) {
  const parts = [['Pit to pit', m.pitToPit], ['Length', m.length], ['Sleeve', m.sleeve], ['Shoulders', m.shoulders], ['Waist', m.waist], ['Inside leg', m.insideLeg]]
    .filter(([, v]) => v != null).map(([k, v]) => `${k} ${v} cm (${Math.round(v / 2.54 * 2) / 2} in)`);
  return parts.join(', ');
}
export async function measureRoute(request, env, user) {
  if (request.method !== 'POST') throw new HttpError(405, 'Method not allowed.');
  const body = await readBody(request, 6_000_000) || {};
  const image = imageFromDataUrl(body.image, 5_600_000);
  if (!image) throw new HttpError(400, 'Choose a photo first.');
  const garment = text(body.garment, 40);
  await aiAllowance(env, user);
  const prompt = `This photo shows a second-hand clothing item laid flat${garment ? ' (a ' + garment + ')' : ''}. A sheet of A4 paper (21.0 cm by 29.7 cm) should be lying flat next to it, on the same surface, as a size reference.
Use the A4 sheet to work out the scale, then estimate the standard flat-lay measurements a Vinted buyer asks for, in centimetres:
- tops and jackets: pitToPit (straight across the chest, armpit to armpit), length (top of shoulder seam / collar base down to the hem), sleeve (shoulder seam to cuff) if visible, shoulders (seam to seam) if visible
- trousers, jeans and shorts: waist (straight across the waistband, flat), insideLeg (crotch seam to hem), length (waistband to hem)
Reply with ONLY JSON: {"a4Found": boolean, "kind": "top" | "bottom" | "other", "pitToPit": number|null, "length": number|null, "sleeve": number|null, "shoulders": number|null, "waist": number|null, "insideLeg": number|null, "confidence": "low" | "medium" | "high", "tip": string (one short sentence on how to get a better measurement photo, or "" if it was good)}
If no A4 sheet is visible, set a4Found false and every measurement null. Never guess without the A4 reference.`;
  const data = jsonFrom(await ask(env, {prompt, image, maxTokens: 300, temperature: 0}), 'Pip couldn’t read that photo. Try again with the whole item and an A4 sheet in shot.');
  if (!data.a4Found) throw new HttpError(422, 'Pip couldn’t see an A4 sheet. Lay one flat next to the item, get both fully in shot from straight above, and try again.');
  const m = {pitToPit: cm(data.pitToPit), length: cm(data.length), sleeve: cm(data.sleeve), shoulders: cm(data.shoulders), waist: cm(data.waist), insideLeg: cm(data.insideLeg)};
  const summary = formatMeasurements(m);
  if (!summary) throw new HttpError(422, 'Pip couldn’t measure that. Shoot from straight above with the item flat and fully in shot.');
  return {measurements: m, text: summary + ' (approx.)', confidence: ['low', 'medium', 'high'].includes(data.confidence) ? data.confidence : 'low', tip: text(data.tip, 160)};
}

// ---------- Cross-platform listing copy ----------
export async function crosslistRoute(request, env, user) {
  if (request.method !== 'POST') throw new HttpError(405, 'Method not allowed.');
  const body = await readBody(request, 40_000) || {};
  const item = body.item && typeof body.item === 'object' ? body.item : {};
  const details = {
    Brand: text(item.brand, 60), Name: text(item.name, 160), 'Item type': text(item.garment, 40), Size: text(item.size, 20), Colour: text(item.color, 30),
    Condition: text(item.condition, 40), Flaws: text(item.flaws, 300), Material: text(item.material, 120), Measurements: text(item.measurements, 200),
    'Vinted title': text(item.listingTitle, 150), 'Vinted description': String(item.listingDescription || '').slice(0, 2500)
  };
  if (!details.Name && !details.Brand && !details['Vinted title']) throw new HttpError(400, 'Add a name or brand first.');
  await aiAllowance(env, user);
  const prompt = `You rewrite a second-hand clothing listing for two other UK marketplaces. Trust the facts below. Never invent material, measurements, flaws, authenticity or rarity.
${Object.entries(details).filter(([, v]) => v).map(([k, v]) => `- ${k}: ${v}`).join('\n')}

Reply with ONLY JSON:
{"depop": {"description": string, "hashtags": [string]}, "ebay": {"title": string, "description": string, "specifics": {"Brand": string, "Size": string, "Colour": string, "Type": string, "Condition": string, "Material": string}}}
Depop rules: British English, relaxed and short (30-70 words), first line says what it is, include size, condition and flaws, then up to 5 hashtags (lowercase, no spaces, starting with #) in the hashtags array only, not in the description.
eBay rules: title max 80 characters, keyword-rich, Brand + Item type + key details + Colour + "Size X", no punctuation spam or emojis. Description: clear, factual, 60-120 words, with a short paragraph then lines starting "• " for brand, size, colour, condition, flaws and measurements if given. Specifics: fill only what is known, otherwise "".`;
  const data = jsonFrom(await ask(env, {prompt, maxTokens: 900, temperature: .4}));
  const tags = (Array.isArray(data.depop?.hashtags) ? data.depop.hashtags : []).map(t => '#' + String(t).toLowerCase().replace(/[^a-z0-9]/g, '')).filter(t => t.length > 2).slice(0, 5);
  const specifics = Object.fromEntries(Object.entries(data.ebay?.specifics || {}).map(([k, v]) => [text(k, 30), text(String(v ?? ''), 80)]).filter(([k, v]) => k && v).slice(0, 8));
  const out = {
    depop: {description: String(data.depop?.description || '').replace(/\r/g, '').trim().slice(0, 1000), hashtags: [...new Set(tags)]},
    ebay: {title: text(data.ebay?.title, 80), description: String(data.ebay?.description || '').replace(/\r/g, '').trim().slice(0, 2000), specifics}
  };
  if (!out.depop.description || !out.ebay.title || !out.ebay.description) throw new HttpError(502, 'Pip wrote something unusable. Try again.');
  return out;
}

// Price suggestion for anyone, even with no sales yet: community sold prices if we have them,
// otherwise Pip's estimate of what it sells for on Vinted UK from the details (and photo, if given).
export async function priceRoute(request, env, user) {
  if (request.method !== 'POST') throw new HttpError(405, 'Method not allowed.');
  const body = await readBody(request, 1_200_000) || {};
  const item = body.item && typeof body.item === 'object' ? body.item : {};
  const details = {Brand: text(item.brand, 60), 'Item type': text(item.garment, 40), Name: text(item.name, 120), Size: text(item.size, 20), Colour: text(item.color, 30), Condition: text(item.condition, 40), Flaws: text(item.flaws, 200)};
  if (!details.Brand && !details['Item type'] && !details.Name) throw new HttpError(400, 'Pick a brand or category first.');
  const community = await lookupIndex(env, details.Brand, garmentType(details['Item type'] || details.Name));
  await aiAllowance(env, user);
  const image = imageFromDataUrl(body.photo, 1_100_000);
  const prompt = `You price second-hand clothing for resale on Vinted UK in ${new Date().getFullYear()}. Be realistic about what it actually SELLS for (not asking prices), for a typical seller.
${Object.entries(details).filter(([, v]) => v).map(([k, v]) => `- ${k}: ${v}`).join('\n')}
${community ? `- Stockroom sellers' recent sold prices for similar items: median £${community.median}, typical £${community.low}-£${community.high} (${community.n} sales)` : ''}
${image ? '- A photo of the item is attached.' : ''}
Reply with ONLY JSON: {"low": number, "high": number, "suggested": number, "why": string}
low/high: realistic sold range in GBP; suggested: a good listing price that leaves a little room for offers; why: one short plain-English sentence a beginner understands (max 25 words). If details are too vague, give a wide range and say what would narrow it.`;
  const data = jsonFrom(await ask(env, {prompt, maxTokens: 300, ...(image ? {image} : {})}), 'Pip couldn’t price that. Try again.');
  const n = v => { const x = Math.round(Number(v) * 2) / 2; return Number.isFinite(x) && x > 0 && x < 5000 ? x : null; };
  const low = n(data.low), high = n(data.high), suggested = n(data.suggested);
  if (!low || !high || !suggested || low > high) throw new HttpError(502, 'Pip couldn’t price that. Add a brand or category and try again.');
  return {low, high, suggested: Math.min(Math.max(suggested, low), high * 1.2), why: text(data.why, 200), community: community ? {median: community.median, count: community.n} : null};
}
