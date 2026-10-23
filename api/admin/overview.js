const { getAuthContext, isAdmin, isManager } = require('../_lib/access');
const {
  IDS,
  fetchSheetsByName,
  isActive,
  normalizeEmail,
  normalizeGoogleId,
  normalizeMetaId,
} = require('../_lib/sheets');
const { loadUsers } = require('../_lib/users');

const GOOGLE_DEFAULTS = Object.freeze({
  budzet_min: 90, budzet_max: 110, roas_amber: 500, roas_red: 300,
  konw_min: 1, konw_pct_min: 75,
  trend_spadek_amber: 30, trend_spadek_red: 50, trend_wzrost: 30,
  anomalia_spadek_amber: 30, anomalia_spadek_red: 50, anomalia_wzrost: 100,
});
const META_DEFAULTS = Object.freeze({
  budzet_min: 80, budzet_max: 110, roas_amber: 500, roas_red: 300,
  konw_min: 1, konw_pct_min: 75,
  trend_spadek_amber: 30, trend_spadek_red: 50, trend_wzrost: 30,
  anomalia_spadek_amber: 30, anomalia_spadek_red: 50, anomalia_wzrost: 100,
});

function clean(value) { return String(value == null ? '' : value).trim(); }
function lower(value) { return clean(value).toLowerCase(); }
function upper(value) { return clean(value).toUpperCase(); }
function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.end(JSON.stringify(payload));
}
function numberText(row, names) {
  for (const name of names) if (row && row[name] !== undefined && clean(row[name]) !== '') return clean(row[name]);
  return '';
}
function parseNumber(value) {
  let text = clean(value).replace(/[\u00a0\u202f\s]/g, '');
  if (!text || text === '-' || text === '\u2014') return null;
  text = text.replace(/PLN|z\u0142|%/gi, '').replace(/[^0-9,.-]/g, '');
  if (!text) return null;
  if (text.includes(',') && text.includes('.')) text = text.replace(/\./g, '').replace(',', '.');
  else text = text.replace(',', '.');
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}
function firstNumber(rows, names) {
  for (const row of rows || []) {
    const n = parseNumber(numberText(row, names));
    if (n != null) return n;
  }
  return null;
}
function sumNumber(rows, names) {
  let found = false;
  let total = 0;
  for (const row of rows || []) {
    const n = parseNumber(numberText(row, names));
    if (n == null) continue;
    found = true;
    total += n;
  }
  return found ? total : null;
}
function accountNameMap(rows, platform) {
  const map = new Map();
  (rows || []).forEach(row => {
    const rawId = row['ID Konta'] || row['ID konta'];
    const id = platform === 'Google Ads' ? normalizeGoogleId(rawId) : normalizeMetaId(rawId);
    const name = clean(row['Konto'] || row['Nazwa konta'] || row['Nazwa Konta']);
    if (id && name && !map.has(id)) map.set(id, name);
  });
  return map;
}
function usefulName(candidate, accountId) {
  const name = clean(candidate);
  if (!name) return '';
  const onlyDigits = name.replace(/[^0-9]/g, '');
  const idDigits = clean(accountId).replace(/[^0-9]/g, '');
  if (onlyDigits && idDigits && onlyDigits === idDigits) return '';
  return name;
}
function rowsForAccount(rows, account) {
  const targetId = account.platform === 'Google Ads' ? normalizeGoogleId(account.accountId) : normalizeMetaId(account.accountId);
  const targetName = lower(account.name);
  return (rows || []).filter(row => {
    const rawId = row['ID Konta'] || row['ID konta'];
    const rowId = account.platform === 'Google Ads' ? normalizeGoogleId(rawId) : normalizeMetaId(rawId);
    if (targetId && rowId) return targetId === rowId;
    const name = lower(row['Konto'] || row['Nazwa konta'] || row['Nazwa Konta']);
    return Boolean(targetName && name && targetName === name);
  });
}
function findThresholdRows(rows, account) {
  const targetId = account.platform === 'Google Ads' ? normalizeGoogleId(account.accountId) : normalizeMetaId(account.accountId);
  let own = null;
  let defaults = null;
  for (const row of rows || []) {
    const key = clean(row['Konto']);
    if (upper(key) === 'DOMY\u015aLNE') { defaults = row; continue; }
    const rowId = account.platform === 'Google Ads' ? normalizeGoogleId(key) : normalizeMetaId(key);
    if (targetId && rowId === targetId) own = row;
  }
  return { own, defaults };
}
function pickThreshold(pair, names, fallback) {
  for (const row of [pair.own, pair.defaults]) {
    if (!row) continue;
    for (const name of names) {
      const n = parseNumber(row[name]);
      if (n != null && n > 0) return n;
    }
  }
  return fallback;
}
function thresholdsFor(account, rows) {
  const base = account.platform === 'Google Ads' ? GOOGLE_DEFAULTS : META_DEFAULTS;
  const pair = findThresholdRows(rows, account);
  return {
    budzet_min: pickThreshold(pair, ['Budzet_min'], base.budzet_min),
    budzet_max: pickThreshold(pair, ['Budzet_max'], base.budzet_max),
    roas_amber: pickThreshold(pair, ['ROAS_amber'], base.roas_amber),
    roas_red: pickThreshold(pair, ['ROAS_red'], base.roas_red),
    konw_min: pickThreshold(pair, ['Konw_min'], base.konw_min),
    konw_pct_min: pickThreshold(pair, ['Konw_pct_min'], base.konw_pct_min),
    trend_spadek_amber: pickThreshold(pair, ['Trend_spadek_amber', 'Spadek_amber'], base.trend_spadek_amber),
    trend_spadek_red: pickThreshold(pair, ['Trend_spadek_red', 'Spadek_red'], base.trend_spadek_red),
    trend_wzrost: pickThreshold(pair, ['Trend_wzrost'], base.trend_wzrost),
    anomalia_spadek_amber: pickThreshold(pair, ['Anomalia_spadek_amber', 'Spadek_amber'], base.anomalia_spadek_amber),
    anomalia_spadek_red: pickThreshold(pair, ['Anomalia_spadek_red', 'Anomalia_spadek', 'Spadek_red'], base.anomalia_spadek_red),
    anomalia_wzrost: pickThreshold(pair, ['Anomalia_wzrost'], base.anomalia_wzrost),
  };
}
function ratio(current, base) {
  return current != null && base != null && base > 0 ? (current / base) * 100 : null;
}
function delta(current, base) {
  return current != null && base != null && base > 0 ? ((current - base) / base) * 100 : null;
}
function toneForBudget(value, t) {
  if (value == null) return 'empty';
  if (value > t.budzet_max) return 'red';
  if (value < t.budzet_min) return 'amber';
  return 'gray';
}
function toneForRatio(value, t) {
  if (value == null) return 'empty';
  if (value >= 100) return 'green';
  if (value >= t.konw_pct_min) return 'gray';
  if (value >= t.konw_pct_min * 0.67) return 'amber';
  return 'red';
}
function toneForTrend(value, t) {
  if (value == null) return 'empty';
  if (value <= -t.trend_spadek_red) return 'red';
  if (value <= -t.trend_spadek_amber) return 'amber';
  if (value >= t.trend_wzrost) return 'green';
  return 'gray';
}
function toneForAnomaly(value, t) {
  if (value == null) return 'empty';
  if (value <= -t.anomalia_spadek_red) return 'red';
  if (value <= -t.anomalia_spadek_amber || value >= t.anomalia_wzrost) return 'amber';
  return 'gray';
}
function toneForRoas(value, t) {
  if (value == null || value <= 0) return 'empty';
  if (value >= t.roas_amber) return 'green';
  if (value >= t.roas_red) return 'gray';
  if (value >= t.roas_red * 0.75) return 'amber';
  return 'red';
}
function addReason(list, tone, label) {
  if (tone === 'red' || tone === 'amber') list.push({ tone, label });
}
function healthFor(account, reports, thresholdRows) {
  if (!account.active) return {
    priority: 'inactive', priorityRank: 3, reasons: ['Konto nieaktywne'],
    metrics: {}, tones: {},
  };
  const t = thresholdsFor(account, thresholdRows);
  let budgetPct = null, result = null, resultRatio = null, trend = null, anomaly = null, roas = null, cpa = null;
  let hasReportData = false;

  if (account.platform === 'Google Ads') {
    const spendRows = rowsForAccount(reports.googleWydatki, account);
    const resultRows = rowsForAccount(reports.googleWyniki, account);
    const auditRows = rowsForAccount(reports.googleAudyt, account);
    const anomalyRows = rowsForAccount(reports.googleAnomalia, account);
    const valueRows = rowsForAccount(reports.googleWartosc, account);
    hasReportData = spendRows.length + resultRows.length + auditRows.length + anomalyRows.length > 0;
    const spend = firstNumber(spendRows, ['Koszt (miesi\u0105c, do dzi\u015b)', 'Koszt (Miesi\u0105c)', 'Koszt']);
    budgetPct = firstNumber(spendRows, ['Status', 'Status bud\u017cetu']);
    result = firstNumber(resultRows, ['Konwersje', 'Konwersje (Miesi\u0105c)', 'Wynik (Miesi\u0105c)']);
    resultRatio = firstNumber(resultRows, ['Por\u00f3wnanie konwersji z poprzednim miesi\u0105cem']);
    const trendRatio = firstNumber(auditRows, ['Wsp\u00f3\u0142czynnik wy\u015bwietle\u0144']);
    trend = trendRatio == null ? null : trendRatio - 100;
    anomaly = firstNumber(anomalyRows, ['Status wy\u015bwietle\u0144']);
    roas = firstNumber(valueRows, ['ROAS']);
    cpa = firstNumber(resultRows, ['CPA']);
    if (cpa == null && spend != null && result != null && result > 0) cpa = spend / result;
  } else {
    const spendRows = rowsForAccount(reports.metaWydatki, account);
    const monthRows = rowsForAccount(reports.metaMiesieczny, account);
    const auditRows = rowsForAccount(reports.metaAudyt, account);
    const anomalyRows = rowsForAccount(reports.metaAnomalia, account);
    const valueRows = rowsForAccount(reports.metaWartosc, account);
    hasReportData = spendRows.length + monthRows.length + auditRows.length + anomalyRows.length > 0;
    const spend = firstNumber(spendRows, ['Koszt (miesi\u0105c, do dzi\u015b)', 'Koszt (Miesi\u0105c)', 'Koszt']);
    budgetPct = firstNumber(spendRows, ['Status', 'Status bud\u017cetu']);
    result = sumNumber(monthRows, ['Wynik (Miesi\u0105c)', 'Konwersje (Miesi\u0105c)']);
    const forecast = sumNumber(monthRows, ['Prognoza wyniku (ca\u0142y miesi\u0105c)', 'Prognoza konwersji (ca\u0142y miesi\u0105c)']);
    const previous = sumNumber(monthRows, ['Wynik (poprzedni miesi\u0105c)', 'Konwersje (poprzedni miesi\u0105c)']);
    resultRatio = ratio(forecast, previous);
    const trendCurrent = sumNumber(auditRows, ['Wy\u015bwietlenia (30 dni)']);
    const trendBase = sumNumber(auditRows, ['Wy\u015bwietlenia (90 dni \u2192 odpowiednik 30-dniowy)']);
    trend = delta(trendCurrent, trendBase);
    const yesterday = sumNumber(anomalyRows, ['Wy\u015bwietlenia (wczoraj)']);
    const dayBefore = sumNumber(anomalyRows, ['Wy\u015bwietlenia (przedwczoraj)']);
    anomaly = delta(yesterday, dayBefore);
    const conversionValue = sumNumber(valueRows, ['Warto\u015b\u0107 konwersji (Miesi\u0105c)', 'Warto\u015b\u0107 Konwersji (Miesi\u0105c)', 'Warto\u015b\u0107 konwersji']);
    if (conversionValue != null && spend != null && spend > 0) roas = (conversionValue / spend) * 100;
    else roas = firstNumber(valueRows, ['ROAS']);
    if (spend != null && result != null && result > 0) cpa = spend / result;
  }

  const tones = {
    budget: toneForBudget(budgetPct, t),
    result: result != null && result < t.konw_min ? 'red' : (result == null ? 'empty' : 'gray'),
    resultRatio: toneForRatio(resultRatio, t),
    trend: toneForTrend(trend, t),
    anomaly: toneForAnomaly(anomaly, t),
    roas: toneForRoas(roas, t),
  };
  const reasons = [];
  if (!hasReportData) addReason(reasons, 'amber', 'Brak danych raportowych');
  if (tones.budget === 'red') addReason(reasons, 'red', 'Przekroczony bud\u017cet');
  else if (tones.budget === 'amber') addReason(reasons, 'amber', 'Za niska realizacja bud\u017cetu');
  if (tones.result === 'red') addReason(reasons, 'red', 'Bardzo niski wynik');
  if (tones.resultRatio === 'red') addReason(reasons, 'red', 'Silny spadek wyniku');
  else if (tones.resultRatio === 'amber') addReason(reasons, 'amber', 'Spadek wyniku');
  if (tones.trend === 'red') addReason(reasons, 'red', 'Silny spadek trendu');
  else if (tones.trend === 'amber') addReason(reasons, 'amber', 'Spadek trendu');
  if (tones.anomaly === 'red') addReason(reasons, 'red', 'Silna anomalia dzienna');
  else if (tones.anomaly === 'amber') addReason(reasons, 'amber', 'Anomalia dzienna');
  if (lower(account.type) === 'sklep') {
    if (tones.roas === 'red') addReason(reasons, 'red', 'ROAS poni\u017cej progu');
    else if (tones.roas === 'amber') addReason(reasons, 'amber', 'ROAS wymaga uwagi');
  }

  const hasRed = reasons.some(item => item.tone === 'red');
  const hasAmber = reasons.some(item => item.tone === 'amber');
  const priority = hasRed ? 'intervention' : (hasAmber ? 'check' : 'ok');
  return {
    priority,
    priorityRank: priority === 'intervention' ? 0 : (priority === 'check' ? 1 : 2),
    reasons: reasons.map(item => item.label),
    metrics: { budgetPct, result, resultRatio, trend, anomaly, roas, cpa },
    tones,
  };
}
function statusRows(batch, name) {
  return batch.get(name) || { headers: [], rows: [] };
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'GET') return json(res, 405, { ok: false, error: 'method_not_allowed' });
    const context = await getAuthContext(req);
    if (!context) return json(res, 401, { ok: false, error: 'unauthenticated' });
    const effective = context.effectiveUser;
    const managerView = isManager(effective);
    const adminView = isAdmin(effective) && !context.previewing;
    if (!managerView && !adminView) return json(res, 403, { ok: false, error: 'forbidden' });

    const [allUsers, configBatch, googleBatch, metaBatch] = await Promise.all([
      loadUsers(req),
      fetchSheetsByName(IDS.config, ['MCK - Google Ads', 'Konta - Google Ads', 'Konta - Meta Ads', 'Progi - Google Ads', 'Progi - Meta Ads'], req),
      fetchSheetsByName(IDS.google, ['Wydatki', 'Wyniki', 'Audyt', 'Anomalia', 'Warto\u015b\u0107 konwersji', 'SYNC_STATUS'], req)
        .catch(error => new Map([['SYNC_STATUS', { headers: [], rows: [], error: error.message }]])),
      fetchSheetsByName(IDS.meta, ['Wydatki', 'Raport_Miesieczny', 'Audyt', 'Anomalia', 'Warto\u015b\u0107 konwersji', 'META_SYNC_STATUS'], req)
        .catch(error => new Map([['META_SYNC_STATUS', { headers: [], rows: [], error: error.message }]])),
    ]);

    const mck = statusRows(configBatch, 'MCK - Google Ads');
    const google = statusRows(configBatch, 'Konta - Google Ads');
    const meta = statusRows(configBatch, 'Konta - Meta Ads');
    const progiGoogle = statusRows(configBatch, 'Progi - Google Ads');
    const progiMeta = statusRows(configBatch, 'Progi - Meta Ads');
    const googleNamesSheet = statusRows(googleBatch, 'Wydatki');
    const metaNamesSheet = statusRows(metaBatch, 'Wydatki');
    const googleSync = statusRows(googleBatch, 'SYNC_STATUS');
    const metaSync = statusRows(metaBatch, 'META_SYNC_STATUS');

    const googleNameById = accountNameMap(googleNamesSheet.rows, 'Google Ads');
    const metaNameById = accountNameMap(metaNamesSheet.rows, 'Meta Ads');
    const mckById = new Map(mck.rows.map(row => [clean(row['MCK_ID']), row]));

    let googleAccounts = google.rows.map(row => {
      const m = mckById.get(clean(row['MCK_ID'])) || {};
      const normalizedId = normalizeGoogleId(row['ID Konta']);
      return {
        platform: 'Google Ads', accountId: clean(row['ID Konta']),
        name: googleNameById.get(normalizedId) || usefulName(row['Konto'], row['ID Konta']) || clean(row['ID Konta']),
        type: clean(row['Typ']), budget: numberText(row, ['Bud\u017cet', 'Budzet']), active: isActive(row['Aktywne']),
        ownerName: clean(row['U\u017cytkownik'] || m['U\u017cytkownik']), ownerEmail: normalizeEmail(row['Email'] || m['Email']), sourceId: clean(row['MCK_ID']),
      };
    }).filter(row => row.accountId || row.name);

    let metaAccounts = meta.rows.map(row => {
      const normalizedId = normalizeMetaId(row['ID Konta']);
      return {
        platform: 'Meta Ads', accountId: clean(row['ID Konta']),
        name: metaNameById.get(normalizedId) || usefulName(row['Konto'], row['ID Konta']) || clean(row['ID Konta']),
        type: clean(row['Typ']), budget: numberText(row, ['Bud\u017cet', 'Budzet']), active: isActive(row['Aktywne']),
        ownerName: clean(row['U\u017cytkownik']), ownerEmail: normalizeEmail(row['Email']), sourceId: clean(row['BM_ID']),
      };
    }).filter(row => row.accountId || row.name);

    const teamName = clean(effective.team);
    let scopedUsers = allUsers;
    if (managerView) {
      scopedUsers = allUsers.filter(user => lower(user.team) === lower(teamName));
      const teamEmails = new Set(scopedUsers.map(user => normalizeEmail(user.email)));
      googleAccounts = googleAccounts.filter(row => teamEmails.has(normalizeEmail(row.ownerEmail)));
      metaAccounts = metaAccounts.filter(row => teamEmails.has(normalizeEmail(row.ownerEmail)));
    }

    const reports = {
      googleWydatki: googleNamesSheet.rows || [],
      googleWyniki: statusRows(googleBatch, 'Wyniki').rows || [],
      googleAudyt: statusRows(googleBatch, 'Audyt').rows || [],
      googleAnomalia: statusRows(googleBatch, 'Anomalia').rows || [],
      googleWartosc: statusRows(googleBatch, 'Warto\u015b\u0107 konwersji').rows || [],
      metaWydatki: metaNamesSheet.rows || [],
      metaMiesieczny: statusRows(metaBatch, 'Raport_Miesieczny').rows || [],
      metaAudyt: statusRows(metaBatch, 'Audyt').rows || [],
      metaAnomalia: statusRows(metaBatch, 'Anomalia').rows || [],
      metaWartosc: statusRows(metaBatch, 'Warto\u015b\u0107 konwersji').rows || [],
    };

    const accounts = [...googleAccounts, ...metaAccounts].map(account => ({
      ...account,
      health: healthFor(account, reports, account.platform === 'Google Ads' ? progiGoogle.rows : progiMeta.rows),
    }));

    let mcks = mck.rows.filter(row => isActive(row['Aktywne'])).map(row => ({
      id: clean(row['MCK_ID']), name: clean(row['Nazwa MCK'] || row['ID MCK'] || row['MCK_ID']), externalId: clean(row['ID MCK']),
      ownerName: clean(row['U\u017cytkownik']), ownerEmail: normalizeEmail(row['Email']),
    })).filter(row => row.id);
    if (managerView) {
      const teamEmails = new Set(scopedUsers.map(user => normalizeEmail(user.email)));
      mcks = mcks.filter(row => teamEmails.has(normalizeEmail(row.ownerEmail)));
    }

    return json(res, 200, {
      ok: true,
      viewMode: managerView ? 'team' : 'admin',
      team: managerView ? teamName : '',
      canAssignAccounts: Boolean(isAdmin(context.actualUser) && !context.previewing),
      canManageEmployees: Boolean(isAdmin(context.actualUser) && !context.previewing),
      users: scopedUsers.map(({ email, name, role, team, active }) => ({ email, name, role, team, active })),
      accounts,
      mcks,
      sync: {
        google: { rows: googleSync.rows || [], error: googleSync.error || '' },
        meta: { rows: metaSync.rows || [], error: metaSync.error || '' },
      },
    });
  } catch (error) {
    console.error('[Admin overview]', error);
    return json(res, 500, { ok: false, error: 'admin_overview_failed', message: error.message });
  }
};
