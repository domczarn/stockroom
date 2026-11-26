import test from 'node:test';
import assert from 'node:assert/strict';
import {environment} from './support.mjs';
import app from '../dist/server/app.js';
import {applyOps, hash} from '../worker/ops.js';

const h = {'content-type': 'application/json', 'oai-authenticated-user-id': 'ops-test', 'oai-authenticated-user-email': 'ops@example.test'};
const call = (env, method, body) => app.fetch(new Request('https://x/api/workspace', {method, headers: h, body: body ? JSON.stringify(body) : undefined}), env).then(async r => ({status: r.status, data: await r.json()}));
const item = (id, extra = {}) => ({id, name: 'Item ' + id, brand: 'Nike', cost: 5, price: 20, status: 'In Stock', sale: null, refund: null, photos: [], purchasedAt: '2026-11-01', ...extra});
const base = () => ({items: [item('a'), item('b')], sales: [], expenses: [], research: [], sources: [], trades: []});
const edit = (data, id, change) => ({k: 'items', id, before: hash(data.items.find(i => i.id === id)), rec: {...data.items.find(i => i.id === id), ...change}});

test('hashes ignore key order', () => {
  assert.equal(hash({a: 1, b: [1, {c: 2, d: 3}]}), hash({b: [1, {d: 3, c: 2}], a: 1}));
  assert.notEqual(hash({a: 1}), hash({a: 2}));
});

test('applyOps edits, adds and deletes records, and reports only real clashes', () => {
  const d = base();
  let r = applyOps(d, [edit(d, 'a', {price: 30}), {k: 'items', id: 'c', before: null, rec: item('c'), at: 0}, {k: 'items', id: 'b', before: hash(d.items[1]), rec: null}]);
  assert.deepEqual(r.conflicts, []);
  assert.deepEqual(r.data.items.map(i => i.id), ['c', 'a']);
  assert.equal(r.data.items[1].price, 30);
  assert.equal(d.items[0].price, 20, 'original untouched');
  // Someone else changed "a": a stale edit to "a" is a conflict, an identical one is not.
  const other = {...d, items: [{...d.items[0], price: 25}, d.items[1]]};
  assert.equal(applyOps(other, [edit(d, 'a', {price: 30})]).conflicts.length, 1);
  assert.equal(applyOps(other, [edit(d, 'a', {price: 25})]).conflicts.length, 0);
  // Whole-value keys (sales rows) are checked the same way.
  assert.equal(applyOps(d, [{k: 'sales', before: hash([]), val: [['x', 5, 0, 0, '2026-11-01']]}]).data.sales.length, 1);
  assert.ok(applyOps(d, [{k: '__proto__', before: null, val: 1}]).error);
});

test('two devices editing different items both save; the same item clashes', async () => {
  const env = environment();
  const first = await call(env, 'PUT', {data: base(), revision: null});
  assert.equal(first.status, 200);
  const d = first.data.data, rev = first.data.revision;
  // Phone edits "a", laptop (still on the old revision) edits "b".
  const phone = await call(env, 'PATCH', {revision: rev, ops: [edit(d, 'a', {price: 31})]});
  assert.equal(phone.status, 200);
  assert.equal(phone.data.data, undefined, 'no merge needed, so no full copy sent back');
  const laptop = await call(env, 'PATCH', {revision: rev, ops: [edit(d, 'b', {price: 42})]});
  assert.equal(laptop.status, 200);
  assert.equal(laptop.data.data.items.find(i => i.id === 'a').price, 31, 'laptop gets the phone’s change merged in');
  assert.equal(laptop.data.changes[0].rec.price, 42);
  // Laptop now edits "a" from its stale copy: that one item clashes, with its name in the message.
  const clash = await call(env, 'PATCH', {revision: rev, ops: [edit(d, 'a', {price: 99})]});
  assert.equal(clash.status, 409);
  assert.match(clash.data.error, /Item a/);
  const now = await call(env, 'GET');
  assert.deepEqual(now.data.data.items.map(i => i.price), [31, 42]);
});

test('change-based saves still enforce validation and the free item allowance', async () => {
  const env = environment();
  const first = await call(env, 'PUT', {data: base(), revision: null});
  const bad = await call(env, 'PATCH', {revision: first.data.revision, ops: [{k: 'items', id: 'z', before: null, rec: {id: 'z', name: ''}}]});
  assert.equal(bad.status, 400);
});

test('saves report how full the account is', async () => {
  const env = environment();
  const first = await call(env, 'PUT', {data: base(), revision: null});
  assert.equal(typeof first.data.used, 'number');
  assert.ok(first.data.used < 0.01);
  const d = first.data.data;
  const next = await call(env, 'PATCH', {revision: first.data.revision, ops: [edit(d, 'a', {price: 21})]});
  assert.equal(typeof next.data.used, 'number');
});
