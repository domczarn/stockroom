'use strict';
// Shipping QR codes: attach the label/QR from Vinted's email to the sold item, pin it to the top, show it full screen at drop-off.

function awaitingPost() {
  const today = todayUK();
  return db.items.filter(i => !i.deletedAt && i.status === 'Sold').map(item => ({item, trade: lastTrade(db, item.id)}))
    .filter(({trade}) => trade && tradeStatus(trade) === 'Sold' && saleRemaining(trade) > 0)
    .map(row => ({...row, ship: typeof shipInfo === 'function' ? shipInfo(row.trade, today) : {label: 'Sold ' + dateLabel(row.trade.soldAt), by: row.trade.soldAt, level: ''}}))
    .sort((a, b) => (!!b.item.shipQr - !!a.item.shipQr) || String(a.ship.by || '').localeCompare(String(b.ship.by || '')));
}
function readyToPostHtml(where = 'home') {
  if (isReadOnly()) return '';
  const rows = awaitingPost();
  if (!rows.length) return '';
  const withQr = rows.filter(r => r.item.shipQr).length;
  return '<section class="ship-qr-panel" data-ship-panel="' + where + '"><header><div><h2>Ready to post <span class="daily-count">' + rows.length + '</span></h2>' +
    '<p>' + (withQr ? withQr + ' with a QR code ready to scan' : 'QR codes from Vinted’s emails attach automatically') + '</p></div></header>' +
    '<div class="ship-qr-list">' + rows.slice(0, where === 'home' ? 4 : 12).map(({item, ship}) => {
      const photo = (item.photos || [])[0];
      return '<article class="ship-qr-row' + (item.shipQr ? ' has-qr' : '') + (ship.level ? ' ship-' + ship.level : '') + '">' +
        (photo ? '<img class="ship-qr-thumb" src="' + esc(photo) + '" alt="" loading="lazy">' : '<span class="ship-qr-thumb none" aria-hidden="true">📦</span>') +
        '<span class="ship-qr-text"><b>' + esc(item.name) + '</b><small>' + esc([String(ship.label || '').replace(/ working days? left/, 'd left').replace(/ working day left/, 'd left'), item.shipCarrier].filter(Boolean).join(' · ')) + '</small></span>' +
        (!item.shipQr && item.shipLabel ? '<button type="button" class="ship-qr-show label" data-label-show="' + esc(item.id) + '">🏷 Label</button>' : '') +
        (item.shipQr
          ? '<button type="button" class="ship-qr-show" data-qr-show="' + esc(item.id) + '"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2M14 18h2v2M18 18h2v2"/></svg>Show QR</button>'
          : '<button type="button" class="ship-qr-add" data-qr-add="' + esc(item.id) + '">＋ ' + (item.shipLabel ? 'QR' : 'Add QR') + '</button>') +
        '</article>';
    }).join('') + '</div>' + (rows.length > 4 && where === 'home' ? '<button type="button" class="link ship-qr-more" data-tab="Stock">See all ' + rows.length + ' in Stock ↗</button>' : '') + '</section>';
}

