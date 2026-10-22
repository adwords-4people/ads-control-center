const DEFAULT_CONFIG_SHEET_ID = '1fy9NxgD9G52lRRie4Br9L-Y_VRVseZ4ksFmH32t5v8M';
const DEFAULT_GOOGLE_DATA_SHEET_ID = '1_CMt0tZhGqT3y6wp5tTpetU7GtNtt2bKkzERg2iLNhw';
const DEFAULT_META_DATA_SHEET_ID = '1_GCw4RqECUNeKisRNXSpb0ekcz1IQNxgb180ymexLOU';

const IDS = Object.freeze({
  config: process.env.CONFIG_SHEET_ID || DEFAULT_CONFIG_SHEET_ID,
  google: process.env.GOOGLE_DATA_SHEET_ID || DEFAULT_GOOGLE_DATA_SHEET_ID,
  meta: process.env.META_DATA_SHEET_ID || DEFAULT_META_DATA_SHEET_ID,
});

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const src = String(text || '').replace(/^\uFEFF/, '');

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell.length || row.length || src.endsWith(',')) {
    row.push(cell.replace(/\r$/, ''));
    rows.push(row);
  }
  return rows.filter(r => r.some(v => String(v).trim() !== ''));
}

function toObjects(table) {
  const headers = (table[0] || []).map(v => String(v || '').trim());
  const rows = table.slice(1).map(values => {
    const obj = {};
    headers.forEach((header, index) => {
      if (!header) return;
      const value = values[index] === undefined ? '' : String(values[index]).trim();
      if (!(header in obj) || obj[header] === '') obj[header] = value;
    });
    return obj;
  }).filter(row => Object.values(row).some(v => String(v).trim() !== ''));
  return { headers, rows };
}

function csvCell(value) {
  const text = String(value === undefined || value === null ? '' : value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function stringifyCsv(headers, rows) {
  const lines = [headers.map(csvCell).join(',')];
  rows.forEach(row => lines.push(headers.map(h => csvCell(row[h])).join(',')));
  return lines.join('\n');
}

async function fetchText(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Google Sheets HTTP ${response.status}.`);
  return response.text();
}

async function fetchSheetByName(sheetId, sheetName) {
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}&_ts=${Date.now()}`;
  return toObjects(parseCsv(await fetchText(url)));
}

async function fetchSheetByGid(sheetId, gid) {
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${encodeURIComponent(gid)}&_ts=${Date.now()}`;
  return toObjects(parseCsv(await fetchText(url)));
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

module.exports = {
  IDS,
  fetchSheetByGid,
  fetchSheetByName,
  isActive,
  normalizeEmail,
  normalizeGoogleId,
  normalizeMetaId,
  stringifyCsv,
};
