const { getAuthContext, getAccessScope, isAdmin, isManager } = require('../_lib/access');
const { loadUsers } = require('../_lib/users');
const {
  IDS,
  fetchSheetsByName,
  isActive,
  normalizeEmail,
  normalizeGoogleId,
  normalizeMetaId,
} = require('../_lib/sheets');
const { loadAllDashboardSources } = require('../_lib/data-sources');

function clean(value) { return String(value == null ? '' : value).trim(); }
function lower(value) { return clean(value).toLowerCase(); }
function num(value) {
  if (value === null || value === undefined || clean(value) === '') return null;
  let text = clean(value).replace(/[\u00a0\u202f\s]/g, '').replace(/PLN|zł|%/gi, '').replace(/[^0-9,.-]/g, '');
  if (!text) return null;
  if (text.includes(',') && text.includes('.')) text = text.replace(/\./g, '').replace(',', '.');
  else text = text.replace(',', '.');
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}
function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.end(JSON.stringify(payload));
}
function sourceRows(sources, key) {
  const src = sources && sources[key];
  return src && src.ok && Array.isArray(src.rows) ? src.rows : [];
}
function findRows(rows, platform, accountId, name) {
  const targetId = platform === 'Google Ads' ? normalizeGoogleId(accountId) : normalizeMetaId(accountId);
  const targetName = lower(name);
  return (rows || []).filter(row => {
    const rawId = row['ID Konta'] || row['ID konta'];
    const rowId = platform === 'Google Ads' ? normalizeGoogleId(rawId) : normalizeMetaId(rawId);
    if (targetId && rowId) return targetId === rowId;
    return targetName && lower(row['Konto'] || row['Nazwa konta'] || row['Nazwa Konta']) === targetName;
  });
}
function firstValue(rows, headers) {
  for (const row of rows || []) {
    for (const header of headers) {
      if (row && row[header] !== undefined && clean(row[header]) !== '') return row[header];
    }
  }
  return '';
}
function sumValue(rows, headers) {
  let found = false;
  let total = 0;
  for (const row of rows || []) {
    const v = firstValue([row], headers);
    const n = num(v);
    if (n === null) continue;
    found = true;
    total += n;
  }
  return found ? total : null;
}
function toneBudget(value) {
  const n = num(value);
  if (n === null) return 'empty';
  if (n < 75 || n > 125) return 'red';
  if (n < 90 || n > 110) return 'amber';
  return 'gray';
}
function toneRatio(value) {
  const n = num(value);
  if (n === null) return 'empty';
  if (n < 50) return 'red';
  if (n < 75) return 'amber';
  return n >= 100 ? 'green' : 'gray';
}
function toneTrendDelta(value) {
  const n = num(value);
  if (n === null) return 'empty';
  if (n <= -50) return 'red';
  if (n <= -30) return 'amber';
  return n >= 30 ? 'green' : 'gray';
}
function toneAnomaly(value) {
  const n = num(value);
  if (n === null) return 'empty';
  if (n <= -50) return 'red';
  if (n <= -30 || n >= 100) return 'amber';
  return 'gray';
}
function toneRoas(value) {
  const n = num(value);
  if (n === null || n <= 0) return 'empty';
  if (n < 225) return 'red';
  if (n < 300) return 'amber';
  return n >= 500 ? 'green' : 'gray';
}
function buildHealth(account, sources) {
  if (!account.active) {
    return { priority: 'inactive', priorityRank: 3, reasons: ['Konto nieaktywne'], metrics: {}, tones: {} };
  }

  let budget = '', result = '', resultRatio = '', trend = '', anomaly = '', roas = '', cpa = '';
  if (account.platform === 'Google Ads') {
    const spend = findRows(sourceRows(sources, 'wydatki'), account.platform, account.accountId, account.name);
    const results = findRows(sourceRows(sources, 'wyniki'), account.platform, account.accountId, account.name);
    const audit = findRows(sourceRows(sources, 'audyt'), account.platform, account.accountId, account.name);
    const anomalyRows = findRows(sourceRows(sources, 'anomalia'), account.platform, account.accountId, account.name);
    const valueRows = findRows(sourceRows(sources, 'wartKonw'), account.platform, account.accountId, account.name);
    budget = firstValue(spend, ['Status', 'Status budżetu']);
    result = firstValue(results, ['Konwersje', 'Konwersje (Miesiąc)', 'Wynik (Miesiąc)']);
    resultRatio = firstValue(results, ['Porównanie konwersji z poprzednim miesiącem']);
    const trendRatio = num(firstValue(audit, ['Współczynnik wyświetleń']));
    trend = trendRatio === null ? '' : trendRatio - 100;
    anomaly = firstValue(anomalyRows, ['Status wyświetleń']);
    roas = firstValue(valueRows, ['ROAS']);
    cpa = firstValue(results, ['CPA']);
  } else {
    const spend = findRows(sourceRows(sources, 'metaWydatki'), account.platform, account.accountId, account.name);
    const month = findRows(sourceRows(sources, 'metaMiesieczny'), account.platform, account.accountId, account.name);
    const audit = findRows(sourceRows(sources, 'metaAudyt'), account.platform, account.accountId, account.name);
    const anomalyRows = findRows(sourceRows(sources, 'metaAnomalia'), account.platform, account.accountId, account.name);
    const valueRows = findRows(sourceRows(sources, 'metaWartoscKonwersji'), account.platform, account.accountId, account.name);
    budget = firstValue(spend, ['Status', 'Status budżetu']);
    const monthResult = sumValue(month, ['Wynik (Miesiąc)', 'Konwersje (Miesiąc)']);
    result = monthResult === null ? '' : monthResult;
    resultRatio = firstValue(month, ['Zmiana prognozy wyniku vs poprzedni miesiąc (%)']);
    trend = firstValue(audit, ['Zmiana % Wyświetleń (30 dni vs 90 dni→30d)']);
    anomaly = firstValue(anomalyRows, ['Zmiana % Wyświetleń (przedwczoraj → wczoraj)', 'Status wyświetleń']);
    roas = firstValue(valueRows, ['ROAS']);
    cpa = firstValue(month, ['CPA']);
  }

  const tones = {
    budget: toneBudget(budget),
    resultRatio: account.platform === 'Meta Ads' ? toneTrendDelta(resultRatio) : toneRatio(resultRatio),
    trend: toneTrendDelta(trend),
    anomaly: toneAnomaly(anomaly),
    roas: toneRoas(roas),
  };
  const reasons = [];
  const labels = {
    budget: 'Budżet poza zakresem',
    resultRatio: 'Wynik poniżej oczekiwań',
    trend: 'Negatywny trend wyświetleń',
    anomaly: 'Anomalia wyświetleń',
    roas: 'Niski ROAS',
  };
  Object.entries(tones).forEach(([key, tone]) => {
    if (tone === 'red' || tone === 'amber') reasons.push(labels[key]);
  });
  const hasData = [budget, result, resultRatio, trend, anomaly, roas, cpa].some(v => clean(v) !== '');
  let priority = 'ok';
  let priorityRank = 2;
  if (!hasData) { priority = 'no_data'; priorityRank = 2; }
  else if (Object.values(tones).includes('red')) { priority = 'intervention'; priorityRank = 0; }
  else if (Object.values(tones).includes('amber')) { priority = 'check'; priorityRank = 1; }

  return {
    priority,
    priorityRank,
    reasons,
    metrics: { budget, result, resultRatio, trend, anomaly, roas, cpa },
    tones,
  };
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'GET') return json(res, 405, { ok: false, error: 'method_not_allowed' });

    const context = await getAuthContext(req);
    if (!context) return json(res, 401, { ok: false, error: 'unauthenticated' });

    const user = context.effectiveUser;
    const adminView = isAdmin(user);
    const managerView = isManager(user);
    if (!adminView && !managerView) {
      return json(res, 403, { ok: false, error: 'forbidden' });
    }

    const allUsers = await loadUsers(req);
    const teamName = managerView ? lower(user.team) : '';
    const scopedUsers = adminView
      ? allUsers
      : allUsers.filter(item => item.active && lower(item.team) === teamName);
    const scopedEmails = new Set(scopedUsers.map(item => normalizeEmail(item.email)));

    const config = await fetchSheetsByName(IDS.config, [
      'MCK - Google Ads',
      'Konta - Google Ads',
      'Konta - Meta Ads',
    ], req);
    const mckRows = (config.get('MCK - Google Ads') || { rows: [] }).rows;
    const googleRows = (config.get('Konta - Google Ads') || { rows: [] }).rows;
    const metaRows = (config.get('Konta - Meta Ads') || { rows: [] }).rows;

    const mckById = new Map();
    mckRows.forEach(row => {
      const id = clean(row['MCK_ID']);
      if (!id) return;
      mckById.set(id, {
        id,
        name: clean(row['Nazwa MCK'] || row['ID MCK'] || row['MCK_ID']),
        externalId: clean(row['ID MCK']),
        ownerName: clean(row['Użytkownik']),
        ownerEmail: normalizeEmail(row['Email']),
        active: isActive(row['Aktywne']),
      });
    });

    const googleAccounts = googleRows.map(row => {
      const mckId = clean(row['MCK_ID']);
      const mck = mckById.get(mckId) || {};
      const ownerEmail = normalizeEmail(row['Email'] || mck.ownerEmail);
      return {
        platform: 'Google Ads',
        accountId: normalizeGoogleId(row['ID Konta']),
        displayAccountId: clean(row['ID Konta']),
        name: clean(row['Konto'] || row['Nazwa konta']),
        type: clean(row['Typ']),
        budget: clean(row['Budżet']),
        active: isActive(row['Aktywne']),
        ownerName: clean(row['Użytkownik'] || mck.ownerName),
        ownerEmail,
        sourceId: mckId,
        sourceName: clean(mck.name),
        mckId,
      };
    }).filter(account => account.accountId || account.name)
      .filter(account => adminView || scopedEmails.has(account.ownerEmail));

    const metaAccounts = metaRows.map(row => {
      const ownerEmail = normalizeEmail(row['Email']);
      return {
        platform: 'Meta Ads',
        accountId: normalizeMetaId(row['ID Konta']),
        displayAccountId: clean(row['ID Konta']),
        name: clean(row['Konto'] || row['Nazwa konta']),
        type: clean(row['Typ']),
        budget: clean(row['Budżet']),
        active: isActive(row['Aktywne']),
        ownerName: clean(row['Użytkownik']),
        ownerEmail,
        sourceId: clean(row['BM_ID']),
        sourceName: clean(row['BM_ID']),
        bmId: clean(row['BM_ID']),
      };
    }).filter(account => account.accountId || account.name)
      .filter(account => adminView || scopedEmails.has(account.ownerEmail));

    const scope = await getAccessScope(req);
    const { sources, errors } = await loadAllDashboardSources(req, scope);
    const accounts = [...googleAccounts, ...metaAccounts]
      .map(account => ({ ...account, health: buildHealth(account, sources) }))
      .sort((a, b) => (a.health.priorityRank - b.health.priorityRank) || a.name.localeCompare(b.name, 'pl'));

    let mcks = [...mckById.values()].filter(item => item.active);
    if (managerView) mcks = mcks.filter(item => scopedEmails.has(item.ownerEmail));

    return json(res, 200, {
      ok: true,
      viewMode: managerView ? 'team' : 'admin',
      team: managerView ? clean(user.team) : '',
      canAssignAccounts: Boolean(isAdmin(context.actualUser) && !context.previewing),
      canManageEmployees: Boolean(isAdmin(context.actualUser) && !context.previewing),
      users: scopedUsers.map(({ email, name, role, team, active }) => ({ email, name, role, team, active })),
      accounts,
      mcks,
      sync: {
        google: { rows: [], error: '' },
        meta: { rows: [], error: '' },
      },
      warnings: errors || [],
    });
  } catch (error) {
    console.error('[Admin overview]', error);
    return json(res, 500, { ok: false, error: 'admin_overview_failed', message: error.message });
  }
};
