# OPERATIONS — odtwarzalna aktualizacja i odzyskanie prywatnej instalacji

## Instrukcja startowa do osobnego wątku

Przejmij pakiet OPERATIONS w repozytorium `klb-t/Watchdog-JH16`. Samodzielnie
doprowadź do przetestowanego przepływu aktualizacji, spójnej kopii i odtworzenia
na izolowanych fikcyjnych danych. Pracuj małymi commitami i deleguj rozłączne
zadania. Nie wykonuj zmian na rzeczywistej VM ani w chmurze na podstawie tego
pakietu. Nie traktuj dokumentacji lub testu tekstu skryptu jako dowodu, że
backup został odtworzony.

Przeczytaj `CLAUDE.md`, `docs/WORK_COORDINATION.md`, najnowszy handoff,
`docs/spec/00_STATE_AND_DECISIONS.md`, `docs/spec/07_EPICS_AND_TASKS.md`,
`docs/DESIGN_RULES.md` i `ECOSYSTEM.md`. Sprawdź aktualny head i zdalne gałęzie.
Punkt audytu to `main` `832947e`; zacznij od uzgodnionego opublikowanego SHA
zawierającego odpowiednie poprawki `codex/watchdog-wave1-20260930`. Nie powtarzaj
zmian tej fali ani nie uruchamiaj historycznej gałęzi kontynuacji z runbooka.

## Claim — uzupełnia przydzielony właściciel

| Pole | Stan początkowy |
| --- | --- |
| owner | Codex OPERATIONS, session ec4ff56ac2e8 |
| base_sha | `312ba246f9bdeb035019e2ff4c1a09aaef0a734c` — published main verified through GitHub |
| branch | `codex/watchdog-operations-20260930` |
| files | `scripts/watchdogctl.sh`, `scripts/gcp_vm_bootstrap.sh`, new `scripts/watchdog_backup.py`, `tests/integration/operations_*.test.ts`, one path-aware assertion in `tests/integration/gcp_vm.test.ts`, `docs/DEPLOY_GCP_VM.md`, this package |
| status | implemented; package tests passed; awaiting integrator full gate / real Docker |
| updated_at_utc | 2026-09-30T22:10:00Z |
| next_checkpoint | integrator checks published branch, runs full gate/JH16 and real container; no live VM action |

Integrator rozstrzyga konflikt. Stary claim wymaga sprawdzenia zdalnej gałęzi;
nie wolno go przejąć samym upływem czasu. Użyj odrębnego checkoutu i gałęzi,
zachowaj wcześniejsze zmiany. Plik claimu nie jest blokadą atomową.

## Fakty i pierwszy ruch

Istnieją instalator prywatnej GCP VM, systemd, `watchdogctl backup/update`,
testy instalatora i kontrola trwałości kontenera. Audyt bazowego kodu nie
wykazał wykonywalnego odtwarzania backupu ani próby restore. Zweryfikuj to
ponownie: fala lub inny wątek mogły już dodać brakującą część.

Przeczytaj `docs/DEPLOY_GCP_VM.md`, `scripts/deploy_gcp_vm.sh`,
`scripts/gcp_vm_bootstrap.sh`, `scripts/watchdogctl.sh`,
`scripts/check_container.sh` i `deploy/watchdog.service`. Następnie uruchom
istniejące testy poniżej i sprawdź dostępność lokalnego Dockera. Zapisz różnicę
między runbookiem a zachowaniem skryptów, zanim zaczniesz implementację.

Audyt fali znalazł osobny problem historycznej ścieżki Cloud Run: SQLite na
GCS FUSE. Fala dodaje blokadę przed jakimkolwiek wywołaniem `gcloud` oraz
`tests/integration/cloudrun_guard.test.ts`; sprawdź jej zintegrowany wynik,
zamiast powtarzać to zadanie lub usuwać blokadę. Ten pakiet
nie naprawia jej poprzez uruchomienie wdrożenia lub uznanie `max-instances=1`
za dowód zgodności systemu plików z SQLite. Rozszerzenie backendu bazy wymaga
osobnego, rzeczywiście testowanego kontraktu.

## Zakres i sekwencja

1. **Zachowanie przy awarii aktualizacji.** Testuj wykonanie skryptu z atrapami
   poleceń: nieudany build pozostawia starą usługę, nieudany backup po
   zatrzymaniu przywraca poprzednią usługę, błąd startu/migracji ma jawny stan
   odzyskania. Nie uruchamiaj automatycznie starego obrazu na już zmienionej
   bazie i nie deklaruj bezpiecznego rollbacku bez zgodnej kopii.
