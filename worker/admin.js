// Admin console API: overview stats, member management, invites, activity and app-wide settings.
// Every route here is owner-only and every change is written to the audit log.
import {HttpError, readBody, audit, adminOnly, ADMIN_EMAIL} from './security.js';

const DEFAULTS = {signups_open: '1', free_limit: '20', announcement: '', announcement_on: '0', announcement_tone: 'info'};
const validEmail = email => email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
const month = () => new Date().toISOString().slice(0, 7);
const now = () => new Date().toISOString();

export async function appSettings(env) {
  const rows = (await env.DB.prepare('SELECT key, value FROM app_settings').all().catch(() => ({results: []}))).results || [];
  return {...DEFAULTS, ...Object.fromEntries(rows.map(r => [r.key, r.value]))};
}
export async function freeLimit(env) {
  const n = Number((await appSettings(env)).free_limit);
  return Number.isInteger(n) && n >= 0 ? n : 20;
}

// One row per person: members joined to their sign-in account, plan, workspace size and last activity.
const MEMBER_SQL = `
  SELECT m.email, m.user_id, m.name, m.status, m.created_at,
    a.plan, a.plan_until, a.stripe_customer, a.stripe_subscription,
    p.username,
    w.updated_at AS saved_at,
    COALESCE(json_array_length(w.payload, '$.items'), 0) AS items,
    (SELECT COUNT(*) FROM json_each(w.payload, '$.items') WHERE json_extract(value, '$.status') = 'Sold') AS sold,
    (SELECT COALESCE(SUM(json_extract(value, '$.sale')), 0) FROM json_each(w.payload, '$.items') WHERE json_extract(value, '$.status') = 'Sold') AS revenue,
    (SELECT MAX(created_at) FROM sessions s WHERE s.account_id = m.user_id) AS last_sign_in,
    (SELECT COUNT(*) FROM sessions s WHERE s.account_id = m.user_id AND s.expires_at > ?) AS live_sessions,
    (SELECT COUNT(*) FROM item_adds i WHERE i.owner_id = m.user_id AND i.month = ?) AS added_this_month,
    (SELECT COUNT(*) FROM gmail_connections g WHERE g.owner_id = m.user_id) AS gmail
  FROM members m
  LEFT JOIN accounts a ON a.id = m.user_id
  LEFT JOIN profiles p ON p.user_id = m.user_id
  LEFT JOIN workspaces w ON w.owner_id = m.user_id`;

function shape(row) {
  const lastActive = [row.saved_at, row.last_sign_in ? new Date(row.last_sign_in).toISOString() : null].filter(Boolean).sort().pop() || null;
  const live = row.plan === 'pro' && (!row.plan_until || Date.parse(row.plan_until) > Date.now());
  return {
    email: row.email, userId: row.user_id, name: row.name, username: row.username || null, status: row.status, joined: row.created_at,
    plan: live ? 'pro' : 'free', planUntil: row.plan_until || null, paid: Boolean(row.stripe_subscription), comped: live && !row.stripe_subscription,
    stripeCustomer: row.stripe_customer || null, lastActive, items: row.items || 0, sold: row.sold || 0, revenue: Math.round((row.revenue || 0) * 100) / 100,
    liveSessions: row.live_sessions || 0, addedThisMonth: row.added_this_month || 0, gmail: Boolean(row.gmail),
  };
}

async function memberById(env, id) {
  const row = await env.DB.prepare(MEMBER_SQL + ' WHERE m.user_id = ?').bind(Date.now(), month(), id).first();
  if (!row) throw new HttpError(404, 'Member not found.');
  return row;
}

