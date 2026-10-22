# PPC Control Center — Google Workspace Auth v1

## Co podmienić / dodać w GitHub

Podmień istniejące pliki:
- `index.html`
- `dashboard.js`

Dodaj nowe pliki:
- `auth.js`
- `auth.css`
- `api/_lib/auth.js`
- `api/_lib/users.js`
- `api/auth/login.js`
- `api/auth/callback.js`
- `api/me.js`
- `api/logout.js`

Nie zmieniaj w tym wdrożeniu:
- `data.js`
- `notes.js`
- `styles.css`

## Wymagane Environment Variables w Vercel — Production

- `GOOGLE_CLIENT_ID` — Config
- `GOOGLE_CLIENT_SECRET` — Secret
- `APP_URL=https://ppccontrolcenter.vercel.app` — Config
- `ALLOWED_DOMAIN=4people.pl` — Config
- `CONFIG_SHEET_ID=1fy9NxgD9G52lRRie4Br9L-Y_VRVseZ4ksFmH32t5v8M` — Config
- `AUTH_SECRET` — Secret, losowy ciąg min. 32 znaki

## Google OAuth

OAuth Client type: `Web application`

Authorized origin:
`https://ppccontrolcenter.vercel.app`

Authorized redirect URI:
`https://ppccontrolcenter.vercel.app/api/auth/callback`

## Po wgraniu

1. Commit do `main`, np. `Add Google Workspace authentication`.
2. Poczekaj na automatyczny Production deployment w Vercel.
3. Nie trzeba osobno klikać Redeploy, jeśli commit utworzył nowy deployment po dodaniu env vars.
4. Otwórz `https://ppccontrolcenter.vercel.app` w Incognito.
5. Przed zalogowaniem dashboard nie powinien pobierać danych — powinien pojawić się ekran Google Workspace.
6. Zaloguj się aktywnym użytkownikiem z zakładki `Użytkownicy`.
7. Po powrocie powinien pojawić się dashboard oraz użytkownik / rola / team w nagłówku.

## Uwaga bezpieczeństwa

To jest Auth v1. Logowanie jest serwerowe, ale dane reklamowe nadal są pobierane z Google Sheets przez obecny mechanizm CSV. Pełne ograniczenie danych per użytkownik będzie kolejnym etapem — backend API + filtrowanie rekordów + zamknięcie publicznego CSV.
