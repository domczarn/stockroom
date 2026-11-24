'use strict';
// Back that always works. The phone's back button/gesture (and the ‹ in the header) closes whatever is on top
// (label, QR, sheet, dialog), then steps back through the screens you visited.
const NAV_ROOTS = ['Dashboard', 'Stock', 'Activity', 'Profile'];
const navPhone = () => matchMedia('(max-width: 800px)').matches;
let navFromHistory = false, navDepth = 0, navLayerSeq = 0, navSkipPop = 0;
const navQueued = [];

function navPushLayer(el, extra = {}) {
  if (!el) return;
  if (navSkipPop) { navQueued.push([el, extra]); return; } // wait until the old entry is gone
  el._navLayer = ++navLayerSeq;
  try { history.pushState({sr: 'layer', id: el._navLayer, tab, ...extra}, ''); navDepth++; } catch {}
}
// A layer closed by its own button: drop its history entry so the next back goes where you expect.
function navLayerClosed(el) {
  if (el?._navLayer && history.state?.sr === 'layer' && history.state.id === el._navLayer) { el._navLayer = 0; navSkipPop++; history.back(); }
}
function navTopLayer() {
  return document.querySelector('.row-sheet') || document.querySelector('.label-view') || document.querySelector('.qr-view') ||
    [...document.querySelectorAll('dialog[open]')].at(-1) || document.querySelector('.tour.open, #pipUpdates') ||
    (document.getElementById('accountMenu')?.open ? document.getElementById('accountMenu') : null);
}
function navCloseLayer(layer) {
  layer._navLayer = 0;
  if (layer.classList.contains('row-sheet')) closeRowSheet(true);
  else if (layer.classList.contains('label-view')) closeLabel();
  else if (layer.classList.contains('qr-view')) closeQr();
  else if (layer.tagName === 'DIALOG') { if (typeof requestClose === 'function') requestClose(layer); else layer.close(); }
  else if (layer.id === 'accountMenu') layer.open = false;
  else (layer.querySelector('[data-pu-close], [data-tour-skip], [aria-label="Close"]') || {click: () => layer.remove()}).click();
}

// Every sheet and dialog gets a history entry when it opens.
(() => {
  const show = HTMLDialogElement.prototype.showModal;
  HTMLDialogElement.prototype.showModal = function (...args) {
    const wasOpen = this.open;
    const out = show.apply(this, args);
    if (!wasOpen) navPushLayer(this);
    return out;
  };
  document.addEventListener('close', event => { if (event.target.tagName === 'DIALOG') navLayerClosed(event.target); }, true);
})();
if (typeof showQr === 'function') {
  const baseShowQr = showQr, baseCloseQr = closeQr;
  showQr = function (...args) {
    baseShowQr.apply(this, args);
    const el = document.querySelector('.qr-view:not(.label-view)');
    if (!el) return;
    // Stepping between parcels reuses the same history entry.
    if (history.state?.sr === 'layer' && history.state.qr && !navSkipPop) el._navLayer = history.state.id;
    else navPushLayer(el, {qr: true});
  };
  closeQr = function (...args) { const el = document.querySelector('.qr-view'); baseCloseQr.apply(this, args); navLayerClosed(el); };
}

// Screens: each tab change is a history step.
if (typeof navigate === 'function') {
  const baseNavigate = navigate;
  navigate = function (next, ...rest) {
    const before = tab;
    baseNavigate.call(this, next, ...rest);
    if (tab !== before && !navFromHistory) { try { history.pushState({sr: 'tab', tab}, ''); navDepth++; } catch {} }
  };
}
addEventListener('popstate', event => {
  navDepth = Math.max(0, navDepth - 1);
  if (navSkipPop) {
    navSkipPop--;
    if (!navSkipPop) navQueued.splice(0).forEach(([el, extra]) => { if (el.isConnected && (el.open !== false)) navPushLayer(el, extra); });
    return;
  }
  const layer = navTopLayer();
  if (layer) { navCloseLayer(layer); return; }
  const target = event.state?.tab || 'Dashboard';
  if (target !== tab) { navFromHistory = true; try { navigate(target); } finally { navFromHistory = false; } }
});
try { if (!history.state?.sr) history.replaceState({sr: 'tab', tab: typeof tab === 'string' ? tab : 'Dashboard'}, ''); } catch {}

function navBack() {
  if (navDepth > 0) { history.back(); return; }
  const parents = {Account: 'Profile', Leaderboard: 'Profile', Admin: 'Profile', 'Customer care': 'Profile', 'Vinted updates': 'Profile', 'Sale receipts': 'Profile'};
  navigate(parents[tab] || (typeof lastMainTab === 'string' ? lastMainTab : 'Dashboard'));
}

