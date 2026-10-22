const { getAccessScope } = require('./_lib/access');
const { loadAllDashboardSources } = require('./_lib/data-sources');

const BUILD = '1.7.6-strict-scope';

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

function clean(value) {
  return String(value == null ? '' : value).trim();
}

function normalizeEmail(value) {
  return clean(value).toLowerCase();
}

function normalizeName(value) {
  return clean(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
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

function identityFrom(value) {
  if (!value) return { email: '', name: '' };
  if (typeof value === 'string') {
    const raw = clean(value);
    return raw.includes('@')
      ? { email: normalizeEmail(raw), name: '' }
      : { email: '', name: normalizeName(raw) };
  }
  if (typeof value !== 'object') return { email: '', name: '' };
  return {
    email: normalizeEmail(firstValue(value, ['email', 'userEmail', 'mail', 'Email'])),
    name: normalizeName(firstValue(value, [
      'name', 'displayName', 'fullName', 'userName', 'employeeName',
      'Imię i nazwisko', 'Imie i nazwisko', 'Pracownik', 'Opiekun',
    ])),
  };
}

function effectiveIdentity(scope) {
  const candidates = [
    scope && scope.effectiveUser,
    scope && scope.previewUser,
    scope && scope.viewAsUser,
    scope && scope.subject,
    scope && scope.user,
    scope,
  ];
  for (const candidate of candidates) {
    const id = identityFrom(candidate);
    if (id.email || id.name) return id;
  }
  return { email: '', name: '' };
}

function ownerIdentity(account) {
  if (!account || typeof account !== 'object') return { email: '', name: '' };

  const email = normalizeEmail(firstValue(account, [
    'ownerEmail', 'owner_email', 'opiekunEmail', 'opiekun_email',
    'assignedToEmail', 'assigned_to_email', 'userEmail', 'employeeEmail',
    'Email opiekuna', 'E-mail opiekuna', 'Opiekun email',
  ]));

  let name = normalizeName(firstValue(account, [
    'ownerName', 'owner_name', 'opiekunName', 'opiekun_name',
    'assignedToName', 'assigned_to_name', 'employeeName', 'userName',
    'Opiekun', 'Pracownik', 'Specjalista',
  ]));

  const nested = account.owner || account.opiekun || account.assignedTo || account.user || account.employee;
  if (nested && typeof nested === 'object') {
    const nestedId = identityFrom(nested);
    return { email: email || nestedId.email, name: name || nestedId.name };
  }
  if (!name && typeof nested === 'string') name = normalizeName(nested);

  return { email, name };
}

function sameIdentity(owner, effective) {
  if (owner.email && effective.email) return owner.email === effective.email;
  if (owner.name && effective.name) return owner.name === effective.name;
  return false;
}

function addId(access, platform, value) {
  const id = normalizeAccountId(value, platform);
  if (!id) return;
  access.allIds.add(id);
  if (platform === 'google') access.googleIds.add(id);
  if (platform === 'meta') access.metaIds.add(id);
}

function addName(access, value) {
  const name = normalizeName(value);
  if (name) access.names.add(name);
}

function addVerifiedAccount(access, account) {
  if (!account || typeof account !== 'object') return false;
  const platform = platformOf(firstValue(account, ['platform', 'Platforma', 'channel', 'source']));
  const accountId = firstValue(account, ['accountId', 'account_id', 'id', 'ID Konta', 'kontoId', 'konto_id']);
  const accountName = firstValue(account, ['accountName', 'name', 'Konto', 'Nazwa konta', 'Nazwa Konta']);
  if (accountId === undefined && accountName === undefined) return false;
  if (accountId !== undefined) addId(access, platform, accountId);
  if (accountName !== undefined) addName(access, accountName);
  return true;
}

function buildReportingAccess(scope) {
  const effective = effectiveIdentity(scope);
  if (!effective.email && !effective.name) {
    const err = new Error('Nie można ustalić effective user dla zwykłych raportów.');
    err.code = 'REPORTING_USER_MISSING';
    throw err;
  }

  const access = {
    googleIds: new Set(),
    metaIds: new Set(),
    allIds: new Set(),
    names: new Set(),
    matched: 0,
    ownerAware: 0,
    sourceLists: [],
    effective,
  };

  // WAŻNE: nie ufamy nazwie pola (np. ownAccounts). Dla Admina takie pole może
  // w praktyce zawierać szeroki zakres. Każde konto musi mieć właściciela/opiekuna
  // i właściciel musi być równy effective user.
  const candidates = [
    ['reporting.accounts', scope && scope.reporting && scope.reporting.accounts],
    ['reporting.assignedAccounts', scope && scope.reporting && scope.reporting.assignedAccounts],
    ['reporting.ownAccounts', scope && scope.reporting && scope.reporting.ownAccounts],
    ['accounts', scope && scope.accounts],
    ['allowedAccounts', scope && scope.allowedAccounts],
    ['clientAccounts', scope && scope.clientAccounts],
    ['ownAccounts', scope && scope.ownAccounts],
    ['assignedAccounts', scope && scope.assignedAccounts],
    ['userAccounts', scope && scope.userAccounts],
    ['reportingAccounts', scope && scope.reportingAccounts],
  ];

  for (const [label, list] of candidates) {
    if (!Array.isArray(list)) continue;
    let listWasOwnerAware = false;
    let listMatches = 0;

    for (const account of list) {
      if (!account || typeof account !== 'object') continue;
      const owner = ownerIdentity(account);
      if (!owner.email && !owner.name) continue;
      listWasOwnerAware = true;
      access.ownerAware += 1;
      if (!sameIdentity(owner, effective)) continue;
      if (addVerifiedAccount(access, account)) {
        access.matched += 1;
        listMatches += 1;
      }
    }

    if (listWasOwnerAware) access.sourceLists.push(label + ':' + listMatches);
  }

  if (!access.sourceLists.length) {
    const err = new Error(
      'Scope nie zawiera katalogu kont z informacją o opiekunie. ' +
      'Zwykłe raporty nie zostaną otwarte szerokim zakresem. Dodaj ownerEmail/opiekunEmail lub nazwę opiekuna do kont zwracanych przez getAccessScope().'
    );
    err.code = 'REPORTING_OWNERSHIP_MISSING';
    throw err;
  }

  // Zero własnych kont jest poprawnym wynikiem. W takim przypadku zwracamy puste raporty,
  // a nie wszystkie konta.
  return access;
}

function rowMatchesAccess(row, platform, access) {
  if (!row || typeof row !== 'object') return false;
  const rawId = firstValue(row, ['ID Konta', 'Account ID', 'accountId', 'account_id']);
  const id = normalizeAccountId(rawId, platform);
  if (id) {
    const platformSet = platform === 'meta' ? access.metaIds : access.googleIds;
    if (platformSet.has(id) || access.allIds.has(id)) return true;
  }
  const name = normalizeName(firstValue(row, ['Konto', 'Nazwa konta', 'Nazwa Konta', 'Account']));
  return !!name && access.names.has(name);
}

function filterSource(source, platform, access) {
  if (!source || !source.ok || !Array.isArray(source.rows)) return source;
  return { ...source, rows: source.rows.filter(row => rowMatchesAccess(row, platform, access)) };
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
      return platformSet.has(id) || access.allIds.has(id) || access.names.has(normalizeName(key));
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
      const name = normalizeName(firstValue(row, ['Konto', 'Nazwa konta', 'Nazwa Konta']));
      return !!name && access.names.has(name);
    }),
  };
}

