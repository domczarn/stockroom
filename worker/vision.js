import {readBody,HttpError} from './security.js';

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

async function run(env, image) {
  const input = {messages: [{role: 'user', content: PROMPT}], image, max_tokens: 400, temperature: 0.1};
  try { return await env.AI.run(MODEL, input); }
  catch (error) {
    // First use on an account needs Meta's licence accepted once.
    if (!/agree|licen[cs]e/i.test(String(error?.message || error))) throw error;
    await env.AI.run(MODEL, {prompt: 'agree'});
    return env.AI.run(MODEL, input);
  }
}

export async function visionRoute(request, env, user) {
  if (request.method !== 'POST') throw new HttpError(405, 'Method not allowed.');
  if (!user) throw new HttpError(401, 'Sign in first.');
  if (!env.AI) throw new HttpError(503, 'Screenshot reading is not set up yet.');
  const {image} = await readBody(request, 3_000_000) || {};
  const match = typeof image === 'string' && image.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match || match[2].length > 2_800_000) throw new HttpError(400, 'Send one screenshot as an image.');
  const bytes = Uint8Array.from(atob(match[2]), c => c.charCodeAt(0));
  let result;
  try { result = await run(env, [...bytes]); }
  catch (error) {
    console.log(JSON.stringify({vision: 'error', message: String(error?.message || error).slice(0, 300)}));
    throw new HttpError(502, 'Screenshot reading is busy. Try again in a moment.');
  }
  return {listing: parse(result?.response ?? result)};
}
