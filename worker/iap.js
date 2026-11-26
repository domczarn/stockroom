// In-app purchases for the App Store / Google Play apps, through RevenueCat.
// The app buys with Apple or Google; RevenueCat tells us what the person is entitled to. We never trust the app or
// a webhook's own claims: both only trigger a fresh lookup of that person on RevenueCat's API with our secret key.
// Off until REVENUECAT_SECRET (and the public app keys) are set.
import {HttpError, readBody} from './security.js';
import {planFor} from './billing.js';

const GRACE_MS = 3 * 86400000;
const entitlement = env => env.REVENUECAT_ENTITLEMENT || 'pro';

export function iapConfig(env) {
  if (!env.REVENUECAT_SECRET || !(env.REVENUECAT_IOS_KEY || env.REVENUECAT_ANDROID_KEY)) return null;
  return {ios: env.REVENUECAT_IOS_KEY || '', android: env.REVENUECAT_ANDROID_KEY || '', entitlement: entitlement(env)};
}

// When the store subscription runs until; null if never bought.
export function entitlementUntil(subscriber, name, now = Date.now()) {
  const e = subscriber?.entitlements?.[name];
  if (!e) return null;
  if (e.expires_date === null) return Infinity;            // lifetime
  const t = Date.parse(e.expires_date || '');
  return Number.isFinite(t) ? t : null;
}

async function lookup(env, appUserId) {
  let res;
  try { res = await fetch('https://api.revenuecat.com/v1/subscribers/' + encodeURIComponent(appUserId), {headers: {Authorization: 'Bearer ' + env.REVENUECAT_SECRET, Accept: 'application/json'}, signal: AbortSignal.timeout(9000)}); }
  catch { throw new HttpError(502, 'The App Store purchase couldn’t be checked. Try again in a minute.'); }
  if (!res.ok) throw new HttpError(502, 'The App Store purchase couldn’t be checked. Try again in a minute.');
  return (await res.json()).subscriber;
}

// Apply what RevenueCat says. A Stripe (website) subscription is left alone: it manages itself.
export async function applyStore(env, accountId, until, now = Date.now()) {
  if (until === null) return;
  const live = until > now;
  const planUntil = until === Infinity ? null : new Date(until + (live ? GRACE_MS : 0)).toISOString();
  await env.DB.prepare("UPDATE accounts SET plan = ?, plan_until = ? WHERE id = ? AND (stripe_subscription IS NULL OR stripe_subscription = '')")
    .bind(live ? 'pro' : 'free', planUntil, accountId).run();
}

const sameSecret = (a, b) => { a = String(a || ''); b = String(b || ''); if (!a || a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

// POST /api/billing/iap/sync: the app just bought or restored; check and apply.
export async function iapSyncRoute(request, env, user) {
  if (!iapConfig(env)) throw new HttpError(404, 'In-app purchases aren’t switched on.');
  await readBody(request, 1000).catch(() => ({}));
  await env.DB.prepare('INSERT OR IGNORE INTO accounts (id, email, created_at) VALUES (?, ?, ?)').bind(user.id, String(user.email || '').toLowerCase(), new Date().toISOString()).run().catch(() => {});
  await applyStore(env, user.id, entitlementUntil(await lookup(env, user.id), entitlement(env)));
  return planFor(env, user);
}

// POST /hooks/revenuecat: renewals, cancellations, refunds. Authorization header must match our shared secret.
export async function iapWebhookRoute(request, env) {
  if (!iapConfig(env) || !env.REVENUECAT_WEBHOOK_AUTH) return new Response('Not found', {status: 404});
  if (!sameSecret(request.headers.get('authorization'), env.REVENUECAT_WEBHOOK_AUTH)) return new Response('Unauthorized', {status: 401});
  let id = '';
  try { id = String((await request.json())?.event?.app_user_id || ''); } catch {}
  if (!/^[A-Za-z0-9_-]{6,80}$/.test(id) || id.startsWith('$RCAnonymousID')) return new Response(null, {status: 204});
  const exists = await env.DB.prepare('SELECT 1 FROM accounts WHERE id = ?').bind(id).first();
  if (exists) await applyStore(env, id, entitlementUntil(await lookup(env, id), entitlement(env)));
  return new Response(null, {status: 204});
}
