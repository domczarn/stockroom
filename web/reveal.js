'use strict';
// The first-sync reveal: the moment someone connects their emails, Pip shows what he found (sales, money,
// parcels to post) instead of an empty app. Sales that don't match stock yet can be added in one tap, so a brand
// new account fills itself from its own history. Free accounts see the Pro offer right here, next to the value.
const revealKey = () => 'sr-reveal:' + (account?.id || '');

function revealFindings(receipts) {
  const events = receipts.filter(r => r.event);
  const sold = events.filter(r => r.event.type === 'sold' && r.event.amount > 0);
  const posted = new Set(events.filter(r => ['posted', 'parcel-delivered', 'delivered'].includes(r.event.type) && r.event.tracking).map(r => r.event.tracking));
  const toPost = events.filter(r => r.event.type === 'label' && !(r.event.tracking && posted.has(r.event.tracking)));
  const delivered = events.filter(r => ['parcel-delivered', 'completed'].includes(r.event.type));
  const trades = db.trades || [];
  // Sales Stockroom can't match to stock: no order from this email yet and no confident match in stock.
  const unmatched = sold.filter(r => !trades.some(t => t.emailId === r.id) && !(typeof auRank === 'function' && auConfident(auRank(r.event.title, auCandidates(r.event, db)))));
  return {sold, money: sold.reduce((n, r) => n + r.event.amount, 0), toPost, delivered, unmatched};
}

function revealMaybe() {
  if (!account || isReadOnly() || !db || document.getElementById('srReveal')) return;
  let seen = false; try { seen = !!localStorage.getItem(revealKey()); } catch {}
  if (seen) return;
  const receipts = personalGmail?.connection?.receipts || [];
  if (!receipts.some(r => r.event)) return;
  // People already using email tracking have seen all this happen: never show it to them.
  if ((db.trades || []).some(t => t.emailId)) { try { localStorage.setItem(revealKey(), '1'); } catch {} return; }
  try { localStorage.setItem(revealKey(), '1'); } catch {}
  revealOpen(revealFindings(receipts));
}

function revealOpen(f) {
  const pro = account?.plan === 'pro' || account?.role === 'admin';
  const row = (icon, label, value, sub) => '<div class="rv-row"><span aria-hidden="true">' + icon + '</span><div><b>' + label + '</b>' + (sub ? '<small>' + sub + '</small>' : '') + '</div><strong data-rv-to="' + value + '">0</strong></div>';
  const el = document.createElement('dialog');
  el.id = 'srReveal'; el.className = 'rv';
  el.innerHTML = '<div class="rv-pip"><span class="sr-wait-ring"></span><i class="sr-wait-spark"></i><i class="sr-wait-spark"></i><i class="sr-wait-spark"></i><img src="/pip-orb.svg" alt=""></div>' +
    '<h2>Pip went through your emails</h2><p class="rv-sub">Here’s what he found. From now on, new ones land by themselves.</p>' +
    '<div class="rv-hero"><small>Sales found</small><b data-rv-to="' + gbp(f.money) + '">£0.00</b><span>' + f.sold.length + ' sale' + (f.sold.length === 1 ? '' : 's') + '</span></div>' +
    '<div class="rv-rows">' + row(uiIcon('package'), 'Parcels to post', String(f.toPost.length), f.toPost.length ? 'QR codes are ready in Stock' : '') + row('✅', 'Delivered or paid out', String(f.delivered.length)) + '</div>' +
    (f.unmatched.length ? '<button type="button" class="action rv-add" data-rv-add>Add my ' + f.unmatched.length + ' sale' + (f.unmatched.length === 1 ? '' : 's') + ' to Stockroom</button><p class="rv-note">They’re added as sold items. Add what you paid later to see your real profit.</p>' : '') +
    (!pro && !isNativeApp() ? '<div class="rv-pro"><b>Keep every sale tracking itself</b><span>Free tracks 20 sales a month. Pro tracks all of them, with labels and QR codes.</span><button type="button" class="secondary" data-rv-pro>See Pro</button></div>' : '') +
    '<button type="button" class="' + (f.unmatched.length ? 'secondary' : 'action') + ' rv-done" data-rv-done>' + (f.unmatched.length ? 'Not now' : 'Nice') + '</button>';
  document.body.appendChild(el);
  el.showModal?.() || el.setAttribute('open', '');
  el._findings = f;
  setTimeout(() => el.querySelectorAll('[data-rv-to]').forEach(n => { const to = n.dataset.rvTo; srCountTo(n, n.textContent, to, 1100); if (srCalm()) n.textContent = to; }), 250);
}

