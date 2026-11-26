'use strict';

// Extension points. Features add a step here (onHook('afterRender', fn)) instead of wrapping each other's
// functions. Steps run in load order, and one failing step can't stop the others: its error is reported separately.
const srHooks = {};
// Rebuilding a screen keeps the field you were typing in focused, with the cursor where it was.
let srFocus = null;
onHook('beforeRender', () => {
  const a = document.activeElement;
  srFocus = a && a.id && a.matches('input,textarea,select') && a.closest('#view') ? {id: a.id, s: a.selectionStart, e: a.selectionEnd} : null;
});
onHook('afterRender', () => {
  if (!srFocus) return;
  const el = document.getElementById(srFocus.id);
  if (el && el !== document.activeElement && el.closest('#view')) { el.focus({preventScroll: true}); try { el.setSelectionRange(srFocus.s, srFocus.e); } catch {} }
  srFocus = null;
});
// Inside the App Store / Play Store app (Capacitor). Google sign-in can't run inside an app's web view, so it opens
// in the phone's browser; store rules mean plans aren't sold inside the app.
const isNativeApp = () => !!window.Capacitor?.isNativePlatform?.();
function openExternal(url) {
  const browser = window.Capacitor?.Plugins?.Browser;
  if (isNativeApp() && browser) return browser.open({url});
  location.assign(url);
}
// Smooth chart changes. Instead of rebuilding a chart (which flashes and replays the draw-in), the line morphs from
// its old shape into the new one, the shaded area fades across, and headline numbers count to their new values.
const srCalm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
function srSample(path, n = 90) {
  try { const len = path.getTotalLength(); if (!(len > 0)) return null; const out = []; for (let i = 0; i < n; i++) { const p = path.getPointAtLength(len * i / (n - 1)); out.push([p.x, p.y]); } return out; } catch { return null; }
}
const srEase = t => 1 - Math.pow(1 - t, 3);
// host: element whose inner HTML is replaced. line/area: selectors inside it. numbers: selectors whose text counts up.
function srSwap(host, html, {line, area, numbers = [], ms = 520} = {}) {
  if (!host) return;
  const oldLine = line && host.querySelector(line), from = oldLine && srSample(oldLine);
  const oldNums = numbers.map(sel => [...host.querySelectorAll(sel)].map(el => el.textContent));
  host.innerHTML = html;
  host.classList.add('sr-swapped');   // no draw-in animation on a swap
  if (srCalm()) return;
  numbers.forEach((sel, k) => host.querySelectorAll(sel).forEach((el, i) => srCountTo(el, oldNums[k][i], el.textContent, ms)));
  const newLine = line && host.querySelector(line), to = newLine && srSample(newLine);
  // The shading is already its final shape, so it waits for the line to land, then fades in under it.
  host.querySelectorAll(area || '.sr-none').forEach(el => el.animate([{opacity: 0}, {opacity: 0, offset: .6}, {opacity: 1}], {duration: ms * 1.5, easing: 'ease-out'}));
  host.querySelectorAll('text').forEach(el => el.animate([{opacity: 0}, {opacity: 1}], {duration: ms * .8, easing: 'ease-out'}));
  if (!from || !to) { newLine?.animate([{opacity: 0}, {opacity: 1}], {duration: ms}); return; }
  const finalD = newLine.getAttribute('d'), start = performance.now();
  const step = now => {
    const t = Math.min(1, (now - start) / ms), e = srEase(t);
    if (t >= 1) { newLine.setAttribute('d', finalD); return; }
    newLine.setAttribute('d', to.map(([x, y], i) => (i ? 'L' : 'M') + (from[i][0] + (x - from[i][0]) * e).toFixed(1) + ' ' + (from[i][1] + (y - from[i][1]) * e).toFixed(1)).join(''));
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
// "£1,234.50" → "£2,010.00": counts between the two, keeping the format (prefix, decimals, thousands commas).
function srCountTo(el, fromText, toText, ms = 520) {
  const num = s => { const m = String(s || '').match(/-?[\d,]*\.?\d+/); return m ? Number(m[0].replace(/,/g, '')) : null; };
  const a = num(fromText), b = num(toText);
  if (a === null || b === null || a === b || srCalm()) return;
  const m = toText.match(/-?[\d,]*\.?\d+/), pre = toText.slice(0, m.index), post = toText.slice(m.index + m[0].length);
  const decimals = (m[0].split('.')[1] || '').length, commas = m[0].includes(',');
  const fmt = v => pre + (commas ? v.toLocaleString('en-GB', {minimumFractionDigits: decimals, maximumFractionDigits: decimals}) : v.toFixed(decimals)) + post;
  const start = performance.now();
  const step = now => { const t = Math.min(1, (now - start) / ms); el.textContent = t >= 1 ? toText : fmt(a + (b - a) * srEase(t)); if (t < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
// Rarely used screens (admin console, photo studio) load the first time they're opened, not on every launch.
const srLoaded = {};
function loadScript(src) {
  return srLoaded[src] ||= new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src; el.onload = resolve;
    el.onerror = () => { delete srLoaded[src]; el.remove(); reject(Error('Couldn’t load that screen. Check your connection and try again.')); };
    document.head.appendChild(el);
  });
}
// The waiting animation. lines: one label, or several that take turns. ghost: faint rows of the screen to come.
function srWait(lines = 'Getting it ready…', {small = false, ghost = true} = {}) {
  const list = (Array.isArray(lines) ? lines : [lines]).slice(0, 3).map(l => '<span>' + String(l).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c])) + '</span>').join('');
  return '<div class="sr-wait' + (small ? ' small' : '') + '" role="status" aria-busy="true"><div class="sr-wait-stage"><span class="sr-wait-ring"></span><span class="sr-wait-shadow"></span>' +
    '<i class="sr-wait-spark"></i><i class="sr-wait-spark"></i><i class="sr-wait-spark"></i><img src="/pip-orb.svg" alt=""></div>' +
    '<div class="sr-wait-lines' + (Array.isArray(lines) && lines.length > 1 ? '' : ' one') + '">' + list + '</div>' +
    (ghost ? '<div class="sr-wait-ghost" aria-hidden="true"><i></i><i></i><i></i></div>' : '') + '</div>';
}
function lazyViewHtml(src) {
  loadScript(src).then(() => render(), error => toast(error.message));
  return '<section class="panel lazy-loading">' + srWait(['Opening it up…', 'Nearly there…', 'Just a second…']) + '</section>';
}
function onHook(name, fn) { (srHooks[name] ||= []).push(fn); }
function runHooks(name, ...args) {
  for (const fn of srHooks[name] || []) { try { fn(...args); } catch (error) { setTimeout(() => { throw error; }); } }
}

// Workspace data is JSON. Older WebViews can use the same data model without native cloning.
function cloneWorkspace(value) {
  return typeof structuredClone==='function'?structuredClone(value):JSON.parse(JSON.stringify(value));
}
if(typeof HTMLDialogElement==='undefined'||typeof HTMLDialogElement.prototype.showModal!=='function'){
  document.documentElement.classList.add('dialog-fallback');
  for(const dialog of document.querySelectorAll('dialog'))window.dialogPolyfill.registerDialog(dialog);
}
