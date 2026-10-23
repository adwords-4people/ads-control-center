const crypto = require('crypto');
const { getReportingScope, isAdmin } = require('./_lib/access');
const {
  IDS,
  appendSheetValues,
  fetchSheetByGidWithRowNumbers,
  getSheetMetadata,
  normalizeEmail,
  normalizeGoogleId,
  normalizeMetaId,
  setSheetRowValues,
} = require('./_lib/sheets');

const BUILD = '1.7.21-notes-scope';
const NOTES_GID = '0';
const NOTE_TYPES = new Set(['Optymalizacja Duża', 'Optymalizacja Mała', 'Inne']);
const REQUIRED_HEADERS = Object.freeze([
  'Note_ID', 'Created_at', 'Platforma', 'ID Konta', 'Konto', 'Autor',
  'Autor_Email', 'Typ', 'Treść', 'Status', 'Deleted_at', 'Deleted_by',
]);

function json(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.end(JSON.stringify({ ...payload, build: BUILD }));
}

function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (!req.body) return {};
  try { return JSON.parse(String(req.body)); } catch (_) { return {}; }
}

function normalizePlatform(value) {
  const key = String(value || '').trim().toLowerCase();
  if (key === 'google ads' || key === 'google') return 'Google Ads';
  if (key === 'meta ads' || key === 'meta') return 'Meta Ads';
  return '';
}

function isDeletedStatus(value) {
  return ['USUNIETA', 'USUNIĘTA', 'DELETED', 'NIEAKTYWNA'].includes(
    String(value || '').trim().toUpperCase()
  );
}

function hasAccountAccess(scope, platform, accountId, accountName) {
  const name = String(accountName || '').trim().toLowerCase();
  if (platform === 'Google Ads') {
    const id = normalizeGoogleId(accountId);
    return id ? scope.googleIds.has(id) : Boolean(name && scope.googleNames.has(name));
  }
  if (platform === 'Meta Ads') {
    const id = normalizeMetaId(accountId);
    return id ? scope.metaIds.has(id) : Boolean(name && scope.metaNames.has(name));
  }
  return false;
}

function normalizeAccountId(platform, value) {
  return platform === 'Google Ads' ? normalizeGoogleId(value) : normalizeMetaId(value);
}

function validateHeaders(headers) {
  const actual = new Set((headers || []).map(value => String(value || '').trim()));
  const missing = REQUIRED_HEADERS.filter(header => !actual.has(header));
  if (missing.length) {
    throw new Error(`Dziennik nie ma wymaganych kolumn: ${missing.join(', ')}.`);
  }
}

async function loadSheet(req) {
  const metadata = await getSheetMetadata(IDS.notes, req);
  const sheetName = metadata.get(NOTES_GID);
  if (!sheetName) throw new Error(`Nie znaleziono zakładki o GID ${NOTES_GID} w pliku Dziennika.`);
  const sheet = await fetchSheetByGidWithRowNumbers(IDS.notes, NOTES_GID, req);
  validateHeaders(sheet.headers);
  return { ...sheet, sheetName };
}

function mapVisibleNote(row, scope) {
  const platform = normalizePlatform(row['Platforma']);
  const accountId = normalizeAccountId(platform, row['ID Konta']);
  if (!platform || !hasAccountAccess(scope, platform, accountId, row['Konto'])) return null;
  if (isDeletedStatus(row['Status'])) return null;

  const authorEmail = normalizeEmail(row['Autor_Email']);
  const actualEmail = normalizeEmail(scope.actualUser && scope.actualUser.email);
  const canDelete = !scope.previewing && (
    Boolean(authorEmail && actualEmail && authorEmail === actualEmail) || isAdmin(scope.actualUser)
  );

  return {
    id: String(row['Note_ID'] || '').trim(),
    createdAt: String(row['Created_at'] || '').trim(),
    platform,
    accountId,
    accountName: String(row['Konto'] || '').trim(),
    author: String(row['Autor'] || '').trim(),
    authorEmail,
    type: NOTE_TYPES.has(String(row['Typ'] || '').trim()) ? String(row['Typ']).trim() : 'Inne',
    text: String(row['Treść'] || ''),
    status: String(row['Status'] || 'Aktywna').trim() || 'Aktywna',
    canDelete,
  };
}

function sortNotes(rows) {
  return rows.sort((a, b) => {
    const at = Date.parse(a.createdAt) || 0;
    const bt = Date.parse(b.createdAt) || 0;
    return bt - at;
  });
}

