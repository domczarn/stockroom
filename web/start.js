'use strict';
// Getting started: a short checklist on Home for new sellers. It stands in for the empty charts and
// widgets until you've made your first sale, ticks itself off as you go, and can be hidden.

const startKey = () => 'sr-start-hidden:' + (account?.id || 'guest');
function startHidden() { try { return !!localStorage.getItem(startKey()); } catch { return false; } }

function startSteps() {
  const live = (db?.items || []).filter(i => !i.deletedAt);
  const firstNoPhoto = live.find(i => !(i.photos || []).length && i.status === 'In Stock');
  const firstNoListing = live.find(i => !i.listingTitle && i.status === 'In Stock');
  const firstUnsold = live.find(i => i.status === 'In Stock');
  const gmail = typeof personalGmail !== 'undefined' && personalGmail?.connection;
  const pro = account?.plan === 'pro' || account?.role === 'admin';
  return [
    {id: 'item', done: live.length > 0, title: 'Add your first item', body: 'Anything you’re selling, even if it’s already on Vinted. About 10 seconds.', cta: 'Add item', act: 'data-start-add'},
    {id: 'photos', done: live.some(i => (i.photos || []).length), title: 'Add photos', body: 'Pip reads the photos to fill in details and write your listing.', cta: 'Add photos', act: firstNoPhoto ? 'data-start-open="' + esc(firstNoPhoto.id) + '"' : 'data-start-add'},
    {id: 'listing', done: live.some(i => i.listingTitle), title: 'Write your listing with Pip', body: 'A Vinted-ready title, description and hashtags in one tap. Copy it into Vinted.', cta: 'Write it', act: firstNoListing ? 'data-start-listing="' + esc(firstNoListing.id) + '"' : 'data-start-add'},
    {id: 'gmail', done: !!gmail, title: 'Track sales automatically', body: 'Connect your email and every sale, shipping label and QR code appears here by itself.' + (pro ? '' : ' Free for your first 20 sales each month.'), cta: 'Connect email', act: 'data-start-gmail'},
    {id: 'sale', done: !startIsNew(), title: 'Make your first sale', body: gmail ? 'When it sells on Vinted, it’s recorded for you. Your profit shows on Home.' : 'When it sells, tap Mark sold on the item and your profit shows on Home.', cta: firstUnsold ? 'Mark one sold' : '', act: firstUnsold ? 'data-trade="sale" data-stock-id="' + esc(firstUnsold.id) + '"' : ''}
  ];
}
// New until the first sale, or until every step is done.
// New = no sale recorded anywhere: orders, items marked sold, or the older sales list.
function startIsNew() { return !(db?.trades || []).length && !(db?.sales || []).length && !(db?.items || []).some(i => i.status === 'Sold' && !i.deletedAt); }
// Only brand-new sellers see it: once you've sold anything it never shows, and it waits until
// the account has actually loaded so it can't flash up on launch.
function startVisible() { return !isReadOnly() && startLoaded() && startIsNew() && !startHidden() && startSteps().some(s => !s.done); }
function startLoaded() { return typeof cloudRevision !== 'undefined' && (cloudRevision !== null || cloudAvailable === true); }

function startCardHtml() {
  const steps = startSteps(), done = steps.filter(s => s.done).length, next = steps.find(s => !s.done);
  return '<section class="start-card" aria-label="Getting started">' +
    '<header><div><span class="start-eyebrow">Getting started</span><h2>' + (done ? done + ' of ' + steps.length + ' done' : 'Five steps to your first sale') + '</h2></div>' +
    '<button type="button" class="start-hide" data-start-hide aria-label="Hide getting started">Hide</button></header>' +
    '<div class="start-bar" role="progressbar" aria-valuemin="0" aria-valuemax="' + steps.length + '" aria-valuenow="' + done + '"><i class="w' + done + '"></i></div>' +
    '<ol class="start-steps">' + steps.map(s => {
      const current = s === next;
      return '<li class="' + (s.done ? 'done' : current ? 'current' : '') + '"><span class="start-tick" aria-hidden="true">' + (s.done ? '✓' : '') + '</span>' +
        '<div><b>' + s.title + '</b>' + (current ? '<p>' + s.body + '</p>' : '') + '</div>' +
        (current && s.cta ? '<button type="button" class="start-go" ' + s.act + '>' + s.cta + '</button>' : '') + '</li>';
    }).join('') + '</ol></section>';
}

async function startGmail() {
  // With forwarding switched on, the choice (forward or connect Gmail) lives in Settings → Connections.
  if ((personalGmail?.forwarding || personalGmail?.outlook) && !personalGmail.connection) { const b = document.createElement('button'); b.dataset.settingsSection = 'connections'; b.hidden = true; document.body.append(b); b.click(); b.remove(); return; }
  if (typeof changeGmail === 'function') await changeGmail('/api/gmail/connect', {method: 'POST'});
  else navigate('Vinted updates');
}

document.addEventListener('click', event => {
  const t = event.target;
  if (t.closest('[data-start-hide]')) { try { localStorage.setItem(startKey(), '1'); } catch {} toast('Hidden. You can replay the tour from Profile → App tour.'); render(); return; }
  if (t.closest('[data-start-add]')) { openQuickAdd(); return; }
  const open = t.closest('[data-start-open]'); if (open) { openItem(db.items.find(i => i.id === open.dataset.startOpen)); return; }
  const listing = t.closest('[data-start-listing]'); if (listing) { openItem(db.items.find(i => i.id === listing.dataset.startListing), 'listing'); return; }
  if (t.closest('[data-start-gmail]')) {
    if (t.closest('.tour') && typeof closeTour === 'function') { markTourDone(); closeTour(); }
    void startGmail();
  }
});

// Put the card on Home (phone and web). While you're new, the empty charts and widgets step aside.
if (typeof render === 'function') {
  onHook('afterRender', () => {
    const isNew = startIsNew() && startLoaded();
    document.body.classList.toggle('is-new-seller', isNew && tab === 'Dashboard');
    if (tab === 'Dashboard' && startVisible()) {
      const view = document.getElementById('view');
      if (view && !view.querySelector('.start-card')) {
        const anchor = view.querySelector('.mh-stats') || view.querySelector('.kpi-strip') || view.querySelector('.welcome');
        if (anchor) anchor.insertAdjacentHTML(anchor.classList.contains('mh-stats') || anchor.classList.contains('welcome') ? 'afterend' : 'beforebegin', startCardHtml());
        else view.insertAdjacentHTML('afterbegin', startCardHtml());
      }
    }
  });
}
