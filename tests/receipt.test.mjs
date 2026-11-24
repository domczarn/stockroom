import assert from 'node:assert/strict';
import {receiptText, parsePurchaseReceipt, receiptUpdate, vintedEvent} from '../worker/gmail.js';

// Same table structure Vinted uses for "Your receipt for ..." emails.
const html = `<html><head><style>.x{color:red}</style></head><body>
<p>Hello domczarn,</p><p><strong>Your payment has been received. </strong><br/></p>
<table><tbody>
<tr><td><strong>Seller</strong></td><td>lunaclothing77 </td></tr>
<tr><td><strong>Order</strong></td><td><p style="margin: 0;">New Balance Men&#39;s Windbreaker<br/></p></td></tr>
<tr><td><strong>Paid</strong></td><td>£9.99</td></tr>
<tr><td>Item</td><td>£6.00</td></tr><tr><td>Postage</td><td>£2.99</td></tr>
</tbody></table>
<table><tbody><tr><td>Vinted fee</td><td>£1.00</td></tr></tbody></table>
<table><tbody>
<tr><td><strong>Payment method</strong></td><td>Apple Pay (£9.99)</td></tr>
<tr><td><strong>Payment date</strong></td><td>18/11/2026 16:07</td></tr>
<tr><td><strong>Transaction ID</strong></td><td>24396476514</td></tr>
</tbody></table></body></html>`;

const parsed = parsePurchaseReceipt(receiptText(html));
assert.deepEqual(parsed, {transactionId:'24396476514', name:"New Balance Men's Windbreaker", brand:'', cost:9.99, purchasedAt:'2026-11-18T16:07', seller:'lunaclothing77'});
assert.equal(parsePurchaseReceipt('Order\nSomething\nno price here'), null);

// Subject classification: purchase receipts are recognised.
const message = (subject, at = Date.now()) => ({id:'1a1ef6a23b1699b3', internalDate:String(at), payload:{headers:[
  {name:'From', value:'Team Vinted <no-reply@vinted.co.uk>'}, {name:'Subject', value:subject},
  {name:'Authentication-Results', value:'mx.google.com; dmarc=pass (p=REJECT) header.from=vinted.co.uk'}]}});
assert.equal(receiptUpdate(message('Your receipt for "New Balance Men’s Windbreaker“'), 7).category, 'Purchase');
assert.equal(receiptUpdate(message('You’ve sold an item on Vinted'), 7).category, 'Sale');
console.log('receipt ok');

{

  const at = '2026-11-19T13:15:31Z';
  assert.deepEqual(vintedEvent('You’ve sold an item on Vinted', 'Hello domczarn, fredlang has bought Black Ralph Lauren Quarter Zip £36.00 We will transfer the buyer&#39;s payment to your Vinted Balance', at),
    {type: 'sold', title: 'Black Ralph Lauren Quarter Zip', amount: 36, buyer: 'fredlang', date: '2026-11-19'});
  assert.deepEqual(vintedEvent('This order is completed', 'domczarn, your sale is complete. Your sale of Grey True Religion Sweatshirt was completed successfully. Transaction ID: #24017520495 Date: 14/11/2026 21:28 Vinted Platform', '2026-11-14T20:28:39Z'),
    {type: 'completed', title: 'Grey True Religion Sweatshirt', transactionId: '24017520495', date: '2026-11-14'});
  assert.equal(vintedEvent('White zip up top - Confirmation needed', 'Hi domczarn, Your order has been marked as delivered.', at).type, 'delivered');
  assert.equal(vintedEvent('White zip up top - Confirmation needed', '', at).title, 'White zip up top');
  assert.deepEqual(vintedEvent('ASICS Black & Yellow Lightweight Running Windbreaker Jacket Hooded Full Zip shipping label – use by 23/11/2026 09:00', '', at),
    {type: 'label', title: 'ASICS Black & Yellow Lightweight Running Windbreaker Jacket Hooded Full Zip', date: '2026-11-19'});
  assert.equal(vintedEvent('Return shipping label - Navy Polo Ralph Lauren Hoodie - use before 03/11/2026 19:16', '', at), null);
  assert.equal(vintedEvent('Your refund for "Medium men’s polo Ralph Lauren quaterzip" is on its way', '', at).title, 'Medium men’s polo Ralph Lauren quaterzip');
  assert.equal(vintedEvent('Return completed - "Navy Polo Ralph Lauren Hoodie"', '', at).title, 'Navy Polo Ralph Lauren Hoodie');
  assert.equal(vintedEvent('Your payment is being sent to your bank', 'Withdrawal amount: £52.50', at), null);
}
console.log('vinted events ok');