module.exports = async function handler(req, res) {
  try {
    const scope = await getReportingScope(req);
    if (!scope) return json(res, 401, { ok: false, error: 'unauthenticated' });

    const method = String(req.method || 'GET').toUpperCase();

    if (method === 'GET') {
      const { rows } = await loadSheet(req);
      const notes = sortNotes(rows.map(row => mapVisibleNote(row, scope)).filter(Boolean));
      return json(res, 200, {
        ok: true,
        notes,
        previewing: Boolean(scope.previewing),
        effectiveUser: scope.effectiveUser && scope.effectiveUser.email || '',
      });
    }

    if (scope.previewing) {
      return json(res, 403, { ok: false, error: 'Tryb podglądu jest tylko do odczytu.' });
    }

    if (method === 'POST') {
      const body = parseBody(req);
      const platform = normalizePlatform(body.platform);
      const accountId = normalizeAccountId(platform, body.accountId);
      const accountName = String(body.accountName || '').trim();
      const type = String(body.type || 'Optymalizacja Duża').trim();
      const text = String(body.text || '').trim();

      if (!platform) return json(res, 400, { ok: false, error: 'Wybierz poprawną platformę.' });
      if (!accountId) return json(res, 400, { ok: false, error: 'Brak poprawnego ID konta.' });
      if (!accountName) return json(res, 400, { ok: false, error: 'Brak nazwy konta.' });
      if (!NOTE_TYPES.has(type)) return json(res, 400, { ok: false, error: 'Nieprawidłowy typ notatki.' });
      if (!text) return json(res, 400, { ok: false, error: 'Wpisz treść notatki.' });
      if (text.length > 10000) return json(res, 400, { ok: false, error: 'Notatka jest zbyt długa (maks. 10 000 znaków).' });
      if (!hasAccountAccess(scope, platform, accountId, accountName)) {
        return json(res, 403, { ok: false, error: 'Nie masz dostępu do tego konta.' });
      }

      const { sheetName } = await loadSheet(req);
      const noteId = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      const author = String(scope.actualUser && scope.actualUser.name || '').trim();
      const authorEmail = normalizeEmail(scope.actualUser && scope.actualUser.email);
      const values = [
        noteId, createdAt, platform, accountId, accountName, author, authorEmail,
        type, text, 'Aktywna', '', '',
      ];
      await appendSheetValues(IDS.notes, sheetName, values, req);

      return json(res, 201, {
        ok: true,
        note: {
          id: noteId, createdAt, platform, accountId, accountName, author, authorEmail,
          type, text, status: 'Aktywna', canDelete: true,
        },
      });
    }

    if (method === 'DELETE') {
      const body = parseBody(req);
      const noteId = String((req.query && req.query.id) || body.id || '').trim();
      if (!noteId) return json(res, 400, { ok: false, error: 'Brak identyfikatora notatki.' });

      const { rows, headers, sheetName } = await loadSheet(req);
      const row = rows.find(item => String(item['Note_ID'] || '').trim() === noteId);
      if (!row || isDeletedStatus(row['Status'])) {
        return json(res, 404, { ok: false, error: 'Nie znaleziono aktywnej notatki.' });
      }

      const visible = mapVisibleNote(row, scope);
      if (!visible) return json(res, 403, { ok: false, error: 'Nie masz dostępu do tej notatki.' });
      if (!visible.canDelete) {
        return json(res, 403, { ok: false, error: 'Notatkę może usunąć jej autor lub Admin.' });
      }

      const deletedAt = new Date().toISOString();
      const deletedBy = normalizeEmail(scope.actualUser && scope.actualUser.email);
      const next = { ...row, Status: 'Usunięta', Deleted_at: deletedAt, Deleted_by: deletedBy };
      const values = headers.map(header => next[header] === undefined ? '' : next[header]);
      await setSheetRowValues(IDS.notes, sheetName, row.__rowNumber, values, req);

      return json(res, 200, { ok: true, id: noteId, deletedAt, deletedBy });
    }

    res.setHeader('Allow', 'GET, POST, DELETE');
    return json(res, 405, { ok: false, error: 'method_not_allowed' });
  } catch (error) {
    console.error('[Notes]', error);
    return json(res, 500, { ok: false, error: error.message || 'notes_unavailable' });
  }
};
