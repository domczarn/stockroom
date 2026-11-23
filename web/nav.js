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
function meHubHtml() {
  const name = (typeof profile !== 'undefined' && profile?.username) ? '@' + profile.username : 'Choose your username';
  const admin = account?.role === 'admin';
  const unread = Number(document.getElementById('mobileUnread')?.textContent) || 0;
  const row = (attrs, icon, label, sub = '') => '<button type="button" class="me-row" ' + attrs + '><i aria-hidden="true">' + icon + '</i><span><b>' + label + '</b>' + (sub ? '<small>' + sub + '</small>' : '') + '</span><em aria-hidden="true">›</em></button>';
  return '<section class="me-hub" aria-label="Your account"><h1 class="me-title">Profile</h1>' +
    '<button type="button" class="me-card" data-settings-section="privacy"><span class="me-avatar">' + (typeof avatar === 'function' ? avatar(profile?.avatarSeed, 'small') : '') + '</span>' +
      '<span><b>' + esc(name) + '</b><small>View and edit profile</small></span><em aria-hidden="true">›</em></button>' +
    '<div class="me-group">' +
      row('data-me-friends', '👥', 'Friends & messages', unread ? unread + ' unread' : 'Add by username or @instagram') +
      row('data-tab="Leaderboard"', '🏆', 'Leaderboard') +
      row('data-tab="Customer care"', '💬', 'Customer care') +
      row('data-tab="Vinted updates"', '✉️', 'Vinted emails', 'Gmail sync') +
    '</div><div class="me-group">' +
      row('data-settings-section="account"', '⚙️', 'Settings') +
      row('data-settings-section="plan"', '⭐', 'Plan & billing') +
      row('data-settings-section="notifications"', '🔔', 'Notifications') +
      row('data-settings-section="data"', '💾', 'Data & backups') +
      (admin ? row('data-tab="Admin"', '🛠', 'Admin console') : '') +
    '</div><div class="me-group">' +
      row('data-tour-open', '✨', 'App tour') +
      '<a class="me-row" href="mailto:info@bookednpaid.com?subject=Stockroom%20help"><i aria-hidden="true">❓</i><span><b>Help</b><small>info@bookednpaid.com</small></span><em aria-hidden="true">›</em></a>' +
      '<button type="button" class="me-row me-signout" data-sign-out><i aria-hidden="true">↩</i><span><b>Sign out</b></span></button>' +
    '</div></section>';
}
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
