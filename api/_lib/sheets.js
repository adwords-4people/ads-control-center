const DEFAULT_CONFIG_SHEET_ID = '1fy9NxgD9G52lRRie4Br9L-Y_VRVseZ4ksFmH32t5v8M';
const DEFAULT_GOOGLE_DATA_SHEET_ID = '1_CMt0tZhGqT3y6wp5tTpetU7GtNtt2bKkzERg2iLNhw';
const DEFAULT_META_DATA_SHEET_ID = '1_GCw4RqECUNeKisRNXSpb0ekcz1IQNxgb180ymexLOU';

const IDS = Object.freeze({
  config: process.env.CONFIG_SHEET_ID || DEFAULT_CONFIG_SHEET_ID,
  google: process.env.GOOGLE_DATA_SHEET_ID || DEFAULT_GOOGLE_DATA_SHEET_ID,
  meta: process.env.META_DATA_SHEET_ID || DEFAULT_META_DATA_SHEET_ID,
});

const STS_URL = 'https://sts.googleapis.com/v1/token';
const IAM_CREDENTIALS_API = 'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts';
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const CLOUD_SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const TOKEN_SAFETY_MS = 2 * 60 * 1000;
const METADATA_CACHE_MS = 5 * 60 * 1000;

let tokenCache = { token: '', expiresAt: 0, pending: null };
const metadataCache = new Map();

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
  tokenCache = {
    token: payload.accessToken,
    expiresAt: Number.isFinite(parsedExpiry) ? parsedExpiry : Date.now() + 55 * 60 * 1000,
    pending: null,
  };
  return tokenCache.token;
}

async function getAccessToken(req) {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt - TOKEN_SAFETY_MS) return tokenCache.token;
  if (!tokenCache.pending) {
    tokenCache.pending = impersonateServiceAccount(req).catch(error => {
      tokenCache.pending = null;
      throw error;
    });
  }
  return tokenCache.pending;
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

async function fetchSheetByName(sheetId, sheetName, req) {
  const safeTitle = escapeSheetTitle(sheetName);
  const range = `'${safeTitle}'!A:ZZZ`;
  const url = `${SHEETS_API}/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(range)}` +
    '?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING';
  const payload = await googleGet(url, req);
  return valuesToObjects(payload.values || []);
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
  return String(process.env.GCP_SERVICE_ACCOUNT_EMAIL || '').trim();
}

function oidcInfo() {
  const cfg = getOidcConfig();
  return {
    projectId: cfg.projectId,
    projectNumber: cfg.projectNumber,
    serviceAccountEmail: cfg.serviceAccountEmail,
    poolId: cfg.poolId,
    providerId: cfg.providerId,
  };
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
  oidcInfo,
  serviceAccountEmail,
  stringifyCsv,
};
