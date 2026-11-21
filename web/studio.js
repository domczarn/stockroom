// Photo studio: cut the item out (server) and place it on a reseller-style backdrop with a shadow (here, on the phone).
// Used in two places: the ✨ Studio button on a stock photo, and the Photo studio section for batches.
const STUDIO_BACKDROPS = [
  ['white', 'White'], ['studio', 'Studio sweep'], ['marble', 'Marble'], ['marble-dark', 'Dark marble'],
  ['linen', 'Linen'], ['lilac', 'Pip lilac'], ['soft', 'Soft grey'], ['dark', 'Dark'],
];
const STUDIO_SHADOWS = [['soft', 'Soft shadow'], ['drop', 'Drop shadow'], ['none', 'No shadow']];
const studioPrefs = (() => { try { return JSON.parse(localStorage.getItem('stockroom-studio') || '{}'); } catch { return {}; } })();
let studioBackdrop = STUDIO_BACKDROPS.some(b => b[0] === studioPrefs.backdrop) ? studioPrefs.backdrop : 'marble';
let studioShadow = STUDIO_SHADOWS.some(s => s[0] === studioPrefs.shadow) ? studioPrefs.shadow : 'soft';
const studioSavePrefs = () => { try { localStorage.setItem('stockroom-studio', JSON.stringify({backdrop: studioBackdrop, shadow: studioShadow})); } catch {} };

// ---------- Backdrops ----------
function studioRand(seed) { return () => (seed = (seed * 9301 + 49297) % 233280) / 233280; }
// Marble veins: a wandering random walk, drawn far off-canvas so only its blurred shadow lands (Safari has no canvas filters).
function studioVeins(ctx, size, rand, colour, count, blurMax, widthMax) {
  const off = size * 3;
  for (let v = 0; v < count; v++) {
    let x = rand() * size * .6 - size * .2, y = rand() * size, angle = -.6 + rand() * 1.2 + (rand() < .5 ? 0 : .25);
    const steps = 60 + Math.floor(rand() * 60), step = size / 55;
    let width = .4 + rand() * widthMax;
    ctx.save();
    ctx.shadowColor = colour; ctx.shadowBlur = 1 + rand() * blurMax; ctx.shadowOffsetX = off;
    ctx.strokeStyle = '#000'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (let i = 0; i < steps; i++) {
      const nx = x + Math.cos(angle) * step, ny = y + Math.sin(angle) * step;
      angle += (rand() - .5) * .55; width = Math.max(.3, Math.min(widthMax * 1.4, width + (rand() - .5) * .5));
      ctx.lineWidth = width; ctx.beginPath(); ctx.moveTo(x - off, y); ctx.lineTo(nx - off, ny); ctx.stroke();
      if (rand() < .025) { // a thin branch
        let bx = nx, by = ny, ba = angle + (rand() < .5 ? -1 : 1) * (.5 + rand() * .6);
        ctx.lineWidth = Math.max(.3, width * .45);
        for (let k = 0; k < 14; k++) { const ex = bx + Math.cos(ba) * step * .8, ey = by + Math.sin(ba) * step * .8; ba += (rand() - .5) * .6; ctx.beginPath(); ctx.moveTo(bx - off, by); ctx.lineTo(ex - off, ey); ctx.stroke(); bx = ex; by = ey; }
      }
      x = nx; y = ny;
    }
    ctx.restore();
  }
}
function studioSpeckle(ctx, size, rand, rgb, n, alpha) {
  for (let i = 0; i < n; i++) { ctx.fillStyle = 'rgba(' + rgb + ',' + (alpha * rand()).toFixed(3) + ')'; ctx.fillRect(rand() * size, rand() * size, 1 + rand() * 1.5, 1 + rand() * 1.5); }
}
function studioPaint(ctx, size, key, seed) {
  const rand = studioRand(seed || 11);
  const solid = {white: '#ffffff', soft: '#eeeef1', dark: '#1d1d22'}[key];
  if (solid) { ctx.fillStyle = solid; ctx.fillRect(0, 0, size, size); return; }
  if (key === 'studio') {
    const g = ctx.createLinearGradient(0, 0, 0, size); g.addColorStop(0, '#e6e6ea'); g.addColorStop(.58, '#f4f4f6'); g.addColorStop(1, '#fbfbfc');
    ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
    const r = ctx.createRadialGradient(size / 2, size * .72, 0, size / 2, size * .72, size * .7); r.addColorStop(0, 'rgba(255,255,255,.9)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = r; ctx.fillRect(0, 0, size, size); return;
  }
  if (key === 'marble' || key === 'marble-dark') {
    const dark = key === 'marble-dark';
    ctx.fillStyle = dark ? '#1c1c1f' : '#f3f1ed'; ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 6; i++) { // cloudy patches
      const x = rand() * size, y = rand() * size, r = size * (.25 + rand() * .35), g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, dark ? 'rgba(255,255,255,.05)' : 'rgba(200,196,190,.18)'); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
    }
    studioVeins(ctx, size, rand, dark ? 'rgba(235,230,222,.22)' : 'rgba(120,112,104,.22)', 4, 22, 9);  // soft clouds of vein
    studioVeins(ctx, size, rand, dark ? 'rgba(240,236,230,.45)' : 'rgba(96,90,84,.42)', 5, 3, 2.4);   // main veins
    studioVeins(ctx, size, rand, dark ? 'rgba(255,255,255,.28)' : 'rgba(110,104,98,.3)', 9, 1.5, .9); // hairlines
    studioSpeckle(ctx, size, rand, dark ? '255,255,255' : '80,76,70', 2500, .08); return;
  }
  if (key === 'linen') {
    ctx.fillStyle = '#ebe4d9'; ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 2600; i++) { // woven threads
      const a = (.02 + rand() * .05).toFixed(3), x = rand() * size, y = rand() * size, l = 6 + rand() * 26;
      ctx.fillStyle = (i % 2 ? 'rgba(120,100,80,' : 'rgba(255,255,255,') + a + ')';
      if (i % 3) ctx.fillRect(x, y, l, 1); else ctx.fillRect(x, y, 1, l);
    }
    const v = ctx.createRadialGradient(size / 2, size / 2, size * .3, size / 2, size / 2, size * .75); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(60,45,30,.12)');
    ctx.fillStyle = v; ctx.fillRect(0, 0, size, size); return;
  }
  if (key === 'lilac') {
    const g = ctx.createRadialGradient(size / 2, size * .45, size * .05, size / 2, size / 2, size * .75); g.addColorStop(0, '#f6f3ff'); g.addColorStop(1, '#d9d0ff');
    ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
    const nodes = Array.from({length: 26}, () => [rand() * size, rand() * size]); // a faint Pip network
    ctx.strokeStyle = 'rgba(139,124,246,.18)'; ctx.lineWidth = 1.2;
    nodes.forEach((a, i) => nodes.forEach((b, j) => { if (j > i && Math.hypot(a[0] - b[0], a[1] - b[1]) < size * .2) { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); } }));
    ctx.fillStyle = 'rgba(139,124,246,.35)'; nodes.forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill(); });
  }
}
const studioIsDark = key => key === 'dark' || key === 'marble-dark';

