# WatchDog — koordynacja prac i odzyskiwanie po przerwaniu

Stan: 2026-09-30. Dyspozycja właściciela: samodzielny rozwój, intensywne użycie
subagentów, większe pakiety dla osobnych wątków, małe trwałe checkpointy.
To organizacja pracy, nie zmiana zatwierdzonych metod naukowych.

## Bieżący wynik — 2026-10-01, pakiety zintegrowane

PR #9 scalony do main jako `80a97253f394f28a030c9bead2040e7443fcf7fa`.
Łączy historie PR #6 CLINICAL, #7 RESEARCH i #8 OPERATIONS oraz dwie poprawki
integracyjne. Zweryfikowany kod `ca5645c` przeszedł **552/552 testy w obu jobach**
Actions `36791873648`, w tym Chromium, JH16 i trwałość rzeczywistego kontenera.
Aktualny punkt wznowienia: [handoff integracji](HANDOFF_2026-10-01_INTEGRATION.md).

Przydziały poniżej są historycznym zapisem wykonanej fali. Nie czekają już na claim,
implementację ani odbiór. Nowe zadania zaczynają od main zawierającego PR #9;
nie uruchamiaj ponownie gotowych pakietów. E5.7b i pełne E6.4/E6.5 pozostają otwarte,
a wdrożenie na rzeczywistą VM nie zostało wykonane.


## Aktualny przydział integratora — 2026-09-30 22:25 UTC / 1 października CEST

Ta decyzja rozwiązuje CLINICAL-COORD-1 i analogiczną blokadę RESEARCH.
Obowiązuje ponad wcześniejszymi zapisami „awaiting assignment” w pakietach
i audytach PR #6/#7. Właściciel projektu upoważnił samodzielne decyzje techniczne;
nie odsyłaj mu wyboru nazw, plików, migracji, gałęzi ani kolejności implementacji.
Przydział jest decyzją integratora, nie deklaracją rozpoczęcia lub ukończenia kodu.

Zweryfikowana baza kodu dla obu pracowników:
`312ba246f9bdeb035019e2ff4c1a09aaef0a734c`.
Kontynuuj własną istniejącą gałąź, zachowując opublikowany audyt.
Odczytaj ten plik ze zdalnego main, nawet jeśli własna gałąź jeszcze go nie zawiera.
Opublikuj claim we własnym pakiecie i przejdź od razu do implementacji; nie czekaj
na kolejne „tak”. Uzgodnienie zakresu nie wymaga scalenia dokumentacyjnego PR.

### RESEARCH — przydzielone, E5.7d

Właściciel: istniejący wątek RESEARCH (sesja `e15f2c5a4cd2`).
Gałąź: `codex/watchdog-research-20260930`, PR #7, zaobserwowany head
`9c1aeee6ad8f7db5b1b804ec30087771de490f40`.
Przyjmuję kontrakt implementacyjny z
`docs/work_packages/RESEARCH_CHECKPOINT_2026-09-30.md` w tym PR.
Identyfikator wycinka: **E5.7d — frozen scalar comparison**; to nie zamyka E5.7b
i nie jest aprobatą naukową konkretnego porównania.

Przydzielone ścieżki (tylko temu pakietowi w tej fali):
- `shared/paper_comparison.ts`, `shared/paper_operation.ts`;
- `backend/watchdog_api/services/paper_comparisons.ts`,
  `backend/watchdog_api/services/paper_operations.ts`;
- `backend/watchdog_api/db/repositories/paper_comparisons.ts`,
  `backend/watchdog_api/db/repositories/paper_operations.ts`,
  `backend/watchdog_api/db/repositories/workbench.ts`;
- `backend/watchdog_api/workbench/service.ts`,
  `backend/watchdog_api/workbench/publication.ts`;
- `backend/watchdog_api/api/research_routes.ts`, `server.ts`;
- `backend/watchdog_api/db/migrations/022_paper_comparisons.ts`,
  `backend/watchdog_api/db/migrations/index.ts`;
- `src/components/PaperOperations.tsx`, `config/paper-operation-ui.json`,
  `config/workbench/export/verify.mjs`;
- `tests/scientific/paper_comparison.test.ts`,
  `tests/integration/paper_comparisons.test.ts`,
  `tests/e2e/paper_comparisons.test.ts`, `fixtures/research_comparison/`;
- `docs/work_packages/RESEARCH.md`,
  `docs/work_packages/RESEARCH_CHECKPOINT_2026-09-30.md`,
  `docs/PAPER_ANALYSES.md`.

Rezerwuję migrację **022_paper_comparisons** wyłącznie dla RESEARCH.
Nowy kontrakt porównania: **paper-comparison-1**. Jeśli rozszerzenie wymaga nowej
wersji koperty eksportu, użyj kolejnej wolnej wersji po odczycie aktualnego schematu,
z zachowaniem starych czytników; jest to rutynowa decyzja wykonawcy. Nie zmieniaj
znaczenia istniejącego formatu w miejscu. Profile UI można wersjonować w tym zakresie.

