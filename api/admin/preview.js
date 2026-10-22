const { clearPreviewCookie, setPreviewCookie } = require('../_lib/auth');
const { getAuthContext, isAdmin } = require('../_lib/access');
const { getActiveUserByEmail } = require('../_lib/users');

async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  let raw = '';
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method !== 'POST') { res.statusCode = 405; return res.end(JSON.stringify({ error: 'method_not_allowed' })); }

  try {
    const context = await getAuthContext(req);
    if (!context) { res.statusCode = 401; return res.end(JSON.stringify({ error: 'unauthenticated' })); }
    if (!isAdmin(context.actualUser)) { res.statusCode = 403; return res.end(JSON.stringify({ error: 'forbidden' })); }

    const body = await readJson(req);
    const email = String(body.email || '').trim().toLowerCase();
    if (!email || email === context.actualUser.email) {
      clearPreviewCookie(res);
      return res.end(JSON.stringify({ ok: true, previewing: false }));
    }

    const target = await getActiveUserByEmail(email);
    if (!target) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'invalid_user' })); }
    setPreviewCookie(res, target.email);
    return res.end(JSON.stringify({ ok: true, previewing: true, user: target }));
  } catch (error) {
    console.error('[Admin preview]', error);
    res.statusCode = 500;
    return res.end(JSON.stringify({ error: 'preview_unavailable' }));
  }
};
