# PPC Control Center — Auth v2 / podgląd jako użytkownik

## Co robi ta wersja
- Admin widzi selektor „Podgląd jako” i może przetestować widok Managera/Specjalisty bez ich logowania.
- `api/data` filtruje raporty po stronie backendu według aktywnego użytkownika/roli.
- Admin: pełny widok.
- Manager: konta wszystkich aktywnych użytkowników z tego samego Teamu.
- Specjalista: tylko konta przypisane do jego emaila.
- Google Ads: email -> `MCK - Google Ads` -> `MCK_ID` -> `Konta - Google Ads`.
- Meta Ads: email -> `Konta - Meta Ads`.

## Pliki do podmiany/dodania
Podmień/dodaj całą zawartość tej paczki w root repo (zachowując foldery `api/`).
Nie usuwaj `styles.css` ani `notes.js`.

## Environment Variables
Wystarczą istniejące:
- GOOGLE_CLIENT_ID
- GOOGLE_CLIENT_SECRET
- APP_URL
- ALLOWED_DOMAIN
- CONFIG_SHEET_ID
- AUTH_SECRET

Opcjonalnie możesz dodać:
- GOOGLE_DATA_SHEET_ID
- META_DATA_SHEET_ID
Jeśli ich nie dodasz, kod użyje firmowych ID już wpisanych jako wartości domyślne.

## Test bez Adriana
1. Zaloguj się jako Karol/Admin.
2. W nagłówku wybierz `Podgląd jako -> Adrian Felis — Specjalista · PPC`.
3. Strona przeładuje się i pokaże żółty pasek „Tryb testowy”.
4. Dane są pobierane przez `/api/data` i filtrowane jak dla Adriana.
5. Wybierz `Własny widok — Karol (Admin)`, aby wrócić do pełnego widoku.

## Ważne ograniczenie bezpieczeństwa
Na tym etapie aplikacja filtruje dane po backendzie, ale same Google Sheets nadal są publicznie czytelne przez link/CSV. To znaczy, że ten etap testuje poprawność uprawnień w aplikacji, ale pełne bezpieczeństwo wymaga później ustawienia arkuszy jako prywatne i odczytu przez konto serwisowe / Google Sheets API.
