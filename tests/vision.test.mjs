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
