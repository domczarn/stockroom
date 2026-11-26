import test from 'node:test';
import assert from 'node:assert/strict';
import {environment} from './support.mjs';
import app from '../dist/server/app.js';
import {entitlementUntil} from '../worker/iap.js';

const keys = {REVENUECAT_SECRET: 'sk_test', REVENUECAT_IOS_KEY: 'appl_test', REVENUECAT_WEBHOOK_AUTH: 'Bearer hook-secret-123'};
const call = (env, path, method = 'GET', body, headers = {}) => app.fetch(new Request('https://stockroom.bookednpaid.com' + path, {method, headers: {'content-type': 'application/json', 'oai-authenticated-user-id': 'iap-user-1', 'oai-authenticated-user-email': 'iap@example.test', origin: 'https://stockroom.bookednpaid.com', ...headers}, body: body ? JSON.stringify(body) : undefined}), env);
function fakeRevenueCat(expires) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (String(url).startsWith('https://api.revenuecat.com/')) {
      assert.equal(opts.headers.Authorization, 'Bearer sk_test');
      return new Response(JSON.stringify({subscriber: {entitlements: expires === undefined ? {} : {pro: {expires_date: expires}}}}), {status: 200});
    }
    return real(url, opts);
  };
  return () => { globalThis.fetch = real; };
}

test('entitlement dates', () => {
  assert.equal(entitlementUntil({entitlements: {}}, 'pro'), null);
  assert.equal(entitlementUntil({entitlements: {pro: {expires_date: null}}}, 'pro'), Infinity);
  assert.equal(entitlementUntil({entitlements: {pro: {expires_date: '2030-01-01T00:00:00Z'}}}, 'pro'), Date.parse('2030-01-01T00:00:00Z'));
});

test('in-app purchase: off until configured, then a store purchase makes the account Pro and expiry takes it away', async () => {
  const off = environment();
  assert.equal((await call(off, '/api/billing/iap/sync', 'POST', {})).status, 404);
  const env = {...environment(), ...keys};
  const billing = await (await call(env, '/api/billing')).json();
  assert.equal(billing.plan, 'free');
  assert.equal(billing.iap.ios, 'appl_test');
  let restore = fakeRevenueCat(new Date(Date.now() + 30 * 86400000).toISOString());
  try {
    const synced = await call(env, '/api/billing/iap/sync', 'POST', {});
    assert.equal(synced.status, 200);
    assert.equal((await synced.json()).plan, 'pro');
  } finally { restore(); }
  // A webhook with the wrong secret is refused; the right one triggers a fresh lookup (now expired).
  const hook = (auth) => app.fetch(new Request('https://stockroom.bookednpaid.com/hooks/revenuecat', {method: 'POST', headers: {'content-type': 'application/json', authorization: auth}, body: JSON.stringify({event: {type: 'EXPIRATION', app_user_id: 'iap-user-1'}})}), env);
  assert.equal((await hook('Bearer wrong')).status, 401);
  restore = fakeRevenueCat(new Date(Date.now() - 86400000).toISOString());
  try { assert.equal((await hook(keys.REVENUECAT_WEBHOOK_AUTH)).status, 204); } finally { restore(); }
  assert.equal((await (await call(env, '/api/billing')).json()).plan, 'free');
});
