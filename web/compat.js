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
function lazyViewHtml(src) {
  loadScript(src).then(() => render(), error => toast(error.message));
  return '<section class="panel lazy-loading" aria-busy="true"><p>Loading…</p></section>';
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
