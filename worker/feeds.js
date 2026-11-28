// Live spreadsheet feeds: private CSV links a spreadsheet pulls in by itself
// (Google Sheets: =IMPORTDATA(link), refreshes about hourly; Excel: Data → From Web).
// Each link is signed per account; "Reset links" bumps a version so old links stop working.
// Also: a one-off backup of every workspace to storage before a data-model change.
import {loadWorkspace} from './workspace-store.js';
import {HttpError} from './security.js';

const FEEDS = ['sold', 'stock', 'expenses'];
const PAID_BY = {company: 'Company account', 'director-card': 'Director personal card', 'director-cash': 'Director cash', business: 'Business account', personal: 'Personal'};

async function sign(env, value) {
  const secret = env.STOCKROOM_SERVICE_KEY || env.RESEND_API_KEY || 'stockroom';
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('feed:' + value)))].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}
async function feedVersion(env, owner) {
  return Number((await env.DB.prepare('SELECT value FROM app_settings WHERE key = ?').bind('feedv:' + owner).first().catch(() => null))?.value) || 1;
}
export async function feedLinks(env, owner, origin) {
  const v = await feedVersion(env, owner), sig = await sign(env, owner + ':' + v);
  return Object.fromEntries(FEEDS.map(name => [name, origin + '/feed/' + encodeURIComponent(owner) + '/' + sig + '/' + name + '.csv']));
}
async function resetFeeds(env, owner) {
  const v = (await feedVersion(env, owner)) + 1;
  await env.DB.prepare('INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at').bind('feedv:' + owner, String(v), new Date().toISOString()).run();
}

// ---------- CSV ----------
const r2 = n => n === null || n === undefined || n === '' || !Number.isFinite(Number(n)) ? '' : (Math.round(Number(n) * 100) / 100).toFixed(2);
function cell(v) {
  let t = String(v ?? '').replace(/\r?\n/g, ' ').trim();
  if (/^[=+\-@\t\r]/.test(t) && !/^-?\d+(\.\d+)?$/.test(t)) t = "'" + t;   // never let a spreadsheet run text as a formula
  return /[",]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
}
const csv = (head, rows) => '﻿' + [head, ...rows].map(r => r.map(cell).join(',')).join('\r\n') + '\r\n';
const daysBetween = (a, b) => a && b ? Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 864e5)) : '';

export function feedCsv(name, data, today = new Date().toISOString().slice(0, 10)) {
  const items = new Map((data.items || []).map(i => [i.id, i]));
  if (name === 'sold') {
    const rows = [];
    for (const t of data.trades || []) {
      const i = items.get(t.itemId) || {}, refunded = (t.refunds || []).reduce((n, r) => n + (Number(r.amount) || 0), 0);
      const costs = (t.extraCost || 0) + (t.packaging || 0) + (t.platformFee || 0) + (t.refunds || []).reduce((n, r) => n + (Number(r.postage) || 0), 0);
      const restocked = (t.refunds || []).some(r => r.restock);
      const profit = t.cost == null ? '' : t.amount - refunded - (restocked ? 0 : t.cost) - costs;
      rows.push([t.soldAt, i.id || '', t.name, i.brand || '', t.platform || i.platform || 'Vinted', r2(t.amount), r2(t.cost), r2(t.extraCost), r2(t.packaging), r2(t.platformFee), r2(refunded || null), r2(profit), i.purchasedAt || '', i.purchaseSource || '', PAID_BY[i.paidBy] || '', restocked ? 'Returned and restocked' : refunded ? 'Part refunded' : t.paidAt ? 'Paid out' : t.completedAt ? 'Completed' : t.postedAt ? 'Posted' : 'Sold']);
    }
    for (const s of data.sales || []) rows.push([s[4] || '', '', s[0], '', 'Earlier record', r2(s[1]), r2(s[3]), '', '', '', '', s[3] == null ? '' : r2(s[1] - s[3]), '', '', '', 'Sold']);
    rows.sort((a, b) => String(b[0]).localeCompare(String(a[0])));
    return csv(['Date sold', 'Stock ID', 'Item', 'Brand', 'Platform', 'Sale price (GBP)', 'Purchase cost (GBP)', 'Postage (GBP)', 'Packaging (GBP)', 'Platform fees (GBP)', 'Refunded (GBP)', 'Profit (GBP)', 'Purchased', 'Bought from', 'Paid by', 'Status'], rows);
  }
  if (name === 'stock') {
    const rows = (data.items || []).filter(i => !i.deletedAt && i.status === 'In Stock').map(i => [i.id, i.name, i.brand || '', i.size || '', i.stage || '', i.purchasedAt || '', i.purchaseSource || '', PAID_BY[i.paidBy] || '', r2(i.cost), r2(i.price), daysBetween(i.purchasedAt, today)]);
    rows.sort((a, b) => String(a[0]).localeCompare(String(b[0]), 'en', {numeric: true}));
    return csv(['Stock ID', 'Item', 'Brand', 'Size', 'Stage', 'Purchased', 'Bought from', 'Paid by', 'Cost (GBP)', 'Asking price (GBP)', 'Days held'], rows);
  }
  if (name === 'expenses') {
    const rows = (data.expenses || []).map(e => [e[4] || '', e[0], e[2] || 'Other', r2(e[1]), PAID_BY[e[8]] || '', e[6] ? (items.get(e[6])?.name || e[6]) : '', e[9] ? 'Yes' : '', e[5] || '']);
    rows.sort((a, b) => String(b[0]).localeCompare(String(a[0])));
    return csv(['Date', 'Description', 'Category', 'Amount (GBP)', 'Paid by', 'Linked stock', 'Receipt', 'Note'], rows);
  }
  return null;
}

