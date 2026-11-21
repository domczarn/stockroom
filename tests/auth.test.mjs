import test from 'node:test';
import assert from 'node:assert/strict';
import app from '../dist/server/app.js';
import {environment} from './support.mjs';
import {withIdentity} from '../worker/access.js';

const origin = 'https://stockroom.bookednpaid.com';
const post = (env, path, body, headers = {}) => app.fetch(new Request(origin + path, {method: 'POST', headers: {'content-type': 'application/json', ...headers}, body: JSON.stringify(body)}), env);

test('email code sign-in keeps an existing member on their original account id', async () => {
  const env = environment(); env.AUTH_DEV_CODES = 'show';
  await env.DB.prepare("INSERT INTO members (email,user_id,name,status,created_at) VALUES ('dom@example.test','legacy-access-id','dom','active','2026-01-01')").run();
  const sent = await (await post(env, '/auth/code', {email: ' Dom@Example.test '})).json();
  assert.match(sent.devCode, /^\d{6}$/);
  const wrong = await post(env, '/auth/verify', {email: 'dom@example.test', code: sent.devCode === '000000' ? '111111' : '000000'});
  assert.equal(wrong.status, 400);
  const ok = await post(env, '/auth/verify', {email: 'dom@example.test', code: sent.devCode});
  assert.equal(ok.status, 200);
  const cookie = ok.headers.get('set-cookie');
  assert.match(cookie, /^sr_session=[\w-]{40,}; Path=\/; HttpOnly; Secure; SameSite=Lax/);
  const signed = await withIdentity(new Request(origin + '/api/me', {headers: {cookie: cookie.split(';')[0], 'oai-authenticated-user-id': 'forged'}}), env);
  assert.equal(signed.headers.get('oai-authenticated-user-id'), 'legacy-access-id');
  assert.equal(signed.headers.get('oai-authenticated-user-email'), 'dom@example.test');
  // A code only works once.
  assert.equal((await post(env, '/auth/verify', {email: 'dom@example.test', code: sent.devCode})).status, 400);
  // Sign out kills the session.
  await post(env, '/auth/logout', {}, {cookie: cookie.split(';')[0]});
  const after = await withIdentity(new Request(origin + '/', {headers: {cookie: cookie.split(';')[0]}}), env);
  assert.equal(after.headers.get('oai-authenticated-user-id'), null);
});

test('new emails get a fresh account; bad input and brute force are refused', async () => {
  const env = environment(); env.AUTH_DEV_CODES = 'show';
  assert.equal((await post(env, '/auth/code', {email: 'not-an-email'})).status, 400);
  const sent = await (await post(env, '/auth/code', {email: 'new@example.test'})).json();
  for (let i = 0; i < 5; i++) await post(env, '/auth/verify', {email: 'new@example.test', code: 'abcdef'});
  assert.equal((await post(env, '/auth/verify', {email: 'new@example.test', code: sent.devCode})).status, 400, 'locked after 5 wrong tries');
  const again = await (await post(env, '/auth/code', {email: 'new@example.test'})).json();
  const ok = await post(env, '/auth/verify', {email: 'new@example.test', code: again.devCode});
  assert.equal(ok.status, 200);
  const row = await env.DB.prepare("SELECT id FROM accounts WHERE email = 'new@example.test'").first();
  assert.match(row.id, /^[0-9a-f-]{36}$/);
});

test('signed-out visitors get the login page; passkey routes need a session', async () => {
  const env = environment();
  const page = await app.fetch(new Request(origin + '/'), env);
  assert.match(await page.text(), /Sign in to Stockroom/);
  assert.equal((await post(env, '/auth/passkey/register/options', {})).status, 401);
  const opts = await (await post(env, '/auth/passkey/login/options', {})).json();
  assert.equal(opts.options.rpId, 'stockroom.bookednpaid.com');
});
