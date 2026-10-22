const { getAccessScope } = require('./_lib/access');
const {
  IDS,
  fetchSheetByGid,
  fetchSheetByName,
  normalizeGoogleId,
  normalizeMetaId,
  stringifyCsv,
} = require('./_lib/sheets');

const GOOGLE_SHEETS = new Set(['Wydatki', 'Audyt', 'Audyt - wart', 'Wyniki', 'Wartość konwersji', 'Anomalia', 'Dziennik zmian']);
const CONFIG_SHEETS = new Set(['Progi - Google Ads', 'Progi - Meta Ads']);
const META_GIDS = new Set(['833875820', '1656935920', '121322202', '1581500139', '983098958', '0', '2046433272', '1488328459']);

function lower(value) { return String(value || '').trim().toLowerCase(); }

function filterGoogle(rows, scope, sheetName) {
  if (scope.unrestricted) return rows;
  if (sheetName === 'Dziennik zmian') {
    return rows.filter(row => {
      const platform = lower(row['Platforma']);
      const name = lower(row['Konto']);
      if (platform.includes('meta')) return scope.metaNames.has(name);
      if (platform.includes('google')) return scope.googleNames.has(name);
      return scope.googleNames.has(name) || scope.metaNames.has(name);
    });
  }
  return rows.filter(row => {
    const id = normalizeGoogleId(row['ID Konta']);
    if (id) return scope.googleIds.has(id);
    return scope.googleNames.has(lower(row['Konto']));
  });
}

function filterMeta(rows, scope) {
  if (scope.unrestricted) return rows;
  return rows.filter(row => {
    const id = normalizeMetaId(row['ID Konta'] || row['ID konta']);
    if (id) return scope.metaIds.has(id);
    return scope.metaNames.has(lower(row['Konto'] || row['Nazwa konta'] || row['Nazwa Konta']));
  });
}

function filterConfig(rows, scope, sheetName) {
  if (scope.unrestricted) return rows;
  return rows.filter(row => {
    const key = String(row['Konto'] || '').trim();
    if (key.toUpperCase() === 'DOMYŚLNE') return true;
    return sheetName === 'Progi - Meta Ads'
      ? scope.metaIds.has(normalizeMetaId(key))
      : scope.googleIds.has(normalizeGoogleId(key));
  });
}

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
