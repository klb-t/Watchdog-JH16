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
| owner | nieprzydzielony |
| base_sha | do ustalenia z integratorem po checkpointcie fali |
| branch | nieutworzona; własna gałąź pakietu |
| files | zakres poniżej jest propozycją, wymaga rozłącznego przydziału |
| status | prepared, unclaimed |
| updated_at_utc | 2026-09-30 |
| next_checkpoint | audyt bieżących skryptów, możliwości lokalnego runtime i dokładny przydział |

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
