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

const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const METADATA_CACHE_MS = 5 * 60 * 1000;

const DEFAULT_SERVICE_ACCOUNT_EMAIL =
  'ppc-control-center-sheets@ppc-control-center-512313.iam.gserviceaccount.com';

const googleAuth = new GoogleAuth({
  scopes: [SHEETS_SCOPE],
});

const metadataCache = new Map();
async function getAccessToken() {
  const client = await googleAuth.getClient();
  const result = await client.getAccessToken();

  const token = typeof result === 'string'
    ? result
    : result && result.token;

  if (!token) {
    throw new Error(
      'Nie udało się pobrać tokenu Google przez Cloud Run Application Default Credentials.'
    );
  }

  return token;
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
