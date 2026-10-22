# PPC Control Center - Auth v3 OIDC / Private Google Sheets

Ta wersja zachowuje Auth v2 (Google Workspace, role, Team, Podglad jako...) i zamienia publiczny odczyt CSV na prywatny Google Sheets API przez Vercel OIDC + Google Workload Identity Federation.

## 1. Wymagane Environment Variables w Vercel / Production

Dotychczasowe:
- GOOGLE_CLIENT_ID
- GOOGLE_CLIENT_SECRET
- AUTH_SECRET
- APP_URL=https://ppccontrolcenter.vercel.app
- ALLOWED_DOMAIN=4people.pl
- CONFIG_SHEET_ID=1fy9NxgD9G52lRRie4Br9L-Y_VRVseZ4ksFmH32t5v8M

Nowe:
- GCP_PROJECT_ID=ppc-control-center-512313
- GCP_PROJECT_NUMBER=515371390885
- GCP_SERVICE_ACCOUNT_EMAIL=ppc-control-center-sheets@ppc-control-center-512313.iam.gserviceaccount.com
- GCP_WORKLOAD_IDENTITY_POOL_ID=vercel
- GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID=vercel

NIE dodawaj GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY. Ta wersja nie uzywa kluczy JSON/PEM.

## 2. Google Cloud

Vercel OIDC Team issuer:
- iss: https://oidc.vercel.com/4people
- aud: https://vercel.com/4people
- sub: owner:4people:project:ppc_control_center:environment:production

Workload Identity Pool / Provider:
- pool: vercel
- provider: vercel

Service Account:
- ppc-control-center-sheets@ppc-control-center-512313.iam.gserviceaccount.com
- federowana tozsamosc produkcji musi miec roles/iam.workloadIdentityUser na tym koncie.

Wlacz API:
- Google Sheets API
- Security Token Service API
- IAM Service Account Credentials API

## 3. Udostepnij arkusze Service Accountowi jako Wyświetlajacy

- Config: 1fy9NxgD9G52lRRie4Br9L-Y_VRVseZ4ksFmH32t5v8M
- Google Ads: 1_CMt0tZhGqT3y6wp5tTpetU7GtNtt2bKkzERg2iLNhw
- Meta Ads: 1_GCw4RqECUNeKisRNXSpb0ekcz1IQNxgb180ymexLOU

Na razie nie usuwaj publicznego dostepu.

## 4. Wdrozenie

Wgraj zawartosc tej paczki do root repo, zachowujac katalog api/. Commit do main uruchomi nowy Production deployment.

## 5. Test przed zamknieciem arkuszy

Zaloguj sie jako Admin i otworz:
https://ppccontrolcenter.vercel.app/api/admin/sheets-check

Oczekiwane:
- ok: true
- auth: vercel-oidc-workload-identity-federation
- wszystkie checks[].ok = true

Nastepnie sprawdz dashboard:
- Admin: wszystkie konta
- Podglad jako Adrian: tylko jego konta
- Podglad jako Kinga: caly Team PPC

## 6. Dopiero po sukcesie

W trzech Google Sheets zmien Dostep ogolny z "Kazdy, kto ma link" na "Ograniczony". Nie usuwaj konta serwisowego z listy dostepu.

Ponownie uruchom /api/admin/sheets-check i test rol.
