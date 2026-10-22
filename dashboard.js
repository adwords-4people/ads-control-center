//  FORMATOWANIE KOMÓREK
// ═══════════════════════════════════════════════════════
// Przyjmuje próg `t` z getThresholds()/getMetaThresholds() — jeśli brak, spada na DEFAULTS (Google).
function statusBadge(val, t) {
  t = t || DEFAULTS;
  const n = parseNum(val);
  const cls = n > t.budzet_max ? 'b-red' : n < t.budzet_min ? 'b-amber' : 'b-green';
  return `<span class="badge ${cls}">${escHtml(val)}</span>`;
}
function ratioBadge(val) {
  const n = parseNum(val);
  const cls = n>=100?'b-green':n>=80?'b-amber':'b-red';
  return `<span class="badge ${cls}">${escHtml(val)}</span>`;
}
// Odznaka ROAS z progami per-konto (roas_amber/roas_red); bez `t` spada na DEFAULTS (systemowe).
function roasBadge(val, t) {
  t = t || DEFAULTS;
  const n = parseNum(val);
  const cls = n >= t.roas_amber ? 'b-green' : n >= t.roas_red ? 'b-amber' : 'b-red';
  return `<span class="badge ${cls}">${escHtml(val)}</span>`;
}
function deltaBadge(val) {
  if (!val||val.trim()==='') return `<span class="delta-flat">—</span>`;
  const n = parseNum(val);
  if (n>5)  return `<span class="delta-up">▲ ${escHtml(val)}</span>`;
  if (n<-5) return `<span class="delta-down">▼ ${escHtml(val)}</span>`;
  return `<span class="delta-flat">${escHtml(val)}</span>`;
}
const RATIO_COLS  = new Set(['Współczynnik kliknięc','Współczynnik kliknięć','Współczynnik wyświetleń','Współczynnik konwersji','Współczynnik Wart konwersji','Porównanie konwersji z poprzednim miesiącem']);
const DELTA_COLS  = new Set([
  'Status kliknięć','Status wyświetleń',
  'Zmiana % Wyświetleń (przedwczoraj → wczoraj)',
  'Zmiana % Wyświetleń (30 dni vs 90 dni→30d)',
  'Zmiana % Zasięgu (30 dni vs 90 dni→30d)',
  'Zmiana % Częstotliwości (30 dni vs 90 dni→30d)',
  'Zmiana % Wyniku (30 dni vs 90 dni→30d)',
]);
const BUDG_COLS   = new Set(['Status','Status budżetu']);
const ROAS_COLS   = new Set(['ROAS']);
// `konto` i `platform` ('google'|'meta') pozwalają dobrać właściwe, per-kontowe progi
// budżetu zamiast sztywnych wartości — patrz statusBadge().

