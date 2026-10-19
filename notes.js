//  DZIENNIK — API
// ═══════════════════════════════════════════════════════
// Mapuje surowe wiersze arkusza "Notatki" (ID, Data, Konto, Platforma, Treść) na format używany w UI,
// posortowane od najnowszych (po dacie DD.MM.YYYY).
function parseNoteDate(s) {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec((s||'').trim());
  return m ? new Date(+m[3], +m[2]-1, +m[1]).getTime() : 0;
}
function mapNotatkiRows(rows) {
  return (rows || []).map(r => ({
    id: r['ID'] || '',
    data: r['Data'] || '',
    konto: r['Konto'] || '',
    platforma: r['Platforma'] || '',
    tresc: r['Treść'] || '',
  })).sort((a,b) => parseNoteDate(b.data) - parseNoteDate(a.data));
}

// Odświeża tylko arkusz Notatki (np. po zapisie/usunięciu przez Web App) bez przeładowania całego dashboardu
async function refreshNotatki() {
  notesLoading = true;
  renderNotesList();
  try {
    const rows = await fetchCsvByName(SHEET_ID, SHEET_NAMES.notatki, undefined);
    DATA.notatki = rows;
    NOTES = mapNotatkiRows(rows);
  } catch(e) {
    console.warn('[Dziennik] Błąd odświeżania notatek:', e);
  } finally {
    notesLoading = false;
  }
  renderNotesList();
  renderOverview();
  renderMetaOverview();
}

