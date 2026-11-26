// Email forwarding: the no-permission way to get sales, labels and QR codes into Stockroom.
// Each account gets a private address (<token>@FORWARD_DOMAIN). The seller sets up one forwarding rule in their own
// email (Gmail, Outlook…) for Vinted, courier, eBay and Depop emails; Cloudflare Email Routing hands each email to
// this Worker, and it goes through exactly the same reader as Gmail sync. No Google permission, no 100-user cap.
import PostalMime from 'postal-mime';
import {receiptUpdate, enrichFromParts, capFreeSales, verifiedSender, COURIER_DOMAINS, PLATFORM_SENDERS} from './gmail.js';
import {isPro} from './billing.js';
import {notifyAccount} from './push.js';
import {HttpError} from './security.js';

export const FORWARD_PREFIX = 'fwd:';
const TOKEN = /^[a-z0-9]{12,40}$/;
const MAX_BYTES = 6_000_000;

export function forwardAddress(env, row) {
  return row?.connection_id?.startsWith(FORWARD_PREFIX) && env.FORWARD_DOMAIN ? row.connection_id.slice(FORWARD_PREFIX.length) + '@' + env.FORWARD_DOMAIN : '';
}
// The Gmail search a seller pastes into "Create filter" so only these emails are forwarded.
export function forwardFilter() {
  return 'from:(' + ['no-reply@vinted.co.uk', ...Object.keys(PLATFORM_SENDERS), ...COURIER_DOMAINS.map(d => '@' + d)].join(' OR ') + ')';
}

export async function startForwarding(env, user) {
  if (!env.FORWARD_DOMAIN) throw new HttpError(404, 'Email forwarding isn’t switched on yet.');
  const existing = await env.DB.prepare('SELECT * FROM gmail_connections WHERE owner_id=?').bind(user.id).first();
  if (existing?.connection_id?.startsWith(FORWARD_PREFIX)) return existing;
  if (existing) throw new HttpError(409, 'Gmail is already connected. Disconnect it first to switch to forwarding.');
  const token = [...crypto.getRandomValues(new Uint8Array(12))].map(b => b.toString(36).padStart(2, '0')).join('').replace(/[^a-z0-9]/g, '').slice(0, 18);
  await env.DB.prepare("INSERT INTO gmail_connections (owner_id,connection_id,mailbox,token,enabled,alerts,days,state,receipts) VALUES (?,?,?,'',1,1,30,'waiting','[]')")
    .bind(user.id, FORWARD_PREFIX + token, token + '@' + env.FORWARD_DOMAIN).run();
  return env.DB.prepare('SELECT * FROM gmail_connections WHERE owner_id=?').bind(user.id).first();
}

