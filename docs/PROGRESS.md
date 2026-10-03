# Odebrane przyrosty WatchDoga

`main` pokazuje postęp produktu. Poniższe punkty wskazują konkretne granice odbioru; pełna historia źródeł i eksperymentów pozostaje w [katalogu historii](history/EXPERIMENTS.md). Nowe przyrosty po 1.10 mają jednego rodzica; wcześniejsze merge’e zachowują oryginalne SHA.

| Etap | Odebrany przyrost | Przypięty dowód |
|---|---|---|
| 12.09 | Warsztat danych, źródła, ekstrakcja i wybrane operacje publikacji | `09ab8a3`: 332 testy; [przebieg rozwoju](ASTRA_PROGRESS.md) |
| 23.09 | Instalator prywatnej VM, trwałość kontenera i kontrola źródeł | `c3508c1`: 373-testowy etap; [Actions 35829482923](https://github.com/klb-t/Watchdog-JH16/actions/runs/35829482923) |
| 30.09, #4 | Projekty, wyszukiwanie, admission i siedem obszarów nawigacji | `29b52a1`: 419/419; [odbiór](history/HANDOFF_2026-09-30.md) |
| 30.09, #5 | Parowanie encji, cofnięcie dostępu, kohorty publikacji i instalator | `827fa11`: 434/434; [odbiór](history/HANDOFF_2026-09-30_WAVE1.md) |
| 1.10, #9 | RESEARCH, CLINICAL i OPERATIONS; naprawy porównań i pochodzenia | `ca5645c`: 552/552 w verify i container; [odbiór](history/HANDOFF_2026-10-01_INTEGRATION.md) |
| 1.10 | E4.7/E7.7/E3.17: konta i mail, dwa profile nawigacji, HTTPS, zachowane dotychczasowe funkcje | `00a5b78`: 604/604 lokalnie; [receipt](history/evidence/2026-10-01/receipt.json) |
| 2.10 | Domknięcie odmowy OIDC, blokady odzyskiwania CLI i konfliktów legacy grantów | `a0e061f` (źródłowy `2c0e013`): 613/613 lokalnie; [receipt](history/evidence/2026-10-02/receipt.json), [szczegóły](RESUME_2026-10-02.md) |

Wyniki z różnych wierszy dotyczą różnych wersji. Liczby testów obejmują również regresje i nie są miarą zaawansowania całego produktu. Testy fikcyjnych przypadków nie dowodzą skuteczności klinicznej; JH16 na danych publikacji jest sprawdzeniem potoku. Odbiór rzeczywistej VM, zewnętrznego maila/OAuth i certyfikatu pozostaje osobnym zadaniem.

## Eksperymenty poza główną gałęzią

G1–G3 wykonano na bazie `61daefd`, a pakiet zapisano w `7346f0a` na `research/gpt-pilots-20261002`. Zachowano wszystkie surowe wyniki, protokoły i kontrprzykłady; [rejestr badań](PARALLEL_RESEARCH_GPT.md) prowadzi do przypiętego pakietu i poleceń replay. Wyniki nie zamykają ogólnego silnika replikacji ani zadań klinicznych.

## Dokumenty do przekazania

[Opis projektu](OVERVIEW.md) służy pierwszemu przeglądowi. [Aktualny handoff](HANDOFF_2026-10-02_TO_CLAUDE.md) zawiera opis ogólny i szczegółowy dla prowadzącego. [Raport GPT](REPORT_GPT_2026-10.md) zachowuje rozliczenie gałęzi, konfliktów i wcześniejszych pominięć. [Kolejka](spec/07_EPICS_AND_TASKS.md) pozostaje jedyną listą otwartych zadań produktu.

Publikację poprawek potwierdza `a0e061f`, G1–G3 `9c562d8d`, a oryginalne commity archiwum `a683082c`. [Zapis publikacji](history/evidence/2026-10-02-completion/publication.json) i [manifest historii](history/evidence/2026-10-02-completion/history.json) wiążą trwałe i źródłowe SHA.
