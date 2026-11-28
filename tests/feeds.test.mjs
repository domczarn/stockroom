import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {feedCsv} from '../worker/feeds.js';
import {validateWorkspace} from '../worker/security.js';
// taxrates.js is a browser script: run it and pick out what it defines.
const {ratesFor, ratesOn, TAX_RATES} = new Function(readFileSync(new URL('../web/taxrates.js', import.meta.url), 'utf8') + ';return {ratesFor, ratesOn, TAX_RATES};')();

// Rates: one file, keyed by tax year.
assert.equal(ratesFor(2026).tradingAllowance, 1000);
assert.equal(ratesFor(2027).tradingAllowance, 3000);
assert.equal(ratesOn('2027-04-05').tradingAllowance, 1000);
assert.equal(ratesOn('2027-04-06').tradingAllowance, 3000);
assert.equal(ratesFor(2031).dividend.basic, .1075, 'unknown later years fall back to the latest');
assert.ok(Object.keys(TAX_RATES).includes('2026-27') && Object.keys(TAX_RATES).includes('2027-28'));

// Feeds: spreadsheet-safe CSV.
const data = {items: [
  {id: '0001', name: 'Nike Hoodie', brand: 'Nike', cost: 4, status: 'Sold', sale: 25, purchasedAt: '2026-10-01', purchaseSource: 'Charity shop', paidBy: 'director-card'},
  {id: '0002', name: '=HYPERLINK("x")', cost: 3, status: 'In Stock', price: 15, purchasedAt: '2026-11-01'},
], trades: [{id: 'a', itemId: '0001', name: 'Nike Hoodie', amount: 25, cost: 4, soldAt: '2026-11-20', refunds: [], extraCost: 2.5, packaging: .4, platformFee: 0}],
  sales: [], expenses: [['Mailing bags', 9.98, 'Packaging', null, '2026-10-23', '', '', '', 'company', '/api/media/x/1']]};
const sold = feedCsv('sold', data);
assert.ok(sold.startsWith('﻿Date sold,Stock ID'));
assert.match(sold, /2026-11-20,0001,Nike Hoodie,Nike,Vinted,25\.00,4\.00,2\.50,0\.40,0\.00,,18\.10,2026-10-01,Charity shop,Director personal card,Sold/);
const stock = feedCsv('stock', data, '2026-11-28');
assert.match(stock, /0002,"'=HYPERLINK\(""x""\)"/, 'formulas are neutralised');
assert.match(stock, /,27\r\n$/, 'days held');
assert.match(feedCsv('expenses', data), /2026-10-23,Mailing bags,Packaging,9\.98,Company account,,Yes,/);
assert.equal(feedCsv('nope', data), null);

// Workspace: new optional fields are accepted, bad ones refused, old workspaces untouched.
const base = () => ({items: [{id: '0001', name: 'A', cost: 1, status: 'In Stock', purchasedAt: '2026-10-01'}], sales: [], expenses: [], research: [], sources: []});
assert.doesNotThrow(() => validateWorkspace(base(), 'u1'));
assert.doesNotThrow(() => validateWorkspace({...base(), business: {structure: 'ltd', name: 'Booked & Paid Ltd', companyNumber: '12345678', yearEnd: '03-31', taxPot: 19, vat: false, useOfHome: true, retainedProfit: -200}}, 'u1'));
assert.throws(() => validateWorkspace({...base(), business: {structure: 'plc'}}, 'u1'), /business/i);
assert.throws(() => validateWorkspace({...base(), business: {structure: 'ltd', companyNumber: '123'}}, 'u1'), /business/i);
const withFields = base(); Object.assign(withFields.items[0], {paidBy: 'company', purchaseSource: 'Vinted', receiptPhoto: 'data:image/jpeg;base64,' + 'A'.repeat(30000)});
assert.doesNotThrow(() => validateWorkspace(withFields, 'u1'), 'receipt photos pass the text-length rule');
const badPaid = base(); badPaid.items[0].paidBy = 'mum';
assert.throws(() => validateWorkspace(badPaid, 'u1'), /paid-by/);
assert.doesNotThrow(() => validateWorkspace({...base(), expenses: [['Bags', 2, 'Packaging', null, '2026-10-01', '', '', '', 'director-cash', '']]}, 'u1'));
assert.throws(() => validateWorkspace({...base(), expenses: [['Bags', 2, 'Packaging', null, '2026-10-01', '', '', '', 'nobody', '']]}, 'u1'), /paid-by/);
console.log('feeds, rates and bookkeeping fields ok');