// Pusta komórka i nieprawidłowa wartość to null, natomiast 0 pozostaje zerem.
// W CSV z GAS liczba 20 (lub "20,00%") oznacza 20%, NIE 0,2.
function parseMetaForecastChange(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = String(value).trim().replace(/−/g, '-');
  if (!/^[+-]?(?:\d+(?:[   ]\d{3})*)(?:[.,]\d+)?\s*%?$/.test(text)) return null;
  const n = Number(text.replace(/[\s  %]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function formatMetaForecastChange(value, konto, accountId) {
  const pct = parseMetaForecastChange(value);
  if (pct === null) return '<span class="metric-empty" title="Brak porównania w raporcie miesięcznym">—</span>';
  const t = getMetaThresholds(konto, accountId);
  // Konw_pct_min jest nadal progiem relacji (100 = poziom poprzedniego miesiąca).
  // Przeliczenie dotyczy tylko koloru. Wyświetlamy zmianę z kolumny O, bez przeliczania prognozy.
  const cls = ratioClass(String(100 + pct), t.konw_pct_min, 100);
  const label = (pct > 0 ? '+' : '') + fmtPct(pct);
  return metricText(label, cls);
}

function formatCell(h,val,konto,platform,accountId,bodyId,row) {
  const comparison = comparisonColumnSpec(h, platform, bodyId);
  if (comparison) {
    const value = row ? comparisonCellValue(h, row, platform) : val;
    return formatComparisonMetric(value, comparison.mode, platform, konto, accountId, comparison.inputKind);
  }
  val = val === null || val === undefined ? '' : String(val);
  if (val.trim()==='') return '<span class="metric-empty">—</span>';
  if (platform === 'meta' && h === META_MONTHLY_FIELDS.change) return formatMetaForecastChange(val, konto, accountId);
  if (BUDG_COLS.has(h))  return statusBadge(val, platform === 'meta' ? getMetaThresholds(konto, accountId) : getThresholds(konto));
  if (RATIO_COLS.has(h)) return ratioBadge(val);
  if (DELTA_COLS.has(h)) return deltaBadge(val);
  if (ROAS_COLS.has(h))  return roasBadge(val, platform === 'meta' ? getMetaThresholds(konto, accountId) : getThresholds(konto));
  const isNum = /^-?[\d\s\u00a0]+([,.][\d]+)?%?\s*(zł)?$/.test(val.trim());
  return isNum ? `<span class="mono">${escHtml(val)}</span>` : escHtml(val);
}

// ═══════════════════════════════════════════════════════
//  FILTRY (tabele danych)
// ═══════════════════════════════════════════════════════
function getFilters() {
  return { q: document.getElementById('searchInput').value.toLowerCase().trim() };
}
// Podświetla fragment tekstu pasujący do aktywnego zapytania wyszukiwania (np. w kolumnie Konto)
function highlightMatch(text) {
  const {q} = getFilters();
  const s = String(text ?? '');
  if (!q) return escHtml(s);
  const idx = s.toLowerCase().indexOf(q);
  if (idx === -1) return escHtml(s);
  return escHtml(s.slice(0, idx)) + '<mark class="search-hl">' + escHtml(s.slice(idx, idx + q.length)) + '</mark>' + escHtml(s.slice(idx + q.length));
}
function normalizeRows(rows) {
  return rows.map(r => {
    const konto = (r['Konto']||'').trim();
    return { ...r, konto };
  });
}
function filterRows(rows, platform) {
  const {q} = getFilters();
  return rows.filter(r => !q || (r.konto || '').toLowerCase().includes(q) ||
    (platform === 'meta' && String(r['Nazwa zestawu reklam'] || '').toLowerCase().includes(q)));
}

// ═══════════════════════════════════════════════════════
//  TABELA DYNAMICZNA Z SORTOWANIEM
// ═══════════════════════════════════════════════════════
// Kolumny techniczne (surowe ID), ukrywane domyślnie w tabelach szczegółowych - nie niosą wartości dla przeglądającego
const HIDDEN_COLS = new Set(['ID Konta','MCK_ID','ID Zestawu','Data','Data i godzina aktualizacji']);

// Wspólne nazwy kolumn w UI dla Google Ads i Meta Ads.
// Klucze danych z CSV pozostają bez zmian — ta warstwa zmienia wyłącznie etykiety <th>.
const COMMON_COLUMN_LABELS = Object.freeze({
  'Nazwa zestawu reklam': 'Zestaw reklam',
  'Cel optymalizacji': 'Cel',

  // Audyt / Audyt - wart: krótkie etykiety do szybkiego skanowania tabeli.
  'Kliknięcia (30 dni)': 'Kliknięcia · 30d',
  'Wyświetlenia (30 dni)': 'Wyświetlenia · 30d',
  'Zasięg (30 dni)': 'Zasięg · 30d',
  'Częstotliwość (30 dni)': 'Częstotliwość · 30d',
  'Wynik (30 dni)': 'Wynik · 30d',
  'Konwersje (30 dni)': 'Wynik · 30d',
  'Wartość konwersji (30 dni)': 'Wart. konw. · 30d',
  'Kliknięcia (90 dni → odpowiednik 30-dniowy)': 'Kliknięcia · śr. 90d',
  'Śr. miesięczna kliknięć (na podst. 90 dni)': 'Kliknięcia · śr. 90d',
  'Wyświetlenia (90 dni → odpowiednik 30-dniowy)': 'Wyświetlenia · śr. 90d',
  'Śr. miesięczna wyświetleń (na podst. 90 dni)': 'Wyświetlenia · śr. 90d',
  'Zasięg (90 dni → odpowiednik 30-dniowy)': 'Zasięg · śr. 90d',
  'Wynik (90 dni → odpowiednik 30-dniowy)': 'Wynik · śr. 90d',
  'Śr. miesięczna konwersji (na podst. 90 dni)': 'Wynik · śr. 90d',
  'Śr. miesięczne konwersje (na podst. 90 dni)': 'Wynik · śr. 90d',
  'Wartość konwersji (90 dni → odpowiednik 30-dniowy)': 'Wart. konw. · śr. 90d',
  'Współczynnik kliknięc': 'Kliknięcia · trend',
  'Współczynnik kliknięć': 'Kliknięcia · trend',
  'Współczynnik wyświetleń': 'Wyświetlenia · trend',
  'Współczynnik konwersji': 'Wynik · trend',
  'Współczynnik Wart konwersji': 'Wart. konw. · trend',
  'Zmiana % Wyświetleń (30 dni vs 90 dni→30d)': 'Wyświetlenia · trend',
  'Zmiana % Zasięgu (30 dni vs 90 dni→30d)': 'Zasięg · trend',
  'Zmiana % Częstotliwości (30 dni vs 90 dni→30d)': 'Częstotliwość · trend',
  'Zmiana % Wyniku (30 dni vs 90 dni→30d)': 'Wynik · trend',
  'Zmiana % Wartości konwersji (30 dni vs 90 dni→30d)': 'Wart. konw. · trend',

  // Wyniki / miesięczny
  'Koszt (Miesiąc)': 'Koszt · miesiąc',
  'Kliknięcia (Miesiąc)': 'Kliknięcia · miesiąc',
  'Wyświetlenia (Miesiąc)': 'Wyświetlenia · miesiąc',
  'Zasięg (Miesiąc)': 'Zasięg · miesiąc',
  'Konwersje (Miesiąc)': 'Wynik · miesiąc',
  'Wynik (Miesiąc)': 'Wynik · miesiąc',
  'Prognoza konwersji (cały miesiąc)': 'Prognoza wyniku',
  'Prognoza wyniku (cały miesiąc)': 'Prognoza wyniku',
  'Konwersje (poprzedni miesiąc)': 'Wynik · poprz. mies.',
  'Wynik (poprzedni miesiąc)': 'Wynik · poprz. mies.',
  'Porównanie konwersji z poprzednim miesiącem': 'Zmiana vs poprz. mies.',
  'Zmiana prognozy wyniku vs poprzedni miesiąc (%)': 'Zmiana prognozy',

  // Wartość konwersji
  'Wartość Konwersji (Miesiąc)': 'Wart. konw. · miesiąc',
  'Wartość konwersji (Miesiąc)': 'Wart. konw. · miesiąc',
  'Prognozowana wartość konwersji (cały miesiąc)': 'Prognoza wart. konw.',

  // Anomalia
  'Koszt (wczoraj)': 'Koszt wczoraj',
  'Wyświetlenia (wczoraj)': 'Wyświetlenia wczoraj',
  'Koszt (przedwczoraj)': 'Koszt przedwczoraj',
  'Wyświetlenia (przedwczoraj)': 'Wyświetlenia przedwczoraj',
  'Status kliknięć': 'Kliknięcia · d/d',
  'Status wyświetleń': 'Wyświetlenia · d/d',
  'Zmiana % Wyświetleń (przedwczoraj → wczoraj)': 'Wyświetlenia · d/d',
});

const COMMON_COLUMN_TOOLTIPS = Object.freeze({
  'Kliknięcia (30 dni)': 'Łączna liczba kliknięć z ostatnich 30 dni.',
  'Wyświetlenia (30 dni)': 'Łączna liczba wyświetleń z ostatnich 30 dni.',
  'Zasięg (30 dni)': 'Łączny zasięg z ostatnich 30 dni.',
  'Częstotliwość (30 dni)': 'Średnia częstotliwość z ostatnich 30 dni.',
  'Wynik (30 dni)': 'Wynik osiągnięty w ostatnich 30 dniach.',
  'Konwersje (30 dni)': 'Wynik osiągnięty w ostatnich 30 dniach.',
  'Wartość konwersji (30 dni)': 'Wartość konwersji osiągnięta w ostatnich 30 dniach.',
  'Kliknięcia (90 dni → odpowiednik 30-dniowy)': 'Średnia miesięczna liczba kliknięć wyliczona na podstawie ostatnich 90 dni.',
  'Śr. miesięczna kliknięć (na podst. 90 dni)': 'Średnia miesięczna liczba kliknięć wyliczona na podstawie ostatnich 90 dni.',
  'Wyświetlenia (90 dni → odpowiednik 30-dniowy)': 'Średnia miesięczna liczba wyświetleń wyliczona na podstawie ostatnich 90 dni.',
  'Śr. miesięczna wyświetleń (na podst. 90 dni)': 'Średnia miesięczna liczba wyświetleń wyliczona na podstawie ostatnich 90 dni.',
  'Zasięg (90 dni → odpowiednik 30-dniowy)': 'Średni miesięczny zasięg wyliczony na podstawie ostatnich 90 dni.',
  'Wynik (90 dni → odpowiednik 30-dniowy)': 'Średni miesięczny wynik wyliczony na podstawie ostatnich 90 dni.',
  'Śr. miesięczna konwersji (na podst. 90 dni)': 'Średni miesięczny wynik wyliczony na podstawie ostatnich 90 dni.',
  'Śr. miesięczne konwersje (na podst. 90 dni)': 'Średni miesięczny wynik wyliczony na podstawie ostatnich 90 dni.',
  'Wartość konwersji (90 dni → odpowiednik 30-dniowy)': 'Średnia miesięczna wartość konwersji wyliczona na podstawie ostatnich 90 dni.',
  'Współczynnik kliknięc': 'Porównanie kliknięć z ostatnich 30 dni do średniej miesięcznej z ostatnich 90 dni. 100% oznacza brak zmiany.',
  'Współczynnik kliknięć': 'Porównanie kliknięć z ostatnich 30 dni do średniej miesięcznej z ostatnich 90 dni. 100% oznacza brak zmiany.',
  'Współczynnik wyświetleń': 'Porównanie wyświetleń z ostatnich 30 dni do średniej miesięcznej z ostatnich 90 dni. 100% oznacza brak zmiany.',
  'Współczynnik konwersji': 'Porównanie wyniku z ostatnich 30 dni do średniego miesięcznego wyniku z ostatnich 90 dni. 100% oznacza brak zmiany.',
  'Współczynnik Wart konwersji': 'Porównanie wartości konwersji z ostatnich 30 dni do średniej miesięcznej z ostatnich 90 dni. 100% oznacza brak zmiany.',
  'Zmiana % Wyświetleń (30 dni vs 90 dni→30d)': 'Zmiana wyświetleń z ostatnich 30 dni względem średniej miesięcznej z ostatnich 90 dni. 0% oznacza brak zmiany.',
  'Zmiana % Zasięgu (30 dni vs 90 dni→30d)': 'Zmiana zasięgu z ostatnich 30 dni względem średniej miesięcznej z ostatnich 90 dni. 0% oznacza brak zmiany.',
  'Zmiana % Częstotliwości (30 dni vs 90 dni→30d)': 'Zmiana częstotliwości z ostatnich 30 dni względem średniej miesięcznej z ostatnich 90 dni. 0% oznacza brak zmiany.',
  'Zmiana % Wyniku (30 dni vs 90 dni→30d)': 'Zmiana wyniku z ostatnich 30 dni względem średniego miesięcznego wyniku z ostatnich 90 dni. 0% oznacza brak zmiany.',
  'Zmiana % Wartości konwersji (30 dni vs 90 dni→30d)': 'Zmiana wartości konwersji z ostatnich 30 dni względem średniej miesięcznej z ostatnich 90 dni. 0% oznacza brak zmiany.',
  'Porównanie konwersji z poprzednim miesiącem': 'Zmiana wyniku względem poprzedniego miesiąca.',
  'Zmiana prognozy wyniku vs poprzedni miesiąc (%)': 'Zmiana prognozowanego wyniku całego miesiąca względem wyniku poprzedniego miesiąca. 0% oznacza brak zmiany.',
  'Status kliknięć': 'Zmiana kliknięć dzień do dnia.',
  'Status wyświetleń': 'Zmiana wyświetleń dzień do dnia.',
  'Zmiana % Wyświetleń (przedwczoraj → wczoraj)': 'Zmiana liczby wyświetleń między przedwczoraj a wczoraj.',
  'ROAS': 'Zwrot z wydatków reklamowych.',
  'CPA': 'Średni koszt pozyskania jednego wyniku.',
});

const COLUMN_TOOLTIPS_BY_BODY = Object.freeze({
  wydatkiBody: Object.freeze({
    'Status': 'Prognozowana realizacja budżetu miesiąca względem budżetu skonfigurowanego dla konta.',
    'Status budżetu': 'Prognozowana realizacja budżetu miesiąca względem budżetu skonfigurowanego dla konta.',
    'Prognoza kosztu (cały miesiąc)': 'Prognozowany koszt do końca bieżącego miesiąca.',
  }),
  metaWydatkiBody: Object.freeze({
    'Status': 'Prognozowana realizacja budżetu miesiąca względem budżetu skonfigurowanego dla konta.',
    'Status budżetu': 'Prognozowana realizacja budżetu miesiąca względem budżetu skonfigurowanego dla konta.',
    'Prognoza kosztu (cały miesiąc)': 'Prognozowany koszt do końca bieżącego miesiąca.',
  }),
});

const COLUMN_LABELS_BY_BODY = Object.freeze({
  wydatkiBody: Object.freeze({
    'Koszt (miesiąc, do dziś)': 'Koszt (miesiąc)',
    'Prognoza kosztu (cały miesiąc)': 'Prognoza kosztu',
    'Budżet (z pliku Konfiguracja)': 'Budżet',
    'Status': 'Realizacja budżetu',
    'Status budżetu': 'Realizacja budżetu',
  }),
  metaWydatkiBody: Object.freeze({
    'Koszt (miesiąc, do dziś)': 'Koszt (miesiąc)',
    'Prognoza kosztu (cały miesiąc)': 'Prognoza kosztu',
    'Budżet (z pliku Konfiguracja)': 'Budżet',
    'Status': 'Realizacja budżetu',
    'Status budżetu': 'Realizacja budżetu',
  }),
});

function getColumnLabel(bodyId, header) {
  const local = COLUMN_LABELS_BY_BODY[bodyId];
  if (local && local[header]) return local[header];
  if (COMMON_COLUMN_LABELS[header]) return COMMON_COLUMN_LABELS[header];
  if (bodyId === 'metaMiesiecznyBody' && META_MONTHLY_LABELS[header]) return META_MONTHLY_LABELS[header];
  return header;
}

function getColumnTooltip(bodyId, header) {
  const local = COLUMN_TOOLTIPS_BY_BODY[bodyId];
  if (local && local[header]) return local[header];
  return COMMON_COLUMN_TOOLTIPS[header] || '';
}

// Warstwa prezentacji tabeli: kolumny opisowe czytamy od lewej,
// metryki centrujemy. Klucze CSV i logika formatowania pozostają bez zmian.
const TEXT_COLUMN_HEADERS = new Set(['Konto', 'Nazwa zestawu reklam', 'Cel optymalizacji']);
function getColumnUiClass(header) {
  if (header === 'Konto') return 'col-text col-account';
  if (header === 'Nazwa zestawu reklam') return 'col-text col-adset';
  if (header === 'Cel optymalizacji') return 'col-text col-goal';
  return TEXT_COLUMN_HEADERS.has(header) ? 'col-text' : 'col-metric';
}

function updateMetaStickyTable(bodyId, platform, headers) {
  const bodyEl = document.getElementById(bodyId);
  const table = bodyEl && bodyEl.closest('table');
  if (!table) return;
  const hasIdentityPair = platform === 'meta' && headers[0] === 'Konto' && headers[1] === 'Nazwa zestawu reklam';
  table.classList.toggle('meta-two-sticky', hasIdentityPair);
  table.classList.toggle('table-meta-daily', bodyId === 'metaDziennyBody');
  table.classList.toggle('table-wide-data', headers.length > 6);
}


// ═══════════════════════════════════════════════════════
//  RESIZE KOLUMN + PAMIĘĆ USTAWIEŃ
// ═══════════════════════════════════════════════════════
const COLUMN_WIDTHS_STORAGE_KEY = 'ads-dashboard.column-widths.v1';
const COLUMN_MIN_TEXT = 92;
const COLUMN_MIN_METRIC = 86;
const COLUMN_MAX_AUTOFIT = 460;

function readColumnWidthsStore() {
  try {
    const parsed = JSON.parse(localStorage.getItem(COLUMN_WIDTHS_STORAGE_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    return {};
  }
}

function writeColumnWidthsStore(store) {
  try {
    localStorage.setItem(COLUMN_WIDTHS_STORAGE_KEY, JSON.stringify(store || {}));
  } catch (e) {
    // Brak localStorage nie blokuje ręcznego resize w bieżącej sesji.
  }
}

function tableResizeKey(table, fallbackKey) {
  if (!table) return fallbackKey || '';
  if (fallbackKey) table.dataset.resizeKey = fallbackKey;
  if (table.dataset.resizeKey) return table.dataset.resizeKey;
  const body = table.querySelector('tbody[id]');
  const key = body ? body.id : (table.id || 'table');
  table.dataset.resizeKey = key;
  return key;
}

function columnResizeKey(th, index) {
  return th && th.dataset && th.dataset.col ? 'h:' + th.dataset.col : 'i:' + index;
}

function isTextResizeColumn(table, th, index) {
  if (th && th.classList.contains('col-text')) return true;
  const key = tableResizeKey(table);
  if (key === 'statusBody') return index === 0;
  if (key === 'metaOverviewBody') return index <= 1;
  return false;
}

function getColumnMinWidth(table, th, index) {
  return isTextResizeColumn(table, th, index) ? COLUMN_MIN_TEXT : COLUMN_MIN_METRIC;
}

function getTableHeaderCells(table) {
  return table ? Array.from(table.querySelectorAll('thead tr:last-child > th')) : [];
}

function setColumnCellsWidth(table, index, width, userSized) {
  if (!table || !Number.isFinite(width)) return;
  const cells = table.querySelectorAll('tr > *:nth-child(' + (index + 1) + ')');
  cells.forEach(function(cell) {
    cell.style.width = width + 'px';
    cell.style.minWidth = width + 'px';
    cell.style.maxWidth = width + 'px';
    if (userSized) cell.classList.add('column-user-sized');
    else cell.classList.remove('column-user-sized');
  });
}

function syncMetaStickyOffsets(table) {
  if (!table || !table.classList.contains('meta-two-sticky')) return;
  const ths = getTableHeaderCells(table);
  if (ths[0]) table.style.setProperty('--meta-account-col', Math.round(ths[0].getBoundingClientRect().width) + 'px');
  if (ths[1]) table.style.setProperty('--meta-adset-col', Math.round(ths[1].getBoundingClientRect().width) + 'px');
}

function freezeCurrentColumnWidths(table) {
  if (!table || table.dataset.columnSizingFrozen === '1') return;
  const ths = getTableHeaderCells(table);
  if (!ths.length) return;
  const widths = ths.map(function(th) { return Math.max(1, Math.round(th.getBoundingClientRect().width)); });
  widths.forEach(function(width, index) { setColumnCellsWidth(table, index, width, false); });
  const total = widths.reduce(function(sum, value) { return sum + value; }, 0);
  if (total > 0) {
    table.style.width = total + 'px';
    table.style.minWidth = total + 'px';
    table.style.tableLayout = 'fixed';
  }
  table.dataset.columnSizingFrozen = '1';
  table.classList.add('column-sizing-active');
  syncMetaStickyOffsets(table);
}

function persistColumnWidth(table, index, width) {
  const ths = getTableHeaderCells(table);
  const th = ths[index];
  const tableKey = tableResizeKey(table);
  if (!tableKey || !th) return;
  const store = readColumnWidthsStore();
  store[tableKey] = store[tableKey] || {};
  store[tableKey][columnResizeKey(th, index)] = Math.round(width);
  writeColumnWidthsStore(store);
  updateColumnResetButton();
}

function resizeColumnTo(table, index, requestedWidth, persist) {
  if (!table) return;
  freezeCurrentColumnWidths(table);
  const ths = getTableHeaderCells(table);
  const th = ths[index];
  if (!th) return;
  const minWidth = getColumnMinWidth(table, th, index);
  const width = Math.max(minWidth, Math.round(requestedWidth));
  setColumnCellsWidth(table, index, width, true);
  const isText = isTextResizeColumn(table, th, index);
  table.querySelectorAll('tr > *:nth-child(' + (index + 1) + ')').forEach(function(cell) {
    cell.classList.toggle('column-wrap', isText);
  });

  const allWidths = getTableHeaderCells(table).map(function(cell) {
    return Math.max(1, Math.round(cell.getBoundingClientRect().width));
  });
  const total = allWidths.reduce(function(sum, value) { return sum + value; }, 0);
  table.style.width = total + 'px';
  table.style.minWidth = total + 'px';
  syncMetaStickyOffsets(table);
  if (persist !== false) persistColumnWidth(table, index, width);
}

function measureColumnAutoFit(table, index) {
  const ths = getTableHeaderCells(table);
  const th = ths[index];
  if (!th) return 140;
  const isText = isTextResizeColumn(table, th, index);
  let max = getColumnMinWidth(table, th, index);
  const canvas = measureColumnAutoFit._canvas || (measureColumnAutoFit._canvas = document.createElement('canvas'));
  const ctx = canvas.getContext('2d');
  const cells = Array.from(table.querySelectorAll('tr > *:nth-child(' + (index + 1) + ')'));
  cells.forEach(function(cell) {
    const text = String(cell.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text) return;
    const style = getComputedStyle(cell);
    ctx.font = style.font || (style.fontWeight + ' ' + style.fontSize + ' ' + style.fontFamily);
    const extra = cell.tagName === 'TH' ? 46 : 26;
    max = Math.max(max, Math.ceil(ctx.measureText(text).width + extra));
  });
  const cap = isText ? COLUMN_MAX_AUTOFIT : 240;
  return Math.min(cap, max);
}

function applySavedColumnWidths(table, fallbackKey) {
  if (!table) return;
  const tableKey = tableResizeKey(table, fallbackKey);
  const store = readColumnWidthsStore();
  const saved = store[tableKey];
  if (!saved || !Object.keys(saved).length) return;
  freezeCurrentColumnWidths(table);
  const ths = getTableHeaderCells(table);
  ths.forEach(function(th, index) {
    const width = Number(saved[columnResizeKey(th, index)]);
    if (Number.isFinite(width) && width > 0) resizeColumnTo(table, index, width, false);
  });
  syncMetaStickyOffsets(table);
}

function enhanceResizableTable(table, fallbackKey) {
  if (!table) return;
  tableResizeKey(table, fallbackKey);
  let ths = getTableHeaderCells(table);
  if (!ths.length) return;

  // Sortowanie/filtrowanie przebudowuje <thead>. Jeśli tabela była wcześniej
  // zamrożona do ręcznych szerokości, nowy nagłówek musi najpierw dostać świeży snapshot.
  if (table.dataset.columnSizingFrozen === '1' && ths.some(function(th) { return !th.style.width; })) {
    delete table.dataset.columnSizingFrozen;
    table.classList.remove('column-sizing-active');
    table.style.removeProperty('width');
    table.style.removeProperty('min-width');
    table.style.removeProperty('table-layout');
    table.style.removeProperty('--meta-account-col');
    table.style.removeProperty('--meta-adset-col');
    ths = getTableHeaderCells(table);
  }

  ths.forEach(function(th, index) {
    if (th.querySelector(':scope > .col-resizer')) return;
    const handle = document.createElement('span');
    handle.className = 'col-resizer';
    handle.setAttribute('role', 'separator');
    handle.setAttribute('aria-orientation', 'vertical');
    handle.setAttribute('aria-label', 'Zmień szerokość kolumny');
    handle.title = 'Przeciągnij, aby zmienić szerokość. Kliknij dwukrotnie, aby dopasować.';

    handle.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
    });
    handle.addEventListener('dblclick', function(e) {
      e.preventDefault();
      e.stopPropagation();
      resizeColumnTo(table, index, measureColumnAutoFit(table, index), true);
    });
    handle.addEventListener('pointerdown', function(e) {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      freezeCurrentColumnWidths(table);
      const startX = e.clientX;
      const startWidth = th.getBoundingClientRect().width;
      const minWidth = getColumnMinWidth(table, th, index);
      document.body.classList.add('is-resizing-column');
      handle.classList.add('active');
      handle.setPointerCapture && handle.setPointerCapture(e.pointerId);

      function onMove(ev) {
        const next = Math.max(minWidth, startWidth + (ev.clientX - startX));
        resizeColumnTo(table, index, next, false);
      }
      function onUp(ev) {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onUp);
        document.body.classList.remove('is-resizing-column');
        handle.classList.remove('active');
        const finalWidth = th.getBoundingClientRect().width;
        persistColumnWidth(table, index, finalWidth);
        try { handle.releasePointerCapture && handle.releasePointerCapture(ev.pointerId); } catch (_) {}
      }
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onUp);
    });
    th.appendChild(handle);
  });

  applySavedColumnWidths(table, fallbackKey);
  updateColumnResetButton();
}

function clearTableColumnWidths(table) {
  if (!table) return;
  const key = tableResizeKey(table);
  const store = readColumnWidthsStore();
  if (key && store[key]) {
    delete store[key];
    writeColumnWidthsStore(store);
  }
  table.querySelectorAll('th,td').forEach(function(cell) {
    cell.style.removeProperty('width');
    cell.style.removeProperty('min-width');
    cell.style.removeProperty('max-width');
    cell.classList.remove('column-user-sized');
    cell.classList.remove('column-wrap');
  });
  table.style.removeProperty('width');
  table.style.removeProperty('min-width');
  table.style.removeProperty('table-layout');
  table.style.removeProperty('--meta-account-col');
  table.style.removeProperty('--meta-adset-col');
  table.classList.remove('column-sizing-active');
  delete table.dataset.columnSizingFrozen;
  updateColumnResetButton();
}

function activeDataTable() {
  return document.querySelector('.page.active .table-wrap table');
}

function ensureColumnResetButton() {
  const filters = document.getElementById('headerFilters');
  if (!filters) return null;
  let btn = document.getElementById('resetColumnsBtn');
  if (btn) return btn;
  btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'resetColumnsBtn';
  btn.className = 'column-reset-btn';
  btn.innerHTML = '<span aria-hidden="true">↺</span><span>Kolumny</span>';
  btn.title = 'Przywróć domyślne szerokości kolumn';
  btn.setAttribute('aria-label', 'Przywróć domyślne szerokości kolumn');
  btn.addEventListener('click', function() {
    clearTableColumnWidths(activeDataTable());
  });
  const search = document.getElementById('searchInput');
  filters.insertBefore(btn, search || null);
  return btn;
}

function updateColumnResetButton() {
  const btn = ensureColumnResetButton();
  if (!btn) return;
  const table = activeDataTable();
  const key = table && tableResizeKey(table);
  const store = readColumnWidthsStore();
  const hasSaved = !!(key && store[key] && Object.keys(store[key]).length);
  btn.hidden = !table || !hasSaved;
}

function enhanceStaticDashboardTables() {
  ['statusBody', 'metaOverviewBody'].forEach(function(bodyId) {
    const body = document.getElementById(bodyId);
    if (body) enhanceResizableTable(body.closest('table'), bodyId);
  });
}

function renderDynamicTable(rawData, headId, bodyId, platform) {
  const headEl=document.getElementById(headId), bodyEl=document.getElementById(bodyId);
  if (!headEl||!bodyEl) return;
  const pageName = bodyId.replace(/Body$/, '');
  const safeData = rawData || [];
  const monthlyHeaders = bodyId === 'metaMiesiecznyBody' ? (safeData._headers || []) : [];
  if (!safeData.length && !monthlyHeaders.length) {
    headEl.innerHTML='';
    bodyEl.innerHTML='<tr><td colspan="99" style="text-align:center;color:var(--muted);padding:24px">Brak danych</td></tr>';
    PAGE_COUNTS[pageName] = {shown: 0, total: 0};
    updateResultsCountDisplay();
    return;
  }
  // Filtrujemy kolumny wewnętrzne ('_...') oraz techniczne ID
  const headers = [...new Set([...monthlyHeaders, ...safeData.flatMap(r => Object.keys(r))])]
    .filter(h => !h.startsWith('_') && h.trim() !== '' && !HIDDEN_COLS.has(h));
  // "Konto" musi być zawsze pierwszą (a więc przypiętą) kolumną — niezależnie od kolejności
  // kolumn w źródłowym arkuszu, żeby zamrożona kolumna zawsze pokazywała nazwę konta, a nie
  // np. datę aktualizacji, jeśli akurat ta jest pierwsza w CSV.
  const kontoIdx = headers.indexOf('Konto');
  if (kontoIdx > 0) {
    headers.splice(kontoIdx, 1);
    headers.unshift('Konto');
  }

  // Aktualny stan sortowania dla tej tabeli
  const ss = SORT_STATE[bodyId] || {col: null, dir: 'asc'};

  // Nagłówki z klasami sortowania, krótką etykietą i opcjonalnym objaśnieniem.
  headEl.innerHTML = '<tr>' + headers.map(function(h) {
    const isSortCol = ss.col === h;
    const cls = 'sortable' + (isSortCol ? ' sort-' + ss.dir : '') + ' ' + getColumnUiClass(h);
    const label = getColumnLabel(bodyId, h);
    const help = getColumnTooltip(bodyId, h);
    const title = help || ('Sortuj według: ' + label);
    const helpIcon = help ? '<span class="col-help" aria-hidden="true">i</span>' : '';
    return '<th class="' + cls + '" title="' + escHtml(title) + '" data-body="' + escHtml(bodyId) + '" data-col="' + escHtml(h) + '" onclick="handleSortClick(this)">'
      + '<span class="th-label">' + escHtml(label) + '</span>' + helpIcon + '<span class="sort-arrow"></span></th>';
  }).join('') + '</tr>';

  updateMetaStickyTable(bodyId, platform, headers);

  // Filtrowanie + sortowanie
  let rows = filterRows(normalizeRows(safeData), platform);
  if (ss.col) {
    const spec = comparisonColumnSpec(ss.col, platform, bodyId);
    rows = spec ? sortComparisonRows(rows, ss.col, spec, platform, ss.dir) : sortData(rows, ss.col, ss.dir);
  }

  PAGE_COUNTS[pageName] = {shown: rows.length, total: safeData.length};
  updateResultsCountDisplay();

  if (!rows.length) {
    bodyEl.innerHTML='<tr><td colspan="' + headers.length + '" class="table-message">' + (safeData.length ? 'Brak wyników' : 'Brak danych') + '</td></tr>';
    return;
  }
  bodyEl.innerHTML = rows.map(function(r) {
    return '<tr>' + headers.map(function(h) {
      const cellClass = getColumnUiClass(h);
      const raw = r[h] !== undefined && r[h] !== null ? String(r[h]) : '';
      if (TEXT_COLUMN_HEADERS.has(h)) {
        const title = raw.trim() ? ' title="' + escHtml(raw) + '"' : '';
        const content = raw.trim()
          ? ((h === 'Konto' || h === 'Nazwa zestawu reklam') ? highlightMatch(raw) : escHtml(raw))
          : '<span class="metric-empty">—</span>';
        return '<td class="' + cellClass + '"' + title + '>' + content + '</td>';
      }
      return '<td class="' + cellClass + '">' + formatCell(h, raw, r.konto, platform, r['ID Konta'], bodyId, r) + '</td>';
    }).join('') + '</tr>';
  }).join('');

  enhanceResizableTable(bodyEl.closest('table'), bodyId);
}

// Obsługa kliknięcia nagłówka — przełącza asc/desc lub ustawia nową kolumnę
function handleSortClick(th) {
  const bodyId = th.dataset.body;
  const col    = th.dataset.col;
  const cur    = SORT_STATE[bodyId] || {col: null, dir: 'asc'};

  if (cur.col === col) {
    // Ta sama kolumna: odwróć kierunek
    SORT_STATE[bodyId] = {col: col, dir: cur.dir === 'asc' ? 'desc' : 'asc'};
  } else {
    // Nowa kolumna: zacznij od asc
    SORT_STATE[bodyId] = {col: col, dir: 'asc'};
  }

  // Przerenderuj właściwą zakładkę
  const tabRenderMap = {
    wydatkiBody:        renderWydatki,
    audytBody:          renderAudyt,
    audytWartBody:      renderAudytWart,
    wynikiBody:         renderWyniki,
    wartKonwBody:       renderWartKonw,
    anomaliaBody:       renderAnomalia,
    metaDziennyBody:    renderMetaDzienny,
    metaWydatkiBody:    renderMetaWydatki,
    metaMiesiecznyBody: renderMetaMiesieczny,
    metaAudytBody:      renderMetaAudyt,
    metaAudytWartBody:  renderMetaAudytWart,
    metaWartoscKonwersjiBody: renderMetaWartoscKonwersji,
    metaAnomaliaBody:   renderMetaAnomalia,
  };
  if (tabRenderMap[bodyId]) tabRenderMap[bodyId]();
}

// ═══════════════════════════════════════════════════════
//  ŁADOWANIE DANYCH
// ═══════════════════════════════════════════════════════
async function loadAllData() {
  if (dataAbortController) {
    dataAbortController.abort();
  }
  dataAbortController = new AbortController();
  const signal = dataAbortController.signal;

  const btn = document.getElementById('refreshBtn');
  btn.classList.add('loading');
  document.getElementById('statusBody').innerHTML =
    '<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:24px">Ładowanie danych...</td></tr>';
  document.getElementById('metaOverviewBody').innerHTML =
    '<tr><td colspan="10" style="text-align:center;color:var(--muted);padding:24px">Ładowanie danych...</td></tr>';

  try {
    // Auth v3.1: jeden request do backendu zamiast 17 osobnych wywołań /api/data.
    // Dzięki temu sesja, OIDC/WIF, zakres użytkownika i token Sheets API są liczone raz,
    // a wszystkie raporty pobierane są w jednym kontrolowanym przebiegu.
    const response = await fetch('/api/dashboard-data', {
      signal,
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' },
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || `HTTP ${response.status} dla /api/dashboard-data`);
    }
    if (signal.aborted) return;

    const sheetErrors = [];
    const sources = payload.sources || {};

    function unpack(key) {
      const source = sources[key];
      if (!source || !source.ok) {
        const message = source && source.error ? source.error : 'Brak danych ze źródła.';
        sheetErrors.push(`${key}: ${message}`);
        const empty = [];
        Object.defineProperty(empty, '_headers', { value: [], enumerable: false });
        return empty;
      }
      const rows = Array.isArray(source.rows) ? source.rows : [];
      const headers = Array.isArray(source.headers) ? source.headers : [];
      Object.defineProperty(rows, '_headers', { value: headers, enumerable: false });
      return rows;
    }

    const wydatki = unpack('wydatki');
    const audyt = unpack('audyt');
    const audytWart = unpack('audytWart');
    const wyniki = unpack('wyniki');
    const wartKonw = unpack('wartKonw');
    const anomalia = unpack('anomalia');
    const notatki = unpack('notatki');

    const metaWydatki = unpack('metaWydatki');
    const metaAnomalia = unpack('metaAnomalia');
    const metaDzienny = unpack('metaDzienny');
    let metaMiesieczny = unpack('metaMiesieczny');
    const metaAudyt = unpack('metaAudyt');
    const metaKonta = unpack('metaKonta');
    const metaAudytWart = unpack('metaAudytWart');
    const metaWartoscKonwersji = unpack('metaWartoscKonwersji');

    const progiGoogle = unpack('progiGoogle');
    const progiMeta = unpack('progiMeta');

    let metaMonthlyError = '';
    if (sources.metaMiesieczny && sources.metaMiesieczny.ok) {
      try {
        validateMetaMonthlyHeaders([metaMiesieczny._headers || []], '');
      } catch (error) {
        metaMonthlyError = error.message;
        sheetErrors.push(`metaMiesieczny: ${metaMonthlyError}`);
        metaMiesieczny = [];
        Object.defineProperty(metaMiesieczny, '_headers', { value: [], enumerable: false });
      }
    } else {
      metaMonthlyError = sources.metaMiesieczny && sources.metaMiesieczny.error
        ? sources.metaMiesieczny.error
        : 'Nie udało się pobrać raportu miesięcznego Meta Ads.';
    }

    DATA = {
      wydatki, audyt, audytWart, wyniki, wartKonw, anomalia, notatki,
      metaWydatki, metaDzienny, metaMiesieczny, metaAudyt, metaAudytWart,
      metaAnomalia, metaWartoscKonwersji, metaKonta, progiGoogle, progiMeta,
    };

    DATA._metaMonthlyError = metaMonthlyError;
    DATA._metaIssues = metaMonthlyError ? [metaMonthlyError] : [];
    DATA._metaIssues.push(...collectMetaDataIssues(DATA));

    COMPARISON_WARNINGS.clear();
    DATA._idx = buildIndexes(DATA);
    DATA._config = buildConfig(DATA.progiGoogle);
    DATA._metaConfig = buildMetaConfig(DATA.progiMeta);
    DATA._nameToId = buildNameToIdMap(DATA.wydatki);
    DATA._nameToIdMeta = buildNameToIdMap(DATA.metaWydatki);

    NOTES = mapNotatkiRows(notatki);

    updateReportDates();
    const updateEl = document.getElementById('lastUpdate');
    if (updateEl) updateEl.title = sheetErrors.join('\n');
    renderMetaDataNotice();
    if (sheetErrors.length) console.warn('[Dashboard] Nie wszystkie arkusze zostały pobrane:', sheetErrors);

    GOOGLE_KONTA = [...new Set([
      ...wydatki.map(r => (r['Konto'] || '').trim()),
      ...audyt.map(r => (r['Konto'] || '').trim()),
      ...wyniki.map(r => (r['Konto'] || '').trim()),
      ...wartKonw.map(r => (r['Konto'] || '').trim()),
      ...anomalia.map(r => (r['Konto'] || '').trim()),
    ])].filter(Boolean).sort();

    META_KONTA = [...new Set([
      ...(metaWydatki || []).map(r => (r['Konto'] || '').trim()),
      ...(metaDzienny || []).map(r => (r['Konto'] || '').trim()),
      ...(metaMiesieczny || []).map(r => (r['Konto'] || '').trim()),
    ])].filter(Boolean).sort();

    ALL_KONTA = [...new Set([...GOOGLE_KONTA, ...META_KONTA])].sort();
    updateKontoDropdowns();

    renderAll();
    renderNotesList();
    document.dispatchEvent(new CustomEvent('ppc:data-loaded'));
  } catch (e) {
    if (e.name === 'AbortError') return;
    document.getElementById('lastUpdate').textContent = 'Błąd: ' + e.message;
    const errorRow = `<tr><td colspan="8" style="text-align:center;color:var(--red);padding:24px">Błąd pobierania danych: ${escHtml(e.message)}<br><br>Sprawdź aktywną sesję oraz endpoint /api/dashboard-data. Szczegóły są też w /api/admin/sheets-check.</td></tr>`;
    document.getElementById('statusBody').innerHTML = errorRow;
    document.getElementById('metaOverviewBody').innerHTML = errorRow.replace('colspan="8"', 'colspan="10"');
    console.error('[Dashboard]', e);
  } finally {
    if (dataAbortController && dataAbortController.signal === signal) {
      btn.classList.remove('loading');
      dataAbortController = null;
    }
  }
}


// Buduje mapę Nazwa konta -> ID konta z wierszy zakładki Wydatki (jedynej, która ma
// gwarantowaną kolumnę "ID Konta" dla każdego zsynchronizowanego konta). Używana przez
// getThresholds()/getMetaThresholds() do tłumaczenia nazwy (jak dotąd używanej wszędzie
// w kodzie) na ID, po którym kluczowana jest konfiguracja progów w osobnym pliku.
function buildNameToIdMap(rows) {
  const map = {};
  (rows || []).forEach(r => {
    const name = (r['Konto'] || '').trim();
    const id = (r['ID Konta'] || '').trim();
    if (name && id) map[name] = id;
  });
  return map;
}

function buildIndexes(d) {
  const duplicates = [];
  const idx = arr => {
    const map = {};
    normalizeRows(arr || []).forEach(r => {
      if (r.konto) {
        if (map[r.konto]) duplicates.push(r.konto);
        map[r.konto] = r;
      }
    });
    return map;
  };
  const result = {
    W:  idx(d.wydatki),
    A:  idx(d.audyt),
    Wn: idx(d.wyniki),
    Wk: idx(d.wartKonw),
    An: idx(d.anomalia),
  };
  if (duplicates.length) {
    const unique = [...new Set(duplicates)];
    console.warn('[Dashboard] Duplikaty kont w danych (last-write-wins):', unique);
    const el = document.getElementById('lastUpdate');
    if (el) {
      const extra = 'Wykryto zduplikowane wiersze kont w arkuszu. Wyświetlany jest ostatni wiersz dla każdego konta: ' + unique.join(', ');
      el.title = [el.title, extra].filter(Boolean).join('\n');
    }
  }
  return result;
}

// Filtruje dropdown "Konto" w formularzu wg wybranej platformy — zapobiega
// pomieszaniu kont Google Ads i Meta Ads o tej samej nazwie.
function onPlatformaChange() {
  const platforma = document.getElementById('notePlatforma').value;
  const sel = document.getElementById('noteKonto');
  const cur = sel.value;
  if (!platforma) {
    sel.innerHTML = '<option value="">— najpierw wybierz platformę —</option>';
    sel.disabled = true;
    return;
  }
  const list = platforma === 'Meta Ads' ? META_KONTA : GOOGLE_KONTA;
  sel.disabled = false;
  sel.innerHTML = '<option value="">— wybierz konto —</option>' +
    list.map(k=>`<option value="${escHtml(k)}"${k===cur?' selected':''}>${escHtml(k)}</option>`).join('');
}

function updateKontoDropdowns() {
  onPlatformaChange(); // odśwież listę kont w formularzu dla aktualnie wybranej platformy
  const fsel = document.getElementById('dzFilterKonto');
  const fcur = fsel.value;
  fsel.innerHTML = '<option value="">Wszystkie konta</option>' +
    ALL_KONTA.map(k=>`<option value="${escHtml(k)}"${k===fcur?' selected':''}>${escHtml(k)}</option>`).join('');
}

function applyFilters() {
  const activeId = document.querySelector('.page.active')?.id?.replace('page-', '');
  const pageRenderers = {
    overview:        renderOverview,
    wydatki:         renderWydatki,
    audyt:           renderAudyt,
    audytWart:       renderAudytWart,
    wyniki:          renderWyniki,
    wartKonw:        renderWartKonw,
    anomalia:        renderAnomalia,
    metaDzienny:     renderMetaDzienny,
    metaWydatki:     renderMetaWydatki,
    metaMiesieczny:  renderMetaMiesieczny,
    metaAudyt:       renderMetaAudyt,
    metaAudytWart:   renderMetaAudytWart,
    metaWartoscKonwersji: renderMetaWartoscKonwersji,
    metaAnomalia:    renderMetaAnomalia,
    metaOverview:    renderMetaOverview,
    clients:         (typeof renderAdminClients === 'function' ? renderAdminClients : function(){}),
  };
  if (activeId && activeId !== 'overview' && pageRenderers[activeId]) {
    pageRenderers[activeId]();
  }
  renderOverview();
  renderComparisonHelp();
}

function renderAll() {
  renderOverview();
  renderWydatki();
  renderAudyt();
  renderAudytWart();
  renderWyniki();
  renderWartKonw();
  renderAnomalia();
  renderMetaOverview();
  renderMetaDzienny();
  renderMetaWydatki();
  renderMetaMiesieczny();
  renderMetaAudyt();
  renderMetaAudytWart();
  renderMetaWartoscKonwersji();
  renderMetaAnomalia();
  renderComparisonHelp();
}

function metricText(value, cls) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return '<span class="metric-empty">—</span>';
  }
  return `<span class="${cls || 'metric-gray'}">${escHtml(String(value))}</span>`;
}