2. **Spójny backup.** Zachowaj razem bazę, bloby, konfigurację, klucz sejfu i
   identyfikator zgodnego obrazu. Sprawdź kompletność, uprawnienia i hashe
   przed uznaniem archiwum za gotowe. Testy używają wyłącznie fikcyjnych kluczy.
3. **Izolowane odtworzenie.** Zaprojektuj i wykonaj restore do nowego miejsca,
   z ochroną przed nadpisaniem istniejącej instalacji i niebezpiecznymi
   ścieżkami archiwum. Odczytaj przywrócony rekord, blob i fikcyjny sekret;
   porównaj wersję schematu i obrazu. Uszkodzony lub niekompletny pakiet ma
   zostać odrzucony przed podmianą aktywnych danych.
4. **Instrukcja użytkowa.** Zapisz sprawdzone polecenia, warunki i odzyskanie po
   błędzie. Rozdziel lokalny test kontenera, próbę restore i rzeczywiste
   wdrożenie GCP; ostatnie nie jest wynikiem tego pakietu.

Kandydaci do przydziału: powyższe skrypty, `docs/DEPLOY_GCP_VM.md`, nowe
dedykowane testy backup/restore oraz `tests/integration/gcp_vm.test.ts`.
Zmiany `deploy/`, globalnej konfiguracji, zależności, migracji i wspólnych
testów integracyjnych uzgadnia integrator przed edycją. Bez równoległego
uruchamiania bootstrapu z `sudo` na współdzielonym hoście.

Podział subagentów: audyt awarii (odczyt); implementacja skryptów; dedykowane
testy z atrapami; niezależny przegląd backupu/sekretów; dokumentacja po wynikach.
Prowadzący przydziela konkretne pliki i scala dopiero sprawdzone etapy.

## Walidacja i warunki odbioru

Z katalogu repozytorium, z zależnościami z lockfile:

```bash
npm run lint
npm run build
node --import tsx --test tests/integration/gcp_vm.test.ts tests/integration/deployment.test.ts tests/integration/persistence.test.ts
node --import tsx --test tests/integration/cloudrun_guard.test.ts
bash -n scripts/deploy_gcp_vm.sh scripts/gcp_vm_bootstrap.sh scripts/watchdogctl.sh scripts/check_container.sh
```

Po implementacji dodaj jawne polecenie uruchamiające nowy test restore —
obecny zestaw nie dowodzi odtwarzania. Gdy lokalny Docker jest dostępny:

```bash
docker build -t watchdog:operations-check .
bash scripts/check_container.sh watchdog:operations-check
```

Kontrola kontenera używa własnego wolumenu i localhost. Jest kontrolą
startu/trwałości, nie zastępuje nowej próby odtworzenia backupu. Pełna bramka
integracyjna i JH16 należą do integratora. Docker niedostępny oznacza blocker
tej części, nie pominięty test uznany za sukces.

Odbiór wymaga testów wszystkich trzech awarii aktualizacji, odrzucenia
uszkodzonego archiwum, braku nadpisania obcego katalogu, przywrócenia DB/blobów/
fikcyjnego sejfu oraz udokumentowanej zgodności obrazu. Brak dowodu pozostaje
jawny; nie rozszerzaj zakresu, aby ominąć niewygodny warunek.

## Granice i przekazanie

Bez tworzenia VM/NAT/dysków, zmian IAM/firewalla, płatnego backupu, rzeczywistych
sekretów, publikacji publicznej, wiadomości do osób i migracji produkcyjnych.
Prywatny tunel właściciela nie staje się wieloużytkownikowym systemem dostępu.

Oddaj małe commity, dokładne komendy i wyniki, model awarii, instrukcję restore
oraz checkpoint z następnym krokiem. Stan/ledger/handoff globalny aktualizuje
integrator na podstawie tych dowodów. Przy braku runtime kontynuuj testy z
atrapami i audyt, ale oznacz rzeczywistą próbę jako niewykonaną.


## Checkpoint 0 — 2026-09-30, isolated operations audit

Base `312ba246f9bdeb035019e2ff4c1a09aaef0a734c` verified as published main;
remote branches inspected before claim. The only other current package branch was
CLINICAL and has disjoint implementation scope. Published claim commit:
`32b4c0d2282da75545500ef10e7afe411a82b225` (local equivalent `43be257`).

Delta from runbook: existing tar backups have no executable restore, inventory,
SQLite validation or immutable image identity. Rebuilding a commit can retag the
previous image. A runtime start failure can leave Restart=always looping. Scope
adds a Python standard-library archive helper, controller/runtime failure handling,
executable backup and update tests, and the deployment runbook. The existing GCP
static assertion needs only its release.env path made root-prefix aware.

