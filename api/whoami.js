// GET: kto je prihlásený. POST {member}: výber vlastného mena po prihlásení.
import { sessionFromReq, createToken, sessionCookie, validMember, ADMIN_ID } from './_session.js';
import { sendJson, readJsonBody, callGas } from './_http.js';

export default async function handler(req, res) {
  const s = await sessionFromReq(req);
  if (!s) return sendJson(res, 401, {ok: false, error: 'login_required'});
  if (req.method === 'GET') return sendJson(res, 200, {ok: true, data: s});
  if (req.method !== 'POST') return sendJson(res, 405, {ok: false, error: 'bad_request'});

  const body = await readJsonBody(req);
  const member = body && body.member;
  if (!validMember(member)) return sendJson(res, 200, {ok: false, error: 'bad_request'});

  if (member === ADMIN_ID) {
    if (s.role !== 'a') return sendJson(res, 200, {ok: false, error: 'forbidden'});
  } else {
    const t = await callGas({action: 'team'});
    if (!t || !t.ok) return sendJson(res, t && t.status || 200, t || {ok: false, error: 'network'});
    const list = (t.data && Array.isArray(t.data.members)) ? t.data.members : [];
    if (!list.some(m => m && m.id === member && m.active !== false)) return sendJson(res, 200, {ok: false, error: 'unknown_member'});
  }
  res.setHeader('Set-Cookie', sessionCookie(await createToken(s.role, member)));
  return sendJson(res, 200, {ok: true, data: {role: s.role, member}});
}
