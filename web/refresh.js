'use strict';
// Pull down at the top of Home to refresh: new app version, Vinted emails, cloud data.

(() => {
  const indicator = document.createElement('div');
  indicator.className = 'ptr';
  indicator.setAttribute('aria-hidden', 'true');
  indicator.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36M21 4v5h-5"/></svg>';
  document.body.append(indicator);

  const THRESHOLD = 70;
  let startY = null, pull = 0, refreshing = false;

  const place = (distance, opacity) => {
    indicator.style.transform = 'translateY(' + distance + 'px) rotate(' + distance * 3 + 'deg)';
    indicator.style.opacity = String(opacity);
  };
  const reset = () => {
    indicator.style.transition = 'transform .25s ease, opacity .25s ease';
    place(-50, 0);
    indicator.classList.remove('ready', 'spin');
    setTimeout(() => { indicator.style.transition = ''; }, 260);
  };
  const eligible = () => typeof tab !== 'undefined' && tab === 'Dashboard' && !refreshing && window.scrollY <= 0 &&
    !document.querySelector('dialog[open]') && db && account;

  async function refreshNow() {
    refreshing = true;
    indicator.classList.add('spin');
    const top = 'calc(env(safe-area-inset-top, 0px) + 14px)';
    indicator.style.transition = 'transform .2s ease';
    indicator.style.transform = 'translateY(' + top + ')';
    try {
      const response = await fetch('/version.json', {cache: 'no-store'}).catch(() => null);
      const latest = response?.ok ? (await response.json()).version : '';
      if (latest && typeof loadedVersion !== 'undefined' && loadedVersion && latest !== loadedVersion) { location.reload(); return; }
      const gmail = typeof personalGmail !== 'undefined' ? personalGmail?.connection : null;
      const jobs = [syncCloud(true)];
      if (gmail?.enabled && gmail.state !== 'reconnect') jobs.push(changeGmail('/api/gmail/check', {method: 'POST'}, true));
      await Promise.allSettled(jobs);
      await Promise.allSettled([refreshImports()]);
      render();
      toast('Up to date');
    } finally {
      refreshing = false;
      reset();
    }
  }

  window.addEventListener('touchstart', event => {
    startY = eligible() && event.touches.length === 1 ? event.touches[0].clientY : null;
    pull = 0;
  }, {passive: true});
  window.addEventListener('touchmove', event => {
    if (startY === null) return;
    const dy = event.touches[0].clientY - startY;
    if (dy <= 0 || window.scrollY > 0) { pull = 0; place(-50, 0); return; }
    pull = Math.min(110, dy * 0.55);
    place(pull - 40, Math.min(1, pull / THRESHOLD));
    indicator.classList.toggle('ready', pull >= THRESHOLD);
  }, {passive: true});
  window.addEventListener('touchend', () => {
    if (startY === null) return;
    startY = null;
    if (pull >= THRESHOLD) void refreshNow(); else reset();
    pull = 0;
  }, {passive: true});
})();
