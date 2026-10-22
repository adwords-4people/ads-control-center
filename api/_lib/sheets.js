const crypto = require('crypto');

const DEFAULT_CONFIG_SHEET_ID = '1fy9NxgD9G52lRRie4Br9L-Y_VRVseZ4ksFmH32t5v8M';
const DEFAULT_GOOGLE_DATA_SHEET_ID = '1_CMt0tZhGqT3y6wp5tTpetU7GtNtt2bKkzERg2iLNhw';
const DEFAULT_META_DATA_SHEET_ID = '1_GCw4RqECUNeKisRNXSpb0ekcz1IQNxgb180ymexLOU';

const IDS = Object.freeze({
  config: process.env.CONFIG_SHEET_ID || DEFAULT_CONFIG_SHEET_ID,
  google: process.env.GOOGLE_DATA_SHEET_ID || DEFAULT_GOOGLE_DATA_SHEET_ID,
  meta: process.env.META_DATA_SHEET_ID || DEFAULT_META_DATA_SHEET_ID,
});

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const TOKEN_SAFETY_MS = 60 * 1000;
const METADATA_CACHE_MS = 5 * 60 * 1000;

let tokenCache = { token: '', expiresAt: 0, pending: null };
const metadataCache = new Map();

function base64Url(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(String(input));
  return buffer.toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function getCredentials() {
  let email = String(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim();
  let privateKey = String(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '');

  // Opcjonalny wariant awaryjny: caly JSON konta serwisowego w jednym sekrecie.
  // Nie jest wymagany, jesli ustawione sa dwa pola powyzej.
  const json = String(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '').trim();
  if ((!email || !privateKey) && json) {
    let parsed;
    try {
      parsed = JSON.parse(json);
    } catch (error) {
      throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON nie jest poprawnym JSON-em.');
    }
    email = email || String(parsed.client_email || '').trim();
    privateKey = privateKey || String(parsed.private_key || '');
  }

  privateKey = privateKey.replace(/\\n/g, '\n').trim();

  if (!email) throw new Error('Brak GOOGLE_SERVICE_ACCOUNT_EMAIL w Environment Variables.');
  if (!privateKey) throw new Error('Brak GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY w Environment Variables.');
  if (!privateKey.includes('BEGIN PRIVATE KEY')) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY nie wyglada jak klucz PEM konta serwisowego.');
  }

  return { email, privateKey };
}

function makeJwt(email, privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64Url(JSON.stringify({
    iss: email,
    scope: SHEETS_SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${claims}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(unsigned), privateKey);
  return `${unsigned}.${base64Url(signature)}`;
}

async function requestAccessToken() {
  const { email, privateKey } = getCredentials();
  const assertion = makeJwt(email, privateKey);
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  });

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    cache: 'no-store',
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    const details = payload.error_description || payload.error || `HTTP ${response.status}`;
    throw new Error(`Nie udalo sie pobrac tokenu Google Service Account: ${details}`);
  }

  const expiresIn = Math.max(60, Number(payload.expires_in || 3600));
  tokenCache = {
    token: payload.access_token,
    expiresAt: Date.now() + expiresIn * 1000,
    pending: null,
  };
  return tokenCache.token;
}

async function getAccessToken() {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt - TOKEN_SAFETY_MS) {
    return tokenCache.token;
  }
  if (!tokenCache.pending) {
    tokenCache.pending = requestAccessToken().catch(error => {
      tokenCache.pending = null;
      throw error;
    });
  }
  return tokenCache.pending;
}

async function googleGet(url) {
  const token = await getAccessToken();
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload && payload.error && payload.error.message
      ? payload.error.message
      : `HTTP ${response.status}`;
    throw new Error(`Google Sheets API: ${message}`);
  }
  return payload;
}

function escapeSheetTitle(title) {
  return String(title || '').replace(/'/g, "''");
}

function valuesToObjects(values) {
  const table = Array.isArray(values) ? values : [];
  const headers = (table[0] || []).map(value => String(value === undefined ? '' : value).trim());
  const rows = table.slice(1).map(valuesRow => {
    const obj = {};
    headers.forEach((header, index) => {
      if (!header) return;
      const value = valuesRow[index] === undefined || valuesRow[index] === null
        ? ''
        : String(valuesRow[index]).trim();
      if (!(header in obj) || obj[header] === '') obj[header] = value;
    });
    return obj;
  }).filter(row => Object.values(row).some(value => String(value).trim() !== ''));
  return { headers, rows };
}

async function fetchSheetByName(sheetId, sheetName) {
  const safeTitle = escapeSheetTitle(sheetName);
  const range = `'${safeTitle}'!A:ZZZ`;
  const url = `${SHEETS_API}/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(range)}` +
    '?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE';
  const payload = await googleGet(url);
  return valuesToObjects(payload.values || []);
}

async function getSheetMetadata(sheetId) {
  const cached = metadataCache.get(sheetId);
  if (cached && Date.now() - cached.at < METADATA_CACHE_MS) return cached.map;

  const url = `${SHEETS_API}/${encodeURIComponent(sheetId)}` +
    '?fields=' + encodeURIComponent('sheets(properties(sheetId,title))');
  const payload = await googleGet(url);
  const map = new Map();
  (payload.sheets || []).forEach(item => {
    const props = item && item.properties || {};
    if (props.sheetId === undefined || !props.title) return;
    map.set(String(props.sheetId), String(props.title));
  });
  metadataCache.set(sheetId, { at: Date.now(), map });
  return map;
}

async function fetchSheetByGid(sheetId, gid) {
  const map = await getSheetMetadata(sheetId);
  const title = map.get(String(gid));
  if (!title) throw new Error(`Nie znaleziono zakladki o GID ${gid} w arkuszu ${sheetId}.`);
  return fetchSheetByName(sheetId, title);
}

function csvCell(value) {
  const text = String(value === undefined || value === null ? '' : value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function stringifyCsv(headers, rows) {
  const lines = [headers.map(csvCell).join(',')];
  rows.forEach(row => lines.push(headers.map(header => csvCell(row[header])).join(',')));
  return lines.join('\n');
}

function normalizeGoogleId(value) {
  return String(value || '').replace(/[^0-9]/g, '');
}

function normalizeMetaId(value) {
  return String(value || '').trim().replace(/^act_/i, '').replace(/[^0-9]/g, '');
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isActive(value) {
  return ['TAK', 'YES', 'TRUE', '1'].includes(String(value || '').trim().toUpperCase());
}

function serviceAccountEmail() {
  try { return getCredentials().email; }
  catch (_) { return String(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim(); }
}

module.exports = {
  IDS,
  fetchSheetByGid,
  fetchSheetByName,
  getSheetMetadata,
  isActive,
  normalizeEmail,
  normalizeGoogleId,
  normalizeMetaId,
  serviceAccountEmail,
  stringifyCsv,
};
