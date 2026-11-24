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
    let overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    // A momentary overflow mid-animation that's gone half a second later isn't a layout bug.
    if (overflow > 1) { await page.waitForTimeout(500); overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); }
    const culprit = overflow > 1 ? await page.evaluate(() => { let w = null; for (const e of document.querySelectorAll('body *')) { const r = e.getBoundingClientRect(); if (r.right > innerWidth + 1 && (!w || r.right > w.r)) w = {r: r.right, n: e.tagName + '.' + e.className + '#' + e.id}; } return w ? w.n : ''; }) : '';
    assert.ok(overflow <= 1, 'page scrolls sideways by ' + overflow + 'px ' + culprit);
    console.log('ok   ' + name + ' @' + viewport.width);
  } catch (error) {
    failures.push(name + ' @' + viewport.width + ': ' + error.message);
    console.log('FAIL ' + name + ' @' + viewport.width + ': ' + error.message);
  } finally { await context.close(); }
}
const go = (page, tab) => page.evaluate(t => navigate(t), tab).then(() => page.waitForTimeout(400));

for (const viewport of [{width: 390, height: 844}, {width: 1440, height: 900}]) {
  await check('home chart', viewport, async page => {
    if (viewport.width <= 800) {
      await page.waitForSelector('.mh .mh-chart .mh-line', {state: 'attached'});
      await page.waitForSelector('.mh-sheet .mh-pulse .mh-pulse-cta');
      await page.click('[data-mh-range="7"]');
      await page.waitForSelector('[data-mh-range="7"][aria-pressed="true"]');
      const fits = await page.$eval('.mh-stats', el => el.scrollWidth <= el.clientWidth + 1);
      assert.ok(fits, 'stats strip overflows');
      assert.ok(await page.$('body.home-phone .mh-store'), 'store pill missing');
      return;
    }
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
  await check('courier emails mark posted + delivered', viewport, async page => {
    const out = await page.evaluate(() => {
      const stock = db.items.find(i => i.status === 'In Stock' && !i.deletedAt);
      let data = recordSale(db, stock.id, 20, todayUK());
      const sold = data.items.find(i => i.id === stock.id);
      const label = auApply({type: 'label', title: sold.name, tracking: 'JJD0002212127199444', labelMedia: '/api/media/x/123e4567-e89b-12d3-a456-426614174000', date: todayUK()}, sold, data);
      data = label.next;
      const qr = auTrackingApply({type: 'qr', tracking: 'JJD0002212127199444', qrMedia: '/api/media/x/223e4567-e89b-12d3-a456-426614174000', code: '245 824 706', date: todayUK()}, data); data = qr.next;
      const posted = auTrackingApply({type: 'posted', tracking: 'JJD0002212127199444', carrier: 'InPost', date: todayUK()}, data); data = posted.next;
      const stranger = auTrackingApply({type: 'posted', tracking: 'H00IAA0000000000', date: todayUK()}, data);
      const delivered = auTrackingApply({type: 'parcel-delivered', tracking: 'JJD0002212127199444', date: todayUK()}, data); data = delivered.next;
      const item = data.items.find(i => i.id === sold.id);
      db = data; render();
      return [item.shipCarrier, !!item.shipQr, item.shipCode, tradeStatus(lastTrade(data, sold.id)), !!item.shipDeliveredAt, stranger === null, !!document.querySelector('.ship-way-row')].join('|');
    });
    assert.equal(out, 'InPost|true|245 824 706|Posted|true|true|true', out);
  });
  await check('money chart: 7D, 30D and 90D agree', viewport, async page => {
    const out = await page.evaluate(() => {
      const today = todayUK(), rows = [{kind: 'Sale', date: today, revenue: 20}, {kind: 'Sale', date: new Date(Date.parse(today) - 10 * 864e5).toISOString().slice(0, 10), revenue: 30}, {kind: 'Expense', date: today, revenue: 0, expense: 5}];
      const end = n => mhSeries(rows, n, today).at(-1).v;
      return [end(30), end(90), mhSeries(rows, 7, today).at(-1).v].join('|');
    });
    assert.equal(out, '50|50|20', out);
  });
  if (viewport.width < 500) await check('home profit is the same at 30D and 90D', viewport, async page => {
    const out = await page.evaluate(() => {
      const old = new Date(Date.parse(todayUK()) - 50 * 864e5).toISOString().slice(0, 10);
      db = {...db, expenses: [...db.expenses, ['Mailing bags', 9.98, 'Packaging', null, old, '']]};
      const read = r => { mhRange = r; render(); return document.querySelectorAll('.mh-stat b')[2].textContent; };
      return [read(30), read(90)];
    });
    assert.equal(out[0], out[1], 'profit 30D ' + out[0] + ' vs 90D ' + out[1]);
  });
  await check('stock number in Vinted titles', viewport, async page => {
    const out = await page.evaluate(() => {
      const item = db.items.find(i => i.status === 'In Stock');
      const a = buildListing(item).title;
      const b = withStockNo('Ralph Lauren Navy Quarter Zip Jumper Knit Cotton Pullover Mens Medium Size M Very Long', '0012');
      const c = withStockNo('Nike Hoodie #0012', '0012');
      const ranked = auRank('Grey Hoodie #' + item.id, db.items.filter(i => !i.deletedAt));
      return [a.endsWith(' #' + item.id), b.length <= 70 && b.endsWith(' #0012'), c, ranked[0]?.item.id === item.id && ranked[0].score === 1].join('|');
    });
    assert.equal(out, 'true|true|Nike Hoodie #0012|true', out);
  });
  await check('avatars load', viewport, async page => {
    await page.waitForFunction(() => { const img = document.querySelector('#navAvatar img'); return img && img.complete; });
    assert.ok(await page.evaluate(() => document.querySelector('#navAvatar img').naturalWidth > 0), 'profile avatar is broken');
  });
  if (viewport.width < 500) await check('transactions: tap a row for actions', viewport, async page => {
    await go(page, 'Activity');
    await page.click('#view tbody tr td:nth-child(2)');
    await page.waitForSelector('.row-sheet.open [data-row-act]');
    await page.goBack(); await page.waitForTimeout(400);
    assert.equal(await page.$('.row-sheet'), null, 'back closes the action sheet');
    assert.equal(await page.evaluate(() => tab), 'Activity');
    await page.click('#view tbody tr td:nth-child(2)');
    await page.click('.row-sheet [data-row-act="0"]');
    await page.waitForSelector('dialog[open]');
  });
  await check('long parcel rows fit the screen', viewport, async page => {
    await page.evaluate(() => {
      let d = db;
      for (const item of d.items.filter(i => i.status === 'In Stock').slice(0, 3)) {
        d = recordSale(d, item.id, 25, todayUK()); d = advanceOrder(d, item.id, 'Posted', todayUK());
        Object.assign(d.items.find(i => i.id === item.id), {name: 'Very Long Vintage Ralph Lauren Quarter Zip Jumper Navy Medium', shipCarrier: 'InPost', shipTracking: 'JJD0002212127199444', shipDeliveredAt: todayUK()});
      }
      db = d; render();
    });
    await page.waitForSelector('.ship-way-row');
    const widths = await page.evaluate(() => [Math.max(...[...document.querySelectorAll('.ship-way-row, .ship-way-panel, .ship-way-text small')].map(e => e.getBoundingClientRect().right)), document.querySelector('main').getBoundingClientRect().right]);
    assert.ok(widths[0] <= widths[1] + 1, 'On the way row sticks out past the page: ' + widths.join(','));
  });
  await check('label viewer + back', viewport, async page => {
    await page.evaluate(() => { const id = db.items.find(i => i.status === 'In Stock').id; let d = recordSale(db, id, 30, todayUK()); d.items.find(i => i.id === id).shipLabel = '/favicon.svg'; db = d; render(); });
    await page.click('[data-label-show]');
    await page.waitForSelector('.label-view .label-frame');
    await page.click('.label-view [data-label-close]');
    assert.equal(await page.$('.label-view'), null, 'label closes with its button');
    await page.click('[data-label-show]');
    await page.waitForSelector('.label-view');
    await page.goBack(); await page.waitForTimeout(300);
    assert.equal(await page.$('.label-view'), null, 'phone back closes the label');
    assert.equal(await page.evaluate(() => tab), 'Dashboard', 'back closed the label without leaving Home');
    await go(page, 'Stock'); await go(page, 'Activity');
    await page.goBack(); await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => tab), 'Stock', 'back returns to the previous screen');
    await page.evaluate(() => openItem(db.items[0]));
    await page.waitForSelector('#modal[open]');
    await page.goBack(); await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => document.getElementById('modal').open), false, 'back closes the item sheet');
    assert.equal(await page.evaluate(() => tab), 'Stock');
    if (viewport.width < 500) {
      await go(page, 'Profile');
      await page.waitForSelector('.me-hub .me-row');
      assert.ok(!(await page.isVisible('#accountMenu')), 'no ☰ menu on phone');
      await page.click('.me-row[data-settings-section="account"]'); await page.waitForTimeout(400);
      assert.equal(await page.evaluate(() => tab), 'Account');
      assert.ok(await page.isVisible('#screenBack'), 'back button on Settings');
      await page.click('#screenBack'); await page.waitForTimeout(400);
      assert.equal(await page.evaluate(() => tab), 'Profile', 'header back returns to Profile');
    }
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
