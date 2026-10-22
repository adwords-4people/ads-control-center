// ═══════════════════════════════════════════════════════
//  KONFIGURACJA
// ═══════════════════════════════════════════════════════
// UWAGA — MIGRACJA: WEBAPP_URL musi wskazywać na Web App wdrożony z poziomu skryptu
// PRZYPIĘTEGO do nowego pliku (SHEET_ID poniżej), z SHEET_NAME = 'Dziennik zmian'.
// Stary URL wskazywał na poprzedni plik danych i nie zadziała tutaj — dopóki nie wklejisz
// nowego URL-a, odczyt notatek będzie działać (czyta wprost z arkusza), ale dodawanie
// i usuwanie notatek przez formularz w dashboardzie będzie zablokowane.
const WEBAPP_URL = '';

// Nowy plik źródłowy — jeden skonsolidowany skrypt zamiast osobnych skryptów per zakładka.
const SHEET_ID = '1_CMt0tZhGqT3y6wp5tTpetU7GtNtt2bKkzERg2iLNhw';

// Zakładki Google Ads adresowane po NAZWIE (nie GID) — odporne na kopiowanie arkusza
// i na przypadkową zmianę GID-ów; wykorzystuje fetchCsvByName() zamiast fetchCsv().
// UWAGA: zakładka "Konfiguracja" w tym pliku jest już nieużywana — progi czytamy teraz
// z osobnego pliku Konfiguracja (CONFIG_SHEET_ID poniżej), patrz CONFIG_SHEET_NAMES.
const SHEET_NAMES = {
  wydatki:      'Wydatki',
  audyt:        'Audyt',
  audytWart:    'Audyt - wart',
  wyniki:       'Wyniki',
  wartKonw:     'Wartość konwersji',
  anomalia:     'Anomalia',
  notatki:      'Dziennik zmian',
};

// Arkusz Meta Ads — osobny plik Google Sheets, wszystkie zakładki adresowane po GID
const META_SHEET_ID = '1_GCw4RqECUNeKisRNXSpb0ekcz1IQNxgb180ymexLOU';
const META_GIDS = {
  metaWydatki:      '833875820',
  metaAnomalia:     '1656935920',
  metaDzienny:      '121322202',
  metaMiesieczny:   '1581500139',
  metaAudyt:        '983098958',
  metaKonta:        '0',
  // UZUPEŁNIĆ po pierwszym uruchomieniu zaktualizowanego skryptu Meta (Google nadaje GID
  // dopiero przy utworzeniu zakładki) — prawy klik na zakładkę → Kopiuj link → wyciągnij
  // gid=... z URL. Do tego czasu te dwie zakładki nie wczytają się (celowo — placeholder
  // 'PODAJ_GID' zwróci błąd HTTP zamiast po cichu pokazać dane z innej zakładki).
  metaAudytWart:        '2046433272',
  metaWartoscKonwersji: '1488328459',
};

// Plik Konfiguracja — jedyne źródło progów alertowych (per konto, po ID + wiersz DOMYŚLNE)
// dla obu platform. Osobny plik od danych, adresowany po nazwie zakładki jak Google Ads.
const CONFIG_SHEET_ID = '1fy9NxgD9G52lRRie4Br9L-Y_VRVseZ4ksFmH32t5v8M';
const CONFIG_SHEET_NAMES = {
  progiGoogle: 'Progi - Google Ads',
  progiMeta:   'Progi - Meta Ads',
};

if (!SHEET_ID) console.error('[Config] Brak SHEET_ID — dashboard nie pobierze danych.');
if (!WEBAPP_URL) console.warn('[Config] Brak WEBAPP_URL — dodawanie/usuwanie notatek będzie niedostępne (odczyt działa niezależnie).');
if (!META_SHEET_ID) console.warn('[Config] Brak META_SHEET_ID — dane Meta Ads będą niedostępne.');
if (!CONFIG_SHEET_ID) console.warn('[Config] Brak CONFIG_SHEET_ID — progi spadną na wartości systemowe (DEFAULTS/META_DEFAULTS).');



