'use strict';
// Screenshot importer: turn Vinted listing screenshots into item photos.
// Each screenshot is auto-cropped to the listing photo, paired with an item that still needs photos,
// and attached in one save.

const shotState = {rows: [], busy: false};

// Find the photo in a phone screenshot: rows of a listing photo vary a lot in brightness,
// app chrome (bars, text on flat backgrounds) does not. Take the longest run of "busy" rows.
async function cropListingPhoto(file) {
  const bitmap = await createImageBitmap(file);
  try {
    const sampleW = 120, sampleH = Math.max(1, Math.round(bitmap.height * sampleW / bitmap.width));
    const probe = document.createElement('canvas');
    probe.width = sampleW; probe.height = sampleH;
    const pctx = probe.getContext('2d', {willReadFrequently: true});
    pctx.drawImage(bitmap, 0, 0, sampleW, sampleH);
    const pixels = pctx.getImageData(0, 0, sampleW, sampleH).data;
    const busy = [];
    for (let y = 0; y < sampleH; y++) {
      let sum = 0, sq = 0, edges = 0, prev = 0;
      for (let x = 0; x < sampleW; x++) {
        const i = (y * sampleW + x) * 4, l = pixels[i] * .299 + pixels[i + 1] * .587 + pixels[i + 2] * .114;
        sum += l; sq += l * l; if (x && Math.abs(l - prev) > 18) edges++; prev = l;
      }
      const mean = sum / sampleW, sd = Math.sqrt(Math.max(0, sq / sampleW - mean * mean));
      busy.push(sd > 22 && edges > 6);
    }
    let best = [0, 0], start = -1, gap = 0;
    for (let y = 0; y <= sampleH; y++) {
      if (y < sampleH && busy[y]) { if (start < 0) start = y; gap = 0; }
      else if (start >= 0 && (gap++ > 3 || y === sampleH)) {
        const end = y - gap;
        if (end - start > best[1] - best[0]) best = [start, end];
        start = -1; gap = 0;
      }
    }
    const scale = bitmap.height / sampleH;
    let top = Math.round(best[0] * scale), bottom = Math.round(best[1] * scale);
    const cropped = bottom - top >= bitmap.height * 0.22;
    if (!cropped) { top = 0; bottom = bitmap.height; }
    const outW = Math.min(1200, bitmap.width), outH = Math.round((bottom - top) * outW / bitmap.width);
    const out = document.createElement('canvas');
    out.width = outW; out.height = outH;
    const octx = out.getContext('2d');
    octx.fillStyle = '#fff'; octx.fillRect(0, 0, outW, outH);
    octx.drawImage(bitmap, 0, top, bitmap.width, bottom - top, 0, 0, outW, outH);
    return {cropped, image: out.toDataURL('image/jpeg', 0.82)};
  } finally { bitmap.close(); }
}

const needsPhotos = () => db.items
  .filter(item => !item.deletedAt && item.status === 'In Stock')
  .sort((a, b) => (a.photos?.length || 0) - (b.photos?.length || 0) || String(b.purchasedAt || '').localeCompare(String(a.purchasedAt || '')) || String(b.id).localeCompare(String(a.id)));

function shotDialog() {
  let dialog = document.getElementById('shotImport');
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.id = 'shotImport';
  dialog.className = 'shot-dialog';
  dialog.innerHTML = '<div class="sheet-heading"><div><h2>Add photos from screenshots</h2><p>Pick your Vinted screenshots. Stockroom crops each one to the listing photo and pairs it with an item that needs photos.</p></div>' +
    '<button type="button" class="close-panel" data-shot-close aria-label="Close">✕</button></div>' +
    '<label class="shot-pick"><input type="file" id="shotFiles" accept="image/*" multiple hidden><span class="shot-pick-icon">＋</span><strong>Choose screenshots</strong><small>Select several at once from Photos</small></label>' +
    '<div id="shotRows" class="shot-rows"></div><p id="shotError" class="shot-error" role="alert"></p>' +
    '<div class="shot-footer"><button type="button" class="secondary" data-shot-close>Cancel</button><button type="button" class="action" id="shotSave" disabled>Attach photos</button></div>';
  document.body.append(dialog);
  dialog.querySelector('#shotFiles').onchange = event => addShots([...event.target.files]).finally(() => { event.target.value = ''; });
  return dialog;
}

