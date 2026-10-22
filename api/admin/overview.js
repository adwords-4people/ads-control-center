const { getAuthContext, isAdmin } = require('../_lib/access');
const {
  IDS,
  fetchSheetByName,
  fetchSheetsByName,
  isActive,
  normalizeEmail,
  normalizeGoogleId,
  normalizeMetaId,
} = require('../_lib/sheets');
const { loadUsers } = require('../_lib/users');

function clean(value) { return String(value || '').trim(); }
function lower(value) { return clean(value).toLowerCase(); }
function numberText(row, names) {
  for (const name of names) if (row[name] !== undefined && clean(row[name]) !== '') return clean(row[name]);
  return '';
}
function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.end(JSON.stringify(payload));
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

module.exports = async function handler(req, res) {
  try {
    const context = await getAuthContext(req);
    if (!context) return json(res, 401, { ok: false, error: 'unauthenticated' });
    if (!isAdmin(context.actualUser) || context.previewing) return json(res, 403, { ok: false, error: 'forbidden' });

    const [users, configBatch, googleBatch, metaBatch] = await Promise.all([
      loadUsers(req),
      fetchSheetsByName(IDS.config, ['MCK - Google Ads', 'Konta - Google Ads', 'Konta - Meta Ads'], req),
      fetchSheetsByName(IDS.google, ['Wydatki', 'SYNC_STATUS'], req)
        .catch(error => new Map([['Wydatki', { rows: [] }], ['SYNC_STATUS', { headers: [], rows: [], error: error.message }]])),
      fetchSheetsByName(IDS.meta, ['Wydatki', 'META_SYNC_STATUS'], req)
        .catch(error => new Map([['Wydatki', { rows: [] }], ['META_SYNC_STATUS', { headers: [], rows: [], error: error.message }]])),
    ]);

    const mck = configBatch.get('MCK - Google Ads') || { rows: [] };
    const google = configBatch.get('Konta - Google Ads') || { rows: [] };
    const meta = configBatch.get('Konta - Meta Ads') || { rows: [] };
    const googleNamesSheet = googleBatch.get('Wydatki') || { rows: [] };
    const metaNamesSheet = metaBatch.get('Wydatki') || { rows: [] };
    const googleSync = googleBatch.get('SYNC_STATUS') || { headers: [], rows: [] };
    const metaSync = metaBatch.get('META_SYNC_STATUS') || { headers: [], rows: [] };

    const googleNameById = accountNameMap(googleNamesSheet.rows, 'Google Ads');
    const metaNameById = accountNameMap(metaNamesSheet.rows, 'Meta Ads');
    const mckById = new Map(mck.rows.map(row => [clean(row['MCK_ID']), row]));

    const googleAccounts = google.rows.map(row => {
      const m = mckById.get(clean(row['MCK_ID'])) || {};
      const normalizedId = normalizeGoogleId(row['ID Konta']);
      const reportName = googleNameById.get(normalizedId) || '';
      const configName = usefulName(row['Konto'], row['ID Konta']);
      return {
        platform: 'Google Ads',
        accountId: clean(row['ID Konta']),
        name: reportName || configName || clean(row['ID Konta']),
        type: clean(row['Typ']),
        budget: numberText(row, ['Budżet', 'Budzet']),
        active: isActive(row['Aktywne']),
        ownerName: clean(row['Użytkownik'] || m['Użytkownik']),
        ownerEmail: normalizeEmail(row['Email'] || m['Email']),
        sourceId: clean(row['MCK_ID']),
      };
    }).filter(row => row.accountId || row.name);

    const metaAccounts = meta.rows.map(row => {
      const normalizedId = normalizeMetaId(row['ID Konta']);
      const reportName = metaNameById.get(normalizedId) || '';
      const configName = usefulName(row['Konto'], row['ID Konta']);
      return {
        platform: 'Meta Ads',
        accountId: clean(row['ID Konta']),
        name: reportName || configName || clean(row['ID Konta']),
        type: clean(row['Typ']),
        budget: numberText(row, ['Budżet', 'Budzet']),
        active: isActive(row['Aktywne']),
        ownerName: clean(row['Użytkownik']),
        ownerEmail: normalizeEmail(row['Email']),
        sourceId: clean(row['BM_ID']),
      };
    }).filter(row => row.accountId || row.name);

    const mcks = mck.rows
      .filter(row => isActive(row['Aktywne']))
      .map(row => ({
        id: clean(row['MCK_ID']),
        name: clean(row['Nazwa MCK'] || row['ID MCK'] || row['MCK_ID']),
        externalId: clean(row['ID MCK']),
        ownerName: clean(row['Użytkownik']),
        ownerEmail: normalizeEmail(row['Email']),
      }))
      .filter(row => row.id);

    return json(res, 200, {
      ok: true,
      users: users.map(({ email, name, role, team, active }) => ({ email, name, role, team, active })),
      accounts: [...googleAccounts, ...metaAccounts],
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
