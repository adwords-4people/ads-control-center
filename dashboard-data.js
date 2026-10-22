const { getAccessScope } = require('./_lib/access');
const { loadAllDashboardSources } = require('./_lib/data-sources');

const REPORT_SOURCE_PLATFORM = Object.freeze({
  wydatki: 'google',
  audyt: 'google',
  audytWart: 'google',
  wyniki: 'google',
  wartKonw: 'google',
  anomalia: 'google',
  metaWydatki: 'meta',
  metaAnomalia: 'meta',
  metaDzienny: 'meta',
  metaMiesieczny: 'meta',
  metaAudyt: 'meta',
  metaKonta: 'meta',
  metaAudytWart: 'meta',
  metaWartoscKonwersji: 'meta',
});

const GOOGLE_ID_FIELDS = ['googleAccountIds', 'googleIds', 'google'];
const META_ID_FIELDS = ['metaAccountIds', 'metaIds', 'meta'];

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeEmail(value) {
  return clean(value).toLowerCase();
}

function normalizeAccountId(value, platform) {
  const raw = clean(value);
  if (!raw) return '';
  if (platform === 'meta') return raw.replace(/^act_/i, '').replace(/\s+/g, '');
  if (platform === 'google') return raw.replace(/[^0-9]/g, '');
  return raw.toLowerCase().replace(/[\s-]+/g, '');
}

function platformOf(value) {
  const v = clean(value).toLowerCase();
  if (v.includes('meta') || v.includes('facebook')) return 'meta';
  if (v.includes('google')) return 'google';
  return '';
}

function firstValue(obj, keys) {
  for (const key of keys) {
    if (obj && obj[key] !== undefined && obj[key] !== null && clean(obj[key]) !== '') return obj[key];
  }
  return undefined;
}

function effectiveUserEmail(scope) {
  const candidates = [
    scope && scope.effectiveUser,
    scope && scope.previewUser,
    scope && scope.viewAsUser,
    scope && scope.subject,
    scope && scope.user,
    scope,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const value = typeof candidate === 'string'
      ? candidate
      : firstValue(candidate, ['email', 'userEmail', 'mail']);
    const email = normalizeEmail(value);
    if (email) return email;
  }
  return '';
}

function addId(bucket, platform, value) {
  const id = normalizeAccountId(value, platform);
  if (!id) return;
  bucket.allIds.add(id);
  if (platform === 'google') bucket.googleIds.add(id);
  if (platform === 'meta') bucket.metaIds.add(id);
}

function addName(bucket, value) {
  const name = clean(value).toLowerCase();
  if (name) bucket.names.add(name);
}

function addAccountObject(bucket, account, forcedPlatform) {
  if (account == null) return;
  if (typeof account === 'string' || typeof account === 'number') {
    addId(bucket, forcedPlatform || '', account);
    return;
  }
  if (typeof account !== 'object') return;

  const platform = forcedPlatform || platformOf(firstValue(account, ['platform', 'Platforma', 'channel', 'source']));
  const id = firstValue(account, ['accountId', 'account_id', 'id', 'ID Konta', 'kontoId', 'konto_id']);
  const name = firstValue(account, ['accountName', 'name', 'Konto', 'Nazwa konta', 'Nazwa Konta']);
  if (id !== undefined) addId(bucket, platform, id);
  if (name !== undefined) addName(bucket, name);
}

function accountOwnerEmail(account) {
  if (!account || typeof account !== 'object') return '';
  const direct = firstValue(account, [
    'ownerEmail', 'owner_email', 'opiekunEmail', 'opiekun_email',
    'assignedToEmail', 'assigned_to_email', 'userEmail', 'email',
  ]);
  if (direct) return normalizeEmail(direct);
  const nested = account.owner || account.opiekun || account.assignedTo || account.user;
  if (nested && typeof nested === 'object') return normalizeEmail(firstValue(nested, ['email', 'userEmail', 'mail']));
  return '';
}

