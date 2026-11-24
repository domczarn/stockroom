import {readBody,HttpError} from './security.js';
import {ask, imageFromDataUrl, aiAllowance, jsonFrom} from './llm.js';

// Reads a Vinted listing screenshot with Workers AI and returns the fields for Add stock.
const MODEL = '@cf/meta/llama-3.2-11b-vision-instruct';
const CONDITIONS = ['New with tags','New without tags','Very good','Good','Satisfactory'];
const PROMPT = `This is a screenshot of a second-hand clothing listing on Vinted.
Read the listing and reply with ONLY a JSON object, no other text, using exactly these keys:
{"title": string, "brand": string, "size": string, "condition": string, "colour": string, "category": string, "price": number, "description": string}
Rules:
- title: the listing title exactly as shown.
- brand: the brand name shown on the listing (empty string if none).
- size: the size label as shown, e.g. "M", "XL", "UK 10", "W32" (empty if none).
- condition: one of "New with tags", "New without tags", "Very good", "Good", "Satisfactory" (empty if not shown).
- colour: the colour if shown or obvious from the photo, one or two words.
- category: the garment type in one or two words, e.g. "Jacket", "Hoodie", "Quarter Zip".
- price: the item price in pounds as a number, NOT the price including buyer protection. 0 if not visible.
- description: the seller's description text, at most 300 characters (empty if not visible).
Never invent details that are not in the screenshot.`;

const clean = (value, max) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';

function parse(text) {
  const raw = typeof text === 'string' ? text : JSON.stringify(text || {});
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new HttpError(502, 'Could not read that screenshot. Try a clearer one.');
  let data;
  try { data = JSON.parse(match[0]); } catch { throw new HttpError(502, 'Could not read that screenshot. Try a clearer one.'); }
  const condition = CONDITIONS.find(c => c.toLowerCase() === clean(data.condition, 40).toLowerCase()) || '';
  const price = Number(String(data.price ?? '').replace(/[£,\s]/g, ''));
  return {
    title: clean(data.title, 120), brand: clean(data.brand, 60), size: clean(data.size, 20), condition,
    colour: clean(data.colour ?? data.color, 30), category: clean(data.category, 40),
    price: Number.isFinite(price) && price > 0 && price < 10000 ? Math.round(price * 100) / 100 : null,
    description: clean(data.description, 300)
  };
}

async function run(env, image, prompt = PROMPT, maxTokens = 400, temperature = 0.1) {
  return ask(env, {prompt, image, maxTokens, temperature});
}

export async function visionRoute(request, env, user) {
  if (request.method !== 'POST') throw new HttpError(405, 'Method not allowed.');
  if (!user) throw new HttpError(401, 'Sign in first.');
  const {image} = await readBody(request, 3_000_000) || {};
  const bytes = imageFromDataUrl(image);
  if (!bytes) throw new HttpError(400, 'Send one screenshot as an image.');
  await aiAllowance(env, user);
  let result;
  try { result = await run(env, bytes); }
  catch (error) {
    console.log(JSON.stringify({vision: 'error', message: String(error?.message || error).slice(0, 300)}));
    throw new HttpError(502, 'Screenshot reading is busy. Try again in a moment.');
  }
  return {listing: parse(result)};
}