{
  const message = subject => ({id:'1a1ef6a23b1699b3', internalDate:String(Date.now()), payload:{headers:[
    {name:'From', value:'Team Vinted <no-reply@vinted.co.uk>'}, {name:'Subject', value:subject},
    {name:'Authentication-Results', value:'mx.google.com; dmarc=pass (p=REJECT) header.from=vinted.co.uk'}]}});
  assert.equal(receiptUpdate(message('This order is completed'), 7).category, 'Sale');
  assert.equal(receiptUpdate(message('Nike hoodie shipping label'), 7).category, 'Delivery');
  assert.equal(receiptUpdate(message('Order confirmed'), 7), null);
  assert.equal(receiptUpdate(message('Payment successful'), 7), null);
  assert.equal(receiptUpdate(message('Your order update'), 7), null);
  const arrived = receiptUpdate(message('White zip up top - Confirmation needed'), 7);
  assert.equal(arrived.quiet, true); assert.equal(arrived.event.type, 'delivered');
  console.log('gmail filter ok');
}

// Courier emails: posted / delivered / QR, matched by tracking number.
{
  const {verifiedSender, trackingFrom, courierEvent, messageParts} = await import('../worker/gmail.js');
  const auth = d => 'mx.google.com; dkim=pass; dmarc=pass (p=REJECT) header.from=' + d;
  assert.equal(verifiedSender('InPost via Vinted <shipping@relay.vinted.com>', auth('relay.vinted.com')), 'relay.vinted.com');
  assert.equal(verifiedSender('Evri <do-not-reply@evri.com>', auth('evri.com')), 'evri.com');
  assert.equal(verifiedSender('Royal Mail <no-reply@royalmail.com>', auth('royalmail.com')), 'royalmail.com');
  assert.equal(verifiedSender('Evri <do-not-reply@evri.com>', 'mx.google.com; dmarc=fail header.from=evri.com'), null, 'spoofed courier rejected');
  assert.equal(verifiedSender('Evri <do-not-reply@evri.com.evil.io>', auth('evri.com.evil.io')), null, 'look-alike domain rejected');
  assert.equal(verifiedSender('Someone <x@vinted.co.uk>', auth('vinted.co.uk')), null, 'only Vinted no-reply');
  assert.equal(trackingFrom('Parcel number JJD0002212127199444 Drop-off'), 'JJD0002212127199444');
  assert.equal(trackingFrom('Tracking number H00IAA3049598684'), 'H00IAA3049598684');
  assert.equal(trackingFrom('tracking VU123456789GB'), 'VU123456789GB');
  const posted = courierEvent('Your parcel is locker-ed up', 'Parcel number JJD0002212127199444 Drop-off time 20/11/2026 20:15 InPost', '2026-11-20T20:16:00Z', 'relay.vinted.com');
  assert.deepEqual([posted.type, posted.tracking, posted.carrier, posted.date], ['posted', 'JJD0002212127199444', 'InPost', '2026-11-20']);
  assert.equal(courierEvent('Thanks for dropping off your parcel', 'Tracking number H00IAA3049598684', '2026-11-21T10:00:00Z', 'evri.com').type, 'posted');
  assert.equal(courierEvent('It’s been collected', 'Parcel JJD0002212127199444 InPost', '2026-11-22T10:00:00Z', 'relay.vinted.com').type, 'parcel-delivered');
  const qr = courierEvent('Your QR code is ready', 'InPost. Or enter this code instead 245 824 706 Parcel number JJD0002212127199444', '2026-11-19T10:00:00Z', 'relay.vinted.com');
  assert.deepEqual([qr.type, qr.code], ['qr', '245 824 706']);
  assert.equal(courierEvent('Your parcel is locker-ed up', 'no tracking here', '2026-11-20T10:00:00Z', 'relay.vinted.com'), null);
  const b = t => Buffer.from(t).toString('base64url');
  const parts = messageParts({mimeType: 'multipart/mixed', parts: [{mimeType: 'text/html', body: {data: b('<p>Tracking code: <b>H00IAA3049598684</b></p>')}},
    {mimeType: 'application/pdf', filename: 'Vinted-Digital-Label-1.pdf', body: {attachmentId: 'abc', size: 5000}}]});
  assert.match(parts.text, /Tracking code: H00IAA3049598684/);
  assert.equal(parts.files[0].type, 'application/pdf');
  // Courier receipts are quiet (not listed) and flagged for a full read.
  const courierMsg = {id: 'abcdef1234567', internalDate: String(Date.now()), snippet: '', payload: {headers: [
    {name: 'From', value: 'Evri <do-not-reply@evri.com>'}, {name: 'Subject', value: 'Thanks for dropping off your parcel'},
    {name: 'Authentication-Results', value: auth('evri.com')}]}};
  const r = receiptUpdate(courierMsg, 7);
  assert.equal(r.courier, 'evri.com'); assert.equal(r.quiet, true); assert.equal(r.needsBody, true);
  console.log('courier emails ok');
}

