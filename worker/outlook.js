// One-tap Outlook / Hotmail / Live connect (Microsoft Graph, read-only mail). Free: no paid security audit like
// Google's. Same storage, same email reader and same sender checks as Gmail; only fetching the emails differs.
// Off until MS_CLIENT_ID and MS_CLIENT_SECRET are set (Azure app registration, redirect URI below).
import {HttpError} from './security.js';
import {receiptUpdate, enrichFromParts, verifiedSender, countVintedMail, COURIER_DOMAINS, PLATFORM_SENDERS, protect, unprotect, random, connection, mailboxPattern} from './gmail.js';
import {forwardedSender} from './inbound.js';

export const MS_PREFIX = 'ms:';
const origin = 'https://stockroom.bookednpaid.com';
const callback = origin + '/api/outlook/callback';
const SCOPES = 'offline_access openid email User.Read Mail.Read';
const AUTH = 'https://login.microsoftonline.com/common/oauth2/v2.0';
const GRAPH = 'https://graph.microsoft.com/v1.0/me';

export const outlookConfigured = env => Boolean(env.MS_CLIENT_ID && env.MS_CLIENT_SECRET);
const redirect = result => new Response(null, {status: 303, headers: {Location: '/?gmail=' + result, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer'}});
const b64url = bytes => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');

async function msJSON(url, options = {}) {
  let res;
  try { res = await fetch(url, {...options, redirect: 'manual', signal: AbortSignal.timeout(9000)}); }
  catch { throw new HttpError(502, 'Outlook could not be reached. Try again shortly.'); }
  const body = await res.json().catch(() => ({}));
  if (res.status === 400 && /invalid_grant|interaction_required/.test(body?.error || '')) throw new HttpError(409, 'Reconnect Outlook to continue.');
  if (res.status === 401 || res.status === 403) throw new HttpError(409, 'Reconnect Outlook to continue.');
  if (!res.ok) throw new HttpError(502, 'Outlook returned an error. Try again shortly.');
  return body;
}
async function msToken(env, args) {
  const tokens = await msJSON(AUTH + '/token', {method: 'POST', body: new URLSearchParams({client_id: env.MS_CLIENT_ID, client_secret: env.MS_CLIENT_SECRET, scope: SCOPES, ...args})});
  if (typeof tokens.access_token !== 'string' || !tokens.access_token) throw new HttpError(502, 'Outlook did not return an access token.');
  return tokens;
}
const graph = (path, token) => msJSON(GRAPH + path, {headers: {Authorization: 'Bearer ' + token, Accept: 'application/json'}});

export async function outlookStart(env, user, url) {
  if (!outlookConfigured(env)) throw new HttpError(404, 'Outlook connect isn’t switched on yet.');
  if (url.origin !== origin) throw new HttpError(400, 'Open Stockroom on stockroom.bookednpaid.com to connect Outlook.');
  const state = random(), verifier = random(), expires = Date.now() + 600000;
  await env.DB.prepare(`INSERT INTO gmail_oauth_states (owner_id,state,verifier,expires_at) VALUES (?,?,?,?)
    ON CONFLICT(owner_id) DO UPDATE SET state=excluded.state,verifier=excluded.verifier,expires_at=excluded.expires_at`).bind(user.id, 'ms.' + state, verifier, expires).run();
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const ms = new URL(AUTH + '/authorize');
  ms.search = new URLSearchParams({client_id: env.MS_CLIENT_ID, redirect_uri: callback, response_type: 'code', response_mode: 'query', scope: SCOPES,
    prompt: 'select_account', state: 'ms.' + state, code_challenge: challenge, code_challenge_method: 'S256'}).toString();
  return {authorizeUrl: ms.href};
}

export async function outlookFinish(env, user, url) {
  if (url.origin !== origin) return redirect('failed');
  const state = url.searchParams.get('state') || '';
  if (!/^ms\.[A-Za-z0-9_-]{43}$/.test(state)) return redirect('expired');
  const pending = await env.DB.prepare('UPDATE gmail_oauth_states SET expires_at=-expires_at WHERE owner_id=? AND state=? AND expires_at>? RETURNING verifier').bind(user.id, state, Date.now()).first();
  if (!pending) return redirect('expired');
  try {
    if (url.searchParams.get('error')) return redirect('cancelled');
    const code = url.searchParams.get('code');
    if (!code || code.length > 4000) return redirect('failed');
    const tokens = await msToken(env, {code, code_verifier: pending.verifier, redirect_uri: callback, grant_type: 'authorization_code'});
    if (!String(tokens.scope || '').split(' ').some(s => /mail\.read$/i.test(s)) || typeof tokens.refresh_token !== 'string') return redirect('permission');
    const me = await graph('?$select=mail,userPrincipalName', tokens.access_token);
    const mailbox = String(me.mail || me.userPrincipalName || '').trim().toLowerCase();
    if (!mailboxPattern.test(mailbox)) return redirect('failed');
    const sealed = await protect(env, user.id, tokens.refresh_token);
    const done = await env.DB.prepare(`INSERT INTO gmail_connections (owner_id,connection_id,mailbox,token,days)
      SELECT ?,?,?,?,7 WHERE EXISTS(SELECT 1 FROM gmail_oauth_states WHERE owner_id=? AND state=? AND expires_at<0)
      ON CONFLICT(owner_id) DO UPDATE SET connection_id=excluded.connection_id,token=excluded.token,
        receipts=CASE WHEN mailbox=excluded.mailbox THEN receipts ELSE '[]' END,mailbox=excluded.mailbox,days=7,
        state='connected',checked_at=NULL,lease=0`).bind(user.id, MS_PREFIX + random().slice(0, 24), mailbox, sealed, user.id, state).run();
    return redirect(done.meta.changes ? 'connected' : 'expired');
  } catch (error) { console.error('Outlook connect failed', error?.status || '', String(error?.message || error).slice(0, 200)); return redirect('failed'); }
}

const trusted = address => {
  const a = String(address || '').toLowerCase(), domain = a.split('@')[1] || '';
  return a === 'no-reply@vinted.co.uk' || PLATFORM_SENDERS[a] === domain || COURIER_DOMAINS.some(d => domain === d || domain.endsWith('.' + d));
};
export async function hexId(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
}
const htmlText = html => String(html || '').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&pound;/g, '£').replace(/[ \t]+/g, ' ');

// Fetch new sale / courier emails from Outlook and turn them into receipts (the caller merges and saves them).
export async function outlookFetch(env, user, row, now = Date.now()) {
  const refresh = await unprotect(env, user.id, row.token);
  const tokens = await msToken(env, {refresh_token: refresh, grant_type: 'refresh_token'});
  // Microsoft hands out a new refresh token each time: keep the newest.
  if (typeof tokens.refresh_token === 'string' && tokens.refresh_token !== refresh)
    await env.DB.prepare('UPDATE gmail_connections SET token=? WHERE owner_id=? AND connection_id=?').bind(await protect(env, user.id, tokens.refresh_token), user.id, row.connection_id).run();
  const token = tokens.access_token, since = new Date(now - Math.max(1, row.days || 7) * 86400000).toISOString();
  const list = await graph('/messages?$filter=' + encodeURIComponent('receivedDateTime ge ' + since) + '&$orderby=receivedDateTime%20desc&$top=50&$select=id,subject,from,receivedDateTime,hasAttachments', token);
  const known = new Map(JSON.parse(row.receipts || '[]').map(r => [r.id, r]));
  const results = [];
  let budget = 36;
  for (const m of list.value || []) {
    if (budget < 2) break;   // the rest are picked up next check
    const address = m.from?.emailAddress?.address;
    if (!trusted(address)) continue;
    const id = await hexId(m.id);
    if (known.get(id)?.read) continue;
    budget--;
    const full = await graph('/messages/' + encodeURIComponent(m.id) + '?$select=subject,receivedDateTime,body,internetMessageHeaders', token);
    const headers = full.internetMessageHeaders || [], h = name => headers.filter(x => x.name?.toLowerCase() === name).map(x => x.value);
    const from = (m.from.emailAddress.name ? '"' + m.from.emailAddress.name.replace(/"/g, '') + '" ' : '') + '<' + address + '>';
    const sender = forwardedSender(from, [...h('authentication-results'), ...h('arc-authentication-results')]);
    if (!sender || !verifiedSender(from, 'mx.google.com; dmarc=pass header.from=' + sender)) continue;
    const text = full.body?.contentType === 'html' ? htmlText(full.body.content) : String(full.body?.content || '');
    const received = Date.parse(full.receivedDateTime || m.receivedDateTime) || now;
    let receipt = receiptUpdate({id, internalDate: String(Math.min(received, now)), snippet: text.slice(0, 400),
      payload: {headers: [{name: 'From', value: from}, {name: 'Subject', value: full.subject || ''}, {name: 'Authentication-Results', value: 'mx.google.com; dmarc=pass header.from=' + sender}]}}, Math.max(1, row.days || 7), now);
    if (sender === 'vinted.co.uk') await countVintedMail(env, [{subject: full.subject, receipt}]);
    if (!receipt) continue;
    let files = [];
    if (m.hasAttachments && (receipt.courier || receipt.event?.type === 'label') && budget > 1) {
      budget--;
      const att = await graph('/messages/' + encodeURIComponent(m.id) + '/attachments', token).catch(() => ({value: []}));
      files = (att.value || []).filter(a => a.contentBytes).map(a => ({name: a.name || 'attachment', type: a.contentType, size: a.size || 0, bytes: Uint8Array.from(atob(a.contentBytes), c => c.charCodeAt(0))}));
    }
    receipt = {...(await enrichFromParts(env, user.id, {...receipt, needsBody: true}, {text, files}, async f => f.bytes)), read: 2};
    results.push(receipt);
  }
  return results;
}
export {connection};
