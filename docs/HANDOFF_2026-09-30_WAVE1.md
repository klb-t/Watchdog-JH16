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
