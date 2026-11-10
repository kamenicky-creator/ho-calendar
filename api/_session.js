// Spoločná logika prihlásenia. Používa ju middleware.js aj funkcie v priečinku api/.
// Súbory začínajúce podčiarkovníkom Vercel nezverejňuje ako samostatné endpointy.

const enc = new TextEncoder();
export const COOKIE = 'ho_session';
export const MAX_AGE = 60 * 60 * 24 * 30; // prihlásenie platí 30 dní

export const isConfigured = () => !!process.env.APP_PASSWORD;

// Kľúč na podpis prihlásenia je odvodený od hesla: zmena hesla odhlási všetkých.
function signingSecret() {
  const p = process.env.APP_PASSWORD || '';
  return p ? 'ho-session|' + p + '|' + (process.env.SESSION_SECRET || '') : '';
}

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}

function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function sameText(a, b) {
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

export async function checkPassword(input) {
  const real = process.env.APP_PASSWORD || '';
  if (!real) return false;
  const a = b64url(await hmac('ho-password', String(input == null ? '' : input)));
  const b = b64url(await hmac('ho-password', real));
  return sameText(a, b);
}

export async function createToken(now = Date.now()) {
  const exp = Math.floor(now / 1000) + MAX_AGE;
  return 'v1.' + exp + '.' + b64url(await hmac(signingSecret(), 'v1.' + exp));
}

export async function verifyToken(token, now = Date.now()) {
  const secret = signingSecret();
  if (!secret || !token) return false;
  const m = /^v1\.(\d{1,12})\.([A-Za-z0-9_-]{20,100})$/.exec(String(token));
  if (!m || Number(m[1]) < Math.floor(now / 1000)) return false;
  return sameText(b64url(await hmac(secret, 'v1.' + m[1])), m[2]);
}

export function readCookie(header, name = COOKIE) {
  if (!header) return '';
  for (const part of String(header).split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch (e) { return ''; }
    }
  }
  return '';
}

export const sessionCookie = token => `${COOKIE}=${token}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; Secure; SameSite=Lax`;
export const clearCookie = () => `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

// Po prihlásení presmeruje späť len na stránku v rámci kalendára.
export function safeNext(value) {
  const s = String(value || '/');
  if (!s.startsWith('/') || s.startsWith('//') || s.startsWith('/\\')) return '/';
  if (s.startsWith('/api/') || s.startsWith('/login')) return '/';
  return s;
}