// Evri drop-off emails are a single HTML part with the tracking number in a table.
{
  const {messageParts, courierEvent} = await import('../worker/gmail.js');
  const html = '<html><head><style>.a{b:c}</style></head><body><p> Thanks for dropping off your Vinted parcel on Thursday 19 November at 19:28. </p><p>Tracking number</p> <p style="x">H00IAA3049598684</p></body></html>';
  const {text} = messageParts({mimeType: 'text/html', body: {data: Buffer.from(html).toString('base64url')}});
  const e = courierEvent('Thanks for dropping off your parcel', text, '2026-11-19T19:29:28Z', 'evri.com');
  assert.deepEqual([e.type, e.tracking, e.carrier], ['posted', 'H00IAA3049598684', 'Evri']);
  console.log('evri html ok');
}

// Relay and Evri digital labels: the scan code is pulled out of the PDF as a PNG.
{
  const {pdfCodeImage} = await import('../worker/gmail.js');
  const zlib = await import('node:zlib');
  const rows = []; for (let y = 0; y < 300; y++) { const r = Buffer.alloc(301); r[0] = 0; for (let x = 0; x < 300; x++) r[1 + x] = (x ^ y) & 16 ? 0 : 255; rows.push(r); }
  const data = zlib.deflateSync(Buffer.concat(rows));
  const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n16 0 obj\n<</Type/XObject/Subtype/Image/Width 300/Height 300/BitsPerComponent 8/ColorSpace/DeviceGray/Filter/FlateDecode/DecodeParms<</Predictor 15/Colors 1/BitsPerComponent 8/Columns 300>>/Length ' + data.length + '>>stream\n'), data, Buffer.from('\nendstream\nendobj\n')]);
  const png = pdfCodeImage(new Uint8Array(pdf));
  assert.ok(png && png[0] === 137 && png[1] === 80, 'makes a PNG');
  assert.equal(Buffer.from(png.slice(16, 24)).readUInt32BE(0), 300, 'keeps the width');
  assert.equal(pdfCodeImage(new Uint8Array(Buffer.from('%PDF-1.7 no images'))), null);
  console.log('label code ok');
}
