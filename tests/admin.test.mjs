import test from 'node:test';
import assert from 'node:assert/strict';
import {environment} from './support.mjs';
import app from '../dist/server/app.js';

const users = {admin: ['owner-test', 'dom.czr11@gmail.com'], a: ['member-a', 'a@example.com'], b: ['member-b', 'b@example.com']};
async function call(env, path, who, method = 'GET', body) {
  const h = {};
  if (who) { h['oai-authenticated-user-id'] = users[who][0]; h['oai-authenticated-user-email'] = users[who][1]; }
  if (body !== undefined) h['content-type'] = 'application/json';
  const response = await app.fetch(new Request('https://test.local' + path, {method, headers: h, body: body === undefined ? undefined : JSON.stringify(body)}), env);
  let data; try { data = await response.json(); } catch { data = null; }
  return {status: response.status, data};
}
const item = id => ({id, name: 'Item ' + id, brand: '', cost: 5, price: 15, status: 'In Stock', photos: [], purchasedAt: '2026-11-04'});
const ws = n => ({items: Array.from({length: n}, (_, i) => item('i' + i)), sales: [], expenses: [], research: [], sources: []});
const post = (env, path, body) => app.fetch(new Request('https://stockroom.bookednpaid.com' + path, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)}), env);

async function seeded() {
  const env = environment();
  await call(env, '/api/workspace', 'a', 'PUT', {data: ws(3), revision: null});
  await call(env, '/api/me', 'b');
  return env;
}

test('only the owner can use the admin console', async () => {
  const env = await seeded();
  for (const path of ['/api/admin/overview', '/api/admin/people', '/api/admin/activity', '/api/admin/settings'])
    assert.equal((await call(env, path, 'a')).status, 403, path);
});

test('overview and member list show plans, stock and activity', async () => {
  const env = await seeded();
  const o = (await call(env, '/api/admin/overview', 'admin')).data;
  assert.equal(o.members, 2); assert.equal(o.items, 3); assert.equal(o.signups.length, 30);
  const people = (await call(env, '/api/admin/people', 'admin')).data.members;
  const a = people.find(m => m.email === 'a@example.com');
  assert.deepEqual([a.items, a.plan, a.addedThisMonth], [3, 'free', 3]);
  const detail = (await call(env, '/api/admin/people/member-a', 'admin')).data;
  assert.equal(detail.member.email, 'a@example.com');
  assert.equal((await call(env, '/api/admin/people/member-a/export', 'admin')).data.data.items.length, 3);
});

test('grant and remove comped Pro, reset allowance, notes and rename', async () => {
  const env = await seeded();
  const act = (body) => call(env, '/api/admin/people/member-a/action', 'admin', 'POST', body);
  assert.equal((await act({action: 'grant_pro', months: 3})).data.member.plan, 'pro');
  assert.equal((await call(env, '/api/billing', 'a')).data.plan, 'pro');
  assert.equal((await act({action: 'remove_pro'})).data.member.plan, 'free');
  assert.equal((await act({action: 'grant_pro', months: null})).data.member.comped, true);
  await act({action: 'remove_pro'});
  assert.equal((await act({action: 'reset_allowance'})).data.member.addedThisMonth, 0);
  await act({action: 'note', note: 'Met at car boot'});
  assert.equal((await call(env, '/api/admin/people/member-a', 'admin')).data.note, 'Met at car boot');
  assert.equal((await act({action: 'rename', name: 'Alex'})).data.member.name, 'Alex');
  assert.equal((await act({action: 'grant_pro', months: 500})).status, 400);
});

test('suspending blocks access; delete needs the exact email', async () => {
  const env = await seeded();
  await call(env, '/api/admin/people/member-a/action', 'admin', 'POST', {action: 'suspend'});
  assert.equal((await call(env, '/api/me', 'a')).status, 403);
  await call(env, '/api/admin/people/member-a/action', 'admin', 'POST', {action: 'reactivate'});
  assert.equal((await call(env, '/api/me', 'a')).status, 200);
  assert.equal((await call(env, '/api/admin/people/member-a/action', 'admin', 'POST', {action: 'delete', confirm: 'wrong@example.com'})).status, 400);
  assert.equal((await call(env, '/api/admin/people/member-a/action', 'admin', 'POST', {action: 'delete', confirm: 'a@example.com'})).data.deleted, true);
  assert.equal(await env.DB.prepare("SELECT COUNT(*) AS n FROM workspaces WHERE owner_id = 'member-a'").first().then(r => r.n), 0);
  const events = (await call(env, '/api/admin/activity', 'admin')).data.events.map(e => e.action);
  assert.ok(events.includes('admin_deleted_member') && events.includes('member_suspended'));
});

