import test from 'node:test';
import assert from 'node:assert/strict';
import {environment} from './support.mjs';
import app from '../dist/server/app.js';

const users = {admin: ['owner-test', 'dom.czr11@gmail.com'], a: ['member-a', 'a@example.com']};
async function call(env, path, who, method = 'GET', body) {
  const h = {};
  if (who) { h['oai-authenticated-user-id'] = users[who][0]; h['oai-authenticated-user-email'] = users[who][1]; }
  if (body !== undefined) h['content-type'] = 'application/json';
  const response = await app.fetch(new Request('https://test.local' + path, {method, headers: h, body: body === undefined ? undefined : JSON.stringify(body)}), env);
  let data; try { data = await response.json(); } catch { data = null; }
  return {status: response.status, data};
}
const item = id => ({id, name: 'Item ' + id, brand: '', cost: 5, price: 15, status: 'In Stock', photos: [], purchasedAt: '2026-11-04'});
const workspace = n => ({items: Array.from({length: n}, (_, i) => item('i' + i)), sales: [], expenses: [], research: [], sources: []});

// A tiny fake Stripe that records calls.
function fakeStripe(env) {
  const calls = [];
  const subscription = {id: 'sub_123', status: 'active', customer: 'cus_123', items: {data: [{current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400}]}};
  env.STRIPE_SECRET_KEY = 'sk_test_fixture';
  env.STRIPE_FETCH = async (url, init) => {
    const u = new URL(url); calls.push({method: init.method, path: u.pathname, body: init.body ? String(init.body) : u.search});
    const ok = data => new Response(JSON.stringify(data), {status: 200});
    if (u.pathname === '/v1/prices' && init.method === 'GET') return ok({data: [{id: 'price_m', lookup_key: 'stockroom_pro_month'}, {id: 'price_y', lookup_key: 'stockroom_pro_year'}]});
    if (u.pathname === '/v1/checkout/sessions' && init.method === 'POST') return ok({url: 'https://checkout.stripe.com/c/pay/cs_test_abcdefghijk'});
    if (u.pathname.startsWith('/v1/checkout/sessions/')) return ok({client_reference_id: 'member-a', status: 'complete', customer: 'cus_123', subscription});
    if (u.pathname === '/v1/billing_portal/sessions') return ok({url: 'https://billing.stripe.com/p/session/x'});
    if (u.pathname.startsWith('/v1/subscriptions/')) return ok(subscription);
    return new Response('{}', {status: 404});
  };
  return calls;
}

test('free plan allows 20 new items a month, then asks for Pro', async () => {
  const env = environment();
  let saved = await call(env, '/api/workspace', 'a', 'PUT', {data: workspace(20), revision: null});
  assert.equal(saved.status, 200);
  // Editing existing items is always fine.
  const edited = workspace(20); edited.items[0].name = 'Renamed';
  saved = await call(env, '/api/workspace', 'a', 'PUT', {data: edited, revision: saved.data.revision});
  assert.equal(saved.status, 200);
  const blocked = await call(env, '/api/workspace', 'a', 'PUT', {data: workspace(21), revision: saved.data.revision});
  assert.equal(blocked.status, 402);
  assert.match(blocked.data.error, /20 of 20/);
  const billing = await call(env, '/api/billing', 'a');
  assert.deepEqual([billing.data.plan, billing.data.used, billing.data.limit], ['free', 20, 20]);
  // Pro features are refused on free.
  assert.equal((await call(env, '/api/vision/write-listing', 'a', 'POST', {})).status, 402);
  // Gmail is open to free accounts (capped by capFreeSales), so it is no longer refused with 402.
  assert.notEqual((await call(env, '/api/gmail/connect', 'a', 'POST', {})).status, 402);
});

test('the owner is always Pro and has no limit', async () => {
  const env = environment();
  assert.equal((await call(env, '/api/workspace', 'admin', 'PUT', {data: workspace(30), revision: null})).status, 200);
  assert.equal((await call(env, '/api/billing', 'admin')).data.owner, true);
});

