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
  await env.DB.batch([
    env.DB.prepare('DELETE FROM audit_events WHERE created_at < ?').bind(new Date(now - 90 * 86400000).toISOString()),
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now),
    env.DB.prepare('DELETE FROM login_codes WHERE expires_at < ?').bind(now - 86400000),
    env.DB.prepare('DELETE FROM auth_challenges WHERE expires_at < ?').bind(now - 86400000)
  ]).catch(() => {});
  if (!env.RESEND_API_KEY) return;
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