// Turn sales found in emails into sold items: name and price from the email, cost unknown (0) until you add it.
async function revealAddSales(found) {
  let next = cloneWorkspace(db);
  let nextId = Math.max(0, ...next.items.map(row => Number(row.id) || 0));
  for (const r of found) {
    const e = r.event, date = e.date || String(r.receivedAt || '').slice(0, 10) || todayUK();
    const id = String(++nextId).padStart(4, '0');
    next.items.push({id, name: e.title, brand: '', garment: '', size: '', color: '', condition: '', notes: 'Added from your sale email. Add what you paid to see your real profit.',
      cost: 0, price: e.amount, photos: [], status: 'In Stock', platform: e.platform || 'Vinted', purchasedAt: date, purchaseDateReviewed: false, stage: '', receivedAt: date,
      listedAt: '', material: '', measurements: '', flaws: '', listingTitle: '', listingDescription: '', listingUrl: '', listingNotes: '', location: '', refundedAt: '', sale: null, refund: null, source: 'email'});
    next = recordSale(next, id, e.amount, date);
    const trade = next.trades.at(-1);
    trade.emailId = r.id;
    if (e.buyer) trade.buyer = e.buyer;
    if (e.platform) trade.platform = e.platform;
    if (r.receivedAt) trade.soldTime = new Date(r.receivedAt).toISOString();
  }
  await persist(next);
  if (typeof auDone !== 'undefined') { found.forEach(r => auDone.add(r.id)); auSaveDone(); }   // sale emails are keyed by their id
  render();
}

document.addEventListener('click', async event => {
  const dialog = document.getElementById('srReveal');
  if (!dialog || !dialog.contains(event.target)) return;
  const close = () => { dialog.close?.(); dialog.remove(); };
  if (event.target.closest('[data-rv-done]')) { close(); return; }
  if (event.target.closest('[data-rv-pro]')) { close(); openUpgrade('Keep every sale tracking itself, with labels and QR codes ready at drop-off.'); return; }
  const add = event.target.closest('[data-rv-add]');
  if (add) {
    add.disabled = true; add.textContent = 'Adding…';
    try { const n = dialog._findings.unmatched.length; await revealAddSales(dialog._findings.unmatched); close(); toast(n + ' sale' + (n === 1 ? '' : 's') + ' added. Tap any of them to add what you paid.'); }
    catch (error) { add.disabled = false; add.textContent = 'Try again'; toast(error.message || 'Couldn’t add them.'); }
  }
});

// Ask for email at the right moment: just after your first sale, when tracking the next one is obviously useful.
// Once per account, only if no inbox is connected yet.
const firstSaleKey = () => 'sr-first-sale-ask:' + (account?.id || '');
onHook('afterRender', () => {
  if (!account || isReadOnly() || !db || document.querySelector('dialog[open]') || typeof personalGmail === 'undefined' || !personalGmail || personalGmail.connection) return;
  if (!(db.trades || []).length || (db.trades || []).some(t => t.emailId)) return;
  if (!personalGmail.available && !personalGmail.outlook && !personalGmail.forwarding) return;
  let asked = false; try { asked = !!localStorage.getItem(firstSaleKey()); localStorage.setItem(firstSaleKey(), '1'); } catch { return; }
  if (asked) return;
  setTimeout(() => {
    const el = document.createElement('dialog');
    el.id = 'srFirstSale'; el.className = 'rv';
    el.innerHTML = '<div class="rv-pip"><span class="sr-wait-ring"></span><i class="sr-wait-spark"></i><i class="sr-wait-spark"></i><i class="sr-wait-spark"></i><img src="/pip-orb.svg" alt=""></div>' +
      '<h2>Nice, a sale! 🎉</h2><p class="rv-sub">Want the next one to track itself? Connect your email and Pip adds every sale, shipping label and QR code for you.</p>' +
      '<button type="button" class="action rv-add" data-first-sale-connect>Connect my email</button><button type="button" class="secondary rv-done" data-first-sale-close>Maybe later</button>';
    document.body.appendChild(el);
    el.showModal?.() || el.setAttribute('open', '');
  }, 700);
});
document.addEventListener('click', event => {
  const dialog = document.getElementById('srFirstSale');
  if (!dialog || !dialog.contains(event.target)) return;
  const go = event.target.closest('[data-first-sale-connect]');
  if (!go && !event.target.closest('[data-first-sale-close]')) return;
  dialog.close?.(); dialog.remove();
  if (go && typeof startGmail === 'function') startGmail();
});