// t: obiekt progów z getThresholds()/getMetaThresholds() — musi zawierać budzet_min/budzet_max.
function budgetClass(value, t) {
  t = t || DEFAULTS;
  const n = parseNum(value);
  if (!value || String(value).trim() === '') return 'metric-empty';
  if (n > t.budzet_max) return 'metric-red';
  if (n < t.budzet_min) return 'metric-amber';
  return 'metric-gray';
}

function ratioClass(value, normalMin, greenMin) {
  const n = parseNum(value);
  if (!value || String(value).trim() === '') return 'metric-empty';
  if (n >= greenMin) return 'metric-green';
  if (n >= normalMin) return 'metric-gray';
  if (n >= normalMin * 0.67) return 'metric-amber';
  return 'metric-red';
}

// t: obiekt progów z getThresholds() — bez `t` spada na systemowe DEFAULTS.
function roasClass(value, t) {
  t = t || DEFAULTS;
  const n = parseNum(value);
  if (!value || String(value).trim() === '' || n <= 0) return 'metric-empty';
  if (t.roas_amber > 0 && n >= t.roas_amber) return 'metric-green';
  if (t.roas_red > 0 && n >= t.roas_red) return 'metric-gray';
  if (t.roas_red > 0 && n >= t.roas_red * 0.75) return 'metric-amber';
  return 'metric-red';
}

