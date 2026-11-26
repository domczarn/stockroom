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
    await page.evaluate(() => { if (startIsNew()) { const it = db.items.find(i => i.status === 'In Stock' && !i.deletedAt); db = recordSale(db, it.id, 20, todayUK()); render(); } });
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
  await check('sold + label + QR in the same minute all apply', viewport, async page => {
    const out = await page.evaluate(async w => {
      const item = db.items.find(i => i.status === 'In Stock' && !i.deletedAt);
      const day = todayUK(), t = n => day + 'T16:3' + n + ':00.000Z', title = 'Light Blue Jeans | Size W32 #' + item.id, tr = 'JJD0002212128' + String(w).padStart(6, '0');
      // Newest first, like the server sends them; label and QR share a timestamp.
      personalGmail = {connection: {receipts: [
        {id: 'lbl' + w, receivedAt: t(8), event: {type: 'label', title, tracking: tr, labelMedia: '/api/media/' + encodeURIComponent(account.id) + '/123e4567-e89b-12d3-a456-426614174000', date: day}},
        {id: 'qr' + w, receivedAt: t(8), courier: 'relay.vinted.com', event: {type: 'qr', tracking: tr, qrMedia: '/api/media/' + encodeURIComponent(account.id) + '/223e4567-e89b-12d3-a456-426614174000', code: '1 2 3', carrier: 'InPost', date: day}},
        {id: 'sold' + w, receivedAt: t(7), event: {type: 'sold', title, amount: 5.75, date: day}}]}};
      auDone.clear(); auSignature = '';
      window.__dbg = [!!account, isReadOnly(), !!document.getElementById('pipUpdates'), auBusy, JSON.stringify(auRank(title, auCandidates({type: 'sold', title, amount: 5.75}, db)).slice(0, 2).map(r => [r.item.id, r.score]))];
      const warn = console.warn; let warned = ''; console.warn = (...a) => { warned += a.map(String).join(' '); };
      await auRun();
      console.warn = warn; window.__dbg.push('warn:' + warned, 'sig:' + auSignature);
      document.getElementById('pipUpdates')?.remove();
      const now = db.items.find(i => i.id === item.id);
      return [now.status, now.shipTracking, !!now.shipQr, !!now.shipLabel].join('|') + ' dbg ' + window.__dbg.join(',');
    }, viewport.width);
    assert.match(out.split(' dbg ')[0], /^Sold\|JJD0002212128\d{6}\|true\|true$/, out);
  });
  await check('delete has undo, offline is explained', viewport, async page => {
    await go(page, 'Stock');
    const id = await page.evaluate(() => db.items.find(i => i.status === 'In Stock' && !i.deletedAt).id);
    await page.evaluate(id => { const d = document.getElementById('stockDeleteDialog'); d.dataset.stockId = id; d.showModal(); }, id);
    await page.click('#confirmStockDelete');
    await page.waitForSelector('.undo-toast.show button');
    await page.click('.undo-toast button');
    await page.waitForFunction(id => !db.items.find(i => i.id === id).deletedAt, id);
    await page.context().setOffline(true);
    await page.waitForSelector('#offlineBar');
    await page.context().setOffline(false);
    await page.waitForFunction(() => !document.getElementById('offlineBar'));
  });
  await check('add stock with taps only', viewport, async page => {
    await page.evaluate(() => openQuickAdd());
    const count = await page.evaluate(() => db.items.length);
    for (const sel of ['[data-qa-pick="brand"] [data-v="Nike"]', '[data-qa-pick="garment"] [data-v="Windbreaker"]', '[data-qa-pick="size"] [data-v="M"]', '[data-qa-pick="color"] [data-v="Black"]', '[data-qa-money="cost"] [data-v="8"]', '[data-qa-date] [data-d="1"]']) await page.click('#quickAdd ' + sel);
    await page.click('#qaSave');
    await page.waitForFunction(c => db.items.length === c + 1, count);
    const it = await page.evaluate(() => { const i = db.items.at(-1); return [i.name, i.cost, i.size].join('|'); });
    assert.equal(it, 'Black Nike Windbreaker|8|M');
  });
  await check('add stock: type freely, suggestions narrow down', viewport, async page => {
    await page.evaluate(() => openQuickAdd());
    await page.fill('#quickAdd [data-qa-pick="brand"] input', 'nik');
    const shown = await page.evaluate(() => [...document.querySelectorAll('#quickAdd [data-qa-pick="brand"] [data-v]')].filter(b => !b.hidden).map(b => b.dataset.v));
    assert.deepEqual(shown, ['Nike']);
    await page.fill('#quickAdd [data-qa-pick="brand"] input', 'Arc\'teryx');
    await page.fill('#quickAdd [data-qa-pick="garment"] input', 'Shell Jacket');
    await page.click('#quickAdd [data-qa-money="cost"] [data-v="12"]');
    const count = await page.evaluate(() => db.items.length);
    await page.click('#qaSave');
    await page.waitForFunction(c => db.items.length === c + 1, count);
    assert.equal(await page.evaluate(() => db.items.at(-1).name), "Arc'teryx Shell Jacket");
  });
  await check('mark as posted is one tap with undo', viewport, async page => {
    const id = await page.evaluate(() => { const item = db.items.find(i => i.status === 'In Stock' && !i.deletedAt); db = recordSale(db, item.id, 20, todayUK()); render(); return item.id; });
    await page.evaluate(id => { const b = document.createElement('button'); b.dataset.trade = 'post'; b.dataset.stockId = id; b.id = 'testPost'; document.body.append(b); }, id);
    await page.evaluate(() => document.getElementById('testPost').click());
    await page.waitForFunction(id => tradeStatus(lastTrade(db, id)) === 'Posted', id);
    assert.equal(await page.evaluate(() => !!document.getElementById('tradeDialog')?.open), false, 'no order form opened');
    await page.click('.undo-toast button');
    await page.waitForFunction(id => tradeStatus(lastTrade(db, id)) === 'Sold', id);
  });
  await check('24H chart: hourly, with touch details', viewport, async page => {
    const out = await page.evaluate(() => {
      const now = Date.now(), rows = [{kind: 'Sale', date: todayUK(), time: new Date(now - 5 * 36e5).toISOString(), revenue: 40, cost: 10}, {kind: 'Sale', date: '2001-01-01', time: '2001-01-01T10:00:00Z', revenue: 99, cost: 1}];
      const pts = mhSeries(rows, 1, todayUK(), now);
      const hit = pts.findIndex(p => p.rev === 40);
      return [pts.length, hit, pts.at(-1).v, pts[hit].n].join('|');
    });
    assert.equal(out, '24|18|40|1', out);
    if (viewport.width < 500) {
      await go(page, 'Dashboard');
    await page.evaluate(() => { if (startIsNew()) { const it = db.items.find(i => i.status === 'In Stock' && !i.deletedAt); db = recordSale(db, it.id, 20, todayUK()); render(); } });
      await page.evaluate(() => { mhRange = 1; rc.range = '24H'; render(); });
      assert.match(await page.textContent('.mh-range-note'), /Last 24 hours/);
      await page.locator('.mh-chart-wrap').scrollIntoViewIfNeeded();
      const box = await page.locator('.mh-chart-wrap').boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + 60); await page.mouse.down();
      await page.waitForSelector('.mh-tip:not([hidden])');
      assert.match(await page.textContent('.mh-tip'), /Revenue.*Profit.*Sales/s);
      await page.mouse.up();
      await page.evaluate(() => { mhRange = 30; rc.range = '1M'; render(); });
    } else {
      await page.evaluate(() => { rc.range = '24H'; render(); });
      assert.match(await page.textContent('.rc-eyebrow'), /Last 24 hours/);
      await page.evaluate(() => { rc.range = '1M'; render(); });
    }
  });
  if (viewport.width < 500) await check('phone and web Home numbers match for every range', viewport, async page => {
    await go(page, 'Dashboard');
    const out = await page.evaluate(() => {
      // An expense today must not make them disagree.
      db = {...db, expenses: [...db.expenses, ['Mailing bags', 4.5, 'Packaging', null, todayUK(), '']]};
      const res = [];
      for (const r of [1, 7, 30, 90]) {
        mhRange = r; rc.range = MH_TO_RC[r]; render();
        const phone = [...document.querySelectorAll('.mh-stat b')].slice(1).map(b => b.textContent);
        const t = rcModel(accountingRows(db), todayUK()).total;
        const web = [gbp(t.revenue), gbp(t.profit), String(t.sold)];
        res.push(r + ':' + (JSON.stringify(phone) === JSON.stringify(web) ? 'ok' : JSON.stringify({phone, web})));
      }
      mhRange = 30; rc.range = '1M'; render();
      return res.join(' ');
    });
    assert.equal(out, '1:ok 7:ok 30:ok 90:ok', out);
  });
  await check('admin and studio load on first open; hooks keep typing focus', viewport, async page => {
    // (The admin console preloads in the background for admins only; members never download it.)
    assert.equal(await page.evaluate(() => typeof studioView), 'undefined');
    await page.evaluate(() => { navigate('Studio'); render(); });
    await page.waitForFunction(() => typeof studioView === 'function' && !document.querySelector('.lazy-loading'));
    // A re-render while typing in a field keeps focus and cursor.
    const kept = await page.evaluate(() => {
      navigate('Stock'); render();
      const input = document.querySelector('#view input[type="search"], #view input[id]');
      if (!input || !input.id) return 'no-input';
      input.focus(); input.value = 'nike'; input.setSelectionRange(2, 2);
      render();
      const now = document.getElementById(input.id);
      return document.activeElement === now ? 'kept' : 'lost';
    });
    assert.ok(['kept', 'no-input'].includes(kept), kept);
  });
  await check('HMRC reporting counter and Home nudge', viewport, async page => {
    const out = await page.evaluate(() => {
      const saved = db, year = todayUK().slice(0, 4);
      db = {...db, sales: Array.from({length: 31}, (_, i) => ['Thing ' + i, 20, 0, 5, year + '-01-' + String(1 + (i % 28)).padStart(2, '0')])};
      const r = reportingStatus();
      navigate('Dashboard'); render();
      const nudge = document.querySelector('.hmrc-nudge')?.textContent || '';
      navigate('Reports'); render();
      const card = document.querySelector('.hmrc-card h2')?.textContent || '';
      db = saved; navigate('Dashboard'); render();
      return {sales: r.sales, reported: r.reported, nudge, card};
    });
    assert.ok(out.sales >= 31 && out.reported, JSON.stringify(out));
    assert.match(out.nudge, /report your \d{4} sales to HMRC/);
    assert.match(out.card, /HMRC platform reporting/);
  });
  await check('warns before the account gets full', viewport, async page => {
    const msgs = await page.evaluate(() => { const seen = []; const t = toast; toast = m => seen.push(m); storageWarning.shown = 0; storageWarning(0.5); storageWarning(0.8); storageWarning(0.81); storageWarning(0.93); toast = t; return seen; });
    assert.equal(msgs.length, 2);
    assert.match(msgs[0], /80% full/);
    assert.match(msgs[1], /93% full/);
  });
  await check('getting started never shows once you have sales; no change % on the chart', viewport, async page => {
    const out = await page.evaluate(() => {
      navigate('Dashboard'); render();
      if (startIsNew()) { const it = db.items.find(i => i.status === 'In Stock' && !i.deletedAt); db = recordSale(db, it.id, 20, todayUK()); }
      // Some steps still undone (no Gmail, items without photos) must not bring it back.
      render();
      return {card: !!document.querySelector('.start-card'), deltas: document.querySelectorAll('.mh-delta,.rc-delta').length};
    });
    assert.deepEqual(out, {card: false, deltas: 0});
  });
  await check('waiting animation and pull to refresh on any tab', viewport, async page => {
    const loader = await page.evaluate(() => { const box = document.createElement('div'); box.innerHTML = srWait(['A', 'B']); document.body.append(box);
      const ok = !!box.querySelector('.sr-wait-stage img') && box.querySelectorAll('.sr-wait-lines span').length === 2; box.remove();
      return ok && !document.querySelector('#view .lazy-loading p'); });
    assert.ok(loader);
    if (viewport.width > 500) return;   // pull to refresh is a touch gesture
    const spun = await page.evaluate(async () => {
      navigate('Stock'); render(); window.scrollTo(0, 0);
      const target = document.querySelector('#view h1, #view h2, #view') ;
      const touch = y => new Touch({identifier: 1, target, clientX: 180, clientY: y});
      window.dispatchEvent(new TouchEvent('touchstart', {touches: [touch(120)], bubbles: true}));
      target.dispatchEvent(new TouchEvent('touchstart', {touches: [touch(120)], bubbles: true}));
      window.dispatchEvent(new TouchEvent('touchmove', {touches: [touch(320)], bubbles: true}));
      window.dispatchEvent(new TouchEvent('touchend', {touches: [], bubbles: true}));
      const ptr = document.querySelector('.ptr');
      const spinning = ptr.classList.contains('spin');
      for (let i = 0; i < 50 && ptr.classList.contains('spin'); i++) await new Promise(r => setTimeout(r, 100));
      return {spinning, done: !ptr.classList.contains('spin')};
    });
    assert.deepEqual(spun, {spinning: true, done: true});
  });
  await check('chart range buttons morph the chart instead of rebuilding the screen', viewport, async page => {
    const out = await page.evaluate(async () => {
      navigate('Dashboard'); render();
      if (startIsNew()) { const it = db.items.find(i => i.status === 'In Stock' && !i.deletedAt); db = recordSale(db, it.id, 20, todayUK()); render(); }
      const phone = !!document.querySelector('#view .mh');
      const marker = phone ? document.querySelector('#view .mh') : document.querySelector('#financeChart .revenue-studio')?.parentElement?.parentElement || document.getElementById('view');
      const view = document.getElementById('view').firstElementChild;
      const btn = phone ? document.querySelector('[data-mh-range="7"]') : document.querySelector('[data-rc-range]:not([aria-pressed="true"])');
      btn.click();
      await new Promise(r => setTimeout(r, 700));
      return {
        sameScreen: document.getElementById('view').firstElementChild === view,
        pressed: btn.getAttribute('aria-pressed') === 'true' || btn.classList.contains('on') || !!btn.closest('[aria-pressed="true"]'),
        line: !!document.querySelector('.mh-line, .rc-line'),
        swapped: !!document.querySelector('.sr-swapped'),
      };
    });
    assert.equal(out.sameScreen, true, 'screen was rebuilt');
    assert.ok(out.line && out.swapped, JSON.stringify(out));
  });
  await check('email forwarding setup: choice, address, Gmail code', viewport, async page => {
    const out = await page.evaluate(async () => {
      const saved = personalGmail;
      tab = 'Vinted updates'; render();
      await new Promise(r => setTimeout(r, 300));   // let the screen's own Gmail load finish first
      personalGmail = {available: true, forwarding: true, url: location.origin, connection: null};
      renderGmail();
      const choice = [...document.querySelectorAll('.fwd-option b')].map(x => x.textContent);
      personalGmail = {available: true, forwarding: true, url: location.origin, connection: {mode: 'forward', address: 'k3j4h5g6f7d8s9a0@in.stockroom.test', filter: 'from:(no-reply@vinted.co.uk OR @evri.com)', confirm: {code: '738201934'}, state: 'waiting', receipts: [], alerts: true, enabled: true, days: 30}};
      renderGmail();
      const res = {choice, address: document.querySelector('.fwd-copy code')?.textContent, code: document.querySelector('.fwd-code b')?.textContent, overflow: document.documentElement.scrollWidth > innerWidth + 1};
      personalGmail = saved; navigate('Dashboard'); render();
      return res;
    });
    assert.deepEqual(out.choice.slice(0, 1), ['Forward my sale emails']);
    assert.equal(out.address, 'k3j4h5g6f7d8s9a0@in.stockroom.test');
    assert.equal(out.code, '738201934');
    assert.equal(out.overflow, false, 'page scrolls sideways');
  });
  await check('saves send changes only, queue offline, then sync', viewport, async page => {
    const bodies = [];
    page.on('request', r => { if (r.url().endsWith('/api/workspace') && ['PATCH', 'PUT'].includes(r.method())) bodies.push({m: r.method(), size: (r.postData() || '').length}); });
    // Online: one price change goes as a small PATCH.
    await page.evaluate(async () => { const next = cloneWorkspace(db); next.items[0] = {...next.items[0], price: (next.items[0].price || 10) + 1}; await persist(next); });
    assert.equal(bodies.at(-1).m, 'PATCH');
    assert.ok(bodies.at(-1).size < 5000, 'small save: ' + bodies.at(-1).size);
    // Offline: the edit is kept on the device and the status says so.
    await page.route('**/api/workspace', route => route.request().method() === 'GET' ? route.continue() : route.abort('internetdisconnected'));
    const offline = await page.evaluate(async () => { const next = cloneWorkspace(db); next.items[0] = {...next.items[0], price: next.items[0].price + 1}; await persist(next); return {status: document.getElementById('cloudStatus').textContent, waiting: !!pendingLocal, price: db.items[0].price}; });
    assert.match(offline.status, /Offline · 1 change waiting/);
    assert.ok(offline.waiting);
    // A second offline edit is allowed too, and counted.
    const two = await page.evaluate(async () => { const next = cloneWorkspace(db); next.items[1] = {...next.items[1], price: (next.items[1].price || 10) + 1}; await persist(next); return document.getElementById('cloudStatus').textContent; });
    assert.match(two, /2 changes waiting/);
    // Back online: everything syncs by itself.
    await page.unroute('**/api/workspace');
    const back = await page.evaluate(async () => { await wsFlush(); return {status: document.getElementById('cloudStatus').textContent, waiting: !!pendingLocal}; });
    assert.equal(back.waiting, false);
    assert.match(back.status, /Synced/);
  });
  await check('new seller: getting started, beginner mode, empty states', viewport, async page => {
    const out = await page.evaluate(() => {
      const saved = db; db = emptyData(); try { localStorage.removeItem(startKey()); localStorage.removeItem('sr-pro-tools:' + account.id); } catch {}
      navigate('Dashboard'); render();
      const card = !!document.querySelector('.start-card'), chartHidden = !document.querySelector('.mh-chart-wrap, .revenue-studio') || getComputedStyle(document.querySelector('.mh-chart-wrap, .revenue-studio')).display === 'none';
      const firstStep = document.querySelector('.start-steps li.current b')?.textContent;
      navigate('Stock'); render();
      const tabs = [...document.querySelectorAll('.subnav button')].map(b => b.textContent.trim()).join(',');
      const empty = document.querySelector('.stock-empty .action')?.textContent.trim();
      db = {...db, items: [{id: '0001', name: 'Grey Nike Hoodie', brand: 'Nike', cost: 5, price: null, status: 'In Stock', sale: null, refund: null}]};
      navigate('Dashboard'); render();
      const next = document.querySelector('.start-steps li.current b')?.textContent;
      db = saved; render();
      return [card, chartHidden, firstStep, tabs, empty, next].join('|');
    });
    assert.equal(out, 'true|true|Add your first item|Collection,Not selling|＋ Add your first item|Add photos', out);
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
    // Only this item awaits posting, so it's always on screen however many earlier tests ran.
    const lid = await page.evaluate(() => { const id = db.items.find(i => i.status === 'In Stock').id; let d = recordSale(db, id, 30, todayUK()); for (const t of d.trades) if (t.itemId !== id && !t.postedAt && tradeStatus(t) === 'Sold') t.postedAt = t.soldAt; d.items.find(i => i.id === id).shipLabel = '/favicon.svg'; db = d; render(); return id; });
    const show = '[data-label-show="' + lid + '"]';
    await page.click(show);
    await page.waitForSelector('.label-view .label-frame');
    await page.click('.label-view [data-label-close]');
    assert.equal(await page.$('.label-view'), null, 'label closes with its button');
    await page.click(show);
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
