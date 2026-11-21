import test from 'node:test';
import assert from 'node:assert/strict';
import {environment} from './support.mjs';
import app from '../dist/server/app.js';
import {splitWorkspace, mergeWorkspace} from '../worker/workspace-store.js';

const h = {'content-type': 'application/json', 'oai-authenticated-user-id': 'owner-test', 'oai-authenticated-user-email': 'dom.czr11@gmail.com'};
const call = (env, method, body, path = '/api/workspace') => app.fetch(new Request('https://x' + path, {method, headers: h, body: body ? JSON.stringify(body) : undefined}), env).then(async r => ({status: r.status, data: await r.json()}));
const big = n => ({items: Array.from({length: n}, (_, i) => ({id: 'i' + i, name: 'Nike Tech Fleece ' + i, brand: 'Nike', cost: 8, price: 24, status: i % 3 ? 'In Stock' : 'Sold', sale: i % 3 ? null : 22, photos: [], purchasedAt: '2026-10-01',
  listingTitle: 'Nike Tech Fleece Hoodie Grey Size M', listingDescription: 'Lovely hoodie. '.repeat(40), notes: 'Rail A'})), sales: [], expenses: [], research: [], sources: []});

test('split and merge give back exactly the same workspace', () => {
  const data = big(3);
  const {core, texts} = splitWorkspace(data);
  assert.equal(core.items[0].listingDescription, undefined);
  assert.deepEqual(mergeWorkspace(core, texts), data);
});

test('large workspaces save well past the old 1.5 MB limit and load back whole', async () => {
  const env = environment();
  const data = big(4000); // about 3 MB of JSON
  assert.ok(JSON.stringify(data).length > 2_500_000);
  const saved = await call(env, 'PUT', {data, revision: null});
  assert.equal(saved.status, 200, JSON.stringify(saved.data).slice(0, 200));
  const loaded = await call(env, 'GET');
  assert.equal(loaded.data.data.items.length, 4000);
  assert.equal(loaded.data.data.items[3999].listingDescription, data.items[3999].listingDescription);
  // Second save replaces the text parts; old parts are tidied away.
  data.items[0].notes = 'Moved to rail B';
  assert.equal((await call(env, 'PUT', {data, revision: loaded.data.revision})).status, 200);
  assert.equal((await call(env, 'GET')).data.data.items[0].notes, 'Moved to rail B');
  const parts = await env.DB.prepare("SELECT COUNT(DISTINCT revision) AS n FROM workspace_parts WHERE owner_id = 'owner-test'").first();
  assert.equal(parts.n, 1);
  // Stats that read the core with SQL still work.
  const items = await env.DB.prepare("SELECT json_array_length(payload, '$.items') AS n FROM workspaces WHERE owner_id = 'owner-test'").first();
  assert.equal(items.n, 4000);
});

test('a stale save is refused and leaves no stray text parts', async () => {
  const env = environment();
  const first = await call(env, 'PUT', {data: big(5), revision: null});
  await call(env, 'PUT', {data: big(6), revision: first.data.revision});
  assert.equal((await call(env, 'PUT', {data: big(7), revision: first.data.revision})).status, 409);
  const revisions = await env.DB.prepare("SELECT COUNT(DISTINCT revision) AS n FROM workspace_parts WHERE owner_id = 'owner-test'").first();
  assert.equal(revisions.n, 1);
  assert.equal((await call(env, 'GET')).data.data.items.length, 6);
});

test('old single-record workspaces still load', async () => {
  const env = environment();
  const data = big(2);
  await env.DB.prepare('INSERT INTO workspaces (owner_id, payload, revision, updated_at) VALUES (?, ?, ?, ?)').bind('owner-test', JSON.stringify(data), 'r-old', '2026-11-01').run();
  const loaded = await call(env, 'GET');
  assert.deepEqual(loaded.data.data, data);
});
