PPC Control Center - Admin v1.6: Dodaj konto dla wszystkich ról

Podmień:
- index.html
- auth.js
- accounts.js
- api/accounts/self-service.js

Nie ruszaj plików z v1.3 quota-fix ani pozostałego backendu.

Zachowanie:
- Specjalista: przycisk widoczny, może dodać konto tylko do siebie.
- Manager: przycisk widoczny, może dodać konto do siebie lub aktywnej osoby z własnego Teamu.
- Admin: przycisk widoczny, może dodać konto do dowolnego aktywnego pracownika.
- Podgląd jako: przycisk i formularz są widoczne zgodnie z rolą podglądanego użytkownika, ale zapis jest zablokowany.
- Google Ads: MCK jest ograniczone do MCK przypisanego wybranemu opiekunowi.
- Meta Ads: wybór spośród aktywnych BM.
