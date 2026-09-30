# WatchDog — wznowienie i pierwsza fala równoległa

Data: 2026-09-30. Baza `main`: `832947e` (integracja PR #4 + dokumentacja).
Gałąź: `codex/watchdog-wave1-20260930`. Ten dokument kontynuuje, nie zastępuje
historycznych wyników z [poprzedniego handoffu](HANDOFF_2026-09-30.md).

## Checkpoint 0 — odtworzenie stanu

- Sklonowano aktualne repo i przeczytano kontrakt agenta, stan, ledger,
  uzgodnienia specyfikacji, reguły projektowe oraz `ECOSYSTEM.md`.
- Repo potwierdza integrację siedmiu obszarów, wyszukiwania, admission i trwałych
  projektów. Historyczna bramka 419/419 jest wynikiem poprzedniego etapu,
  nie ponownym testem tej sesji.
- Historia dostępna głównemu agentowi wskazała aktualny repo/handoff; zawierała
  także niepasujące trafienia ChatADHD/AGEDS, których nie użyto jako stanu
  Watchdoga. Subagent historii nie uzyskał dodatkowego dostępu i korzystał
  wyłącznie z przekazanych fragmentów. Nie wykonano nowego pełnego skanu Takeout.
- E5.7b/E5.8b i E6.4/E6.5 pozostają otwarte; istniejące E5.8e już łączy wybrane
  operacje publikacji z zamrożonymi metodami i danymi. Nie zaczynamy od zera.
- Przydziały i zasady odzyskiwania: [WORK_COORDINATION](WORK_COORDINATION.md).

## Potwierdzone problemy; prace w toku

1. Ratio łączyło szeregi pozycyjnie mimo identyfikatorów encji. Audyt odtworzył
   błędny wynik po permutacji mianownika. Naprawa kontraktów i walidacji jest
   przypisana agentowi analizy; nie oznacza zmiany formuł JH16.
2. Odczyt współdzielonego zbioru po cofnięciu zatwierdzenia ma zbyt szeroki bypass
   `review`. Agent dostępu przygotowuje izolowany test API i poprawkę.
3. Instalator VM domyślnie pobiera starą gałąź kontynuacji mimo scalonego `main`.
   Agent operacyjny aktualizuje domyślne źródło i sprawdza powiązane regresje.
4. Analiza publikacji wymusza wszystkie wiersze. Powstaje jawny, utrwalony
   wybór podzbioru z pochodzeniem i kompatybilnością wcześniejszych eksportów.

Te punkty są wynikami audytu/zadaniami, nie ogłoszeniem gotowej naprawy.

## Środowisko i granice

Pierwsze `npm ci` nie zakończyło się sukcesem: node-gyp nie rozpakował nagłówków
Node 24.19.0 z powodu `fchown EINVAL` w środowisku. Trwa naprawa środowiska bez
zmian zależności projektu. Przed oznaczeniem zadań jako wykonane trzeba uruchomić
testy regresji i bramkę integracji. Nie wykonano płatnych wywołań, zatwierdzeń
metod w imieniu właściciela, kontaktów do osób ani instalacji na rzeczywistej VM.

## Następny krok po przerwaniu

Sprawdź head/remote oraz `git status`; nie zakładaj, że opis prac w toku jest
nadal aktualny. Odczytaj późniejsze checkpointy poniżej, wyniki agentów i pakiety.
Najpierw utrwal/zweryfikuj istniejące zmiany; nie rozpoczynaj drugiej implementacji
tego samego wycinka. Nie scalaj nieprzetestowanego zestawu do `main`.

## Checkpoint 1 — E4.6, cofnięcie dostępu

Zakończono ograniczenie bypassu przeglądu do właściciela zbioru oraz przeniesienie
asynchronicznego sprawdzania źródeł przed odczyt filtrowanych metadanych wyszukiwarki.
Trzy nowe testy HTTP obejmują cofnięcie udostępnienia przed/w trakcie odczytu,
przegląd przez właściciela, ponowne zatwierdzenie i brak wycieku liczników.

`node --import tsx --test tests/integration/workbench_access_revocation.test.ts
tests/integration/unified_search_revocation.test.ts tests/integration/unified_search.test.ts
tests/integration/workbench.test.ts`: **17/17 pass**. Wspólna bramka pozostaje przed nami.

Zależności zainstalowano bez zmiany lockfile: pobrano nagłówki Node 24.19.0 i użyto
`npm ci --no-audit --no-fund --nodedir=/tmp/watchdog-node-headers/node-v24.19.0`.
Standardowy Playwright zwrócił uszkodzone archiwum; trwa przygotowanie przeglądarki.
Bezpośredni `git push` nie miał uwierzytelnienia. Zdalny checkpoint 0 opublikowano
przez GitHub API: `1a642e91c8a33c3d36e58066963e5cedd695796c` (drzewo identyczne
z lokalnym `967d5a1`). Lokalne i API-owe SHA mogą się różnić; porównuj drzewa.

## Checkpoint 2 — E2.1, integralność silnika

Ratio dopasowuje wartości po identyfikatorach. Przykład regresji: `Ni={a:100,b:10}`
oraz `Ni_harm={b:5,a:20}` daje teraz `Hi={a:20,b:50}`, identycznie jak przy zgodnej
kolejności. Różne zbiory ID i duplikaty są błędem kontraktu; null nadal znaczy brak.
Walidator odrzuca samopętle, kolizje symboli, złe kształty i fałszywe nazwy prymitywów;
executor kontroluje jednostki/semantykę/ID, niefinitywne wartości i związanie dostarczonej
aprobaty z wykonanym MethodSpec. Bez zmiany zamrożonych formuł czy danych.

Wersje executor/ratio: `1.0.1`. **22/22** testów naukowych (w tym sześć nowych),
**9/9** powiązanych testów workbench/projektów, `npm run lint` i `npm run demo:jh16`
przeszły. Demo zachowuje 32 obserwacje, 16 Pi, 16 Hi i `pipeline_self_check`.
Niezależny przegląd agenta nie wykazał regresji. Niskopoziomowe wykonanie fixture
bez przekazanej aprobaty nadal istnieje; ta poprawka nie reklamuje jego usunięcia.

Checkpoint E4.6 jest zdalnie zapisany jako `9c02487190e9ae288c7a19bbf549bbbea0d7a672`
(lokalnie `c7ebcb2`, to samo drzewo). Wspólna bramka całej fali nadal oczekuje.

## Checkpoint 3 — E3.14, instalacja i korekta trwałości

Installer VM domyślnie wybiera `main`, nadal obsługuje jawne gałęzie/SHA i archiwizuje
rozwiązaną rewizję. Test kontroluje rzeczywiste polecenia Git przez atrapę środowiska.
Stary installer Cloud Run blokuje wykonanie przed każdym wywołaniem gcloud; test
uruchamia go z atrapą gcloud i sprawdza brak skutków ubocznych. `--help` działa.
Prywatna VM, publiczność usług i istniejące dane nie zostały zmodyfikowane.

E3.5 ponownie otwarte w części Cloud Run. Poprzednie twierdzenie o poprawnym SQLite
na GCS FUSE jest wycofane na podstawie kontraktu platformy, a nie testu żywego wdrożenia.
Oficjalne źródła i warunki nowego wdrożenia są w `DEPLOY_GCP.md`.

`node --import tsx --test tests/integration/cloudrun_guard.test.ts
tests/integration/gcp_vm.test.ts`: **9/9 pass**.
`node --import tsx --test tests/integration/deployment.test.ts`: **10/10 pass**.
Historyczny test statyczny otrzymał poprawny opis; nie reklamuje weryfikacji trwałości.

Lokalny Chromium 154 pobrano prawidłowo, ale proces kończy się przy `socket()` z
`Operation not permitted`. E2E pozostaje niewykonane w tym środowisku; potrzebna
standardowa bramka przeglądarkowa w CI. Nie omijamy ograniczeń środowiska.

## Checkpoint 4 — E5.7c, eksploracyjny podzbiór publikacji

Operacja publikacji może wybrać jawne ID wierszy zamiast całej tabeli. Dokładny
cytat, uzasadnienie, wersja danych i posortowane ID są utrwalone w kontekście i
hashu metody. Pusta selekcja jest błędem, a zmiana podzbioru wymaga nowej aprobaty.
Wybór zachowuje braki pomiarów; nie ustanawia nietkniętej próby potwierdzającej.
UI obejmuje wyszukiwanie wierszy bez utraty zaznaczeń, liczniki i przegląd planu.

Nowy eksport `paper-operation-2` weryfikuje podzbiór, cytat, wejścia i wynik;
pełne dane źródłowe pozostają w pakiecie. `paper-operation-1` nadal działa.
**13/13** testów integracyjnych paper_operations + research_package, lint i build
przeszły. Niezależny przegląd uruchomił dodatkowo dawny ui-1/v1 i podzbiór z
samym null: oba zachowują deterministyczny, weryfikowalny eksport. Te dodatkowe
próby były jednorazowe; nie są nowymi testami w ledgerze.

Dodano rzeczywisty test E2E (390 px, wybór/puste wejście, przegląd, wykonanie,
odtworzenie i eksport). Jest **niezweryfikowany lokalnie** do czasu standardowego CI.
E5.7c pozostaje niezaznaczone; E5.7b/E5.8b również pozostają otwarte.

Pakiety przyszłych wątków: [RESEARCH](work_packages/RESEARCH.md),
[CLINICAL](work_packages/CLINICAL.md), [OPERATIONS](work_packages/OPERATIONS.md).
Nie uruchomiono osobnych głównych czatów. Pierwsza fala korzystała z sześciu
subagentów oraz przeglądów krzyżowych; właściwe pliki i claims opisuje koordynacja.

## Checkpoint 5 — publikacja i lokalna wspólna bramka

Kod i pakiety opublikowano w [PR #5](https://github.com/klb-t/Watchdog-JH16/pull/5)
na headzie `827fa1150fb0e2efbbc13d7979d992197ec09fc0`.
Kolejne opublikowane commity: `1a642e9` (organizacja), `9c02487` (E4.6),
`fe674eb` (E2.1), `757c1fb` (E3.14), `827fa11` (E5.7c/pakiety).
Każde drzewo GitHub porównano z odpowiadającym lokalnym commitem — identyczne.
Własną lokalną historię zachowano na `local/watchdog-wave1-checkpoints-20260930`;
gałąź robocza została wyrównana do opublikowanego headu bez zmiany plików.

`npm run clean && npm run test:all`: lint i produkcyjny build przechodzą;
**434 testy, 409 pass, 25 fail, 0 skipped/cancelled**. Wszystkie 25 niepowodzeń
pochodzi z uruchomienia Chromium w testach przeglądarkowych (wspomniana blokada
socket), nie z zaliczonych testów API/silnika. Nie jest to pełna zielona bramka.
Docker jest nieobecny lokalnie. Standardowy PR CI
[36766360252](https://github.com/klb-t/Watchdog-JH16/actions/runs/36766360252)
sprawdza oba brakujące zakresy: przeglądarkę i realny kontener. Wynik zapisz poniżej.

Zachowane następne kierunki:

- Pakiety osobnych wątków są przygotowane, ale nieprzydzielone. Do wznowienia
  wystarczy wskazać repo, ten handoff oraz wybrany plik z `docs/work_packages/`.
- Istniejący MethodSpec już wykonuje graf zależności. Proponowany następny
  wycinek pochodzenia to wersjonowane ślady kroków (hash wejść/wyjść, wersja
  prymitywu, zachowanie/strata/dodanie, odrzucone ID), nie drugi równoległy silnik.
  To propozycja audytu, nie ukończona funkcja ani zmiana zatwierdzonej metody.
- Replikacja całej pracy, potwierdzające podziały i kliniczne reguły pozostają
  osobnymi zadaniami. Bieżący sukces fixture nie zastępuje walidacji naukowej.

## Checkpoint 6 — pełna bramka kontenera

Head kodu: `827fa1150fb0e2efbbc13d7979d992197ec09fc0`, drzewo
`1702844bc299096ffb807e56e6b71e4c20579857`. Job `container` w
[36766360252](https://github.com/klb-t/Watchdog-JH16/actions/runs/36766360252)
zakończony sukcesem. Odczytano log, nie tylko status:

- lint/build oraz **434/434 testy, 0 fail, 0 skipped**, w tym E5.7c w przeglądarce;
- gotowy obraz `sha256:339d5a8d9737912e2d0efd10118040684d182a157d277f0a70ff5ba2568dd0a5`;
- produkcyjny start, użytkownik nie-root, obraz tylko do odczytu, HTTP przez loopback,
  zapis API i zachowanie danych po wymianie kontenera — wszystkie przeszły.

E5.7c można zaznaczyć jako ukończone w podanym wąskim zakresie. Wcześniejsze
notatki o oczekującej akceptacji przeglądarkowej są historyczne. Osobny job
`verify` poza Dockerem nadal instalował zależności przeglądarki o 19:36 UTC;
nie mylić jego statusu z zakończoną pełną bramką obrazu.

Dodano `AGENTS.md` jako krótki punkt wejścia dla nowych sesji. Końcowa aktualizacja
stanu/handoffu/instrukcji jest wyłącznie dokumentacyjna; nie zmienia przetestowanego kodu.

## Checkpoint 7 — zamknięcie fali i scalenie

**Oba joby zakończyły się sukcesem.** Odczytano także log `verify`
(`110061407490`): **434/434 pass, 0 fail/cancelled/skipped**, rzeczywisty E5.7c
w przeglądarce oraz demo JH16 (32 obserwacje, `pipeline_self_check`). Instalacja
przeglądarki na hoście była wolna, ale ukończyła się; nie pozostał blocker CI.

[PR #5](https://github.com/klb-t/Watchdog-JH16/pull/5) scalono z kontrolą oczekiwanego
headu `a1449bd5acb8a1a3fb211d849a6f3d179634435f` jako
`860c844913ad3b51a653ba30ac78583a3f4e6b0b`. Zweryfikowano identyczność drzewa
merge'a z headem PR; zmiany po testowanym kodzie `827fa11` dotyczą wyłącznie
`AGENTS.md` i dokumentacji stanu/ledger/handoffu. Końcowy commit uzupełnia
README, koordynację i ten zapis bez zmian kodu.

**Następna sesja:** odczytaj `AGENTS.md` i aktualny `main` zawierający PR #5.
Nie przywracaj bazy `832947e` ani starego lokalnego szeregu commitów. Wybierz
nieprzydzielony większy pakiet, zapisz claim i pracuj małymi wycinkami. Fala 1
jest zakończona; nie ma agentów, których pracę trzeba jeszcze odzyskać.

Nadal otwarte: ogólna replikacja/hipotezy E5.7b, bezpieczne rozszerzenia E5.8b,
fikcyjny model przypadku E6.4/E6.5 oraz nowe poprawne wdrożenie Cloud Run.
Nie wykonywano nowego pełnego skanu Takeout ani instalacji na rzeczywistej VM.
Wiedza o historii pochodzi z dostępnych rozmów i jawnie opisanej rekonstrukcji repo.
