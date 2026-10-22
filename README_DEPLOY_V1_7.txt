PPC Control Center - Admin v1.7 / role views

Zakres:
1. Zwykle zakladki wynikowe sa filtrowane do klientow przypisanych bezposrednio do aktywnego uzytkownika - takze dla Admina i Managera.
2. Dziennik zmian zachowuje szerszy zakres roli (Manager = Team, Admin = wszystkie), bo nie jest zakladka wynikowa.
3. Manager dostaje sekcje Admin -> Klienci dla calego swojego Teamu.
4. Widok Managera sortuje konta wg priorytetu: Interwencja -> Sprawdz -> OK.
5. Priorytet uwzglednia m.in. realizacje budzetu, wynik vs poprzedni miesiac, trend wyswietlen, anomalie oraz ROAS/CPA.
6. Admin zachowuje dotychczasowe Admin -> Klienci i Admin -> Administracja.
7. Podglad jako Manager pokazuje ten sam widok Teamu, ale bez operacji administracyjnych.
8. Quota-fix batchGet z v1.3 pozostaje zachowany.

Podmien pliki:
- index.html
- styles.css
- auth.js
- admin.js
- dashboard.js
- api/dashboard-data.js
- api/data.js
- api/_lib/access.js
- api/_lib/data-sources.js
- api/admin/overview.js

Nie ma nowych Environment Variables ani zmian w Google Cloud / OIDC.

Test po deploy:
A. Wlasny widok Karola: raporty Google/Meta tylko klienci Karola; Admin -> Klienci nadal wszystkie konta.
B. Podglad jako Kinga: raporty Google/Meta tylko klienci Kingi; sekcja Admin -> Klienci widoczna i obejmuje Team PPC; Administracja niewidoczna.
C. Podglad jako Adrian: brak sekcji Admin; raporty tylko Adriana.
