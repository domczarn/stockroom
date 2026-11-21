import {startAuthentication, startRegistration, browserSupportsWebAuthn, browserSupportsWebAuthnAutofill} from '@simplewebauthn/browser';

const $ = id => document.getElementById(id);
const card = document.querySelector('.card');
const show = name => document.querySelectorAll('.step').forEach(el => { el.hidden = el.dataset.step !== name; });
const err = (text, ok = false) => { $('error').textContent = text || ''; $('error').classList.toggle('ok', ok); if (text && !ok) { card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake'); } };
const busy = on => { card.classList.toggle('busy', on); document.querySelectorAll('button').forEach(b => { b.disabled = on; }); };
const next = new URLSearchParams(location.search).get('next');
const goHome = () => location.replace(next && next.startsWith('/') && !next.startsWith('//') ? next : '/');
async function post(path, body) {
  const res = await fetch(path, {method: 'POST', headers: {'content-type': 'application/json'}, credentials: 'same-origin', body: JSON.stringify(body || {})});
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong. Try again.');
  return data;
}

let email = '', resendAt = 0;
// Cloudflare Turnstile bot check: invisible for almost everyone, only asks when something looks automated.
const turnstileSlot = $('turnstile'), siteKey = turnstileSlot?.dataset.sitekey;
let turnstileId = null, turnstileToken = '';
let turnstileFailed = false;
function turnstileReady() {
  if (!siteKey || turnstileId !== null) return;
  if (typeof window.turnstile?.render !== 'function') return void setTimeout(turnstileReady, 200); // script still loading
  try {
    turnstileId = window.turnstile.render(turnstileSlot, {sitekey: siteKey, appearance: 'interaction-only', theme: 'dark', retry: 'auto',
      callback: token => { turnstileToken = token; turnstileFailed = false; }, 'expired-callback': () => { turnstileToken = ''; },
      'error-callback': () => { turnstileToken = ''; turnstileFailed = true; }});
  } catch { turnstileFailed = true; }
}
window.onTurnstileLoad = turnstileReady; turnstileReady();
async function humanToken() {
  if (!siteKey) return '';
  for (let i = 0; i < 60 && !turnstileToken; i++) await new Promise(r => setTimeout(r, 150)); // give the invisible check a moment
  if (!turnstileToken) {
    if (turnstileId !== null) try { window.turnstile.reset(turnstileId); } catch {}
    throw new Error(turnstileFailed ? 'The human check didn’t load. Refresh the page, or turn off any ad or tracker blocker for this site, then try again.' : 'Just checking you’re human. If a box appears above, tick it, then try again.');
  }
  return turnstileToken;
}
const passkeys = browserSupportsWebAuthn();
if (passkeys) { $('passkeyButton').hidden = false; $('orDivider').hidden = false; }

async function passkeySignIn(autofill = false) {
  const {options, challengeId} = await post('/auth/passkey/login/options');
  const response = await startAuthentication({optionsJSON: options, useBrowserAutofill: autofill});
  busy(true);
  await post('/auth/passkey/login/verify', {challengeId, response});
  goHome();
}
// iPhone/Chrome: offer saved passkeys right in the email field's autofill.
browserSupportsWebAuthnAutofill().then(ok => { if (ok) passkeySignIn(true).catch(() => {}); }).catch(() => {});

$('passkeyButton').onclick = async () => {
  err('');
  try { await passkeySignIn(false); }
  catch (e) { busy(false); if (e?.name !== 'NotAllowedError' && e?.name !== 'AbortError') err(e.message || 'Passkey sign-in failed. Use an email code instead.'); }
};

async function sendCode() {
  busy(true); err('');
  try {
    const data = await post('/auth/code', {email, turnstile: await humanToken()});
    if (turnstileId !== null) { window.turnstile.reset(turnstileId); turnstileToken = ''; }
    $('sentTo').textContent = email; show('code');
    resendAt = Date.now() + 30000;
    if (data.devCode) { $('code').value = data.devCode; err('Dev mode: code filled in.', true); }
    setTimeout(() => $('code').focus(), 50);
  } catch (e) { err(e.message); }
  finally { busy(false); }
}
$('emailForm').onsubmit = e => {
  e.preventDefault();
  email = $('email').value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { err('Enter a valid email address.'); $('email').focus(); return; }
  sendCode();
};
$('code').addEventListener('input', () => { $('code').value = $('code').value.replace(/\D/g, '').slice(0, 6); if ($('code').value.length === 6) $('codeForm').requestSubmit(); });
$('codeForm').onsubmit = async e => {
  e.preventDefault();
  const code = $('code').value.trim();
  if (code.length !== 6) { err('Enter the 6-digit code.'); return; }
  busy(true); err('');
  try {
    const data = await post('/auth/verify', {email, code});
    if (passkeys && !data.hasPasskey) { busy(false); show('passkey'); return; }
    goHome();
  } catch (e2) { busy(false); err(e2.message); $('code').select(); }
};
$('resend').onclick = () => { if (Date.now() < resendAt) { err('Wait ' + Math.ceil((resendAt - Date.now()) / 1000) + 's before asking again.'); return; } sendCode(); };
$('changeEmail').onclick = () => { show('email'); err(''); $('email').focus(); };
$('addPasskey').onclick = async () => {
  err('');
  try {
    const {options, challengeId} = await post('/auth/passkey/register/options');
    const response = await startRegistration({optionsJSON: options});
    busy(true);
    await post('/auth/passkey/register/verify', {challengeId, response, name: /iPhone|iPad/.test(navigator.userAgent) ? 'iPhone' : /Mac/.test(navigator.userAgent) ? 'Mac' : /Android/.test(navigator.userAgent) ? 'Android' : 'This device'});
    goHome();
  } catch (e) { busy(false); if (e?.name === 'NotAllowedError' || e?.name === 'AbortError') return; err(e.message || 'Couldn’t add a passkey. You can add one later in Settings.'); }
};
$('skipPasskey').onclick = goHome;