function renderOverview() {
  const {W:iW, A:iA, Wn:iWn, Wk:iWk, An:iAn} = DATA._idx || buildIndexes(DATA);

  const wydatki  = normalizeRows(DATA.wydatki || []);
  const audyt    = normalizeRows(DATA.audyt || []);

  // Zachowujemy kolejność kont znaną z zakładek Google Ads.
  // Najpierw kolejność z „Wydatków” (główna tabela operacyjna), a konta występujące
  // wyłącznie w innych raportach dopisujemy na końcu w kolejności źródłowej.
  const googleAccountSources = [
    DATA.wydatki || [],
    DATA.audyt || [],
    DATA.wyniki || [],
    DATA.wartKonw || [],
    DATA.anomalia || [],
  ];
  const seenGoogleAccounts = new Set();
  const allKonta = [];
  googleAccountSources.forEach(rows => {
    (rows || []).forEach(r => {
      const konto = String(r['Konto'] || '').trim();
      if (konto && !seenGoogleAccounts.has(konto)) {
        seenGoogleAccounts.add(konto);
        allKonta.push(konto);
      }
    });
  });
  const {q} = getFilters();
  const filtered = allKonta.filter(konto => !q || konto.toLowerCase().includes(q));

  PAGE_COUNTS.overview = {shown: filtered.length, total: allKonta.length};
  updateResultsCountDisplay();

  const body = document.getElementById('statusBody');
  if (!filtered.length) {
    body.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--muted);padding:24px">Brak danych</td></tr>';
    return;
  }

  body.innerHTML = filtered.map(konto => {
    const w = iW[konto] || {};
    const a = iA[konto] || {};
    const wn = iWn[konto] || {};
    const wk = iWk[konto] || {};
    const an = iAn[konto] || {};
    const t = getThresholds(konto);

    const budget = w['Status'] || '';
    const conversions = wn['Konwersje'] || '';
    const conversionsClass = conversions !== '' && parseNum(conversions) < t.konw_min ? 'metric-red' : 'metric-gray';
    const convVsPrev = wn['Porównanie konwersji z poprzednim miesiącem'] || '';
    const impressionsTrend = a['Współczynnik wyświetleń'] ?? '';
    const impressionsAnomaly = an['Status wyświetleń'] ?? '';
    const roas = wk['ROAS'] || '';
    // CPA — działa dla każdego konta (Sklep i Lead), w przeciwieństwie do ROAS, które ma
    // sens tylko dla Sklepów (zakładka Wartość konwersji). Bez kolorowania na razie —
    // nie ma jeszcze zdefiniowanego progu w Progi - Google Ads.
    const cpa = wn['CPA'] || '';

    return `<tr>
      <td style="font-weight:700;font-family:'Montserrat',sans-serif">${highlightMatch(konto)}</td>
      <td>${metricText(budget, budgetClass(budget, t))}</td>
      <td>${metricText(conversions, conversionsClass)}</td>
      <td>${metricText(convVsPrev, ratioClass(convVsPrev, t.konw_pct_min, 100))}</td>
      <td>${formatComparisonMetric(impressionsTrend, 'trend', 'google', konto, a['ID Konta'] || w['ID Konta'], 'ratio')}</td>
      <td>${formatComparisonMetric(impressionsAnomaly, 'anomaly', 'google', konto, an['ID Konta'] || w['ID Konta'])}</td>
      <td>${metricText(roas, roasClass(roas, t))}</td>
      <td>${metricText(cpa, 'metric-gray')}</td>
    </tr>`;
  }).join('');
  enhanceResizableTable(body.closest('table'), 'statusBody');
}

