// Photo studio: one tap turns a stock photo into a clean, square, bright listing photo.
// The server cuts the item out; this file places it on a backdrop with a soft shadow.
const STUDIO_BACKDROPS = [['white', 'White', '#ffffff'], ['soft', 'Soft grey', '#eeeef1'], ['warm', 'Warm', '#f4efe8'], ['dark', 'Dark', '#1d1d22']];
let studio = {index: -1, cutout: null, original: null, backdrop: 'white', result: null, busy: false};

function studioLoad(src) {
  return new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(Error('Couldn’t open that photo.')); img.crossOrigin = 'use-credentials'; img.src = src; });
}
async function studioSource(photo) {
  const img = await studioLoad(photoUrl(photo) || photo);
  const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', .9);
}
// Trim transparent edges, brighten a dull subject, centre it on the backdrop with a soft floor shadow.
async function studioCompose(cutoutUrl, colour) {
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
  const w = maxX - minX + 1, h = maxY - minY + 1, size = 1200, box = size * .82;
  const scale = Math.min(box / w, box / h), dw = w * scale, dh = h * scale, dx = (size - dw) / 2, dy = (size - dh) / 2 - size * .02;
  const out = document.createElement('canvas'); out.width = out.height = size;
  const ctx = out.getContext('2d');
  ctx.fillStyle = colour; ctx.fillRect(0, 0, size, size);
  const shadow = ctx.createRadialGradient(size / 2, dy + dh, 0, size / 2, dy + dh, dw * .55);
  shadow.addColorStop(0, colour === '#1d1d22' ? 'rgba(0,0,0,.55)' : 'rgba(0,0,0,.16)'); shadow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.save(); ctx.translate(0, dy + dh); ctx.scale(1, .12); ctx.fillStyle = shadow; ctx.beginPath(); ctx.arc(size / 2, 0, dw * .55, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  ctx.drawImage(src, minX, minY, w, h, dx, dy, dw, dh);
  return out.toDataURL('image/jpeg', .88);
}

function studioSheet() {
  let d = document.getElementById('studioDialog');
  if (d) return d;
  d = document.createElement('dialog'); d.id = 'studioDialog'; d.className = 'utility-dialog studio-dialog';
  d.innerHTML = '<div class="sheet-heading"><div><span class="eyebrow">PHOTO STUDIO</span><h2>Clean up this photo</h2></div><button type="button" class="close-panel" data-close-dialog="studioDialog" aria-label="Close">×</button></div>' +
    '<div class="studio-stage" id="studioStage"><img id="studioImg" alt="Cleaned-up photo"><div class="studio-busy" id="studioBusy"><span class="studio-pip"></span><b>Pip is cutting it out…</b><small>Takes a few seconds</small></div></div>' +
    '<div class="studio-compare"><button type="button" class="secondary" id="studioHold">Hold to see original</button></div>' +
    '<div class="studio-backdrops" role="radiogroup" aria-label="Backdrop">' + STUDIO_BACKDROPS.map(([k, l, c]) => '<button type="button" role="radio" data-studio-bg="' + k + '"><i data-c="' + c + '"></i>' + l + '</button>').join('') + '</div>' +
    '<p class="footnote" id="studioError" role="alert"></p><button type="button" class="action" id="studioUse" disabled>Use this photo</button>';
  document.body.append(d);
  d.querySelectorAll('[data-c]').forEach(i => { i.style.background = i.dataset.c; });
  return d;
}
function studioSync() {
  document.querySelectorAll('[data-studio-bg]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.studioBg === studio.backdrop)));
  document.getElementById('studioBusy').hidden = !studio.busy;
  document.getElementById('studioUse').disabled = studio.busy || !studio.result;
  const img = document.getElementById('studioImg');
  if (studio.result) img.src = studio.result; else if (studio.original) img.src = studio.original;
  img.classList.toggle('dim', studio.busy);
}
async function openStudio(index) {
  if (account?.plan !== 'pro') { openUpgrade('Photo studio is part of Stockroom Pro.'); return; }
  const photo = draftPhotos[index]; if (!photo) return;
  const d = studioSheet();
  studio = {index, cutout: null, original: null, backdrop: studio.backdrop || 'white', result: null, busy: true};
  document.getElementById('studioError').textContent = '';
  if (!d.open) d.showModal();
  try {
    studio.original = await studioSource(photo); studioSync();
    const {cutout} = await api('/api/pip/studio', {method: 'POST', body: JSON.stringify({image: studio.original})});
    studio.cutout = cutout;
    studio.result = await studioCompose(cutout, STUDIO_BACKDROPS.find(b => b[0] === studio.backdrop)[2]);
  } catch (error) { document.getElementById('studioError').textContent = error.message; }
  studio.busy = false; studioSync();
}
document.addEventListener('click', async event => {
  const open = event.target.closest('[data-studio-photo]');
  if (open) { event.preventDefault(); await openStudio(Number(open.dataset.studioPhoto)); return; }
  const bg = event.target.closest('[data-studio-bg]');
  if (bg && studio.cutout && !studio.busy) {
    studio.backdrop = bg.dataset.studioBg; studio.busy = true; studioSync();
    try { studio.result = await studioCompose(studio.cutout, STUDIO_BACKDROPS.find(b => b[0] === studio.backdrop)[2]); } catch (error) { document.getElementById('studioError').textContent = error.message; }
    studio.busy = false; studioSync(); return;
  }
  if (event.target.closest('#studioUse') && studio.result && draftPhotos[studio.index] !== undefined) {
    draftPhotos[studio.index] = studio.result;
    renderPhotos(); if (typeof updateListingChecks === 'function') updateListingChecks();
    document.getElementById('studioDialog').close(); toast('Photo cleaned up. Save the item to keep it.');
  }
});
const studioPeek = on => { const img = document.getElementById('studioImg'); if (img && studio.original && studio.result) img.src = on ? studio.original : studio.result; };
document.addEventListener('pointerdown', e => { if (e.target.closest('#studioHold')) studioPeek(true); });
['pointerup', 'pointerleave', 'pointercancel'].forEach(t => document.addEventListener(t, e => { if (e.target.closest?.('#studioHold')) studioPeek(false); }));