function addExplicitIds(bucket, value, platform) {
  if (!value) return;
  if (Array.isArray(value)) {
    value.forEach(item => addAccountObject(bucket, item, platform));
    return;
  }
  if (value instanceof Set) {
    [...value].forEach(item => addAccountObject(bucket, item, platform));
    return;
  }
  if (typeof value === 'object') {
    for (const field of platform === 'google' ? GOOGLE_ID_FIELDS : META_ID_FIELDS) {
      if (value[field] !== undefined) addExplicitIds(bucket, value[field], platform);
    }
    if (value.ids !== undefined) addExplicitIds(bucket, value.ids, platform);
    if (value.accountIds !== undefined) addExplicitIds(bucket, value.accountIds, platform);
  }
}

function buildReportingAccess(scope) {
  const bucket = {
    googleIds: new Set(),
    metaIds: new Set(),
    allIds: new Set(),
    names: new Set(),
    source: '',
  };

  // 1. Najbezpieczniejszy kontrakt: jawny scope raportowy.
  const reporting = scope && (scope.reporting || scope.reports || scope.reportingScope || scope.reportScope);
  if (reporting) {
    addExplicitIds(bucket, reporting, 'google');
    addExplicitIds(bucket, reporting, 'meta');
    const accounts = reporting.accounts || reporting.assignedAccounts || reporting.ownAccounts;
    if (Array.isArray(accounts)) accounts.forEach(a => addAccountObject(bucket, a));
    if (bucket.allIds.size || bucket.names.size) {
      bucket.source = 'scope.reporting';
      return bucket;
    }
  }

  // 2. Jawne listy własnych/przypisanych kont.
  for (const key of ['ownAccounts', 'assignedAccounts', 'userAccounts', 'reportingAccounts']) {
    const list = scope && scope[key];
    if (!Array.isArray(list)) continue;
    list.forEach(a => addAccountObject(bucket, a));
    if (bucket.allIds.size || bucket.names.size) {
      bucket.source = 'scope.' + key;
      return bucket;
    }
  }

  // 3. Jawne ID raportowe.
  for (const key of ['reportingAccountIds', 'ownAccountIds', 'assignedAccountIds', 'userAccountIds']) {
    const value = scope && scope[key];
    if (!value) continue;
    if (Array.isArray(value) || value instanceof Set) {
      [...value].forEach(v => addId(bucket, '', v));
    } else if (typeof value === 'object') {
      addExplicitIds(bucket, value, 'google');
      addExplicitIds(bucket, value, 'meta');
    }
    if (bucket.allIds.size) {
      bucket.source = 'scope.' + key;
      return bucket;
    }
  }

  // 4. Jeżeli access zwraca katalog kont z opiekunem, wybieramy WYŁĄCZNIE
  //    konta przypisane bezpośrednio do effective user (również przy admin preview).
  const email = effectiveUserEmail(scope);
  const accountLists = [
    ['accounts', scope && scope.accounts],
    ['allowedAccounts', scope && scope.allowedAccounts],
    ['clientAccounts', scope && scope.clientAccounts],
  ];
  for (const [key, list] of accountLists) {
    if (!Array.isArray(list) || !email) continue;
    let ownerAware = false;
    const direct = [];
    for (const account of list) {
      const ownerEmail = accountOwnerEmail(account);
      if (!ownerEmail) continue;
      ownerAware = true;
      if (ownerEmail === email) direct.push(account);
    }
    if (!ownerAware) continue;
    direct.forEach(a => addAccountObject(bucket, a));
    bucket.source = 'scope.' + key + ':direct-owner';
    return bucket;
  }

  // Fail closed: zwykłe raporty nie mogą odziedziczyć administracyjnego "all accounts".
  const err = new Error('Brak jednoznacznego zakresu własnych kont dla zwykłych raportów. getAccessScope() musi zwrócić reporting/ownAccounts/assignedAccounts albo listę kont z emailem opiekuna.');
  err.code = 'REPORTING_SCOPE_MISSING';
  throw err;
}

function rowMatchesAccess(row, platform, access) {
  if (!row || typeof row !== 'object') return false;
  const rawId = firstValue(row, ['ID Konta', 'Account ID', 'accountId', 'account_id']);
  const id = normalizeAccountId(rawId, platform);
  if (id) {
    const platformSet = platform === 'meta' ? access.metaIds : access.googleIds;
    if (platformSet.has(id) || access.allIds.has(id)) return true;
  }
  const name = clean(firstValue(row, ['Konto', 'Nazwa konta', 'Nazwa Konta', 'Account'])).toLowerCase();
  return !!name && access.names.has(name);
}