// ---------- Shipping label viewer (in-app, with a way out) ----------
function showLabel(id) {
  const item = db.items.find(i => i.id === id);
  if (!item?.shipLabel) return;
  closeLabel(true);
  const el = document.createElement('div');
  el.className = 'qr-view label-view open';
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Shipping label for ' + item.name);
  el.innerHTML = '<div class="qr-top"><button type="button" class="qr-close" data-label-close aria-label="Close label">‹</button>' +
    '<span class="label-title">Shipping label</span><button type="button" class="qr-close" data-label-close aria-label="Close">×</button></div>' +
    '<div class="qr-item"><b>' + esc(item.name) + '</b><small>' + esc([item.shipCarrier, item.shipTracking].filter(Boolean).join(' · ')) + '</small></div>' +
    '<iframe class="label-frame" src="' + esc(item.shipLabel) + '#toolbar=0&view=FitH" title="Shipping label"></iframe>' +
    (lastTrade(db, id) && tradeStatus(lastTrade(db, id)) === 'Sold' ? '<div class="qr-actions"><button type="button" class="qr-posted" data-trade="post" data-stock-id="' + esc(item.id) + '">Mark as posted</button></div>' : '');
  el.dataset.id = id;
  document.body.appendChild(el);
  document.body.classList.add('qr-open');
  navPushLayer(el);
  el.querySelector('[data-label-close]').focus();
}
function closeLabel(silent) {
  const el = document.querySelector('.label-view');
  if (!el) return;
  el.remove();
  if (!document.querySelector('.qr-view')) document.body.classList.remove('qr-open');
  if (!silent) navLayerClosed(el);
}
document.addEventListener('click', event => {
  const show = event.target.closest('[data-label-show]');
  if (show) { event.preventDefault(); showLabel(show.dataset.labelShow); return; }
  if (event.target.closest('[data-label-close]')) { closeLabel(); return; }
  if (event.target.closest('.label-view [data-trade="post"]')) setTimeout(() => closeLabel(), 0);
  if (event.target.closest('#screenBack')) { event.preventDefault(); event.stopImmediatePropagation(); navBack(); }
  if (event.target.closest('[data-pip-ask]')) {
    const box = document.querySelector('.pip-brain input, .pip-brain textarea');
    if (box) { box.scrollIntoView({behavior: 'smooth', block: 'center'}); setTimeout(() => box.focus({preventScroll: true}), 350); }
    else navigate('Dashboard');
  }
}, true);
addEventListener('keydown', event => { if (event.key === 'Escape' && document.querySelector('.label-view')) closeLabel(); });

