import test from 'node:test';
import assert from 'node:assert/strict';
import {visionRoute} from '../worker/vision.js';

const req = body => new Request('https://x/api/vision/listing', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)});
const png = 'data:image/png;base64,' + Buffer.from('fake-image').toString('base64');

test('reads listing JSON from model output and normalises it', async () => {
  let calls = 0;
  const env = {AI: {run: async (model, input) => {
    calls++;
    if (calls === 1) throw new Error('5016: Prior to using this model, you must submit the prompt "agree" to accept the license');
    if (input.prompt === 'agree') return {response: 'ok'};
    assert.ok(Array.isArray(input.image) && input.image.length > 0);
    return {response: 'Here you go: {"title":"Nike Tech Fleece","brand":"Nike","size":"M","condition":"very good","colour":"Grey","category":"Hoodie","price":"£24.00","description":"Worn twice"}'};
  }}};
  const {listing} = await visionRoute(req({image: png}), env, {id: 'u1'});
  assert.equal(listing.title, 'Nike Tech Fleece');
  assert.equal(listing.condition, 'Very good');
  assert.equal(listing.price, 24);
  assert.equal(calls, 3);
});

test('rejects non-image payloads and anonymous callers', async () => {
  const env = {AI: {run: async () => ({response: '{}'})}};
  await assert.rejects(visionRoute(req({image: 'hello'}), env, {id: 'u1'}), /screenshot/);
  await assert.rejects(visionRoute(req({image: png}), env, null), /Sign in/);
});

import {writeListingRoute} from '../worker/vision.js';
test('writes a listing and cleans the hashtags', async () => {
  let prompt = '';
  const env = {AI: {run: async (model, input) => { prompt = input.messages[0].content;
    return {response: '{"title":"Nike Windbreaker Jacket Black Size M","description":"Lightweight Nike windbreaker.\\n• Size M\\n\\n\\n\\nPosted within 1–2 working days.","hashtags":["#Nike","windbreaker","#mens jacket"]}'}; }}};
  const {listing} = await visionRoute.length >= 0 && await writeListingRoute(req({item: {name: 'Nike Windbreaker', brand: 'Nike', size: 'M', flaws: 'Small mark on cuff'}}), env, {id: 'u1'});
  assert.equal(listing.title, 'Nike Windbreaker Jacket Black Size M');
  assert.deepEqual(listing.hashtags, ['#nike', '#windbreaker', '#mensjacket']);
  assert.ok(!listing.description.includes('\n\n\n'));
  assert.match(prompt, /Flaws: Small mark on cuff/);
});

import app from '../dist/server/app.js';
import {environment} from './support.mjs';
test('email updates memory is shared across devices', async () => {
  const env = environment();
  const call = (method, body) => app.fetch(new Request('https://stockroom.bookednpaid.com/api/gmail/done', {method, headers: {'content-type': 'application/json', 'oai-authenticated-user-id': 'alice', 'oai-authenticated-user-email': 'alice@example.test'}, ...(body ? {body: JSON.stringify(body)} : {})}), env);
  const res = await call('POST', {ids: ['1a1f3f2b43d8b59e', 'not valid!', '1a1f3f2b43d8b59e']});
  const saved = await res.json();
  assert.equal(res.status, 200, JSON.stringify(saved));
  assert.equal(saved.saved, 1);
  const {ids} = await (await call('GET')).json();
  assert.deepEqual(ids, ['1a1f3f2b43d8b59e']);
});