test('checkout, confirm and portal unlock Pro', async () => {
  const env = environment();
  const calls = fakeStripe(env);
  const checkout = await call(env, '/api/billing/checkout', 'a', 'POST', {interval: 'year'});
  assert.equal(checkout.status, 200);
  assert.match(checkout.data.url, /^https:\/\/checkout\.stripe\.com\//);
  const sent = decodeURIComponent(calls.find(c => c.path === '/v1/checkout/sessions').body);
  assert.match(sent, /line_items\[0\]\[price\]=price_y/);
  assert.match(sent, /client_reference_id=member-a/);
  assert.match(sent, /customer_email=a@example.com/);
  assert.equal((await call(env, '/api/billing/confirm', 'a', 'POST', {sessionId: 'not-a-session'})).status, 400);
  const confirmed = await call(env, '/api/billing/confirm', 'a', 'POST', {sessionId: 'cs_test_abcdefghijk'});
  assert.equal(confirmed.data.plan, 'pro');
  assert.equal((await call(env, '/api/me', 'a')).data.plan, 'pro');
  assert.equal((await call(env, '/api/workspace', 'a', 'PUT', {data: workspace(40), revision: null})).status, 200);
  assert.equal((await call(env, '/api/billing/portal', 'a', 'POST', {})).data.url, 'https://billing.stripe.com/p/session/x');
  // Already Pro: no second subscription.
  assert.equal((await call(env, '/api/billing/checkout', 'a', 'POST', {interval: 'month'})).status, 409);
});

test('an expired paid period is re-checked with Stripe', async () => {
  const env = environment();
  fakeStripe(env);
  await call(env, '/api/billing/confirm', 'a', 'POST', {sessionId: 'cs_test_abcdefghijk'});
  await env.DB.prepare("UPDATE accounts SET plan_until = '2020-01-01T00:00:00Z' WHERE id = 'member-a'").run();
  const billing = await call(env, '/api/billing', 'a');
  assert.equal(billing.data.plan, 'pro');
  assert.ok(Date.parse(billing.data.until) > Date.now());
  // Cancelled at Stripe → back to free.
  env.STRIPE_FETCH = async () => new Response(JSON.stringify({id: 'sub_123', status: 'canceled', customer: 'cus_123', items: {data: []}}), {status: 200});
  await env.DB.prepare("UPDATE accounts SET plan_until = '2020-01-01T00:00:00Z' WHERE id = 'member-a'").run();
  assert.equal((await call(env, '/api/billing', 'a')).data.plan, 'free');
});

test('members can delete their own account; the subscription is cancelled first', async () => {
  const env = environment();
  const calls = fakeStripe(env);
  await call(env, '/api/workspace', 'a', 'PUT', {data: workspace(2), revision: null});
  await call(env, '/api/billing/confirm', 'a', 'POST', {sessionId: 'cs_test_abcdefghijk'});
  assert.equal((await call(env, '/api/account/delete', 'a', 'POST', {confirm: 'nope'})).status, 400);
  const r = await call(env, '/api/account/delete', 'a', 'POST', {confirm: 'DELETE'});
  assert.equal(r.status, 200); assert.equal(r.data.deleted, true);
  assert.ok(calls.some(c => c.method === 'DELETE' && c.path === '/v1/subscriptions/sub_123'));
  assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM workspaces WHERE owner_id = 'member-a'").first()).n, 0);
  assert.equal((await env.DB.prepare("SELECT COUNT(*) AS n FROM accounts WHERE id = 'member-a'").first()).n, 0);
  assert.equal((await call(env, '/api/account/delete', 'admin', 'POST', {confirm: 'DELETE'})).status, 400);
});

test('a subscription Stripe no longer has stops Pro after the paid period', async () => {
  const env = environment(); fakeStripe(env);
  await call(env, '/api/billing/confirm', 'a', 'POST', {sessionId: 'cs_test_abcdefghijk'});
  await env.DB.prepare("UPDATE accounts SET plan_until = '2020-01-01T00:00:00Z' WHERE id = 'member-a'").run();
  env.STRIPE_FETCH = async () => new Response(JSON.stringify({error: {message: 'No such subscription'}}), {status: 404});
  assert.equal((await call(env, '/api/billing', 'a')).data.plan, 'free');
  // A temporary Stripe outage doesn't lock out a paying customer.
  await env.DB.prepare("UPDATE accounts SET plan = 'pro', stripe_subscription = 'sub_x', plan_until = '2020-01-01T00:00:00Z' WHERE id = 'member-a'").run();
  env.STRIPE_FETCH = async () => new Response('{}', {status: 500});
  assert.equal((await call(env, '/api/billing', 'a')).data.plan, 'pro');
});