// Parcels you've posted that the buyer hasn't confirmed yet, with where they are (from courier emails).
function onTheWay() {
  return db.items.filter(i => !i.deletedAt && i.status === 'Sold').map(item => ({item, trade: lastTrade(db, item.id)}))
    .filter(({trade}) => trade && tradeStatus(trade) === 'Posted')
    .sort((a, b) => String(b.trade.postedAt).localeCompare(String(a.trade.postedAt)));
}
function onTheWayHtml(where = 'home') {
  if (isReadOnly()) return '';
  const rows = onTheWay();
  if (!rows.length) return '';
  const step = item => item.shipDeliveredAt ? 2 : 1;
  const delivered = rows.filter(r => r.item.shipDeliveredAt).length;
  const rowsHtml = limit => rows.slice(0, limit).map(({item, trade}) => {
    const s = step(item);
    return '<article class="ship-way-row"><span class="ship-way-text"><b>' + esc(item.name) + '</b><small>' +
      esc([item.shipCarrier, s === 2 ? 'Delivered ' + dateLabel(item.shipDeliveredAt) : 'Posted ' + dateLabel(trade.postedAt)].filter(Boolean).join(' · ')) + '</small></span>' +
      '<span class="ship-way-steps" aria-label="' + (s === 2 ? 'Delivered' : 'In transit') + '"><i class="on"></i><i class="' + (s === 2 ? 'on' : 'pulse') + '"></i><i class="' + (s === 2 ? 'pulse' : '') + '"></i></span></article>';
  }).join('');
  // Stock: one slim line you can tap open. Home: a short list.
  if (where === 'stock') return '<details class="ship-way-mini"><summary><span class="swm-icon" aria-hidden="true">🚚</span><span><b>On the way</b> · ' + rows.length + (delivered ? ' · ' + delivered + ' delivered' : '') + '</span><em aria-hidden="true">›</em></summary><div class="ship-way-list">' + rowsHtml(20) + '</div></details>';
  return '<section class="ship-way-panel"><header><h2>On the way <span class="daily-count">' + rows.length + '</span></h2></header><div class="ship-way-list">' + rowsHtml(3) + '</div>' +
    (rows.length > 3 ? '<button type="button" class="link ship-qr-more" data-tab="Stock">See all ' + rows.length + ' ↗</button>' : '') + '</section>';
  // eslint-disable-next-line no-unreachable
  return '<section class="ship-way-panel"><header><h2>On the way <span class="daily-count">' + rows.length + '</span></h2><p>Posted parcels. Updates come in from InPost, Evri and Royal Mail emails.</p></header><div class="ship-way-list">' +
    rows.slice(0, where === 'home' ? 4 : 12).map(({item, trade}) => {
      const s = step(item);
      return '<article class="ship-way-row"><span class="ship-way-text"><b>' + esc(item.name) + '</b><small>' +
        esc([item.shipCarrier, s === 2 ? 'Delivered ' + dateLabel(item.shipDeliveredAt) + ', waiting for buyer' : 'Posted ' + dateLabel(trade.postedAt)].filter(Boolean).join(' · ')) + '</small></span>' +
        '<span class="ship-way-steps" aria-label="' + (s === 2 ? 'Delivered' : 'In transit') + '"><i class="on"></i><i class="' + (s === 2 ? 'on' : 'pulse') + '"></i><i class="' + (s === 2 ? 'pulse' : '') + '"></i></span></article>';
    }).join('') + '</div></section>';
}

