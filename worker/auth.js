// Stockroom's own sign-in: 6-digit email codes and passkeys (Face ID / Touch ID / fingerprint).
// Sessions are random tokens in an HttpOnly cookie; only their SHA-256 hash is stored.
import {generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse} from '@simplewebauthn/server';
import {HttpError, readBody, ADMIN_EMAIL} from './security.js';

const COOKIE = 'sr_session';
const SESSION_DAYS = 60, CODE_MINUTES = 10, MAX_ATTEMPTS = 5;
const enc = new TextEncoder();
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const sha = async text => hex(await crypto.subtle.digest('SHA-256', enc.encode(text)));
const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = text => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '=')), c => c.charCodeAt(0));
const randomToken = () => b64url(crypto.getRandomValues(new Uint8Array(32)));
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {status, headers: {'content-type': 'application/json', 'cache-control': 'no-store', ...headers}});
const normaliseEmail = value => typeof value === 'string' ? value.trim().toLowerCase() : '';
const validEmail = email => email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);

export function readCookie(request, name = COOKIE) {
  const match = (request.headers.get('cookie') || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return match ? decodeURIComponent(match[1]) : null;
}
const sessionCookie = (token, maxAge) => COOKIE + '=' + token + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=' + maxAge;

// Called for every request by entry.js: turns a valid session cookie into the signed-in identity.
export async function sessionIdentity(request, env) {
  const token = readCookie(request);
  if (!token || token.length > 100 || !env.DB) return null;
  const row = await env.DB.prepare('SELECT a.id, a.email FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = ? AND s.expires_at > ?')
    .bind(await sha(token), Date.now()).first().catch(() => null);
  return row ? {id: row.id, email: row.email} : null;
}

// Find or create the account for an email. Existing members keep their id, so their workspace and data carry over.
async function accountFor(env, email) {
  let account = await env.DB.prepare('SELECT * FROM accounts WHERE email = ?').bind(email).first();
  if (account) return account;
  const member = await env.DB.prepare('SELECT user_id FROM members WHERE email = ? AND user_id IS NOT NULL').bind(email).first().catch(() => null);
  // The owner never had a members row under Cloudflare Access: reuse the owner's existing id so their workspace carries over.
  const owner = !member && email === ADMIN_EMAIL ? await env.DB.prepare('SELECT p.user_id FROM profiles p JOIN workspaces w ON w.owner_id = p.user_id WHERE p.owner = 1 ORDER BY w.updated_at DESC LIMIT 1').first().catch(() => null) : null;
  const id = member?.user_id || owner?.user_id || crypto.randomUUID();
  await env.DB.prepare('INSERT OR IGNORE INTO accounts (id, email, created_at) VALUES (?, ?, ?)').bind(id, email, new Date().toISOString()).run();
  return env.DB.prepare('SELECT * FROM accounts WHERE email = ?').bind(email).first();
}

async function startSession(env, accountId, request) {
  const token = randomToken();
  const device = (request.headers.get('user-agent') || '').slice(0, 160);
  await env.DB.prepare('INSERT INTO sessions (token_hash, account_id, created_at, expires_at, device) VALUES (?, ?, ?, ?, ?)')
    .bind(await sha(token), accountId, Date.now(), Date.now() + SESSION_DAYS * 86400000, device).run();
  await env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(Date.now()).run().catch(() => {});
  return sessionCookie(token, SESSION_DAYS * 86400);
}

async function limit(env, key, max) {
  const window = Math.floor(Date.now() / 600000); // 10-minute windows
  const row = await env.DB.prepare('INSERT INTO rate_limits (key,window,count) VALUES (?,?,1) ON CONFLICT(key) DO UPDATE SET count = CASE WHEN window = excluded.window THEN count + 1 ELSE 1 END, window = excluded.window RETURNING count')
    .bind('auth:' + key, window).first();
  if (row.count > max) throw new HttpError(429, 'Too many attempts. Wait 10 minutes and try again.');
}

function codeEmail(code) {
  const text = 'Your Stockroom sign-in code is ' + code + '.\n\nIt works for ' + CODE_MINUTES + ' minutes. If you didn’t ask for it, ignore this email.';
  const html = '<!doctype html><html><body style="margin:0;background:#131316;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#f4f4f5">' +
    '<table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 16px"><tr><td align="center"><table width="100%" style="max-width:440px;background:#1b1b1f;border:1px solid #2c2c32;border-radius:16px;padding:32px">' +
    '<tr><td style="font-size:15px;color:#b9b9c2">Stockroom</td></tr>' +
    '<tr><td style="padding:18px 0 8px;font-size:22px;font-weight:600">Your sign-in code</td></tr>' +
    '<tr><td style="padding:8px 0 18px"><div style="font-size:38px;letter-spacing:10px;font-weight:700;font-family:Menlo,Consolas,monospace">' + code + '</div></td></tr>' +
    '<tr><td style="font-size:14px;color:#b9b9c2;line-height:1.5">Enter it in Stockroom to sign in. It works for ' + CODE_MINUTES + ' minutes.<br>If you didn’t ask for this, you can ignore this email.</td></tr>' +
    '</table></td></tr></table></body></html>';
  return {text, html};
}

const rpFor = url => ({rpID: url.hostname, origin: url.origin});

export async function authRoute(request, url, env) {
  if (request.method !== 'POST') throw new HttpError(405, 'Method not allowed.');
  const ip = request.headers.get('cf-connecting-ip') || 'local';

  if (url.pathname === '/auth/code') {
    const {email: raw} = await readBody(request, 2000) || {};
    const email = normaliseEmail(raw);
    if (!validEmail(email)) throw new HttpError(400, 'Enter a valid email address.');
    await limit(env, 'ip:' + ip, 20); await limit(env, 'code:' + email, 5);
    const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0');
    await env.DB.prepare('INSERT INTO login_codes (email, code_hash, expires_at, attempts) VALUES (?, ?, ?, 0) ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0')
      .bind(email, await sha(email + ':' + code), Date.now() + CODE_MINUTES * 60000).run();
    if (env.RESEND_API_KEY) {
      const {text, html} = codeEmail(code);
      const response = await (env.RESEND_FETCH || fetch)('https://api.resend.com/emails', {
        method: 'POST', signal: AbortSignal.timeout(10000),
        headers: {authorization: 'Bearer ' + env.RESEND_API_KEY, 'content-type': 'application/json'},
        body: JSON.stringify({from: 'Booked & Paid Stockroom <' + (env.AUTH_EMAIL_FROM || 'login@bookednpaid.com') + '>', to: [email], subject: code + ' is your Stockroom code', text, html}),
      }).catch(() => null);
      if (!response?.ok) {
        console.log(JSON.stringify({auth: 'email_failed', status: response?.status || 0, message: (await response?.text().catch(() => '') || '').slice(0, 200)}));
        throw new HttpError(502, 'We couldn’t send the email just now. Try again in a minute.');
      }
      return json({sent: true});
    }
    if (env.AUTH_DEV_CODES === 'show') return json({sent: true, devCode: code}); // local development only
    throw new HttpError(503, 'Email sign-in isn’t switched on yet.');
  }

  if (url.pathname === '/auth/verify') {
    const {email: raw, code} = await readBody(request, 2000) || {};
    const email = normaliseEmail(raw);
    await limit(env, 'ip:' + ip, 30);
    const row = await env.DB.prepare('SELECT * FROM login_codes WHERE email = ?').bind(email).first();
    if (!row || row.expires_at < Date.now() || row.attempts >= MAX_ATTEMPTS) throw new HttpError(400, 'That code has expired. Ask for a new one.');
    if (typeof code !== 'string' || row.code_hash !== await sha(email + ':' + code.replace(/\s/g, ''))) {
      await env.DB.prepare('UPDATE login_codes SET attempts = attempts + 1 WHERE email = ?').bind(email).run();
      throw new HttpError(400, row.attempts + 1 >= MAX_ATTEMPTS ? 'Too many wrong codes. Ask for a new one.' : 'That code isn’t right. Check the email and try again.');
    }
    await env.DB.prepare('DELETE FROM login_codes WHERE email = ?').bind(email).run();
    const account = await accountFor(env, email);
    const passkeys = await env.DB.prepare('SELECT COUNT(*) AS n FROM passkeys WHERE account_id = ?').bind(account.id).first();
    return json({ok: true, hasPasskey: passkeys.n > 0}, 200, {'set-cookie': await startSession(env, account.id, request)});
  }

  if (url.pathname === '/auth/logout') {
    const token = readCookie(request);
    if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha(token)).run();
    return json({ok: true}, 200, {'set-cookie': sessionCookie('', 0)});
  }

  const {rpID, origin} = rpFor(url);

  if (url.pathname === '/auth/passkey/login/options') {
    await limit(env, 'ip:' + ip, 30);
    const options = await generateAuthenticationOptions({rpID, userVerification: 'preferred'});
    const id = randomToken();
    await env.DB.prepare('INSERT INTO auth_challenges (id, challenge, account_id, expires_at) VALUES (?, ?, NULL, ?)').bind(id, options.challenge, Date.now() + 300000).run();
    return json({options, challengeId: id});
  }

  if (url.pathname === '/auth/passkey/login/verify') {
    const {challengeId, response} = await readBody(request, 20000) || {};
    const challenge = await env.DB.prepare('SELECT * FROM auth_challenges WHERE id = ? AND expires_at > ?').bind(String(challengeId || ''), Date.now()).first();
    if (!challenge) throw new HttpError(400, 'That took too long. Try again.');
    await env.DB.prepare('DELETE FROM auth_challenges WHERE id = ?').bind(challenge.id).run();
    const key = await env.DB.prepare('SELECT * FROM passkeys WHERE id = ?').bind(String(response?.id || '')).first();
    if (!key) throw new HttpError(400, 'This passkey isn’t linked to a Stockroom account. Sign in with an email code instead.');
    let result;
    try {
      result = await verifyAuthenticationResponse({response, expectedChallenge: challenge.challenge, expectedOrigin: origin, expectedRPID: rpID,
        credential: {id: key.id, publicKey: fromB64url(key.public_key), counter: key.counter, transports: key.transports ? JSON.parse(key.transports) : undefined}, requireUserVerification: false});
    } catch { throw new HttpError(400, 'Passkey sign-in failed. Try again or use an email code.'); }
    if (!result.verified) throw new HttpError(400, 'Passkey sign-in failed. Try again or use an email code.');
    await env.DB.prepare('UPDATE passkeys SET counter = ? WHERE id = ?').bind(result.authenticationInfo.newCounter, key.id).run();
    return json({ok: true}, 200, {'set-cookie': await startSession(env, key.account_id, request)});
  }

  // Everything below needs a signed-in user.
  const user = await sessionIdentity(request, env);
  if (!user) throw new HttpError(401, 'Sign in first.');

  if (url.pathname === '/auth/passkey/register/options') {
    const existing = await env.DB.prepare('SELECT id, transports FROM passkeys WHERE account_id = ?').bind(user.id).all();
    const options = await generateRegistrationOptions({rpName: 'Stockroom', rpID, userName: user.email, userDisplayName: user.email, userID: enc.encode(user.id),
      attestationType: 'none', excludeCredentials: existing.results.map(k => ({id: k.id, transports: k.transports ? JSON.parse(k.transports) : undefined})),
      authenticatorSelection: {residentKey: 'required', userVerification: 'preferred'}});
    const id = randomToken();
    await env.DB.prepare('INSERT INTO auth_challenges (id, challenge, account_id, expires_at) VALUES (?, ?, ?, ?)').bind(id, options.challenge, user.id, Date.now() + 300000).run();
    return json({options, challengeId: id});
  }

  if (url.pathname === '/auth/passkey/register/verify') {
    const {challengeId, response, name} = await readBody(request, 20000) || {};
    const challenge = await env.DB.prepare('SELECT * FROM auth_challenges WHERE id = ? AND account_id = ? AND expires_at > ?').bind(String(challengeId || ''), user.id, Date.now()).first();
    if (!challenge) throw new HttpError(400, 'That took too long. Try again.');
    await env.DB.prepare('DELETE FROM auth_challenges WHERE id = ?').bind(challenge.id).run();
    let result;
    try { result = await verifyRegistrationResponse({response, expectedChallenge: challenge.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: false}); }
    catch { throw new HttpError(400, 'Couldn’t save that passkey. Try again.'); }
    if (!result.verified || !result.registrationInfo) throw new HttpError(400, 'Couldn’t save that passkey. Try again.');
    const {credential} = result.registrationInfo;
    await env.DB.prepare('INSERT OR REPLACE INTO passkeys (id, account_id, public_key, counter, transports, name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(credential.id, user.id, b64url(credential.publicKey), credential.counter, JSON.stringify(credential.transports || response?.response?.transports || []),
        String(name || 'Passkey').slice(0, 60), new Date().toISOString()).run();
    return json({ok: true});
  }

  if (url.pathname === '/auth/passkeys') {
    const {remove} = await readBody(request, 2000) || {};
    if (remove) await env.DB.prepare('DELETE FROM passkeys WHERE id = ? AND account_id = ?').bind(String(remove), user.id).run();
    const rows = await env.DB.prepare('SELECT id, name, created_at FROM passkeys WHERE account_id = ? ORDER BY created_at').bind(user.id).all();
    return json({passkeys: rows.results});
  }

  throw new HttpError(404, 'Not found.');
}
