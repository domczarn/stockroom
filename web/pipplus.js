'use strict';
// Pip's bigger tricks: Snap to stock, Flaw finder and Tell Pip.

// Shrink a photo (data URL or URL) to a JPEG data URL Pip can read quickly.
async function pipImage(src, max = 1280) {
  if (!src) return null;
  try {
    const url = String(src).startsWith('data:') ? src : (typeof listingPhotoData === 'function' ? await listingPhotoData(src) : null);
    if (!url) return null;
    const img = new Image();
    await new Promise((ok, fail) => { img.onload = ok; img.onerror = fail; img.src = url; });
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale); canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', .82);
  } catch { return null; }
}
const pipList = list => list.length < 2 ? list.join('') : list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1];

// ---------- Snap to stock (quick add) ----------
function mountSnap() {
  const photos = document.querySelector('#quickAdd .qa-photos');
  if (!photos || document.getElementById('qaSnap')) return;
  const box = document.createElement('div');
  box.id = 'qaSnap'; box.className = 'qa-snap'; box.hidden = true;
  box.innerHTML = '<button type="button" class="qa-snap-go" data-snap-go><span class="island-pip">' + pipFaceSvg(30) + '</span><span><strong>Snap to stock</strong><small>Pip fills in everything from your photos: brand, size, condition, flaws, price and the listing</small></span><span class="qa-snap-arrow" aria-hidden="true">›</span></button><div class="qa-snap-result" id="qaSnapResult" role="status"></div>';
  photos.appendChild(box);
}
function syncSnap() {
  const box = document.getElementById('qaSnap');
  if (!box) return;
  const garmentPhotos = (quick.photos || []).length && !quick.read;
  box.hidden = !garmentPhotos;
}
async function runSnap() {
  if (account?.plan !== 'pro') { openUpgrade('Snap to stock is part of Stockroom Pro.'); return; }
  const box = document.getElementById('qaSnap'), out = document.getElementById('qaSnapResult'), form = document.getElementById('quickAddForm');
  const go = box.querySelector('[data-snap-go]');
  go.disabled = true; box.classList.add('busy'); out.textContent = '';
  try {
    const images = (await Promise.all(quick.photos.slice(0, 3).map(p => pipImage(p)))).filter(Boolean);
    const r = await api('/api/pip/snap', {method: 'POST', body: JSON.stringify({images})});
    const filled = [];
    const set = (name, value) => { const el = form.elements[name]; if (value && el && !el.value.trim()) { el.value = value; filled.push(el); } };
    set('name', r.item.name); set('brand', r.item.brand); set('garment', r.item.garment); set('size', r.item.size); set('color', r.item.color);
    if (r.resale && !form.elements.price.value.trim()) { form.elements.price.value = r.resale.suggest.toFixed(2); filled.push(form.elements.price); }
    if (r.item.condition && !quick.condition) { quick.condition = r.item.condition; syncQuick(); }
    quick.extra = {material: r.item.material, flaws: r.item.flaws, listingTitle: r.item.listingTitle, listingDescription: r.item.listingDescription};
    filled.forEach(el => { const row = el.closest('.qa-field,.qa-row'); row?.classList.remove('qa-flash'); void row?.offsetWidth; row?.classList.add('qa-flash'); });
    if (typeof pgRefresh === 'function') pgRefresh(form);
    out.innerHTML = '<b>Pip filled ' + (filled.length + (r.item.condition ? 1 : 0)) + ' details and wrote the listing.</b>' +
      (r.resale ? '<span>Should sell for <b>' + gbp(r.resale.low) + '–' + gbp(r.resale.high) + '</b>' + (r.community ? ' (Stockroom sellers average ' + gbp(r.community.median) + ')' : '') + '.</span>' : '') +
      (r.flawsFound.length ? '<span class="qa-snap-flaws">Flaws spotted: ' + esc(r.flawsFound.join('; ')) + '. Saved to the item so buyers know.</span>' : '<span>No flaws spotted in these photos.</span>') +
      (!r.labelSeen ? '<span>Tip: add a photo of the label so Pip can read the size and material exactly.</span>' : r.tip ? '<span>Tip: ' + esc(r.tip) + '</span>' : '') +
      '<small>Check everything before saving. Confidence: ' + esc(r.confidence) + '.</small>';
    box.classList.add('done');
  } catch (error) { out.textContent = error.message; }
  finally { go.disabled = false; box.classList.remove('busy'); }
}
onHook('afterOpenQuickAdd', () => { if (!document.getElementById('quickAdd')?.open) return; quick.extra = null; mountSnap(); const box = document.getElementById('qaSnap'); if (box) { box.classList.remove('done'); document.getElementById('qaSnapResult').textContent = ''; } syncSnap(); });
onHook('afterSyncQuick', () => syncSnap());

