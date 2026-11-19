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