// GET /feed/<owner>/<sig>/<name>.csv  (public: the signature is the key)
export async function feedRoute(url, env) {
  const m = url.pathname.match(/^\/feed\/([^/]{1,200})\/([a-f0-9]{32})\/(\w+)\.csv$/);
  if (!m) throw new HttpError(404, 'Not found');
  const owner = decodeURIComponent(m[1]), name = m[3];
  if (!FEEDS.includes(name)) throw new HttpError(404, 'Not found');
  const expected = await sign(env, owner + ':' + await feedVersion(env, owner));
  if (expected !== m[2]) throw new HttpError(404, 'This link has been reset. Copy the new one from Stockroom → Settings → Data & backups.');
  const stored = await loadWorkspace(env, owner);
  if (!stored?.data) throw new HttpError(404, 'Not found');
  return new Response(feedCsv(name, stored.data), {headers: {'content-type': 'text/csv; charset=utf-8', 'cache-control': 'private, max-age=300', 'x-robots-tag': 'noindex'}});
}

// /api/feeds (signed in): GET the links, POST to reset them.
export async function feedsApi(request, url, env, owner) {
  if (request.method === 'POST') await resetFeeds(env, owner);
  else if (request.method !== 'GET') throw new HttpError(405, 'Method not allowed');
  return Response.json({links: await feedLinks(env, owner, url.origin)});
}

// One-off backup of every workspace before a data-model change. Runs from the 10-minute job until done.
export async function backupBeforeRelease(env, tag = 'bookkeeping-r1') {
  if (!env.BUCKET) return;
  const key = 'backup:' + tag;
  if ((await env.DB.prepare('SELECT value FROM app_settings WHERE key = ?').bind(key).first().catch(() => null))?.value) return;
  const owners = (await env.DB.prepare('SELECT owner_id FROM workspaces').all()).results || [];
  let saved = 0;
  for (const {owner_id: owner} of owners) {
    const stored = await loadWorkspace(env, owner).catch(() => null);
    if (!stored?.data) continue;
    await env.BUCKET.put('backups/' + tag + '/' + owner + '.json', JSON.stringify(stored.data), {httpMetadata: {contentType: 'application/json'}});
    saved++;
  }
  await env.DB.prepare('INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .bind(key, JSON.stringify({saved, at: new Date().toISOString()}), new Date().toISOString()).run();
  console.log('Backup', tag, 'saved', saved, 'workspaces');
}
