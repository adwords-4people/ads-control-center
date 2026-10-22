const DEFAULT_CONFIG_SHEET_ID = '1fy9NxgD9G52lRRie4Br9L-Y_VRVseZ4ksFmH32t5v8M';
const USERS_SHEET_NAME = 'Użytkownicy';
const CACHE_MS = 60 * 1000;
let cache = { at: 0, users: [] };

function normalizeHeader(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
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
  if (cell.length || row.length) {
    row.push(cell.replace(/\r$/, ''));
    rows.push(row);
  }
  return rows;
}

function isActive(value) {
  return ['TAK', 'YES', 'TRUE', '1'].includes(String(value || '').trim().toUpperCase());
}

async function loadUsers() {
  if (Date.now() - cache.at < CACHE_MS && cache.users.length) return cache.users;

  const sheetId = process.env.CONFIG_SHEET_ID || DEFAULT_CONFIG_SHEET_ID;
  const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(USERS_SHEET_NAME)}&_ts=${Date.now()}`;
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Nie udało się odczytać zakładki ${USERS_SHEET_NAME}: HTTP ${response.status}.`);

  const rows = parseCsv(await response.text());
  if (rows.length < 2) return [];

  const headers = rows[0].map(normalizeHeader);
  const idx = (name) => headers.indexOf(normalizeHeader(name));
  const emailIdx = idx('Email');
  const nameIdx = idx('Użytkownik');
  const roleIdx = idx('Rola');
  const teamIdx = idx('Team');
  const activeIdx = idx('Aktywne');

  if ([emailIdx, nameIdx, roleIdx, teamIdx, activeIdx].some(i => i < 0)) {
    throw new Error('Zakładka Użytkownicy ma nieprawidłowe nagłówki. Oczekiwane: Email, Użytkownik, Rola, Team, Aktywne.');
  }

  const users = rows.slice(1).map(row => ({
    email: String(row[emailIdx] || '').trim().toLowerCase(),
    name: String(row[nameIdx] || '').trim(),
    role: String(row[roleIdx] || '').trim(),
    team: String(row[teamIdx] || '').trim(),
    active: isActive(row[activeIdx]),
  })).filter(user => user.email);

  cache = { at: Date.now(), users };
  return users;
}

async function getActiveUserByEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  const users = await loadUsers();
  const user = users.find(item => item.email === normalized);
  if (!user || !user.active) return null;
  return user;
}

module.exports = { getActiveUserByEmail };