Kolejność: walidowany rdzeń i testy → trwałe rewizje/review/freeze/nowe wykonanie
→ API/UI/eksport → regresja i CI. Zachowaj wymagania chronologii, cofania dostępu,
jawnych jednostek, historii błędnych prób i deterministycznego rdzenia z audytu.
Wyłączenie selektorów liczności z pierwszej wersji jest zaakceptowane; nie poprawiaj
po cichu jednostek starych artefaktów. Użyj istniejącego executora.

### CLINICAL — przydzielone, E6.4a/b → E6.5a

Właściciel: `clinical-20260930`, gałąź `codex/clinical-audit-20260930`,
PR #6, zaobserwowany head `67c10315f2257b5cf432b7fb1d9c6b01d98f2cb5`.
Przyjmuję kontrakt demonstracyjny i poniższy rozłączny zakres z
`docs/work_packages/CLINICAL_AUDIT_2026-09-30.md`.

- `shared/clinical_demo.ts`, `shared/clinical_demo_validation.ts`,
  `tests/helpers/clinical_demo.ts`;
- `backend/watchdog_api/clinical_demo/executor.ts`,
  `backend/watchdog_api/clinical_demo/executor_manifest.ts`;
- `shared/clinical_demo_profile.ts`, `shared/clinical_demo_selector.ts`;
- `tests/unit/clinical_demo_case.test.ts`,
  `tests/unit/clinical_demo_executor.test.ts`,
  `tests/unit/clinical_demo_profile.test.ts`;
- `scripts/demo_clinical.ts`;
- `docs/work_packages/CLINICAL.md`,
  `docs/work_packages/CLINICAL_AUDIT_2026-09-30.md`.

Zacznij E6.4a od walidatora, fikcyjnego przypadku i testu niekompletnej obserwacji.
Po przetestowaniu rdzenia kontynuuj interpreter E6.4b i selector E6.5a, bez pytania
właściciela o zwykłą kolejność. Odbiór pomiędzy tymi etapami oznacza testy i niezależny
przegląd subagenta, a nie kolejne pozwolenie użytkownika. Małe commity i push po etapach.
To demonstracja w pamięci z odtwarzalnym artefaktem; nie deklaruj trwałego przypadku,
integracji produktu, aprobaty klinicznej ani ukończenia całych E6.4/E6.5.
API, wspólny model aprobat, migracje i nawigacja pozostają poza tym przydziałem.
Brak lokalnego Chromium nie blokuje implementacji i testów tego czystego rdzenia.

### OPERATIONS — implementacja opublikowana, integracja otwarta

PR #8, gałąź `codex/watchdog-operations-20260930`, head
`92ae68b93ed44e3227e94e4f87abae424ad9df68`.
Kod backup/restore/update istnieje; 62/62 testy ukierunkowane według raportu wykonawcy.
Integrator potwierdził zdalne Actions **36784419713**: `verify` i `container`
zakończone sukcesem, w tym test:all/JH16 i start/trwałość kontenera.
PR jest nadal draft i nie został scalony; nie wykonano wdrożenia na rzeczywistą VM.
Odpowiedzialność za następny przegląd i scalenie jest po stronie integratora.
Pracownik utrzymuje dotychczasowy zakres skryptów, testów i dokumentacji OPERATIONS;
nie przejmuje migracji RESEARCH ani plików CLINICAL.

### Zasady wznowienia i integracji

- Integrator tego głównego wątku jest właścicielem globalnego stanu/ledgeru,
  tego dokumentu, przeglądu i kolejki scaleń. Pracownicy zapisują wyniki w swoich pakietach.
- Osobne wątki mają własne gałęzie/checkouty; subagentom przydzielają rozłączne pliki.
  Koordynują podział i niezależny przegląd samodzielnie.
- Lokalny brak Chromium/Dockera zapisuj uczciwie. Publikuj testowalny kod i użyj CI;
  błąd lokalnego środowiska nie oznacza konieczności pytania właściciela o architekturę.
- Jeśli po sprawdzeniu zdalnych gałęzi wystąpi rzeczywisty nowy konflikt, zapisz go
  w pakiecie i realizuj niekolidującą część. Nie kasuj cudzych zmian, nie przejmuj claimów.
- Ta publikacja usuwa blokadę organizacyjną. Nie uruchamia automatycznie zatrzymanych
  rozmów i nie stanowi doręczenia wiadomości. Po wznowieniu wątek ma odczytać aktualny plik.
- Nadal obowiązują jawne granice danych, wydatków i rzeczywistej aprobaty naukowej.

## Punkt startowy

- Repo: `klb-t/Watchdog-JH16`; baza ukończonej pierwszej fali = `832947e` (historyczna).
- Gałąź integracyjna tej fali: `codex/watchdog-wave1-20260930`; scalona do `main`
  przez PR #5 jako `860c844` po zielonych verify/container (434/434 każda bramka).
  Kolejne pakiety zaczynają od aktualnego `main` zawierającego to scalenie.
