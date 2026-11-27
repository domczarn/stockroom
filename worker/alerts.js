// Error monitoring: server errors are logged, shown in the admin console, and emailed to the owner when they spike.
import {ADMIN_EMAIL} from './security.js';

export async function logError(env, url, status, error) {
  try {
    console.error('Stockroom error', status, url.pathname, String(error?.stack || error?.message || error).slice(0, 500));
    await env.DB.prepare('INSERT INTO error_events (id, at, path, status, message) VALUES (?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), new Date().toISOString(), url.pathname.replace(/[0-9a-f-]{20,}/g, ':id').slice(0, 120), status, String(error?.message || error).slice(0, 300)).run();
  } catch {}
}

export async function recentErrors(env, hours = 24) {
  const since = new Date(Date.now() - hours * 3600000).toISOString();
  const rows = (await env.DB.prepare('SELECT at, path, status, message FROM error_events WHERE at > ? ORDER BY at DESC LIMIT 50').bind(since).all().catch(() => ({results: []}))).results || [];
  const count = (await env.DB.prepare('SELECT COUNT(*) AS n FROM error_events WHERE at > ?').bind(since).first().catch(() => null))?.n || 0;
  return {count, recent: rows};
}

// Cron: email the owner when 10+ errors happen within an hour (at most once every 6 hours). Keeps 30 days of history.
export async function scheduledAlerts(env, now = Date.now()) {
  await env.DB.prepare('DELETE FROM error_events WHERE at < ?').bind(new Date(now - 30 * 86400000).toISOString()).run().catch(() => {});
  // Housekeeping: keep the security log for 90 days and clear out expired sign-in data.
  for (const [sql, value] of [['DELETE FROM audit_events WHERE created_at < ?', new Date(now - 90 * 86400000).toISOString()], ['DELETE FROM sessions WHERE expires_at < ?', now],
    ['DELETE FROM login_codes WHERE expires_at < ?', now - 86400000], ['DELETE FROM usage_daily WHERE day < ?', new Date(now - 180 * 86400000).toISOString().slice(0, 10)], ['DELETE FROM auth_challenges WHERE expires_at < ?', now - 86400000]])
    await env.DB.prepare(sql).bind(value).run().catch(() => {});
  if (!env.RESEND_API_KEY) return;
  await vintedFormatAlert(env, now);
  const hour = new Date(now - 3600000).toISOString();
  const rows = (await env.DB.prepare('SELECT path, status, message FROM error_events WHERE at > ?').bind(hour).all().catch(() => ({results: []}))).results || [];
  if (rows.length < 10) return;
  const last = (await env.DB.prepare("SELECT value FROM app_settings WHERE key = 'last_error_alert'").first().catch(() => null))?.value;
  if (last && now - Date.parse(last) < 6 * 3600000) return;
  const byPath = Object.entries(rows.reduce((acc, r) => { acc[r.path] = (acc[r.path] || 0) + 1; return acc; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const text = `Stockroom had ${rows.length} server errors in the last hour.\n\nMost affected:\n${byPath.map(([p, n]) => `- ${p}: ${n}`).join('\n')}\n\nLatest: ${rows[0].status} ${rows[0].path}: ${rows[0].message}\n\nDetails: Admin console → Overview → Server errors.`;
  const sent = await (env.RESEND_FETCH || fetch)('https://api.resend.com/emails', {
    method: 'POST', signal: AbortSignal.timeout(10000), headers: {authorization: 'Bearer ' + env.RESEND_API_KEY, 'content-type': 'application/json'},
    body: JSON.stringify({from: 'Stockroom alerts <' + (env.AUTH_EMAIL_FROM || 'login@bookednpaid.com') + '>', to: [ADMIN_EMAIL], subject: `⚠️ Stockroom: ${rows.length} errors in the last hour`, text}),
  }).catch(() => null);
  if (sent?.ok) await env.DB.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES ('last_error_alert', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").bind(new Date(now).toISOString(), new Date(now).toISOString()).run();
}

// If Vinted changes its email wording, sales silently stop arriving. Real Vinted emails keep coming in but none
// are understood: over the last 4 days, 8+ seen and 0 understood. Email the owner (at most once every 2 days).
export async function vintedFormatAlert(env, now = Date.now()) {
  const since = new Date(now - 4 * 86400000).toISOString().slice(0, 10);
  const rows = (await env.DB.prepare("SELECT feature, SUM(count) AS n FROM usage_daily WHERE day >= ? AND feature IN ('mail:vinted-seen','mail:vinted-understood') GROUP BY feature").bind(since).all().catch(() => ({results: []}))).results || [];
  const n = Object.fromEntries(rows.map(r => [r.feature, r.n]));
  if ((n['mail:vinted-seen'] || 0) < 8 || (n['mail:vinted-understood'] || 0) > 0) return false;
  const last = (await env.DB.prepare("SELECT value FROM app_settings WHERE key = 'last_vinted_format_alert'").first().catch(() => null))?.value;
  if (last && now - Date.parse(last) < 2 * 86400000) return false;
  const sent = await (env.RESEND_FETCH || fetch)('https://api.resend.com/emails', {method: 'POST', signal: AbortSignal.timeout(10000),
    headers: {authorization: 'Bearer ' + env.RESEND_API_KEY, 'content-type': 'application/json'},
    body: JSON.stringify({from: 'Stockroom alerts <' + (env.AUTH_EMAIL_FROM || 'login@bookednpaid.com') + '>', to: [ADMIN_EMAIL], subject: '⚠️ Stockroom: Vinted emails aren’t being understood',
      text: `In the last 4 days Stockroom received ${n['mail:vinted-seen']} genuine Vinted emails and couldn't turn any of them into a sale, label or delivery.\n\nVinted has probably changed its email wording. Forward one recent "You've sold an item" email to Claude to update the reader.`})}).catch(() => null);
  if (sent?.ok) await env.DB.prepare("INSERT INTO app_settings (key, value, updated_at) VALUES ('last_vinted_format_alert', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").bind(new Date(now).toISOString(), new Date(now).toISOString()).run();
  return !!sent?.ok;
}
