const { getPreviewEmail, getSession } = require('./auth');
const { getActiveUserByEmail, loadUsers } = require('./users');
const {
  IDS,
  fetchSheetsByName,
  isActive,
  normalizeEmail,
  normalizeGoogleId,
  normalizeMetaId,
} = require('./sheets');

const CACHE_MS = 0; // mapowanie kont ma odzwierciedlac zmiany Admina od nastepnego requestu
let mappingCache = { at: 0, mcks: [], googleAccounts: [], metaAccounts: [] };

function clearMappingsCache() {
  mappingCache = { at: 0, mcks: [], googleAccounts: [], metaAccounts: [] };
}

function roleKey(value) {
  return String(value || '').trim().toLowerCase();
}

function isAdmin(user) {
  return roleKey(user && user.role) === 'admin';
}

function isManager(user) {
  return roleKey(user && user.role) === 'manager';
}

async function getAuthContext(req) {
  const session = getSession(req);
  if (!session) return null;

  const actualUser = await getActiveUserByEmail(session.email, req);
  if (!actualUser) return null;

  let effectiveUser = actualUser;
  let previewing = false;

  // Preview jest dostepny tylko dla prawdziwego Admina.
  if (isAdmin(actualUser)) {
    const previewEmail = getPreviewEmail(req);
    if (previewEmail) {
      const previewUser = await getActiveUserByEmail(previewEmail, req);
      if (previewUser) {
        effectiveUser = previewUser;
        previewing = previewUser.email !== actualUser.email;
      }
    }
  }

  return { actualUser, effectiveUser, previewing };
}

async function loadMappings(req) {
  if (Date.now() - mappingCache.at < CACHE_MS && mappingCache.googleAccounts.length) {
    return mappingCache;
  }

  // Jeden batchGet konfiguracji zamiast 3 osobnych odczytow.
  const sheets = await fetchSheetsByName(IDS.config, [
    'MCK - Google Ads',
    'Konta - Google Ads',
    'Konta - Meta Ads',
  ], req);

  mappingCache = {
    at: Date.now(),
    mcks: (sheets.get('MCK - Google Ads') || { rows: [] }).rows,
    googleAccounts: (sheets.get('Konta - Google Ads') || { rows: [] }).rows,
    metaAccounts: (sheets.get('Konta - Meta Ads') || { rows: [] }).rows,
  };

  return mappingCache;
}

// Zakres zarzadczy uzywany przez widoki typu Admin -> Klienci.
// Admin: wszystkie konta. Manager: caly zespol. Specjalista: tylko swoje.
async function permittedEmailsForUser(user, req) {
  if (isAdmin(user)) return null;
  if (!isManager(user)) return new Set([normalizeEmail(user.email)]);

  const users = await loadUsers(req);
  const team = String(user.team || '').trim().toLowerCase();

  return new Set(users
    .filter(item => item.active && String(item.team || '').trim().toLowerCase() === team)
    .map(item => normalizeEmail(item.email))
    .filter(Boolean));
}

async function buildRestrictedScope(context, emails, req) {
  const mappings = await loadMappings(req);

  const allowedMcks = new Set(mappings.mcks
    .filter(row => isActive(row['Aktywne']) && emails.has(normalizeEmail(row['Email'])))
    .map(row => String(row['MCK_ID'] || '').trim())
    .filter(Boolean));

  const googleRows = mappings.googleAccounts.filter(row =>
    isActive(row['Aktywne']) && allowedMcks.has(String(row['MCK_ID'] || '').trim()));

  const metaRows = mappings.metaAccounts.filter(row =>
    isActive(row['Aktywne']) && emails.has(normalizeEmail(row['Email'])));

  return {
    ...context,
    unrestricted: false,
    googleIds: new Set(googleRows.map(row => normalizeGoogleId(row['ID Konta'])).filter(Boolean)),
    googleNames: new Set(googleRows.map(row => String(row['Konto'] || '').trim().toLowerCase()).filter(Boolean)),
    metaIds: new Set(metaRows.map(row => normalizeMetaId(row['ID Konta'])).filter(Boolean)),
    metaNames: new Set(metaRows.map(row => String(row['Konto'] || '').trim().toLowerCase()).filter(Boolean)),
  };
}

// Szeroki zakres zarzadczy. Zachowujemy dotychczasowe zachowanie dla Admin -> Klienci.
async function getAccessScope(req) {
  const context = await getAuthContext(req);
  if (!context) return null;

  const { effectiveUser } = context;

  if (isAdmin(effectiveUser)) {
    return { ...context, unrestricted: true };
  }

  const emails = await permittedEmailsForUser(effectiveUser, req);
  return buildRestrictedScope(context, emails, req);
}

// NOWE: zakres tylko dla zwyklych raportow.
// Niezaleznie od roli raporty pokazuja wyłącznie konta przypisane bezposrednio
// do effectiveUser. W trybie preview effectiveUser to podgladany uzytkownik.
async function getReportingScope(req) {
  const context = await getAuthContext(req);
  if (!context) return null;

  const email = normalizeEmail(context.effectiveUser && context.effectiveUser.email);
  if (!email) return null;

  return buildRestrictedScope(context, new Set([email]), req);
}

module.exports = {
  clearMappingsCache,
  getAccessScope,
  getAuthContext,
  getReportingScope,
  isAdmin,
};
