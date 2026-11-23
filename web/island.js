'use strict';
// Pip Island: a Dynamic Island-style pill at the top of the app. It springs open while Pip works,
// morphs into the result, then tucks itself away. Pip lives inside it and reacts with a face.

const pipFaceSvg = (size = 28) => '<svg class="pipface" viewBox="0 0 40 40" width="' + size + '" height="' + size + '" aria-hidden="true">' +
  '<defs><radialGradient id="pfg" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#e4deff"/><stop offset=".45" stop-color="#a596ff"/><stop offset="1" stop-color="#5b48d6"/></radialGradient></defs>' +
  '<g class="pf-orbit"><circle cx="20" cy="2.5" r="1.6"/><circle cx="37.5" cy="20" r="1.2"/><circle cx="20" cy="37.5" r="1.4"/></g>' +
  '<g class="pf-body"><circle cx="20" cy="20" r="14" fill="url(#pfg)"/><ellipse cx="15" cy="13.5" rx="5" ry="3" fill="#fff" opacity=".35"/>' +
  '<g class="pf-eyes"><rect class="pf-eye" x="13.2" y="17" width="3.6" height="6" rx="1.8"/><rect class="pf-eye" x="23.2" y="17" width="3.6" height="6" rx="1.8"/></g>' +
  '<g class="pf-joy"><path d="M12.8 21.5q2.2-3.4 4.4 0M22.8 21.5q2.2-3.4 4.4 0"/></g>' +
  '<g class="pf-oh"><path d="M12.6 16.6l3.8-1.5M27.4 16.6l-3.8-1.5"/></g></g></svg>';

const island = (() => {
  let el, inner, timer = 0, queue = [], current = null, thinking = 0, thinkLabel = '';
  const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  function mount() {
    if (el) return;
    el = document.createElement('div');
    el.id = 'pipIsland'; el.className = 'island'; el.dataset.state = 'gone'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
    el.innerHTML = '<button type="button" class="island-inner"><span class="island-pip">' + pipFaceSvg(26) + '</span><span class="island-copy"><b></b><small></small></span><span class="island-trail"></span></button>';
    document.body.appendChild(el);
    inner = el.querySelector('.island-inner');
    inner.addEventListener('click', () => {
      if (current?.action) { const a = current.action; hide(); a(); return; }
      if (el.dataset.state === 'compact' && current) { size('expanded'); clearTimeout(timer); timer = setTimeout(hide, 4000); }
      else hide();
    });
  }
  // Animate to the content's natural size, so the pill morphs like the real island.
  function size(state) {
    el.dataset.state = state;
    const copy = el.querySelector('.island-copy');
    const w = state === 'gone' ? 36 : state === 'think' ? Math.min(innerWidth - 24, 260, 92 + copy.querySelector('b').scrollWidth) : Math.min(innerWidth - 24, 300, Math.max(180, 62 + (state === 'compact' ? Math.min(copy.querySelector('b').scrollWidth, 150) : Math.max(copy.querySelector('b').scrollWidth, copy.querySelector('small').scrollWidth)) + 44));
    const h = state === 'gone' ? 36 : state === 'expanded' && current?.sub ? 64 : 40;
    el.style.setProperty('--iw', w + 'px'); el.style.setProperty('--ih', h + 'px');
  }
  function paint({title = '', sub = '', mood = 'idle', trail = ''}) {
    mount();
    el.dataset.mood = mood;
    el.querySelector('.island-copy b').textContent = title;
    el.querySelector('.island-copy small').textContent = sub;
    el.querySelector('.island-trail').innerHTML = trail;
  }
  function hide() {
    clearTimeout(timer); current = null;
    if (!el) return;
    if (thinking) { showThink(); return; }
    size('gone'); el.dataset.mood = 'idle';
    setTimeout(() => { if (el.dataset.state === 'gone' && queue.length) next(); }, reduce() ? 50 : 380);
  }
  function next() {
    const n = queue.shift();
    if (!n) return;
    current = n; paint(n);
    requestAnimationFrame(() => size(n.sub || n.title.length > 26 ? 'expanded' : 'compact'));
    if (n.haptic && navigator.vibrate) try { navigator.vibrate(n.haptic); } catch {}
    clearTimeout(timer); timer = setTimeout(hide, n.duration || 3400);
  }
  function show(n) {
    mount();
    if (thinking && !n.fromThink) { queue.push(n); return; }
    if (current && el.dataset.state !== 'gone') { queue.push(n); clearTimeout(timer); timer = setTimeout(hide, 900); return; }
    queue.push(n); next();
  }
  function showThink() {
    paint({title: thinkLabel || 'Pip is on it', mood: 'think', trail: '<span class="island-wave"><i></i><i></i><i></i></span>'});
    requestAnimationFrame(() => size('think'));
  }
  function think(label) {
    mount(); thinking++; thinkLabel = label; clearTimeout(timer); current = null; showThink();
  }
  function done(ok, message) {
    thinking = Math.max(0, thinking - 1);
    if (thinking) return;
    show({fromThink: true, title: message || (ok ? 'Done' : 'Pip hit a snag'), mood: ok ? 'happy' : 'sad', duration: ok ? 1800 : 4200,
      trail: ok ? '<span class="island-check"><svg viewBox="0 0 20 20" width="18" height="18"><path d="M5 10.5l3.2 3.2L15 6.8"/></svg></span>' : '<span class="island-x">!</span>', haptic: ok ? 12 : [20, 40, 20]});
  }
  return {show, think, done, hide};
})();

