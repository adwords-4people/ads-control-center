PPC Control Center - minimalny patch repo

NIE wgrywaj tego ZIP-a przez GitHub -> Add files via upload jako calego folderu.

Najbezpieczniejsza procedura:
1. Wroc do repo bez przypadkowej kopii calego projektu (cofnij/usun ostatni pelny upload, jesli utworzyl duplikaty).
2. Usun pliki wymienione w DELETE_THESE.txt.
3. Nadpisz trzema plikami:
   api/_lib/access.js
   api/accounts/self-service.js
   api/admin/overview.js
4. Dodaj nowy plik:
   api/admin/accounts.js
5. Commit/push.

Po tej zmianie pozostaje 11 Vercel Functions.
