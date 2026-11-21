// Weekly Pip report: every Monday morning (UK time) each member gets last week's numbers by email.
import {HttpError, readBody, ADMIN_EMAIL} from './security.js';
import {ask} from './llm.js';
import {loadWorkspace} from './workspace-store.js';

const DAY = 86400000;
const gbp = n => '£' + (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const londonParts = (now = new Date()) => Object.fromEntries(new Intl.DateTimeFormat('en-GB', {timeZone: 'Europe/London', weekday: 'short', hour: 'numeric', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(now).map(p => [p.type, p.value]));
const weekKey = (now = new Date()) => { const p = londonParts(now); return p.year + '-' + p.month + '-' + p.day; };

async function hmac(env, value) {
  const secret = env.STOCKROOM_SERVICE_KEY || env.RESEND_API_KEY || 'stockroom';
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('weekly:' + value)))].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

// Last 7 days of a workspace, plus the 7 before for comparison.
export function weeklyNumbers(data, now = Date.now()) {
  const trades = new Map((data.trades || []).map(t => [t.itemId, t]));
  const items = (data.items || []).filter(i => !i.deletedAt);
  const inWindow = (date, from, to) => { const t = Date.parse(date); return Number.isFinite(t) && t >= from && t < to; };
  const start = now - 7 * DAY, prevStart = now - 14 * DAY;
  const sales = (from, to) => items.map(item => {
    const trade = trades.get(item.id);
    const soldAt = trade?.soldAt || item.soldAt, amount = Number(trade?.amount ?? item.sale);
    return item.status === 'Sold' && inWindow(soldAt, from, to) && Number.isFinite(amount) ? {item, amount, profit: amount - (Number(item.cost) || 0)} : null;
  }).filter(Boolean);
  const week = sales(start, now), prev = sales(prevStart, start);
  const inStock = items.filter(i => i.status === 'In Stock');
  const stale = inStock.filter(i => i.listedAt && now - Date.parse(i.listedAt) > 30 * DAY).sort((a, b) => Date.parse(a.listedAt) - Date.parse(b.listedAt));
  return {
    sold: week.length, revenue: week.reduce((s, r) => s + r.amount, 0), profit: week.reduce((s, r) => s + r.profit, 0),
    prevRevenue: prev.reduce((s, r) => s + r.amount, 0),
    best: week.sort((a, b) => b.profit - a.profit)[0] || null,
    added: items.filter(i => inWindow(i.purchasedAt, start, now)).length,
    inStock: inStock.length, tiedUp: inStock.reduce((s, i) => s + (Number(i.cost) || 0), 0),
    stale: stale.length, staleNames: stale.slice(0, 3).map(i => i.name),
  };
}

async function pipTake(env, n) {
  const fallback = n.sold ? (n.stale ? `Good week. Now give your ${n.stale} older listings a refresh: new first photo or a small price drop.` : 'Good week. Keep listing while you’re selling.')
    : n.inStock ? 'Quiet week. Refresh your oldest listings and send offers to anyone who liked them.' : 'Add some stock this week so Pip has something to sell.';
  if (!env.ANTHROPIC_API_KEY) return fallback;
  try {
    const t = await ask(env, {maxTokens: 120, temperature: .6, prompt: `You are Pip, a friendly UK reselling coach. Write ONE or TWO short sentences (max 35 words) of specific, practical advice for this Vinted seller's week ahead. No greetings, no emojis.
Last 7 days: ${n.sold} sold, revenue ${gbp(n.revenue)}, profit ${gbp(n.profit)} (previous week revenue ${gbp(n.prevRevenue)}). Added ${n.added} items. ${n.inStock} in stock worth ${gbp(n.tiedUp)} at cost. ${n.stale} listings older than 30 days${n.staleNames.length ? ' e.g. ' + n.staleNames.join(', ') : ''}.`});
    return t.replace(/\s+/g, ' ').trim().slice(0, 260) || fallback;
  } catch { return fallback; }
}

function emailHtml(name, n, take, origin, unsub) {
  const trend = n.prevRevenue > 0 ? Math.round((n.revenue - n.prevRevenue) / n.prevRevenue * 100) : null;
  const tile = (label, value, sub) => `<td style="padding:14px;border:1px solid #2a2a30;border-radius:12px;background:#1a1a1e;width:50%"><div style="font:500 10px ui-monospace,Menlo,monospace;letter-spacing:.08em;text-transform:uppercase;color:#85858f">${label}</div><div style="font:650 24px -apple-system,Segoe UI,sans-serif;color:#f5f5f7;margin-top:6px">${value}</div><div style="font:13px -apple-system,Segoe UI,sans-serif;color:#85858f;margin-top:2px">${sub}</div></td>`;
  return `<div style="background:#131316;padding:28px 12px"><div style="max-width:520px;margin:auto;font-family:-apple-system,Segoe UI,sans-serif;color:#f5f5f7">
<p style="font:500 10px ui-monospace,Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;color:#cdc5ff;margin:0">Booked &amp; Paid Stockroom</p>
<h1 style="font-size:24px;margin:6px 0 4px">Your week, ${esc(name)}</h1><p style="color:#b4b4bd;margin:0 0 18px">Here’s how the last 7 days went.</p>
<table role="presentation" style="width:100%;border-collapse:separate;border-spacing:8px"><tr>${tile('Sales', gbp(n.revenue), n.sold + ' sold' + (trend != null ? ` · ${trend >= 0 ? '▲' : '▼'} ${Math.abs(trend)}% vs last week` : ''))}${tile('Profit', gbp(n.profit), 'After what you paid')}</tr>
<tr>${tile('Added', String(n.added), 'New items this week')}${tile('In stock', String(n.inStock), gbp(n.tiedUp) + ' tied up')}</tr></table>
${n.best ? `<p style="color:#b4b4bd;margin:16px 8px 0">Best sale: <b style="color:#f5f5f7">${esc(n.best.item.name)}</b> for ${gbp(n.best.amount)} (${gbp(n.best.profit)} profit).</p>` : ''}
${n.stale ? `<p style="color:#b4b4bd;margin:8px 8px 0">${n.stale} listing${n.stale === 1 ? ' has' : 's have'} been up over 30 days${n.staleNames.length ? ': ' + esc(n.staleNames.join(', ')) : ''}.</p>` : ''}
<div style="margin:18px 8px;padding:14px;border-radius:14px;border:1px solid rgba(155,140,255,.38);background:rgba(155,140,255,.12)"><b style="color:#cdc5ff">Pip’s take</b><p style="margin:6px 0 0;color:#f5f5f7;line-height:1.5">${esc(take)}</p></div>
<p style="margin:0 8px"><a href="${origin}/" style="display:inline-block;background:#f5f5f7;color:#111114;padding:12px 20px;border-radius:999px;text-decoration:none;font-weight:600">Open Stockroom</a></p>
<p style="font-size:12px;color:#85858f;margin:24px 8px 0">You get this every Monday. <a href="${unsub}" style="color:#85858f">Stop weekly emails</a></p></div></div>`;
}

async function sendReport(env, {ownerId, email, name, origin}) {
  const stored = await loadWorkspace(env, ownerId);
  if (!stored) return 'no_workspace';
  const n = weeklyNumbers(stored.data);
  if (!n.inStock && !n.sold && !n.added) return 'empty';
  const take = await pipTake(env, n);
  const unsub = origin + '/email/unsubscribe?u=' + encodeURIComponent(ownerId) + '&t=' + await hmac(env, ownerId);
  const text = `Your week on Stockroom: ${n.sold} sold, ${gbp(n.revenue)} sales, ${gbp(n.profit)} profit. ${n.added} added, ${n.inStock} in stock (${gbp(n.tiedUp)} tied up).\n\nPip's take: ${take}\n\nOpen Stockroom: ${origin}/\nStop weekly emails: ${unsub}`;
  if (!env.RESEND_API_KEY) return 'no_email';
  const response = await (env.RESEND_FETCH || fetch)('https://api.resend.com/emails', {
    method: 'POST', signal: AbortSignal.timeout(10000),
    headers: {authorization: 'Bearer ' + env.RESEND_API_KEY, 'content-type': 'application/json'},
    body: JSON.stringify({from: 'Pip at Stockroom <' + (env.AUTH_EMAIL_FROM || 'login@bookednpaid.com') + '>', to: [email],
      subject: n.sold ? `You sold ${n.sold} this week: ${gbp(n.revenue)}` : 'Your Stockroom week', text, html: emailHtml(name, n, take, origin, unsub),
      headers: {'List-Unsubscribe': '<' + unsub + '>'}}),
  }).catch(() => null);
  return response?.ok ? 'sent' : 'failed';
}

async function recipients(env) {
  const members = (await env.DB.prepare("SELECT m.user_id AS id, m.email, m.name FROM members m WHERE m.status = 'active' AND m.user_id IS NOT NULL").all()).results;
  const owner = await env.DB.prepare('SELECT p.user_id AS id FROM profiles p JOIN workspaces w ON w.owner_id = p.user_id WHERE p.owner = 1 ORDER BY w.updated_at DESC LIMIT 1').first();
  if (owner) members.push({id: owner.id, email: ADMIN_EMAIL, name: 'Dom'});
  const off = new Set(((await env.DB.prepare('SELECT owner_id FROM email_prefs WHERE weekly = 0').all()).results || []).map(r => r.owner_id));
  return members.filter(m => !off.has(m.id));
}

// Cron: Mondays from 8am UK time, a batch at a time until everyone has had this week's report.
export async function scheduledWeekly(env, now = new Date()) {
  const p = londonParts(now);
  if (p.weekday !== 'Mon' || Number(p.hour) < 8 || !env.RESEND_API_KEY) return;
  const week = weekKey(now), origin = env.APP_ORIGIN || 'https://stockroom.bookednpaid.com';
  let budget = 25;
  for (const person of await recipients(env)) {
    if (budget <= 0) break;
    const done = await env.DB.prepare('SELECT 1 FROM weekly_reports WHERE owner_id = ? AND week = ?').bind(person.id, week).first();
    if (done) continue;
    const result = await sendReport(env, {ownerId: person.id, email: person.email, name: person.name || 'there', origin}).catch(() => 'failed');
    if (result !== 'failed') await env.DB.prepare('INSERT OR IGNORE INTO weekly_reports (owner_id, week, sent_at) VALUES (?, ?, ?)').bind(person.id, week, new Date().toISOString()).run();
    if (result === 'sent') budget--;
  }
}

// In-app: email preference and "send me a preview now".
export async function weeklyRoute(request, url, env, user) {
  if (url.pathname === '/api/pip/weekly' && request.method === 'GET') {
    const row = await env.DB.prepare('SELECT weekly FROM email_prefs WHERE owner_id = ?').bind(user.id).first();
    return {weekly: row ? Boolean(row.weekly) : true, emailReady: Boolean(env.RESEND_API_KEY)};
  }
  if (url.pathname === '/api/pip/weekly' && request.method === 'PUT') {
    const {weekly} = await readBody(request, 1000) || {};
    await env.DB.prepare('INSERT INTO email_prefs (owner_id, weekly, updated_at) VALUES (?, ?, ?) ON CONFLICT(owner_id) DO UPDATE SET weekly = excluded.weekly, updated_at = excluded.updated_at').bind(user.id, weekly ? 1 : 0, new Date().toISOString()).run();
    return {weekly: Boolean(weekly)};
  }
  if (url.pathname === '/api/pip/weekly/preview' && request.method === 'POST') {
    const result = await sendReport(env, {ownerId: user.id, email: user.email, name: user.admin ? 'Dom' : (user.email.split('@')[0]), origin: url.origin});
    if (result === 'empty' || result === 'no_workspace') throw new HttpError(400, 'Add some stock first so there’s something to report.');
    if (result !== 'sent') throw new HttpError(502, 'The email didn’t send. Check the Resend key.');
    return {sent: true};
  }
  throw new HttpError(404, 'Not found');
}

// Public link in every email: one click turns the weekly report off.
export async function unsubscribePage(url, env) {
  const id = url.searchParams.get('u') || '', token = url.searchParams.get('t') || '';
  const ok = id && token === await hmac(env, id);
  if (ok) await env.DB.prepare('INSERT INTO email_prefs (owner_id, weekly, updated_at) VALUES (?, 0, ?) ON CONFLICT(owner_id) DO UPDATE SET weekly = 0, updated_at = excluded.updated_at').bind(id, new Date().toISOString()).run();
  const body = ok ? '<h1>You’re unsubscribed</h1><p>No more weekly reports. Turn them back on any time in Settings → Notifications.</p>' : '<h1>That link didn’t work</h1><p>Turn weekly reports off in Settings → Notifications instead.</p>';
  return new Response('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Stockroom</title><body style="font-family:-apple-system,Segoe UI,sans-serif;background:#131316;color:#f5f5f7;display:grid;place-items:center;min-height:90vh;margin:0;text-align:center;padding:20px"><div>' + body + '<p><a style="color:#cdc5ff" href="/">Open Stockroom</a></p></div>',
    {status: ok ? 200 : 400, headers: {'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'"}});
}