// Pip's AI calls drive the island automatically.
const ISLAND_LABELS = [
  [/write-listing/, 'Writing your listing', 'Listing written'], [/\/api\/pip\/scan/, 'Pricing it up', 'Verdict ready'],
  [/\/api\/pip\/ask/, 'Pip is thinking', 'Answer ready'], [/\/api\/pip\/offer/, 'Weighing the offer', 'Reply ready'],
  [/\/api\/pip\/measure/, 'Measuring', 'Measured'], [/\/api\/pip\/crosslist/, 'Writing Depop & eBay', 'Both written'],
  [/\/api\/studio/, 'Cutting out your photo', 'Photo ready'], [/\/api\/vision\//, 'Reading the screenshot', 'Read it']
];
const islandFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input?.url || '';
  const match = (init?.method || 'GET').toUpperCase() === 'POST' && ISLAND_LABELS.find(([re]) => re.test(url));
  if (!match) return islandFetch(input, init);
  island.think(match[1]);
  try {
    const response = await islandFetch(input, init);
    let message = match[2];
    if (!response.ok) { try { const e = (await response.clone().json()).error; message = typeof e === 'string' ? e : e?.message || 'Pip hit a snag'; } catch { message = 'Pip hit a snag'; } }
    island.done(response.ok, message);
    return response;
  } catch (error) { island.done(false, 'No connection. Try again.'); throw error; }
};

// Every app message goes through the island instead of a plain toast.
const islandMood = m => /couldn|can’t|cannot|failed|error|try again|not |no connection|invalid/i.test(m) ? 'sad' : /saved|done|set to|sold|copied|updated|added|restarted|deleted|posted|ready|synced|welcome/i.test(m) ? 'happy' : 'idle';
// eslint-disable-next-line no-global-assign
toast = function (message) {
  const text = String(message || '').trim();
  if (!text) return;
  const mood = islandMood(text);
  const parts = text.split(/(?<=\.)\s+/);
  island.show({title: parts[0].replace(/\.$/, ''), sub: parts.slice(1).join(' '), mood, duration: 2600 + Math.min(text.length * 40, 3000),
    trail: mood === 'happy' ? '<span class="island-check"><svg viewBox="0 0 20 20" width="18" height="18"><path d="M5 10.5l3.2 3.2L15 6.8"/></svg></span>' : '', haptic: mood === 'sad' ? [20, 40, 20] : 0});
};

// Once a day, Pip pops up with parcels that need posting.
setTimeout(function shipNudge() {
  if (typeof db === 'undefined' || !db || typeof shipInfo !== 'function' || typeof lastTrade !== 'function') return void setTimeout(shipNudge, 1500);
  const today = todayUK();
  try { if (localStorage.getItem('islandShip') === today) return; } catch {}
  const due = db.items.filter(i => i.status === 'Sold').map(i => lastTrade(db, i.id)).filter(t => t && tradeStatus(t) === 'Sold' && saleRemaining(t) > 0)
    .map(t => shipInfo(t, today)).filter(s => s.level === 'urgent' || s.level === 'soon');
  if (!due.length) return;
  const now = due.filter(s => s.level === 'urgent').length;
  try { localStorage.setItem('islandShip', today); } catch {}
  island.show({title: now ? now + ' parcel' + (now === 1 ? '' : 's') + ' to post today' : due.length + ' parcel' + (due.length === 1 ? '' : 's') + ' due tomorrow', sub: 'Tap to see what to post', mood: 'alert', duration: 6000,
    trail: '<span class="island-parcel">📦</span>', action: () => { if (typeof navigate === 'function') navigate('Dashboard'); }});
}, 2500);
