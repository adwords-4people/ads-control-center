const {
  IDS,
  fetchSheetByName,
  fetchSheetsByName,
  getSheetMetadata,
  normalizeGoogleId,
  normalizeMetaId,
} = require('./sheets');

const GOOGLE_SOURCES = Object.freeze({
  wydatki: 'Wydatki',
  audyt: 'Audyt',
  audytWart: 'Audyt - wart',
  wyniki: 'Wyniki',
  wartKonw: 'Wartość konwersji',
  anomalia: 'Anomalia',
  notatki: 'Dziennik zmian',
});

const CONFIG_SOURCES = Object.freeze({
  progiGoogle: 'Progi - Google Ads',
  progiMeta: 'Progi - Meta Ads',
});

const META_SOURCES = Object.freeze({
  metaWydatki: '833875820',
  metaAnomalia: '1656935920',
  metaDzienny: '121322202',
  metaMiesieczny: '1581500139',
  metaAudyt: '983098958',
  metaKonta: '0',
  metaAudytWart: '2046433272',
  metaWartoscKonwersji: '1488328459',
});

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

async function loadAllDashboardSources(req, scope) {
  // Jeden batchGet na każdy plik zamiast osobnego requestu na każdą zakładkę.
  // Dzięki temu pełny dashboard zużywa ~4 odczyty Sheets API zamiast ~18.
  const metaMetadata = await getSheetMetadata(IDS.meta, req);

  const googleNames = Object.values(GOOGLE_SOURCES);
  const configNames = Object.values(CONFIG_SOURCES);
  const metaTitlesByKey = new Map();
  Object.entries(META_SOURCES).forEach(([key, gid]) => {
    const title = metaMetadata.get(String(gid));
    if (title) metaTitlesByKey.set(key, { title, gid });
  });

  const [googleBatch, configBatch, metaBatch] = await Promise.all([
    fetchSheetsByName(IDS.google, googleNames, req),
    fetchSheetsByName(IDS.config, configNames, req),
    fetchSheetsByName(IDS.meta, [...metaTitlesByKey.values()].map(item => item.title), req),
  ]);

  const sources = {};
  const errors = [];
  const fail = (key, error) => {
    const message = error && error.message ? error.message : String(error);
    sources[key] = { ok: false, headers: [], rows: [], error: message };
    errors.push({ key, error: message });
  };

  Object.entries(GOOGLE_SOURCES).forEach(([key, sheetName]) => {
    try {
      const result = googleBatch.get(sheetName);
      if (!result) throw new Error(`Brak zakladki Google: ${sheetName}.`);
      sources[key] = { ok: true, headers: result.headers, rows: filterGoogle(result.rows, scope, sheetName) };
    } catch (error) { fail(key, error); }
  });

  Object.entries(META_SOURCES).forEach(([key, gid]) => {
    try {
      const metaInfo = metaTitlesByKey.get(key);
      if (!metaInfo) throw new Error(`Nie znaleziono zakladki Meta o GID ${gid}.`);
      const result = metaBatch.get(metaInfo.title);
      if (!result) throw new Error(`Brak zakladki Meta: ${metaInfo.title}.`);
      sources[key] = {
        ok: true,
        headers: result.headers,
        rows: filterMeta(result.rows, scope),
        sheetTitle: metaInfo.title,
        gid,
      };
    } catch (error) { fail(key, error); }
  });

  Object.entries(CONFIG_SOURCES).forEach(([key, sheetName]) => {
    try {
      const result = configBatch.get(sheetName);
      if (!result) throw new Error(`Brak zakladki Config: ${sheetName}.`);
      sources[key] = { ok: true, headers: result.headers, rows: filterConfig(result.rows, scope, sheetName) };
    } catch (error) { fail(key, error); }
  });

  return { sources, errors };
}

module.exports = {
  CONFIG_SOURCES,
  GOOGLE_SOURCES,
  META_SOURCES,
  filterConfig,
  filterGoogle,
  filterMeta,
  loadAllDashboardSources,
};