// Kontrakt raportu po scaleniu. Nazwy muszą odpowiadać HEADERS_MONTHLY w GAS.
const META_MONTHLY_HEADERS = Object.freeze([
  'Data i godzina aktualizacji', // A
  'ID Konta',                    // B
  'Konto',                       // C
  'ID Zestawu',                  // D
  'Nazwa zestawu reklam',        // E
  'Cel optymalizacji',           // F
  'Koszt (Miesiąc)',             // G
  'Kliknięcia (Miesiąc)',        // H
  'CPC',                         // I
  'Wyświetlenia (Miesiąc)',      // J
  'Zasięg (Miesiąc)',            // K
  'Wynik (Miesiąc)',             // L
  'Prognoza wyniku (cały miesiąc)', // M
  'Wynik (poprzedni miesiąc)',      // N
  'Zmiana prognozy wyniku vs poprzedni miesiąc (%)' // O
]);
const META_MONTHLY_FIELDS = Object.freeze({
  updatedAt: META_MONTHLY_HEADERS[0],
  result: META_MONTHLY_HEADERS[11],
  forecast: META_MONTHLY_HEADERS[12],
  previous: META_MONTHLY_HEADERS[13],
  change: META_MONTHLY_HEADERS[14],
});
// Skracamy tylko etykiety. Odczyt i sortowanie nadal używają pełnych nazw z CSV.
const META_MONTHLY_LABELS = Object.freeze({
  [META_MONTHLY_FIELDS.forecast]: 'Prognoza miesiąca',
  [META_MONTHLY_FIELDS.previous]: 'Wynik poprzedni miesiąc',
  [META_MONTHLY_FIELDS.change]: 'Zmiana prognozy (%)',
});

let DATA = {};
let NOTES = [];
let ALL_KONTA = [];
let GOOGLE_KONTA = [];
let META_KONTA = [];

// ── LICZNIK WYNIKÓW ─────────────────────────────────────
// Klucz: nazwa strony (np. 'wydatki', 'overview'), wartość: {shown, total}
let PAGE_COUNTS = {};

function updateResultsCountDisplay() {
  const el = document.getElementById('resultsCount');
  if (!el) return;
  const activeEl = document.querySelector('.page.active');
  const pageId = activeEl ? activeEl.id.replace('page-', '') : '';
  const c = PAGE_COUNTS[pageId];
  if (!c) { el.textContent = ''; return; }
  el.textContent = c.shown === c.total
    ? `${c.total} ${plural(c.total, 'wynik', 'wyniki', 'wyników')}`
    : `${c.shown} z ${c.total} ${plural(c.total, 'wynik', 'wyniki', 'wyników')}`;
}

// ── STAN SORTOWANIA ────────────────────────────────────
// Klucz: bodyId tabeli (np. 'wydatkiBody'), wartość: {col, dir}
let SORT_STATE = {};

// Sortuje tablicę wierszy wg podanej kolumny.
// Automatycznie wykrywa czy wartości są numeryczne (obsługuje spacje, %, PLN, przecinek dec.).
function sortData(data, col, dir) {
  if (!col) return data;
  return [...data].sort(function(a, b) {
    var va = String(a[col] !== undefined ? a[col] : '');
    var vb = String(b[col] !== undefined ? b[col] : '');
    // Parsowanie polskich liczb: "1 234,56 zł" → 1234.56
    function toNum(s) {
      var c = s.replace(/[%\s\u00a0]/g,'')
               .replace(/[^\d,.\-]/g,'')
               .replace(/\.(?=\d{3}(,|$))/g,'')
               .replace(',','.');
      return parseFloat(c);
    }
    var na = toNum(va), nb = toNum(vb);
    var cmp = 0;
    if (!isNaN(na) && !isNaN(nb)) {
      cmp = na - nb;
    } else {
      cmp = va.localeCompare(vb, 'pl', {sensitivity:'base'});
    }
    return dir === 'desc' ? -cmp : cmp;
  });
}

// ── FLAGI NOTATEK ──────────────────────────────────────
let notesLoading = false;

let dataAbortController = null;

// ─── debounce ───────────────────────────────────────────
function debounce(fn, ms) {
  let timer;
  return function(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), ms);
  };
}

