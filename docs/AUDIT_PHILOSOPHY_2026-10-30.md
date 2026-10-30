# Audyt zgodności z filozofią projektu — WatchDog

**Przegląd tylko do odczytu, wykonany przez agenta AI. Wnioski nie zostały zweryfikowane przez człowieka.**
Gałąź: `claude/dutch-language-20261030` (main + holenderski). Commit: `494e84afc4d279d4e6b5734504e372dfbe7fe50c`. Data: 2026-10-30.
Katalog: `/home/kielbowicz_marcin/Watchdog-JH16/.claude/worktrees/agent-aaff16c837bed5ca7`. Ścieżki poniżej są względem korzenia repozytorium. Żaden plik repozytorium nie został zmieniony; nie uruchamiano serwerów ani testów.

## 1. Podsumowanie

Kod jest w większości zdyscyplinowany. Źródła płatne wymagają jawnego wyboru i limitów, dostępność dostawców jest wyliczana z poświadczeń, a brak wartości jest zwykle jawnie modelowany. Znaleziono **17 uwag**: wysokich 3, średnich 8, niskich 6. Poniżej podział na kategorie (wys./śr./nis.).

| Kategoria | wys. | śr. | nis. |
|---|---|---|---|
| A. Tekst widoczny dla czytelnika poza konfiguracją | 0 | 4 | 2 |
| B. Płatne wywołanie bez budżetu / domyślny płatny dostawca | 1 | 0 | 0 |
| C. Klucze konfiguracji, których nic nie czyta | 0 | 1 | 2 |
| D. Stałe wybory w kodzie zamiast konfiguracji | 0 | 0 | 2 |
| E. Stany bez wyjścia | 1 | 0 | 0 |
| F. Testy sprawdzające „coś jest", a nie „właściwe jest" | 0 | 1 | 0 |
| G. Brak wartości zamieniony na 0 / niedeterministyczna kolejność | 1 | 2 | 0 |

Najważniejsze: G1 (brak wartości odczytany jako 0), E1 (przebieg bez anulowania i bez wyjścia po restarcie), B1 (płatny endpoint narracji z domyślnym OpenRouter, bez budżetu).

## 2. Uwagi według kategorii

### A. Tekst widoczny dla czytelnika poza konfiguracją (config/ui/*.json)

