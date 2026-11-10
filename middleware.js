// Brána pred celým kalendárom: bez platného prihlásenia Vercel nevydá žiadnu stránku ani dáta.
import { readCookie, verifyToken, isConfigured } from './api/_session.js';

const OPEN = new Set(['/login', '/login.html', '/api/login', '/api/logout', '/favicon.ico']);

// Pokračovanie k pôvodnému cieľu (rovnaké ako next() z @vercel/functions).
const pass = () => new Response(null, {headers: {'x-middleware-next': '1'}});

export default async function middleware(request) {
  const url = new URL(request.url);
  if (OPEN.has(url.pathname)) return pass();

  if (!isConfigured()) {
    return new Response(
      '<!doctype html><meta charset="utf-8"><title>Kalendár nie je nastavený</title>' +
      '<p style="font-family:system-ui,sans-serif;padding:2rem;max-width:40rem">Kalendár ešte nie je nastavený. ' +
      'Vo Verceli chýba premenná prostredia <b>APP_PASSWORD</b>.</p>',
      {status: 503, headers: {'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store'}}
    );
  }

  if (await verifyToken(readCookie(request.headers.get('cookie')))) return pass();

  if (url.pathname.startsWith('/api/')) {
    return new Response(JSON.stringify({ok: false, error: 'login_required'}), {
      status: 401, headers: {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'}
    });
  }
  const target = new URL('/login', url);
  const back = url.pathname + url.search;
  if (back !== '/') target.searchParams.set('next', back);
  return Response.redirect(target.toString(), 302);
}
