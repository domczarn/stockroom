'use strict';
// Vinted-style "Add stock": photos first, then simple rows, one save button.
// Editing an existing item still opens the full editor.

const openFullItem = openItem;
// eslint-disable-next-line no-global-assign
openItem = (item, pane) => item ? openFullItem(item, pane) : openQuickAdd();

const quick = {photos: [], busy: false, arrived: false, condition: ''};
const CONDITIONS = ['New with tags', 'New without tags', 'Very good', 'Good', 'Satisfactory'];

function recentValues(field, limit = 12) {
  return [...new Set(db.items.filter(row => !row.deletedAt && row[field]).slice().reverse().map(row => String(row[field]).trim()))].slice(0, limit);
}

function quickSheet() {
  let dialog = document.getElementById('quickAdd');
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.id = 'quickAdd';
  dialog.className = 'quick-add';
  dialog.innerHTML =
    '<header class="qa-top"><button type="button" class="qa-x" data-qa-close aria-label="Close">✕</button><h2>Add stock</h2><span></span></header>' +
    '<form id="quickAddForm" novalidate>' +
    '<section class="qa-photos"><div id="qaGrid" class="qa-grid"></div>' +
    '<label class="qa-upload"><input type="file" id="qaFiles" accept="image/*" multiple hidden><span>＋ Upload photos</span><small>Vinted screenshots are cropped automatically</small></label></section>' +
    '<section class="qa-group">' +
      '<label class="qa-field"><span>Title</span><input name="name" required maxlength="120" placeholder="e.g. Nike running jacket" autocomplete="off"></label>' +
      '<label class="qa-field"><span>Describe your item</span><textarea name="notes" rows="2" placeholder="e.g. worn once, no flaws"></textarea></label>' +
    '</section>' +
    '<section class="qa-group">' +
      '<label class="qa-row"><span>Brand</span><input name="brand" list="qaBrands" placeholder="Choose" autocomplete="off"></label>' +
      '<label class="qa-row"><span>Category</span><input name="garment" list="qaGarments" placeholder="e.g. Jacket" autocomplete="off"></label>' +
      '<label class="qa-row"><span>Size</span><input name="size" list="qaSizes" placeholder="e.g. M" autocomplete="off"></label>' +
      '<label class="qa-row"><span>Colour</span><input name="color" list="qaColours" placeholder="e.g. Black" autocomplete="off"></label>' +
      '<div class="qa-row qa-cond"><span>Condition</span><div class="qa-chips" id="qaCondition">' +
        CONDITIONS.map(c => '<button type="button" data-qa-cond="' + c + '">' + c + '</button>').join('') + '</div></div>' +
    '</section>' +
    '<section class="qa-group">' +
      '<label class="qa-row"><span>Price paid</span><span class="qa-money">£<input name="cost" inputmode="decimal" placeholder="0.00" autocomplete="off"></span></label>' +
      '<label class="qa-row"><span>Selling for</span><span class="qa-money">£<input name="price" inputmode="decimal" placeholder="optional" autocomplete="off"></span></label>' +
      '<label class="qa-row"><span>Bought on</span><input type="date" name="purchasedAt"></label>' +
      '<div class="qa-row"><span>Delivery</span><div class="qa-seg" role="group"><button type="button" data-qa-arrived="false">On its way</button><button type="button" data-qa-arrived="true">Got it</button></div></div>' +
    '</section>' +
    '<datalist id="qaBrands"></datalist><datalist id="qaGarments"></datalist><datalist id="qaSizes"></datalist><datalist id="qaColours"></datalist>' +
    '<p id="qaError" class="qa-error" role="alert"></p>' +
    '<div class="qa-links"><button type="button" class="link qa-more" data-scan-receipt>Scan a receipt instead</button><button type="button" class="link qa-more" data-qa-more>Full editor</button></div>' +
    '<footer class="qa-foot"><button type="submit" class="action" id="qaSave">Add to stock</button></footer>' +
    '</form>';
  document.body.append(dialog);
  dialog.querySelector('#qaFiles').onchange = event => addQuickPhotos([...event.target.files]).finally(() => { event.target.value = ''; });
  dialog.querySelector('#quickAddForm').onsubmit = event => { event.preventDefault(); void saveQuick(); };
  return dialog;
}

