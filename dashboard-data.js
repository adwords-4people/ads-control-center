const { getReportingScope } = require('./_lib/access');
const { loadAllDashboardSources } = require('./_lib/data-sources');

const BUILD = '1.7.7-report-scope';

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  try {
    const scope = await getReportingScope(req);
    if (!scope) {
      res.statusCode = 401;
      return res.end(JSON.stringify({ ok: false, error: 'unauthenticated', build: BUILD }));
    }

    const started = Date.now();
    const { sources, errors } = await loadAllDashboardSources(req, scope);

    res.statusCode = 200;
    return res.end(JSON.stringify({
      ok: errors.length === 0,
      partial: errors.length > 0,
      build: BUILD,
      ms: Date.now() - started,
      errors,
      reportingScope: {
        effectiveUser: scope.effectiveUser && scope.effectiveUser.email || '',
        previewing: Boolean(scope.previewing),
        googleAccounts: scope.googleIds ? scope.googleIds.size : 0,
        metaAccounts: scope.metaIds ? scope.metaIds.size : 0,
      },
      sources,
    }));
  } catch (error) {
    console.error('[Dashboard data]', error);
    res.statusCode = 500;
    return res.end(JSON.stringify({ ok: false, error: error.message, build: BUILD }));
  }
};
