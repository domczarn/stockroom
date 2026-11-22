import {readBody,HttpError} from './security.js';
import {ask, imageFromDataUrl, aiAllowance} from './llm.js';

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
const LISTING_PROMPT = facts => `You write second-hand clothing listings for Vinted UK that sell fast. ${facts.photo ? 'The image is the seller\'s photo of the item.' : ''}
Item details from the seller (trust these over the photo):
${Object.entries(facts.details).filter(([, v]) => v).map(([k, v]) => `- ${k}: ${v}`).join('\n')}

Write the listing and reply with ONLY a JSON object, no other text:
{"title": string, "description": string, "hashtags": [string]}
Rules:
- title: max 60 characters. Format: Brand + item type + key feature + colour + "Size X". No emojis, no ALL CAPS, no hype words like "rare" unless given.
- description: British English, friendly and honest, 50-110 words. Structure:
  1. One short opening line about the item.
  2. A few lines starting with "• " covering: brand, size (and fit if known), colour, condition, and visible features from the photo (e.g. logo, hood, zip, pockets, cuffs).
  3. Flaws: state the given flaws exactly; if none were given write "No major flaws, see photos."
  4. End with: "Posted within 1–2 working days. Bundle for a discount."
- Never invent material, measurements, flaws or authenticity claims that were not given. Do not include a price.
- hashtags: 6-8 lowercase search tags without spaces, starting with #, e.g. #nike #windbreaker #mensjacket.`;

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
  let result;
  try { result = await run(env, image, LISTING_PROMPT({details, photo: !!image}), 700, 0.5); }
  catch (error) {
    console.log(JSON.stringify({listing: 'error', message: String(error?.message || error).slice(0, 300)}));
    throw error instanceof HttpError ? error : new HttpError(502, 'Pip is busy. Try again in a moment.');
  }
  const raw = String(result?.response ?? result ?? '');
  const json = raw.match(/\{[\s\S]*\}/);
  let data;
  try { data = JSON.parse(json?.[0] || ''); } catch { throw new HttpError(502, 'Pip wrote something unusable. Try again.'); }
  const tags = (Array.isArray(data.hashtags) ? data.hashtags : String(data.hashtags || '').split(/\s+/))
    .map(t => '#' + String(t).toLowerCase().replace(/[^a-z0-9]/g, '')).filter(t => t.length > 2).slice(0, 8);
  const description = typeof data.description === 'string' ? data.description.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 1500) : '';
  const title = field(data.title, 80);
  if (!title || !description) throw new HttpError(502, 'Pip wrote something unusable. Try again.');
  return {listing: {title, description, hashtags: [...new Set(tags)]}};
}
