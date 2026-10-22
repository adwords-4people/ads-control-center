PPC Control Center - Admin v1.1

ZMIANY
1. Admin -> Klienci: uproszczona tabela
   - Klient / konto
   - Platforma
   - Opiekun
   - Typ
   - Budżet
   Usunięto KPI operacyjne z tabeli: koszt miesiąca, prognoza kosztu, wynik, ROAS, status.
   Karty na górze pokazują teraz liczbę aktywnych kont Google/Meta i aktywnych opiekunów.

2. Specjalista -> Dodaj konto reklamowe
   - widoczne tylko dla rzeczywistego użytkownika z rolą Specjalista
   - niedostępne w trybie Podgląd jako użytkownik
   - Google Ads: wybór wyłącznie MCK przypisanego do zalogowanego specjalisty
   - Meta Ads: wybór aktywnego Business Managera
   - Użytkownik, Email i Aktywne=TAK są ustawiane przez backend, nie przez formularz
   - duplikaty kont są blokowane
   - konto pojawi się w danych po najbliższej automatycznej synchronizacji CENTRAL

PODMIEN
- index.html
- styles.css
- auth.js
- admin.js
- api/_lib/access.js

DODAJ
- accounts.js
- api/accounts/self-service.js

NIE MA NOWYCH ENVIRONMENT VARIABLES.

WYMAGANIA
- konto serwisowe musi mieć rolę Edytujący w pliku Konfiguracja (to już jest wymagane przez Admin v1 do zarządzania pracownikami)
- Google Ads CENTRAL i Meta Ads CENTRAL pozostają tylko do odczytu dla Vercel service account
- Dostęp ogólny Google Sheets pozostaje Ograniczony

TEST PO DEPLOY
A. Admin
- Klienci -> tabela ma tylko 5 kolumn
- Dodaj konto reklamowe nie jest widoczne

B. Specjalista
- Narzędzia -> Dodaj konto reklamowe
- Google Ads -> widzi tylko własne MCK
- Meta Ads -> widzi aktywne BM
- dodaj testowe konto tylko wtedy, gdy naprawdę ma być w konfiguracji
- po synchronizacji CENTRAL konto powinno pojawić się w dashboardzie

UWAGA
Formularz nie odpytuje bezpośrednio Google Ads API ani Meta Graph API przed zapisem. Jeżeli podane konto nie jest dostępne z wybranego MCK/BM, błąd ujawni najbliższa synchronizacja CENTRAL.
