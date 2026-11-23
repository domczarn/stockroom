import test from 'node:test';
import assert from 'node:assert/strict';
import {soldPieces, buildIndex, garmentType, formatMeasurements, MIN_SALES, MIN_SELLERS} from '../worker/grow.js';
import {validateWorkspace} from '../worker/security.js';

const ws = (sales) => ({items: sales.map((s, i) => ({id: String(i), name: s.name, brand: s.brand, status: 'Sold', cost: 5})),
  trades: sales.map((s, i) => ({itemId: String(i), amount: s.price, refunds: s.refund ? [{amount: s.refund}] : [], soldAt: '2026-11-10', listedAt: '2026-11-01'}))});

test('garmentType reads the item type from name or garment', () => {
  assert.equal(garmentType({name: 'M - Qzip - Black'}), 'Quarter zip');
  assert.equal(garmentType({name: 'Nike thing', garment: 'Hoodie'}), 'Hoodie');
  assert.equal(garmentType({name: 'Mystery'}), '');
});

test('soldPieces nets refunds and reads days to sell', () => {
  const pieces = soldPieces(ws([{name: 'Ralph Lauren quarter zip', brand: 'Ralph Lauren', price: 30, refund: 5}]));
  assert.deepEqual(pieces[0], {brand: 'ralph lauren', label: 'Ralph Lauren', type: 'Quarter zip', price: 25, days: 9});
});

test('buildIndex only publishes groups with enough sales and sellers', () => {
  const seller = (owner, n, price) => ({owner, pieces: Array.from({length: n}, () => ({brand: 'nike', label: 'Nike', type: 'Hoodie', price, days: 5}))});
  assert.equal(buildIndex([seller('a', 10, 20), seller('b', 10, 22)]).length, 0, 'two sellers is not enough');
  const rows = buildIndex([seller('a', 2, 20), seller('b', 2, 24), seller('c', 1, 30)]);
  const brandType = rows.find(r => r.key === 'nike|Hoodie');
  assert.ok(brandType, 'published at 5 sales from 3 sellers');
  assert.equal(brandType.n, MIN_SALES);
  assert.equal(brandType.sellers, MIN_SELLERS);
  assert.equal(brandType.median, 24);
  assert.equal(brandType.label, 'Nike');
});

test('formatMeasurements gives cm and inches', () => {
  assert.equal(formatMeasurements({pitToPit: 54, length: 70}), 'Pit to pit 54 cm (21.5 in), Length 70 cm (27.5 in)');
  assert.equal(formatMeasurements({}), '');
});

test('validateWorkspace accepts sourcing trips and rejects bad links', () => {
  const base = () => ({items: [{id: '1', name: 'Jacket', cost: 5, status: 'In Stock', price: null, sale: null, refund: null, sourcingRunId: 'r1'}], sales: [], expenses: [], sources: [], research: [],
    sourcingRuns: [{id: 'r1', place: 'BHF Ringwood', kind: 'Charity shop', date: '2026-11-20', spend: 12, miles: 8, minutes: 60, notes: ''}]});
  assert.ok(validateWorkspace(base(), 'owner'));
  const missing = base(); missing.items[0].sourcingRunId = 'nope';
  assert.throws(() => validateWorkspace(missing, 'owner'), /Sourcing trip could not be found/);
  const badKind = base(); badKind.sourcingRuns[0].kind = 'Heist';
  assert.throws(() => validateWorkspace(badKind, 'owner'), /Invalid sourcing trip/);
});

test('listingGaps suggests what to add', async () => {
  const {listingGaps} = await import('../worker/vision.js');
  assert.deepEqual(listingGaps({Name: 'Nike hoodie', Brand: 'Nike'}, true), ['the size', 'the condition', 'the colour']);
  assert.deepEqual(listingGaps({Name: 'Thing', Brand: 'Nike', Size: 'M', Condition: 'Good', Colour: 'Black', Measurements: 'x'}, false), ['a cover photo', 'the item type']);
});

test('Tell Pip only keeps valid changes to real in-stock items', async () => {
  const {cleanActions} = await import('../worker/pipplus.js');
  const out = cleanActions([
    {type: 'mark_sold', itemId: '0001', amount: '25', buyer: 'fred', date: '2026-11-22'},
    {type: 'mark_sold', itemId: '9999', amount: 10},
    {type: 'set_price', itemId: '0001', price: 19.5},
    {type: 'add_item', name: 'Nike jumper', cost: 4, quantity: 3, date: '2030-01-01', place: 'BHF'},
    {type: 'add_item', name: 'No cost'},
    {type: 'delete_everything'},
    {type: 'log_expense', description: 'Mailing bags', amount: 4.5, category: 'Packaging', date: '2026-11-23'}
  ], new Set(['0001']), '2026-11-23');
  assert.deepEqual(out.map(a => a.type), ['mark_sold', 'set_price', 'add_item', 'log_expense']);
  assert.equal(out[0].amount, 25);
  assert.equal(out[2].purchasedAt, '2026-11-23', 'future dates are pulled back to today');
  assert.equal(out[2].quantity, 3);
});
