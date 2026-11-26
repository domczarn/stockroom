// Dev tool: removes `!important` from web/app.css wherever it provably changes nothing.
// For each candidate set it swaps the stylesheet in a live page and compares the computed styles of every element
// on a set of screens, at phone and desktop width. Kept only where removing it changes what you see.
//   node scripts/css-important.mjs            (dry run: prints the count)
//   node scripts/css-important.mjs --write    (rewrites web/app.css)
import {spawn} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import {chromium} from 'playwright-core';

if (process.argv.includes('--apply')) {
  const plan = JSON.parse(readFileSync('/tmp/css-important-plan.json', 'utf8')), now = readFileSync('web/app.css', 'utf8');
  if (!now.startsWith(plan.prefix)) { console.log('app.css changed inside the tested part; run the analysis again.'); process.exit(1); }
  const ms = [...plan.prefix.matchAll(/\s*!important/g)].map(m => ({start: m.index, end: m.index + m[0].length}));
  let out = '', at = 0; for (const i of plan.drop.sort((a, b) => a - b)) { out += plan.prefix.slice(at, ms[i].start); at = ms[i].end; }
  writeFileSync('web/app.css', out + plan.prefix.slice(at) + now.slice(plan.prefix.length));
  console.log('removed', plan.drop.length, 'of', ms.length); process.exit(0);
}
const SRC = readFileSync('web/app.css', 'utf8');
const marks = [...SRC.matchAll(/\s*!important/g)].map(m => ({start: m.index, end: m.index + m[0].length}));
const variant = drop => { let out = '', at = 0; for (const i of [...drop].sort((a, b) => a - b)) { out += SRC.slice(at, marks[i].start); at = marks[i].end; } return out + SRC.slice(at); };

const PORT = 4240, BASE = 'http://localhost:' + PORT + '/';
const server = spawn(process.execPath, ['scripts/dev.mjs'], {env: {...process.env, PORT: String(PORT)}, stdio: 'ignore'});
const wait = ms => new Promise(r => setTimeout(r, ms));
for (let i = 0; i < 80; i++) { try { if ((await fetch(BASE)).ok) break; } catch {} await wait(100); }
const browser = await chromium.launch({executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox']});

const STATES = [
  "navigate('Dashboard');render()", "navigate('Stock');render()", "navigate('Activity');render()", "navigate('Expenses');render()",
  "navigate('Reports');render()", "navigate('Profile');render()", "navigate('Account');render()", "navigate('Repricing');render()",
  "navigate('Vinted updates');render()", "navigate('Stock');render();openQuickAdd()", "navigate('Stock');render();openItem(db.items[0])",
  "navigate('Dashboard');render();openUpgrade&&openUpgrade('x')",
];
const PROPS = ['display','position','top','right','bottom','left','width','height','min-width','max-width','min-height','max-height','margin-top','margin-right','margin-bottom','margin-left',
  'padding-top','padding-right','padding-bottom','padding-left','color','background-color','background-image','font-size','font-weight','line-height','letter-spacing','text-align','text-transform',
  'border-top-width','border-top-color','border-bottom-width','border-left-width','border-right-width','border-radius','box-shadow','opacity','visibility','z-index','overflow-x','overflow-y',
  'flex-direction','flex-wrap','flex-grow','flex-shrink','flex-basis','justify-content','align-items','gap','grid-template-columns','grid-column','transform','white-space','gap','order','inset'];
const pages = [];
for (const vp of [{width: 390, height: 844, isMobile: true, hasTouch: true}, {width: 1440, height: 900}]) {
  const ctx = await browser.newContext({viewport: {width: vp.width, height: vp.height}, isMobile: !!vp.isMobile, hasTouch: !!vp.hasTouch, reducedMotion: 'reduce'});
  const page = await ctx.newPage();
  await page.goto(BASE, {waitUntil: 'networkidle'});
  await page.waitForFunction(() => typeof db !== 'undefined' && db && document.querySelector('#view').children.length);
  await page.evaluate(() => { document.querySelector('.tour')?.remove(); const link = [...document.querySelectorAll('link[rel=stylesheet]')].find(l => /app\.css/.test(l.href)); const st = document.createElement('style'); st.id = 'cssUnderTest'; link.after(st); link.remove(); const freeze = document.createElement('style'); freeze.textContent = '*,*::before,*::after{transition:none!important;animation:none!important}'; document.head.appendChild(freeze); });
  pages.push(page);
}
async function snapshot(css) {
  const out = [];
  for (const page of pages) out.push(await page.evaluate(({css, states, props}) => {
    document.getElementById('cssUnderTest').textContent = css;
    const parts = [];
    for (const s of states) {
      document.querySelectorAll('dialog[open]').forEach(d => d.close());
      try { (0, eval)(s); } catch {}
      for (const el of document.querySelectorAll('body *')) {
        if (el.closest('script,style,svg,.island,#toast,.toast,.mh-tip')) continue;
        const c = getComputedStyle(el); let h = el.tagName;
        for (const p of props) h += '|' + c.getPropertyValue(p);
        parts.push(h);
      }
    }
    if (window.__debugParts) { const prev = window.__debugParts; window.__debugParts = parts; return 'DBG' + parts.map((p, i) => p !== prev[i] ? i + ' ' + p.slice(0, 200) + ' VS ' + (prev[i] || '').slice(0, 200) : '').filter(Boolean).slice(0, 6).join('\n'); }
    // cheap hash to keep memory small
    let x = 0; const str = parts.join('\n'); for (let i = 0; i < str.length; i++) x = (Math.imul(x, 31) + str.charCodeAt(i)) | 0;
    return x + ':' + parts.length;
  }, {css, states: STATES, props: PROPS}));
  return out.join(',');
}
await snapshot(SRC); await snapshot(SRC);   // warm up: first opens create sheets and load lazy screens
const t0 = Date.now();
const baseline = await snapshot(SRC);
console.log('baseline in', Date.now() - t0, 'ms;', marks.length, '!important');
// Check stability (same CSS twice must give the same snapshot).
if (process.argv.includes('--debug')) { for (const p of pages) await p.evaluate(() => { window.__debugParts = []; }); await snapshot(SRC); console.log(await snapshot(SRC)); process.exit(0); }
if (await snapshot(SRC) !== baseline) { console.log('Snapshots are not stable; aborting.'); process.exit(1); }
const removable = new Set();
let tests = 0;
async function tryRemove(ids) {
  if (!ids.length) return;
  tests++;
  if (await snapshot(variant(new Set([...removable, ...ids]))) === baseline) { ids.forEach(i => removable.add(i)); return; }
  if (ids.length === 1) return;
  const mid = ids.length >> 1;
  await tryRemove(ids.slice(0, mid)); await tryRemove(ids.slice(mid));
}
const all = marks.map((_, i) => i);
for (let i = 0; i < all.length; i += 64) { await tryRemove(all.slice(i, i + 64)); process.stdout.write('.'); }
console.log('\nremovable', removable.size, 'of', marks.length, 'in', tests, 'tests,', Math.round((Date.now() - t0) / 1000), 's');
// Final check of the combined result.
if (await snapshot(variant(removable)) !== baseline) { console.log('Combined result differs; not writing.'); }
else {
  // Saved as a plan so app.css can keep changing while this runs: --apply later only touches the part that was tested.
  writeFileSync('/tmp/css-important-plan.json', JSON.stringify({prefix: SRC, drop: [...removable]}));
  console.log('plan saved to /tmp/css-important-plan.json');
}
await browser.close(); server.kill();