// ---------- Flaw finder (full editor) ----------
function mountFlaws() {
  const input = form?.elements?.flaws;
  if (!input || document.getElementById('flawBtn')) return;
  const wrap = document.createElement('div');
  wrap.className = 'measure-tool';
  wrap.innerHTML = '<button type="button" class="secondary measure-btn" id="flawBtn">🔍 Check photos for flaws</button><small id="flawNote">Pip zooms in on your photos for stains, holes, bobbling and fading, so you can disclose them and avoid returns.</small>';
  input.closest('label').after(wrap);
  wrap.querySelector('#flawBtn').onclick = async () => {
    if (account?.plan !== 'pro') { openUpgrade('Flaw finder is part of Stockroom Pro.'); return; }
    const note = document.getElementById('flawNote'), btn = document.getElementById('flawBtn');
    const photos = (editorItem().photos || []).map(p => typeof p === 'string' ? p : p?.url).filter(Boolean).slice(0, 4);
    if (!photos.length) { note.textContent = 'Add photos of the item first.'; return; }
    btn.classList.add('is-busy'); note.textContent = 'Pip is inspecting ' + photos.length + ' photo' + (photos.length === 1 ? '' : 's') + '…';
    try {
      const images = (await Promise.all(photos.map(p => pipImage(p, 1600)))).filter(Boolean);
      const r = await api('/api/pip/flaws', {method: 'POST', body: JSON.stringify({images})});
      if (r.clean) note.textContent = 'No flaws spotted. ' + (r.photoTip ? 'Tip: ' + r.photoTip : 'Still give it a once-over in daylight.');
      else {
        input.value = input.value.trim() ? input.value.trim() + '; ' + r.text : r.text;
        input.dispatchEvent(new Event('input', {bubbles: true}));
        note.textContent = 'Found ' + r.flaws.length + ': added to Flaws. Photograph each one close up for your listing.' + (r.conditionHint ? ' Suggested condition: ' + r.conditionHint + '.' : '');
      }
    } catch (error) { note.textContent = error.message; }
    finally { btn.classList.remove('is-busy'); }
  };
}