// ---------- Profile: everything lives here on your phone, like Vinted ----------
const SETTINGS_TITLES = {account: 'Account & sign-in', plan: 'Plan & billing', privacy: 'Edit profile', connections: 'Connections', notifications: 'Notifications', data: 'Data & backups', advanced: 'Advanced'};
function meHubHtml() {
  const p = (typeof profile !== 'undefined' && profile) || {};
  const name = p.username ? '@' + p.username : 'Choose your username';
  const admin = account?.role === 'admin';
  const plan = admin ? 'Owner' : account?.plan === 'pro' ? 'Pro' : 'Free';
  const live = (db?.items || []).filter(i => !i.deletedAt);
  const inStock = live.filter(i => i.status === 'In Stock').length, sold = live.filter(i => i.status === 'Sold').length;
  const friendCount = (typeof friends !== 'undefined' && Array.isArray(friends)) ? friends.filter(f => !f.status || f.status === 'accepted' || f.state === 'accepted').length : 0;
  const unread = Number(document.getElementById('mobileUnread')?.textContent) || 0;
  const svg = d => '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="' + d + '"/></svg>';
  const I = {
    user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21a8 8 0 0 1 16 0',
    star: 'm12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9Z',
    bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 8-3 8h18s-3-1-3-8M13.7 21a2 2 0 0 1-3.4 0',
    link: 'M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1',
    box: 'M21 8 12 3 3 8v8l9 5 9-5ZM3 8l9 5 9-5M12 13v8',
    people: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM2 21a7 7 0 0 1 14 0M16 3.5a4 4 0 0 1 0 7.5M22 21a7 7 0 0 0-4.5-6.5',
    trophy: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0ZM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3',
    chat: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z',
    camera: 'M4 8h2.5L8 6h8l1.5 2H20a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1ZM12 16.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z',
    spark: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6',
    help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17.5h.01',
    tools: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-2.5Z',
    shield: 'M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6Z',
    out: 'M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H3'
  };
  const row = (attrs, icon, label, sub = '', extra = '') => '<button type="button" class="me-row" ' + attrs + '><i>' + svg(I[icon]) + '</i><span><b>' + label + '</b>' + (sub ? '<small>' + sub + '</small>' : '') + '</span>' + extra + '<em aria-hidden="true">›</em></button>';
  const group = (title, rows) => '<h2 class="me-group-title">' + title + '</h2><div class="me-group">' + rows + '</div>';
  return '<section class="me-hub" aria-label="Your profile and settings">' +
    '<div class="ig-head"><span class="ig-avatar">' + (typeof avatar === 'function' ? avatar(p.avatarSeed, 'large') : '') + '</span>' +
      '<div class="ig-stats"><button type="button" data-tab="Stock"><b>' + inStock + '</b><small>in stock</small></button><button type="button" data-tab="Activity"><b>' + sold + '</b><small>sold</small></button><button type="button" data-me-friends><b>' + friendCount + '</b><small>friends</small></button></div></div>' +
    '<div class="ig-name"><b>' + esc(name) + '</b><span class="ig-plan">' + plan + '</span></div>' +
    (p.instagram ? '<a class="ig-handle" href="https://instagram.com/' + encodeURIComponent(p.instagram) + '" target="_blank" rel="noopener">Instagram · @' + esc(p.instagram) + '</a>' : '<button type="button" class="ig-handle add" data-settings-section="privacy">＋ Add your Instagram</button>') +
    '<div class="ig-buttons"><button type="button" data-settings-section="privacy">Edit profile</button><button type="button" data-me-share>Share profile</button></div>' +
    group('Your account',
      row('data-settings-section="account"', 'user', 'Account & sign-in', esc(account?.email || '')) +
      row('data-settings-section="plan"', 'star', 'Plan & billing', plan) +
      row('data-settings-section="notifications"', 'bell', 'Notifications') +
      row('data-settings-section="connections"', 'link', 'Connections', 'Gmail and Vinted emails') +
      row('data-settings-section="data"', 'box', 'Data & backups')) +
    group('Community',
      row('data-me-friends', 'people', 'Friends & messages', '', unread ? '<span class="me-badge">' + unread + '</span>' : '') +
      row('data-tab="Leaderboard"', 'trophy', 'Leaderboard')) +
    group('Tools',
      row('data-tab="Customer care"', 'chat', 'Customer care') +
      row('data-tab="Studio"', 'camera', 'Photo studio') +
      row('data-tour-open', 'spark', 'App tour')) +
    group('More',
      '<a class="me-row" href="mailto:info@bookednpaid.com?subject=Stockroom%20help"><i>' + svg(I.help) + '</i><span><b>Help</b><small>info@bookednpaid.com</small></span><em aria-hidden="true">›</em></a>' +
      row('data-settings-section="advanced"', 'tools', 'Advanced') +
      (admin ? row('data-tab="Admin"', 'shield', 'Admin console') : '') +
      '<button type="button" class="me-row me-signout" data-sign-out><i>' + svg(I.out) + '</i><span><b>Sign out</b></span></button>') +
    '<p class="me-foot">Booked &amp; Paid Stockroom</p></section>';
}
document.addEventListener('click', event => {
  const sec = event.target.closest('[data-settings-section]');
  if (sec && navPhone()) setTimeout(() => { const h = document.getElementById('settingsHeading-' + sec.dataset.settingsSection); if (h && SETTINGS_TITLES[sec.dataset.settingsSection]) h.textContent = SETTINGS_TITLES[sec.dataset.settingsSection]; window.scrollTo({top: 0}); }, 0);
});
document.addEventListener('click', event => {
  if (!event.target.closest('[data-me-share]')) return;
  const p = (typeof profile !== 'undefined' && profile) || {};
  const text = p.username ? 'Add me on Stockroom: @' + p.username + ' · stockroom.bookednpaid.com' : 'stockroom.bookednpaid.com';
  if (navigator.share) navigator.share({text}).catch(() => {});
  else navigator.clipboard?.writeText(text).then(() => toast('Copied, paste it anywhere')).catch(() => {});
});
document.addEventListener('click', event => {
  if (!event.target.closest('[data-me-friends]')) return;
  const target = document.getElementById('friendsList')?.closest('section') || document.getElementById('friendsList');
  target?.scrollIntoView({behavior: 'smooth', block: 'start'});
});

