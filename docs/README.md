# Dokumentacja WatchDog

## Bieżący stan i przekazanie

- [GPT → Claude: punkt startowy](HANDOFF_2026-10-01_TO_CLAUDE.md)
- [Raport: gałęzie, PR-y, testy i pominięcia](REPORT_GPT_2026-10.md)
- [Stan i decyzje](spec/00_STATE_AND_DECISIONS.md)
- [Jedna kolejka otwartych zadań](spec/07_EPICS_AND_TASKS.md), [aliasy dawnych numerów](TASK_ID_ALIASES.md)
- [Koordynacja](WORK_COORDINATION.md), [sprawdzalne zasady](PRINCIPLES.md), [reguły projektowe](DESIGN_RULES.md)
- [Osobne hipotezy GPT](PARALLEL_RESEARCH_GPT.md)

## Ukończona konsolidacja

Macierze zachowują porównanie źródłowych gałęzi i opisują wykonaną integrację oraz jej granice. Wspólny lokalny odbiór: 604/604.

- [Admission: email, Google, zaproszenia i uprawnienia](consolidation/admission.md)
- [Nawigacja: siedem obszarów, PL/EN i istniejące ekrany](consolidation/navigation.md)
- [HTTPS i późniejsze poprawki operacyjne](consolidation/deployment.md)

## Uruchomienie i kontrakty

- [Prywatna VM](DEPLOY_GCP_VM.md), [ograniczenia Cloud Run](DEPLOY_GCP.md), [admission](ADMISSION.md)
- [Architektura](spec/01_ARCHITECTURE.md), [model danych](spec/02_DATA_MODEL.md), [testy](spec/09_TESTS.md)
- [Kontrakt JH16](spec/03_JH2016_CONTRACT.md), [metody i aprobata](spec/04_METHOD_COMPILER_AND_APPROVAL.md)
- [Źródła](SOURCE_ACCESS.md), [warsztat](WORKBENCH.md), [interfejsy terenowe i kliniczne](spec/11_FIELD_AND_CLINICAL_INTERFACES.md)
- [Szersza specyfikacja](specifications/00_START_HERE.md), [uzgodnienie specyfikacji z kodem](SPEC_RECONCILIATION_2026-09-30.md)

## Dowody i historia

- [Manifest Git](audit/2026-10-01/git-inventory.json), [snapshot GitHub API](audit/2026-10-01/github-evidence.json), [podgląd konfliktów](audit/2026-10-01/merge-preview.txt)
- [Indeks historyczny](history/README.md), [katalog eksperymentów i replay](history/EXPERIMENTS.md), [reguły historii](HISTORY_POLICY.md), [receipt odbioru](history/evidence/2026-10-01/receipt.json)

Historia zachowuje ówczesne wyniki i ograniczenia. Starsze instrukcje przydziału nie uruchamiają ponownie ukończonych zadań; aktualny status rozstrzygają bieżący ledger i dokładne SHA.
