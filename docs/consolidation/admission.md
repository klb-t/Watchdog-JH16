# E4.7 — konsolidacja dostępu

Bazy: main `31b813f`, Claude `9dea9aa`; funkcje Claude’a w `d448e59`…`cfb7fc7`. **Ukończono E4.7**; poniższa macierz zachowuje wejściowy kontrakt integracji.

| Cecha | Main | Claude | Kontrakt konsolidacji |
|---|---|---|---|
| Google OIDC | Jest; principal `google:*` i istniejąca własność | Jest; mapa wielu tożsamości | Zachować istniejące ID i własność; dodać mapę zweryfikowanych tożsamości |
| Kod e-mail | Brak | `identity/sign_in.ts`, kod jednorazowy, limity | Przenieść za wspólny interfejs; test braku SMTP, wygaśnięcia, reuse i błędnych prób |
| Zaproszenie adresowe | Jednorazowo składa wniosek, nie nadaje ról | Nadaje dopuszczalne role | Stare zaproszenie zachowuje semantykę request-only; nowy jawny typ może nieść grant |
| Link otwarty | Brak | 1–50 użyć, ≤30 dni, bez admin/diagnostyki | Osobny typ; weryfikacja tożsamości, atomowe użycie, cofnięcie praw wystawcy |
| SMTP | Brak | `mail/index.ts`, nodemailer, statusy i konfiguracja PL/EN | Nie oznaczać jako wysłane przed akceptacją SMTP; to nie dowód dostarczenia do skrzynki |
| Zarządzanie | `principal.manage`, admin może zapraszać | `access.admit`, delegacja podzbioru zdolności | Jawny profil delegacji; brak cichego rozszerzenia praw istniejącego admina |
| Ostatni zarządzający | Ochrona na main | Ochrona grantów operatora | Zachować obie własności; test wielu grantów i źródeł uprawnień |
| Revocation | Natychmiastowa w obecnej sesji, override env | Block/unblock, session_version, signout everywhere | Blokada konta i cofnięcie pojedynczego grantu pozostają osobne |
| Audyt | Nieusuwalne admission_events | Główny hash-chain audit_events | Zachować oba historyczne ślady i jawne połączenie nowych wydarzeń |
| CLI | Komendy operacyjne | people/grant/invite/open-link/signin-link | Włączyć do obrazu/builda; nie zgubić backup/update/restore |

## Migracja i pułapki

Main 020 tworzy `installation_grants`, `admission_requests`, `admission_invitations`, `admission_events`. Claude 020 tworzy `principal_identities`, `admission_grants`, `invitations`, `invitation_redemptions`, `access_applications`, `sign_in_challenges` i dodaje `principals.session_version`. Zamiana pliku 020 nie jest migracją istniejącej bazy.

1. Pozostawić bajty 020–022; dodać 023+ po sprawdzeniu zajętych numerów.
2. Zapis źródła/migracji i historycznej semantyki zaproszeń; bez zamiany starych wniosków w aktywne granty.
3. Migracja sprawdzona na kopii wypełnionej bazy main: użytkownicy, role, cofnięcia, stare tokeny, projekty i porównania. Czysta baza nie zastępuje tej próby.
4. Aktualizacja API/UI/profili i starej autoryzacji musi być jedną zgodną całością. Test odczytu prywatnych danych przez anonimowego/aplikanta obowiązuje dla każdego routera.
5. Istniejące `WATCHDOG_GRANTS` i właściciel `local-user` wymagają jawnej migracji własności; operator CLI nie daje automatycznego prawa cudzej tożsamości z wejścia HTTP.
6. Rejestracja nowych zmiennych w `.env.example`, build CLI i nowe zależności w lockfile; instalacja bez maila nadal ma użyteczny prywatny tryb.

## Wynik konsolidacji

`023_accounts.ts` dodaje tabele i wiąże istniejące Google ID; migracje 001–022 pozostają niezmienione. `accounts_identity.ts` i osobny router kont współpracują ze starym routerem auth. `WATCHDOG_AUTH=accounts` jest jawne; dotychczasowy OIDC pozostaje kompatybilny. Podpisywana sesja kont sprawdza na żywo role, aktywność i generację sesji.

Dotychczasowy `admin` nie otrzymuje nowych zdolności. Nowy `access_admin` deleguje tylko podzbiór swoich zdolności. Stare trwałe override mają pierwszeństwo przed bootstrapem; ich administracja pozostaje w `/settings/access`. Nowy panel i CLI odmawiają ich nadpisywania z jasnym komunikatem, zamiast raportować grant, który nie działa. Powiązanie zweryfikowanego adresu zachowuje principal i własność projektów; przełączenie z `local-user` nie przenosi jego danych automatycznie.

Testy: `accounts_upgrade.test.ts` odtwarza wypełnioną bazę 022, sprawdza niezmienioną historię, stare tokeny request-only, własność, odmowę eskalacji i cofnięcie w aktywnej sesji. Testy `accounts_admission`, `admission`, `access_flow` zachowują oba protokoły i lokalny SMTP. Build zawiera `dist/watchdog-admin.cjs`. Pełny odbiór opisuje [receipt](../history/evidence/2026-10-01/receipt.json).

Źródła: obie wersje `backend/watchdog_api/{api/auth_routes.ts,identity/oidc.ts,db/migrations/020_admission.ts}`; main `docs/ADMISSION.md`, `src/pages/AccessAdmin.tsx`; Claude `identity/{admission,sign_in,index}.ts`, `mail/`, `api/{access_routes,admission_gate,rate_limit}.ts`, `scripts/watchdog_admin.ts`, `src/pages/{Login,Join,Apply,PeopleAccess}.tsx`, `config/access/`, `tests/{unit,integration}/admission.test.ts`, `tests/e2e/access_flow.test.ts`, `tests/helpers/smtp.ts`.

Odbiór: testy HTTP i browser obu semantyk zaproszeń, limity i wyścigi, revocation w trakcie I/O, rzeczywisty lokalny serwer SMTP testowy, pełny gate na połączonym kodzie. Realna wysyłka do ludzi wymaga odrębnego upoważnienia. Żadnych prawdziwych adresów w fixture.
