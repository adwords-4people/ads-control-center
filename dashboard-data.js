const { getDashboardScopes } = require('./_lib/access');
const { loadAllDashboardSources } = require('./_lib/data-sources');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  try {
    const scopes = await getDashboardScopes(req);
    if (!scopes) {
      res.statusCode = 401;
      return res.end(JSON.stringify({ ok: false, error: 'unauthenticated' }));
    }

    const started = Date.now();
    const { sources, errors } = await loadAllDashboardSources(req, scopes.personalScope, { notesScope: scopes.accessScope });

    res.statusCode = 200;
    return res.end(JSON.stringify({
      ok: errors.length === 0,
      partial: errors.length > 0,
      ms: Date.now() - started,
      errors,
      sources,
    }));
  } catch (error) {
    console.error('[Dashboard data]', error);
    res.statusCode = 500;
    return res.end(JSON.stringify({ ok: false, error: error.message }));
  }
};
