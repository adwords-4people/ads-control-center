const { getAuthContext, isAdmin } = require('../_lib/access');
const { loadUsers } = require('../_lib/users');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  try {
    const context = await getAuthContext(req);
    if (!context) { res.statusCode = 401; return res.end(JSON.stringify({ error: 'unauthenticated' })); }
    if (!isAdmin(context.actualUser)) { res.statusCode = 403; return res.end(JSON.stringify({ error: 'forbidden' })); }

    const users = (await loadUsers(req))
      .filter(user => user.active)
      .map(({ email, name, role, team }) => ({ email, name, role, team }));
    return res.end(JSON.stringify({ users }));
  } catch (error) {
    console.error('[Admin users]', error);
    res.statusCode = 500;
    return res.end(JSON.stringify({ error: 'users_unavailable' }));
  }
};
