import { clearCookie } from './_session.js';

export default function handler(req, res) {
  res.setHeader('Set-Cookie', clearCookie());
  res.setHeader('Cache-Control', 'no-store');
  res.statusCode = 303;
  res.setHeader('Location', '/login');
  res.end();
}
