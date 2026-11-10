// Sprostredkuje dopyty kalendára na Google Apps Script. Adresa servera aj tímový kľúč
// zostávajú vo Verceli (GAS_URL, GAS_KEY), do prehliadača sa nikdy nedostanú.
import { readCookie, verifyToken } from './_session.js';

export default async function handler(req, res) {
  const send = (status, obj) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(obj));
  };
  if (!(await verifyToken(readCookie(req.headers.cookie)))) return send(401, {ok: false, error: 'login_required'});
  if (req.method !== 'POST') return send(405, {ok: false, error: 'bad_request'});

  const url = process.env.GAS_URL, key = process.env.GAS_KEY;
  if (!url || !key) return send(200, {ok: false, error: 'proxy_not_configured'});

  let body = req.body;
  if (body === undefined) body = await readRaw(req);
  if (Buffer.isBuffer(body)) body = body.toString('utf8');
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return send(200, {ok: false, error: 'bad_request'});

  let r;
  try {
    r = await fetch(url, {
      method: 'POST',
      headers: {'Content-Type': 'text/plain; charset=utf-8'},
      body: JSON.stringify(Object.assign({}, body, {key})),
      redirect: 'follow'
    });
  } catch (e) {
    return send(502, {ok: false, error: 'network'});
  }
  let j;
  try { j = JSON.parse(await r.text()); } catch (e) { return send(502, {ok: false, error: 'network'}); }
  if (j && j.ok === false && j.error === 'unauthorized') j = {ok: false, error: 'proxy_key_mismatch'};
  return send(200, j);
}

function readRaw(req) {
  return new Promise(resolve => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => resolve(data));
    req.on('error', () => resolve(''));
  });
}
