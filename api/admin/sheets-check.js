const { getAuthContext, isAdmin } = require('../_lib/access');
const { IDS, fetchSheetByGid, fetchSheetByName, oidcInfo } = require('../_lib/sheets');

async function runCheck(name, fn) {
  const started = Date.now();
  try {
    const result = await fn();
    return {
      name,
      ok: true,
      rows: Array.isArray(result.rows) ? result.rows.length : null,
      columns: Array.isArray(result.headers) ? result.headers.length : null,
      ms: Date.now() - started,
    };
  } catch (error) {
    return { name, ok: false, error: error.message, ms: Date.now() - started };
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  try {
    const context = await getAuthContext(req);
    if (!context) { res.statusCode = 401; return res.end(JSON.stringify({ ok: false, error: 'unauthenticated' })); }
    if (!isAdmin(context.actualUser)) { res.statusCode = 403; return res.end(JSON.stringify({ ok: false, error: 'admin_only' })); }

    const checks = await Promise.all([
      runCheck('Config / Użytkownicy', () => fetchSheetByName(IDS.config, 'Użytkownicy', req)),
      runCheck('Config / MCK - Google Ads', () => fetchSheetByName(IDS.config, 'MCK - Google Ads', req)),
      runCheck('Config / Konta - Google Ads', () => fetchSheetByName(IDS.config, 'Konta - Google Ads', req)),
      runCheck('Config / Konta - Meta Ads', () => fetchSheetByName(IDS.config, 'Konta - Meta Ads', req)),
      runCheck('Google Ads / Wydatki', () => fetchSheetByName(IDS.google, 'Wydatki', req)),
      runCheck('Meta Ads / Raport_Miesieczny (GID)', () => fetchSheetByGid(IDS.meta, '1581500139', req)),
    ]);

    const ok = checks.every(item => item.ok);
    res.statusCode = ok ? 200 : 503;
    return res.end(JSON.stringify({
      ok,
      auth: 'vercel-oidc-workload-identity-federation',
      oidc: oidcInfo(),
      checks,
    }, null, 2));
  } catch (error) {
    console.error('[Sheets check]', error);
    res.statusCode = 500;
    return res.end(JSON.stringify({ ok: false, error: error.message }));
  }
};
