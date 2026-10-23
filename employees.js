const { getAuthContext, isAdmin } = require('../_lib/access');
const {
  IDS,
  appendSheetValues,
  fetchSheetByName,
  normalizeEmail,
  setSheetRowValues,
} = require('../_lib/sheets');
const { clearUsersCache, loadUsers } = require('../_lib/users');

const SHEET = 'Użytkownicy';
const ROLES = new Set(['Admin', 'Manager', 'Specjalista']);

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

function clean(value) { return String(value || '').trim(); }

module.exports = async function handler(req, res) {
  try {
    const context = await getAuthContext(req);
    if (!context) return json(res, 401, { ok: false, error: 'unauthenticated' });
    if (!isAdmin(context.actualUser)) return json(res, 403, { ok: false, error: 'forbidden' });
    if (context.previewing) return json(res, 409, { ok: false, error: 'preview_mode', message: 'Wyłącz Podgląd jako użytkownik przed zmianą pracowników.' });

    if (req.method === 'GET') {
      const users = (await loadUsers(req)).map(({ email, name, role, team, active }) => ({ email, name, role, team, active }));
      return json(res, 200, { ok: true, users });
    }

    if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method_not_allowed' });

    const body = readBody(req);
    const action = clean(body.action || 'save');
    const email = normalizeEmail(body.email);
    if (!email || !email.endsWith('@4people.pl')) {
      return json(res, 400, { ok: false, error: 'invalid_email', message: 'Email musi należeć do domeny @4people.pl.' });
    }

    const actualEmail = normalizeEmail(context.actualUser.email);
    const sheet = await fetchSheetByName(IDS.config, SHEET, req);
    const index = sheet.rows.findIndex(row => normalizeEmail(row['Email']) === email);
    const rowNumber = index >= 0 ? index + 2 : null;

    if (action === 'deactivate') {
      if (email === actualEmail) return json(res, 400, { ok: false, error: 'self_deactivate', message: 'Nie możesz wyłączyć własnego konta Admina.' });
      if (!rowNumber) return json(res, 404, { ok: false, error: 'not_found' });
      const row = sheet.rows[index];
      await setSheetRowValues(IDS.config, SHEET, rowNumber, [
        clean(row['Email']), clean(row['Użytkownik']), clean(row['Rola']), clean(row['Team']), 'NIE'
      ], req);
      clearUsersCache();
      return json(res, 200, { ok: true });
    }

    if (action === 'activate') {
      if (!rowNumber) return json(res, 404, { ok: false, error: 'not_found' });
      const row = sheet.rows[index];
      await setSheetRowValues(IDS.config, SHEET, rowNumber, [
        clean(row['Email']), clean(row['Użytkownik']), clean(row['Rola']), clean(row['Team']), 'TAK'
      ], req);
      clearUsersCache();
      return json(res, 200, { ok: true });
    }

    const name = clean(body.name);
    const role = clean(body.role);
    const team = clean(body.team);
    if (!name) return json(res, 400, { ok: false, error: 'invalid_name', message: 'Podaj imię i nazwisko.' });
    if (!ROLES.has(role)) return json(res, 400, { ok: false, error: 'invalid_role', message: 'Nieprawidłowa rola.' });
    if (!team) return json(res, 400, { ok: false, error: 'invalid_team', message: 'Podaj Team.' });
    if (email === actualEmail && role !== 'Admin') {
      return json(res, 400, { ok: false, error: 'self_demote', message: 'Nie możesz odebrać sobie roli Admina.' });
    }

    const values = [email, name, role, team, 'TAK'];
    if (rowNumber) await setSheetRowValues(IDS.config, SHEET, rowNumber, values, req);
    else await appendSheetValues(IDS.config, SHEET, values, req);
    clearUsersCache();
    return json(res, 200, { ok: true, created: !rowNumber });
  } catch (error) {
    console.error('[Admin employees]', error);
    return json(res, 500, { ok: false, error: 'employees_write_failed', message: error.message });
  }
};