// ---------- Compose ----------
function studioLoad(src) {
  return new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(Error('Couldn’t open that photo.')); img.src = src; });
}
async function studioSource(photo) {
  const img = await studioLoad(typeof photoUrl === 'function' ? (photoUrl(photo) || photo) : photo);
  const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', .9);
}
async function studioCompose(cutoutUrl, backdrop = studioBackdrop, shadow = studioShadow, seed = 11) {
  const img = await studioLoad(cutoutUrl);
  const src = document.createElement('canvas'); src.width = img.naturalWidth; src.height = img.naturalHeight;
  const sctx = src.getContext('2d', {willReadFrequently: true}); sctx.drawImage(img, 0, 0);
  const data = sctx.getImageData(0, 0, src.width, src.height), px = data.data;
  let minX = src.width, minY = src.height, maxX = 0, maxY = 0, lum = 0, count = 0;
  for (let y = 0; y < src.height; y++) for (let x = 0; x < src.width; x++) {
    const i = (y * src.width + x) * 4;
    if (px[i + 3] > 24) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; lum += .2126 * px[i] + .7152 * px[i + 1] + .0722 * px[i + 2]; count++; }
  }
  if (!count) throw Error('Pip couldn’t find the item in that photo.');
  const mean = lum / count / 255, gain = mean < .42 ? Math.min(1.35, .5 / mean) : 1;
  if (gain > 1.01) { for (let i = 0; i < px.length; i += 4) if (px[i + 3]) { px[i] = Math.min(255, px[i] * gain); px[i + 1] = Math.min(255, px[i + 1] * gain); px[i + 2] = Math.min(255, px[i + 2] * gain); } sctx.putImageData(data, 0, 0); }
  const w = maxX - minX + 1, h = maxY - minY + 1, size = 1200, box = size * .8;
  const scale = Math.min(box / w, box / h), dw = w * scale, dh = h * scale, dx = (size - dw) / 2, dy = (size - dh) / 2 - size * .025;
  const out = document.createElement('canvas'); out.width = out.height = size;
  const ctx = out.getContext('2d');
  studioPaint(ctx, size, backdrop, seed);
  const dark = studioIsDark(backdrop);
  if (shadow === 'soft') { // contact shadow on the floor plus a little ambient lift
    const s = ctx.createRadialGradient(size / 2, dy + dh, 0, size / 2, dy + dh, dw * .55);
    s.addColorStop(0, dark ? 'rgba(0,0,0,.6)' : 'rgba(0,0,0,.2)'); s.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save(); ctx.translate(0, dy + dh); ctx.scale(1, .12); ctx.fillStyle = s; ctx.beginPath(); ctx.arc(size / 2, 0, dw * .55, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    ctx.save(); ctx.shadowColor = dark ? 'rgba(0,0,0,.5)' : 'rgba(0,0,0,.12)'; ctx.shadowBlur = 30; ctx.shadowOffsetY = 8;
    ctx.drawImage(src, minX, minY, w, h, dx, dy, dw, dh); ctx.restore();
  } else if (shadow === 'drop') {
    ctx.save(); ctx.shadowColor = dark ? 'rgba(0,0,0,.65)' : 'rgba(30,25,40,.3)'; ctx.shadowBlur = 50; ctx.shadowOffsetX = 14; ctx.shadowOffsetY = 26;
    ctx.drawImage(src, minX, minY, w, h, dx, dy, dw, dh); ctx.restore();
  }
  ctx.drawImage(src, minX, minY, w, h, dx, dy, dw, dh);
  return out.toDataURL('image/jpeg', .88);
}
async function studioCutout(original) {
  const {cutout} = await api('/api/pip/studio', {method: 'POST', body: JSON.stringify({image: original})});
  return cutout;
}
function studioPickers() {
  return '<div class="studio-backdrops" role="radiogroup" aria-label="Backdrop">' + STUDIO_BACKDROPS.map(([k, l]) => '<button type="button" role="radio" data-studio-bg="' + k + '" aria-checked="' + (k === studioBackdrop) + '"><i class="sw sw-' + k + '"></i>' + l + '</button>').join('') + '</div>' +
    '<div class="view-tabs studio-shadows" role="radiogroup" aria-label="Shadow">' + STUDIO_SHADOWS.map(([k, l]) => '<button type="button" role="radio" data-studio-shadow="' + k + '" aria-selected="' + (k === studioShadow) + '">' + l + '</button>').join('') + '</div>';
}

