# Pilotaże GPT poza głównym workflow

Status: **G1–G3 wykonane; ponowny replay wszystkich pakietów zakończony identycznymi bajtami 2.10.2026**. Kod, protokoły, pełne raw, ograniczenia i kontrprzykłady pozostają na `research/gpt-pilots-20261002`, head **`9c562d8d20ea2e129b44062080c138cb2adb1ceb`** (publikacja identycznego drzewa oryginalnego `7346f0a0d6d397e6e3e2efcc60d92dfd15dd81b6`). Nie zmieniono produktu ani locked JH16 i nie nadano wynikom naukowej aprobaty. Baza eksperymentów: `61daefd82cc778e28d2d3868eaaf0689d856fc49`.

[Pakiet G1–G3](https://github.com/klb-t/Watchdog-JH16/tree/9c562d8d20ea2e129b44062080c138cb2adb1ceb/research/gpt-20261002) · [manifest 43 plików](https://github.com/klb-t/Watchdog-JH16/blob/9c562d8d20ea2e129b44062080c138cb2adb1ceb/research/gpt-20261002/PACKAGE_SHA256.json)

| Pilot | Wynik zachowany w pakiecie | Granica |
|---|---|---|
| G1 | 96 korpusów / 288 wyników. Hash treści może scalać niezależne identyczne teksty i rozdzielać parafrazy jednego pochodzenia; błędne lineage myli się w obie strony. 7/7 kontroli i pełny replay | Znana prawda generatora nie dowodzi niezależności rzeczywistych źródeł |
| G2 | 39 budżetów / 174 podzbiory, pełne fronty Pareto. Heurystyka pokrycie/koszt ustępuje maksymalnemu pokryciu w 4/39 przypadkach; oba zachowane przebiegi odtworzono | Fikcyjny kontrakt algorytmiczny, bez rzeczywistych cen, prawdopodobieństw czy rankingu klinicznego |
| G3 | 10 000 prób. Przy 20 kohortach null: eksploracja 63,24%, holdout 4,68%, Bonferroni 4,52%. Przy równym budżecie danych wykrywanie właściwego sygnału: Bonferroni 88,72%, holdout 67,14% | Niezależne kohorty i znana wariancja; brak uniwersalnego zalecenia dzielenia danych |

Oryginalne SHA są dostępne przez [archiwum checkpointów](https://github.com/klb-t/Watchdog-JH16/tree/a683082ca630e1c6e1e2eb09a7e3ca10e7b4dfb3). Logi replay zachowano z 2.10; audyt i publikację domknięto 3.10.

## Odtworzenie bez sieci

Użyj osobnego checkoutu, aby nie przełączać aktywnego drzewa produktu:

```bash
git worktree add --detach ../watchdog-pilots-replay 9c562d8d20ea2e129b44062080c138cb2adb1ceb
cd ../watchdog-pilots-replay
PYTHONDONTWRITEBYTECODE=1 python3 research/gpt-20261002/g1/test_replay.py
python3 research/gpt-20261002/g2/run.py --verify research/gpt-20261002/g2/runs/primary/results.json
python3 research/gpt-20261002/g2/replay_initial.py
python3 research/gpt-20261002/g3/run.py --verify research/gpt-20261002/g3/results
```

Eksperymenty używają biblioteki standardowej CPython 3.12.14. Dokładny replay G3 zależy również od libm/kompresora; zapisane statystyki pozwalają osobno przeliczyć analizę. Powtórzenie nie potrzebuje npm, płatnego API, danych prywatnych ani aktywnej aprobaty produktu. [Logi ponownego odbioru](history/evidence/2026-10-02-completion/replay.json) przypinają środowisko, SHA pakietu i wszystkie wyniki.

## Pytania i protokoły zapisane przed runami

Poniższe pytania zachowują zakres pierwotnego planu. Przyszłe zmiany danych, parametrów lub kryteriów otrzymują nowy protokół; nie nadpisują wyników tych pilotaży.

| ID i falsyfikowalna teza | Eksperyment i kontrola | Wynik do oddania |
|---|---|---|
| G1 — wspólne pochodzenie może zawyżać liczbę niezależnych potwierdzeń | Syntetyczny korpus: niezależne źródła, kopie i parafrazy ze znanym lineage. Porównać liczenie dokumentów, deduplikację hash i jawne grupy pochodzenia przy tym samym materiale. Miary: podwójne liczenie, utrata niezależnych obserwacji, koszt. Kontrprzykład: dwie niezależne obserwacje o identycznej treści | Generator, prawda generatora, raw wyniki, błędy i granica: nie dowodzi rzeczywistej niezależności źródeł |
| G2 — wybór brakujących pomiarów może być użyteczny bez fikcyjnego prawdopodobieństwa | Na fikcyjnych regułach CLINICAL porównać liczbę pokrytych zależności, koszt i zachowane nierozstrzygnięcia z prostą kolejnością profilu. Oddzielić redundantne/zależne testy i niedostępność. Bez nazywania countu entropią, bez reguł leczenia | Pareto koszt–pokrycie oraz kontrprzykłady; wynik nie jest klinicznym rankingiem badań |
| G3 — powtarzane poszukiwanie najlepszego podzbioru daje więcej przypadkowych dopasowań niż zamrożone porównanie | Syntetyczny null i znany sygnał: eksploracyjny wybór kohort vs osobna confirmatory partycja przy równym budżecie prób. Zamrozić seed rodziny, zakres prób i miary. Nie dotykać locked JH16 | Rozkład fałszywych dopasowań/mocy wraz z mianownikami; propozycja kontraktu E5.7b, nie retrospektywna prerejestracja |

Każdy pakiet: `protocol.json`, wersja generatora/danych i SHA-256, pełny kod, środowisko, surowe wyniki, koszty/czas, kontrole, ograniczenia, `RESULT.md` z dokładnym base/head oraz testem replay bez sieci. Wynik dodatni i ujemny mają ten sam obowiązek publikacji. Zmiana po obejrzeniu danych tworzy nową wersję protokołu z jawną chronologią.

Integracja: Claude porównuje kontrakt i wyniki z bieżącą bazą, przyjmuje mały adapter albo pozostawia negatywny wynik jako evidence. Nie zmieniać danych/reguł produktu tylko po to, aby eksperyment dawał przewagę. Żaden algorytm G1–G3 nie został przyjęty do produktu przez sam zapis pakietu; E5.7b i E6.5 pozostają otwarte.