async function overview(env) {
  const rows = (await env.DB.prepare(MEMBER_SQL).bind(Date.now(), month()).all()).results.map(shape);
  const day = 86400000, t = Date.now();
  const within = (iso, days) => iso && t - Date.parse(iso) < days * day;
  const pro = rows.filter(r => r.plan === 'pro');
  const paid = pro.filter(r => r.paid);
  // Monthly recurring revenue: yearly plans count as £5/month. Plan length is inferred from the paid-until date.
  const mrr = paid.reduce((sum, r) => sum + (r.planUntil && Date.parse(r.planUntil) - t > 60 * day ? 5 : 7), 0);
  const signups = Array.from({length: 30}, (_, i) => {
    const date = new Date(t - (29 - i) * day).toISOString().slice(0, 10);
    return {date, count: rows.filter(r => (r.joined || '').slice(0, 10) === date).length};
  });
  const settings = await appSettings(env);
  return {
    members: rows.length, active: rows.filter(r => r.status === 'active').length, suspended: rows.filter(r => r.status === 'suspended').length,
    active7: rows.filter(r => within(r.lastActive, 7)).length, active30: rows.filter(r => within(r.lastActive, 30)).length,
    new7: rows.filter(r => within(r.joined, 7)).length, new30: rows.filter(r => within(r.joined, 30)).length,
    pro: pro.length, paid: paid.length, comped: pro.length - paid.length, mrr,
    neverUsed: rows.filter(r => !r.items).length, atLimit: rows.filter(r => r.plan === 'free' && r.addedThisMonth >= Number(settings.free_limit)).length,
    items: rows.reduce((s, r) => s + r.items, 0), revenue: Math.round(rows.reduce((s, r) => s + r.revenue, 0) * 100) / 100,
    signups, settings,
  };
}

async function sendInvite(env, email, origin) {
  if (!env.RESEND_API_KEY) return false;
  const link = origin + '/login';
  const text = 'You’ve been invited to Booked & Paid Stockroom, the app for tracking your resale stock, sales and profit.\n\nSign in with this email address: ' + link + '\n\nNo password needed: you’ll get a 6-digit code by email.';
  const html = '<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:440px;margin:auto;padding:24px;color:#18181b"><p style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#7c6cf0;margin:0 0 4px">Booked &amp; Paid</p><h1 style="font-size:22px;margin:0 0 12px">You’re invited to Stockroom</h1><p style="color:#52525b;line-height:1.6">Track your resale stock, sales and profit in one place. Sign in with this email address. No password needed: you’ll get a 6-digit code.</p><p><a href="' + link + '" style="display:inline-block;background:#18181b;color:#fff;padding:12px 20px;border-radius:999px;text-decoration:none;font-weight:600">Open Stockroom</a></p></div>';
  const response = await (env.RESEND_FETCH || fetch)('https://api.resend.com/emails', {
    method: 'POST', signal: AbortSignal.timeout(10000),
    headers: {authorization: 'Bearer ' + env.RESEND_API_KEY, 'content-type': 'application/json'},
    body: JSON.stringify({from: 'Booked & Paid Stockroom <' + (env.AUTH_EMAIL_FROM || 'login@bookednpaid.com') + '>', to: [email], bcc: [ADMIN_EMAIL], subject: 'You’re invited to Booked & Paid Stockroom', text, html}),
  }).catch(() => null);
  return Boolean(response?.ok);
}

// Removes everything Stockroom holds for one person. Their audit history stays for the record.
async function deleteMember(env, id, email) {
  const steps = [
    ['DELETE FROM workspaces WHERE owner_id = ?', id], ['DELETE FROM sessions WHERE account_id = ?', id], ['DELETE FROM passkeys WHERE account_id = ?', id],
    ['DELETE FROM accounts WHERE id = ?', id], ['DELETE FROM profiles WHERE user_id = ?', id], ['DELETE FROM gmail_connections WHERE owner_id = ?', id],
    ['DELETE FROM email_updates_done WHERE owner_id = ?', id], ['DELETE FROM item_adds WHERE owner_id = ?', id], ['DELETE FROM notification_reads WHERE owner_id = ?', id],
    ['DELETE FROM push_devices WHERE owner_id = ?', id], ['DELETE FROM admin_notes WHERE owner_id = ?', id],
    ['DELETE FROM connections WHERE sender = ? OR recipient = ?', id, id], ['DELETE FROM members WHERE email = ?', email], ['DELETE FROM login_codes WHERE email = ?', email],
  ];
  for (const [sql, ...args] of steps) await env.DB.prepare(sql).bind(...args).run().catch(() => {});
  if (env.BUCKET?.list) {
    let cursor;
    do {
      const page = await env.BUCKET.list({prefix: 'users/' + id + '/', cursor});
      for (const object of page.objects || []) await env.BUCKET.delete(object.key);
      cursor = page.truncated ? page.cursor : undefined;
    } while (cursor);
  }
}

