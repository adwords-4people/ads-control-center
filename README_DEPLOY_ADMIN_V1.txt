PPC Control Center — Admin v1

NOWE FUNKCJE
- Admin -> Klienci: przekrojowy widok wszystkich kont Google Ads i Meta Ads.
- Admin -> Administracja: pracownicy + stan synchronizacji Google/Meta.
- Dodawanie, edycja, dezaktywacja i przywracanie pracowników.
- "Usuń" = Aktywne=NIE; historia i przypisania nie są kasowane.
- Admin nie może wyłączyć ani odebrać roli Admin własnemu kontu.
- W trybie "Podgląd jako użytkownik" sekcja Admin jest ukryta i zablokowana.

WDROŻENIE
1. Podmień:
   index.html
   styles.css
   auth.js
   dashboard.js
   api/_lib/sheets.js
   api/_lib/users.js

2. Dodaj:
   admin.js
   api/admin/overview.js
   api/admin/employees.js

3. WAŻNE — Google Sheets / plik Konfiguracja:
   Zmień rolę konta usługi:
   ppc-control-center-sheets@ppc-control-center-512313.iam.gserviceaccount.com
   z "Wyświetlający" na "Edytujący" TYLKO w pliku Konfiguracja.

   Pliki Google Ads i Meta Ads zostają "Wyświetlający".
   Dostęp ogólny wszystkich plików nadal ma być "Ograniczony".

4. Vercel: Production Redeploy.
   Nie ma nowych Environment Variables.

TEST PO WDROŻENIU
A. /api/admin/overview -> ok:true
B. Dashboard -> Admin -> Klienci -> widać konta Google + Meta
C. Dashboard -> Admin -> Administracja -> widać pracowników i statusy sync
D. Edytuj istniejącego pracownika i zapisz bez zmian -> zapis powinien przejść
E. Podgląd jako Adrian -> sekcja Admin znika
F. /api/admin/sheets-check -> nadal ok:true

UWAGA
SCOPE OAuth dla konta usługi został rozszerzony z spreadsheets.readonly do spreadsheets.
Realne prawa nadal wynikają z udostępnienia plików: Config=Edytujący, Google/Meta=Wyświetlający.