Baseline: `npm run lint`, `npm run build`, and
`node --import tsx --test tests/integration/gcp_vm.test.ts tests/integration/deployment.test.ts tests/integration/persistence.test.ts tests/integration/cloudrun_guard.test.ts`
all exit 0; **35/35 tests pass**. Dependencies reuse an existing installation from
the identical lockfile/base without changing package files. Docker is absent;
real-container validation remains unavailable here. No production or cloud action.

Delegated disjoint work: `backup_engine` owns the new Python helper;
`update_runtime` owns the two shell scripts; `restore_tests` owns backup regression
tests; root owns update failure tests and documentation; `ops_audit` reviews only.
Global state, ledger and integration handoff remain integrator-owned.


## Checkpoint 1 — implementation and independent review

Published implementation commits (each tree compared with local Git):

- `0e592dd2098706d52f78f1ea5c35c66f67c8cdec` — backup format and executable
  isolated restore (local `612cd6073662044f3f858467f062c953d6f8eb89`, tree
  `5bec31414624a107ad4eb0d0773d644f8d6b37f3`).
- `ef78636a723865433c10ed931ee7d7eb8afb8c6a` — controller/bootstrap and failure
  tests (local `3907d0b77c82b8109bc2e94ad6f3a7c93421f630`, tree
  `d64201419d0ed528e15716334f41631cd4fcfbc1`).

Backup preserves a versioned manifest, schema metadata, all standard local data,
configuration, vault material and immutable image identity. Restore verifies the
whole package and publishes only to a new directory; it never activates archived
code or overwrites a live installation. Live writer shutdown and installation
lock remain controller preconditions. Nonstandard/external storage fails closed.
A never-used vault may have no key; file/env keys follow the actual UserVault rules.

Update behavior: build before stopping; pre-change verified backup; immutable
old image captured before retagging; traps cover stop/backup failure; potential
migration/start failure stops and disables the new service, retains recovery
marker and never automatically downgrades the database. Persistent autostart is
only restored after health succeeds. Interrupted runtime validation uses systemd
runtime-only activation. SIGKILL cannot trigger shell cleanup of a still-live
service; that case requires explicit operator inspection and stop.

Independent reviewer `ops_audit` found a hot rollback-journal verification gap
and immutable release/image mismatch gap. Both fixed and covered by executable
regressions. Final review found no further blocking issue within stopped-writer
and trusted-parent assumptions. No actual Docker/systemd/cloud execution claimed.

## Checkpoint 2 — final package evidence and integration handoff

On implementation tree `d64201419d0ed528e15716334f41631cd4fcfbc1`:

```bash
node --import tsx --test tests/integration/operations_backup.test.ts tests/integration/operations_update.test.ts tests/integration/gcp_vm.test.ts tests/integration/deployment.test.ts tests/integration/persistence.test.ts tests/integration/cloudrun_guard.test.ts
```

Exit **0**: **62/62 pass, 0 failed/skipped/cancelled**. New package coverage:
18 backup/restore tests + 9 update/controller tests. Actual restored SQLite
schema/record, blob and fictional secret are read through the application vault;
committed WAL data is retained. Corrupt/incomplete/malicious archives, hot rollback
journals, image mismatches and existing destinations are rejected. Update tests
execute real scripts with external command stubs, including DB mutation before
failed startup, failed build/backup/stop, legacy-helper upgrade and recovery guard.

`npm run lint`: exit 0 on the final test/code set. `npm run build`: exit 0 on
unchanged application code during baseline. No dependency or application TS changes.
`bash -n scripts/deploy_gcp_vm.sh scripts/gcp_vm_bootstrap.sh scripts/watchdogctl.sh scripts/check_container.sh`,
`python3 -m py_compile scripts/watchdog_backup.py`, and `git diff --check`: exit 0.

Limitations and next action:

1. Docker unavailable locally: no `docker build`, real image startup or restored
   container activation executed here. Source-level and stub checks are not those tests.
2. Backup includes image ID, not image bytes. Preserve the exact image separately;
   rebuilding a commit is not identity verification. Restore output has private
   modes and caller ownership; activation requires controlled ownership/settings.
3. No real VM, cloud resources, production secrets, paid calls or migrations touched.
4. Integrator should compare this branch against current main, run canonical
   `npm run clean && npm run test:all`, `npm run demo:jh16`, and real Docker checks
   on the combined head. PR CI may supply full/browser/container evidence, but its
   outcome must be read separately; this note does not assume success.
5. Global state/ledger/handoff were deliberately not edited. Proposed integrator
   entry: OPERATIONS implements verified cold backup and staging-only restore,
   62/62 focused tests on the exact implementation tree, with real-container/live
   deployment limits as above. Do not mark production recovery demonstrated.

Runbook and exact commands: [DEPLOY_GCP_VM](../DEPLOY_GCP_VM.md).