- Bieżący zapis: [handoff fali](HANDOFF_2026-09-30_WAVE1.md).
- Poprzedni etap: [integracja PR #4](HANDOFF_2026-09-30.md),
  [uzgodnienia](SPEC_RECONCILIATION_2026-09-30.md), [reguły](DESIGN_RULES.md).
- Stan produktu i stabilne identyfikatory zadań: `docs/spec/00_STATE_AND_DECISIONS.md`
  oraz `docs/spec/07_EPICS_AND_TASKS.md`.

## Podział pierwszej fali

| Właściciel w tej sesji | Zakres | Wynik / granica |
| --- | --- | --- |
| Integrator | Baza, zależności, wspólna bramka, ledger, checkpointy, commit/push | Jedna kolejka integracji, dokładne wyniki i blokery |
| pipeline_audit | `backend/watchdog_api/analysis/{primitives,method_spec_validation,executor}.ts`; nowy test integralności | Poprawne parowanie po ID i walidacja istniejących kontraktów; zamrożone formuły bez zmian |
| research_audit | `shared/paper_operation.ts`, serwis i UI PaperOperations, profil UI, verifier warsztatu, testy operacji | Jawny podzbiór danych w analizie publikacji; zachowane eksporty v1; bez deklaracji niezależnej replikacji |
| security_review | Repozytorium workbench i nowy test cofnięcia dostępu | Cofnięcie udostępnienia odcina cudzy odczyt; właściciel nadal może dokonać przeglądu |
| ops_audit | Instalator GCP VM, watchdogctl, dokument wdrożenia, test GCP | Instalacja aktualnego kodu i naprawy potwierdzonych usterek; bez dostępu do rzeczywistej VM |
| clinical_scope | Audyt E6.4/E6.5 | Pakiet przyszłego wątku oparty na fikcyjnych danych; bez nowych porad klinicznych |
| history_requirements | Rekonstrukcja granic wymagań i `docs/work_packages/` | Samodzielne instrukcje dla trzech większych wątków |

W tej sesji dostępnych jest sześć miejsc na subagentów poza integratorem. Liczba
uruchomionych agentów nie stanowi miary postępu; każdy ma oddzielny zakres i wynik.
Subagent nie jest osobnym głównym czatem. Przygotowanie pakietów nie oznacza, że
nowe główne wątki zostały automatycznie utworzone lub już pracują.

## Współbieżność i checkpointy

1. Przed zmianami: odczytaj najnowszy handoff, sprawdź `git status`, historię oraz
   zdalne gałęzie. Informacja z czatu może być starsza od repozytorium.
2. W tej sesji agentom przydzielono rozłączne pliki we wspólnym checkoutcie.
   Tylko integrator wykonuje commit/push. Bez `reset`, `stash`, zmiany gałęzi
   ani sprzątania cudzych plików przez pracowników.
3. Osobny główny wątek używa własnej gałęzi i checkoutu/worktree. Przed pracą
   zapisuje w swoim pakiecie właściciela, bazowy SHA, zakres plików, status
   `claimed`, czas i następny checkpoint; publikuje ten zapis. Integrator
   rozstrzyga nakładające się zakresy. Sam plik statusu nie jest blokadą atomową.
4. Nie uznawaj starego claimu za porzucony tylko z powodu upływu czasu. Sprawdź
   zdalny head i postęp; przy niepewności pracuj na oddzielnej gałęzi i nie
   nadpisuj wcześniejszej pracy. Konflikty rozwiązuje integrator po porównaniu.
5. Checkpoint po każdym spójnym, przetestowanym wycinku, przed dłuższym zadaniem
   i przed zmianą kontekstu. Zapis zawiera: bazę/head, zmienione pliki,
   zakończone/otwarte zadania, dokładne komendy i wyniki, decyzje i blokery.
6. Commituj tylko sprawdzony zakres. Push małych checkpointów; nie czekaj na
   ukończenie całej fali. Nie uruchamiaj kosztownych workflow dla samych notatek.
   Wynik lokalny, CI i wdrożenie są trzema oddzielnymi twierdzeniami.
7. Jeżeli push się nie uda, zapisz lokalny commit i blocker, następnie utrwal
   przenośny `git bundle` w trwałym miejscu. Nie nazywaj lokalnego commita
   zdalnym checkpointem. Nie umieszczaj danych użytkowników ani sekretów w repo.
8. Wyszukiwanie historii pomaga odzyskać kontekst; nie zapewnia synchronizacji,
   blokady, doręczenia wiadomości ani aktualności między wątkami.

## Większe pakiety

[Pakiety wątków](work_packages/README.md) dzielą dalszy rozwój na warsztat badawczy,
fikcyjny model przypadku oraz utrzymanie prywatnej instalacji. Każdy kończy się
małym zintegrowanym przepływem, testami i przekazaniem, nie listą deklarowanych
możliwości. Ogólny DAG, kliniczne reguły i nowe źródła wymagają konkretnych
kontraktów; nie powstają automatycznie ze wspólnego formatu danych.
