const { IDS, fetchSheetByName, isActive, normalizeEmail } = require('./sheets');

const USERS_SHEET_NAME = 'Użytkownicy';
const CACHE_MS = 60 * 1000;
let cache = { at: 0, users: [] };

async function loadUsers(req) {
  if (Date.now() - cache.at < CACHE_MS && cache.users.length) return cache.users;

  const { rows } = await fetchSheetByName(IDS.config, USERS_SHEET_NAME, req);
  const users = rows.map(row => ({
    email: normalizeEmail(row['Email']),
    name: String(row['Użytkownik'] || '').trim(),
    role: String(row['Rola'] || '').trim(),
    team: String(row['Team'] || '').trim(),
    active: isActive(row['Aktywne']),
  })).filter(user => user.email);

  cache = { at: Date.now(), users };
  return users;
}

async function getActiveUserByEmail(email, req) {
  const normalized = normalizeEmail(email);
  const users = await loadUsers(req);
  const user = users.find(item => item.email === normalized);
  if (!user || !user.active) return null;
  return user;
}

module.exports = { getActiveUserByEmail, loadUsers };
