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

export function jsonFrom(text, message = 'Pip wrote something unusable. Try again.') {
  const match = String(text || '').match(/\{[\s\S]*\}/);
  try { return JSON.parse(match?.[0] || ''); } catch { throw new HttpError(502, message); }
}
