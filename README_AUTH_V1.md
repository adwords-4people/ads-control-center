# Google Workspace Auth v1 — PPC Control Center

Cel tego etapu: logowanie Google Workspace + rozpoznanie użytkownika, roli i teamu z zakładki `Użytkownicy`. Dane reklamowe nadal pochodzą z obecnych Google Sheets — filtrowanie danych po roli będzie następnym etapem.

## 1. Pliki do dodania do repo

Skopiuj do katalogu głównego repo:
- `auth.js`
- `auth.css`
- cały katalog `api/`

## 2. Dwie małe zmiany w istniejących plikach

### index.html — w `<head>` po `styles.css`

```html
<link rel="stylesheet" href="auth.css">
<script>document.documentElement.classList.add('auth-pending')</script>
```

### index.html — na dole, przed `dashboard.js`

Zmień:
```html
<script src="data.js"></script>
<script src="notes.js"></script>
<script src="dashboard.js"></script>
```

na:
```html
<script src="data.js"></script>
<script src="notes.js"></script>
<script src="auth.js"></script>
<script src="dashboard.js"></script>
```

### dashboard.js — ostatnia linia

Zmień:
```js
loadAllData();
```

na:
```js
if (typeof waitForAuth === 'function') {
  waitForAuth().then(session => {
    if (session && session.authenticated) loadAllData();
  });
} else {
  console.error('[Auth] auth.js nie został załadowany — pobieranie danych zablokowane.');
}
```

## 3. Google Cloud — OAuth Client

W Google Cloud Console utwórz OAuth Client ID typu `Web application`.

Authorized JavaScript origin:
- `https://ppccontrolcenter.vercel.app`

Authorized redirect URI:
- `https://ppccontrolcenter.vercel.app/api/auth/callback`

Jeżeli później przejdziesz na `dashboard.4people.pl`, dodamy drugi origin i redirect URI.

## 4. Vercel — Environment Variables

Dodaj w Project Settings -> Environment Variables:

- `GOOGLE_CLIENT_ID` — Client ID z Google Cloud
- `GOOGLE_CLIENT_SECRET` — Client Secret z Google Cloud
- `AUTH_SECRET` — losowy sekret min. 32 znaki
- `APP_URL` — `https://ppccontrolcenter.vercel.app`
- `ALLOWED_DOMAIN` — `4people.pl`
- `CONFIG_SHEET_ID` — `1fy9NxgD9G52lRRie4Br9L-Y_VRVseZ4ksFmH32t5v8M`

`AUTH_SECRET` możesz wygenerować lokalnie np.:

```bash
openssl rand -base64 48
```

Po dodaniu env vars wykonaj Redeploy.

## 5. Zakładka Użytkownicy

Oczekiwane nagłówki:

```text
Email | Użytkownik | Rola | Team | Aktywne
```

Dostęp jest jawnie dozwalany tylko, gdy `Aktywne = TAK`.

## 6. Test

1. Otwórz dashboard w trybie incognito.
2. Powinien pojawić się ekran logowania.
3. Zaloguj się kontem Workspace znajdującym się w `Użytkownicy`.
4. Po powrocie dashboard ma się załadować, a w nagłówku pojawi się użytkownik + rola + team.
5. Ustaw `Aktywne = NIE`, wyloguj i zaloguj ponownie — dostęp powinien zostać odrzucony.

## Ważne

To jest etap **Auth v1**. Zatrzymuje automatyczne ładowanie dashboardu przed zalogowaniem i rozpoznaje rolę, ale nie jest jeszcze końcowym zabezpieczeniem danych. Publiczne CSV Google Sheets nadal istnieją. Następny etap to backendowe API i filtrowanie rekordów po roli/użytkowniku, a dopiero potem zamknięcie publicznych arkuszy.