// ---------- Write a Vinted listing from the item's details (+ cover photo) ----------
const LISTING_PROMPT = facts => `You are the UK's best Vinted seller. You write clothing listings that rank in Vinted search and convert browsers into buyers. ${facts.photo ? 'The image is the seller\'s cover photo of the item: use it for visible details (logo type and placement, collar, zip, pockets, cuffs, pattern, fit, colour shade).' : 'There is no photo, so only use the details below.'}

Seller's details (these are facts, they beat the photo):
${Object.entries(facts.details).filter(([, v]) => v).map(([k, v]) => `- ${k}: ${v}`).join('\n')}

TITLE PARTS (the app builds the title as: Colour Brand Product | Size X, e.g. "Black Ralph Lauren Quarter Zip | Size S"):
- colour: the main colour in one or two words (e.g. "Black", "Navy", "Light Blue"). Use the seller's colour if given.
- brand: the brand as it's written on the label, Title Case (e.g. "Ralph Lauren", "Nike", "The North Face").
- product: 2-4 words: product line or model if known, then item type (e.g. "Quarter Zip", "Windrunner Jacket", "Pique Polo Shirt", "Fleece Hoodie"). No colour, brand or size here. No "Mens", no adjectives like "rare", "vintage" unless clearly vintage.
- size: just the size as written on the label (e.g. "S", "M", "UK 10", "W32 L30").
- Title Case, no emojis or symbols.

DESCRIPTION (British English, 70-130 words, scannable on a phone):
1. Hook line: what it is and why it's good, in plain words (e.g. "Classic Ralph Lauren quarter zip in navy, an easy everyday layer.").
2. A blank line, then bullet lines starting with "• ":
   • Brand: …
   • Size: … (add "fits true to size" only if the seller said so; otherwise add "check measurements" when measurements are given)
   • Colour: …
   • Condition: … (use the seller's condition wording)
   • Measurements: … (only if given, exactly as given)
   • Material: … (only if given)
   • Details: 2-4 visible features from the photo or details
3. Flaws line: state the given flaws exactly and plainly. If none were given: "No flaws noted, see photos for condition."
4. Search line: "Great for: " then 2-3 natural style or use words a buyer would search (e.g. "smart casual, golf, layering"), only if they genuinely fit.
5. Final line: "Posted within 1–2 working days. Bundle for a discount."
- Honest, confident, no hype, no exclamation marks, no emojis. Never invent material, measurements, flaws, era, authenticity or rarity. Never include a price.

HASHTAGS: 6-8 lowercase tags, no spaces, starting with #: brand, item type, colour+item, style, and gender if obvious (e.g. #ralphlauren #quarterzip #navyjumper #mensknitwear #preppy).

MISSING: list up to 3 details the seller should add to make this listing sell better, chosen from: "size", "condition", "colour", "item type", "measurements", "material", "flaws", "brand", "photo". Only list ones that are actually missing above.

Reply with ONLY this JSON object and nothing else, no code fences:
{"colour": string, "brand": string, "product": string, "size": string, "description": string, "hashtags": [string], "missing": [string]}`;

