# PPC Control Center — Auth v3 / prywatne Google Sheets

## Co zmienia v3
Auth v2 (Google Workspace, role, Team, „Podgląd jako”) zostaje bez zmian.
Zmienia się wyłącznie sposób, w jaki backend Vercela czyta arkusze:

- wcześniej: publiczny CSV / gviz,
- teraz: Google Sheets API + konto serwisowe,
- brak fallbacku do publicznego CSV — jeśli konto serwisowe nie ma dostępu, backend zgłasza błąd.

Dzięki temu po poprawnym teście można ustawić arkusze jako `Ograniczony / Restricted`.

## Nowe Environment Variables
Dodaj w Vercel (Production):

- `GOOGLE_SERVICE_ACCOUNT_EMAIL` — Config
- `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` — Secret

Pozostają istniejące:
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `APP_URL`
- `ALLOWED_DOMAIN`
- `CONFIG_SHEET_ID`
- `AUTH_SECRET`

Opcjonalne (kod ma firmowe wartości domyślne):
- `GOOGLE_DATA_SHEET_ID`
- `META_DATA_SHEET_ID`

## Google Cloud — konfiguracja konta serwisowego
1. W tym samym projekcie Google Cloud włącz `Google Sheets API`.
2. IAM & Admin -> Service Accounts -> Create service account.
3. Nazwa np. `ppc-control-center-sheets`.
4. Nie nadawaj roli projektowej — do odczytu konkretnych plików nie jest potrzebna.
5. Wejdź w konto serwisowe -> Keys -> Add key -> Create new key -> JSON.
6. Z pobranego JSON skopiuj:
   - `client_email` -> `GOOGLE_SERVICE_ACCOUNT_EMAIL`
   - `private_key` -> `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY`
7. Pliku JSON nie wrzucaj do GitHub i po zapisaniu sekretu trzymaj go bezpiecznie albo usuń z komputera.

## Udostępnij 3 arkusze kontu serwisowemu
W każdym pliku kliknij Udostępnij i dodaj email konta serwisowego jako `Wyświetlający / Viewer`:

1. Konfiguracja:
   `1fy9NxgD9G52lRRie4Br9L-Y_VRVseZ4ksFmH32t5v8M`
2. Google Ads data:
   `1_CMt0tZhGqT3y6wp5tTpetU7GtNtt2bKkzERg2iLNhw`
3. Meta Ads data:
   `1_GCw4RqECUNeKisRNXSpb0ekcz1IQNxgb180ymexLOU`

Na tym etapie NIE wyłączaj jeszcze „każdy z linkiem”. Najpierw wdroż v3 i wykonaj check.

## Test przed zamknięciem arkuszy
Po deployu zaloguj się jako Admin i otwórz:

`https://ppccontrolcenter.vercel.app/api/admin/sheets-check`

Oczekiwane:
- `"ok": true`
- wszystkie pozycje `checks[].ok = true`
- widoczny właściwy `serviceAccountEmail`

Następnie sprawdź normalny dashboard i `Podgląd jako Adrian/Kinga`.

## Zamknięcie publicznego dostępu
Dopiero po poprawnym checku:
1. Otwórz każdy z 3 arkuszy.
2. Udostępnij -> Dostęp ogólny / General access.
3. Zmień `Każdy, kto ma link` na `Ograniczony / Restricted`.
4. NIE usuwaj konta serwisowego z listy osób mających dostęp.
5. Zostaw skrypty Google Ads / Meta Ads z ich obecnymi uprawnieniami — zapisują dane niezależnie od Vercela.

Po zamknięciu ponownie:
- `/api/admin/sheets-check` -> `ok: true`
- Admin -> wszystkie konta
- Podgląd Adrian -> tylko Adrian
- Podgląd Kinga -> team PPC

## Rotacja klucza
Klucz konta serwisowego jest długoterminowym sekretem. Trzymaj go tylko w Vercel Secret, nie w repo.
W razie wycieku utwórz nowy key, zaktualizuj Vercel, a stary key usuń w Google Cloud.
