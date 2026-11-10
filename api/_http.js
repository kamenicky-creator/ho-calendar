// Pomocné funkcie pre funkcie v priečinku api/: odpovede, čítanie tela a volanie Apps Scriptu.

export function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

export async function readJsonBody(req) {
  let body = req.body;
  if (body === undefined) body = await readRaw(req);
  if (Buffer.isBuffer(body)) body = body.toString('utf8');
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
  return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
}

export function readRaw(req) {
  return new Promise(resolve => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => resolve(data));
    req.on('error', () => resolve(''));
  });
}

// Pošle dopyt na Google Apps Script s tímovým kľúčom. Adresa aj kľúč sú len vo Verceli.
export async function callGas(payload) {
  const url = process.env.GAS_URL, key = process.env.GAS_KEY;
  if (!url || !key) return {ok: false, error: 'proxy_not_configured'};
  let r;
  try {
    r = await fetch(url, {
      method: 'POST',
      headers: {'Content-Type': 'text/plain; charset=utf-8'},
      body: JSON.stringify(Object.assign({}, payload, {key})),
      redirect: 'follow'
    });
  } catch (e) {
    return {ok: false, error: 'network', status: 502};
  }
  let j;
  try { j = JSON.parse(await r.text()); } catch (e) { return {ok: false, error: 'network', status: 502}; }
  if (j && j.ok === false && j.error === 'unauthorized') return {ok: false, error: 'proxy_key_mismatch'};
  return j;
}