function filterSource(source, platform, access) {
  if (!source || !source.ok || !Array.isArray(source.rows)) return source;
  return {
    ...source,
    rows: source.rows.filter(row => rowMatchesAccess(row, platform, access)),
  };
}

function collectNamesFromFilteredSources(sources, access) {
  for (const [key, platform] of Object.entries(REPORT_SOURCE_PLATFORM)) {
    const source = sources[key];
    if (!source || !source.ok || !Array.isArray(source.rows)) continue;
    for (const row of source.rows) {
      if (!rowMatchesAccess(row, platform, access)) continue;
      addName(access, firstValue(row, ['Konto', 'Nazwa konta', 'Nazwa Konta', 'Account']));
    }
  }
}

function filterThresholdSource(source, platform, access) {
  if (!source || !source.ok || !Array.isArray(source.rows)) return source;
  return {
    ...source,
    rows: source.rows.filter(row => {
      const key = clean(row && row.Konto);
      if (!key) return false;
      if (key.toUpperCase() === 'DOMYŚLNE') return true;
      const id = normalizeAccountId(key, platform);
      const platformSet = platform === 'meta' ? access.metaIds : access.googleIds;
      return platformSet.has(id) || access.allIds.has(id) || access.names.has(key.toLowerCase());
    }),
  };
}

function filterNotesSource(source, access) {
  if (!source || !source.ok || !Array.isArray(source.rows)) return source;
  return {
    ...source,
    rows: source.rows.filter(row => {
      const platform = platformOf(firstValue(row, ['Platforma', 'platform']));
      const rawId = firstValue(row, ['ID Konta', 'accountId', 'account_id']);
      if (rawId !== undefined) {
        const id = normalizeAccountId(rawId, platform);
        const platformSet = platform === 'meta' ? access.metaIds : platform === 'google' ? access.googleIds : access.allIds;
        if (platformSet.has(id) || access.allIds.has(id)) return true;
      }
      const name = clean(firstValue(row, ['Konto', 'Nazwa konta', 'Nazwa Konta'])).toLowerCase();
      return !!name && access.names.has(name);
    }),
  };
}

function filterDashboardSourcesForReportingScope(sources, scope) {
  const access = buildReportingAccess(scope);
  const filtered = { ...sources };

  collectNamesFromFilteredSources(sources, access);

  for (const [key, platform] of Object.entries(REPORT_SOURCE_PLATFORM)) {
    if (filtered[key]) filtered[key] = filterSource(filtered[key], platform, access);
  }
  if (filtered.progiGoogle) filtered.progiGoogle = filterThresholdSource(filtered.progiGoogle, 'google', access);
  if (filtered.progiMeta) filtered.progiMeta = filterThresholdSource(filtered.progiMeta, 'meta', access);
  if (filtered.notatki) filtered.notatki = filterNotesSource(filtered.notatki, access);

  return {
    sources: filtered,
    reportingScope: {
      source: access.source,
      googleAccounts: access.googleIds.size,
      metaAccounts: access.metaIds.size,
      accountIds: access.allIds.size,
      accountNames: access.names.size,
    },
  };
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  try {
    const scope = await getAccessScope(req);
    if (!scope) {
      res.statusCode = 401;
      return res.end(JSON.stringify({ ok: false, error: 'unauthenticated' }));
    }

    const started = Date.now();
    const { sources, errors } = await loadAllDashboardSources(req, scope);
    const filtered = filterDashboardSourcesForReportingScope(sources || {}, scope);

    res.statusCode = 200;
    return res.end(JSON.stringify({
      ok: errors.length === 0,
      partial: errors.length > 0,
      ms: Date.now() - started,
      errors,
      reportingScope: filtered.reportingScope,
      sources: filtered.sources,
    }));
  } catch (error) {
    console.error('[Dashboard data]', error);
    res.statusCode = error && error.code === 'REPORTING_SCOPE_MISSING' ? 500 : 500;
    return res.end(JSON.stringify({
      ok: false,
      error: error && error.message ? error.message : String(error),
      code: error && error.code ? error.code : undefined,
    }));
  }
};

module.exports._test = {
  buildReportingAccess,
  filterDashboardSourcesForReportingScope,
  normalizeAccountId,
};