export async function adminRoute(request, url, env, user) {
  adminOnly(user);
  const path = url.pathname.replace(/^\/api\/admin/, '');
  const method = request.method;

  if (path === '/overview' && method === 'GET') return overview(env);

  if (path === '/people' && method === 'GET') {
    const rows = (await env.DB.prepare(MEMBER_SQL + ' ORDER BY m.created_at DESC LIMIT 2000').bind(Date.now(), month()).all()).results.map(shape);
    return {members: rows, freeLimit: await freeLimit(env)};
  }

  const memberMatch = path.match(/^\/people\/([^/]{1,200})(\/[a-z-]+)?$/);
  if (memberMatch) {
    const id = decodeURIComponent(memberMatch[1]), sub = memberMatch[2] || '';
    const row = await memberById(env, id);
    if (sub === '' && method === 'GET') {
      const sessions = (await env.DB.prepare('SELECT created_at, expires_at, device FROM sessions WHERE account_id = ? AND expires_at > ? ORDER BY created_at DESC LIMIT 20').bind(id, Date.now()).all()).results;
      const passkeys = (await env.DB.prepare('SELECT name, created_at FROM passkeys WHERE account_id = ? ORDER BY created_at DESC').bind(id).all()).results;
      const note = await env.DB.prepare('SELECT note, updated_at FROM admin_notes WHERE owner_id = ?').bind(id).first();
      const events = (await env.DB.prepare('SELECT action, actor_id, created_at FROM audit_events WHERE owner_id IN (?, ?) ORDER BY created_at DESC LIMIT 40').bind(id, row.email).all()).results;
      return {member: shape(row), sessions, passkeys, note: note?.note || '', noteUpdated: note?.updated_at || null, events,
        stripeUrl: row.stripe_customer ? 'https://dashboard.stripe.com/customers/' + encodeURIComponent(row.stripe_customer) : null};
    }
    if (sub === '/export' && method === 'GET') {
      const w = await env.DB.prepare('SELECT payload FROM workspaces WHERE owner_id = ?').bind(id).first();
      await audit(env, user, id, 'admin_export');
      return {data: w ? JSON.parse(w.payload) : null};
    }
    if (sub === '/action' && method === 'POST') {
      const body = await readBody(request, 30000) || {};
      const action = String(body.action || '');
      if (action === 'suspend' || action === 'reactivate') {
        await env.DB.prepare('UPDATE members SET status = ? WHERE email = ?').bind(action === 'suspend' ? 'suspended' : 'active', row.email).run();
        if (action === 'suspend') await env.DB.prepare('DELETE FROM sessions WHERE account_id = ?').bind(id).run();
        await audit(env, user, row.email, action === 'suspend' ? 'member_suspended' : 'member_reactivated');
      } else if (action === 'signout') {
        await env.DB.prepare('DELETE FROM sessions WHERE account_id = ?').bind(id).run();
        await audit(env, user, id, 'admin_signed_out_everywhere');
      } else if (action === 'grant_pro') {
        const months = body.months == null ? null : Number(body.months);
        if (months !== null && (!Number.isInteger(months) || months < 1 || months > 120)) throw new HttpError(400, 'Choose between 1 and 120 months, or forever.');
        if (row.stripe_subscription && row.plan === 'pro') throw new HttpError(409, 'They already pay for Pro through Stripe.');
        const until = months ? new Date(Date.now() + months * 30.44 * 86400000).toISOString() : null;
        await env.DB.prepare('INSERT OR IGNORE INTO accounts (id, email, created_at) VALUES (?, ?, ?)').bind(id, row.email, now()).run();
        await env.DB.prepare("UPDATE accounts SET plan = 'pro', plan_until = ?, stripe_subscription = NULL WHERE id = ?").bind(until, id).run();
        await audit(env, user, id, months ? 'admin_granted_pro_' + months + 'm' : 'admin_granted_pro_forever');
      } else if (action === 'remove_pro') {
        if (row.stripe_subscription) throw new HttpError(409, 'This is a paid Stripe subscription. Cancel it in Stripe instead.');
        await env.DB.prepare("UPDATE accounts SET plan = 'free', plan_until = NULL WHERE id = ?").bind(id).run();
        await audit(env, user, id, 'admin_removed_pro');
      } else if (action === 'reset_allowance') {
        await env.DB.prepare('DELETE FROM item_adds WHERE owner_id = ? AND month = ?').bind(id, month()).run();
        await audit(env, user, id, 'admin_reset_allowance');
      } else if (action === 'rename') {
        const name = String(body.name || '').trim().slice(0, 100);
        if (!name) throw new HttpError(400, 'Enter a name.');
        await env.DB.prepare('UPDATE members SET name = ? WHERE email = ?').bind(name, row.email).run();
        await audit(env, user, id, 'admin_renamed_member');
      } else if (action === 'note') {
        const note = String(body.note || '').slice(0, 4000);
        if (note.trim()) await env.DB.prepare('INSERT INTO admin_notes (owner_id, note, updated_at) VALUES (?, ?, ?) ON CONFLICT(owner_id) DO UPDATE SET note = excluded.note, updated_at = excluded.updated_at').bind(id, note, now()).run();
        else await env.DB.prepare('DELETE FROM admin_notes WHERE owner_id = ?').bind(id).run();
      } else if (action === 'delete') {
        if (String(body.confirm || '').trim().toLowerCase() !== row.email) throw new HttpError(400, 'Type their email address exactly to confirm.');
        if (row.stripe_subscription && row.plan === 'pro') throw new HttpError(409, 'Cancel their Stripe subscription first, then delete the account.');
        await deleteMember(env, id, row.email);
        await audit(env, user, row.email, 'admin_deleted_member');
        return {deleted: true};
      } else throw new HttpError(400, 'Unknown action.');
      return {member: shape(await memberById(env, id))};
    }
  }

  if (path === '/invite' && method === 'POST') {
    const body = await readBody(request, 4000) || {};
    const emails = [...new Set(String(body.emails || '').split(/[\s,;]+/).map(e => e.trim().toLowerCase()).filter(Boolean))].slice(0, 50);
    if (!emails.length || emails.some(e => !validEmail(e) || e === ADMIN_EMAIL)) throw new HttpError(400, 'Enter valid email addresses, separated by commas.');
    const results = [];
    for (const email of emails) {
      const existing = await env.DB.prepare('SELECT status FROM members WHERE email = ?').bind(email).first();
      if (!existing) await env.DB.prepare("INSERT INTO members (email, name, status, created_at) VALUES (?, ?, 'active', ?)").bind(email, email.split('@')[0].slice(0, 100), now()).run();
      const sent = body.send ? await sendInvite(env, email, url.origin) : false;
      await audit(env, user, email, 'member_invited');
      results.push({email, existed: Boolean(existing), sent});
    }
    return {results};
  }

  if (path === '/activity' && method === 'GET') {
    const limit = Math.min(500, Math.max(10, Number(url.searchParams.get('limit')) || 200));
    const rows = (await env.DB.prepare(`SELECT e.action, e.created_at, e.owner_id, e.actor_id,
        COALESCE(m1.email, a1.email, e.owner_id) AS target, COALESCE(m2.email, a2.email, CASE WHEN e.actor_id = ? THEN 'You' END, e.actor_id) AS actor
      FROM audit_events e
      LEFT JOIN members m1 ON m1.user_id = e.owner_id LEFT JOIN accounts a1 ON a1.id = e.owner_id
      LEFT JOIN members m2 ON m2.user_id = e.actor_id LEFT JOIN accounts a2 ON a2.id = e.actor_id
      ORDER BY e.created_at DESC LIMIT ?`).bind(user.id, limit).all()).results;
    return {events: rows.map(r => ({action: r.action, at: r.created_at, target: r.target, actor: r.actor === ADMIN_EMAIL ? 'You' : r.actor}))};
  }

  if (path === '/settings') {
    if (method === 'GET') return {settings: await appSettings(env)};
    if (method === 'PUT') {
      const body = await readBody(request, 8000) || {};
      const next = {};
      if ('signups_open' in body) next.signups_open = body.signups_open ? '1' : '0';
      if ('free_limit' in body) { const n = Number(body.free_limit); if (!Number.isInteger(n) || n < 0 || n > 10000) throw new HttpError(400, 'Free limit must be a whole number.'); next.free_limit = String(n); }
      if ('announcement' in body) next.announcement = String(body.announcement || '').slice(0, 280);
      if ('announcement_on' in body) next.announcement_on = body.announcement_on ? '1' : '0';
      if ('announcement_tone' in body) next.announcement_tone = ['info', 'success', 'warning'].includes(body.announcement_tone) ? body.announcement_tone : 'info';
      for (const [key, value] of Object.entries(next)) await env.DB.prepare('INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at').bind(key, value, now()).run();
      if (Object.keys(next).length) await audit(env, user, 'app', 'admin_settings_' + Object.keys(next).join('_'));
      return {settings: await appSettings(env)};
    }
  }
  throw new HttpError(404, 'Not found');
}