if (typeof render === 'function') {
  const baseRenderNav = render;
  // eslint-disable-next-line no-global-assign
  render = function (...args) {
    const out = baseRenderNav.apply(this, args);
    const phone = navPhone();
    document.body.classList.toggle('nav-phone', phone);
    document.body.classList.toggle('tab-profile', tab === 'Profile');
    document.body.classList.toggle('tab-rows', ROW_SHEET_TABS.includes(tab));
    const back = document.getElementById('screenBack');
    if (back && phone) back.hidden = NAV_ROOTS.includes(tab);
    if (phone && tab === 'Profile' && document.getElementById('pageName')) document.getElementById('pageName').textContent = 'Profile';
    const view = document.getElementById('view');
    if (phone && tab === 'Profile' && view && !view.querySelector('.me-hub')) {
      const anchor = view.querySelector('.profile-layout');
      if (anchor) anchor.insertAdjacentHTML('beforebegin', meHubHtml());
    }
    // Settings on phone: one section per page with its own title (back goes to Profile).
    document.body.classList.toggle('tab-settings', tab === 'Account');
    if (phone && tab === 'Account' && typeof settingsSection === 'string') {
      const title = SETTINGS_TITLES[settingsSection] || 'Settings';
      const pn = document.getElementById('pageName'); if (pn) pn.textContent = '';
      const h = document.getElementById('settingsHeading-' + settingsSection); if (h) h.textContent = title;
    }
    // Pip top left asks Pip; your profile and settings are only under Profile.
    const avatarBtn = document.querySelector('.mh-avatar');
    if (avatarBtn && avatarBtn.dataset.tab) { avatarBtn.removeAttribute('data-tab'); avatarBtn.setAttribute('data-pip-ask', ''); avatarBtn.setAttribute('aria-label', 'Ask Pip'); }
    return out;
  };
}

// ---------- Money lists: tight rows; tap a row for its actions (like Vinted) ----------
const ROW_SHEET_TABS = ['Activity', 'Expenses'];
function closeRowSheet(silent) {
  const el = document.querySelector('.row-sheet');
  if (!el) return;
  el.classList.remove('open');
  setTimeout(() => el.remove(), 220);
  if (!silent) navLayerClosed(el);
}
function openRowSheet(row) {
  const buttons = [...row.querySelectorAll('td:last-child button, td:last-child a')];
  if (!buttons.length) return;
  closeRowSheet(true);
  const cells = [...row.children].map(td => td.textContent.trim());
  const el = document.createElement('div');
  el.className = 'row-sheet';
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
  el.innerHTML = '<div class="row-sheet-back" data-row-sheet-close></div><div class="row-sheet-card"><span class="row-sheet-grip"></span>' +
    '<b>' + esc(cells[1] || '') + '</b><small>' + esc([cells[0], cells[2]].filter(Boolean).join(' · ')) + '</small>' +
    '<div class="row-sheet-actions">' + buttons.map((b, i) => '<button type="button" data-row-act="' + i + '" class="' + (/remove/i.test(b.textContent) ? 'danger' : '') + '">' + esc(b.textContent.trim()) + '</button>').join('') +
    '<button type="button" class="cancel" data-row-sheet-close>Cancel</button></div></div>';
  el._buttons = buttons;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('open'));
  navPushLayer(el);
}
document.addEventListener('click', event => {
  const t = event.target;
  const sheet = t.closest('.row-sheet');
  if (sheet) {
    const act = t.closest('[data-row-act]');
    if (act) { const original = sheet._buttons[Number(act.dataset.rowAct)]; closeRowSheet(); setTimeout(() => original?.click(), 60); }
    else if (t.closest('[data-row-sheet-close]')) closeRowSheet();
    return;
  }
  if (!navPhone() || !ROW_SHEET_TABS.includes(tab)) return;
  const row = t.closest('#view tbody tr');
  if (!row || t.closest('button, a, input, select')) return;
  openRowSheet(row);
});

// ---------- Undo instead of "are you sure" ----------
function undoToast(message, onUndo, ms = 6000) {
  document.querySelector('.undo-toast')?.remove();
  const el = document.createElement('div');
  el.className = 'undo-toast'; el.setAttribute('role', 'status');
  el.innerHTML = '<span>' + esc(message) + '</span><button type="button">Undo</button>';
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  const done = () => { el.classList.remove('show'); setTimeout(() => el.remove(), 250); };
  const timer = setTimeout(done, ms);
  el.querySelector('button').onclick = async () => { clearTimeout(timer); done(); try { await onUndo(); } catch (error) { toast(error.message || 'Couldn’t undo'); } };
}

