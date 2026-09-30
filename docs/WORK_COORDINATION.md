# WatchDog — koordynacja prac i odzyskiwanie po przerwaniu

Stan: 2026-09-30. Dyspozycja właściciela: samodzielny rozwój, intensywne użycie
subagentów, większe pakiety dla osobnych wątków, małe trwałe checkpointy.
To organizacja pracy, nie zmiana zatwierdzonych metod naukowych.

## Punkt startowy

- Repo: `klb-t/Watchdog-JH16`; zweryfikowana baza `main` = `832947e`.
- Gałąź integracyjna tej fali: `codex/watchdog-wave1-20260930`.
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
