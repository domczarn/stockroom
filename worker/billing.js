// Plans and Stripe billing.
// Free: 20 new stock items a month. Pro (£7/month or £60/year): unlimited items, Gmail auto-updates and Pip AI.
// No webhook needed: the plan is confirmed when checkout returns, and re-checked with Stripe when the paid period ends.
import {HttpError, readBody} from './security.js';
import {freeLimit} from './admin.js';

export const FREE_ITEMS_PER_MONTH = 20;
const PRICES = {
  month: {lookup: 'stockroom_pro_month', amount: 700, label: '£7 a month'},
  year: {lookup: 'stockroom_pro_year', amount: 6000, label: '£60 a year'},
};
const GRACE_MS = 3 * 86400000; // card retries and clock drift
const LIVE = new Set(['active', 'trialing', 'past_due']);
const month = (now = Date.now()) => new Date(now).toISOString().slice(0, 7);

// Stripe's API takes form-encoded bodies with bracketed keys.
function form(data, prefix = '', out = new URLSearchParams()) {
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? prefix + '[' + key + ']' : key;
    if (typeof value === 'object') form(value, name, out);
    else out.append(name, String(value));
  }
  return out;
}
async function stripe(env, method, path, data) {
  if (!env.STRIPE_SECRET_KEY) throw new HttpError(503, 'Payments are not set up yet.');
  const body = data && method !== 'GET' ? form(data) : undefined;
  const query = data && method === 'GET' ? '?' + form(data) : '';
  const response = await (env.STRIPE_FETCH || fetch)('https://api.stripe.com/v1' + path + query, {
    method, body, signal: AbortSignal.timeout(15000),
    headers: {authorization: 'Bearer ' + env.STRIPE_SECRET_KEY, ...(body ? {'content-type': 'application/x-www-form-urlencoded'} : {})},
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error('Stripe error', path, response.status, String(result?.error?.message || '').slice(0, 160));
    const error = new HttpError(502, 'Stripe didn’t respond properly. Try again in a minute.');
    error.stripeStatus = response.status;
    throw error;
  }
  return result;
}

// Finds the Pro prices by lookup key, creating the product and both prices the first time.
let priceCache = null;
async function prices(env) {
  if (priceCache) return priceCache;
  const keys = Object.values(PRICES).map(p => p.lookup);
  const found = await stripe(env, 'GET', '/prices', {active: true, lookup_keys: keys, limit: 10});
  const byKey = Object.fromEntries((found.data || []).map(p => [p.lookup_key, p.id]));
  if (keys.some(k => !byKey[k])) {
    const product = await stripe(env, 'POST', '/products', {name: 'Booked & Paid Stockroom Pro', description: 'Unlimited stock, Gmail auto-updates and Pip AI.'});
    for (const [interval, p] of Object.entries(PRICES)) if (!byKey[p.lookup]) {
      const price = await stripe(env, 'POST', '/prices', {product: product.id, currency: 'gbp', unit_amount: p.amount, recurring: {interval}, lookup_key: p.lookup, transfer_lookup_key: true});
      byKey[p.lookup] = price.id;
    }
  }
  priceCache = {month: byKey[PRICES.month.lookup], year: byKey[PRICES.year.lookup]};
  return priceCache;
}

// Make sure someone signed in through Cloudflare Access also has an accounts row.
async function account(env, user) {
  await env.DB.prepare('INSERT OR IGNORE INTO accounts (id, email, created_at) VALUES (?, ?, ?)').bind(user.id, String(user.email).toLowerCase(), new Date().toISOString()).run().catch(() => {});
  return env.DB.prepare('SELECT * FROM accounts WHERE id = ?').bind(user.id).first();
}

const periodEnd = sub => (sub.items?.data?.[0]?.current_period_end || sub.current_period_end || 0) * 1000;
async function applySubscription(env, accountId, sub) {
  const live = sub && LIVE.has(sub.status);
  const until = live ? new Date(periodEnd(sub) + GRACE_MS).toISOString() : null;
  await env.DB.prepare('UPDATE accounts SET plan = ?, plan_until = ?, stripe_subscription = ?, stripe_customer = COALESCE(?, stripe_customer) WHERE id = ?')
    .bind(live ? 'pro' : 'free', until, sub?.id || null, typeof sub?.customer === 'string' ? sub.customer : sub?.customer?.id || null, accountId).run();
}

// The single source of truth for what someone can use.
export async function planFor(env, user) {
  if (!user) return {plan: 'free'};
  if (user.admin) return {plan: 'pro', owner: true};
  const row = await env.DB.prepare('SELECT * FROM accounts WHERE id = ?').bind(user.id).first().catch(() => null);
  if (!row || row.plan !== 'pro') return {plan: 'free', customer: Boolean(row?.stripe_customer)};
  if (row.plan_until && Date.parse(row.plan_until) > Date.now()) return {plan: 'pro', until: row.plan_until, customer: Boolean(row.stripe_customer)};
  // Paid period ran out: ask Stripe whether it renewed.
  if (row.stripe_subscription && env.STRIPE_SECRET_KEY) {
    try {
      const sub = await stripe(env, 'GET', '/subscriptions/' + encodeURIComponent(row.stripe_subscription));
      await applySubscription(env, row.id, sub);
      if (LIVE.has(sub.status)) return {plan: 'pro', until: new Date(periodEnd(sub) + GRACE_MS).toISOString(), customer: true};
    } catch (error) {
      // Stripe unreachable or erroring: don't lock a paying customer out. But "no such subscription" means it's gone.
      if (error?.stripeStatus !== 404) return {plan: 'pro', until: row.plan_until, customer: true};
      await env.DB.prepare('UPDATE accounts SET stripe_subscription = NULL WHERE id = ?').bind(row.id).run();
    }
  } else if (!row.plan_until) return {plan: 'pro', customer: Boolean(row.stripe_customer)}; // granted by hand
  await env.DB.prepare("UPDATE accounts SET plan = 'free' WHERE id = ?").bind(row.id).run();
  return {plan: 'free', customer: Boolean(row.stripe_customer)};
}
export const isPro = async (env, user) => (await planFor(env, user)).plan === 'pro';
export async function requirePro(env, user, feature) {
  if (!(await isPro(env, user))) throw new HttpError(402, feature + ' is part of Stockroom Pro.');
}

const itemsThisMonth = async (env, ownerId) =>
  (await env.DB.prepare('SELECT COUNT(*) AS n FROM item_adds WHERE owner_id = ? AND month = ?').bind(ownerId, month()).first())?.n || 0;

// Called before a workspace save: refuses new items over the free allowance.
export async function checkNewItems(env, user, previousItems, nextItems) {
  const before = new Set((previousItems || []).map(item => item.id));
  const added = (nextItems || []).map(item => item.id).filter(id => !before.has(id));
  if (!added.length || await isPro(env, user)) return added;
  const used = await itemsThisMonth(env, user.id), cap = await freeLimit(env);
  if (used + added.length > cap)
    throw new HttpError(402, 'You’ve added ' + used + ' of ' + cap + ' free items this month. Go Pro for unlimited stock.');
  return added;
}
export async function recordNewItems(env, ownerId, added) {
  for (const id of added) await env.DB.prepare('INSERT OR IGNORE INTO item_adds (owner_id, item_id, month) VALUES (?, ?, ?)').bind(ownerId, id, month()).run();
}

export async function billingRoute(request, url, env, user) {
  if (!user) throw new HttpError(401, 'Sign in first.');
  const origin = url.origin;
  if (url.pathname === '/api/billing' && request.method === 'GET') {
    const plan = await planFor(env, user);
    return {...plan, used: await itemsThisMonth(env, user.id), limit: await freeLimit(env), prices: {month: PRICES.month.label, year: PRICES.year.label}, ready: Boolean(env.STRIPE_SECRET_KEY)};
  }
  if (request.method !== 'POST') throw new HttpError(405, 'Method not allowed.');
  const body = await readBody(request, 4000) || {};
  if (url.pathname === '/api/billing/checkout') {
    if (user.admin) throw new HttpError(400, 'The owner account already has everything.');
    const interval = body.interval === 'year' ? 'year' : 'month';
    if (await isPro(env, user)) throw new HttpError(409, 'You’re already on Pro. Use Manage billing to switch.');
    const row = await account(env, user);
    const session = await stripe(env, 'POST', '/checkout/sessions', {
      mode: 'subscription', client_reference_id: user.id, allow_promotion_codes: true,
      line_items: [{price: (await prices(env))[interval], quantity: 1}],
      ...(row.stripe_customer ? {customer: row.stripe_customer} : {customer_email: row.email}),
      subscription_data: {metadata: {account_id: user.id}},
      success_url: origin + '/?billing=done&session_id={CHECKOUT_SESSION_ID}',
      cancel_url: origin + '/?billing=cancelled',
    });
    return {url: session.url};
  }
  if (url.pathname === '/api/billing/confirm') {
    const id = String(body.sessionId || '');
    if (!/^cs_[A-Za-z0-9_]{10,200}$/.test(id)) throw new HttpError(400, 'Invalid checkout.');
    const session = await stripe(env, 'GET', '/checkout/sessions/' + id, {expand: ['subscription']});
    if (session.client_reference_id !== user.id) throw new HttpError(403, 'That checkout belongs to another account.');
    if (session.status !== 'complete' || !session.subscription) return {...await planFor(env, user), pending: true};
    await account(env, user);
    await env.DB.prepare('UPDATE accounts SET stripe_customer = ? WHERE id = ?').bind(String(session.customer), user.id).run();
    await applySubscription(env, user.id, session.subscription);
    return planFor(env, user);
  }
  if (url.pathname === '/api/billing/portal') {
    const row = await account(env, user);
    if (!row?.stripe_customer) throw new HttpError(400, 'No billing account yet.');
    const portal = await stripe(env, 'POST', '/billing_portal/sessions', {customer: row.stripe_customer, return_url: origin + '/?billing=refresh'});
    return {url: portal.url};
  }
  if (url.pathname === '/api/billing/refresh') {
    const row = await account(env, user);
    if (row?.stripe_subscription) await applySubscription(env, user.id, await stripe(env, 'GET', '/subscriptions/' + encodeURIComponent(row.stripe_subscription)));
    else if (row?.stripe_customer) {
      const list = await stripe(env, 'GET', '/subscriptions', {customer: row.stripe_customer, status: 'all', limit: 1});
      await applySubscription(env, user.id, list.data?.[0] || null);
    }
    return planFor(env, user);
  }
  throw new HttpError(404, 'Not found');
}

// Self-serve account deletion: cancels any subscription, then removes every trace of the account.
export async function deleteOwnAccount(request, env, user) {
  if (request.method !== 'POST') throw new HttpError(405, 'Method not allowed.');
  if (user.admin) throw new HttpError(400, 'The owner account can’t be deleted from here.');
  const {confirm} = await readBody(request, 1000) || {};
  if (confirm !== 'DELETE') throw new HttpError(400, 'Type DELETE to confirm.');
  const row = await env.DB.prepare('SELECT stripe_subscription FROM accounts WHERE id = ?').bind(user.id).first().catch(() => null);
  if (row?.stripe_subscription && env.STRIPE_SECRET_KEY) {
    try { await stripe(env, 'DELETE', '/subscriptions/' + encodeURIComponent(row.stripe_subscription)); }
    catch (error) { if (error?.stripeStatus !== 404) throw new HttpError(502, 'Couldn’t cancel your subscription. Try again, or cancel it in Manage billing first.'); }
  }
  const {deleteMember} = await import('./admin.js');
  await deleteMember(env, user.id, String(user.email).toLowerCase());
  await env.DB.prepare('INSERT INTO audit_events (id,actor_id,owner_id,action,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(), user.id, user.email, 'member_deleted_self', new Date().toISOString()).run();
  return {deleted: true};
}
