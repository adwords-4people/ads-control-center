const {
  IDS,
  fetchSheetByName,
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
  // Resolve Meta GIDs once per request. This avoids 8 concurrent metadata lookups.
  const metaMetadata = await getSheetMetadata(IDS.meta, req);

  const jobs = [];
  Object.entries(GOOGLE_SOURCES).forEach(([key, sheetName]) => {
    jobs.push({
      key,
      run: async () => {
        const result = await fetchSheetByName(IDS.google, sheetName, req);
        return { headers: result.headers, rows: filterGoogle(result.rows, scope, sheetName) };
      },
    });
  });

  Object.entries(META_SOURCES).forEach(([key, gid]) => {
    jobs.push({
      key,
      run: async () => {
        const title = metaMetadata.get(String(gid));
        if (!title) throw new Error(`Nie znaleziono zakładki Meta o GID ${gid}.`);
        const result = await fetchSheetByName(IDS.meta, title, req);
        return { headers: result.headers, rows: filterMeta(result.rows, scope), sheetTitle: title, gid };
      },
    });
  });

  Object.entries(CONFIG_SOURCES).forEach(([key, sheetName]) => {
    jobs.push({
      key,
      run: async () => {
        const result = await fetchSheetByName(IDS.config, sheetName, req);
        return { headers: result.headers, rows: filterConfig(result.rows, scope, sheetName) };
      },
    });
  });

  const settled = await Promise.allSettled(jobs.map(job => job.run()));
  const sources = {};
  const errors = [];

  settled.forEach((result, index) => {
    const key = jobs[index].key;
    if (result.status === 'fulfilled') {
      sources[key] = { ok: true, ...result.value };
    } else {
      const message = result.reason && result.reason.message ? result.reason.message : String(result.reason);
      sources[key] = { ok: false, headers: [], rows: [], error: message };
      errors.push({ key, error: message });
    }
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