// Gmail asks you to confirm a new forwarding address by emailing it a code. We show that code in the app.
export function forwardingConfirmation(fromAddress, subject, text) {
  if (String(fromAddress).toLowerCase() !== 'forwarding-noreply@google.com') return null;
  const code = (String(subject).match(/\(#(\d{6,12})\)/) || String(text).match(/Confirmation code:\s*(\d{6,12})/i) || [])[1];
  if (!code) return null;
  const link = (String(text).match(/https:\/\/mail(?:-settings)?\.google\.com\/mail\/[^\s<>"]+/) || [])[0] || '';
  const forAddress = (String(subject).match(/from\s+([^\s]+@[^\s]+)/i) || [])[1] || '';
  return {code, link: link.slice(0, 600), forAddress: forAddress.slice(0, 120)};
}

// Forwarded mail keeps the original sender's checks in its headers (Gmail: Authentication-Results / ARC from
// mx.google.com; Outlook: its own results). The original sender must have passed DMARC, exactly as with Gmail sync.
export function forwardedSender(from, authValues) {
  for (const raw of authValues) {
    const value = String(raw || '').replace(/^\s*i=\d+;\s*/, '');
    const asGoogle = /^mx\.google\.com\s*;/i.test(value) ? value : /dmarc=pass/i.test(value) ? 'mx.google.com; ' + value.replace(/^[a-z0-9.-]+\.(?:outlook|office365|hotmail)\.com\s*;\s*/i, '') : '';
    const domain = asGoogle && verifiedSender(from, asGoogle);
    if (domain) return domain;
  }
  return null;
}

// Hex id that's stable for the same email, so a re-forward is never counted twice.
async function emailId(email, raw) {
  const basis = email.messageId || (email.date || '') + (email.subject || '') + raw.byteLength;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(basis));
  return [...new Uint8Array(digest)].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function inboundEmail(message, env, context) {
  const to = String(message.to || '').toLowerCase(), [local, domain] = to.split('@');
  if (!env.FORWARD_DOMAIN || domain !== String(env.FORWARD_DOMAIN).toLowerCase() || !TOKEN.test(local || '')) { message.setReject('Unknown address'); return; }
  const row = await env.DB.prepare('SELECT * FROM gmail_connections WHERE connection_id=?').bind(FORWARD_PREFIX + local).first();
  if (!row || !row.enabled) { message.setReject('Unknown address'); return; }
  if (Number(message.rawSize) > MAX_BYTES) return;   // accept and drop: nothing we read is that big
  const raw = await new Response(message.raw).arrayBuffer();
  const email = await PostalMime.parse(raw);
  const header = name => email.headers.filter(h => h.key === name).map(h => h.value);
  const fromHeader = header('from')[0] || (email.from?.address || '');
  const text = email.text || String(email.html || '').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
  const now = Date.now();

  const confirm = forwardingConfirmation(email.from?.address, email.subject, text);
  if (confirm) return saveReceipts(env, context, row, [{id: 'fwdconfirm', category: 'Setup', subject: 'Gmail forwarding code', receivedAt: new Date(now).toISOString(), forward: confirm}]);

  const sender = forwardedSender(fromHeader, [...header('authentication-results'), ...header('arc-authentication-results')]);
  if (!sender) return;   // not from a sender we trust: ignore quietly
  const id = await emailId(email, raw);
  const sent = Date.parse(email.date || '') || now;
  const fake = {id, internalDate: String(Math.min(sent, now)), snippet: text.slice(0, 400),
    payload: {headers: [{name: 'From', value: fromHeader}, {name: 'Subject', value: email.subject || ''}, {name: 'Authentication-Results', value: 'mx.google.com; dmarc=pass header.from=' + sender}]}};
  let receipt = receiptUpdate(fake, 30, now);
  if (!receipt) return;
  const files = (email.attachments || []).map(a => ({name: a.filename || 'attachment', type: a.mimeType, size: a.content?.byteLength || 0, bytes: new Uint8Array(a.content || new ArrayBuffer(0))}));
  if (receipt.needsBody || receipt.courier || receipt.platformSale || (receipt.event?.type === 'label' && !receipt.event.tracking))
    receipt = {...(await enrichFromParts(env, row.owner_id, {...receipt, needsBody: true}, {text, files}, async f => f.bytes)), read: 2};
  return saveReceipts(env, context, row, [receipt]);
}

async function saveReceipts(env, context, row, receipts) {
  const pro = await isPro(env, {id: row.owner_id}).catch(() => false);
  for (let attempt = 0; attempt < 4; attempt++) {
    const current = await env.DB.prepare('SELECT receipts,alerts,state FROM gmail_connections WHERE owner_id=? AND connection_id=?').bind(row.owner_id, row.connection_id).first();
    if (!current) return;
    const before = JSON.parse(current.receipts || '[]'), merged = new Map(before.map(r => [r.id, r]));
    for (const r of receipts) merged.set(r.id, {...merged.get(r.id), ...r});
    const recent = capFreeSales([...merged.values()].sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt))).slice(0, 220), pro);
    const state = receipts.some(r => r.category !== 'Setup') ? 'connected' : current.state;
    const done = await env.DB.prepare('UPDATE gmail_connections SET receipts=?,state=?,checked_at=? WHERE owner_id=? AND connection_id=? AND receipts=?')
      .bind(JSON.stringify(recent), state, new Date().toISOString(), row.owner_id, row.connection_id, current.receipts).run();
    if (done.meta.changes) {
      if (current.alerts && receipts.some(r => r.event && !before.some(b => b.id === r.id))) notifyAccount(context, env, row.owner_id, 'gmail');
      return;
    }
  }
}
