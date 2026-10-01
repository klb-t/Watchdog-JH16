# E3.17 — HTTPS z zachowaniem OPERATIONS

**Ukończono E3.17 jako integrację kodu z Claude `0566d6a`.** Nie wykonano wdrożenia na rzeczywistej VM.

| Obszar | Main | Claude | Wymaganie |
|---|---|---|---|
| Źródło instalacji | Domyślnie main, przypięty SHA | Starszy instalator z public mode | Zachować przypięcie i domyślną gałąź main |
| Dostęp | Prywatny IAP, app loopback | Caddy 80/443, app loopback | Prywatny tryb pozostaje; publiczny wymaga działającego E4.7 |
| Brak domeny | Tunel | sslip.io + certyfikat | Opcja konfiguracyjna; własna domena również wspierana |
| Uruchomienie publiczne | Nie ma | `--public --owner`, enable-public | Test odmowy gdy logowanie wyłączone; cookie Secure i jawny public URL |
| Backup | Hashe, schema, vault, immutable image identity | Starszy backup | Zachować wszystkie poprawki `0e592dd`/`ef78636` |
| Restore | Nowy prywatny katalog, bez uruchomienia kodu | Brak równoważnego nowego procesu | Zachować brak nadpisania/downgrade; jawny plan aktywacji |
| Aktualizacja | Odtwarzalne zachowanie przy build/start/migration failure | Starsze skrypty rozszerzone o konta/proxy | Adaptacja funkcji; nie checkout całych skryptów z Claude |
| Cloud Run | Wyłączony przed cloud side effects | Starszy dokument | Zachować guard; HTTPS nie rozwiązuje problemu SQLite/FUSE |

Źródła Claude’a: `deploy/watchdog-proxy.service`, `scripts/{deploy_gcp_vm,gcp_vm_bootstrap,watchdogctl}.sh`, `tests/integration/gcp_vm.test.ts`, D22 i `docs/DEPLOY_GCP_VM.md`. Źródła main: te same skrypty, `scripts/watchdog_backup.py`, testy backup/update i `docs/work_packages/OPERATIONS.md` (sprawdzić dokładne bieżące nazwy przed edycją).

Odbiór kodu: shell syntax, wykonywalne scenariusze failure injection, brak publicznego local-user, zachowane obraz/SHA/schema, cert/proxy config bez sekretów. Odbiór instalacji: rzeczywiste HTTPS, logowanie i role na telefonie, restart z danymi, odtworzenie backupu w izolowanym miejscu, dopiero potem kontrolowana aktywacja. Sam green CI nie zamyka tej drugiej bramki. Audyt nie uruchamia GCP, SMTP ani nowych wydatków.

## Wynik konsolidacji

`watchdog_access.sh` jest instalowanym modułem `watchdogctl`: używa wspólnej blokady i izolacji `WATCHDOG_ROOT`. Włączenie kont zachowuje istniejące granty. Publiczny start wymaga accounts, gotowości aplikacji i jednostki proxy. Instalator zachowuje domyślne main, dokładny SHA, obraz i marker recovery; konfiguracja dostępu następuje po zakończeniu zaakceptowanej aktualizacji i zwolnieniu jej blokady.

Backup formatu v1 akceptuje również nowy moduł i jednostkę proxy; nadal odtwarza tylko izolowany katalog. Caddyfile i ustawienia są w `/etc/watchdog`; cache certyfikatów `/var/lib/watchdog-proxy` nie jest częścią backupu i przy aktywacji wymaga ponownego uzyskania certyfikatu. Nie ogłaszać pełnej odtwarzalności aktywnej VM na podstawie testu katalogu.

Testy `access_operations`, `gcp_vm`, `operations_backup`, `operations_update` uruchamiają skrypty pod kontrolowanym root z atrapami poleceń systemowych. Obejmują odmowę publikacji local-user, zachowanie grantów, public on/off oraz wcześniejsze scenariusze awarii. Nie kontaktują chmury ani urzędu certyfikacji.
