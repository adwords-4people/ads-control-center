const { GoogleAuth } = require('google-auth-library');

const DEFAULT_CONFIG_SHEET_ID = '1fy9NxgD9G52lRRie4Br9L-Y_VRVseZ4ksFmH32t5v8M';
const DEFAULT_GOOGLE_DATA_SHEET_ID = '1_CMt0tZhGqT3y6wp5tTpetU7GtNtt2bKkzERg2iLNhw';
const DEFAULT_META_DATA_SHEET_ID = '1_GCw4RqECUNeKisRNXSpb0ekcz1IQNxgb180ymexLOU';
const DEFAULT_NOTES_SHEET_ID = '1nIQK_G-4iqgtFUJfw4XFurfJzR9bhuan3YpilywXtMc';

const IDS = Object.freeze({
  config: process.env.CONFIG_SHEET_ID || DEFAULT_CONFIG_SHEET_ID,
  google: process.env.GOOGLE_DATA_SHEET_ID || DEFAULT_GOOGLE_DATA_SHEET_ID,
  meta: process.env.META_DATA_SHEET_ID || DEFAULT_META_DATA_SHEET_ID,
  notes: process.env.NOTES_SHEET_ID || DEFAULT_NOTES_SHEET_ID,
});

const STS_URL = 'https://sts.googleapis.com/v1/token';
const IAM_CREDENTIALS_API = 'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts';
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const CLOUD_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const TOKEN_SAFETY_MS = 2 * 60 * 1000;
const METADATA_CACHE_MS = 5 * 60 * 1000;
const DEFAULT_SERVICE_ACCOUNT_EMAIL =
  'ppc-control-center-sheets@ppc-control-center-512313.iam.gserviceaccount.com';

let vercelTokenCache = { token: '', expiresAt: 0, pending: null };
const metadataCache = new Map();
const googleAuth = new GoogleAuth({ scopes: [SHEETS_SCOPE] });

function requireEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`Brak ${name} w Environment Variables.`);
  return value;
}

function getOidcConfig() {
  return {
    projectId: requireEnv('GCP_PROJECT_ID'),
    projectNumber: requireEnv('GCP_PROJECT_NUMBER'),
    serviceAccountEmail: requireEnv('GCP_SERVICE_ACCOUNT_EMAIL'),
    poolId: requireEnv('GCP_WORKLOAD_IDENTITY_POOL_ID'),
    providerId: requireEnv('GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID'),
  };
}

function getRequestHeader(req, name) {
  if (!req || !req.headers) return '';
  if (typeof req.headers.get === 'function') return String(req.headers.get(name) || '').trim();
  const lower = name.toLowerCase();
  const raw = req.headers[lower] ?? req.headers[name] ?? '';
  return Array.isArray(raw) ? String(raw[0] || '').trim() : String(raw || '').trim();
}

function isVercelRuntime(req) {
  if (String(process.env.VERCEL || '').trim()) return true;
  if (String(process.env.VERCEL_ENV || '').trim()) return true;
  return Boolean(
    getRequestHeader(req, 'x-vercel-oidc-token') ||
    String(process.env.VERCEL_OIDC_TOKEN || '').trim()
  );
}

function getVercelOidcToken(req) {
  const token = getRequestHeader(req, 'x-vercel-oidc-token') || String(process.env.VERCEL_OIDC_TOKEN || '').trim();
  if (!token) {
    throw new Error('Brak tokenu Vercel OIDC. Sprawdz Settings -> Security -> OIDC Federation i wykonaj nowy deployment.');
  }
  return token;
}

async function exchangeVercelToken(req) {
  const cfg = getOidcConfig();
  const subjectToken = getVercelOidcToken(req);
  const audience = `//iam.googleapis.com/projects/${cfg.projectNumber}/locations/global/workloadIdentityPools/${cfg.poolId}/providers/${cfg.providerId}`;

  const response = await fetch(STS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      audience,
      requested_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      scope: CLOUD_SCOPE,
      subject_token_type: 'urn:ietf:params:oauth:token-type:jwt',
      subject_token: subjectToken,
    }),
    cache: 'no-store',
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    const details = payload.error_description || payload.error || `HTTP ${response.status}`;
    throw new Error(`Google STS odrzucil token Vercel OIDC: ${details}`);
  }
  return payload.access_token;
}