// ═══════════════════════════════════════════════════════
//  PROGI ALERTÓW — DOMYŚLNE I PER KONTO
// ═══════════════════════════════════════════════════════
// Wspolna polityka kolorowania Google Ads i Meta Ads.
// Liczby oznaczaja procent zmiany: 30 = 30%, nie 0.30.
// Nadpisania: konto -> DOMYSLNE tej platformy -> wspolne wartosci ponizej.
const COMPARISON_DEFAULTS = Object.freeze({
  anomalia_spadek_amber: 30,
  anomalia_spadek_red: 50,
  anomalia_wzrost: 100,
  trend_spadek_amber: 30,
  trend_spadek_red: 50,
  trend_wzrost: 30,
});
const COMPARISON_FIELDS = Object.freeze({
  anomalia_spadek_amber: {header: 'Anomalia_spadek_amber', aliases: ['Spadek_amber'], max: 100},
  anomalia_spadek_red:   {header: 'Anomalia_spadek_red', aliases: ['Anomalia_spadek', 'Spadek_red'], max: 100},
  anomalia_wzrost:      {header: 'Anomalia_wzrost', aliases: []},
  trend_spadek_amber:   {header: 'Trend_spadek_amber', aliases: ['Spadek_amber'], max: 100},
  trend_spadek_red:     {header: 'Trend_spadek_red', aliases: ['Spadek_red'], max: 100},
  trend_wzrost:        {header: 'Trend_wzrost', aliases: []},
});
const COMPARISON_WARNINGS = new Map();
const COMPARISON_PAGES = new Set(['overview', 'metaOverview', 'anomalia', 'metaAnomalia', 'audyt', 'audytWart', 'metaAudyt', 'metaAudytWart']);

