const { clearSessionCookie } = require('./_lib/auth');
const { getAuthContext } = require('./_lib/access');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  try {
    const context = await getAuthContext(req);
    if (!context) {
      clearSessionCookie(res);
      return res.end(JSON.stringify({ authenticated: false }));
    }

    const user = context.effectiveUser;
    const actual = context.actualUser;
    return res.end(JSON.stringify({
      authenticated: true,
      previewing: context.previewing,
      user: { email: user.email, name: user.name, role: user.role, team: user.team },
      actualUser: { email: actual.email, name: actual.name, role: actual.role, team: actual.team },
    }));
  } catch (error) {
    console.error('[Auth me]', error);
    res.statusCode = 500;
    return res.end(JSON.stringify({ authenticated: false, error: 'auth_unavailable' }));
  }
};