const field = (v, max) => typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';
export async function writeListingRoute(request, env, user) {
  if (request.method !== 'POST') throw new HttpError(405, 'Method not allowed.');
  if (!user) throw new HttpError(401, 'Sign in first.');
  const body = await readBody(request, 3_000_000) || {};
  const item = body.item && typeof body.item === 'object' ? body.item : {};
  const details = {
    'Name': field(item.name, 160), 'Brand': field(item.brand, 60), 'Item type': field(item.garment, 40), 'Size': field(item.size, 20),
    'Colour': field(item.color, 30), 'Condition': field(item.condition, 40), 'Flaws': field(item.flaws, 300),
    'Material': field(item.material, 120), 'Measurements': field(item.measurements, 200), 'Seller notes': field(item.notes, 300)
  };
  if (!details.Name && !details.Brand) throw new HttpError(400, 'Add a name or brand first.');
  const image = imageFromDataUrl(body.image);
  await aiAllowance(env, user);
  const prompt = LISTING_PROMPT({details, photo: !!image});
  let data = null, why = '';
  for (let attempt = 0; attempt < 2 && !data; attempt++) {
    let raw;
    try { raw = await run(env, attempt ? null : image, attempt ? prompt + '\n\nYour last reply could not be read. Reply with the JSON object only, starting with { and ending with }.' : prompt, 900); }
    catch (error) {
      console.log(JSON.stringify({listing: 'error', message: String(error?.message || error).slice(0, 300)}));
      throw error instanceof HttpError ? error : new HttpError(502, 'Pip is busy. Try again in a moment.');
    }
    const text = String(raw?.response ?? raw ?? '');
    try {
      const parsed = jsonFrom(text);
      const t = field(parsed.product, 60) || field(parsed.title, 90), d = typeof parsed.description === 'string' ? parsed.description.trim() : '';
      if (t && d.length > 40) data = parsed;
      else why = !t ? 'it left out the title' : 'the description came back too short';
    } catch {
      why = !text.trim() ? 'the reply came back empty (usually the AI service being slow)' : /can.?t|unable|sorry/i.test(text.slice(0, 200)) ? 'it wasn’t sure what the item is' : 'the reply was in the wrong format';
      await env.DB?.prepare('INSERT INTO error_events (id, at, path, status, message) VALUES (?, ?, ?, ?, ?)')
        .bind(crypto.randomUUID(), new Date().toISOString(), '/ai/listing-unreadable', 200, text.slice(0, 280) || '(empty)').run().catch(() => {});
    }
  }
  const missing = listingGaps(details, !!image);
  if (!data) {
    const advice = missing.length ? ' Adding ' + joinWords(missing) + ' gives Pip more to work with.' : ' Try again, or use “Refresh from details” for a quick version.';
    throw new HttpError(502, 'Pip couldn’t write this one because ' + why + '.' + advice);
  }
  const tags = (Array.isArray(data.hashtags) ? data.hashtags : String(data.hashtags || '').split(/\s+/))
    .map(t => '#' + String(t).toLowerCase().replace(/[^a-z0-9]/g, '')).filter(t => t.length > 2).slice(0, 8);
  const description = data.description.replace(/\r/g, '').replace(/#[a-z0-9]+/gi, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 1800);
  const title = tidyTitle(data, details);
  return {listing: {title, description, hashtags: [...new Set(tags)]}, tips: missing};
}
// One clean title shape every time: Colour Brand Product | Size X (the stock number goes on the end in the app).
const titleCase = t => String(t || '').toLowerCase().replace(/(^|[\s/-])([a-z])/g, (m, a, b) => a + b.toUpperCase()).replace(/\b(Uk|Us|Eu)\b/g, w => w.toUpperCase());
export function tidyTitle(data, details = {}) {
  const words = t => String(t || '').replace(/[|~#]/g, ' ').replace(/\s+/g, ' ').trim();
  let colour = titleCase(words(details.Colour || data.colour).split(/[,/&]| and /i)[0].trim());
  const brand = words(details.Brand || data.brand);
  let size = words(details.Size || data.size || (words(data.title).match(/\bsize\s+([a-z0-9]{1,6})\b/i) || [])[1]).replace(/^size\s*/i, '');
  if (/^(xxs|xs|s|m|l|xl|xxl|xxxl|\d?xl)$/i.test(size)) size = size.toUpperCase();
  let product = words(data.product);
  if (!product) { // older reply shape: take the title and strip the parts we place ourselves
    product = words(data.title).replace(/\bsize\s+\S+/ig, '');
  }
  if (!colour) { // no colour given: lift a colour word out of the product so it still leads
    const found = (product.match(/\b(black|white|navy|grey|gray|blue|red|green|beige|cream|brown|pink|purple|yellow|orange|khaki|olive|burgundy|maroon)\b/i) || [])[1];
    if (found) colour = titleCase(found);
  }
  const drop = [colour, brand, size && 'size ' + size].filter(Boolean);
  for (const part of drop) product = product.replace(new RegExp('\\b' + part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'ig'), ' ');
  product = titleCase(product.replace(/\b(mens|men's|womens|women's)\b/ig, ' ').replace(/\s+/g, ' ').trim());
  const front = [colour, brand && (brand === brand.toLowerCase() ? titleCase(brand) : brand), product].filter(Boolean).join(' ').replace(/\s+/g, ' ');
  const tail = size ? ' | Size ' + size : '';
  return (front.slice(0, 63 - tail.length).trim() + tail).trim();
}
const joinWords = list => list.length < 2 ? list.join('') : list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1];
// What the seller could add for a stronger listing, worked out from the facts rather than trusting the model.
export function listingGaps(details, hasPhoto) {
  const gaps = [];
  if (!details.Size) gaps.push('the size');
  if (!details.Condition) gaps.push('the condition');
  if (!hasPhoto) gaps.push('a cover photo');
  if (!details['Item type'] && !/hood|zip|jacket|coat|shirt|tee|jumper|sweat|jeans|trousers|shorts|fleece|gilet|polo|trainers|boots/i.test(details.Name)) gaps.push('the item type');
  if (!details.Colour) gaps.push('the colour');
  if (!details.Measurements) gaps.push('measurements');
  if (!details.Brand) gaps.push('the brand');
  return gaps.slice(0, 3);
}
