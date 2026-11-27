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

// One line-icon set for the whole app (same weight as the nav icons), instead of emoji.
const UI_ICON_PATHS = {
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="m20.5 16-4.5-4.5L7 19.5"/>',
  package: '<path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5z"/><path d="m3.5 7.5 8.5 4.5 8.5-4.5M12 12v9"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  tag: '<path d="M3.5 12.5V4.5h8l9 9-8 8z"/><circle cx="8" cy="9" r="1.4"/>',
  megaphone: '<path d="M4 10v4h3l8 5V5L7 10z"/><path d="M18 9.5a3.5 3.5 0 0 1 0 5"/>',
  truck: '<path d="M3 6h11v10H3zM14 9.5h4l3 3.5v3h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
  mail: '<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="m3.5 7 8.5 6 8.5-6"/>',
  ruler: '<path d="m3 16.5 13.5-13.5 4.5 4.5L7.5 21z"/><path d="m7 12.5 2 2M10 9.5l2 2M13 6.5l2 2"/>',
  pen: '<path d="M4 20h4L19.5 8.5a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m14 6 4 4"/>',
  chat: '<path d="M4 5.5h16v10H9l-5 4z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
};
function uiIcon(name, size = 18) {
  return '<svg class="ui-icon" viewBox="0 0 24 24" width="' + size + '" height="' + size + '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (UI_ICON_PATHS[name] || '') + '</svg>';
}
