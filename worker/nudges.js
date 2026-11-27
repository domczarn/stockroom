// Pip nudges: a push + email when someone signs up and never adds stock, or goes quiet.
// At most one nudge per stage, two per quiet spell, then silence. Opt-out shares the weekly-report switch.
import {ADMIN_EMAIL} from './security.js';
import {loadWorkspace} from './workspace-store.js';
import {weeklyNumbers, unsubscribeLink} from './weekly.js';
import {pushAccount} from './push.js';

const DAY = 86400000;
const gbp = n => '£' + (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const londonHour = now => Number(new Intl.DateTimeFormat('en-GB', {timeZone: 'Europe/London', hour: 'numeric', hourCycle: 'h23'}).format(now));

// Which nudge (if any) is due. Keys include the quiet spell's start so a new spell can nudge again.
export function pickNudge({createdAt, lastChange, items}, now = Date.now()) {
  const age = now - Date.parse(createdAt), quiet = lastChange ? now - Date.parse(lastChange) : Infinity;
  if (!items) return age >= DAY && age < 14 * DAY ? 'start' : null;
  const spell = String(lastChange || '').slice(0, 10);
  if (quiet >= 21 * DAY && quiet < 60 * DAY) return 'quiet21:' + spell;
  if (quiet >= 7 * DAY && quiet < 21 * DAY) return 'quiet7:' + spell;
  return null;
}

export function nudgeCopy(stage, n) {
  if (stage === 'start') return {
    title: 'Add your first item', push: 'Snap a photo and Pip fills in the rest. Takes 20 seconds.',
    subject: 'Your Stockroom is empty', lines: ['Snap a photo of something you’re selling and Pip fills in the name, brand and a price.', 'Once it’s in, you’ll see what it cost you, what it’s worth, and your profit when it sells.']};
  const stale = n.stale ? ` ${n.stale} ${n.stale === 1 ? 'has' : 'have'} been up 30+ days.` : '';
  const long = stage.startsWith('quiet21');
  return {
    title: long ? 'Your stock misses you' : 'Pip checked your stock',
    push: `${n.inStock} item${n.inStock === 1 ? '' : 's'} in stock, ${gbp(n.tiedUp)} tied up.${stale}`.slice(0, 170),
    subject: long ? `${gbp(n.tiedUp)} still tied up in stock` : `${n.inStock} item${n.inStock === 1 ? '' : 's'} waiting to sell`,
    lines: [`You’ve got ${n.inStock} item${n.inStock === 1 ? '' : 's'} in stock with ${gbp(n.tiedUp)} tied up.${stale}`,
      n.stale ? 'A new first photo or a small price drop usually gets older listings moving. Pip can suggest prices for each one.' : 'Log anything you’ve bought or sold since, so your profit stays right.']};
}

function html(c, origin, unsub) {
  return `<div style="background:#131316;padding:28px 12px"><div style="max-width:520px;margin:auto;font-family:-apple-system,Segoe UI,sans-serif;color:#f5f5f7">
<p style="font:500 10px ui-monospace,Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;color:#cdc5ff;margin:0">Booked &amp; Paid Stockroom</p>
<h1 style="font-size:24px;margin:6px 0 12px">${esc(c.title)}</h1>${c.lines.map(l => `<p style="color:#b4b4bd;line-height:1.5;margin:0 0 10px">${esc(l)}</p>`).join('')}
<p style="margin:18px 0"><a href="${origin}/" style="display:inline-block;background:#f5f5f7;color:#111114;padding:12px 20px;border-radius:999px;text-decoration:none;font-weight:600">Open Stockroom</a></p>
<p style="font-size:12px;color:#85858f;margin:24px 0 0"><a href="${unsub}" style="color:#85858f">Stop Pip emails</a></p></div></div>`;
}

async function candidates(env, now) {
  const iso = ms => new Date(now.getTime() - ms).toISOString();
  return (await env.DB.prepare(`SELECT a.id, a.email, a.created_at, w.updated_at AS last_change FROM accounts a
    LEFT JOIN workspaces w ON w.owner_id = a.id
    LEFT JOIN email_prefs e ON e.owner_id = a.id
    LEFT JOIN profiles p ON p.user_id = a.id
    WHERE COALESCE(e.weekly, 1) = 1 AND COALESCE(p.owner, 0) = 0 AND a.email <> ?
      AND a.created_at < ? AND (w.updated_at IS NULL OR w.updated_at < ? OR a.created_at > ?)
    ORDER BY COALESCE(w.updated_at, a.created_at) DESC LIMIT 300`).bind(ADMIN_EMAIL, iso(DAY), iso(7 * DAY), iso(14 * DAY)).all()).results || [];
}

export async function sendNudge(env, person, stage, n, origin) {
  const c = nudgeCopy(stage, n);
  await pushAccount(env, person.id, 'nudge', c.push).catch(() => {});
  if (!env.RESEND_API_KEY) return true;
  const unsub = await unsubscribeLink(env, person.id, origin);
  const response = await (env.RESEND_FETCH || fetch)('https://api.resend.com/emails', {
    method: 'POST', signal: AbortSignal.timeout(10000),
    headers: {authorization: 'Bearer ' + env.RESEND_API_KEY, 'content-type': 'application/json'},
    body: JSON.stringify({from: 'Pip at Stockroom <' + (env.AUTH_EMAIL_FROM || 'login@bookednpaid.com') + '>', to: [person.email], subject: c.subject,
      text: c.lines.join('\n\n') + `\n\nOpen Stockroom: ${origin}/\nStop Pip emails: ${unsub}`, html: html(c, origin, unsub),
      headers: {'List-Unsubscribe': '<' + unsub + '>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'}}),
  }).catch(() => null);
  return Boolean(response?.ok);
}

// Cron (every 10 min): daytime UK only, a small batch per run.
export async function scheduledNudges(env, now = new Date()) {
  const hour = londonHour(now);
  if (hour < 10 || hour >= 19) return;
  const origin = env.APP_ORIGIN || 'https://stockroom.bookednpaid.com';
  let budget = 10;
  for (const person of await candidates(env, now)) {
    if (budget <= 0) break;
    const stored = person.last_change ? await loadWorkspace(env, person.id).catch(() => null) : null;
    const items = (stored?.data?.items || []).filter(i => !i.deletedAt).length;
    const stage = pickNudge({createdAt: person.created_at, lastChange: person.last_change, items}, now.getTime());
    if (!stage) continue;
    const key = 'nudge:' + stage;
    if (await env.DB.prepare('SELECT 1 FROM weekly_reports WHERE owner_id = ? AND week = ?').bind(person.id, key).first()) continue;
    const n = weeklyNumbers(stored?.data || {}, now.getTime());
    if (stage !== 'start' && !n.inStock) continue;   // nothing waiting to sell: leave them be
    budget--;
    await sendNudge(env, person, stage, n, origin);   // marked sent either way: never repeat a nudge
    await env.DB.prepare('INSERT OR IGNORE INTO weekly_reports (owner_id, week, sent_at) VALUES (?, ?, ?)').bind(person.id, key, now.toISOString()).run();
  }
}