function syncQuick() {
  const grid = document.getElementById('qaGrid');
  grid.innerHTML = quick.photos.map((src, i) => '<figure><img src="' + src + '" alt=""><button type="button" data-qa-remove="' + i + '" aria-label="Remove photo">✕</button>' + (i === 0 ? '<span>Cover</span>' : '') + '</figure>').join('');
  grid.hidden = !quick.photos.length;
  document.querySelector('.qa-upload').classList.toggle('compact', quick.photos.length > 0);
  document.querySelector('.qa-upload').hidden = quick.photos.length >= 4;
  document.querySelectorAll('[data-qa-cond]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.qaCond === quick.condition)));
  document.querySelectorAll('[data-qa-arrived]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.qaArrived === String(quick.arrived))));
  document.getElementById('qaSave').disabled = quick.busy;
}

function openQuickAdd() {
  if (!db || isReadOnly()) { toast('This account is read-only.'); return; }
  const dialog = quickSheet();
  const form = dialog.querySelector('form');
  form.reset();
  Object.assign(quick, {photos: [], busy: false, arrived: false, condition: ''});
  form.elements.purchasedAt.value = todayUK();
  form.elements.purchasedAt.max = todayUK();
  const fill = (id, field) => { document.getElementById(id).innerHTML = recentValues(field).map(v => '<option value="' + esc(v) + '"></option>').join(''); };
  fill('qaBrands', 'brand'); fill('qaGarments', 'garment'); fill('qaSizes', 'size'); fill('qaColours', 'color');
  document.getElementById('qaError').textContent = '';
  syncQuick();
  dialog.showModal ? dialog.showModal() : dialog.setAttribute('open', '');
  dialog.scrollTop = 0;
}

async function addQuickPhotos(files) {
  const error = document.getElementById('qaError');
  const room = 4 - quick.photos.length;
  if (!files.length || room <= 0) return;
  quick.busy = true; syncQuick(); error.textContent = 'Adding photos…';
  try {
    for (const file of files.slice(0, room)) {
      const bitmap = await createImageBitmap(file);
      const tall = bitmap.height / bitmap.width > 1.8; bitmap.close();
      if (tall && typeof cropListingPhoto === 'function') {
        const crop = await cropListingPhoto(file);
        quick.photos.push(crop.image);
      } else quick.photos.push(await compressPhoto(file));
    }
    error.textContent = files.length > room ? 'Only 4 photos per item. Extra photos were skipped.' : '';
  } catch (e) {
    error.textContent = e.message || 'That photo could not be opened.';
  } finally { quick.busy = false; syncQuick(); }
}

const money = value => { const n = Number(String(value).replace(/[£,\s]/g, '')); return String(value).trim() === '' ? null : n; };

async function saveQuick() {
  if (quick.busy) return;
  const form = document.getElementById('quickAddForm');
  const error = document.getElementById('qaError');
  const f = Object.fromEntries(new FormData(form));
  const cost = money(f.cost), price = money(f.price);
  if (!f.name.trim()) { error.textContent = 'Add a title.'; form.elements.name.focus(); return; }
  if (cost === null || !Number.isFinite(cost) || cost < 0) { error.textContent = 'Enter what you paid.'; form.elements.cost.focus(); return; }
  if (price !== null && (!Number.isFinite(price) || price < 0)) { error.textContent = 'Selling price must be a number.'; form.elements.price.focus(); return; }
  const today = todayUK();
  const item = {
    id: String(Math.max(0, ...db.items.map(row => Number(row.id) || 0)) + 1).padStart(4, '0'),
    name: f.name.trim(), brand: f.brand.trim(), garment: f.garment.trim(), size: f.size.trim(), color: f.color.trim(),
    condition: quick.condition, notes: f.notes.trim(), cost: Math.round(cost * 100) / 100,
    price: price === null ? null : Math.round(price * 100) / 100,
    photos: [...quick.photos], status: 'In Stock', platform: 'Vinted',
    purchasedAt: f.purchasedAt || today, purchaseDateReviewed: true,
    stage: quick.arrived ? '' : 'Awaiting delivery', receivedAt: quick.arrived ? today : '',
    listedAt: '', material: '', measurements: '', flaws: '', listingTitle: '', listingDescription: '', listingUrl: '', listingNotes: '', location: '',
    refundedAt: '', sale: null, refund: null
  };
  quick.busy = true; syncQuick(); error.textContent = 'Saving…';
  try {
    await persist({...db, items: [...db.items, item]});
    document.getElementById('quickAdd').close();
    render();
    pipNotify({tone: 'go', tab: 'Stock', title: 'Added to stock', body: item.name + ' · ' + gbp(item.cost)});
  } catch (e) {
    error.textContent = (e.message || 'Could not save.') + ' Your details are still here.';
  } finally { quick.busy = false; if (document.getElementById('quickAdd').open) syncQuick(); }
}

document.addEventListener('click', event => {
  if (!event.target.closest('#quickAdd')) return;
  if (event.target.closest('[data-qa-close]')) { document.getElementById('quickAdd').close(); return; }
  const cond = event.target.closest('[data-qa-cond]');
  if (cond) { quick.condition = quick.condition === cond.dataset.qaCond ? '' : cond.dataset.qaCond; syncQuick(); return; }
  const arrived = event.target.closest('[data-qa-arrived]');
  if (arrived) { quick.arrived = arrived.dataset.qaArrived === 'true'; syncQuick(); return; }
  const remove = event.target.closest('[data-qa-remove]');
  if (remove) { quick.photos.splice(Number(remove.dataset.qaRemove), 1); syncQuick(); return; }
  if (event.target.closest('[data-qa-more]')) { document.getElementById('quickAdd').close(); openFullItem(null); }
});