test('invite emails go to the person and BCC the owner', async () => {
  const env = await seeded(); env.RESEND_API_KEY = 're_fixture';
  let sent; env.RESEND_FETCH = async (url, init) => { sent = JSON.parse(init.body); return new Response('{}', {status: 200}); };
  const r = await call(env, '/api/admin/invite', 'admin', 'POST', {emails: 'friend@example.com', send: true});
  assert.equal(r.data.results[0].sent, true);
  assert.deepEqual(sent.to, ['friend@example.com']);
  assert.deepEqual(sent.bcc, [users.admin[1]]);
});

test('invites, invite-only mode, free limit and announcements', async () => {
  const env = await seeded(); env.AUTH_DEV_CODES = 'show';
  const inv = await call(env, '/api/admin/invite', 'admin', 'POST', {emails: 'new@example.com, bad', send: false});
  assert.equal(inv.status, 400);
  assert.equal((await call(env, '/api/admin/invite', 'admin', 'POST', {emails: 'new@example.com', send: false})).data.results[0].existed, false);
  await call(env, '/api/admin/settings', 'admin', 'PUT', {signups_open: false, free_limit: 2, announcement: 'Hello all', announcement_on: true, announcement_tone: 'success'});
  assert.equal((await post(env, '/auth/code', {email: 'stranger@example.com'})).status, 403);
  assert.equal((await post(env, '/auth/code', {email: 'new@example.com'})).status, 200);
  assert.deepEqual((await call(env, '/api/me', 'b')).data.announcement, {text: 'Hello all', tone: 'success'});
  assert.equal((await call(env, '/api/workspace', 'b', 'PUT', {data: ws(3), revision: null})).status, 402);
  assert.equal((await call(env, '/api/billing', 'b')).data.limit, 2);
});

import {scheduledWeekly} from '../worker/weekly.js';
test('weekly report sends once per person on Monday morning and respects unsubscribe', async () => {
  const env = await seeded(); env.RESEND_API_KEY = 're_fixture';
  const sent = []; env.RESEND_FETCH = async (url, init) => { sent.push(JSON.parse(init.body)); return new Response('{}', {status: 200}); };
  const monday = new Date('2026-11-23T09:30:00Z'), sunday = new Date('2026-11-22T09:30:00Z');
  await scheduledWeekly(env, sunday); assert.equal(sent.length, 0);
  await scheduledWeekly(env, monday); await scheduledWeekly(env, monday);
  assert.equal(sent.length, 1); assert.deepEqual(sent[0].to, ['a@example.com']);
  const link = sent[0].text.match(/https?:\/\/\S+\/email\/unsubscribe\S+/)[0];
  const page = await app.fetch(new Request(link.replace(/^https?:\/\/[^/]+/, 'https://test.local')), env);
  assert.equal(page.status, 200);
  assert.equal((await call(env, '/api/pip/weekly', 'a')).data.weekly, false);
  assert.equal((await app.fetch(new Request('https://test.local/email/unsubscribe?u=member-a&t=forged'), env)).status, 400);
});

test('AI status explains why Claude is or is not in use', async () => {
  const env = await seeded();
  assert.match((await call(env, '/api/admin/ai-status', 'admin')).data.reason, /No ANTHROPIC_API_KEY/);
  env.ANTHROPIC_API_KEY = 'k'; env.ANTHROPIC_FETCH = async () => new Response(JSON.stringify({error: {message: 'Your credit balance is too low'}}), {status: 400});
  assert.match((await call(env, '/api/admin/ai-status', 'admin')).data.reason, /no credit/);
  env.ANTHROPIC_FETCH = async () => new Response('{}', {status: 200});
  assert.equal((await call(env, '/api/admin/ai-status', 'admin')).data.ok, true);
  assert.equal((await call(env, '/api/admin/ai-status', 'a')).status, 403);
});