function filterDashboardSourcesForReportingScope(sources, scope) {
  const access = buildReportingAccess(scope);
  const filtered = { ...sources };

  for (const [key, platform] of Object.entries(REPORT_SOURCE_PLATFORM)) {
    if (filtered[key]) filtered[key] = filterSource(filtered[key], platform, access);
  }
  if (filtered.progiGoogle) filtered.progiGoogle = filterThresholdSource(filtered.progiGoogle, 'google', access);
  if (filtered.progiMeta) filtered.progiMeta = filterThresholdSource(filtered.progiMeta, 'meta', access);
  if (filtered.notatki) filtered.notatki = filterNotesSource(filtered.notatki, access);

  return {
    sources: filtered,
    reportingScope: {
      build: BUILD,
      effectiveUser: access.effective.email || access.effective.name,
      source: access.sourceLists.join(', '),
      ownerAwareRows: access.ownerAware,
      matchedAccounts: access.matched,
      googleIds: access.googleIds.size,
      metaIds: access.metaIds.size,
      allIds: access.allIds.size,
      names: access.names.size,
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
      return res.end(JSON.stringify({ ok: false, error: 'unauthenticated', build: BUILD }));
    }

    const started = Date.now();
    const { sources, errors } = await loadAllDashboardSources(req, scope);
    const filtered = filterDashboardSourcesForReportingScope(sources || {}, scope);

    res.statusCode = 200;
    return res.end(JSON.stringify({
      ok: errors.length === 0,
      partial: errors.length > 0,
      build: BUILD,
      ms: Date.now() - started,
      errors,
      reportingScope: filtered.reportingScope,
      sources: filtered.sources,
    }));
  } catch (error) {
    console.error('[Dashboard data ' + BUILD + ']', error);
    res.statusCode = 500;
    return res.end(JSON.stringify({
      ok: false,
      build: BUILD,
      error: error && error.message ? error.message : String(error),
      code: error && error.code ? error.code : undefined,
    }));
  }
};

module.exports._test = {
  buildReportingAccess,
  filterDashboardSourcesForReportingScope,
  normalizeAccountId,
  normalizeName,
  effectiveIdentity,
  ownerIdentity,
};
