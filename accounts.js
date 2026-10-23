const { clearMappingsCache, getAuthContext, isAdmin } = require('../_lib/access');
const {
  IDS,
  fetchSheetsByName,
  isActive,
  normalizeEmail,
  normalizeGoogleId,
  normalizeMetaId,
  setSheetRowValues,
} = require('../_lib/sheets');
const { loadUsers } = require('../_lib/users');

const GOOGLE_ACCOUNTS_SHEET = 'Konta - Google Ads';
const GOOGLE_MCK_SHEET = 'MCK - Google Ads';
const META_ACCOUNTS_SHEET = 'Konta - Meta Ads';

function clean(value) { return String(value == null ? '' : value).trim(); }
function headerKey(value) {
  return clean(value)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}
function json(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  return res.end(JSON.stringify(payload));
}
function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body.trim()) return JSON.parse(req.body);
  return {};
}
function updateRowValues(headers, row, changes) {
  return headers.map(header => {
    const key = headerKey(header);
    if (Object.prototype.hasOwnProperty.call(changes, key)) return changes[key];
    return row[header] == null ? '' : row[header];
  });
}

module.exports = async function handler(req, res) {
  try {
    const context = await getAuthContext(req);
    if (!context) return json(res, 401, { ok: false, error: 'unauthenticated' });
    if (!isAdmin(context.actualUser)) return json(res, 403, { ok: false, error: 'forbidden' });
    if (context.previewing) {
      return json(res, 409, {
        ok: false,
        error: 'preview_mode',
        message: 'Wyłącz Podgląd jako użytkownik przed zmianą przypisania konta.',
      });
    }
    if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method_not_allowed' });

    const body = readBody(req);
    const platform = clean(body.platform);
    const targetEmail = normalizeEmail(body.targetEmail);
    const sourceId = clean(body.sourceId);

    const targetUser = (await loadUsers(req)).find(user => user.active && normalizeEmail(user.email) === targetEmail);
    if (!targetUser) {
      return json(res, 400, { ok: false, error: 'invalid_target_user', message: 'Wybrany opiekun nie jest aktywnym użytkownikiem.' });
    }

    if (platform === 'Google Ads') {
      const accountId = normalizeGoogleId(body.accountId);
      if (!accountId) return json(res, 400, { ok: false, error: 'invalid_account_id', message: 'Brak prawidłowego ID konta Google Ads.' });

      const sheets = await fetchSheetsByName(IDS.config, [GOOGLE_ACCOUNTS_SHEET, GOOGLE_MCK_SHEET], req);
      const accounts = sheets.get(GOOGLE_ACCOUNTS_SHEET) || { headers: [], rows: [] };
      const mcks = sheets.get(GOOGLE_MCK_SHEET) || { rows: [] };

      const mck = mcks.rows.find(row =>
        isActive(row['Aktywne']) &&
        clean(row['MCK_ID']) === sourceId &&
        normalizeEmail(row['Email']) === targetEmail
      );
      if (!mck) {
        return json(res, 403, {
          ok: false,
          error: 'mck_forbidden',
          message: 'Wybrane MCK nie jest aktywne albo nie należy do wybranego opiekuna.',
        });
      }

      const index = accounts.rows.findIndex(row => normalizeGoogleId(row['ID Konta']) === accountId);
      if (index < 0) return json(res, 404, { ok: false, error: 'account_not_found', message: 'Nie znaleziono konta Google Ads w konfiguracji.' });
      const row = accounts.rows[index];
      const values = updateRowValues(accounts.headers, row, {
        'mck id': sourceId,
        'uzytkownik': clean(targetUser.name),
        'email': targetEmail,
      });
      await setSheetRowValues(IDS.config, GOOGLE_ACCOUNTS_SHEET, index + 2, values, req);
      clearMappingsCache();
      return json(res, 200, { ok: true, platform, accountId, targetEmail, sourceId });
    }

    if (platform === 'Meta Ads') {
      const accountId = normalizeMetaId(body.accountId);
      if (!accountId) return json(res, 400, { ok: false, error: 'invalid_account_id', message: 'Brak prawidłowego ID konta Meta Ads.' });

      const sheets = await fetchSheetsByName(IDS.config, [META_ACCOUNTS_SHEET], req);
      const accounts = sheets.get(META_ACCOUNTS_SHEET) || { headers: [], rows: [] };
      const index = accounts.rows.findIndex(row => normalizeMetaId(row['ID Konta']) === accountId);
      if (index < 0) return json(res, 404, { ok: false, error: 'account_not_found', message: 'Nie znaleziono konta Meta Ads w konfiguracji.' });
      const row = accounts.rows[index];
      const values = updateRowValues(accounts.headers, row, {
        'uzytkownik': clean(targetUser.name),
        'email': targetEmail,
      });
      await setSheetRowValues(IDS.config, META_ACCOUNTS_SHEET, index + 2, values, req);
      clearMappingsCache();
      return json(res, 200, { ok: true, platform, accountId, targetEmail });
    }

    return json(res, 400, { ok: false, error: 'invalid_platform', message: 'Wybierz Google Ads albo Meta Ads.' });
  } catch (error) {
    console.error('[Admin accounts]', error);
    return json(res, 500, { ok: false, error: 'account_assignment_failed', message: error.message });
  }
};
