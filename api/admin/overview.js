const { getAuthContext, isAdmin } = require('../_lib/access');
const { IDS, fetchSheetByName, isActive, normalizeEmail } = require('../_lib/sheets');
const { loadUsers } = require('../_lib/users');

function clean(value) { return String(value || '').trim(); }
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

module.exports = async function handler(req, res) {
  try {
    const context = await getAuthContext(req);
    if (!context) return json(res, 401, { ok: false, error: 'unauthenticated' });
    if (!isAdmin(context.actualUser) || context.previewing) return json(res, 403, { ok: false, error: 'forbidden' });

    const [users, mck, google, meta, googleSync, metaSync] = await Promise.all([
      loadUsers(req),
      fetchSheetByName(IDS.config, 'MCK - Google Ads', req),
      fetchSheetByName(IDS.config, 'Konta - Google Ads', req),
      fetchSheetByName(IDS.config, 'Konta - Meta Ads', req),
      fetchSheetByName(IDS.google, 'SYNC_STATUS', req).catch(error => ({ headers: [], rows: [], error: error.message })),
      fetchSheetByName(IDS.meta, 'META_SYNC_STATUS', req).catch(error => ({ headers: [], rows: [], error: error.message })),
    ]);

    const mckById = new Map(mck.rows.map(row => [clean(row['MCK_ID']), row]));
    const googleAccounts = google.rows.map(row => {
      const m = mckById.get(clean(row['MCK_ID'])) || {};
      return {
        platform: 'Google Ads',
        accountId: clean(row['ID Konta']),
        name: clean(row['Konto']),
        type: clean(row['Typ']),
        budget: numberText(row, ['Budżet', 'Budzet']),
        active: isActive(row['Aktywne']),
        ownerName: clean(row['Użytkownik'] || m['Użytkownik']),
        ownerEmail: normalizeEmail(row['Email'] || m['Email']),
        sourceId: clean(row['MCK_ID']),
      };
    }).filter(row => row.accountId || row.name);

    const metaAccounts = meta.rows.map(row => ({
      platform: 'Meta Ads',
      accountId: clean(row['ID Konta']),
      name: clean(row['Konto']),
      type: clean(row['Typ']),
      budget: numberText(row, ['Budżet', 'Budzet']),
      active: isActive(row['Aktywne']),
      ownerName: clean(row['Użytkownik']),
      ownerEmail: normalizeEmail(row['Email']),
      sourceId: clean(row['BM_ID']),
    })).filter(row => row.accountId || row.name);

    return json(res, 200, {
      ok: true,
      users: users.map(({ email, name, role, team, active }) => ({ email, name, role, team, active })),
      accounts: [...googleAccounts, ...metaAccounts],
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