// ---------- Swipe a sheet down to close it (phone) ----------
(() => {
  let start = null;
  const sheetOf = t => t.closest('dialog[open], .row-sheet-card');
  document.addEventListener('touchstart', event => {
    if (!navPhone() || event.touches.length !== 1) return;
    const sheet = sheetOf(event.target);
    if (!sheet || event.target.closest('input, textarea, select, [contenteditable], .mh-chart, .tell-examples, .subnav')) return;
    const scroller = event.target.closest('dialog, .row-sheet-card');
    if (scroller && scroller.scrollTop > 0) return; // only from the top, so normal scrolling still works
    start = {sheet, y: event.touches[0].clientY, x: event.touches[0].clientX, dy: 0};
  }, {passive: true});
  document.addEventListener('touchmove', event => {
    if (!start) return;
    const dy = event.touches[0].clientY - start.y, dx = Math.abs(event.touches[0].clientX - start.x);
    if (dx > Math.abs(dy) || dy < 0) { if (dy < -10 || dx > 30) { start.sheet.style.transform = ''; start = null; } return; }
    start.dy = dy;
    start.sheet.style.transition = 'none';
    start.sheet.style.transform = 'translateY(' + Math.min(dy, 400) * .9 + 'px)';
  }, {passive: true});
  document.addEventListener('touchend', () => {
    if (!start) return;
    const {sheet, dy} = start; start = null;
    sheet.style.transition = ''; sheet.style.transform = '';
    if (dy < 110) return;
    if (sheet.classList.contains('row-sheet-card')) closeRowSheet();
    else if (typeof requestClose === 'function') requestClose(sheet); else sheet.close();
  });
})();

// ---------- Offline: say so clearly ----------
function navOnline() {
  let bar = document.getElementById('offlineBar');
  if (navigator.onLine) { bar?.remove(); return; }
  if (!bar) {
    bar = document.createElement('div'); bar.id = 'offlineBar'; bar.setAttribute('role', 'status');
    bar.textContent = 'You’re offline · showing your last saved copy. Changes save when you’re back online.';
    document.body.appendChild(bar);
  }
}
addEventListener('online', navOnline); addEventListener('offline', navOnline); navOnline();

// ---------- Light haptics on key actions (Android; iPhone ignores this) ----------
document.addEventListener('click', event => {
  if (!navigator.vibrate || !navPhone()) return;
  if (event.target.closest('#add, .action, .qr-posted, [data-trade], .row-sheet-actions button, .tell-go, nav button')) try { navigator.vibrate(8); } catch {}
}, true);

// ---------- Know what breaks and what's used (no personal data) ----------
(() => {
  let sent = 0;
  const report = (message, where) => {
    if (sent++ > 5) return; // a few per visit is plenty
    try { navigator.sendBeacon?.('/api/client-error', new Blob([JSON.stringify({message: String(message || '').slice(0, 300), where: String(where || '').slice(0, 120), tab: typeof tab === 'string' ? tab : ''})], {type: 'application/json'})); } catch {}
  };
  addEventListener('error', e => { if (e.message && !/ResizeObserver|Script error/.test(e.message)) report(e.message, (e.filename || '').split('/').pop() + ':' + e.lineno); });
  addEventListener('unhandledrejection', e => { const m = e.reason?.message || String(e.reason || ''); if (m && !/abort|network|Failed to fetch|Load failed/i.test(m)) report(m, 'promise'); });
  // Which screens get used: counted per day per screen, never tied to you.
  const seen = new Set();
  const count = name => {
    if (!name || seen.has(name)) return; seen.add(name);
    try { navigator.sendBeacon?.('/api/usage', new Blob([JSON.stringify({feature: name})], {type: 'application/json'})); } catch {}
  };
  if (typeof render === 'function') {
    const baseRenderUsage = render;
    render = function (...args) { const out = baseRenderUsage.apply(this, args); count('tab:' + tab); return out; };
  }
  document.addEventListener('click', event => {
    const f = event.target.closest('[data-scan-open], [data-label-show], [data-qr-show], [data-tell-go], .tell-go, [data-write-pip], #writeWithPip, [data-snap], [data-me-share]');
    if (f) count('use:' + (f.dataset.scanOpen !== undefined ? 'buy-or-pass' : f.dataset.labelShow ? 'label' : f.dataset.qrShow ? 'qr' : f.id || f.className.split(' ')[0]));
  }, true);
})();
