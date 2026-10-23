const crypto = require('crypto');

const SESSION_COOKIE = 'ppc_session';
const STATE_COOKIE = 'ppc_oauth_state';
const PREVIEW_COOKIE = 'ppc_preview';
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const PREVIEW_TTL_SECONDS = 2 * 60 * 60;

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Brak wymaganej zmiennej środowiskowej ${name}.`);
  return value;
}

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function sign(value) {
  const secret = requireEnv('AUTH_SECRET');
  return crypto.createHmac('sha256', secret).update(value).digest('base64url');
}

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function createSignedPayload(payload, ttlSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const encoded = base64url(JSON.stringify({ ...payload, iat: now, exp: now + ttlSeconds }));
  return `${encoded}.${sign(encoded)}`;
}

function verifySignedPayload(token) {
  if (!token || !token.includes('.')) return null;
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature || !safeEqual(sign(encoded), signature)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    const now = Math.floor(Date.now() / 1000);
    if (!payload.exp || payload.exp <= now) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

function createSessionToken(user) {
  return createSignedPayload({
    email: user.email,
    name: user.name,
    role: user.role,
    team: user.team,
  }, SESSION_TTL_SECONDS);
}

function verifySessionToken(token) {
  const payload = verifySignedPayload(token);
  return payload && payload.email ? payload : null;
}

function parseCookies(req) {
  const raw = req.headers.cookie || '';
  return raw.split(';').reduce((acc, part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return acc;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) acc[key] = decodeURIComponent(value);
    return acc;
  }, {});
}

function cookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path || '/'}`);
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  if (options.httpOnly !== false) parts.push('HttpOnly');
  if (options.secure !== false) parts.push('Secure');
  parts.push(`SameSite=${options.sameSite || 'Lax'}`);
  return parts.join('; ');
}

function setSessionCookie(res, user) {
  res.setHeader('Set-Cookie', cookie(SESSION_COOKIE, createSessionToken(user), {
    maxAge: SESSION_TTL_SECONDS,
  }));
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', [
    cookie(SESSION_COOKIE, '', { maxAge: 0 }),
    cookie(PREVIEW_COOKIE, '', { maxAge: 0 }),
  ]);
}

function getSession(req) {
  const cookies = parseCookies(req);
  return verifySessionToken(cookies[SESSION_COOKIE]);
}

function setPreviewCookie(res, email) {
  const token = createSignedPayload({ email: String(email || '').trim().toLowerCase() }, PREVIEW_TTL_SECONDS);
  res.setHeader('Set-Cookie', cookie(PREVIEW_COOKIE, token, { maxAge: PREVIEW_TTL_SECONDS }));
}

function clearPreviewCookie(res) {
  res.setHeader('Set-Cookie', cookie(PREVIEW_COOKIE, '', { maxAge: 0 }));
}

function getPreviewEmail(req) {
  const cookies = parseCookies(req);
  const payload = verifySignedPayload(cookies[PREVIEW_COOKIE]);
  return payload && payload.email ? String(payload.email).trim().toLowerCase() : '';
}

function createState() {
  return crypto.randomBytes(24).toString('base64url');
}

function setStateCookie(res, state) {
  res.setHeader('Set-Cookie', cookie(STATE_COOKIE, state, { maxAge: 10 * 60 }));
}

function consumeAndVerifyState(req, res, providedState) {
  const cookies = parseCookies(req);
  const stored = cookies[STATE_COOKIE] || '';
  res.setHeader('Set-Cookie', cookie(STATE_COOKIE, '', { maxAge: 0 }));
  return Boolean(providedState && stored && safeEqual(providedState, stored));
}

module.exports = {
  clearPreviewCookie,
  clearSessionCookie,
  consumeAndVerifyState,
  createState,
  getPreviewEmail,
  getSession,
  requireEnv,
  setPreviewCookie,
  setSessionCookie,
  setStateCookie,
};
