'use strict';
// First-run welcome and a short, skippable tour. Shown once to new accounts; replay from ☰ → App tour.

const TOUR = [
  {icon: '＋', tone: 'violet', title: 'Add your stock', body: 'Tap <b>＋</b> to add a piece. Snap the item and its label and Pip fills in the brand, size, condition and a resale price for you.', chips: ['Snap to stock', 'Reads labels', 'Spots flaws']},
  {icon: uiIcon('pen', 34), tone: 'blue', title: 'Listings that sell', body: '<b>Write with Pip</b> turns your photo into a Vinted-ready title, description and hashtags. Photo studio gives you clean backgrounds in one tap.', chips: ['Search-ready titles', 'Photo studio', 'Depop & eBay copy']},
  {icon: uiIcon('camera', 34), tone: 'green', title: 'Know what to pay', body: 'At a charity shop or car boot? Open <b>Buy or pass</b>, snap a piece and Pip tells you what it sells for and the most to pay.', chips: ['Sold-price data', 'Max buy price', 'What to check']},
  {icon: uiIcon('mail', 34), tone: 'amber', title: 'Sales track themselves', body: 'Connect your email and Pip reads your Vinted emails: every sale, shipping label and QR code lands in the app. No rush: when you make your first sale, Pip offers to track the rest for you.', chips: ['Sold → recorded', 'QR codes', 'Posted & delivered']},
  {icon: uiIcon('chat', 34), tone: 'pink', title: 'Just tell Pip', body: 'Type or say what happened: <b>“Sold the black Nike hoodie for £25.”</b> Pip shows the changes and saves them when you tap Do it.', chips: ['Type or speak', 'You confirm first', 'Works in seconds']}
];
const tourKey = () => 'sr-onboarded:' + (account?.id || 'guest');
const tourDone = () => { try { return !!localStorage.getItem(tourKey()); } catch { return true; } };
const markTourDone = () => { try { localStorage.setItem(tourKey(), new Date().toISOString()); } catch {} };
let tourStep = -1, tourEl = null, tourTouch = null;