// ---------- In the item editor: one photo ----------
let studio = {index: -1, cutout: null, original: null, result: null, busy: false};
function studioSheet() {
  let d = document.getElementById('studioDialog');
  if (!d) { d = document.createElement('dialog'); d.id = 'studioDialog'; d.className = 'utility-dialog studio-dialog'; document.body.append(d); }
  return d;
}
function studioSync() {
  const d = studioSheet();
  d.innerHTML = '<div class="sheet-heading"><div><span class="eyebrow">PHOTO STUDIO</span><h2>Clean up this photo</h2></div><button type="button" class="close-panel" data-close-dialog="studioDialog" aria-label="Close">×</button></div>' +
    '<div class="studio-stage"><img id="studioImg" alt="Cleaned-up photo" src="' + (studio.result || studio.original || '') + '"' + (studio.busy ? ' class="dim"' : '') + '>' +
      (studio.busy ? '<div class="studio-busy"><span class="studio-pip"></span><b>Pip is cutting it out…</b><small>Takes a few seconds</small></div>' : '') + '</div>' +
    '<div class="studio-compare"><button type="button" class="secondary" id="studioHold">Hold to see original</button></div>' + studioPickers() +
    '<p class="footnote" role="alert">' + esc(studio.error || '') + '</p><button type="button" class="action" id="studioUse"' + (studio.busy || !studio.result ? ' disabled' : '') + '>Use this photo</button>';
}
async function openStudio(index) {
  if (account?.plan !== 'pro') { openUpgrade('Photo studio is part of Stockroom Pro.'); return; }
  const photo = draftPhotos[index]; if (!photo) return;
  studio = {index, cutout: null, original: null, result: null, busy: true};
  const d = studioSheet(); studioSync(); if (!d.open) d.showModal();
  try { studio.original = await studioSource(photo); studioSync(); studio.cutout = await studioCutout(studio.original); studio.result = await studioCompose(studio.cutout); }
  catch (error) { studio.error = error.message; }
  studio.busy = false; studioSync();
}