**A1 — średnia, potwierdzone.** `backend/watchdog_api/db/repositories/automation.ts:16`: `export class AutomationError extends Error { readonly code = 'automation_error'; ... }`.
W kodzie jest 186 miejsc `new AutomationError('...angielskie zdanie...')` (np. `llm/routing.ts`, `services/assistant.ts`: „Model prices are stale; refresh the catalog before making a paid call", „Enable assistant calls in your personal settings first"). Wszystkie mają jeden kod i żaden `error_automation_error` nie istnieje w `config/ui/*.json`. `src/lib/ui_text.ts` (`errorText`) bez etykiety pokazuje tekst serwera, więc czytelnik PL/NL widzi angielskie zdanie. Łamie zasadę 3 („UI labels live in configuration") i obietnicę z `config/languages.json`. Podobnie `backend/watchdog_api/api/auth_routes.ts:200,229,242` i `api/middleware.ts:58-59` zwracają angielskie `message` obok kodu; część kodów ma etykiety (`config/access/ui.json`), ale `validation_error` itp. nie wszędzie.

**A2 — średnia, potwierdzone.** `backend/watchdog_api/services/replication_dossier.ts:118-124` (`READING`, `STATUS`, `RUN_STATE`, `FLAG`: „dane wspierają hipotezę", „wykazana"…), `:353` (`<html lang="pl">`), `:184,209,254,285,318` (całe zdania po polsku wstawione w kodzie), plus przecinek dziesiętny wpisany na stałe (`.replace('.', ',')`, `:114-115,121`).
Manuskrypt/dossier jest generowany tylko po polsku niezależnie od języka interfejsu (EN/NL), a format liczb nie pochodzi z `locale` w `config/languages.json`. `tests/unit/ui_text.test.ts` skanuje tylko `src/pages` i `src/components`, więc tego nie widzi.

**A3 — średnia, potwierdzone.** `backend/watchdog_api/db/repositories/search.ts:114` (`row.language ?? 'Język nieznany'`) i `:71` (`doc.observedOn ?? 'Data nieznana'`).
Polski napis zastępczy trafia do `details` wyniku wyszukiwania, który dostaje każdy czytelnik. To też brak wartości zapisany jako tekst w warstwie danych, a nie jawny `null` do przetłumaczenia w UI (zasada 5).

**A4 — średnia, potwierdzone.** `backend/watchdog_api/services/narrative.ts:95-105` (deterministyczna narracja po angielsku: „Methodological reproduction completed…", „Data acquisition produced…"), `services/charts.ts:53-55` (`label: 'no data'`), `shared/geography.ts:125` (`All numeric source values = …` w legendzie rysunku).
Zdania i etykiety wykresu pisane w kodzie, bez pakietu językowego. Narracja ma w komentarzu uzasadnienie „reporting-language rule" w `03_JH2016_CONTRACT.md`, ale dotyczy ono sformułowań naukowych, nie wyboru języka; wersja PL/NL nie istnieje.

**A5 — niska, potwierdzone.** `src/lib/llm_readiness.ts:12,19,22`: polskie napisy w polu `reason` (`'Sprawdzanie ustawień modelu…'`, `'Model językowy jest wyłączony…'`). Strony używają `code`/`params`, więc napisy są martwym zapasem, ale leżą w `src/lib`, którego test nie skanuje.

**A6 — niska, potwierdzone.** `src/components/RegionControls.tsx:72-73` porównuje `row.reason === 'Missing region identifier'` i `` `No exact geometry match for ${…}` `` z angielskim komunikatem serwera, żeby go przetłumaczyć. Zmiana zdania w backendzie po cichu wyłącza tłumaczenie; powinien być stabilny kod.

### B. Płatne wywołanie / domyślny dostawca

**B1 — wysoka, potwierdzone (fakty); skutek zależy od tego, kto ma uprawnienie.** `backend/watchdog_api/api/routes.ts:475`: `const providerKey = String((req.body ?? {}).provider ?? 'openrouter');` w `POST /runs/:id/narrative/generate` (`:467`).
Gdy żądanie nie wskaże dostawcy, wybierany jest na stałe płatny OpenRouter z kluczem operatora (`env:OPENROUTER_API_KEY`). W tej ścieżce nie ma sprawdzenia budżetu ani rezerwacji, nie ma `consent: true` i nie ma `sameOriginMutation` (zabezpiecza ją tylko globalny `crossSiteGuard`). Druga ścieżka, `/narrative/automatic` (`:509`), wymaga zgody i używa budżetu osobistego (`services/assistant.ts` — `reserve`/`dailyBudgetUsd`). Zasada: „no silent … provider substitution", „paid spending" wymaga decyzji właściciela. Dodatkowo `model` pochodzi z ciała żądania (`:498`), choć `allowed_models` go ogranicza. Endpoint nie jest używany przez UI (tylko testy `tests/integration/api.test.ts:172`, `run_access.test.ts:54`), więc to wyłącznie powierzchnia API.

### C. Klucze konfiguracji, których nic nie czyta

**C1 — średnia, potwierdzone.** `config/presets/jh2016-faithful.json:22-26,99-106`: `search_method.safe_search`, `record_actual_provider_parameters`, `missing_count_policy: "missing_not_zero"`, `safe_search_unknown_flag: "SAFESEARCH_UNKNOWN"`, `metrics.Pi/Hi`, `validation.reference_score_set/_version`.
Przeszukanie `src/ shared/ backend/ server.ts scripts/ tests/` nie znajduje żadnego odczytu tych kluczy. Preset zapisuje politykę („brak liczby to nie zero"), ale egzekwuje ją kod niezależnie: flaga `'SAFESEARCH_UNKNOWN'` wpisana na stałe w `backend/watchdog_api/sources/serpapi.ts:319`, `safe: "off"` osobno w `config/providers/search_result_count.json:18`, wzory Pi/Hi w `analytics/jh16.ts`, zbiór odniesienia czytany bezpośrednio z `nutt-2010.json` w `routes.ts` (`readConfig('config','reference','nutt-2010.json')`). Preset (haszowany do manifestu) mówi więc coś, czego nic nie weryfikuje; zmiana wartości nic nie zmieni.

**C2 — niska, potwierdzone.** `config/replication/jh2016-interpretation.json:15` (`significance_alpha: 0.01`) i `cr2014-interpretation.json:16` (`0.05`): nikt tych kluczy nie czyta; próg czytany w kodzie to `supports.p_two_sided_below` (`services/jh16_evaluation.ts:123`).

**C3 — niska, potwierdzone.** `shared/settings.ts:13-15` / `config/assistant.json` (`research.slang`, `sentiment`, `dialects`, `geographies`, domyślnie `slang: true, sentiment: true`). W backendzie tylko trafiają do rekordu planu (`services/research_plans.ts:59`) i do tekstu promptu w `ConfigurationWizard.tsx:151`; żaden kod niczego z nich nie wykonuje. Plan jest jawnie oznaczony `EXPLORATORY_PLAN`, więc to nie fabrykacja, ale domyślne `sentiment: true` sugeruje włączoną funkcję, której nie ma (WD-19).

### D. Stałe wybory w kodzie

**D1 — niska, potwierdzone.** `backend/watchdog_api/services/personal_search.ts:26,29` (timeout `20000` ms, limit odpowiedzi `5000000` B) i `services/assistant.ts:31` (`20000`), `:106` (`temperature: 0`) — gdy obok tego `profile.transport.timeoutMs` jest w `config/assistant.json`. Wartości transportowe powinny być w profilu.

**D2 — niska, potwierdzone.** `backend/watchdog_api/mail/index.ts:183`: `timeZone: 'Europe/Warsaw'` na stałe w zaproszeniach; `backend/watchdog_api/api/routes.ts:109-112`: lista źródeł JH16 i ich `attempt_meaning` (zdania) w kodzie, a nie w presecie. To dwie niewielkie „ustawione na stałe" decyzje; zasada 3 oczekuje konfiguracji.

### E. Stany bez wyjścia

**E1 — wysoka, potwierdzone.** Przebiegi (`runs`): `backend/watchdog_api/domain/run_state.ts` definiuje `CANCELLED`, ale **nic w backendzie go nie ustawia** (jedyne wystąpienia: `run_state.ts`, `runs.ts:66`, `src/types.ts`) i nie ma endpointu anulowania. Przebieg startuje przez `setImmediate(() => this.executeRun(runId).catch(console.error))` (`services/run_orchestrator.ts:428`); po restarcie procesu w trakcie przebiegu rekord zostaje w `RUNNING` na zawsze — nie ma odpowiednika `INTERRUPTED`/wygaśnięcia dzierżawy, który ma `automation_jobs` (`db/repositories/automation.ts:107`). `src/pages/Dashboard.tsx:44` liczy taki przebieg jako aktywny bez końca. Brak wyjścia: ani anulowania, ani „failed after restart", ani superseding w UI. (Uwaga: `catch` w `executeRun` zamyka błędy w ścieżce normalnej; luka dotyczy zabicia procesu.)

### F. Testy

**F1 — średnia, potwierdzone.** Kilka testów provenance/liczb sprawdza obecność, nie poprawność:
- `tests/e2e/demo_determinism.test.ts:142` `assert.ok(manifest.effective_config_hash)` — bez porównania z `canonicalHash` konfiguracji;
- `tests/integration/api.test.ts:105-106,115` `length > 0` dla obserwacji/wyników/zdarzeń, a pobranie surowego artefaktu jest warunkowe (`if (rawBlobId)`, `:120`) i kończy się `artifactData.length > 0` (`:123`) zamiast porównania SHA-256 treści z hashem zdarzenia;
- `tests/integration/orchestrator.test.ts:90` `assert.ok(results.length > 0)`;
- `tests/unit/domain.test.ts:29-31` `RUN_STATES.length > 0` itp. (nic nie weryfikuje zawartości).
Pozostałe testy dla liczb (np. `piAlc.valueNumeric === 100`) są konkretne.

### G. Brak wartości i kolejność

**G1 — wysoka, potwierdzone.** `backend/watchdog_api/db/repositories/data.ts:120`: `: { ...base, isMissing: false as const, numericValue: r.numeric_value ?? 0 }`.
Schemat dopuszcza wiersz `is_missing = 0` z `numeric_value NULL` (`db/migrations/001_initial_schema.ts:242`: `CHECK ((is_missing = 1 AND numeric_value IS NULL) OR (is_missing = 0))`, mimo komentarza w `:222` „Nothing downstream may coerce to zero"). Taki wiersz jest odczytywany jako pomiar o wartości 0 — dokładnie pomyłka „missing is not zero" (zasada 5), w warstwie, z której idą wskaźniki Pi/Hi. Powinien być błąd lub wiersz brakujący.

**G2 — średnia, potwierdzone.** `backend/watchdog_api/db/repositories/data.ts:119`: `missingReason: (r.missing_reason ?? 'NOT_FETCHED')` — brakujący powód zapisuje się jako konkretny powód „nie pobrano" (wymyślona przyczyna); podobnie `:101-102,108,111` wstawiają `'unknown_entity'`/`'unknown'`. Komentarz przy `language: 'unknown'` uzasadnia to dla starych wierszy, ale `NOT_FETCHED` jest twierdzeniem, a nie „nieznane".

**G3 — średnia, potwierdzone.** Sortowanie `localeCompare` bez ustalonej lokalizacji w artefaktach haszowanych: `backend/watchdog_api/services/manifest.ts:176-196` (10 miejsc, m.in. `rendered_query`, `entity_id`), `services/export.ts:49,76,129,138`. Reszta kodu przypina `'en'` (`llm/routing.ts`, `services/jh16_plan.ts`). Domyślna lokalizacja ICU zależy od środowiska, więc kolejność klucz-tekst z cudzysłowami/znakami diakrytycznymi może się różnić między maszynami, co narusza zasadę 7 (bajt-w-bajt identyczne artefakty). W repozytorium jest łącznie 59 takich wywołań bez `'en'` w `backend/ shared/ server.ts`.

## 3. Rozważone i odrzucone

- `shared/languages.ts:8` — `LANGUAGE_CODES = ['pl','en','nl']` duplikuje `config/languages.json`: komentarz podaje powód (typ TypeScript wymusza komplet języków w pakietach), a `tests/unit/languages.test.ts:9` sprawdza zgodność obu list.
- `src/components/ExtractionDatasetForm.tsx:20`, `PaperOperations.tsx:21`, `src/lib/source_history_text.ts` — tłumaczenie etykiety tylko gdy tekst PL równa się tekstowi profilu: udokumentowane (profil jest haszowany do planu i nie może być zmieniany dla wyświetlania).
- Brak cichego przełączenia na płatne źródło: `services/run_orchestrator.ts` wybiera źródło z konfiguracji przebiegu; `/studies/jh2016` wymaga jawnego `source_id`; SerpApi/Trends w ścieżce osobistej mają dzienny limit (`personal_search.ts:23`, `searchDailyRequestLimit`); `assistant.ts` ma rezerwację budżetu i `allow_fallbacks: false`.
- `zero_result_policy` jest czytany (`sources/serpapi.ts:311`); `allowed_models` jest egzekwowane (`llm/openai_compatible.ts:40`).
- `sources/count_parser.ts:16` — polskie „około" i holenderskie „ongeveer" w wyrażeniu regularnym to rozpoznawanie wejścia, nie tekst dla czytelnika.
- `shared/geography.ts:161` — punkt zastępczy (pierwszy wierzchołek) dotyczy położenia etykiety, nie wartości.
- Nazwy w `config/ui` o martwym wyglądzie (np. `config/access/ui.json`) są czytane dynamicznie (`error_${code}`), skrypt wykrywania ich nie widzi.
- Duże `README.md` w `workbench/publication.ts:72` to treść paczki eksportu, jedna w angielskim; nie sprawdzano, czy to zamierzone.
- `AutomationJob` ma dzierżawę, `INTERRUPTED`, `CANCELED`; zaproszenia/wnioski mają `denied/withdrawn` — te stany mają wyjście.

## 4. Czego nie objęto

- Pełna lista wywołań `AutomationError` (186) nie została przejrzana pojedynczo; policzono je i sprawdzono przykłady.
- Skrypty Python/sh w `scripts/` (backup, replica, desktop, deploy) — tylko pobieżnie; `populate_public.ts` sprawdzony.
- Ponad 600 asercji `assert.ok` — przejrzano próbkę dotyczącą liczb/provenance/uprawnień, nie wszystkie.
- Zgodność tłumaczeń PL/EN/NL w `config/ui/*.json` oraz jakość tłumaczenia maszynowego NL.
- Zachowanie w czasie wykonania (nic nie uruchamiano), w tym fakt, czy dziurę z E1 realnie widać po restarcie.
- Kontrola, czy `config/` poza kluczami z listy w C faktycznie ma wszystkie klucze czytane (sprawdzono klucze → kod za pomocą wyszukiwania nazw; klucze generowane dynamicznie mogą być zgłoszone fałszywie).
- Specyfikacja `docs/spec/*` czytana wybiórczo (CLAUDE.md, DESIGN_RULES.md w całości; 00 i 05 nie były czytane w całości).