// Pick a screenshot of the QR/label, shrink it a little (keeping it sharp enough to scan) and save it to the item.
async function qrImage(file) {
  const url = await new Promise((ok, fail) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = fail; r.readAsDataURL(file); });
  const img = new Image();
  await new Promise((ok, fail) => { img.onload = ok; img.onerror = () => fail(new Error('That file isn’t an image. Screenshot the QR code and pick the screenshot.')); img.src = url; });
  const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * scale); canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.imageSmoothingEnabled = scale < 1;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', .94);
}
function pickQr(id) {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/*';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    try {
      const data = await qrImage(file);
      const next = cloneWorkspace(db), item = next.items.find(i => i.id === id);
      if (!item) return;
      Object.assign(item, {shipQr: data, shipQrAt: todayUK()});
      await persist(next);
      toast('QR code saved. It’s pinned to the top until you post it.');
      render();
    } catch (error) { toast(error.message); }
  };
  input.click();
}
async function removeQr(id) {
  const next = cloneWorkspace(db), item = next.items.find(i => i.id === id);
  if (!item) return;
  Object.assign(item, {shipQr: '', shipQrAt: ''});
  await persist(next);
  toast('QR code removed.');
}

// Full-screen viewer: white, big and bright for the scanner at the drop-off.
function showQr(id) {
  const item = db.items.find(i => i.id === id);
  if (!item?.shipQr) return;
  const trade = lastTrade(db, id), ship = trade && typeof shipInfo === 'function' ? shipInfo(trade) : null;
  const rows = awaitingPost().filter(r => r.item.shipQr), index = rows.findIndex(r => r.item.id === id);
  const el = document.createElement('div');
  el.className = 'qr-view'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Shipping QR code for ' + item.name);
  el.innerHTML = '<div class="qr-top"><button type="button" class="qr-close" data-qr-close aria-label="Close">×</button>' +
    (rows.length > 1 ? '<span class="qr-count">' + (index + 1) + ' of ' + rows.length + '</span>' : '<span></span>') + '<span></span></div>' +
    '<div class="qr-item"><b>' + esc(item.name) + '</b><small>' + esc([item.size && 'Size ' + item.size, ship?.label].filter(Boolean).join(' · ')) + '</small></div>' +
    '<div class="qr-image"><img src="' + esc(item.shipQr) + '" alt="Shipping QR code"></div>' +
    '<p class="qr-tip">' + (item.shipCode ? 'No scanner? Enter code <b>' + esc(item.shipCode) + '</b> at the locker. ' : '') + 'Turn your screen brightness up if it won’t scan.</p>' +
    (item.shipLabel ? '<p class="qr-tip"><button type="button" class="link" data-label-show="' + esc(item.id) + '">Open the shipping label</button></p>' : '') +
    '<div class="qr-actions">' + (rows.length > 1 ? '<button type="button" class="qr-nav" data-qr-step="-1" aria-label="Previous parcel">‹</button>' : '') +
      '<button type="button" class="qr-posted" data-trade="post" data-stock-id="' + esc(item.id) + '">Mark as posted</button>' +
      (rows.length > 1 ? '<button type="button" class="qr-nav" data-qr-step="1" aria-label="Next parcel">›</button>' : '') + '</div>' +
    '<div class="qr-more"><button type="button" class="link" data-qr-add="' + esc(item.id) + '">Replace QR</button><button type="button" class="link" data-qr-remove="' + esc(item.id) + '">Remove</button></div>';
  el.dataset.id = id;
  document.body.appendChild(el);
  document.body.classList.add('qr-open');
  requestAnimationFrame(() => el.classList.add('open'));
  el.querySelector('[data-qr-close]').focus();
  try { navigator.wakeLock?.request('screen').then(lock => { el._lock = lock; }).catch(() => {}); } catch {}
}
function closeQr() {
  const el = document.querySelector('.qr-view');
  if (!el) return;
  try { el._lock?.release(); } catch {}
  el.classList.remove('open'); document.body.classList.remove('qr-open');
  setTimeout(() => el.remove(), 300);
}

document.addEventListener('click', event => {
  const t = event.target;
  const add = t.closest('[data-qr-add]');
  if (add) { closeQr(); pickQr(add.dataset.qrAdd); return; }
  const show = t.closest('[data-qr-show]');
  if (show) { showQr(show.dataset.qrShow); return; }
  if (t.closest('[data-qr-close]')) { closeQr(); return; }
  const remove = t.closest('[data-qr-remove]');
  if (remove) {
    if (remove.dataset.confirm !== '1') { remove.dataset.confirm = '1'; remove.textContent = 'Tap again to remove'; return; }
    closeQr(); void removeQr(remove.dataset.qrRemove).catch(error => toast(error.message)); return;
  }
  const step = t.closest('[data-qr-step]');
  if (step) {
    const rows = awaitingPost().filter(r => r.item.shipQr), current = document.querySelector('.qr-view')?.dataset.id;
    const i = rows.findIndex(r => r.item.id === current), next = rows[(i + Number(step.dataset.qrStep) + rows.length) % rows.length];
    document.querySelector('.qr-view')?.remove(); if (next) showQr(next.item.id);
    return;
  }
  if (t.closest('.qr-posted')) closeQr(); // the posting flow opens from the same click
}, true);
document.addEventListener('keydown', event => { if (event.key === 'Escape' && document.querySelector('.qr-view')) closeQr(); });

// Pin "Ready to post" to the top of Home and Stock.
if (typeof render === 'function') {
  const baseRenderQr = render;
  // eslint-disable-next-line no-global-assign
  render = function (...args) {
    const out = baseRenderQr.apply(this, args);
    const view = document.getElementById('view');
    if (view && !view.querySelector('.ship-qr-panel, .ship-way-panel')) {
      if (tab === 'Dashboard') {
        const html = readyToPostHtml('home') + onTheWayHtml('home');
        // Money chart and the dashboard always come first; posting panels sit right under them.
        const anchor = view.querySelector('.mh-sheet') || view.querySelector('.home-chart') || view.querySelector('.welcome');
        if (html && anchor) anchor.insertAdjacentHTML('afterend', html);
        else if (html) view.insertAdjacentHTML('beforeend', html);
        // Ready to post already lists these, so drop the duplicate To do card.
        if (view.querySelector('.ship-qr-panel')) [...view.querySelectorAll('.daily-card')].find(c => /^\s*Ship next/.test(c.textContent))?.remove();
      } else if (tab === 'Stock') {
        // Under the Stock tabs and title, never above them.
        const html = readyToPostHtml('stock') + onTheWayHtml('stock');
        const anchor = view.querySelector('.stock-page-heading') || view.querySelector('.top');
        if (html && anchor) anchor.insertAdjacentHTML('afterend', html);
        else if (html) view.insertAdjacentHTML('afterbegin', html);
      }
    }
    return out;
  };
}
