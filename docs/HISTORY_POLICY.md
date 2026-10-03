# Historia, eksperymenty i liniowe postępy

`main` pokazuje zaakceptowany stan produktu. Od konsolidacji 2026-10-01 każdy nowy commit main ma jednego rodzica. Nie przepisujemy dawnych merge’ów, podpisów ani SHA dla pozornej liniowości. Z gałęzi bocznej przyjmujemy przetestowaną, spójną zmianę przez squash lub cherry-pick, z odwołaniem do źródłowych SHA i receipt. Nie scalaj całego eksperymentu tylko po to, żeby zachować jego historię.

Historia źródeł pozostaje w refs `archive/2026-10-01/main-before-consolidation` (`31b813f47455adf58746a272fe1f3e7aecc01383`) i `archive/2026-10-01/claude-before-consolidation` (`9dea9aab41259770889f2798da49c0f8bb82ecba`). Są to gałęzie archiwalne: umownie niezmienne, nie technicznie chronione tagi. Nie przesuwaj ani nie usuwaj ich. Razem zachowują wszystkie 120 commitów z [manifestu](audit/2026-10-01/git-inventory.json). Dawne gałęzie robocze pozostają do porównania.

Domknięcie publikacji zachowuje pakiet G1–G3 na `research/gpt-pilots-20261002` (`9c562d8d20ea2e129b44062080c138cb2adb1ceb`) oraz dokładne oryginalne commity w [archiwum checkpointów](https://github.com/klb-t/Watchdog-JH16/tree/a683082ca630e1c6e1e2eb09a7e3ca10e7b4dfb3). [Manifest historii](history/evidence/2026-10-02-completion/history.json) przypina heads, wszystkie 120 wcześniejszych commitów i hash bundle. Nie utworzono anotowanych tagów; gałęzie archiwalne są niezmienne z konwencji. Publikacja przez API nadała nowe SHA przy identycznych drzewach; oryginały są odtwarzalne. Algorytmy i duże raw pilotaży nie są częścią drzewa main.

## Jeden przyrost

1. Fetch, porównanie wszystkich nowych refs i czysty, odizolowany zakres. Zapisz base i listę źródeł.
2. Zapisz kryterium akceptacji; odróżnij zgodę na implementację od naukowej aprobaty metody.
3. Wykonaj zmianę, właściwe testy i konkretny replay. Zapisz porażki oraz poprawkę, nie tylko końcowy wynik.
4. Odbierz dokładny połączony kod. Gdy main zmieni się w międzyczasie, zintegruj i sprawdź wpływ; nie nadpisuj cudzego heada.
5. Jeden rodzic, opis źródeł i dowodów; fast-forward z `force=false`. Uaktualnij ledger, stan i checkpoint. Zachowaj źródłowe refs.

„Zaakceptowany” oznacza odbiór zadeklarowanych kryteriów implementacji przez prowadzącego w ramach upoważnionego zakresu. Nie oznacza automatycznej naukowej aprobaty, zgody na wydatek ani pozytywnego wyniku badania.

## Artefakt eksperymentalny

Dla każdego eksperymentu zachowaj: status (proposed/running/completed/failed/blocked), pytanie, protokół zapisany przed wynikami, dokładne base/head, wersje narzędzi i lockfile, wejścia i ich hashe, polecenia/seed, surowe wyniki i logi, ograniczenia oraz instrukcję replay. Zmiana protokołu po obejrzeniu wyników dostaje nową wersję. Negatywny wynik pozostaje wynikiem; przerwany run nie jest sukcesem.

Indeks i niewielkie publiczne fixtures/receipts są w `docs/history/`. Duże samowystarczalne pakiety na gałęzi `research/*` lub w trwałym magazynie muszą mieć manifest i hash; sam efemeryczny CI artifact lub plik w `/tmp` nie stanowi archiwum. Dane prywatne i sekrety nie trafiają do publicznego repo. Brakujące dane oznacz jako brak, a nie rekonstruowaną obserwację.

Historyczne dokumenty zachowują oryginalne twierdzenia i ścieżki; nie są aktywną kolejką. Bieżący punkt wejścia to [handoff](HANDOFF_2026-10-02_TO_CLAUDE.md), a katalog dowodów to [EXPERIMENTS](history/EXPERIMENTS.md).