function openDziennikForKonto(konto, platforma) {
  const btn = document.querySelector('.nav-item.nav-dziennik');
  showPage('dziennik', btn);

  const filterKontoSel = document.getElementById('dzFilterKonto');
  if (filterKontoSel) filterKontoSel.value = konto;
  const filterPlatformaSel = document.getElementById('dzFilterPlatforma');
  if (filterPlatformaSel && platforma) filterPlatformaSel.value = platforma;
  renderNotesList();

  const formPlatformaSel = document.getElementById('notePlatforma');
  if (formPlatformaSel && platforma) {
    formPlatformaSel.value = platforma;
    onPlatformaChange();
  }
  const formKontoSel = document.getElementById('noteKonto');
  if (formKontoSel) formKontoSel.value = konto;
}

// ═══════════════════════════════════════════════════════
//  POZOSTAŁE ZAKŁADKI
// ═══════════════════════════════════════════════════════
function renderWydatki()        { renderDynamicTable(DATA.wydatki        || [], 'wydatkiHead',        'wydatkiBody',    'google'); }
function renderAudyt()          { renderDynamicTable(DATA.audyt          || [], 'audytHead',          'audytBody',      'google'); }
function renderAudytWart()      { renderDynamicTable(DATA.audytWart      || [], 'audytWartHead',      'audytWartBody',  'google'); }
function renderWyniki()         { renderDynamicTable(DATA.wyniki         || [], 'wynikiHead',         'wynikiBody',     'google'); }
function renderAnomalia()       { renderDynamicTable(DATA.anomalia       || [], 'anomaliaHead',       'anomaliaBody',   'google'); }
function renderWartKonw()       { renderDynamicTable(DATA.wartKonw       || [], 'wartKonwHead',       'wartKonwBody',   'google'); }
// ═══════════════════════════════════════════════════════
//  META ADS — PRZEGLĄD (jeden wiersz na ID konta + ID zestawu)
// ═══════════════════════════════════════════════════════
function pctChange(now, prev) {
  if (!prev) return null;
  return ((now - prev) / prev) * 100;
}

