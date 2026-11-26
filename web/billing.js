// Plans: the Go Pro sheet, the Plan & billing settings panel, and the return trip from Stripe.
let billingInfo = null, billingInterval = 'year';
const PRO_FEATURES = [
  ['Unlimited stock', 'Add as many items as you buy. Free is 20 a month.'],
  ['Every sale tracks itself', 'Free tracks 20 sales a month from Gmail. Pro tracks all of them, with labels, QR codes and deliveries.'],
  ['Pip AI', 'Fill items from a screenshot and get Vinted listings written for you.'],
];

async function loadBilling() {
  try { billingInfo = await api('/api/billing'); if (account) account.plan = billingInfo.plan; } catch { billingInfo = billingInfo || null; }
  const box = document.getElementById('billingBox');
  if (box) box.outerHTML = billingPanel();
  return billingInfo;
}

function billingPanel() {
  const b = billingInfo;
  if (!b) return '<div class="billing-box" id="billingBox">' + srWait('Checking your plan…', {small: true, ghost: false}) + '</div>';
  if (b.owner) return '<div class="billing-box" id="billingBox"><div class="plan-head"><span class="plan-badge pro">Owner</span><strong>Everything included</strong></div><p class="footnote">The owner account always has every Pro feature.</p></div>';
  if (b.plan === 'pro') {
    const date = b.until ? new Date(b.until).toLocaleDateString('en-GB', {day: 'numeric', month: 'long', year: 'numeric'}) : '';
    return '<div class="billing-box" id="billingBox"><div class="plan-head"><span class="plan-badge pro">Pro</span><strong>Unlimited stock, Gmail auto-updates and Pip AI</strong></div>' +
      (date ? '<p class="footnote">Paid up to ' + esc(date) + '. Renews automatically unless you cancel.</p>' : '') +
      (b.customer ? '<div class="settings-action-row"><div><h3>Manage billing</h3><p>Change card, switch monthly or yearly, get invoices or cancel.</p></div><button type="button" class="secondary" data-billing-portal>Manage billing</button></div>' : '') + '</div>';
  }
  const pct = Math.min(100, Math.round(b.used / b.limit * 100));
  return '<div class="billing-box" id="billingBox"><div class="plan-head"><span class="plan-badge">Free</span><strong>' + b.used + ' of ' + b.limit + ' new items this month</strong></div>' +
    '<div class="plan-meter" role="progressbar" aria-valuemin="0" aria-valuemax="' + b.limit + '" aria-valuenow="' + b.used + '"><span data-w="' + pct + '"></span></div>' +
    '<p class="footnote">Resets on the 1st. Everything you’ve already added stays, whatever your plan.</p>' +
    '<button type="button" class="action" data-go-pro>Go Pro · from £5 a month</button>' +
    (b.customer ? '<button type="button" class="link" data-billing-portal>Past invoices</button>' : '') + '</div>';
}
// CSP blocks inline styles, so the meter width is set here.
new MutationObserver(() => document.querySelectorAll('.plan-meter span[data-w]').forEach(el => { el.style.width = el.dataset.w + '%'; el.removeAttribute('data-w'); }))
  .observe(document.documentElement, {childList: true, subtree: true});

function upgradeSheet() {
  let dialog = document.getElementById('upgradeDialog');
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.id = 'upgradeDialog';
  dialog.className = 'upgrade-dialog';
  dialog.innerHTML = '<button type="button" class="close-panel" data-close-dialog="upgradeDialog" aria-label="Close">×</button>' +
    '<img src="/pip-orb.svg" width="120" height="120" alt="" class="orb-hero"><span class="eyebrow">STOCKROOM PRO</span><h2>Let Pip do the boring bits</h2><p id="upgradeReason" class="upgrade-reason"></p>' +
    '<ul class="upgrade-features">' + PRO_FEATURES.map(([t, d]) => '<li><strong>' + t + '</strong><span>' + d + '</span></li>').join('') + '</ul>' +
    '<div class="upgrade-toggle" role="radiogroup" aria-label="Billing">' +
    '<button type="button" role="radio" data-interval="year"><strong>£60 a year</strong><span>£5 a month · save £24</span></button>' +
    '<button type="button" role="radio" data-interval="month"><strong>£7 a month</strong><span>Cancel any time</span></button></div>' +
    '<button type="button" class="action" id="upgradeGo">Continue to secure payment</button><p id="upgradeError" role="alert" class="footnote"></p>' +
    '<p class="footnote">Payments by Stripe. Cancel any time in Settings → Plan & billing. By subscribing you agree to the <a href="/terms.html" target="_blank">Terms</a>.</p>';
  document.body.append(dialog);
  return dialog;
}
function syncUpgradeToggle() {
  document.querySelectorAll('#upgradeDialog [data-interval]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.interval === billingInterval)));
}
function openUpgrade(reason) {
  if (account?.role === 'admin') { toast(reason || 'The owner account has everything.'); return; }
  // Store apps can't sell plans outside the store's own payments, so the app only explains the limit.
  if (isNativeApp()) {
    const fallback = () => toast(String(reason || 'That’s a Pro feature.').replace(/\s*Go Pro.*$/, '').replace(/\s*is part of Stockroom Pro\.?$/, ' is a Pro feature.'));
    // Store apps buy through Apple / Google (iap.js). If that isn't set up yet, just explain the limit.
    if (typeof iapPaywall === 'function') iapPaywall(reason).then(shown => { if (!shown) fallback(); }, fallback); else fallback();
    return;
  }
  const dialog = upgradeSheet();
  document.getElementById('upgradeReason').textContent = reason || '';
  document.getElementById('upgradeReason').hidden = !reason;
  document.getElementById('upgradeError').textContent = '';
  syncUpgradeToggle();
  if (!dialog.open) dialog.showModal();
}

document.addEventListener('click', async event => {
  const interval = event.target.closest('#upgradeDialog [data-interval]');
  if (interval) { billingInterval = interval.dataset.interval; syncUpgradeToggle(); return; }
  if (event.target.closest('[data-go-pro]')) { openUpgrade(); return; }
  const go = event.target.closest('#upgradeGo'), portal = event.target.closest('[data-billing-portal]');
  if (!go && !portal) return;
  const button = go || portal;
  button.disabled = true;
  try {
    const {url} = await api(go ? '/api/billing/checkout' : '/api/billing/portal', {method: 'POST', body: JSON.stringify(go ? {interval: billingInterval} : {})});
    location.assign(url);
  } catch (error) {
    if (go) document.getElementById('upgradeError').textContent = error.message; else toast(error.message);
    button.disabled = false;
  }
});

// Back from Stripe: confirm the payment, refresh the plan, tidy the URL.
async function billingReturn() {
  const params = new URLSearchParams(location.search), state = params.get('billing');
  if (!state) return;
  history.replaceState(null, '', location.pathname);
  try {
    if (state === 'done' && params.get('session_id')) {
      const plan = await api('/api/billing/confirm', {method: 'POST', body: JSON.stringify({sessionId: params.get('session_id')})});
      account.plan = plan.plan;
      toast(plan.plan === 'pro' ? 'You’re on Pro. Unlimited stock, Gmail auto-updates and Pip AI are on.' : 'Payment is still processing. Your plan updates in a minute.');
    } else if (state === 'refresh') {
      const plan = await api('/api/billing/refresh', {method: 'POST', body: '{}'});
      account.plan = plan.plan;
    } else if (state === 'cancelled') toast('Checkout cancelled. Nothing was charged.');
  } catch (error) { toast(error.message); }
  await loadBilling();
  if (typeof render === 'function') render();
}