function renderShots() {
  const items = needsPhotos();
  const rows = document.getElementById('shotRows');
  rows.innerHTML = shotState.rows.map((row, index) =>
    '<div class="shot-row"><img alt="" src="' + (row.useCrop ? row.cropped : row.full) + '">' +
    '<div class="shot-row-body"><label>Item<select data-shot-item="' + index + '"><option value="">Skip this screenshot</option>' +
      items.map(item => '<option value="' + esc(item.id) + '"' + (item.id === row.itemId ? ' selected' : '') + '>' + esc(item.name) + ' · ' + gbp(item.cost) +
        ((item.photos?.length || 0) ? ' · ' + item.photos.length + ' photo' + (item.photos.length === 1 ? '' : 's') : ' · needs photos') + '</option>').join('') + '</select></label>' +
    (row.canCrop ? '<button type="button" class="link" data-shot-crop="' + index + '">' + (row.useCrop ? 'Use full screenshot' : 'Use cropped photo') + '</button>' : '<small>No photo band found, using the full screenshot.</small>') +
    '</div><button type="button" class="link shot-remove" data-shot-remove="' + index + '" aria-label="Remove screenshot">✕</button></div>').join('');
  const assigned = shotState.rows.filter(row => row.itemId).length;
  const save = document.getElementById('shotSave');
  save.disabled = shotState.busy || !assigned;
  save.textContent = assigned ? 'Attach ' + assigned + ' photo' + (assigned === 1 ? '' : 's') : 'Attach photos';
}

async function addShots(files) {
  if (!files.length) return;
  const error = document.getElementById('shotError');
  error.textContent = 'Preparing ' + files.length + ' screenshot' + (files.length === 1 ? '' : 's') + '…';
  shotState.busy = true; renderShots();
  // Newest screenshots first, paired with the newest items that need photos.
  files.sort((a, b) => (b.lastModified || 0) - (a.lastModified || 0));
  const taken = new Set(shotState.rows.map(row => row.itemId).filter(Boolean));
  const queue = needsPhotos().filter(item => (item.photos?.length || 0) === 0 && !taken.has(item.id));
  try {
    for (const file of files.slice(0, 20)) {
      if (file.size > 25 * 1024 * 1024) continue;
      const [crop, full] = await Promise.all([cropListingPhoto(file), compressPhoto(file)]);
      const next = queue.shift();
      shotState.rows.push({cropped: crop.image, full, canCrop: crop.cropped, useCrop: crop.cropped, itemId: next?.id || ''});
    }
    error.textContent = files.length > 20 ? 'Added the first 20 screenshots.' : '';
  } catch (e) {
    error.textContent = 'One of those images could not be opened. Try PNG or JPEG screenshots.';
  } finally { shotState.busy = false; renderShots(); }
}

async function saveShots() {
  const error = document.getElementById('shotError');
  const next = structuredClone(db);
  const skipped = [];
  let attached = 0;
  for (const row of shotState.rows) {
    if (!row.itemId) continue;
    const item = next.items.find(entry => entry.id === row.itemId);
    if (!item) continue;
    item.photos ||= [];
    if (item.photos.length >= 4) { skipped.push(item.name); continue; }
    item.photos.push(row.useCrop ? row.cropped : row.full);
    attached++;
  }
  if (!attached) { error.textContent = skipped.length ? 'Those items already have 4 photos.' : 'Choose an item for at least one screenshot.'; return; }
  shotState.busy = true; renderShots(); error.textContent = 'Saving…';
  try {
    await persist(next);
    shotState.rows = [];
    document.getElementById('shotImport').close();
    render();
    pipNotify({tone: 'go', tab: 'Stock', title: attached + ' photo' + (attached === 1 ? '' : 's') + ' added', body: skipped.length ? 'Skipped (already 4 photos): ' + skipped.join(', ') : 'Your stock now shows the listing photos.'});
  } catch (e) {
    error.textContent = e.message || 'Could not save. Check your connection and try again.';
  } finally { shotState.busy = false; if (document.getElementById('shotImport').open) renderShots(); }
}

document.addEventListener('click', event => {
  if (event.target.closest('[data-shot-import]')) {
    if (isReadOnly()) return;
    const dialog = shotDialog(); shotState.rows = []; renderShots(); document.getElementById('shotError').textContent = '';
    dialog.showModal ? dialog.showModal() : dialog.setAttribute('open', '');
    return;
  }
  if (event.target.closest('[data-shot-close]')) { document.getElementById('shotImport')?.close(); shotState.rows = []; return; }
  const crop = event.target.closest('[data-shot-crop]');
  if (crop) { const row = shotState.rows[Number(crop.dataset.shotCrop)]; row.useCrop = !row.useCrop; renderShots(); return; }
  const remove = event.target.closest('[data-shot-remove]');
  if (remove) { shotState.rows.splice(Number(remove.dataset.shotRemove), 1); renderShots(); return; }
  if (event.target.closest('#shotSave') && !shotState.busy) void saveShots();
});
document.addEventListener('change', event => {
  const select = event.target.closest('[data-shot-item]');
  if (!select) return;
  shotState.rows[Number(select.dataset.shotItem)].itemId = select.value;
  renderShots();
});
