import test from 'node:test';
import assert from 'node:assert/strict';
import {environment} from './support.mjs';
import app from '../dist/server/app.js';
import {inboundEmail, forwardingConfirmation, forwardedSender} from '../worker/inbound.js';

const call = (env, path, method = 'GET', body) => app.fetch(new Request('https://stockroom.bookednpaid.com' + path, {method, headers: {'content-type': 'application/json', 'oai-authenticated-user-id': 'fwd-user', 'oai-authenticated-user-email': 'fwd@example.test', origin: 'https://stockroom.bookednpaid.com'}, body: body ? JSON.stringify(body) : undefined}), env).then(async r => ({status: r.status, data: await r.json()}));
const mail = (to, raw) => {
  let rejected = null;
  return {to, from: 'seller@gmail.com', rawSize: raw.length, raw: new Response(raw).body, setReject: r => { rejected = r; }, get rejected() { return rejected; }};
};
const now = new Date();
const vintedSold = [
  'From: Vinted <no-reply@vinted.co.uk>', 'To: seller@gmail.com', 'Subject: You\'ve sold an item', 'Date: ' + now.toUTCString(), 'Message-ID: <abc123@vinted.co.uk>',
  'ARC-Authentication-Results: i=1; mx.google.com; dkim=pass header.i=@vinted.co.uk; spf=pass; dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=vinted.co.uk',
  'MIME-Version: 1.0', 'Content-Type: text/plain; charset=utf-8', '', 'Hi Dom, sam_k has bought Black Ralph Lauren Quarter Zip £24.00 Get it ready to send.'].join('\r\n');

test('forwarding: private address, Gmail confirmation code, a forwarded Vinted sale lands like a Gmail one', async () => {
  const env = {...environment(), FORWARD_DOMAIN: 'in.stockroom.test'};
  const started = await call(env, '/api/gmail/forward', 'POST', {});
  assert.equal(started.status, 200);
  const {address, mode, filter} = started.data.connection;
  assert.equal(mode, 'forward');
  assert.match(address, /^[a-z0-9]{12,40}@in\.stockroom\.test$/);
  assert.match(filter, /no-reply@vinted\.co\.uk/);
  // Unknown addresses are refused.
  const stranger = mail('nobody12345678@in.stockroom.test', vintedSold);
  await inboundEmail(stranger, env, {waitUntil() {}});
  assert.equal(stranger.rejected, 'Unknown address');
  // Gmail's confirmation code shows up in the app.
  const code = ['From: Gmail Team <forwarding-noreply@google.com>', 'To: ' + address, 'Subject: (#738201934) Gmail Forwarding Confirmation - Receive Mail from seller@gmail.com', 'Date: ' + now.toUTCString(), '', 'Confirmation code: 738201934', 'https://mail-settings.google.com/mail/vf-abc'].join('\r\n');
  await inboundEmail(mail(address, code), env, {waitUntil() {}});
  let view = await call(env, '/api/gmail');
  assert.equal(view.data.connection.confirm.code, '738201934');
  assert.equal(view.data.connection.receipts.length, 0, 'the setup code is not a receipt');
  // The forwarded sale.
  await inboundEmail(mail(address, vintedSold), env, {waitUntil() {}});
  view = await call(env, '/api/gmail');
  const r = view.data.connection.receipts[0];
  assert.equal(view.data.connection.state, 'connected');
  assert.deepEqual([r.category, r.event?.type, r.event?.amount, r.event?.title], ['Sale', 'sold', 24, 'Black Ralph Lauren Quarter Zip']);
  // Forwarding the same email twice doesn't count it twice.
  await inboundEmail(mail(address, vintedSold), env, {waitUntil() {}});
  assert.equal((await call(env, '/api/gmail')).data.connection.receipts.length, 1);
  // A fake "sale" whose sender failed DMARC is ignored.
  await inboundEmail(mail(address, vintedSold.replace('dmarc=pass', 'dmarc=fail').replace('abc123', 'zzz999')), env, {waitUntil() {}});
  assert.equal((await call(env, '/api/gmail')).data.connection.receipts.length, 1);
});

test('forwarding helpers', () => {
  assert.equal(forwardingConfirmation('someone@else.com', '(#123456789) Gmail Forwarding Confirmation', ''), null);
  assert.equal(forwardedSender('Vinted <no-reply@vinted.co.uk>', ['spf=pass (sender IP is 1.2.3.4) smtp.mailfrom=vinted.co.uk; dkim=pass header.d=vinted.co.uk; dmarc=pass action=none header.from=vinted.co.uk;']), 'vinted.co.uk');
  assert.equal(forwardedSender('Vinted <no-reply@vinted.co.uk>', ['mx.google.com; dmarc=fail header.from=vinted.co.uk']), null);
  assert.equal(forwardedSender('Scam <no-reply@vinted.co.uk.evil.com>', ['mx.google.com; dmarc=pass header.from=vinted.co.uk.evil.com']), null);
});

test('past sales added from emails do not use the free item allowance', async () => {
  const {checkNewItems} = await import('../worker/billing.js');
  const env = environment();
  const items = n => Array.from({length: n}, (_, i) => ({id: String(i + 1).padStart(4, '0'), name: 'x', status: 'Sold', source: 'email'}));
  assert.deepEqual(await checkNewItems(env, {id: 'free-hist', email: 'f@example.test'}, [], items(40)), []);
  await assert.rejects(checkNewItems(env, {id: 'free-hist', email: 'f@example.test'}, [], items(40).map(i => ({...i, source: undefined, status: 'In Stock'}))), e => e.status === 402);
});