function indexMetaWydatki() {
  const idx = Object.create(null);
  (DATA.metaWydatki || []).forEach(r => {
    const key = normalizeMetaAccountId(r['ID Konta']);
    if (key && !idx[key]) idx[key] = r;
  });
  return idx;
}

function normalizeMetaAccountId(value) {
  // Nie zamieniamy ID na Number: długie identyfikatory muszą pozostać tekstem.
  return String(value ?? '').trim().replace(/^act_/i, '');
}

function metaRowKey(row) {
  const accountId = normalizeMetaAccountId(row && row['ID Konta']);
  const adsetId = String((row && row['ID Zestawu']) ?? '').trim();
  return accountId && adsetId ? JSON.stringify([accountId, adsetId]) : '';
}

function indexMetaByAdset(rows) {
  const idx = Object.create(null);
  (rows || []).forEach(r => {
    const key = metaRowKey(r);
    if (key && !idx[key]) idx[key] = r;
  });
  return idx;
}

function collectMetaDataIssues(data) {
  const issues = [];
  for (const key of ['metaMiesieczny','metaDzienny','metaAudyt','metaAnomalia']) {
    const rows = data[key] || [];
    const seen = new Set();
    let missing = 0, duplicates = 0;
    rows.forEach(row => {
      const id = metaRowKey(row);
      if (!id) { missing++; return; }
      if (seen.has(id)) duplicates++;
      seen.add(id);
    });
    if (missing) issues.push(`${key}: ${missing} wierszy bez ID konta lub zestawu. Nie są łączone w Przeglądzie; pozostają widoczne w tabeli szczegółowej.`);
    if (duplicates) issues.push(`${key}: ${duplicates} powtórzonych kluczy ID. Przegląd korzysta z pierwszego wiersza dla danego ID.`);
  }
  const monthly = data.metaMiesieczny || [];
  const invalid = monthly.filter(r => {
    const v = r[META_MONTHLY_FIELDS.change];
    return v !== undefined && v !== null && String(v).trim() !== '' && parseMetaForecastChange(v) === null;
  }).length;
  if (invalid) issues.push(`Raport miesięczny: ${invalid} nieprawidłowych wartości zmiany prognozy. Zamiast nich pokazano kreskę.`);
  const dates = getMetaReportTimestamps(monthly);
  if (dates.length > 1) issues.push('Raport miesięczny zawiera różne czasy aktualizacji. Sprawdź, czy odświeżanie GAS zakończyło się dla całego raportu.');
  return issues;
}

