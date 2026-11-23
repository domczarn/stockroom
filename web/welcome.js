'use strict';
(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = id => document.getElementById(id);
  const wait = ms => new Promise(r => setTimeout(r, ms));

  // Scroll progress + nav glass
  const nav = $('nav'), bar = $('progress');
  const onScroll = () => {
    const max = document.documentElement.scrollHeight - innerHeight;
    bar.style.transform = 'scaleX(' + (max > 0 ? scrollY / max : 0) + ')';
    nav.classList.toggle('scrolled', scrollY > 20);
  };
  addEventListener('scroll', onScroll, {passive: true}); onScroll();

  // Count-up numbers
  const countUp = el => {
    const target = Number(el.dataset.count), pre = el.dataset.prefix || '', suf = el.dataset.suffix || '';
    const dec = String(el.dataset.count).includes('.') ? 2 : 0;
    const fmt = v => pre + v.toLocaleString('en-GB', {minimumFractionDigits: dec, maximumFractionDigits: dec}) + suf;
    if (reduce) { el.textContent = fmt(target); return; }
    const start = performance.now(), dur = 1600;
    const tick = now => { const t = Math.min(1, (now - start) / dur), e = 1 - Math.pow(1 - t, 4); el.textContent = fmt(target * e); if (t < 1) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  };

  // Reveal on scroll, and start demos when they're on screen
  const seen = new IntersectionObserver(entries => entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    const el = entry.target;
    el.classList.add('in');
    el.querySelectorAll?.('[data-count]').forEach(countUp);
    seen.unobserve(el);
  }), {threshold: .15, rootMargin: '0px 0px -8% 0px'});
  document.querySelectorAll('.reveal').forEach(el => seen.observe(el));

  const demos = {snap: playSnap, tell: playTell, scan: playScan, numbers: playNumbers};
  const demoSeen = new IntersectionObserver(entries => entries.forEach(entry => {
    const el = entry.target;
    if (entry.isIntersecting && !el.dataset.running) { el.dataset.running = '1'; demos[el.dataset.demo]?.(el); }
  }), {threshold: .35});
  document.querySelectorAll('[data-demo]').forEach(el => demoSeen.observe(el));

  async function typeInto(el, text, speed = 38) {
    el.textContent = '';
    if (reduce) { el.textContent = text; return; }
    for (const ch of text) { el.textContent += ch; await wait(speed + Math.random() * 30); }
  }

  async function playSnap(section) {
    const demo = section.querySelector('.snap-demo');
    for (;;) {
      demo.classList.remove('play'); void demo.offsetWidth; demo.classList.add('play');
      if (reduce) return;
      await wait(9000);
      if (!isVisible(section)) await untilVisible(section);
    }
  }
  async function playTell(section) {
    const input = $('tellType'), cards = [...section.querySelectorAll('.tc')];
    const lines = ['Sold the black Nike hoodie for £25, bought 3 jumpers for £12 at BHF and £4.50 on mailing bags'];
    for (;;) {
      cards.forEach(c => c.classList.remove('in'));
      await typeInto(input, lines[0], 26);
      await wait(500);
      for (const c of cards) { c.classList.add('in'); await wait(reduce ? 0 : 380); }
      if (reduce) return;
      await wait(4200);
      if (!isVisible(section)) await untilVisible(section);
    }
  }
  async function playScan(section) {
    const demo = section.querySelector('.scan-demo');
    for (;;) {
      demo.classList.remove('play'); void demo.offsetWidth; demo.classList.add('play');
      if (reduce) return;
      await wait(8000);
      if (!isVisible(section)) await untilVisible(section);
    }
  }
  function playNumbers(section) {
    section.querySelector('.dash').classList.add('play');
    section.querySelectorAll('[data-count]').forEach(countUp);
  }
  const isVisible = el => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; };
  const untilVisible = el => new Promise(resolve => {
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { io.disconnect(); resolve(); } }, {threshold: .3});
    io.observe(el);
  });

  // Hero phone: the island and Tell Pip bar act out a day in Stockroom.
  const island = $('heroIsland'), islandText = $('heroIslandText'), trail = $('heroIslandTrail'), heroType = $('heroType'), stock = [...document.querySelectorAll('#heroStock li')];
  async function setIsland(text, mood, trailHtml = '', wide = true) {
    islandText.classList.add('swap'); await wait(reduce ? 0 : 200);
    island.dataset.mood = mood; island.classList.toggle('wide', wide);
    islandText.textContent = text; trail.innerHTML = trailHtml; islandText.classList.remove('swap');
  }
  async function heroLoop() {
    document.querySelectorAll('.kpis [data-count]').forEach(countUp);
    if (reduce) { await setIsland('Listing written', 'happy', '<span class="check">✓</span>'); heroType.textContent = 'Sold the RL quarter zip for £28'; return; }
    for (;;) {
      await wait(1400);
      await typeInto(heroType, 'Sold the RL quarter zip for £28', 45);
      await setIsland('Recording the sale', 'think', '<span class="dots">•••</span>');
      await wait(1300);
      stock[0].classList.add('pop'); setTimeout(() => stock[0].classList.remove('pop'), 700);
      await setIsland('Sale saved · +£22 profit', 'happy', '✓');
      await wait(2400);
      await setIsland('1 parcel to post today', 'alert', '📦');
      stock[1].classList.add('pop'); setTimeout(() => stock[1].classList.remove('pop'), 700);
      await wait(2600);
      await setIsland('Writing your listing', 'think', '<span class="dots">•••</span>');
      await wait(1600);
      await setIsland('Listing written', 'happy', '✓');
      await wait(2000);
      await setIsland('Pip is ready', 'idle', '', false);
      heroType.textContent = '';
      await wait(1200);
    }
  }
  void heroLoop();

  // Feature tiles glow under the cursor
  document.querySelectorAll('.tile').forEach(tile => tile.addEventListener('pointermove', e => {
    const r = tile.getBoundingClientRect();
    tile.style.setProperty('--mx', (e.clientX - r.left) + 'px'); tile.style.setProperty('--my', (e.clientY - r.top) + 'px');
  }));
})();
