// UI smoke tests: real browser, phone and desktop, against the local dev server.
// Run: npm run build && npm run test:ui   (set CHROME_PATH if Chrome isn't at /usr/bin/google-chrome)
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';

const PORT = 4199, BASE = 'http://localhost:' + PORT + '/';
const server = spawn(process.execPath, ['scripts/dev.mjs'], {env: {...process.env, PORT: String(PORT)}, stdio: 'ignore'});
const wait = ms => new Promise(r => setTimeout(r, ms));
for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE)).ok) break; } catch {} await wait(100); }

const browser = await chromium.launch({executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox']});
const failures = [];
async function check(name, viewport, fn) {
  const context = await browser.newContext({viewport, isMobile: viewport.width < 500, hasTouch: viewport.width < 500, reducedMotion: 'reduce'});
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  try {
    await page.goto(BASE, {waitUntil: 'networkidle'});
    await page.waitForFunction(() => typeof db !== 'undefined' && db && document.querySelector('#view').children.length);
    await fn(page);
    assert.deepEqual(errors, [], 'page errors');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    assert.ok(overflow <= 1, 'page scrolls sideways by ' + overflow + 'px');
    console.log('ok   ' + name + ' @' + viewport.width);
  } catch (error) {
    failures.push(name + ' @' + viewport.width + ': ' + error.message);
    console.log('FAIL ' + name + ' @' + viewport.width + ': ' + error.message);
  } finally { await context.close(); }
}
const go = (page, tab) => page.evaluate(t => navigate(t), tab).then(() => page.waitForTimeout(400));

for (const viewport of [{width: 390, height: 844}, {width: 1440, height: 900}]) {
  await check('home chart', viewport, async page => {
    await page.waitForSelector('.revenue-studio .rc-svg .rc-line, .revenue-studio .rc-svg .rc-solo', {state: 'attached'});
    const svg = await page.$('.rc-svg'); const box = await svg.boundingBox();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height / 2);
    await page.evaluate(() => document.querySelector('[data-rc-range="All"]').click());
    assert.ok(await page.$('.rc-nav'), 'timeline strip missing');
  });
  await check('stock', viewport, async page => {
    await go(page, 'Stock');
    await page.selectOption('#sortQuick', 'label');
    const ids = await page.$$eval('#stockResults [data-edit]', els => [...new Set(els.map(e => e.dataset.edit))]);
    assert.deepEqual(ids, [...ids].sort((a, b) => Number(a) - Number(b)), 'label sort order');
    const row = await page.$('.stock-filters');
    const scrolls = await row.evaluate(el => getComputedStyle(el).overflowX);
    if (viewport.width < 500) assert.ok(['auto', 'scroll'].includes(scrolls), 'filter chips must scroll on phone');
    await page.click('.stock-more summary');
    const menu = await page.$eval('.stock-more[open] > div', el => { const r = el.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + 10); return {inView: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth, onTop: el.contains(hit)}; });
    assert.ok(menu.inView && menu.onTop, 'card menu clipped or hidden');
  });
  await check('add stock sheet', viewport, async page => {
    await page.evaluate(() => openItem(null));
    await page.waitForSelector('#quickAdd[open]');
    const save = await page.$eval('#qaSave', el => { const r = el.getBoundingClientRect(); return r.height > 30 && getComputedStyle(el).display !== 'none'; });
    assert.ok(save, 'save button hidden');
  });
  await check('performance', viewport, async page => {
    await go(page, 'Buying insights');
    assert.equal(await page.$$eval('.pf-kpi', els => els.length), 6);
    for (const dim of ['type', 'delivery', 'band', 'size', 'month']) await page.click('[data-pf-dim="' + dim + '"]');
  });
  await check('reports + tax', viewport, async page => {
    await go(page, 'Reports');
    await page.waitForSelector('.tax-card');
  });
  // Test data for the growth features: stale listings, a sale awaiting postage and a sourcing trip.
  const seedGrowth = page => page.evaluate(() => {
    const ago = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
    const stock = db.items.filter(i => i.status === 'In Stock').slice(0, 3);
    [20, 45, 90].forEach((d, n) => { if (stock[n]) Object.assign(stock[n], {stage: 'Listed', listedAt: ago(d), priceChangedAt: '', price: 40, cost: 12}); });
    db.sourcingRuns = [{id: 'run1', place: 'BHF Ringwood', kind: 'Charity shop', date: ago(30), spend: 24, miles: 12, minutes: 90, notes: ''}];
    db.items.slice(0, 4).forEach(i => { i.sourcingRunId = 'run1'; });
    render();
  });
  await check('repricing coach', viewport, async page => {
    await seedGrowth(page);
    await go(page, 'Repricing');
    await page.waitForSelector('.coach-group');
    const groups = await page.$$eval('.coach-group', els => els.length);
    assert.ok(groups >= 2, 'expected nudge/drop/clear groups, got ' + groups);
    assert.ok(await page.$('[data-coach-price]'), 'no price suggestion button');
  });
  await check('sourcing trips', viewport, async page => {
    await seedGrowth(page);
    await go(page, 'Sourcing');
    await page.waitForSelector('.sourcing-bar');
    assert.ok(await page.$('table'), 'places table missing');
    await page.click('[data-run-new]');
    await page.waitForSelector('#runDialog[open] #runForm');
    const fits = await page.$eval('#runDialog', el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1; });
    assert.ok(fits, 'trip dialog overflows');
  });
  await check('hmrc tracker', viewport, async page => {
    await go(page, 'Reports');
    await page.waitForSelector('.hmrc-card .hmrc-row');
  });
  await check('ship-by deadline', viewport, async page => {
    const by = await page.evaluate(() => [shipDeadline('2026-11-20'), shipDeadline('2026-12-22')]);
    assert.deepEqual(by, ['2026-11-27', '2026-12-31'], 'Fri + 5 working days, and skipping Christmas bank holidays');
  });
  await check('editor measure + crosslist', viewport, async page => {
    await page.evaluate(() => openFullItem(db.items.find(i => i.status === 'In Stock')));
    await page.waitForSelector('#measureBtn', {state: 'attached'});
    await page.waitForSelector('#crosslist', {state: 'attached'});
  });
  await check('item editor + Pip price', viewport, async page => {
    await page.evaluate(() => openFullItem(db.items.find(i => i.status === 'In Stock')));
    await page.waitForSelector('#modal .pg-hint');
  });
}
await browser.close();
server.kill();
if (failures.length) { console.log('\n' + failures.length + ' UI check(s) failed'); process.exit(1); }
console.log('\nAll UI checks passed');
