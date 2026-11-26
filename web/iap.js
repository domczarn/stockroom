'use strict';
// App Store / Google Play purchases (RevenueCat plugin in the native app). Only used inside the store apps, and only
// once the server has RevenueCat keys; the website keeps using Stripe.
let iapReady = null;
async function iapSetup() {
  const P = window.Capacitor?.Plugins?.Purchases;
  if (!isNativeApp() || !P || !account) return null;
  if (!billingInfo) { try { billingInfo = await api('/api/billing'); } catch { return null; } }
  const cfg = billingInfo?.iap, key = cfg && (window.Capacitor.getPlatform?.() === 'android' ? cfg.android : cfg.ios);
  if (!key) return null;
  iapReady ||= P.configure({apiKey: key, appUserID: account.id}).then(() => P).catch(() => { iapReady = null; return null; });
  return iapReady;
}
async function iapSync() {
  const plan = await api('/api/billing/iap/sync', {method: 'POST', body: '{}'});
  billingInfo = {...(billingInfo || {}), ...plan};
  if (account) account.plan = plan.plan;
  render();
  return plan.plan === 'pro';
}
async function iapPaywall(reason) {
  const P = await iapSetup();
  if (!P) return false;
  let packages = [];
  try { packages = (await P.getOfferings())?.current?.availablePackages || []; } catch {}
  if (!packages.length) return false;
  document.getElementById('iapSheet')?.remove();
  const el = document.createElement('dialog');
  el.id = 'iapSheet'; el.className = 'rv iap';
  el.innerHTML = '<div class="rv-pip"><span class="sr-wait-ring"></span><img src="/pip-orb.svg" alt=""></div><h2>Stockroom Pro</h2>' +
    '<p class="rv-sub">' + esc(String(reason || '').replace(/\s*Go Pro.*$/, '') || 'Every sale tracks itself, with labels and QR codes ready at drop-off.') + '</p>' +
    '<ul class="iap-perks"><li>Every sale tracked from your emails</li><li>Unlimited stock and Pip</li><li>QR codes ready at the counter</li></ul>' +
    packages.map((p, i) => '<button type="button" class="' + (i ? 'secondary' : 'action') + ' iap-buy" data-iap-buy="' + i + '"><b>' + esc(p.product?.priceString || '') + '</b> ' + esc(/ANNUAL/i.test(p.packageType) ? 'a year' : /MONTH/i.test(p.packageType) ? 'a month' : p.product?.title || '') + '</button>').join('') +
    '<button type="button" class="link iap-restore" data-iap-restore>Restore purchases</button>' +
    '<p class="rv-note">Renews automatically until you cancel in your App Store settings. <a href="/terms.html" data-iap-link>Terms</a> · <a href="/privacy.html" data-iap-link>Privacy</a></p>' +
    '<button type="button" class="secondary rv-done" data-iap-close>Not now</button>';
  el._packages = packages;
  document.body.appendChild(el);
  el.showModal?.() || el.setAttribute('open', '');
  return true;
}
document.addEventListener('click', async event => {
  const sheet = document.getElementById('iapSheet');
  if (!sheet || !sheet.contains(event.target)) return;
  const close = () => { sheet.close?.(); sheet.remove(); };
  if (event.target.closest('[data-iap-close]')) { close(); return; }
  const link = event.target.closest('[data-iap-link]');
  if (link) { event.preventDefault(); openExternal(new URL(link.getAttribute('href'), location.origin).href); return; }
  const buy = event.target.closest('[data-iap-buy]'), restore = event.target.closest('[data-iap-restore]');
  if (!buy && !restore) return;
  const P = await iapSetup();
  const button = buy || restore, label = button.innerHTML;
  button.disabled = true; button.textContent = buy ? 'Opening the App Store…' : 'Checking…';
  try {
    if (buy) await P.purchasePackage({aPackage: sheet._packages[Number(buy.dataset.iapBuy)]});
    else await P.restorePurchases();
    const pro = await iapSync();
    if (pro) { close(); toast('You’re on Pro. Thank you!'); }
    else { button.disabled = false; button.innerHTML = label; toast(restore ? 'No Pro purchase found on this Apple ID.' : 'Purchase didn’t go through.'); }
  } catch (error) {
    button.disabled = false; button.innerHTML = label;
    if (!error?.userCancelled && !/cancel/i.test(String(error?.message || error?.code || ''))) toast('The App Store didn’t complete that. Try again.');
  }
});
