const { getAccessScope } = require('./_lib/access');
const {
  CONFIG_SOURCES,
  GOOGLE_SOURCES,
  META_SOURCES,
  filterConfig,
  filterGoogle,
  filterMeta,
} = require('./_lib/data-sources');
const {
  IDS,
  fetchSheetByGid,
  fetchSheetByName,
  stringifyCsv,
} = require('./_lib/sheets');

const GOOGLE_SHEETS = new Set(Object.values(GOOGLE_SOURCES));
const CONFIG_SHEETS = new Set(Object.values(CONFIG_SOURCES));
const META_GIDS = new Set(Object.values(META_SOURCES));

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  try {
    const scope = await getAccessScope(req);
    if (!scope) { res.statusCode = 401; return res.end('Brak aktywnej sesji.'); }

    const mode = String(req.query && req.query.mode || '');
    const sheetId = String(req.query && req.query.sheetId || '');
    let result;
    let filtered;

    if (mode === 'name' && sheetId === IDS.google) {
      const sheet = String(req.query.sheet || '');
      if (!GOOGLE_SHEETS.has(sheet)) { res.statusCode = 400; return res.end('Niedozwolona zakładka Google Ads.'); }
      result = await fetchSheetByName(IDS.google, sheet, req);
      filtered = filterGoogle(result.rows, scope, sheet);
    } else if (mode === 'name' && sheetId === IDS.config) {
      const sheet = String(req.query.sheet || '');
      if (!CONFIG_SHEETS.has(sheet)) { res.statusCode = 400; return res.end('Niedozwolona zakładka konfiguracji.'); }
      result = await fetchSheetByName(IDS.config, sheet, req);
      filtered = filterConfig(result.rows, scope, sheet);
    } else if (mode === 'gid' && sheetId === IDS.meta) {
      const gid = String(req.query.gid || '');
      if (!META_GIDS.has(gid)) { res.statusCode = 400; return res.end('Niedozwolony raport Meta Ads.'); }
      result = await fetchSheetByGid(IDS.meta, gid, req);
      filtered = filterMeta(result.rows, scope);
    } else {
      res.statusCode = 400;
      return res.end('Niedozwolone źródło danych.');
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    return res.end(stringifyCsv(result.headers, filtered));
  } catch (error) {
    console.error('[Data API]', error);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.end('Nie udało się pobrać danych dashboardu.');
  }
};
