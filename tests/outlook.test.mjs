import test from 'node:test';
import assert from 'node:assert/strict';
import {environment} from './support.mjs';
import app from '../dist/server/app.js';

const origin = 'https://stockroom.bookednpaid.com';
const call = (env, path, method = 'GET', body) => app.fetch(new Request(origin + path, {method, redirect: 'manual', headers: {'content-type': 'application/json', 'oai-authenticated-user-id': 'ol-user', 'oai-authenticated-user-email': 'ol@example.test', origin}, body: body ? JSON.stringify(body) : undefined}), env);

test('Outlook: off until configured; connect, then a Vinted sale email in Outlook becomes a receipt', async () => {
  const env = environment();
  assert.equal((await call(env, '/api/outlook/connect', 'POST', {})).status, 404);
  env.MS_CLIENT_ID = 'ms-client'; env.MS_CLIENT_SECRET = 'ms-secret';
  assert.equal((await (await call(env, '/api/gmail')).json()).outlook, true);
  const start = await (await call(env, '/api/outlook/connect', 'POST', {})).json();
  const auth = new URL(start.authorizeUrl);
  assert.equal(auth.origin, 'https://login.microsoftonline.com');
  assert.match(auth.searchParams.get('scope'), /Mail\.Read/);
  const state = auth.searchParams.get('state');
  const now = new Date();
  const real = globalThis.fetch;
  let refreshCount = 0;
  globalThis.fetch = async (input, options = {}) => {
    const url = String(input);
    if (url.endsWith('/oauth2/v2.0/token')) {
      const body = new URLSearchParams(options.body);
      if (body.get('grant_type') === 'refresh_token') refreshCount++;
      return Response.json({access_token: 'at-' + refreshCount, refresh_token: 'rt-' + refreshCount, scope: 'Mail.Read User.Read offline_access openid email'});
    }
    if (url === 'https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName') return Response.json({mail: 'Seller@Outlook.com'});
    if (url.startsWith('https://graph.microsoft.com/v1.0/me/messages?')) return Response.json({value: [
      {id: 'AAMkAGI2THVSAAA=', subject: 'You\'ve sold an item', from: {emailAddress: {name: 'Vinted', address: 'no-reply@vinted.co.uk'}}, receivedDateTime: now.toISOString(), hasAttachments: false},
      {id: 'AAMkSPAM', subject: 'You\'ve sold an item', from: {emailAddress: {name: 'Vinted', address: 'no-reply@vinted-support.co'}}, receivedDateTime: now.toISOString(), hasAttachments: false},
      {id: 'AAMkFAKE', subject: 'You\'ve sold an item', from: {emailAddress: {name: 'Vinted', address: 'no-reply@vinted.co.uk'}}, receivedDateTime: now.toISOString(), hasAttachments: false},
    ]});
    if (url.includes('/messages/AAMkAGI2THVSAAA%3D?')) return Response.json({subject: 'You\'ve sold an item', receivedDateTime: now.toISOString(), body: {contentType: 'html', content: '<p>Hi Dom, sam_k has bought Nike Tech Fleece Hoodie £38.00</p>'},
      internetMessageHeaders: [{name: 'Authentication-Results', value: 'spf=pass (sender IP is 1.2.3.4) smtp.mailfrom=vinted.co.uk; dkim=pass (signature was verified) header.d=vinted.co.uk;dmarc=pass action=none header.from=vinted.co.uk;compauth=pass reason=100'}]});
    if (url.includes('/messages/AAMkFAKE?')) return Response.json({subject: 'You\'ve sold an item', receivedDateTime: now.toISOString(), body: {contentType: 'text', content: 'x has bought Gold Watch £900.00'},
      internetMessageHeaders: [{name: 'Authentication-Results', value: 'spf=fail smtp.mailfrom=evil.test; dmarc=fail action=quarantine header.from=vinted.co.uk'}]});
    if (url.includes('/messages/AAMkSPAM')) throw new Error('untrusted sender should never be opened');
    return real(input, options);
  };
  try {
    const back = await call(env, '/api/outlook/callback?state=' + encodeURIComponent(state) + '&code=abc');
    assert.equal(back.status, 303);
    assert.match(back.headers.get('location'), /gmail=connected/);
    let view = await (await call(env, '/api/gmail')).json();
    assert.equal(view.connection.mode, 'outlook');
    assert.equal(view.connection.mailbox, 'seller@outlook.com');
    const checked = await (await call(env, '/api/gmail/check', 'POST', {})).json();
    assert.equal(checked.added, 1, JSON.stringify(checked).slice(0, 300));
    const r = checked.connection.receipts[0];
    assert.deepEqual([r.event.type, r.event.amount, r.event.title], ['sold', 38, 'Nike Tech Fleece Hoodie']);
    assert.equal(refreshCount, 1);
  } finally { globalThis.fetch = real; }
});