async function impersonateServiceAccount(req) {
  const cfg = getOidcConfig();
  const federatedToken = await exchangeVercelToken(req);
  const url = `${IAM_CREDENTIALS_API}/${encodeURIComponent(cfg.serviceAccountEmail)}:generateAccessToken`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${federatedToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ scope: [SHEETS_SCOPE], lifetime: '3600s' }),
    cache: 'no-store',
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.accessToken) {
    const details = payload && payload.error && payload.error.message
      ? payload.error.message
      : `HTTP ${response.status}`;
    throw new Error(`Nie udalo sie przejac tozsamosci konta uslugi: ${details}`);
  }

  const parsedExpiry = Date.parse(payload.expireTime || '');
  vercelTokenCache = {
    token: payload.accessToken,
    expiresAt: Number.isFinite(parsedExpiry) ? parsedExpiry : Date.now() + 55 * 60 * 1000,
    pending: null,
  };
  return vercelTokenCache.token;
}

async function getVercelAccessToken(req) {
  if (vercelTokenCache.token && Date.now() < vercelTokenCache.expiresAt - TOKEN_SAFETY_MS) {
    return vercelTokenCache.token;
  }
  if (!vercelTokenCache.pending) {
    vercelTokenCache.pending = impersonateServiceAccount(req).catch(error => {
      vercelTokenCache.pending = null;
      throw error;
    });
  }
  return vercelTokenCache.pending;
}

async function getCloudRunAccessToken() {
  const client = await googleAuth.getClient();
  const result = await client.getAccessToken();
  const token = typeof result === 'string' ? result : result && result.token;
  if (!token) {
    throw new Error('Nie udalo sie pobrac tokenu Google przez Cloud Run Application Default Credentials.');
  }
  return token;
}

async function getAccessToken(req) {
  return isVercelRuntime(req)
    ? getVercelAccessToken(req)
    : getCloudRunAccessToken();
}