// ---------- Photo studio section: batches ----------
let studioJobs = [], studioRunning = false;
function studioView() {
  const items = (db?.items || []).filter(i => !i.deletedAt && (i.photos || []).length).slice(0, 200);
  const done = studioJobs.filter(j => j.result).length;
  return '<section class="panel studio-hero"><span class="aura aura-lg" aria-hidden="true">' + STUDIO_ICON + '</span><div><h2>Make every photo look pro</h2><p>Pip cuts your item out and places it on marble, linen or a studio backdrop with a soft shadow. Square, bright and ready for Vinted.</p>' +
      '<div class="studio-add"><label class="action studio-upload">＋ Add photos<input type="file" id="studioFiles" accept="image/*" multiple hidden></label>' +
      (items.length ? '<select id="studioFromStock" aria-label="Use photos from a stock item"><option value="">Or pick from your stock…</option>' + items.map(i => '<option value="' + esc(i.id) + '">#' + esc(i.id) + ' ' + esc(i.name) + ' (' + i.photos.length + ')</option>').join('') + '</select>' : '') + '</div></div></section>' +
    (studioJobs.length ? '<section class="panel studio-controls"><h3>Look</h3>' + studioPickers() + '</section>' +
      '<div class="studio-grid">' + studioJobs.map((j, n) => '<figure class="studio-card ' + j.status + '">' +
        '<div class="studio-card-img"><img src="' + (j.result || j.src) + '" alt="Photo ' + (n + 1) + '">' + (j.status === 'working' || j.status === 'queued' ? '<div class="studio-busy"><span class="studio-pip"></span><b>' + (j.status === 'working' ? 'Cutting out…' : 'Waiting…') + '</b></div>' : '') + '</div>' +
        '<figcaption>' + (j.error ? '<small class="studio-err">' + esc(j.error) + '</small>' : '<small>' + esc(j.label) + '</small>') +
        '<div class="studio-card-actions">' + (j.result ? '<button type="button" class="secondary" data-studio-save="' + n + '">Save image</button>' + (j.itemId ? '<button type="button" class="secondary" data-studio-apply="' + n + '">' + (j.applied ? 'Saved to item ✓' : 'Use on item') + '</button>' : '') : '') +
        '<button type="button" class="link" data-studio-remove="' + n + '" aria-label="Remove">Remove</button></div></figcaption></figure>').join('') + '</div>' +
      (done > 1 ? '<button type="button" class="secondary studio-all" data-studio-save-all>Save all ' + done + ' images</button>' : '')
      : '<p class="footnote studio-tip">Tip: shoot on any background in good light. Pip does the rest.</p>');
}
const STUDIO_ICON = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h2.5L8 6h8l1.5 2H20a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13" r="3.2"/><path d="M19 3.5v2M18 4.5h2"/></svg>';
const studioRefresh = () => { if (tab === 'Studio') render(); };
async function studioQueue(sources) {
  if (account?.plan !== 'pro') { openUpgrade('Photo studio is part of Stockroom Pro.'); return; }
  studioJobs.push(...sources.map(s => ({...s, status: 'queued', seed: 11 + studioJobs.length})));
  studioRefresh();
  if (studioRunning) return;
  studioRunning = true;
  for (let job; (job = studioJobs.find(j => j.status === 'queued'));) {
    job.status = 'working'; studioRefresh();
    try { job.cutout = await studioCutout(job.src); job.result = await studioCompose(job.cutout, studioBackdrop, studioShadow, job.seed); job.status = 'done'; }
    catch (error) { job.status = 'error'; job.error = error.message; }
    studioRefresh();
  }
  studioRunning = false;
}
async function studioRecomposeAll() {
  for (const j of studioJobs.filter(j => j.cutout)) { try { j.result = await studioCompose(j.cutout, studioBackdrop, studioShadow, j.seed); j.applied = false; } catch {} }
  studioRefresh();
}
async function studioSaveImage(job, n) {
  const [, b64] = job.result.split(','), bin = atob(b64), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const blob = new Blob([bytes], {type: 'image/jpeg'});
  const name = 'stockroom-' + (job.itemId ? job.itemId + '-' : '') + (n + 1) + '.jpg';
  if (blob && navigator.canShare?.({files: [new File([blob], name, {type: 'image/jpeg'})]})) {
    try { await navigator.share({files: [new File([blob], name, {type: 'image/jpeg'})]}); return; } catch (e) { if (e?.name === 'AbortError') return; }
  }
  const a = document.createElement('a'); a.href = job.result; a.download = name; a.click();
}

