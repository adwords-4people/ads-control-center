const { getAuthContext, getAccessScope, isAdmin } = require('../_lib/access');
const { loadAllDashboardSources } = require('../_lib/data-sources');
const { oidcInfo } = require('../_lib/sheets');

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  try {
    const context = await getAuthContext(req);
    if (!context) { res.statusCode = 401; return res.end(JSON.stringify({ ok: false, error: 'unauthenticated' })); }
    if (!isAdmin(context.actualUser)) { res.statusCode = 403; return res.end(JSON.stringify({ ok: false, error: 'admin_only' })); }

    // Use actual Admin scope even if "preview as" cookie is active, so diagnostics always
    // test physical access to every dashboard source rather than user filtering.
    const scope = await getAccessScope(req);
    const diagnosticScope = { ...scope, unrestricted: true };
    const started = Date.now();
    const { sources, errors } = await loadAllDashboardSources(req, diagnosticScope);

    const checks = Object.entries(sources).map(([key, source]) => ({
      key,
      ok: source.ok,
      rows: Array.isArray(source.rows) ? source.rows.length : 0,
      columns: Array.isArray(source.headers) ? source.headers.length : 0,
      sheetTitle: source.sheetTitle,
      gid: source.gid,
      error: source.error,
    }));

    const ok = errors.length === 0;
    res.statusCode = ok ? 200 : 503;
    return res.end(JSON.stringify({
      ok,
      auth: 'vercel-oidc-workload-identity-federation',
      oidc: oidcInfo(),
      ms: Date.now() - started,
      checks,
      errors,
    }, null, 2));
  } catch (error) {
    console.error('[Sheets check]', error);
    res.statusCode = 500;
    return res.end(JSON.stringify({ ok: false, error: error.message }));
  }
};
