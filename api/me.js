const { clearSessionCookie, getSession } = require('./_lib/auth');
const { getActiveUserByEmail } = require('./_lib/users');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  try {
    const session = getSession(req);
    if (!session) return res.end(JSON.stringify({ authenticated: false }));

    // Re-check the configuration on every session probe so setting Aktywne=NIE
    // takes effect without waiting for the cookie to expire.
    const currentUser = await getActiveUserByEmail(session.email);
    if (!currentUser) {
      clearSessionCookie(res);
      return res.end(JSON.stringify({ authenticated: false }));
    }

    return res.end(JSON.stringify({
      authenticated: true,
      user: {
        email: currentUser.email,
        name: currentUser.name,
        role: currentUser.role,
        team: currentUser.team,
      },
    }));
  } catch (error) {
    console.error('[Auth me]', error);
    res.statusCode = 500;
    return res.end(JSON.stringify({ authenticated: false, error: 'auth_unavailable' }));
  }
};