test('uses Claude when an Anthropic key is set', async () => {
  let sent;
  const env = {ANTHROPIC_API_KEY: 'sk-ant-fixture', ANTHROPIC_FETCH: async (url, init) => {
    sent = {url, headers: init.headers, body: JSON.parse(init.body)};
    return new Response(JSON.stringify({content: [{type: 'text', text: '{"title":"Nike Tech Fleece","brand":"Nike","price":20}'}]}), {status: 200});
  }};
  const {listing} = await visionRoute(req({image: png}), env, {id: 'u1'});
  assert.equal(listing.title, 'Nike Tech Fleece');
  assert.equal(sent.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(sent.headers['x-api-key'], 'sk-ant-fixture');
  assert.equal(sent.body.messages[0].content[0].type, 'image');
  assert.match(sent.body.model, /^claude-/);
});

import {studioRoute} from '../worker/studio.js';
test('photo studio asks Cloudflare Images for a foreground cutout', async () => {
  const calls = [];
  const IMAGES = {input: () => ({transform(t) { calls.push(t); return this; }, async output(o) { calls.push(o); return {response: () => new Response(new Uint8Array([137, 80, 78, 71]))}; }})};
  const {cutout} = await studioRoute(req({image: png}), {IMAGES}, {id: 'u1'});
  assert.match(cutout, /^data:image\/png;base64,/);
  assert.deepEqual(calls, [{segment: 'foreground'}, {format: 'image/png'}]);
  await assert.rejects(studioRoute(req({image: png}), {}, {id: 'u1'}), /isn’t switched on/);
});

import {offerRoute} from '../worker/pipai.js';
const jreq = body => new Request('https://x/api/pip/offer', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)});
test('offer helper never counters below cost and accepts full-price offers', async () => {
  const claude = reply => ({ANTHROPIC_API_KEY: 'k', ANTHROPIC_FETCH: async () => new Response(JSON.stringify({content: [{type: 'text', text: JSON.stringify(reply)}]}), {status: 200})});
  let r = await offerRoute(jreq({offer: 8, cost: 6, asking: 15, goal: 5}), claude({verdict: 'counter', counter: 5, reason: 'x', reply: 'Could do £12?'}), {id: 'u'});
  assert.equal(r.verdict, 'counter'); assert.ok(r.counter >= 8.5 && r.counter <= 15, String(r.counter));
  r = await offerRoute(jreq({offer: 15, cost: 6, asking: 15}), claude({verdict: 'decline', reason: 'x', reply: 'Deal!'}), {id: 'u'});
  assert.equal(r.verdict, 'accept');
  r = await offerRoute(jreq({offer: 4, cost: 6, asking: 15}), claude({verdict: 'accept', reason: 'x', reply: 'No thanks'}), {id: 'u'});
  assert.equal(r.verdict, 'decline');
});

import {weeklyNumbers, scheduledWeekly} from '../worker/weekly.js';
test('weekly report numbers cover the last 7 days', () => {
  const now = Date.parse('2026-11-23T09:00:00Z');
  const n = weeklyNumbers({items: [
    {id: 'a', name: 'Nike', status: 'Sold', sale: 20, cost: 5, soldAt: '2026-11-20', purchasedAt: '2026-11-01'},
    {id: 'b', name: 'Adidas', status: 'Sold', sale: 10, cost: 4, soldAt: '2026-11-10', purchasedAt: '2026-11-01'},
    {id: 'c', name: 'Old', status: 'In Stock', cost: 3, listedAt: '2026-09-01', purchasedAt: '2026-11-18'}]}, now);
  assert.deepEqual([n.sold, n.revenue, n.profit, n.prevRevenue, n.added, n.inStock, n.stale], [1, 20, 15, 10, 1, 1, 1]);
  assert.equal(n.best.item.name, 'Nike');
});

import {workspaceDigest} from '../worker/pipai.js';
test('Ask Pip digest groups sales by brand and month without inventing data', () => {
  const d = workspaceDigest({items: [
    {id: 'a', name: 'RL zip', brand: 'Ralph Lauren', garment: 'Quarter Zip', status: 'Sold', sale: 25, cost: 8, purchasedAt: '2026-10-01', soldAt: '2026-10-06'},
    {id: 'b', name: 'RL polo', brand: 'Ralph Lauren', status: 'Sold', sale: 15, cost: 5, purchasedAt: '2026-10-02', soldAt: '2026-11-02'},
    {id: 'c', name: 'Nike tee', brand: 'Nike', status: 'In Stock', cost: 3, price: 12, purchasedAt: '2026-09-01', listedAt: '2026-09-02'}],
    expenses: [['Bags', 9, 0, 0, '2026-10-01']]}, Date.parse('2026-11-21'));
  assert.deepEqual(d.totals, {items: 3, sold: 2, inStock: 1, revenue: 40, itemProfit: 27, businessExpenses: 9, stockAtCost: 3});
  assert.equal(d.byBrand[0].name, 'Ralph Lauren'); assert.equal(d.byBrand[0].profit, 27); assert.equal(d.byBrand[0].medianDaysToSell, 31);
  assert.deepEqual(d.byMonth.map(m => m.month), ['2026-10', '2026-11']);
  assert.equal(d.oldestStock[0].daysListed, 80);
});
