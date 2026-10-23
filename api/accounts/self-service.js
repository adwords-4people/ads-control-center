const { getAuthContext, clearMappingsCache } = require('../_lib/access');
const { loadUsers } = require('../_lib/users');
const {
  IDS,
  appendSheetValues,
  fetchSheetByName,
  fetchSheetsByName,
  isActive,
  normalizeEmail,
  normalizeGoogleId,
  normalizeMetaId,
} = require('../_lib/sheets');

const GOOGLE_SHEET = 'Konta - Google Ads';
const MCK_SHEET = 'MCK - Google Ads';
const META_SHEET = 'Konta - Meta Ads';
const BM_SHEET = 'BM - Meta Ads';
const TYPES = new Set(['Lead', 'Sklep']);
const ALLOWED_ROLES = new Set(['admin', 'manager', 'specjalista']);

function clean(value) { return String(value == null ? '' : value).trim(); }
function lower(value) { return clean(value).toLowerCase(); }
function role(value) { return lower(value); }
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
function displayGoogleId(id) {
  const n = normalizeGoogleId(id);
  return n.length === 10 ? `${n.slice(0, 3)}-${n.slice(3, 6)}-${n.slice(6)}` : n;
}
function displayMetaId(id) {
  const n = normalizeMetaId(id);
  return n ? `act_${n}` : '';
}
function finiteBudget(value) {
  if (value === '' || value === null || value === undefined) return '';
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
function sourceName(row, platform) {
  if (platform === 'Google Ads') return clean(row['Nazwa MCK'] || row['ID MCK'] || row['MCK_ID']);
  return clean(row['Nazwa'] || row['Nazwa BM'] || row['ID Business Managera'] || row['BM_ID']);
}
function externalSourceId(row, platform) {
  return platform === 'Google Ads' ? clean(row['ID MCK']) : clean(row['ID Business Managera']);
}
function buildRow(headers, values) {
  return headers.map(header => {
    switch (headerKey(header)) {
      case 'mck id': return values.mckId || '';
      case 'bm id': return values.bmId || '';
      case 'id konta': return values.accountId || '';
      case 'konto':
      case 'nazwa konta': return values.name || '';
      case 'typ': return values.type || '';
      case 'uzytkownik': return values.userName || '';
      case 'email': return values.email || '';
      case 'budzet': return values.budget;
      case 'aktywne': return 'TAK';
      default: return '';
    }
  });
}
function requireHeaderGroups(headers, requiredGroups, sheetName) {
  const keys = new Set(headers.map(headerKey));
  const missing = requiredGroups
    .filter(group => !group.some(item => keys.has(item)))
    .map(group => group.join(' / '));
  if (missing.length) throw new Error(`Zakładka ${sheetName} nie ma wymaganych kolumn: ${missing.join(', ')}.`);
}

async function getEligibleOwners(context, req) {
  const acting = context.previewing ? context.effectiveUser : context.actualUser;
  const actingRole = role(acting && acting.role);
  if (!ALLOWED_ROLES.has(actingRole)) return [];

  const users = (await loadUsers(req)).filter(user => user.active);
  const actingEmail = normalizeEmail(acting.email);

  if (actingRole === 'specjalista') {
    return users.filter(user => normalizeEmail(user.email) === actingEmail);
  }
  if (actingRole === 'manager') {
    const team = lower(acting.team);
    return users.filter(user => lower(user.team) === team);
  }
  return users;
}

async function getOptions(req, context) {
  const owners = await getEligibleOwners(context, req);
  const ownerEmails = new Set(owners.map(user => normalizeEmail(user.email)));
  const sheets = await fetchSheetsByName(IDS.config, [MCK_SHEET, BM_SHEET], req);
  const mck = sheets.get(MCK_SHEET) || { rows: [] };
  const bm = sheets.get(BM_SHEET) || { rows: [] };

  const googleSourcesByOwner = {};
  owners.forEach(owner => { googleSourcesByOwner[normalizeEmail(owner.email)] = []; });

  mck.rows
    .filter(row => isActive(row['Aktywne']))
    .forEach(row => {
      const email = normalizeEmail(row['Email']);
      if (!ownerEmails.has(email)) return;
      const item = {
        id: clean(row['MCK_ID']),
        name: sourceName(row, 'Google Ads'),
        externalId: externalSourceId(row, 'Google Ads'),
      };
      if (item.id) googleSourcesByOwner[email].push(item);
    });

  const metaSources = bm.rows
    .filter(row => isActive(row['Aktywne']))
    .map(row => ({
      id: clean(row['BM_ID']),
      name: sourceName(row, 'Meta Ads'),
      externalId: externalSourceId(row, 'Meta Ads'),
    }))
    .filter(item => item.id);

  return {
    owners: owners.map(user => ({
      email: normalizeEmail(user.email),
      name: clean(user.name),
      role: clean(user.role),
      team: clean(user.team),
    })),
    googleSourcesByOwner,
    metaSources,
  };
}

module.exports = async function handler(req, res) {
  try {
    const context = await getAuthContext(req);
    if (!context) return json(res, 401, { ok: false, error: 'unauthenticated' });

    const acting = context.previewing ? context.effectiveUser : context.actualUser;
    const actingRole = role(acting && acting.role);
    if (!ALLOWED_ROLES.has(actingRole)) {
      return json(res, 403, { ok: false, error: 'forbidden', message: 'Twoja rola nie ma dostępu do dodawania kont.' });
    }

    const options = await getOptions(req, context);

    if (req.method === 'GET') {
      return json(res, 200, {
        ok: true,
        previewing: Boolean(context.previewing),
        role: clean(acting.role),
        ...options,
      });
    }

    if (req.method !== 'POST') {
      return json(res, 405, { ok: false, error: 'method_not_allowed' });
    }
    if (context.previewing) {
      return json(res, 409, {
        ok: false,
        error: 'preview_mode',
        message: 'Tryb Podgląd jako pokazuje formularz, ale nie pozwala zapisywać zmian.',
      });
    }

    const actualRole = role(context.actualUser && context.actualUser.role);
    if (!ALLOWED_ROLES.has(actualRole)) {
      return json(res, 403, { ok: false, error: 'forbidden', message: 'Twoja rola nie ma dostępu do dodawania kont.' });
    }

    const body = readBody(req);
    const ownerEmail = normalizeEmail(body.ownerEmail || context.actualUser.email);
    const owner = options.owners.find(item => normalizeEmail(item.email) === ownerEmail);
    if (!owner) {
      return json(res, 403, { ok: false, error: 'owner_forbidden', message: 'Nie możesz przypisać konta do tego użytkownika.' });
    }

    const platform = clean(body.platform);
    if (!['Google Ads', 'Meta Ads'].includes(platform)) {
      return json(res, 400, { ok: false, error: 'invalid_platform', message: 'Wybierz Google Ads albo Meta Ads.' });
    }

    const name = clean(body.name);
    const type = clean(body.type);
    const sourceId = clean(body.sourceId);
    const budget = finiteBudget(body.budget);
    if (!name) return json(res, 400, { ok: false, error: 'invalid_name', message: 'Podaj nazwę konta reklamowego.' });
    if (!TYPES.has(type)) return json(res, 400, { ok: false, error: 'invalid_type', message: 'Typ konta musi być Lead albo Sklep.' });
    if (budget === null) return json(res, 400, { ok: false, error: 'invalid_budget', message: 'Budżet musi być liczbą większą lub równą 0.' });

    if (platform === 'Google Ads') {
      const accountId = normalizeGoogleId(body.accountId);
      if (accountId.length !== 10) {
        return json(res, 400, { ok: false, error: 'invalid_account_id', message: 'ID konta Google Ads powinno mieć 10 cyfr.' });
      }

      const ownerSources = options.googleSourcesByOwner[ownerEmail] || [];
      const allowed = ownerSources.find(item => item.id === sourceId) || (ownerSources.length === 1 ? ownerSources[0] : null);
      if (!allowed) {
        return json(res, 403, { ok: false, error: 'mck_forbidden', message: 'Wybrane MCK nie jest przypisane do wybranego opiekuna.' });
      }

      const sheet = await fetchSheetByName(IDS.config, GOOGLE_SHEET, req);
      // W Google Ads właściciel konta wynika z przypisanego MCK.
      // Dlatego arkusz kont nie musi mieć osobnych kolumn Użytkownik/Email.
      // Akceptujemy też historyczny nagłówek "Nazwa konta" zamiast "Konto".
      requireHeaderGroups(sheet.headers, [
        ['mck id'],
        ['id konta'],
        ['konto', 'nazwa konta'],
        ['typ'],
        ['budzet'],
        ['aktywne'],
      ], GOOGLE_SHEET);
      if (sheet.rows.some(row => normalizeGoogleId(row['ID Konta']) === accountId)) {
        return json(res, 409, { ok: false, error: 'duplicate', message: 'To konto Google Ads jest już w konfiguracji. Użyj funkcji Przypisz, jeśli chcesz zmienić opiekuna.' });
      }

      const row = buildRow(sheet.headers, {
        mckId: allowed.id,
        accountId: displayGoogleId(accountId),
        name,
        type,
        userName: clean(owner.name),
        email: ownerEmail,
        budget,
      });
      await appendSheetValues(IDS.config, GOOGLE_SHEET, row, req);
      clearMappingsCache();
      return json(res, 200, { ok: true, platform, accountId: displayGoogleId(accountId), sourceId: allowed.id, ownerEmail });
    }

    const accountId = normalizeMetaId(body.accountId);
    if (!accountId) {
      return json(res, 400, { ok: false, error: 'invalid_account_id', message: 'Podaj poprawne ID konta Meta Ads.' });
    }

    const allowed = options.metaSources.find(item => item.id === sourceId) || (options.metaSources.length === 1 ? options.metaSources[0] : null);
    if (!allowed) {
      return json(res, 403, { ok: false, error: 'bm_forbidden', message: 'Wybierz poprawny Business Manager.' });
    }

    const sheet = await fetchSheetByName(IDS.config, META_SHEET, req);
    requireHeaderGroups(sheet.headers, [
      ['bm id'],
      ['id konta'],
      ['konto', 'nazwa konta'],
      ['typ'],
      ['uzytkownik'],
      ['email'],
      ['budzet'],
      ['aktywne'],
    ], META_SHEET);
    if (sheet.rows.some(row => normalizeMetaId(row['ID Konta']) === accountId)) {
      return json(res, 409, { ok: false, error: 'duplicate', message: 'To konto Meta Ads jest już w konfiguracji. Użyj funkcji Przypisz, jeśli chcesz zmienić opiekuna.' });
    }

    const row = buildRow(sheet.headers, {
      bmId: allowed.id,
      accountId: displayMetaId(accountId),
      name,
      type,
      userName: clean(owner.name),
      email: ownerEmail,
      budget,
    });
    await appendSheetValues(IDS.config, META_SHEET, row, req);
    clearMappingsCache();
    return json(res, 200, { ok: true, platform, accountId: displayMetaId(accountId), sourceId: allowed.id, ownerEmail });
  } catch (error) {
    console.error('[Account self-service]', error);
    return json(res, 500, { ok: false, error: 'self_service_failed', message: error.message });
  }
};
