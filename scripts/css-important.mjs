// Dev tool: removes `!important` from web/app.css wherever it can't change anything.
// An !important only matters when another rule (or a style set from JavaScript) gives the same element the same
// property. So for each one, on a set of real screens at phone and desktop width, we look for any competitor; if
// none exists anywhere, it goes. The result is then checked by comparing every element's computed style before/after.
//   node scripts/css-important.mjs          (report)      node scripts/css-important.mjs --write   (rewrite app.css)
import {spawn} from 'node:child_process';
import {readFileSync, writeFileSync} from 'node:fs';
import {chromium} from 'playwright-core';

const SRC = readFileSync('web/app.css', 'utf8');
const marks = [...SRC.matchAll(/\s*!important/g)].map(m => ({start: m.index, end: m.index + m[0].length}));
// Property each mark belongs to: text between the previous ; or { and the colon.
for (const m of marks) { const before = SRC.slice(0, m.start); const from = Math.max(before.lastIndexOf(';'), before.lastIndexOf('{')) + 1; m.prop = before.slice(from).split(':')[0].replace(/\/\*[\s\S]*?\*\//g, '').trim().toLowerCase(); }
// Tag every important declaration with a custom property so the page can tell which rule holds which mark.
let tagged = '', at = 0;
marks.forEach((m, i) => { tagged += SRC.slice(at, m.end) + ';--imp-' + i + ':1'; at = m.end; });
tagged += SRC.slice(at);
const variant = drop => { let out = '', a = 0; for (const i of [...drop].sort((x, y) => x - y)) { out += SRC.slice(a, marks[i].start); a = marks[i].end; } return out + SRC.slice(a); };

const PORT = 4260, BASE = 'http://localhost:' + PORT + '/';
const server = spawn(process.execPath, ['scripts/dev.mjs'], {env: {...process.env, PORT: String(PORT)}, stdio: 'ignore'});
const wait = ms => new Promise(r => setTimeout(r, ms));
for (let i = 0; i < 80; i++) { try { if ((await fetch(BASE)).ok) break; } catch {} await wait(100); }
const browser = await chromium.launch({executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox']});
const STATES = [
  "navigate('Dashboard');render()", "navigate('Stock');render()", "navigate('Activity');render()", "navigate('Expenses');render()",
  "navigate('Reports');render()", "navigate('Profile');render()", "navigate('Account');render()", "navigate('Repricing');render()",
  "navigate('Sourcing');render()", "navigate('Orders');render()", "navigate('Vinted updates');render()", "navigate('Studio');render()",
  "navigate('Stock');render();openQuickAdd()", "navigate('Stock');render();openItem(db.items[0])", "navigate('Stock');render();openItem(db.items[0],'listing')",
  "navigate('Dashboard');render();openUpgrade&&openUpgrade('x')", "navigate('Dashboard');render();openScan&&openScan()", "navigate('Dashboard');render();openTour&&openTour()",
];
const pages = [];
for (const vp of [{width: 390, height: 844, mobile: true}, {width: 1440, height: 900}]) {
  const ctx = await browser.newContext({viewport: {width: vp.width, height: vp.height}, isMobile: !!vp.mobile, hasTouch: !!vp.mobile, reducedMotion: 'reduce'});
  const page = await ctx.newPage();
  await page.goto(BASE, {waitUntil: 'networkidle'});
  await page.waitForFunction(() => typeof db !== 'undefined' && db && document.querySelector('#view').children.length);
  await page.evaluate(() => { document.querySelector('.tour')?.remove(); const link = [...document.querySelectorAll('link[rel=stylesheet]')].find(l => /app\.css/.test(l.href)); const st = document.createElement('style'); st.id = 'cssUnderTest'; link.after(st); link.remove();
    const freeze = document.createElement('style'); freeze.textContent = '*,*::before,*::after{transition:none!important;animation:none!important}'; document.head.appendChild(freeze); });
  await page.evaluate(props => { window.__markProps = props; }, marks.map(m => m.prop));
  pages.push(page);
}
// 1) Which marks have a competitor on some element, in some state?
const needed = new Set(), seenAny = new Set();
for (const page of pages) {
  const found = await page.evaluate(({css, states}) => {
    document.getElementById('cssUnderTest').textContent = css;
    const SHORT = ['margin','padding','border','background','font','flex','grid','overflow','inset','gap','place','transition','animation','outline','text-decoration','list-style','columns','mask','scroll-margin','scroll-padding','border-radius'];
    const fam = p => { if (p.startsWith('--')) return p; if (['top','right','bottom','left'].includes(p)) return 'inset'; if (['row-gap','column-gap'].includes(p)) return 'gap'; if (p.startsWith('border-') && p.endsWith('radius')) return 'border-radius'; const s = SHORT.find(x => p === x || p.startsWith(x + '-')); return s || p; };
    const sheets = [...document.styleSheets];
    const rules = [];
    const walk = (list, ok) => { for (const r of list) { if (r instanceof CSSStyleRule) rules.push({r, ok}); else if (r instanceof CSSMediaRule) walk(r.cssRules, ok && matchMedia(r.conditionText).matches); else if (r.cssRules && !(r instanceof CSSKeyframesRule)) walk(r.cssRules, ok); } };
    for (const s of sheets) { try { walk(s.cssRules, true); } catch {} }
    const need = new Set(), seen = new Set();
    for (const st of states) {
      document.querySelectorAll('dialog[open]').forEach(d => d.close());
      try { (0, eval)(st); } catch {}
      // element(+pseudo) → family → number of rules setting it
      const counts = new Map(), imp = [];
      for (const {r, ok} of rules) {
        if (!ok) continue;
        const pseudo = (r.selectorText.match(/::?(before|after|placeholder|marker|backdrop|selection|-webkit-[a-z-]+)\b/g) || []).join('');
        const base = r.selectorText.replace(/::?(before|after|placeholder|marker|backdrop|selection|-webkit-[a-z-]+)\b/g, '');
        // Hover/focus/active rules can't be seen in a still page, so they count as competitors wherever they could apply.
        const loose = base.replace(/:(hover|focus|focus-visible|focus-within|active|visited)\b/g, '');
        let els; try { els = document.querySelectorAll(loose || '*'); } catch { continue; }
        const dynamic = loose !== base;
        if (!els.length) continue;
        const fams = new Set(), mine = [];
        for (let i = 0; i < r.style.length; i++) { const p = r.style[i]; if (p.startsWith('--imp-')) mine.push(Number(p.slice(6))); else fams.add(fam(p)); }
        for (const el of els) { let m = counts.get(el); if (!m) counts.set(el, m = new Map()); for (const f of fams) { const k = pseudo + '|' + f; m.set(k, (m.get(k) || 0) + 1); } }
        if (mine.length && !dynamic) imp.push({els, pseudo, mine, r});
        else if (mine.length) mine.forEach(n => need.add(n));
      }
      for (const {els, pseudo, mine, r} of imp) for (const n of mine) {
        seen.add(n);
        if (!window.__markProps[n]) need.add(n);
        if (need.has(n)) continue;
        // Which family does mark n belong to? The rule's property set right before the tag in source order.
        const f = fam(window.__markProps[n]);
        for (const el of els) { if ((counts.get(el)?.get(pseudo + '|' + f) || 0) >= 2 || (!pseudo && el.style && [...el.style].some(p => fam(p) === f))) { need.add(n); break; } }
      }
    }
    return {need: [...need], seen: [...seen]};
  }, {css: tagged, states: STATES});
  found.need.forEach(n => needed.add(n));
  found.seen.forEach(n => seenAny.add(n));
}
// Only marks whose rule actually matched something were tested; the rest (hover states, print, unseen screens) stay.
console.log('step 1 done', new Date().toISOString());
let removable = marks.map((_, i) => i).filter(i => seenAny.has(i) && !needed.has(i));
const CAND = removable;
for (const page of pages) await page.evaluate(t => { window.__tagged = t; }, tagged);
console.log(marks.length, '!important;', seenAny.size, 'tested;', needed.size, 'have a competitor;', removable.length, 'look removable');
// 2) Prove it: every element's computed style must be identical with and without them.
const PROPS = ['display','position','top','right','bottom','left','width','height','min-width','max-width','min-height','max-height','margin-top','margin-right','margin-bottom','margin-left',
  'padding-top','padding-right','padding-bottom','padding-left','color','background-color','background-image','font-size','font-weight','line-height','letter-spacing','text-align','text-transform',
  'border-top-width','border-top-color','border-bottom-width','border-left-width','border-right-width','border-radius','box-shadow','opacity','visibility','z-index','overflow-x','overflow-y',
  'flex-direction','flex-wrap','flex-grow','flex-shrink','flex-basis','justify-content','align-items','gap','grid-template-columns','grid-column','transform','white-space','order','cursor','pointer-events','content'];
async function snapshot(css) {
  const out = [];
  for (const page of pages) out.push(await page.evaluate(({css, states, props, cand}) => {
    document.getElementById('cssUnderTest').textContent = css;
    // Selectors of the rules holding candidate marks: only their elements can change (children only inherit).
    if (!window.__candSel) {
      const tagged = document.createElement('style'); tagged.textContent = window.__tagged; document.head.appendChild(tagged);
      const sels = new Set(), walk = list => { for (const r of list) { if (r instanceof CSSStyleRule) { for (let i = 0; i < r.style.length; i++) { const p = r.style[i]; if (p.startsWith('--imp-') && cand.includes(Number(p.slice(6)))) { sels.add(r.selectorText.replace(/::?(before|after|placeholder|marker|backdrop|selection|-webkit-[a-z-]+)\b/g, '').replace(/:(hover|focus|focus-visible|focus-within|active|visited)\b/g, '') || '*'); break; } } } else if (r.cssRules) walk(r.cssRules); } };
      walk(tagged.sheet.cssRules); tagged.remove(); window.__candSel = [...sels];
    }
    const parts = [];
    for (const s of states) {
      document.querySelectorAll('dialog[open]').forEach(d => d.close());
      try { (0, eval)(s); } catch {}
      const els = new Set();
      for (const sel of window.__candSel) { try { document.querySelectorAll(sel).forEach(e => els.add(e)); } catch {} }
      for (const el of els) {
        if (el.closest('.island,#toast,.toast,.mh-tip')) continue;
        for (const pseudo of [null, '::before', '::after']) { const c = getComputedStyle(el, pseudo); let h = el.tagName + (pseudo || ''); for (let k = 0; k < c.length; k++) h += '|' + c[k] + ':' + c.getPropertyValue(c[k]); parts.push(h); }
      }
    }
    return parts;
  }, {css, states: STATES, props: PROPS, cand: CAND}));
  return out;
}
await snapshot(SRC); await snapshot(SRC); console.log('warm', new Date().toISOString());
const base = await snapshot(SRC);
const same = async drop => { const v = await snapshot(variant(drop)); return v.every((parts, i) => parts.length === base[i].length && parts.every((p, j) => p === base[i][j])); };
if (!(await same(removable))) {
  console.log('Combined removal changed something; narrowing down…');
  const keep = [];
  const bisect = async ids => { if (!ids.length) return; if (await same(ids.filter(Boolean).concat([]))) return; if (ids.length === 1) { keep.push(ids[0]); return; } const mid = ids.length >> 1; await bisect(ids.slice(0, mid)); await bisect(ids.slice(mid)); };
  await bisect(removable);
  removable = removable.filter(i => !keep.includes(i));
  console.log('kept', keep.length, 'more after checking');
  if (!(await same(removable))) { console.log('Still differs; not writing.'); removable = []; }
}
console.log('removable', removable.length, 'of', marks.length);
if (removable.length) { writeFileSync('/tmp/css-important-plan.json', JSON.stringify({prefix: SRC, drop: removable})); console.log('plan saved'); }
if (removable.length && process.argv.includes('--write')) { writeFileSync('web/app.css', variant(removable)); console.log('web/app.css rewritten'); }
await browser.close(); server.kill();
