import { checkPassword, createToken, sessionCookie, safeNext, isConfigured } from './_session.js';
import { readRaw } from './_http.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return redirect(res, '/login');
  const body = await readForm(req);
  const next = safeNext(body.next);
  if (!isConfigured()) {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.end('Vo Verceli chýba premenná prostredia APP_PASSWORD.');
  }
  const role = await checkPassword(body.password);
  if (!role) {
    await new Promise(r => setTimeout(r, 700)); // spomalí skúšanie hesiel naslepo
    return redirect(res, '/login?chyba=1' + (next !== '/' ? '&next=' + encodeURIComponent(next) : ''));
  }
  // Kto je, si vyberie až v kalendári (member '-').
  res.setHeader('Set-Cookie', sessionCookie(await createToken(role, '-')));
  return redirect(res, next);
}

function redirect(res, location) {
  res.statusCode = 303;
  res.setHeader('Location', location);
  res.setHeader('Cache-Control', 'no-store');
  res.end();
}

async function readForm(req) {
  let b = req.body;
  if (b === undefined) b = await readRaw(req);
  if (b && typeof b === 'object' && !Buffer.isBuffer(b)) return b;
  const p = new URLSearchParams(Buffer.isBuffer(b) ? b.toString('utf8') : String(b || ''));
  return {password: p.get('password'), next: p.get('next')};
}