function tourName() {
  if (account?.role === 'admin') return 'Dom';
  const n = (account?.email || '').split('@')[0].split(/[._\-0-9]/)[0];
  return n ? n.charAt(0).toUpperCase() + n.slice(1) : '';
}
function tourSlide(step) {
  if (step === -1) return '<div class="tour-hero"><div class="tour-orb"><img src="/pip-orb.svg" alt="" width="200" height="200"></div>' +
    '<span class="tour-eyebrow">Booked &amp; Paid Stockroom</span><h2>Welcome' + (tourName() ? ', ' + esc(tourName()) : '') + '!</h2>' +
    '<p>I’m Pip, your reselling co-pilot. I’ll write your listings, price your stock and keep track of every penny.<br>Want a quick 30-second tour?</p></div>';
  if (step === TOUR.length) return '<div class="tour-hero"><div class="tour-orb done"><img src="/pip-orb.svg" alt="" width="200" height="200"><span class="tour-check">✓</span></div>' +
    '<span class="tour-eyebrow">You’re all set</span><h2>Let’s add your first item.</h2>' +
    '<p>Grab something you’re selling and tap a few buttons. Your Getting started list on Home walks you through the rest. Your first 20 new items every month are free.</p></div>';
  const s = TOUR[step];
  return '<div class="tour-visual tone-' + s.tone + '"><span class="tour-ring r1"></span><span class="tour-ring r2"></span><span class="tour-icon">' + s.icon + '</span>' +
    s.chips.map((c, i) => '<span class="tour-chip c' + i + '">' + esc(c) + '</span>').join('') + '</div>' +
    '<span class="tour-eyebrow">Step ' + (step + 1) + ' of ' + TOUR.length + '</span><h2>' + s.title + '</h2><p>' + s.body + '</p>';
}
function paintTour(dir = 1) {
  if (!tourEl) return;
  const last = tourStep === TOUR.length, first = tourStep === -1;
  const slide = tourEl.querySelector('.tour-slide');
  slide.classList.remove('in-left', 'in-right'); void slide.offsetWidth;
  slide.innerHTML = tourSlide(tourStep);
  slide.classList.add(dir > 0 ? 'in-right' : 'in-left');
  tourEl.querySelector('.tour-dots').innerHTML = first ? '' : TOUR.map((_, i) => '<i class="' + (i === tourStep ? 'on' : i < tourStep ? 'past' : '') + '"></i>').join('') + '<i class="' + (last ? 'on' : '') + '"></i>';
  tourEl.querySelector('[data-tour-skip]').hidden = last || first;
  tourEl.querySelector('[data-tour-back]').hidden = first || last;
  const next = tourEl.querySelector('[data-tour-next]');
  next.textContent = first ? 'Show me around' : last ? 'Add my first item' : 'Next';
  tourEl.querySelector('[data-tour-explore]').hidden = !(first || last);
  tourEl.querySelector('[data-tour-explore]').textContent = first ? 'Skip the tour' : 'I’ll explore first';
}
function openTour() {
  if (tourEl) return;
  tourStep = -1;
  tourEl = document.createElement('div');
  tourEl.className = 'tour'; tourEl.setAttribute('role', 'dialog'); tourEl.setAttribute('aria-modal', 'true'); tourEl.setAttribute('aria-label', 'Welcome to Stockroom');
  tourEl.innerHTML = '<div class="tour-bg"></div><div class="tour-card"><button type="button" class="tour-skip" data-tour-skip>Skip</button>' +
    '<div class="tour-slide" aria-live="polite"></div><div class="tour-dots" aria-hidden="true"></div>' +
    '<div class="tour-actions"><button type="button" class="tour-back" data-tour-back aria-label="Back">←</button><button type="button" class="tour-next" data-tour-next>Next</button></div>' +
    '<button type="button" class="tour-explore" data-tour-explore>Skip the tour</button></div>';
  document.body.appendChild(tourEl);
  document.body.classList.add('tour-open');
  paintTour();
  requestAnimationFrame(() => tourEl.classList.add('open'));
  setTimeout(() => tourEl?.querySelector('[data-tour-next]')?.focus(), 300);
}
function closeTour(addFirst = false) {
  if (!tourEl) return;
  markTourDone();
  const el = tourEl; tourEl = null;
  el.classList.remove('open'); el.classList.add('closing');
  document.body.classList.remove('tour-open');
  setTimeout(() => el.remove(), 450);
  if (addFirst && typeof openItem === 'function') setTimeout(() => openItem(null), 350);
}
function tourGo(dir) {
  const next = tourStep + dir;
  if (next < -1) return;
  if (next > TOUR.length) { closeTour(true); return; }
  tourStep = next; paintTour(dir);
}
document.addEventListener('click', event => {
  const t = event.target;
  if (t.closest('[data-tour-open]')) { document.getElementById('accountMenu')?.removeAttribute('open'); openTour(); return; }
  if (!tourEl || !t.closest('.tour')) return;
  if (t.closest('[data-tour-skip]')) { tourStep = TOUR.length; paintTour(1); return; }
  if (t.closest('[data-tour-explore]')) { closeTour(false); return; }
  if (t.closest('[data-tour-next]')) { tourGo(1); return; }
  if (t.closest('[data-tour-back]')) { tourGo(-1); }
});
document.addEventListener('keydown', event => {
  if (!tourEl) return;
  if (event.key === 'ArrowRight') tourGo(1);
  else if (event.key === 'ArrowLeft') tourGo(-1);
  else if (event.key === 'Escape') closeTour(false);
});
document.addEventListener('touchstart', event => { if (tourEl && event.target.closest('.tour-card')) tourTouch = event.touches[0].clientX; }, {passive: true});
document.addEventListener('touchend', event => {
  if (tourTouch == null || !tourEl) return;
  const dx = event.changedTouches[0].clientX - tourTouch; tourTouch = null;
  if (Math.abs(dx) > 50) tourGo(dx < 0 ? 1 : -1);
}, {passive: true});

// Show it once to new accounts, after the launch screen clears.
function maybeTour() {
  if (typeof account === 'undefined' || !account || typeof db === 'undefined' || !db) return false;
  if (tourDone() || isReadOnly()) return true;
  const live = db.items.filter(i => !i.deletedAt).length;
  if (live === 0 && !(db.trades || []).length) setTimeout(openTour, 500);
  else markTourDone(); // existing users skip it
  return true;
}
(function waitForApp(tries = 0) { if (!maybeTour() && tries < 60) setTimeout(() => waitForApp(tries + 1), 500); })();
// Add "App tour" to the ☰ menu next to Help.
(() => { const help = document.querySelector('.menu-links .menu-help'); if (help && !document.querySelector('[data-tour-open]')) help.insertAdjacentHTML('beforebegin', '<button type="button" data-tour-open><span><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l2.4 5.6L20 9l-4.3 3.9L17 19l-5-3-5 3 1.3-6.1L4 9l5.6-.4Z"/></svg></span>App tour</button>'); })();