// ---------- Tell Pip ----------
let tellState = {busy: false, result: null, text: ''};
function tellPipBar() {
  return '<section class="tell-pip" id="tellPip"><form id="tellPipForm"><span class="island-pip">' + pipFaceSvg(30) + '</span>' +
    '<input id="tellPipInput" name="say" maxlength="600" autocomplete="off" placeholder="Tell Pip what happened…" aria-label="Tell Pip what happened" value="' + esc(tellState.text) + '">' +
    ((window.SpeechRecognition || window.webkitSpeechRecognition) ? '<button type="button" class="tell-mic" data-tell-mic aria-label="Speak to Pip">🎙</button>' : '') +
    '<button type="submit" class="tell-go" aria-label="Send">↑</button></form>' +
    '<div class="tell-examples">' + ['Sold the black Nike hoodie for £25', 'Bought 3 jumpers for £12 at BHF', 'Drop everything over 60 days by 20%', '£4.50 on mailing bags'].map(e => '<button type="button" data-tell-example>' + esc(e) + '</button>').join('') + '</div>' +
    '<div id="tellPipOut">' + tellOutput() + '</div></section>';
}
function tellLabel(a) {
  const item = id => db.items.find(i => i.id === id);
  switch (a.type) {
    case 'add_item': return ['＋', 'Add ' + (a.quantity > 1 ? a.quantity + ' × ' : '') + a.name, [gbp(a.cost) + (a.quantity > 1 ? ' each' : ''), a.size && 'size ' + a.size, a.place && 'from ' + a.place, dateLabel(a.purchasedAt)].filter(Boolean).join(' · ')];
    case 'mark_sold': return ['£', 'Sold ' + (item(a.itemId)?.name || 'item'), gbp(a.amount) + (a.buyer ? ' to ' + a.buyer : '') + ' · ' + dateLabel(a.soldAt)];
    case 'set_price': { const i = item(a.itemId); return ['↘', 'Price ' + (i?.name || 'item'), (Number.isFinite(i?.price) ? gbp(i.price) + ' → ' : '') + gbp(a.price)]; }
    case 'mark_listed': return ['◉', 'Listed ' + (item(a.itemId)?.name || 'item'), dateLabel(a.listedAt)];
    case 'mark_received': return ['📦', 'Arrived: ' + (item(a.itemId)?.name || 'item'), dateLabel(a.receivedAt)];
    case 'log_expense': return ['−', 'Expense: ' + a.description, gbp(a.amount) + ' · ' + a.category + ' · ' + dateLabel(a.date)];
  }
  return ['•', a.type, ''];
}
function tellOutput() {
  if (tellState.busy) return '<p class="tell-thinking">Pip is working out what changed…</p>';
  const r = tellState.result;
  if (!r) return '';
  if (r.error) return '<p class="tell-msg tell-bad">' + esc(r.error) + '</p>';
  return (r.summary ? '<p class="tell-msg">' + esc(r.summary) + '</p>' : '') + (r.question ? '<p class="tell-msg tell-q">' + esc(r.question) + '</p>' : '') +
    (r.actions.length ? '<ul class="tell-actions">' + r.actions.map((a, n) => { const [icon, title, sub] = tellLabel(a); return '<li><label><input type="checkbox" checked data-tell-pick="' + n + '"><span class="tell-icon">' + icon + '</span><span><b>' + esc(title) + '</b><small>' + esc(sub) + '</small></span></label></li>'; }).join('') + '</ul>' +
      '<div class="tell-confirm"><button type="button" class="action" data-tell-apply>Do it</button><button type="button" class="link" data-tell-cancel>Cancel</button></div>' : '');
}
function paintTell() { const out = document.getElementById('tellPipOut'); if (out) out.innerHTML = tellOutput(); }
async function askTell(text) {
  if (account?.plan !== 'pro') { openUpgrade('Tell Pip is part of Stockroom Pro.'); return; }
  tellState = {busy: true, result: null, text}; paintTell();
  const today = todayUK();
  const items = db.items.filter(i => !i.deletedAt && i.status === 'In Stock').slice(-500).map(i => ({id: i.id, name: i.name, brand: i.brand, size: i.size, status: i.status, price: i.price, cost: i.cost,
    listed: !!i.listedAt, received: !!i.receivedAt, daysListed: i.listedAt ? Math.round((Date.parse(today) - Date.parse(i.listedAt)) / 864e5) : null}));
  try { tellState.result = await api('/api/pip/command', {method: 'POST', body: JSON.stringify({text, today, items})}); }
  catch (error) { tellState.result = {error: error.message}; }
  tellState.busy = false; paintTell();
}
function applyTell(actions) {
  let next = cloneWorkspace(db);
  const today = todayUK();
  let nextId = Math.max(0, ...next.items.map(i => Number(i.id) || 0));
  for (const a of actions) {
    if (a.type === 'add_item') {
      let runId = '';
      if (a.place) {
        const runs = next.sourcingRuns ||= [];
        let run = runs.find(r => r.place.toLowerCase() === a.place.toLowerCase() && r.date === a.purchasedAt);
        if (!run) { run = {id: newId(), place: a.place, kind: /car ?boot/i.test(a.place) ? 'Car boot' : /kilo/i.test(a.place) ? 'Kilo sale' : /vinted|ebay|depop|online/i.test(a.place) ? 'Online' : 'Charity shop', date: a.purchasedAt, spend: null, miles: null, minutes: null, notes: ''}; runs.push(run); }
        runId = run.id;
      }
      for (let n = 0; n < a.quantity; n++) next.items.push({
        id: String(++nextId).padStart(4, '0'), name: a.name, brand: a.brand, garment: a.garment, size: a.size, color: a.color, condition: '', notes: '', cost: a.cost, price: null,
        photos: [], status: 'In Stock', platform: 'Vinted', purchasedAt: a.purchasedAt, purchaseDateReviewed: true, stage: '', receivedAt: today, listedAt: '',
        material: '', measurements: '', flaws: '', listingTitle: '', listingDescription: '', listingUrl: '', listingNotes: '', location: '', refundedAt: '', sale: null, refund: null, sourcingRunId: runId});
    }
    if (a.type === 'mark_sold') next = recordSale(next, a.itemId, a.amount, a.soldAt);
    const item = next.items.find(i => i.id === a.itemId);
    if (a.type === 'set_price' && item) Object.assign(item, {price: a.price, priceChangedAt: today});
    if (a.type === 'mark_listed' && item) Object.assign(item, {listedAt: a.listedAt, stage: 'Listed', receivedAt: item.receivedAt || a.listedAt});
    if (a.type === 'mark_received' && item) Object.assign(item, {receivedAt: a.receivedAt, stage: item.stage === 'Awaiting delivery' ? '' : item.stage});
    if (a.type === 'log_expense') (next.expenses ||= []).push([a.description, a.amount, a.category, null, a.date, 'Added with Tell Pip', '']);
  }
  return next;
}
document.addEventListener('input', event => { if (event.target.id === 'tellPipInput') tellState.text = event.target.value; });
document.addEventListener('submit', event => {
  if (event.target.id !== 'tellPipForm') return;
  event.preventDefault();
  const text = document.getElementById('tellPipInput').value.trim();
  if (text && !tellState.busy) void askTell(text);
});
document.addEventListener('click', async event => {
  const t = event.target;
  if (t.closest('[data-snap-go]')) { void runSnap(); return; }
  const example = t.closest('[data-tell-example]');
  if (example) { const input = document.getElementById('tellPipInput'); input.value = example.textContent; input.focus(); return; }
  if (t.closest('[data-tell-cancel]')) { tellState = {busy: false, result: null, text: ''}; paintTell(); document.getElementById('tellPipInput').value = ''; return; }
  if (t.closest('[data-tell-apply]')) {
    const picks = [...document.querySelectorAll('[data-tell-pick]:checked')].map(el => tellState.result.actions[Number(el.dataset.tellPick)]);
    if (!picks.length) return;
    try {
      await persist(applyTell(picks));
      tellState = {busy: false, result: null, text: ''};
      toast(picks.length + ' change' + (picks.length === 1 ? '' : 's') + ' saved. Pip’s on it.');
      render();
    } catch (error) { tellState.result = {...tellState.result, error: error.message, actions: []}; paintTell(); }
    return;
  }
  if (t.closest('[data-tell-mic]')) {
    const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new Rec(); rec.lang = 'en-GB'; rec.interimResults = true;
    const input = document.getElementById('tellPipInput'), mic = t.closest('[data-tell-mic]');
    mic.classList.add('listening');
    rec.onresult = e => { input.value = [...e.results].map(r => r[0].transcript).join(''); };
    rec.onend = () => { mic.classList.remove('listening'); if (input.value.trim()) document.getElementById('tellPipForm').requestSubmit(); };
    rec.onerror = () => mic.classList.remove('listening');
    rec.start();
  }
});
// Put the Tell Pip bar at the top of Home after each render, and mount the editor tools.
if (typeof render === 'function') {
  let typing = null;
  onHook('beforeRender', () => { typing = document.activeElement?.id === 'tellPipInput' ? document.activeElement.selectionStart : null; });
  onHook('afterRender', () => {
    if (tab === 'Dashboard' && !isReadOnly() && !document.getElementById('tellPip')) {
      const view = document.getElementById('view'), anchor = view?.querySelector('.welcome, section');
      if (anchor) anchor.insertAdjacentHTML('afterend', tellPipBar());
      if (typing != null) { const input = document.getElementById('tellPipInput'); input?.focus(); input?.setSelectionRange(typing, typing); }
    }
  });
}
setTimeout(mountFlaws, 0);
