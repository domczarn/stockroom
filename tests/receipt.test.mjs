import assert from 'node:assert/strict';
import {receiptText, parsePurchaseReceipt, receiptUpdate} from '../worker/gmail.js';

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
