const { getPreviewEmail, getSession } = require('./_lib/auth');
const {
  IDS,
  fetchSheetsByName,
  isActive,
  normalizeEmail,
  normalizeGoogleId,
  normalizeMetaId,
} = require('./_lib/sheets');
const { loadAllDashboardSources } = require('./_lib/data-sources');

const ACCESS_SHEETS = [
  'Użytkownicy',
  'MCK - Google Ads',
  'Konta - Google Ads',
  'Konta - Meta Ads',
];

function roleKey(value) {
  return String(value || '').trim().toLowerCase();
}

function rowToUser(row) {
  return {
    email: normalizeEmail(row && row['Email']),
    name: String(row && row['Użytkownik'] || '').trim(),
    role: String(row && row['Rola'] || '').trim(),
    team: String(row && row['Team'] || '').trim(),
    active: isActive(row && row['Aktywne']),
  };
}

function buildScopeForEmails(context, emails, mcks, googleAccounts, metaAccounts) {
  const allowedMcks = new Set((mcks || [])
    .filter(row => isActive(row['Aktywne']) && emails.has(normalizeEmail(row['Email'])))
    .map(row => String(row['MCK_ID'] || '').trim())
    .filter(Boolean));

  const googleRows = (googleAccounts || []).filter(row =>
    isActive(row['Aktywne']) && allowedMcks.has(String(row['MCK_ID'] || '').trim()));
  const metaRows = (metaAccounts || []).filter(row =>
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

function buildScopesFromRows(session, previewEmail, rowsBySheet) {
  const users = (rowsBySheet.users || []).map(rowToUser).filter(user => user.email);
  const actualEmail = normalizeEmail(session && session.email);
  const actualUser = users.find(user => user.active && user.email === actualEmail);
  if (!actualUser) return null;

  let effectiveUser = actualUser;
  let previewing = false;
  if (roleKey(actualUser.role) === 'admin' && previewEmail) {
    const preview = users.find(user => user.active && user.email === normalizeEmail(previewEmail));
    if (preview) {
      effectiveUser = preview;
      previewing = preview.email !== actualUser.email;
    }
  }

  const context = { actualUser, effectiveUser, previewing };
  const effectiveEmail = normalizeEmail(effectiveUser.email);
  const personalEmails = new Set(effectiveEmail ? [effectiveEmail] : []);
  const personalScope = buildScopeForEmails(
    context,
    personalEmails,
    rowsBySheet.mcks,
    rowsBySheet.googleAccounts,
    rowsBySheet.metaAccounts,
  );

  let notesScope = personalScope;
  if (roleKey(effectiveUser.role) === 'admin') {
    notesScope = { ...context, unrestricted: true };
  } else if (roleKey(effectiveUser.role) === 'manager') {
    const team = String(effectiveUser.team || '').trim().toLowerCase();
    const teamEmails = new Set(users
      .filter(user => user.active && String(user.team || '').trim().toLowerCase() === team)
      .map(user => user.email));
    notesScope = buildScopeForEmails(
      context,
      teamEmails,
      rowsBySheet.mcks,
      rowsBySheet.googleAccounts,
      rowsBySheet.metaAccounts,
    );
  }

  return { context, personalScope, notesScope };
}

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timeout etapu ${label} po ${Math.round(ms / 1000)} s.`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function resolveDashboardScopes(req) {
  const session = getSession(req);
  if (!session) return null;

  const batch = await fetchSheetsByName(IDS.config, ACCESS_SHEETS, req);
  return buildScopesFromRows(session, getPreviewEmail(req), {
    users: (batch.get('Użytkownicy') || { rows: [] }).rows,
    mcks: (batch.get('MCK - Google Ads') || { rows: [] }).rows,
    googleAccounts: (batch.get('Konta - Google Ads') || { rows: [] }).rows,
    metaAccounts: (batch.get('Konta - Meta Ads') || { rows: [] }).rows,
  });
}

async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  const started = Date.now();
  let stage = 'scope';
  try {
    const scopes = await withTimeout(resolveDashboardScopes(req), 12000, 'scope');
    if (!scopes) {
      res.statusCode = 401;
      return res.end(JSON.stringify({ ok: false, stage, error: 'unauthenticated' }));
    }

    stage = 'sources';
    const { sources, errors } = await withTimeout(
      loadAllDashboardSources(req, scopes.personalScope, { notesScope: scopes.notesScope }),
      20000,
      'sources',
    );

    res.statusCode = 200;
    return res.end(JSON.stringify({
      ok: errors.length === 0,
      partial: errors.length > 0,
      ms: Date.now() - started,
      stage: 'done',
      errors,
      sources,
    }));
  } catch (error) {
    console.error('[Dashboard data]', stage, error);
    res.statusCode = 500;
    return res.end(JSON.stringify({
      ok: false,
      stage,
      ms: Date.now() - started,
      error: error && error.message ? error.message : String(error),
    }));
  }
}

module.exports = handler;
module.exports._test = { buildScopesFromRows, buildScopeForEmails, rowToUser };
