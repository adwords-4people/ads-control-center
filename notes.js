// ═══════════════════════════════════════════════════════
//  DZIENNIK — /api/notes
// ═══════════════════════════════════════════════════════
const NOTE_TYPES = Object.freeze(['Optymalizacja Duża', 'Optymalizacja Mała', 'Inne']);

function applyNotesReadOnlyState() {
  const previewing = Boolean(window.AUTH_SESSION && window.AUTH_SESSION.previewing);
  const platform = document.getElementById('notePlatforma');
  const account = document.getElementById('noteKonto');
  const type = document.getElementById('noteType');
  const text = document.getElementById('noteTresc');
  const button = document.getElementById('saveNoteBtn');
  [platform, type, text, button].forEach(el => { if (el) el.disabled = previewing; });
  if (account && previewing) account.disabled = true;
  if (previewing) {
    const feedback = document.getElementById('formFeedback');
    if (feedback) {
      feedback.textContent = 'Tryb podglądu — Dziennik jest tylko do odczytu.';
      feedback.className = 'form-feedback';
    }
  }
  return previewing;
}

function formatNoteDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return '—';
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toLocaleString('pl-PL', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  }
  return raw;
}

function noteAccountKey(platform, id) {
  return `${String(platform || '').trim()}|${String(id || '').replace(/[^0-9]/g, '')}`;
}

function accountOptionsForPlatform(platform) {
  const isMeta = platform === 'Meta Ads';
  const list = isMeta ? META_KONTA : GOOGLE_KONTA;
  const map = isMeta ? (DATA._nameToIdMeta || {}) : (DATA._nameToId || {});
  return (list || []).map(name => ({ name, id: String(map[name] || '').replace(/[^0-9]/g, '') }))
    .filter(item => item.name && item.id);
}

