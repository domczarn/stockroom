// Pip's brain: Claude (Anthropic API) when a key is set, Cloudflare Workers AI otherwise.
import {HttpError} from './security.js';

const WORKERS_MODEL = '@cf/meta/llama-3.2-11b-vision-instruct';
const DAILY_AI_LIMIT = 300; // per person per day, stops runaway cost

const mediaType = bytes => bytes[0] === 0x89 ? 'image/png' : bytes[0] === 0x52 ? 'image/webp' : 'image/jpeg';
function toBase64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.slice(i, i + 0x8000));
  return btoa(out);
}
export function imageFromDataUrl(value, maxChars = 2_800_000) {
  const match = typeof value === 'string' && value.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match || match[2].length > maxChars) return null;
  return Uint8Array.from(atob(match[2]), c => c.charCodeAt(0));
}

export async function aiAllowance(env, user) {
  if (!user || user.admin || !env.DB) return;
  const day = Math.floor(Date.now() / 86400000);
  const row = await env.DB.prepare('INSERT INTO rate_limits (key,window,count) VALUES (?,?,1) ON CONFLICT(key) DO UPDATE SET count = CASE WHEN window = excluded.window THEN count + 1 ELSE 1 END, window = excluded.window RETURNING count')
    .bind('ai:' + user.id, day).first();
  if (row.count > DAILY_AI_LIMIT) throw new HttpError(429, 'Pip has done a lot today. Try again tomorrow.');
}

// ask(env, {system, prompt, image (Uint8Array), maxTokens, temperature}) → plain text reply.
export async function ask(env, {system = '', prompt, image = null, maxTokens = 600, temperature = 0.3, history = []}) {
  if (env.ANTHROPIC_API_KEY) {
    const content = [];
    if (image) content.push({type: 'image', source: {type: 'base64', media_type: mediaType(image), data: toBase64(image)}});
    content.push({type: 'text', text: prompt});
    const response = await (env.ANTHROPIC_FETCH || fetch)('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: AbortSignal.timeout(45000),
      headers: {'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json'},
      body: JSON.stringify({model: env.ANTHROPIC_MODEL || 'claude-haiku-5-5', max_tokens: maxTokens, temperature, ...(system ? {system} : {}),
        messages: [...history, {role: 'user', content}]}),
    }).catch(() => null);
    if (response?.ok) {
      const data = await response.json();
      return (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
    }
    console.log(JSON.stringify({ai: 'anthropic_error', status: response?.status || 0, body: (await response?.text().catch(() => '') || '').slice(0, 300)}));
    if (!env.AI) throw new HttpError(502, 'Pip is busy. Try again in a moment.');
  }
  if (!env.AI) throw new HttpError(503, 'Pip’s AI isn’t set up yet.');
  const text = (system ? system + '\n\n' : '') + history.map(m => (m.role === 'user' ? 'User: ' : 'Pip: ') + (typeof m.content === 'string' ? m.content : '')).join('\n') + (history.length ? '\nUser: ' : '') + prompt;
  const input = {messages: [{role: 'user', content: text}], ...(image ? {image: [...image]} : {}), max_tokens: maxTokens, temperature};
  let result;
  try { result = await env.AI.run(WORKERS_MODEL, input); }
  catch (error) {
    if (!/agree|licen[cs]e/i.test(String(error?.message || error))) throw new HttpError(502, 'Pip is busy. Try again in a moment.');
    await env.AI.run(WORKERS_MODEL, {prompt: 'agree'});
    result = await env.AI.run(WORKERS_MODEL, input);
  }
  return String(result?.response ?? result ?? '').trim();
}

// Models sometimes put raw line breaks or tabs inside JSON strings, or wrap JSON in ```fences```. Repair before parsing.
export function repairJson(raw) {
  let out = '', inString = false, escaped = false;
  for (const ch of raw) {
    if (inString) {
      if (escaped) { out += ch; escaped = false; continue; }
      if (ch === '\\') { out += ch; escaped = true; continue; }
      if (ch === '"') { inString = false; out += ch; continue; }
      if (ch === '\n') { out += '\\n'; continue; }
      if (ch === '\r') continue;
      if (ch === '\t') { out += '\\t'; continue; }
      out += ch;
    } else { if (ch === '"') inString = true; out += ch; }
  }
  return out.replace(/,\s*([}\]])/g, '$1');
}
export function jsonFrom(text, message = 'Pip wrote something unusable. Try again.') {
  const match = String(text || '').replace(/```(?:json)?/gi, '').match(/\{[\s\S]*\}/);
  if (!match) throw new HttpError(502, message);
  try { return JSON.parse(match[0]); } catch {}
  try { return JSON.parse(repairJson(match[0])); } catch { throw new HttpError(502, message); }
}

// Admin check: is Pip really talking to Claude? Makes a tiny request and reports the exact reason if not.
export async function aiStatus(env) {
  const model = env.ANTHROPIC_MODEL || 'claude-haiku-5-5';
  if (!env.ANTHROPIC_API_KEY) return {provider: env.AI ? 'cloudflare' : 'none', model: null, ok: false, reason: 'No ANTHROPIC_API_KEY secret is set on the stockroom Worker, so Pip uses the free Cloudflare model.'};
  const response = await (env.ANTHROPIC_FETCH || fetch)('https://api.anthropic.com/v1/messages', {
    method: 'POST', signal: AbortSignal.timeout(20000),
    headers: {'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json'},
    body: JSON.stringify({model, max_tokens: 5, messages: [{role: 'user', content: 'Say OK'}]}),
  }).catch(error => ({ok: false, status: 0, text: async () => String(error?.message || error)}));
  if (response.ok) return {provider: 'claude', model, ok: true, reason: 'Claude is connected and answering.'};
  let detail = '';
  try { const body = JSON.parse(await response.text()); detail = body?.error?.message || ''; } catch {}
  const reason = response.status === 401 ? 'Anthropic rejected the key. Re-copy it into the ANTHROPIC_API_KEY secret.'
    : response.status === 400 && /credit/i.test(detail) ? 'Your Anthropic account has no credit. Add credit under Billing.'
    : response.status === 404 ? 'The model "' + model + '" wasn’t found on your account.'
    : response.status === 429 ? 'Anthropic is rate limiting this key right now.'
    : 'Anthropic returned an error' + (response.status ? ' (' + response.status + ')' : '') + '.';
  return {provider: env.AI ? 'cloudflare' : 'none', model, ok: false, reason: reason + (detail ? ' Details: ' + detail.slice(0, 200) : '') + ' Pip is using the free Cloudflare model until this is fixed.'};
}