// ---------- Events ----------
document.addEventListener('click', async event => {
  const t = event.target;
  const open = t.closest('[data-studio-photo]');
  if (open) { event.preventDefault(); await openStudio(Number(open.dataset.studioPhoto)); return; }
  const bg = t.closest('[data-studio-bg]'), sh = t.closest('[data-studio-shadow]');
  if (bg || sh) {
    if (bg) studioBackdrop = bg.dataset.studioBg; if (sh) studioShadow = sh.dataset.studioShadow; studioSavePrefs();
    if (t.closest('#studioDialog')) {
      if (studio.cutout && !studio.busy) { studio.busy = true; studioSync(); try { studio.result = await studioCompose(studio.cutout); } catch (e) { studio.error = e.message; } studio.busy = false; }
      studioSync();
    } else { studioRefresh(); await studioRecomposeAll(); }
    return;
  }
  if (t.closest('#studioUse') && studio.result && draftPhotos[studio.index] !== undefined) {
    draftPhotos[studio.index] = studio.result; renderPhotos(); if (typeof updateListingChecks === 'function') updateListingChecks();
    studioSheet().close(); toast('Photo cleaned up. Save the item to keep it.'); return;
  }
  const save = t.closest('[data-studio-save]');
  if (save) { await studioSaveImage(studioJobs[Number(save.dataset.studioSave)], Number(save.dataset.studioSave)); return; }
  if (t.closest('[data-studio-save-all]')) { for (const [n, j] of studioJobs.entries()) if (j.result) { await studioSaveImage(j, n); await new Promise(r => setTimeout(r, 400)); } return; }
  const rm = t.closest('[data-studio-remove]');
  if (rm) { studioJobs.splice(Number(rm.dataset.studioRemove), 1); studioRefresh(); return; }
  const apply = t.closest('[data-studio-apply]');
  if (apply) {
    const job = studioJobs[Number(apply.dataset.studioApply)];
    if (!job?.result || job.applied || isReadOnly()) return;
    apply.disabled = true;
    try {
      const next = cloneWorkspace(db), item = next.items.find(i => i.id === job.itemId);
      if (!item || !item.photos?.[job.photoIndex]) throw Error('That photo has changed. Open the item instead.');
      item.photos[job.photoIndex] = job.result; await persist(next); job.applied = true; toast('Saved to #' + job.itemId + '.'); studioRefresh();
    } catch (error) { toast(error.message); apply.disabled = false; }
  }
});
document.addEventListener('change', async event => {
  if (event.target.id === 'studioFiles') {
    const files = [...event.target.files].slice(0, 12); event.target.value = '';
    const sources = [];
    for (const f of files) { try { const url = URL.createObjectURL(f); sources.push({src: await studioSource(url), label: f.name.replace(/\.[^.]+$/, '').slice(0, 40)}); URL.revokeObjectURL(url); } catch {} }
    if (sources.length) await studioQueue(sources);
  }
  if (event.target.id === 'studioFromStock' && event.target.value) {
    const item = db.items.find(i => i.id === event.target.value); event.target.value = '';
    if (!item) return;
    const sources = [];
    for (const [i, p] of (item.photos || []).entries()) { try { sources.push({src: await studioSource(p), label: '#' + item.id + ' ' + item.name + ' · photo ' + (i + 1), itemId: item.id, photoIndex: i}); } catch {} }
    if (sources.length) await studioQueue(sources); else toast('Couldn’t open that item’s photos.');
  }
});
const studioPeek = on => { const img = document.getElementById('studioImg'); if (img && studio.original && studio.result) img.src = on ? studio.original : studio.result; };
document.addEventListener('pointerdown', e => { if (e.target.closest('#studioHold')) studioPeek(true); });
['pointerup', 'pointerleave', 'pointercancel'].forEach(t => document.addEventListener(t, e => { if (e.target.closest?.('#studioHold')) studioPeek(false); }));