async function refreshNotatki(options) {
  const opts = options || {};
  notesLoading = true;
  if (!opts.silent) renderNotesList();
  try {
    const response = await fetch('/api/notes', {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    NOTES = Array.isArray(payload.notes) ? payload.notes : [];
  } catch (error) {
    console.warn('[Dziennik] Błąd pobierania notatek:', error);
    if (!opts.silent) showToast('Błąd Dziennika: ' + error.message, 'err');
  } finally {
    notesLoading = false;
  }
  renderNotesList();
  applyNotesReadOnlyState();
}

async function saveNote() {
  if (applyNotesReadOnlyState()) { showToast('Tryb podglądu jest tylko do odczytu.', 'err'); return; }
  const platform = document.getElementById('notePlatforma').value.trim();
  const accountSelect = document.getElementById('noteKonto');
  const accountId = String(accountSelect.value || '').trim();
  const selected = accountSelect.options[accountSelect.selectedIndex];
  const accountName = selected ? String(selected.dataset.name || selected.textContent || '').trim() : '';
  const type = document.getElementById('noteType').value.trim();
  const text = document.getElementById('noteTresc').value.trim();

  if (!platform) { showFeedback('Wybierz platformę.', 'err'); return; }
  if (!accountId) { showFeedback('Wybierz konto.', 'err'); return; }
  if (!NOTE_TYPES.includes(type)) { showFeedback('Wybierz typ notatki.', 'err'); return; }
  if (!text) { showFeedback('Wpisz opis zmiany.', 'err'); return; }

  const btn = document.getElementById('saveNoteBtn');
  btn.disabled = true;
  btn.classList.add('saving');

  try {
    const response = await fetch('/api/notes', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ platform, accountId, accountName, type, text }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);

    document.getElementById('noteTresc').value = '';
    document.getElementById('noteType').value = 'Optymalizacja Duża';
    showFeedback('Notatka zapisana.', 'ok');
    showToast('Notatka zapisana ✓', 'ok');
    await refreshNotatki({ silent: true });
  } catch (error) {
    showFeedback('Błąd zapisu: ' + error.message, 'err');
    showToast('Błąd: ' + error.message, 'err');
  } finally {
    btn.disabled = false;
    btn.classList.remove('saving');
  }
}

let pendingDeleteId = null;
function confirmDelete(id, konto, data) {
  pendingDeleteId = id;
  document.getElementById('confirmDesc').textContent =
    `Usunąć notatkę konta „${konto}” z ${data}? Zniknie z Dziennika, ale wpis audytowy pozostanie w arkuszu.`;
  document.getElementById('confirmOverlay').classList.add('show');
  document.getElementById('confirmOkBtn').onclick = () => executeDelete(id);
}
function closeConfirm() {
  document.getElementById('confirmOverlay').classList.remove('show');
  pendingDeleteId = null;
}

async function executeDelete(id) {
  closeConfirm();
  const safeId = String(id || '').trim();
  if (!safeId) { showToast('Nieprawidłowy identyfikator notatki.', 'err'); return; }

  try {
    const response = await fetch('/api/notes?id=' + encodeURIComponent(safeId), {
      method: 'DELETE',
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    NOTES = NOTES.filter(note => String(note.id) !== safeId);
    showToast('Notatka usunięta.', 'ok');
    renderNotesList();
  } catch (error) {
    showToast('Błąd usuwania: ' + error.message, 'err');
  }
}

function renderNotesList() {
  const listEl = document.getElementById('notesList');
  if (!listEl) return;
  if (notesLoading) {
    listEl.innerHTML = '<div class="notes-loading"><div class="spinner"></div> Ładowanie notatek…</div>';
    return;
  }

  const accountKey = document.getElementById('dzFilterKonto').value;
  const platform = document.getElementById('dzFilterPlatforma').value;
  const type = document.getElementById('dzFilterType').value;
  const search = (document.getElementById('dzSearch').value || '').toLowerCase().trim();

  const filtered = NOTES.filter(note => {
    const noteKey = noteAccountKey(note.platform, note.accountId);
    if (accountKey && noteKey !== accountKey) return false;
    if (platform && note.platform !== platform) return false;
    if (type && note.type !== type) return false;
    if (search) {
      const haystack = [note.text, note.accountName, note.author, note.type].join(' ').toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });

  const countEl = document.getElementById('notesCount');
  if (countEl) {
    countEl.textContent = filtered.length === NOTES.length
      ? `${NOTES.length} ${plural(NOTES.length, 'notatka', 'notatki', 'notatek')}`
      : `${filtered.length} z ${NOTES.length} ${plural(filtered.length, 'notatka', 'notatki', 'notatek')}`;
  }

  if (!filtered.length) {
    listEl.innerHTML = `<div class="notes-empty">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
      <p>${NOTES.length === 0 ? 'Brak notatek — dodaj pierwszą zmianę.' : 'Brak wyników dla wybranych filtrów.'}</p>
    </div>`;
    return;
  }

  listEl.innerHTML = '<div class="notes-list">' + filtered.map(note => {
    const typeClass = note.type === 'Optymalizacja Duża' ? 'large' : note.type === 'Optymalizacja Mała' ? 'small' : 'other';
    const deleteButton = note.canDelete
      ? '<button class="note-del-btn" data-id="' + escHtml(note.id) + '" data-konto="' + escHtml(note.accountName) + '" data-data="' + escHtml(formatNoteDate(note.createdAt)) + '" onclick="confirmDeleteFromBtn(this)" title="Usuń notatkę">Usuń</button>'
      : '';
    return '<div class="note-card">' +
      '<div class="note-card-top">' +
        '<span class="note-date">' + escHtml(formatNoteDate(note.createdAt)) + '</span>' +
        '<span class="note-konto-badge">' + escHtml(note.accountName || note.accountId) + '</span>' +
        '<span class="note-platforma-badge ' + platformaClass(note.platform) + '">' + escHtml(note.platform || '—') + '</span>' +
        '<span class="note-type-badge ' + typeClass + '">' + escHtml(note.type || 'Inne') + '</span>' +
        '<div class="note-actions">' + deleteButton + '</div>' +
      '</div>' +
      '<div class="note-entry"><span class="note-entry-text">' + escHtml(note.text || '') + '</span></div>' +
      '<div class="note-author">' + escHtml(note.author || note.authorEmail || '—') + '</div>' +
    '</div>';
  }).join('') + '</div>';
}

function confirmDeleteFromBtn(el) {
  confirmDelete(el.dataset.id, el.dataset.konto, el.dataset.data);
}

function plural(n, one, few, many) {
  if (n === 1) return one;
  if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) return few;
  return many;
}
function platformaClass(platform) { return String(platform || '') === 'Meta Ads' ? 'meta' : 'google'; }
function escHtml(s) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
