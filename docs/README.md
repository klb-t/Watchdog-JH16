# Dokumentacja WatchDog

## Pierwszy przegląd projektu

- [Opis projektu i działających zakresów — English overview](OVERVIEW.md)
- [Odebrane przyrosty z przypiętymi dowodami](PROGRESS.md)

## Bieżący stan i przekazanie

- [GPT → Claude: aktualny punkt startowy 2.10](HANDOFF_2026-10-02_TO_CLAUDE.md), [dokończenie odbioru 2.10](RESUME_2026-10-02.md)
- [Raport: gałęzie, PR-y, testy i pominięcia](REPORT_GPT_2026-10.md)
- [Stan i decyzje](spec/00_STATE_AND_DECISIONS.md)
- [Jedna kolejka otwartych zadań](spec/07_EPICS_AND_TASKS.md), [aliasy dawnych numerów](TASK_ID_ALIASES.md)
- [Koordynacja](WORK_COORDINATION.md), [sprawdzalne zasady](PRINCIPLES.md), [reguły projektowe](DESIGN_RULES.md)
- [Wykonane pilotaże GPT na osobnej gałęzi](PARALLEL_RESEARCH_GPT.md)

## Ukończona konsolidacja

Macierze zachowują porównanie źródłowych gałęzi i opisują wykonaną integrację oraz jej granice. Pierwotny odbiór: 604/604; uzupełniony checkpoint 2.10: 613/613. Każdy ma osobny receipt.

- [Admission: email, Google, zaproszenia i uprawnienia](consolidation/admission.md)
- [Nawigacja: siedem obszarów, PL/EN i istniejące ekrany](consolidation/navigation.md)
- [HTTPS i późniejsze poprawki operacyjne](consolidation/deployment.md)

## Uruchomienie i kontrakty

- [Prywatna VM](DEPLOY_GCP_VM.md), [ograniczenia Cloud Run](DEPLOY_GCP.md), [admission](ADMISSION.md)
- [Zgłoszenia uruchomień HTTP i ich walidacja](RUN_SUBMISSION_API.md)
- [Architektura](spec/01_ARCHITECTURE.md), [model danych](spec/02_DATA_MODEL.md), [testy](spec/09_TESTS.md)
- [Kontrakt JH16](spec/03_JH2016_CONTRACT.md), [metody i aprobata](spec/04_METHOD_COMPILER_AND_APPROVAL.md)
- [Źródła](SOURCE_ACCESS.md), [warsztat](WORKBENCH.md), [interfejsy terenowe i kliniczne](spec/11_FIELD_AND_CLINICAL_INTERFACES.md)
- [Szersza specyfikacja](specifications/00_START_HERE.md), [uzgodnienie specyfikacji z kodem](SPEC_RECONCILIATION_2026-09-30.md)

## Dowody i historia

- [Manifest Git](audit/2026-10-01/git-inventory.json), [snapshot GitHub API](audit/2026-10-01/github-evidence.json), [podgląd konfliktów](audit/2026-10-01/merge-preview.txt)
- [Indeks historyczny](history/README.md), [katalog eksperymentów i replay](history/EXPERIMENTS.md), [reguły historii](HISTORY_POLICY.md), [pierwotny receipt](history/evidence/2026-10-01/receipt.json), [odbiór domknięcia](history/evidence/2026-10-02-completion/receipt.json), [publikacja](history/evidence/2026-10-02-completion/publication.json)

Historia zachowuje ówczesne wyniki i ograniczenia. Starsze instrukcje przydziału nie uruchamiają ponownie ukończonych zadań; aktualny status rozstrzygają bieżący ledger i dokładne SHA.