async function googleGet(url, req) {
  const token = await getAccessToken(req);
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

async function googleWrite(url, req, method, body) {
  const token = await getAccessToken(req);
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload && payload.error && payload.error.message
      ? payload.error.message
      : `HTTP ${response.status}`;
    throw new Error(`Google Sheets API zapis: ${message}`);
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

function valuesToObjectsWithRowNumbers(values) {
  const table = Array.isArray(values) ? values : [];
  const headers = (table[0] || []).map(value => String(value === undefined ? '' : value).trim());
  const rows = table.slice(1).map((valuesRow, offset) => {
    const obj = {};
    headers.forEach((header, index) => {
      if (!header) return;
      const value = valuesRow[index] === undefined || valuesRow[index] === null
        ? ''
        : String(valuesRow[index]).trim();
      if (!(header in obj) || obj[header] === '') obj[header] = value;
    });
    Object.defineProperty(obj, '__rowNumber', { value: offset + 2, enumerable: false });
    return obj;
  }).filter(row => Object.values(row).some(value => String(value).trim() !== ''));
  return { headers, rows };
}

async function fetchSheetByName(sheetId, sheetName, req) {
  const safeTitle = escapeSheetTitle(sheetName);
  const range = `'${safeTitle}'!A:ZZZ`;
  const url = `${SHEETS_API}/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(range)}` +
    '?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING';
  const payload = await googleGet(url, req);
  return valuesToObjects(payload.values || []);
}


async function fetchSheetsByName(sheetId, sheetNames, req) {
  const names = [...new Set((sheetNames || []).map(name => String(name || '').trim()).filter(Boolean))];
  if (!names.length) return new Map();

  const params = new URLSearchParams({
    majorDimension: 'ROWS',
    valueRenderOption: 'FORMATTED_VALUE',
    dateTimeRenderOption: 'FORMATTED_STRING',
  });
  names.forEach(name => params.append('ranges', `'${escapeSheetTitle(name)}'!A:ZZZ`));

  const url = `${SHEETS_API}/${encodeURIComponent(sheetId)}/values:batchGet?${params.toString()}`;
  const payload = await googleGet(url, req);
  const result = new Map();
  const valueRanges = Array.isArray(payload.valueRanges) ? payload.valueRanges : [];

  names.forEach((name, index) => {
    const item = valueRanges[index] || {};
    result.set(name, valuesToObjects(item.values || []));
  });
  return result;
}

async function getSheetMetadata(sheetId, req) {
  const cached = metadataCache.get(sheetId);
  if (cached && Date.now() - cached.at < METADATA_CACHE_MS) return cached.map;

  const url = `${SHEETS_API}/${encodeURIComponent(sheetId)}` +
    '?fields=' + encodeURIComponent('sheets(properties(sheetId,title))');
  const payload = await googleGet(url, req);
  const map = new Map();
  (payload.sheets || []).forEach(item => {
    const props = item && item.properties || {};
    if (props.sheetId === undefined || !props.title) return;
    map.set(String(props.sheetId), String(props.title));
  });
  metadataCache.set(sheetId, { at: Date.now(), map });
  return map;
}

async function fetchSheetByGid(sheetId, gid, req) {
  const map = await getSheetMetadata(sheetId, req);
  const title = map.get(String(gid));
  if (!title) throw new Error(`Nie znaleziono zakladki o GID ${gid} w arkuszu ${sheetId}.`);
  return fetchSheetByName(sheetId, title, req);
}

async function fetchSheetByNameWithRowNumbers(sheetId, sheetName, req) {
  const safeTitle = escapeSheetTitle(sheetName);
  const range = `'${safeTitle}'!A:ZZZ`;
  const url = `${SHEETS_API}/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(range)}` +
    '?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING';
  const payload = await googleGet(url, req);
  return valuesToObjectsWithRowNumbers(payload.values || []);
}

async function fetchSheetByGidWithRowNumbers(sheetId, gid, req) {
  const map = await getSheetMetadata(sheetId, req);
  const title = map.get(String(gid));
  if (!title) throw new Error(`Nie znaleziono zakladki o GID ${gid} w arkuszu ${sheetId}.`);
  return fetchSheetByNameWithRowNumbers(sheetId, title, req);
}

async function setSheetRowValues(sheetId, sheetName, rowNumber, values, req) {
  const safeTitle = escapeSheetTitle(sheetName);
  const endCol = String.fromCharCode(64 + values.length);
  const range = `'${safeTitle}'!A${rowNumber}:${endCol}${rowNumber}`;
  const url = `${SHEETS_API}/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
  return googleWrite(url, req, 'PUT', { range, majorDimension: 'ROWS', values: [values] });
}

async function appendSheetValues(sheetId, sheetName, values, req) {
  const safeTitle = escapeSheetTitle(sheetName);
  const range = `'${safeTitle}'!A:ZZZ`;
  const url = `${SHEETS_API}/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
  return googleWrite(url, req, 'POST', { majorDimension: 'ROWS', values: [values] });
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
  return String(
    process.env.GCP_SERVICE_ACCOUNT_EMAIL ||
    DEFAULT_SERVICE_ACCOUNT_EMAIL
  ).trim();
}

function oidcInfo() {
  if (isVercelRuntime()) {
    const cfg = getOidcConfig();
    return {
      projectId: cfg.projectId,
      projectNumber: cfg.projectNumber,
      serviceAccountEmail: cfg.serviceAccountEmail,
      poolId: cfg.poolId,
      providerId: cfg.providerId,
      runtime: 'vercel-oidc',
    };
  }

  return {
    projectId:
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.GCP_PROJECT_ID ||
      'ppc-control-center-512313',
    projectNumber:
      process.env.GCP_PROJECT_NUMBER ||
      '515371390885',
    serviceAccountEmail: serviceAccountEmail(),
    poolId: '',
    providerId: '',
    runtime: 'cloud-run-adc',
  };
}

module.exports = {
  IDS,
  appendSheetValues,
  fetchSheetByGid,
  fetchSheetByGidWithRowNumbers,
  fetchSheetByName,
  fetchSheetsByName,
  getSheetMetadata,
  isActive,
  normalizeEmail,
  normalizeGoogleId,
  normalizeMetaId,
  oidcInfo,
  serviceAccountEmail,
  setSheetRowValues,
  stringifyCsv,
};
