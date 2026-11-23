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
