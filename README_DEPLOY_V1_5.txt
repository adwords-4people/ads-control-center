PPC Control Center - Admin v1.5 / Preview Specjalisty fix

Podmien:
- index.html
- styles.css
- auth.js
- accounts.js
- api/accounts/self-service.js

Nie podmieniaj innych plikow backendu z v1.3 quota-fix.

Co naprawia:
- Podglad jako -> Specjalista pokazuje elementy data-specialist-only,
- przycisk Dodaj konto jest widoczny w topbarze i sidebarze,
- w preview formularz mozna otworzyc, ale zapis jest zablokowany,
- prawdziwy Specjalista moze zapisywac,
- cache-busting wymusza pobranie aktualnego auth.js i accounts.js po deploymencie.