// Nie uznajemy braku danych, NaN ani tekstu za zero. Zero jest poprawna wartoscia.
function parseComparisonNumber(value) {
  if (value === null || value === undefined || typeof value === 'boolean') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = String(value).trim().replace(/−/g, '-');
  if (!/^[+-]?(?:\d+(?:[   ]\d{3})*)(?:[.,]\d+)?\s*%?$/.test(text)) return null;
  const n = Number(text.replace(/[\s  %]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function warnComparisonConfig(platform, message) {
  const key = platform + ':' + message;
  if (!COMPARISON_WARNINGS.has(key)) {
    COMPARISON_WARNINGS.set(key, {platform, message});
    console.warn('[Progi porównań] ' + message);
  }
}

function buildComparisonConfig(row, platform) {
  const result = Object.create(null);
  const account = String(row['Konto'] ?? '').trim();
  Object.entries(COMPARISON_FIELDS).forEach(([field, spec]) => {
    for (const header of [spec.header, ...spec.aliases]) {
      const raw = row[header];
      if (raw === undefined || raw === null || String(raw).trim() === '') continue;
      const value = parseComparisonNumber(raw);
      if (value === null || value <= 0 || (spec.max && value > spec.max)) {
        warnComparisonConfig(platform, account + ': nieprawidłowy próg ' + header + '. Użyto kolejnej dostępnej wartości lub progu domyślnego.');
        continue;
      }
      result[field] = {value, header};
      break;
    }
  });
  return result;
}

function getComparisonThresholds(platform, konto, accountId) {
  const meta = platform === 'meta';
  const cfg = (meta ? DATA._metaConfig : DATA._config) || {};
  const map = (meta ? DATA._nameToIdMeta : DATA._nameToId) || {};
  const id = String(accountId ?? '').trim() || map[konto] || konto;
  const normalizedId = meta ? normalizeMetaAccountId(id) : String(id ?? '').replace(/[-\s]/g, '');
  const accountRow = cfg[id] || cfg[normalizedId] || (meta ? cfg['act_' + normalizedId] : null);
  const defaultRow = cfg['DOMYŚLNE'];
  const cache = DATA._comparisonThresholdCache || (DATA._comparisonThresholdCache = new Map());
  const key = JSON.stringify([platform, id, konto]);
  if (cache.has(key)) return cache.get(key);
  const t = {};
  const sources = [];
  Object.keys(COMPARISON_FIELDS).forEach(field => {
    const own = accountRow && accountRow._comparison && accountRow._comparison[field];
    const def = defaultRow && defaultRow._comparison && defaultRow._comparison[field];
    const entry = own || def;
    t[field] = entry ? entry.value : COMPARISON_DEFAULTS[field];
    if (entry) sources.push((own ? 'konto ' + id : 'DOMYŚLNE') + ': ' + entry.header);
  });
  // Sprzecznych progow nie odwracamy po cichu. Oba progi spadku wracaja do wspolnej pary.
  for (const mode of ['anomalia', 'trend']) {
    const amber = mode + '_spadek_amber';
    const red = mode + '_spadek_red';
    if (t[amber] > t[red]) {
      warnComparisonConfig(platform, String(konto || id) + ': ' + mode + ' - próg pomarańczowy jest większy od czerwonego. Dla tej pary użyto 30% / 50%.');
      t[amber] = COMPARISON_DEFAULTS[amber];
      t[red] = COMPARISON_DEFAULTS[red];
    }
  }
  t.sources = [...new Set(sources)].join('; ') || 'wspólne progi domyślne';
  cache.set(key, t);
  return t;
}

// Wspolny klasyfikator: ta sama zmiana i te same progi = ten sam kolor.
// Dzienny wzrost jest ostrzezeniem, wzrost trendu oznacza kierunek, nie rentownosc.
function comparisonClass(change, mode, t) {
  if (change === null || !Number.isFinite(change) || change < -100) return 'metric-empty';
  const prefix = mode === 'anomaly' ? 'anomalia' : 'trend';
  if (change <= -t[prefix + '_spadek_red']) return 'metric-red';
  if (change <= -t[prefix + '_spadek_amber']) return 'metric-amber';
  if (change >= t[prefix + '_wzrost']) return mode === 'anomaly' ? 'metric-amber' : 'metric-green';
  return 'metric-gray';
}

function formatComparisonMetric(value, mode, platform, konto, accountId, inputKind = 'delta') {
  const n = parseComparisonNumber(value);
  const change = n === null ? null : (inputKind === 'ratio' ? n - 100 : n);
  const t = getComparisonThresholds(platform, konto, accountId);
  const cls = comparisonClass(change, mode, t);
  if (cls === 'metric-empty') {
    return '<span class="metric-empty" data-comparison="' + mode + '" title="Brak poprawnego porównania: brak danych, zerowa podstawa lub nieprawidłowa wartość">—</span>';
  }
  const prefix = mode === 'anomaly' ? 'anomalia' : 'trend';
  const label = (inputKind === 'delta' && n > 0 ? '+' : '') + fmtPct(n);
  const unit = inputKind === 'ratio'
    ? 'Relacja do bazy: 100% = bez zmian. Zmiana: ' + (change > 0 ? '+' : '') + fmtPct(change) + '. '
    : 'Zmiana względem bazy: 0% = bez zmian. ';
  const meaning = mode === 'anomaly'
    ? 'Anomalia dzienna: duży wzrost to ostrzeżenie, nie zielony sukces. '
    : 'Trend: zielony oznacza wzrost raportowanej metryki, nie potwierdzenie rentowności. ';
  const rules = 'Spadek od ' + t[prefix + '_spadek_amber'] + '%: pomarańczowy; od ' + t[prefix + '_spadek_red'] + '%: czerwony. Wzrost od ' + t[prefix + '_wzrost'] + '%: ' + (mode === 'anomaly' ? 'pomarańczowy' : 'zielony') + '. ';
  return '<span class="' + cls + '" data-comparison="' + mode + '" data-change="' + change + '" title="' + escHtml(unit + meaning + rules + 'Konfiguracja: ' + t.sources) + '">' + escHtml(label) + '</span>';
}

const DAILY_COMPARISON_HEADERS = new Set(['Status kliknięć', 'Status wyświetleń', 'Zmiana % Wyświetleń (przedwczoraj → wczoraj)']);
const GOOGLE_TREND_HEADERS = new Set(['Współczynnik kliknięc', 'Współczynnik kliknięć', 'Współczynnik wyświetleń', 'Współczynnik konwersji', 'Współczynnik Wart konwersji']);
const META_COMPARISON_BASES = Object.freeze({
  'Status wyświetleń': ['Wyświetlenia (wczoraj)', 'Wyświetlenia (przedwczoraj)'],
  'Zmiana % Wyświetleń (przedwczoraj → wczoraj)': ['Wyświetlenia (wczoraj)', 'Wyświetlenia (przedwczoraj)'],
  'Zmiana % Wyświetleń (30 dni vs 90 dni→30d)': ['Wyświetlenia (30 dni)', 'Wyświetlenia (90 dni → odpowiednik 30-dniowy)'],
  'Zmiana % Zasięgu (30 dni vs 90 dni→30d)': ['Zasięg (30 dni)', 'Zasięg (90 dni → odpowiednik 30-dniowy)'],
  'Zmiana % Wyniku (30 dni vs 90 dni→30d)': ['Wynik (30 dni)', 'Wynik (90 dni → odpowiednik 30-dniowy)'],
  'Zmiana % Wartości konwersji (30 dni vs 90 dni→30d)': ['Wartość konwersji (30 dni)', 'Wartość konwersji (90 dni → odpowiednik 30-dniowy)'],
});

function comparisonColumnSpec(header, platform, bodyId) {
  if ((bodyId === 'anomaliaBody' || bodyId === 'metaAnomaliaBody') && DAILY_COMPARISON_HEADERS.has(header)) {
    return {mode: 'anomaly', inputKind: 'delta'};
  }
  if (platform === 'google' && (bodyId === 'audytBody' || bodyId === 'audytWartBody') && GOOGLE_TREND_HEADERS.has(header)) {
    return {mode: 'trend', inputKind: 'ratio'};
  }
  if (platform === 'meta' && (bodyId === 'metaAudytBody' || bodyId === 'metaAudytWartBody') && header.includes('30 dni vs 90 dni') && META_COMPARISON_BASES[header]) {
    return {mode: 'trend', inputKind: 'delta'};
  }
  return null;
}

// Przeglad i tabela szczegolowa korzystaja z identycznego zrodla porownania.
// Awaryjne wyliczenie Meta dopuszczamy tylko przy dwoch znanych liczbach i bazie > 0.
function comparisonCellValue(header, row, platform) {
  const value = row && row[header];
  if (value !== null && value !== undefined && String(value).trim() !== '') return value;
  if (platform !== 'meta' || !META_COMPARISON_BASES[header]) return null;
  const [currentHeader, baseHeader] = META_COMPARISON_BASES[header];
  const current = parseComparisonNumber(row && row[currentHeader]);
  const base = parseComparisonNumber(row && row[baseHeader]);
  if (current === null || base === null || current < 0 || base <= 0) return null;
  const pct = ((current - base) / base) * 100;
  return Number.isFinite(pct) ? Math.round(pct * 100) / 100 : null;
}

// Sortujemy te same liczby, ktore widac w komorkach; brak porownania zawsze na koncu.
function sortComparisonRows(rows, header, spec, platform, direction) {
  function numberFor(row) {
    const n = parseComparisonNumber(comparisonCellValue(header, row, platform));
    const delta = n === null ? null : (spec.inputKind === 'ratio' ? n - 100 : n);
    return delta === null || delta < -100 ? null : n;
  }
  return rows.map(row => ({row, value: numberFor(row)})).sort((a, b) => {
    if (a.value === null && b.value === null) return 0;
    if (a.value === null) return 1;
    if (b.value === null) return -1;
    return (a.value - b.value) * (direction === 'desc' ? -1 : 1);
  }).map(item => item.row);
}

function renderComparisonHelp() {
  const active = document.querySelector('.page.active');
  const name = active ? active.id.replace('page-', '') : '';
  const el = document.getElementById('comparisonLegend');
  const notice = document.getElementById('comparisonConfigNotice');
  if (!el || !notice) return;
  el.hidden = !COMPARISON_PAGES.has(name);
  const meta = name.startsWith('meta');
  const warnings = [...COMPARISON_WARNINGS.values()].filter(w => w.platform === (meta ? 'meta' : 'google'));
  notice.hidden = el.hidden || warnings.length === 0;
  notice.textContent = warnings.map(w => w.message).join(' ');
  document.getElementById('comparisonLegendBody').textContent =
    'Te same zasady dla Google Ads i Meta Ads. Domyślnie: spadek od ' + COMPARISON_DEFAULTS.anomalia_spadek_amber + '% ostrzega, od ' + COMPARISON_DEFAULTS.anomalia_spadek_red + '% jest czerwony. Dzienny wzrost od ' + COMPARISON_DEFAULTS.anomalia_wzrost + '% ostrzega; wzrost trendu od ' + COMPARISON_DEFAULTS.trend_wzrost + '% jest zielony (wzrost metryki, nie rentowność). Progi konta mają pierwszeństwo — najedź na wartość, aby je zobaczyć. W audytach Google 100% oznacza brak zmian; w zmianach Meta brak zmian to 0%. Brak porównania pozostaje kreską.';
}


const DEFAULTS = {
  budzet_min:      90,
  budzet_max:     110,
  roas_min:       300,
  roas_amber:     500,
  roas_red:       300,
  konw_min:         1,
  konw_pct_min:    75,
  anomalia_spadek: 100, // legacy; alerty korzystaja z COMPARISON_DEFAULTS oraz _comparison
  anomalia_wzrost: 100,
};

// buildConfig działa identycznie niezależnie od tego, czy kolumna "Konto" w arkuszu Progi
// zawiera ID konta, czy literał "DOMYŚLNE" — to tylko klucz mapy, bez znaczenia semantycznego
// na tym etapie.
function buildConfig(rows) {
  const cfg = {};
  (rows || []).forEach(function(r) {
    const konto = (r['Konto'] || '').trim();
    if (!konto) return;
    cfg[konto] = {
      _comparison: buildComparisonConfig(r, 'google'),
      budzet_min:      r['Budzet_min']      !== '' && r['Budzet_min']      !== undefined ? parseNum(r['Budzet_min'])      : undefined,
      budzet_max:      r['Budzet_max']      !== '' && r['Budzet_max']      !== undefined ? parseNum(r['Budzet_max'])      : undefined,
      roas_amber:      r['ROAS_amber']      !== '' && r['ROAS_amber']      !== undefined ? parseNum(r['ROAS_amber'])      : undefined,
      roas_red:        r['ROAS_red']        !== '' && r['ROAS_red']        !== undefined ? parseNum(r['ROAS_red'])        : undefined,
      konw_min:        r['Konw_min']        !== '' && r['Konw_min']        !== undefined ? parseNum(r['Konw_min'])        : undefined,
      konw_pct_min:    r['Konw_pct_min']    !== '' && r['Konw_pct_min']    !== undefined ? parseNum(r['Konw_pct_min'])    : undefined,
      anomalia_spadek: r['Anomalia_spadek'] !== '' && r['Anomalia_spadek'] !== undefined ? parseNum(r['Anomalia_spadek']) : undefined,
      anomalia_wzrost: r['Anomalia_wzrost'] !== '' && r['Anomalia_wzrost'] !== undefined ? parseNum(r['Anomalia_wzrost']) : undefined,
    };
  });
  return cfg;
}

// Mapa nazwa konta -> ID konta, budowana z zakładki Wydatki (jedyna, która ma zawsze
// obecną kolumnę "ID Konta" dla każdego zsynchronizowanego konta — patrz buildNameToIdMap
// przy DATA._nameToId / DATA._nameToIdMeta).
//
// getThresholds/getMetaThresholds przyjmują NAZWĘ konta (tak jak dotąd wszędzie w kodzie —
// formatCell, renderOverview, renderMetaOverview — żadne wywołanie nie musiało się zmienić),
// ale wewnątrz tłumaczą ją na ID i szukają progu w trzech krokach:
//   1) wiersz w arkuszu Progi kluczowany tym ID (nadpisania per konto),
//   2) wiersz "DOMYŚLNE" w tym samym arkuszu (polityka agencyjna, edytowalna bez kodu),
//   3) hardkodowane DEFAULTS/META_DEFAULTS poniżej — ostatnia siatka bezpieczeństwa,
//      gdyby plik Konfiguracja był akurat niedostępny.
// Kaskada działa per pole, nie per cały wiersz — częściowo wypełniony wiersz per-konto
// (np. tylko Budzet_min) nadal korzysta z DOMYŚLNE/DEFAULTS dla pozostałych pól.
function getThresholds(konto) {
  const cfg = DATA._config || {};
  const nameToId = DATA._nameToId || {};
  const id = nameToId[konto] || konto; // fallback: konto mogło już być ID
  const idRow = cfg[id];
  const defaultRow = cfg['DOMYŚLNE'];
  function pick(field) {
    if (idRow && idRow[field] !== undefined) return idRow[field];
    if (defaultRow && defaultRow[field] !== undefined) return defaultRow[field];
    return DEFAULTS[field];
  }
  return {
    budzet_min:      pick('budzet_min'),
    budzet_max:      pick('budzet_max'),
    roas_amber:      pick('roas_amber'),
    roas_red:        pick('roas_red'),
    konw_min:        pick('konw_min'),
    konw_pct_min:    pick('konw_pct_min'),
    anomalia_spadek: pick('anomalia_spadek'),
    anomalia_wzrost: pick('anomalia_wzrost'),
  };
}

// ═══════════════════════════════════════════════════════
//  PROGI ALERTÓW META ADS — DOMYŚLNE I PER KONTO
//  Arkusz "Progi - Meta Ads" w pliku Konfiguracja: kolumny Konto (ID konta lub "DOMYŚLNE"),
//  Budzet_min, Budzet_max, ROAS_amber, ROAS_red, Konw_min, Konw_pct_min
//  oraz wspólne progi anomalii/trendów.
// ═══════════════════════════════════════════════════════
const META_DEFAULTS = {
  budzet_min:    80,
  budzet_max:   110,
  roas_amber:   500,
  roas_red:     300,
  spadek_amber:  30,
  spadek_red:    50,
  konw_min:       1,
  konw_pct_min:  75,
};

function buildMetaConfig(rows) {
  const cfg = {};
  (rows || []).forEach(function(r) {
    const konto = (r['Konto'] || '').trim();
    if (!konto) return;
    cfg[konto] = {
      _comparison: buildComparisonConfig(r, 'meta'),
      budzet_min:   r['Budzet_min']   !== '' && r['Budzet_min']   !== undefined ? parseNum(r['Budzet_min'])   : undefined,
      budzet_max:   r['Budzet_max']   !== '' && r['Budzet_max']   !== undefined ? parseNum(r['Budzet_max'])   : undefined,
      roas_amber:   r['ROAS_amber']   !== '' && r['ROAS_amber']   !== undefined ? parseNum(r['ROAS_amber'])   : undefined,
      roas_red:     r['ROAS_red']     !== '' && r['ROAS_red']     !== undefined ? parseNum(r['ROAS_red'])     : undefined,
      spadek_amber: r['Spadek_amber'] !== '' && r['Spadek_amber'] !== undefined ? parseNum(r['Spadek_amber']) : undefined,
      spadek_red:   r['Spadek_red']   !== '' && r['Spadek_red']   !== undefined ? parseNum(r['Spadek_red'])   : undefined,
      konw_min:     r['Konw_min']     !== '' && r['Konw_min']     !== undefined ? parseNum(r['Konw_min'])     : undefined,
      konw_pct_min: r['Konw_pct_min'] !== '' && r['Konw_pct_min'] !== undefined ? parseNum(r['Konw_pct_min']) : undefined,
    };
  });
  return cfg;
}

// Patrz komentarz przy getThresholds() — identyczna kaskada ID → DOMYŚLNE → META_DEFAULTS,
// tylko przez mapę DATA._nameToIdMeta (budowaną z zakładki Wydatki pliku Meta Ads).
function getMetaThresholds(konto, accountId) {
  const cfg = DATA._metaConfig || {};
  const nameToId = DATA._nameToIdMeta || {};
  // ID z wiersza ma pierwszeństwo; zgodność z ID zapisanymi z prefiksem act_ lub bez niego.
  const id = String(accountId ?? '').trim() || nameToId[konto] || konto;
  const normalizedId = normalizeMetaAccountId(id);
  const idRow = cfg[id] || cfg[normalizedId] || cfg['act_' + normalizedId];
  const defaultRow = cfg['DOMYŚLNE'];
  function pick(field) {
    if (idRow && idRow[field] !== undefined) return idRow[field];
    if (defaultRow && defaultRow[field] !== undefined) return defaultRow[field];
    return META_DEFAULTS[field];
  }
  return {
    budzet_min:   pick('budzet_min'),
    budzet_max:   pick('budzet_max'),
    roas_amber:   pick('roas_amber'),
    roas_red:     pick('roas_red'),
    spadek_amber: pick('spadek_amber'),
    spadek_red:   pick('spadek_red'),
    konw_min:     pick('konw_min'),
    konw_pct_min: pick('konw_pct_min'),
  };
}

// ═══════════════════════════════════════════════════════
//  CSV / DANE
// ═══════════════════════════════════════════════════════
function csvUrl(gid, sheetId) {
  return `https://docs.google.com/spreadsheets/d/${sheetId || SHEET_ID}/export?format=csv&gid=${gid}`;
}
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = '';
  let inQ = false;
  const src = String(text || '').replace(/^\uFEFF/, '');

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQ) {
      if (c === '"') {
        if (src[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else {
        cur += c;
      }
      continue;
    }
    if (c === '"') inQ = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (c !== '\r') cur += c;
  }

  if (cur !== '' || row.length || src.endsWith(',')) {
    row.push(cur);
    rows.push(row);
  }
  return rows.filter(r => r.some(v => String(v).trim() !== ''));
}


function validateMetaMonthlyHeaders(rows, text) {
  if (/^\s*(?:<!doctype|<html|<head|<body)/i.test(text)) {
    throw new Error('Raport miesięczny Meta: serwer zwrócił stronę HTML zamiast CSV. Sprawdź dostęp do arkusza i GID.');
  }
  const headers = (rows[0] || []).map(h => String(h).trim());
  const missing = META_MONTHLY_HEADERS.filter(h => !headers.includes(h));
  const duplicate = META_MONTHLY_HEADERS.filter(h => headers.filter(v => v === h).length > 1);
  if (missing.length || duplicate.length) {
    const details = [
      missing.length ? 'Brak kolumn: ' + missing.join('; ') : '',
      duplicate.length ? 'Powtórzone kolumny: ' + duplicate.join('; ') : '',
    ].filter(Boolean).join('. ');
    throw new Error('Raport miesięczny Meta ma niezgodny format. Uruchom zaktualizowany skrypt Meta Ads i sprawdź GID zakładki Raport_Miesieczny. ' + details);
  }
}

async function fetchCsv(gid, signal, sheetId, validateMonthly = false) {
  const r = await fetch(csvUrl(gid, sheetId), { signal });
  if (!r.ok) throw new Error(`HTTP ${r.status} dla GID ${gid}`);
  const text = await r.text();
  const rows = parseCsv(text);
  // Walidacja przed sprawdzeniem liczby danych: działa również dla samych nagłówków.
  if (validateMonthly) validateMetaMonthlyHeaders(rows, text);
  const headers = (rows[0] || []).map(h => h.trim());
  const result = rows.slice(1).map(vals => {
    const obj = {};
    headers.forEach((k,i) => {
      if (!k) return;
      const v = (vals[i] || '').trim();
      if (!(k in obj) || obj[k] === '') obj[k] = v;
    });
    return obj;
  }).filter(row => Object.values(row).some(v => v !== ''));
  Object.defineProperty(result, '_headers', { value: headers, enumerable: false });
  return result;
}

// Wersja dla arkuszy adresowanych po nazwie zakładki (np. arkusz Meta Ads)
function csvUrlByName(sheetId, sheetName) {
  return `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheetName)}`;
}
async function fetchCsvByName(sheetId, sheetName, signal) {
  const r = await fetch(csvUrlByName(sheetId, sheetName), { signal });
  if (!r.ok) throw new Error(`HTTP ${r.status} dla zakładki "${sheetName}"`);
  const text = await r.text();
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const headers = rows[0];
  return rows.slice(1).map(vals => {
    const obj = {};
    headers.forEach((h,i) => {
      const k=h.trim(); if(!k) return;
      const v=(vals[i]||'').trim();
      if (!(k in obj) || obj[k] === '') obj[k] = v;
    });
    return obj;
  }).filter(r => Object.values(r).some(v => v !== ''));
}

function parseNum(s) {
  if (s === undefined || s === null || s === '') return 0;
  const c = String(s)
    .replace(/[%\s\u00a0]/g, '')
    .replace(/[^\d,.\-]/g, '')
    .replace(/\.(?=\d{3}(,|$))/g, '')
    .replace(/,/g, '.');
  const parts = c.split('.');
  const cleaned = parts.length > 2
    ? parts.slice(0, -1).join('') + '.' + parts[parts.length - 1]
    : c;
  return parseFloat(cleaned) || 0;
}

function fmtZl(n)  { return Math.round(n).toLocaleString('pl-PL')+' zł'; }
function fmtPct(n) { return n.toFixed(2).replace('.', ',')+' %'; }

// ═══════════════════════════════════════════════════════
