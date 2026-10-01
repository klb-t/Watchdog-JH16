# Równoległe testy GPT po przekazaniu

Status: **proponowane protokoły, niewykonane**. Claude prowadzi produkt i integrację; GPT może pracować na osobnej gałęzi `research/gpt-*` z przypiętą bazą, bez edycji plików admission/nawigacji/deployment. Każdy pilot zamraża parametry i metryki przed wynikami. Nie potrzebuje płatnego API ani danych prywatnych.

| ID i falsyfikowalna teza | Eksperyment i kontrola | Wynik do oddania |
|---|---|---|
| G1 — wspólne pochodzenie może zawyżać liczbę niezależnych potwierdzeń | Syntetyczny korpus: niezależne źródła, kopie i parafrazy ze znanym lineage. Porównać liczenie dokumentów, deduplikację hash i jawne grupy pochodzenia przy tym samym materiale. Miary: podwójne liczenie, utrata niezależnych obserwacji, koszt. Kontrprzykład: dwie niezależne obserwacje o identycznej treści | Generator, prawda generatora, raw wyniki, błędy i granica: nie dowodzi rzeczywistej niezależności źródeł |
| G2 — wybór brakujących pomiarów może być użyteczny bez fikcyjnego prawdopodobieństwa | Na fikcyjnych regułach CLINICAL porównać liczbę pokrytych zależności, koszt i zachowane nierozstrzygnięcia z prostą kolejnością profilu. Oddzielić redundantne/zależne testy i niedostępność. Bez nazywania countu entropią, bez reguł leczenia | Pareto koszt–pokrycie oraz kontrprzykłady; wynik nie jest klinicznym rankingiem badań |
| G3 — powtarzane poszukiwanie najlepszego podzbioru daje więcej przypadkowych dopasowań niż zamrożone porównanie | Syntetyczny null i znany sygnał: eksploracyjny wybór kohort vs osobna confirmatory partycja przy równym budżecie prób. Zamrozić seed rodziny, zakres prób i miary. Nie dotykać locked JH16 | Rozkład fałszywych dopasowań/mocy wraz z mianownikami; propozycja kontraktu E5.7b, nie retrospektywna prerejestracja |

Każdy pakiet: `protocol.json`, wersja generatora/danych i SHA-256, pełny kod, środowisko, surowe wyniki, koszty/czas, kontrole, ograniczenia, `RESULT.md` z dokładnym base/head oraz testem replay bez sieci. Wynik dodatni i ujemny mają ten sam obowiązek publikacji. Zmiana po obejrzeniu danych tworzy nową wersję protokołu z jawną chronologią.

Integracja: Claude porównuje kontrakt i wyniki z bieżącą bazą, przyjmuje mały adapter albo pozostawia negatywny wynik jako evidence. Nie zmieniać danych/reguł produktu tylko po to, aby eksperyment dawał przewagę. Ta lista rezerwuje rozłączne pytania, nie uruchamia procesów w tle.