async function saveNote() {
  if (!WEBAPP_URL) { showToast('Ustaw WEBAPP_URL w kodzie dashboardu.','err'); return; }
  const platforma = document.getElementById('notePlatforma').value.trim();
  const konto     = document.getElementById('noteKonto').value.trim();
  const tresc     = document.getElementById('noteTresc').value.trim();
  if (!platforma) { showFeedback('Wybierz platformę.','err'); return; }
  if (!konto)     { showFeedback('Wybierz konto.','err'); return; }
  if (!tresc)     { showFeedback('Wpisz opis zmiany.','err'); return; }

  const btn = document.getElementById('saveNoteBtn');
  btn.disabled = true;
  btn.classList.add('saving');

  try {
    const r = await fetch(WEBAPP_URL, {
      method: 'POST',
      body: JSON.stringify({ action:'add', konto, platforma, tresc }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status} podczas zapisu`);
    const data = await r.json();
    if (data.status === 'error') throw new Error(data.error);

    document.getElementById('noteTresc').value = '';
    showFeedback('Notatka zapisana.','ok');
    showToast('Notatka zapisana ✓','ok');
    await refreshNotatki();
  } catch(e) {
    showFeedback('Błąd zapisu: '+e.message,'err');
    showToast('Błąd: '+e.message,'err');
  } finally {
    btn.disabled = false;
    btn.classList.remove('saving');
  }
}

let pendingDeleteId = null;
function confirmDelete(id, konto, data) {
  pendingDeleteId = id;
  document.getElementById('confirmDesc').textContent =
    `Usunąć notatkę konta „${konto}" z ${data}? Tej operacji nie można cofnąć.`;
  document.getElementById('confirmOverlay').classList.add('show');
  document.getElementById('confirmOkBtn').onclick = () => executeDelete(id);
}
function closeConfirm() {
  document.getElementById('confirmOverlay').classList.remove('show');
  pendingDeleteId = null;
}

async function executeDelete(id) {
  closeConfirm();
  if (!WEBAPP_URL) return;
  const safeId = String(id || '').trim();
  if (!safeId) { showToast('Nieprawidłowy identyfikator notatki.','err'); return; }

  try {
    const r = await fetch(WEBAPP_URL, {
      method: 'POST',
      body: JSON.stringify({ action:'delete', id: safeId }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status} podczas usuwania`);
    const data = await r.json();
    if (data.status === 'error') throw new Error(data.error);
    NOTES = NOTES.filter(n => String(n.id) !== safeId);
    showToast('Notatka usunięta.','ok');
    renderNotesList();
    renderOverview();
  } catch(e) {
    showToast('Błąd usuwania: '+e.message,'err');
  }
}

// ═══════════════════════════════════════════════════════
//  DZIENNIK — RENDEROWANIE LISTY
// ═══════════════════════════════════════════════════════
function renderNotesList() {
  if (notesLoading) {
    const listEl = document.getElementById('notesList');
    if (listEl) listEl.innerHTML = '<div class="notes-loading"><div class="spinner"></div> Ładowanie notatek…</div>';
    return;
  }

  const fKonto     = document.getElementById('dzFilterKonto').value;
  const fPlatforma = document.getElementById('dzFilterPlatforma').value;
  const fSearch    = (document.getElementById('dzSearch').value||'').toLowerCase().trim();

  let filtered = NOTES.filter(n => {
    const konto = String(n.konto || '');
    const platforma = String(n.platforma || '');
    const tresc = String(n.tresc || '');
    if (fKonto     && konto     !== fKonto)     return false;
    if (fPlatforma && platforma !== fPlatforma) return false;
    if (fSearch && !tresc.toLowerCase().includes(fSearch) && !konto.toLowerCase().includes(fSearch)) return false;
    return true;
  });

  const countEl = document.getElementById('notesCount');
  countEl.textContent = filtered.length === NOTES.length
    ? `${NOTES.length} ${plural(NOTES.length,'notatka','notatki','notatek')}`
    : `${filtered.length} z ${NOTES.length} ${plural(filtered.length,'notatka','notatki','notatek')}`;

  const listEl = document.getElementById('notesList');
  if (!filtered.length) {
    listEl.innerHTML = `<div class="notes-empty">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
      <p>${NOTES.length===0?'Brak notatek — dodaj pierwszą zmianę.':'Brak wyników dla wybranych filtrów.'}</p>
    </div>`;
    return;
  }

  listEl.innerHTML = '<div class="notes-list">' + filtered.map(n => {
    const entries = String(n.tresc || '').split('\n').filter(e => e.trim() !== '');
    const entriesHtml = entries.map(e => {
      const match = e.match(/^\[(\d{2}:\d{2})\]\s*([\s\S]*)/);
      if (match) {
        return '<div class="note-entry"><span class="note-entry-time">' + escHtml(match[1]) + '</span><span class="note-entry-text">' + escHtml(match[2]) + '</span></div>';
      }
      return '<div class="note-entry"><span class="note-entry-text">' + escHtml(e) + '</span></div>';
    }).join('');
    const cnt = entries.length;
    const cntLabel = cnt === 1 ? '1 wpis' : cnt < 5 ? cnt + ' wpisy' : cnt + ' wpisów';
    return '<div class="note-card">' +
      '<div class="note-card-top">' +
        '<span class="note-date">' + escHtml(n.data) + '</span>' +
        '<span class="note-konto-badge">' + escHtml(n.konto) + '</span>' +
        '<span class="note-platforma-badge ' + platformaClass(n.platforma) + '">' + escHtml(n.platforma || '—') + '</span>' +
        '<span class="note-entry-count">' + cntLabel + '</span>' +
        '<div class="note-actions">' +
          '<button class="note-del-btn" data-id="' + escHtml(String(n.id ?? '')) + '" data-konto="' + escHtml(n.konto) + '" data-data="' + escHtml(n.data) + '" onclick="confirmDeleteFromBtn(this)" title="Usuń cały dzień">Usuń</button>' +
        '</div>' +
      '</div>' +
      '<div class="note-entries">' + entriesHtml + '</div>' +
    '</div>';
  }).join('') + '</div>';
}

function confirmDeleteFromBtn(el) {
  confirmDelete(el.dataset.id, el.dataset.konto, el.dataset.data);
}

function plural(n,one,few,many){
  if(n===1) return one;
  if(n%10>=2&&n%10<=4&&(n%100<10||n%100>=20)) return few;
  return many;
}
function platformaClass(platforma) {
  return String(platforma || '') === 'Meta Ads' ? 'meta' : 'google';
}
function escHtml(s){ return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

// ═══════════════════════════════════════════════════════