function getMetaReportTimestamps(rows) {
  const values = [];
  (rows || []).forEach(row => {
    const raw = row && (row['Data i godzina aktualizacji'] ?? row['Data']);
    const value = String(raw ?? '').trim();
    if (value) values.push(value);
  });
  return [...new Set(values)];
}

function parseReportDate(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;

  // Format GAS / Sheets: YYYY-MM-DD HH:mm:ss (sekundy są opcjonalne).
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(text);
  if (m) {
    const hh = m[4] !== undefined ? String(m[4]).padStart(2, '0') : '';
    const mm = m[5] !== undefined ? m[5] : '';
    const ss = m[6] !== undefined ? m[6] : '00';
    const hasTime = hh !== '' && mm !== '';
    return {
      key: m[1] + '-' + m[2] + '-' + m[3] + ' ' + (hasTime ? hh + ':' + mm + ':' + ss : '00:00:00'),
      label: m[3] + '.' + m[2] + '.' + m[1] + (hasTime ? ', ' + hh + ':' + mm : '')
    };
  }

  // Format lokalny: DD.MM.YYYY HH:mm[:ss] (akceptujemy też / i - jako separator daty).
  m = /^(\d{2})[.\/-](\d{2})[.\/-](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(text);
  if (m) {
    const hh = m[4] !== undefined ? String(m[4]).padStart(2, '0') : '';
    const mm = m[5] !== undefined ? m[5] : '';
    const ss = m[6] !== undefined ? m[6] : '00';
    const hasTime = hh !== '' && mm !== '';
    return {
      key: m[3] + '-' + m[2] + '-' + m[1] + ' ' + (hasTime ? hh + ':' + mm + ':' + ss : '00:00:00'),
      label: m[1] + '.' + m[2] + '.' + m[3] + (hasTime ? ', ' + hh + ':' + mm : '')
    };
  }
  return null;
}

function getLatestReportDate(rowGroups) {
  const candidates = [];
  (rowGroups || []).forEach(rows => (rows || []).forEach(row => {
    ['Data i godzina aktualizacji', 'Data'].forEach(header => {
      const parsed = parseReportDate(row && row[header]);
      if (parsed) candidates.push(parsed);
    });
  }));
  if (!candidates.length) return null;
  candidates.sort((a, b) => a.key.localeCompare(b.key));
  return candidates[candidates.length - 1];
}

function updateReportDates() {
  const googleEl = document.getElementById('lastUpdate');
  const metaEl = document.getElementById('metaReportUpdate');
  const googleDate = getLatestReportDate([
    DATA.wydatki, DATA.audyt, DATA.audytWart, DATA.wyniki, DATA.wartKonw, DATA.anomalia
  ]);
  const metaDate = getLatestReportDate([
    DATA.metaWydatki, DATA.metaDzienny, DATA.metaMiesieczny, DATA.metaAudyt,
    DATA.metaAudytWart, DATA.metaWartoscKonwersji, DATA.metaAnomalia
  ]);

  if (googleEl) {
    googleEl.textContent = 'Google Ads: ' + (googleDate ? googleDate.label : 'brak daty');
    googleEl.title = 'Data i godzina aktualizacji odczytane z danych źródłowych Google Ads.';
  }
  if (metaEl) {
    if (DATA._metaMonthlyError) metaEl.textContent = 'Meta Ads: raport niedostępny';
    else metaEl.textContent = 'Meta Ads: ' + (metaDate ? metaDate.label : 'brak daty');
    metaEl.title = 'Data i godzina aktualizacji odczytane z danych źródłowych Meta Ads.';
  }
}

function renderMetaDataNotice() {
  const el = document.getElementById('metaDataNotice');
  if (!el) return;
  const active = document.querySelector('.page.active');
  const issues = DATA._metaIssues || [];
  el.hidden = !active || !active.id.startsWith('page-meta') || !issues.length;
  el.innerHTML = issues.map(message => '<div>' + escHtml(message) + '</div>').join('');
}

function renderMetaMonthlyError(bodyId, colspan) {
  const body = document.getElementById(bodyId);
  if (!body) return;
  body.innerHTML = `<tr><td colspan="${colspan}" class="table-message">Nie można wyświetlić raportu miesięcznego. Szczegóły znajdują się w komunikacie nad tabelą.</td></tr>`;
  PAGE_COUNTS[bodyId.replace(/Body$/, '')] = {shown: 0, total: 0};
  updateResultsCountDisplay();
}

function renderMetaOverview() {
  const bodyEl = document.getElementById('metaOverviewBody');
  if (!bodyEl) return;

  if (DATA._metaMonthlyError) { renderMetaMonthlyError('metaOverviewBody', 10); return; }
  const miesieczny = DATA.metaMiesieczny || [];
  const dzIdx = indexMetaByAdset(DATA.metaDzienny || []);
  const auIdx = indexMetaByAdset(DATA.metaAudyt || []);
  const anIdx = indexMetaByAdset(DATA.metaAnomalia || []);
  const wIdx = indexMetaWydatki();
  const {q} = getFilters();

  // Jeden wiersz na zestaw reklam. Konta układamy według kolejności z arkusza „Konta”,
  // a zestawy reklam wewnątrz konta zachowują kolejność z raportu „Miesięczny”.
  const accountOrder = new Map();
  const accountOrderById = new Map();
  (DATA.metaKonta || []).forEach((r, index) => {
    const konto = String(r['Konto'] || r['Nazwa konta'] || r['Nazwa Konta'] || '').trim();
    if (konto && !accountOrder.has(konto)) accountOrder.set(konto, index);
    const id = normalizeMetaAccountId(r['ID Konta']);
    if (id && !accountOrderById.has(id)) accountOrderById.set(id, index);
  });

  const seen = new Set();
  const allRows = miesieczny
    .map((r, sourceIndex) => ({ r, sourceIndex }))
    .filter(({r}) => {
      const key = metaRowKey(r);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      const kontoA = (a.r['Konto'] || '').trim();
      const kontoB = (b.r['Konto'] || '').trim();
      const idA = normalizeMetaAccountId(a.r['ID Konta']);
      const idB = normalizeMetaAccountId(b.r['ID Konta']);
      const orderA = accountOrderById.get(idA) ?? accountOrder.get(kontoA) ?? Number.MAX_SAFE_INTEGER;
      const orderB = accountOrderById.get(idB) ?? accountOrder.get(kontoB) ?? Number.MAX_SAFE_INTEGER;
      return orderA - orderB || a.sourceIndex - b.sourceIndex;
    })
    .map(({r}) => r);

  const rows = allRows.filter(r => {
    if (!q) return true;
    const konto = (r['Konto'] || '').trim().toLowerCase();
    const adset = (r['Nazwa zestawu reklam'] || '').trim().toLowerCase();
    return konto.includes(q) || adset.includes(q);
  });

  PAGE_COUNTS.metaOverview = {shown: rows.length, total: allRows.length};
  updateResultsCountDisplay();

  if (!rows.length) {
    bodyEl.innerHTML = '<tr><td colspan="10" style="text-align:center;color:var(--muted);padding:24px">Brak danych</td></tr>';
    return;
  }

  bodyEl.innerHTML = rows.map(m => {
    const konto = (m['Konto'] || '').trim();
    const adset = (m['Nazwa zestawu reklam'] || '').trim();
    const key = metaRowKey(m);
    const d = dzIdx[key] || {};
    const a = auIdx[key] || {};
    const an = anIdx[key] || {};
    const accountId = m['ID Konta'];
    const w = wIdx[normalizeMetaAccountId(accountId)] || {};
    const t = getMetaThresholds(konto, accountId);

    const budget = w['Status'] || '';
    const costToday = d['Koszt dziś'] || '';
    const impressionsToday = d['Wyświetlenia dziś'] || '';
    const costYesterday = an['Koszt (wczoraj)'] || '';
    const dayChange = comparisonCellValue('Status wyświetleń', an, 'meta');
    // Wszystkie wyniki miesięczne pochodzą z tego samego wiersza Raport_Miesieczny.
    // Nie odczytujemy starej zakładki Wyniki i nie liczymy prognozy ponownie.
    const monthlyResult = m[META_MONTHLY_FIELDS.result] ?? '';
    const forecastChange = m[META_MONTHLY_FIELDS.change] ?? '';
    const trend30d = comparisonCellValue('Zmiana % Wyświetleń (30 dni vs 90 dni→30d)', a, 'meta');

    return `<tr>
      <td style="font-weight:700;font-family:'Montserrat',sans-serif">${highlightMatch(konto)}</td>
      <td>${adset ? highlightMatch(adset) : '<span class="metric-empty">—</span>'}</td>
      <td>${metricText(budget, budgetClass(budget, t))}</td>
      <td class="mono"><span class="metric-gray">${costToday !== '' ? escHtml(String(costToday)) : '—'}</span></td>
      <td class="mono"><span class="metric-gray">${impressionsToday !== '' ? escHtml(String(impressionsToday)) : '—'}</span></td>
      <td class="mono"><span class="metric-gray">${costYesterday !== '' ? escHtml(String(costYesterday)) : '—'}</span></td>
      <td>${formatComparisonMetric(dayChange, 'anomaly', 'meta', konto, accountId)}</td>
      <td class="mono"><span class="metric-gray">${monthlyResult !== '' ? escHtml(String(monthlyResult)) : '—'}</span></td>
      <td>${formatMetaForecastChange(forecastChange, konto, accountId)}</td>
      <td>${formatComparisonMetric(trend30d, 'trend', 'meta', konto, accountId)}</td>
    </tr>`;
  }).join('');
  const table = bodyEl.closest('table');
  if (table) {
    table.classList.add('meta-two-sticky');
    enhanceResizableTable(table, 'metaOverviewBody');
  }
}

function renderMetaDzienny()    { renderDynamicTable(DATA.metaDzienny    || [], 'metaDziennyHead',    'metaDziennyBody',    'meta'); }
function renderMetaWydatki()    { renderDynamicTable(DATA.metaWydatki    || [], 'metaWydatkiHead',    'metaWydatkiBody',    'meta'); }
function renderMetaMiesieczny() {
  if (DATA._metaMonthlyError) {
    document.getElementById('metaMiesiecznyHead').innerHTML = '';
    renderMetaMonthlyError('metaMiesiecznyBody', 13);
    return;
  }
  renderDynamicTable(DATA.metaMiesieczny || [], 'metaMiesiecznyHead', 'metaMiesiecznyBody', 'meta');
}
function renderMetaAudyt()      { renderDynamicTable(DATA.metaAudyt      || [], 'metaAudytHead',      'metaAudytBody',      'meta'); }
function renderMetaAudytWart()  { renderDynamicTable(DATA.metaAudytWart  || [], 'metaAudytWartHead',  'metaAudytWartBody',  'meta'); }
function renderMetaWartoscKonwersji() { renderDynamicTable(DATA.metaWartoscKonwersji || [], 'metaWartoscKonwersjiHead', 'metaWartoscKonwersjiBody', 'meta'); }
function renderMetaAnomalia()   { renderDynamicTable(DATA.metaAnomalia   || [], 'metaAnomaliaHead',   'metaAnomaliaBody',   'meta'); }

// ═══════════════════════════════════════════════════════

//  UI HELPERS
// ═══════════════════════════════════════════════════════
function showFeedback(msg, cls) {
  const el = document.getElementById('formFeedback');
  el.textContent = msg;
  el.className = 'form-feedback ' + cls;
  setTimeout(()=>{ el.textContent=''; el.className='form-feedback'; }, 3500);
}
let toastTimer;
function showToast(msg, cls='ok') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast show ${cls}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>el.classList.remove('show'), 3000);
}
function showWebappHelp() {
  showToast('Otwórz plik apps_script.gs i postępuj zgodnie z instrukcją.','ok');
}

