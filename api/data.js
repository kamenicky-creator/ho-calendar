// Sprostredkuje dopyty kalendára na Google Apps Script a stráži, kto čo smie meniť:
// člen tímu len svoje dni, správca dni všetkých aj zoznam tímu. Poznámky ku dňom môže meniť každý.
import { sessionFromReq } from './_session.js';
import { sendJson, readJsonBody, callGas } from './_http.js';

const READ = new Set(['sync', 'team', 'month']);
const WRITE = new Set(['setCells', 'setNotes', 'setTeam']);

export default async function handler(req, res) {
  const s = await sessionFromReq(req);
  if (!s) return sendJson(res, 401, {ok: false, error: 'login_required'});
  if (req.method !== 'POST') return sendJson(res, 405, {ok: false, error: 'bad_request'});

  const body = await readJsonBody(req);
  if (!body || (!READ.has(body.action) && !WRITE.has(body.action))) return sendJson(res, 200, {ok: false, error: 'bad_request'});
  delete body.by;

  if (WRITE.has(body.action)) {
    if (s.member === '-') return sendJson(res, 200, {ok: false, error: 'identity_required'});
    if (s.role !== 'a') {
      if (body.action === 'setTeam') return sendJson(res, 200, {ok: false, error: 'forbidden'});
      if (body.action === 'setCells') {
        const ch = body.changes;
        if (!Array.isArray(ch) || ch.some(c => !c || c.id !== s.member)) return sendJson(res, 200, {ok: false, error: 'forbidden'});
      }
    }
    body.by = s.member; // do denníka zmien
  }
  const j = await callGas(body);
  return sendJson(res, j && j.status || 200, j || {ok: false, error: 'network'});
}
