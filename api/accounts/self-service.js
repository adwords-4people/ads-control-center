const { getAuthContext, clearMappingsCache } = require('../_lib/access');
const {
  IDS,
  appendSheetValues,
  fetchSheetByName,
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
  return platform === 'Google Ads'
    ? clean(row['ID MCK'])
    : clean(row['ID Business Managera']);
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
function requireHeaders(headers, required, sheetName) {
  const keys = new Set(headers.map(headerKey));
  const missing = required.filter(item => !keys.has(item));
  if (missing.length) throw new Error(`Zakładka ${sheetName} nie ma wymaganych kolumn: ${missing.join(', ')}.`);
}

async function getSources(req, user) {
  const [mck, bm] = await Promise.all([
    fetchSheetByName(IDS.config, MCK_SHEET, req),
    fetchSheetByName(IDS.config, BM_SHEET, req),
  ]);
  const email = normalizeEmail(user.email);
  const googleSources = mck.rows
    .filter(row => isActive(row['Aktywne']) && normalizeEmail(row['Email']) === email)
    .map(row => ({
      id: clean(row['MCK_ID']),
      name: sourceName(row, 'Google Ads'),
      externalId: externalSourceId(row, 'Google Ads'),
    }))
    .filter(item => item.id);
  const metaSources = bm.rows
    .filter(row => isActive(row['Aktywne']))
    .map(row => ({
      id: clean(row['BM_ID']),
      name: sourceName(row, 'Meta Ads'),
      externalId: externalSourceId(row, 'Meta Ads'),
    }))
    .filter(item => item.id);
  return { googleSources, metaSources };
}

module.exports = async function handler(req, res) {
  try {
    const context = await getAuthContext(req);
    if (!context) return json(res, 401, { ok: false, error: 'unauthenticated' });
    if (context.previewing) return json(res, 409, { ok: false, error: 'preview_mode', message: 'Wyłącz tryb Podgląd jako użytkownik.' });
    if (role(context.actualUser && context.actualUser.role) !== 'specjalista') {
      return json(res, 403, { ok: false, error: 'forbidden', message: 'Dodawanie kont z tego miejsca jest dostępne dla Specjalistów.' });
    }

    const user = context.actualUser;
    const sources = await getSources(req, user);
    if (req.method === 'GET') {
      return json(res, 200, {
        ok: true,
        user: { email: user.email, name: user.name },
        ...sources,
      });
    }
    if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method_not_allowed' });

    const body = readBody(req);
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
      const allowed = sources.googleSources.find(item => item.id === sourceId) || (sources.googleSources.length === 1 ? sources.googleSources[0] : null);
      if (!allowed) return json(res, 403, { ok: false, error: 'mck_forbidden', message: 'To MCK nie jest przypisane do Twojego konta.' });

      const sheet = await fetchSheetByName(IDS.config, GOOGLE_SHEET, req);
      requireHeaders(sheet.headers, ['mck id', 'id konta', 'konto', 'typ', 'uzytkownik', 'email', 'budzet', 'aktywne'], GOOGLE_SHEET);
      const duplicate = sheet.rows.find(row => normalizeGoogleId(row['ID Konta']) === accountId);
      if (duplicate) {
        return json(res, 409, { ok: false, error: 'duplicate', message: 'To konto Google Ads jest już w konfiguracji. Jeśli jest nieaktywne lub przypisane do innej osoby, poproś Admina o zmianę.' });
      }
      const row = buildRow(sheet.headers, {
        mckId: allowed.id,
        accountId: displayGoogleId(accountId),
        name,
        type,
        userName: clean(user.name),
        email: normalizeEmail(user.email),
        budget,
      });
      await appendSheetValues(IDS.config, GOOGLE_SHEET, row, req);
      clearMappingsCache();
      return json(res, 200, { ok: true, platform, accountId: displayGoogleId(accountId), sourceId: allowed.id });
    }

    const accountId = normalizeMetaId(body.accountId);
    if (accountId.length < 5) {
      return json(res, 400, { ok: false, error: 'invalid_account_id', message: 'Podaj prawidłowe ID konta Meta Ads.' });
    }
    const allowed = sources.metaSources.find(item => item.id === sourceId) || (sources.metaSources.length === 1 ? sources.metaSources[0] : null);
    if (!allowed) return json(res, 403, { ok: false, error: 'bm_forbidden', message: 'Wybierz aktywny Business Manager.' });

    const sheet = await fetchSheetByName(IDS.config, META_SHEET, req);
    requireHeaders(sheet.headers, ['id konta', 'konto', 'bm id', 'typ', 'uzytkownik', 'email', 'budzet', 'aktywne'], META_SHEET);
    const duplicate = sheet.rows.find(row => normalizeMetaId(row['ID Konta']) === accountId);
    if (duplicate) {
      return json(res, 409, { ok: false, error: 'duplicate', message: 'To konto Meta Ads jest już w konfiguracji. Jeśli jest nieaktywne lub przypisane do innej osoby, poproś Admina o zmianę.' });
    }
    const row = buildRow(sheet.headers, {
      bmId: allowed.id,
      accountId: displayMetaId(accountId),
      name,
      type,
      userName: clean(user.name),
      email: normalizeEmail(user.email),
      budget,
    });
    await appendSheetValues(IDS.config, META_SHEET, row, req);
    clearMappingsCache();
    return json(res, 200, { ok: true, platform, accountId: displayMetaId(accountId), sourceId: allowed.id });
  } catch (error) {
    console.error('[Account self-service]', error);
    return json(res, 500, { ok: false, error: 'account_add_failed', message: error.message });
  }
};