// ═══════════════════════════════════════════════════════
//  NAWIGACJA
// ═══════════════════════════════════════════════════════
const PAGE_TITLES={
  overview:'Przegląd',wydatki:'Wydatki',audyt:'Audyt',audytWart:'Audyt - wart',
  wyniki:'Wyniki',wartKonw:'Wartość konwersji',anomalia:'Anomalia',
  metaOverview:'Meta — Przegląd',metaWydatki:'Meta — Wydatki',metaDzienny:'Meta — Dzienny',metaMiesieczny:'Meta — Wyniki',metaWartoscKonwersji:'Meta — Wartość konwersji',metaAudyt:'Meta — Audyt',metaAudytWart:'Meta — Audyt - wart',metaAnomalia:'Meta — Anomalia',
  dziennik:'Dziennik zmian',clients:'Klienci',admin:'Administracja'
};

const PAGE_SUBTITLES = Object.freeze({
  overview:'Najważniejsze sygnały i wyniki kont',
  wydatki:'Realizacja budżetu i prognoza kosztu',
  audyt:'Porównanie 30 dni do średniej miesięcznej z 90 dni',
  audytWart:'Wartość konwersji i efektywność w ujęciu 30/90 dni',
  wyniki:'Bieżący wynik, prognoza i porównanie miesiąc do miesiąca',
  wartKonw:'Wartość konwersji, ROAS i prognoza miesiąca',
  anomalia:'Dzienne odchylenia wymagające uwagi',
  metaOverview:'Najważniejsze sygnały dla zestawów reklam',
  metaWydatki:'Realizacja budżetu i prognoza kosztu',
  metaDzienny:'Bieżące metryki dzienne',
  metaMiesieczny:'Wynik miesiąca, prognoza i porównanie',
  metaWartoscKonwersji:'Wartość konwersji, ROAS i prognoza miesiąca',
  metaAudyt:'Porównanie 30 dni do średniej miesięcznej z 90 dni',
  metaAudytWart:'Wartość konwersji i efektywność w ujęciu 30/90 dni',
  metaAnomalia:'Dzienne odchylenia wymagające uwagi',
  dziennik:'Historia zmian i notatki operacyjne',
  clients:'Przekrojowy widok wszystkich klientów i kont',
  admin:'Pracownicy, uprawnienia i stan synchronizacji'
});

function canonicalPageName(name) {
  const target = name === 'metaWyniki' ? 'metaMiesieczny' : name;
  const adminOnly = target === 'clients' || target === 'admin';
  if (adminOnly && !window.AUTH_CAN_ADMIN) return 'overview';
  return Object.prototype.hasOwnProperty.call(PAGE_TITLES, target) && document.getElementById('page-' + target)
    ? target : 'overview';
}

function applyPageUI(name, btn) {
  const canonical = canonicalPageName(name);
  btn = canonical === name ? (btn || navButtonForPage(canonical)) : navButtonForPage(canonical);
  name = canonical;
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  const el=document.getElementById('page-'+name);
  if (el) el.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(b=>b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  document.getElementById('pageTitle').textContent=PAGE_TITLES[name]||name;
  const subtitle = document.getElementById('pageSubtitle');
  if (subtitle) subtitle.textContent = PAGE_SUBTITLES[name] || '';

  const badge = document.getElementById('platformBadge');
  if (badge) {
    if (name.startsWith('meta')) { badge.textContent='Meta Ads'; badge.className='platform-badge meta'; }
    else if (name==='dziennik')  { badge.textContent=''; badge.className='platform-badge'; }
    else if (name==='clients' || name==='admin') { badge.textContent='Admin'; badge.className='platform-badge tools'; }
    else { badge.textContent='Google Ads'; badge.className='platform-badge google'; }
  }

  const hf = document.getElementById('headerFilters');
  hf.style.display = (name==='dziennik' || name==='admin') ? 'none' : 'flex';
  const search = document.getElementById('searchInput');
  const searchLabel = name==='clients' ? 'Szukaj klienta lub opiekuna…' : (name.startsWith('meta') ? 'Szukaj konta lub zestawu…' : 'Szukaj konta…');
  search.placeholder = searchLabel;
  search.setAttribute('aria-label', searchLabel);

  if (name==='dziennik') {
    document.getElementById('webappBanner').style.display = WEBAPP_URL ? 'none' : 'flex';
  }
  renderMetaDataNotice();
  renderComparisonHelp();
  if (name !== 'dziennik' && name !== 'admin') applyFilters();
  updateResultsCountDisplay();
  enhanceStaticDashboardTables();
  updateColumnResetButton();
  if (typeof scheduleTableScrollControlsRefresh === 'function') scheduleTableScrollControlsRefresh();
}

// Zmienia zakładkę i zapisuje ją w URL (#nazwa-zakładki), żeby dało się ją
// zapisać w zakładkach przeglądarki, wysłać w linku lub wrócić do niej po odświeżeniu.
function showPage(name,btn) {
  const canonical = canonicalPageName(name);
  if (canonical !== name) btn = navButtonForPage(canonical);
  name = canonical;
  applyPageUI(name, btn);
  if (window.location.hash.slice(1) !== name) {
    history.pushState({page: name}, '', '#' + name);
  }
}

function navButtonForPage(name) {
  name = canonicalPageName(name);
  return document.querySelector(`.nav-item[onclick*="'${name}'"]`);
}


function restorePageFromLocation() {
  const raw = (window.location.hash || '').slice(1);
  const name = canonicalPageName(raw);
  applyPageUI(name, navButtonForPage(name));
  if (raw !== name || !history.state || history.state.page !== name) {
    history.replaceState({page: name}, '', '#' + name);
  }
}

window.addEventListener('popstate', restorePageFromLocation);
window.addEventListener('hashchange', restorePageFromLocation);

// ═══════════════════════════════════════════════════════
//  DEBOUNCED HANDLERS
// ═══════════════════════════════════════════════════════
const _applyFiltersDebounced    = debounce(applyFilters,    180);
const _renderNotesListDebounced = debounce(renderNotesList, 180);

document.addEventListener('DOMContentLoaded', () => {
  ensureColumnResetButton();
  enhanceStaticDashboardTables();
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.addEventListener('input', _applyFiltersDebounced);
  }
  const dzSearch = document.getElementById('dzSearch');
  if (dzSearch) {
    dzSearch.addEventListener('input', _renderNotesListDebounced);
  }


  // Stary adres #metaWyniki także otworzy scalony raport miesięczny.
  restorePageFromLocation();
});

// Skrót „/” — fokus na wyszukiwarce aktywnej strony. Esc — czyści wyszukiwarkę.
document.addEventListener('keydown', (e) => {
  const targetTag = (e.target && e.target.tagName || '').toLowerCase();
  const isEditable = targetTag === 'input' || targetTag === 'textarea' || targetTag === 'select' || (e.target && e.target.isContentEditable);

  if (e.key === '/' && !isEditable) {
    e.preventDefault();
    const activeEl = document.querySelector('.page.active');
    const pageId = activeEl ? activeEl.id.replace('page-', '') : '';
    const input = document.getElementById(pageId === 'dziennik' ? 'dzSearch' : 'searchInput');
    if (input) input.focus();
    return;
  }

  if (e.key === 'Escape' && isEditable) {
    const id = e.target.id;
    if ((id === 'searchInput' || id === 'dzSearch') && e.target.value) {
      e.target.value = '';
      e.target.dispatchEvent(new Event('input'));
    }
  }
});

// ═══════════════════════════════════════════════════════
//  INIT — dane ładujemy dopiero po poprawnym logowaniu
// ═══════════════════════════════════════════════════════
if (typeof waitForAuth === 'function') {
  waitForAuth().then(session => {
    if (session && session.authenticated) loadAllData();
  });
} else {
  console.error('[Auth] auth.js nie został załadowany — pobieranie danych zablokowane.');
}
