# G2 — jawne pokrycie zależności i koszt

**Pilot zakończony.** Na zamrożonym, fikcyjnym zestawie można porównywać planowane pokrycie zależności i umowny koszt bez przypisywania prawdopodobieństw. Heurystyka pokrycie/koszt unika części redundantnych wyborów, ale **nie gwarantuje optimum**. Kontrprzykład zachowano jako wynik.

To eksperyment algorytmiczny na kontrakcie oprogramowania CLINICAL. Nie dowodzi użyteczności klinicznej, nie rankinguje rzeczywistych badań, nie wydaje zaleceń i nie wykonuje pomiarów. Samo zaplanowanie pokrycia nie usuwa braków ani nierozstrzygniętych hipotez.

## Wyniki

Wykonano **8 scenariuszy, 39 par scenariusz–budżet**, obejmujących całą zadeklarowaną siatkę budżetów. Heurystyka ma większe pokrycie od kolejności profilu w **2** przypadkach, równe w **37**, mniejsze w **0**. To opis ręcznie skonstruowanej baterii, nie estymacja częstości przewagi na nowych danych; wiersze tego samego scenariusza są zależne.

Dokładne wyliczenie obejmuje **174 podzbiory**, z których **156** spełnia dostępność i wymagania poprzedzające. Kolejność profilu odstaje od optymalnego pokrycia w **6/39** przypadków, heurystyka w **4/39**. Wszystkie podzbiory, wybory, odmowy, nierozstrzygnięcia i pełne fronty Pareto są w `runs/primary/results.json`.

W tabeli każda para oznacza **liczbę unikalnych zależności planowo pokrytych / koszt umowny**. Pokrycie nie jest liczbą niezależnych potwierdzeń ani liczbą rozstrzygniętych hipotez.

| Scenariusz | Budżet | Kolejność profilu | Pokrycie/koszt | Dokładne optimum dla budżetu |
|---|---:|---:|---:|---:|
| `archived_satisfied_control` | 1 | 0 / 0 | 0 / 0 | 0 / 0 |
| `single_missing` | 1 | 1 / 1 | 1 / 1 | 1 / 1 |
| `unavailable` | 1 | 0 / 0 | 0 / 0 | 0 / 0 |
| `redundant_profile` | 3 | 1 / 2 | 3 / 3 | 3 / 3 |
| `shared_prerequisite` | 4 | 4 / 4 | 4 / 4 | 4 / 4 |
| `unavailable_prerequisite` | 3 | 1 / 2 | 1 / 2 | 1 / 2 |
| `ratio_counterexample` | 6 | 7 / 5 | 7 / 5 | 8 / 6 |
| `gates_and_preserved_unknowns` | 7 | 0 / 0 | 0 / 0 | 0 / 0 |

W `ratio_counterexample`, przy budżecie 6, heurystyka bierze alpha i beta: 7 zależności za koszt 5. Pełne wyliczenie znajduje beta i gamma: 8 zależności za koszt 6. Są to różne punkty Pareto: większe pokrycie wymaga większego kosztu. Ten sam scenariusz ujawnia odstęp od maksymalnego pokrycia przy budżetach 3, 4 i 7. Nie wolno zastąpić widoku koszt–pokrycie pojedynczą oceną jakości heurystyki.

W `redundant_profile` kolejność bierze dwa pomiary tej samej ilości; pokrywa tylko jedną zależność, chociaż zużywa dwie jednostki kosztu. Heurystyka wybiera alpha i beta, zachowując niedostępne gamma jako brak. `shared_prerequisite` liczy wspólne wymaganie poprzedzające jeden raz. `unavailable_prerequisite` odrzuca pozornie dostępny test zależny od niedostępnego kroku.

## Co pochodzi z repo, a co dodano

Baza i head produktu w momencie przygotowania: **`61daefd82cc778e28d2d3868eaaf0689d856fc49`**. Hash publikacji samego pakietu nada integrator; później można go ustalić przez `git log -- research/gpt-20261002/g2`. Nie jest on z góry wymyślony ani utożsamiony z bazą.

Przypięto `shared/clinical_demo_profile.ts`, `shared/clinical_demo_selector.ts`, `shared/clinical_demo.ts` oraz `docs/history/evidence/2026-10-01/clinical-case-a.json`. Pełne bajty i hashe znajdują się w `source/` i `inputs.json`; kopie TypeScript mają końcówkę `.ts.txt`, zgodnie z `snapshot-packaging.json`, aby nie wchodziły do kompilacji produktu.

Oryginalny profil ma jeden fikcyjny test i **nie definiuje kosztów ani rankingu**. Archiwalny przypadek ma już alpha; pozostawiono go jako kontrolę bez nowych propozycji. Pozostałe scenariusze to jawne rozszerzenia: nowe fikcyjne ilości i zależności, brakujące wartości, koszty oraz graf wymagań wykonywania testów jako osobne pola eksperymentalne. Nie zmodyfikowano produktu ani jego zatwierdzonych reguł. Nie wyciągano aktualnej aprobaty z historycznego archiwum.

Odrębność testów nie daje dodatkowej liczby potwierdzeń. Liczymy unię identyfikatorów zależności. Kilka reguł zależnych od tej samej ilości nadal pozostaje współzależnymi warunkami programowymi. Zależność w grafie nabywania oznacza tylko wymóg kolejności/kosztu skonstruowany w tym eksperymencie, nie biologiczną zależność pomiarów.

## Kontrole i ograniczenia

- Wyniki zachowują **wszystkie pierwotne braki i identyfikatory nierozstrzygniętych hipotez** także wtedy, gdy zestaw testów planowo pokrywa zależności. Pole `actual_missing_dependency_ids` oznacza nierozstrzygnięte stany fikcyjnych wejść, także `not_applicable` i `source_unapproved`; nie zastępuje archiwum obserwacji.
- Dobór respektuje zadeklarowaną dostępność, wymagania poprzedzające, jednostki, tryb, znany kontekst i okno przyszłego zdarzenia. Nie naprawia historycznych metadanych, przypiętej obserwacji, konfliktu, braku stosowalności ani braku aprobaty.
- Heurystyka używa dokładnych ułamków, a remisy rozstrzyga deterministycznie. Wszystkie wybory mieszczą się w budżecie i przechodzą sprawdzenie wymagań.
- Niezależny skan po zależnościach potwierdza unię pokrycia dla każdego dopuszczalnego podzbioru. Wyliczenie optimum jest niezależne od heurystyki, ale **dzieli funkcję zgodności profilu**: nie jest niezależną walidacją pełnego selektora TypeScript. Pilot odwzorowuje wąski kontrakt fikcyjny, nie cały executor ani aktualną autoryzację.
- Kontrole obejmują jawny kontrprzykład, brak dostępności i brak zgodnych krawędzi. Nie zakładano, że heurystyka wygra z optimum.
- Siatka jest mała i skonstruowana celowo. Nie określa skalowania, niezależności pomiarów, znaczenia klinicznego, entropii ani wartości diagnostycznej. Brak kosztów rzeczywistych nie został zastąpiony wymyślonymi cenami: jednostki są wyłącznie umowne.

## Odtwarzanie offline

Z katalogu głównego repo:

```bash
python3 research/gpt-20261002/g2/run.py --verify research/gpt-20261002/g2/runs/primary/results.json
python3 research/gpt-20261002/g2/replay_initial.py
```

Pierwsze polecenie weryfikuje hashe zamrożonego protokołu, wejść, generatora i źródeł, wykonuje cały eksperyment oraz porównuje wynik bajtowo. Drugie odtwarza pierwszy przebieg sprzed poprawki pakowania w katalogu tymczasowym. Nowy zapis można utworzyć flagą `--output /tmp/watchdog-g2-new-run`, wskazując nieistniejący katalog. Nie wymaga Git, npm, sieci ani usług zewnętrznych; odtworzenie korzysta z dołączonych bajtów źródeł. Zamrożonego `prepare_inputs.py` nie trzeba uruchamiać ponownie.

Środowisko: Python **3.12.14**, `Linux-6.18.44-x86_64-with-glibc2.39`, wyłącznie biblioteka standardowa. Przebieg primary: **0.031372 s**; pomiary czasu są operacyjne i nie są deterministycznym wynikiem. Płatne wywołania/API: **0**. Dokładny receipt jest w `runs/primary/receipt.json`.

SHA-256 protokołu: `d186782c8d13f8de920e715cd9f61e7ca7e3c554c6aa0e7d1dd3e2fc249ffba8`.

SHA-256 wejść: `f0b3655cdad6dbd8071a296bee18a4255ec191dca91e167018e399a868acf7fb`.

SHA-256 deterministycznego wyniku: `e92b5b40645a301ad16a880ce529616b12b116a7c43bdb95f4b5731b1610be8c`.

`freeze.json` rejestruje zapis przed wynikami; `CHRONOLOGY.md` zachowuje korektę pakowania i powtórzenia. Lokalny zapis kolejności nie jest niezależną prerejestracją. Dwa replay primary i replay initial są zapisane w `verification.json`; wszystkie porównania są identyczne bajtowo.

## Do głównego workflow

Claude może wykorzystać ten pakiet jako evidence dla przyszłego E6.5: pokazywać pokrywane zależności, koszty, wspólne wymagania i nierozstrzygnięcia oddzielnie. Przed dodaniem optymalizacji potrzebny będzie osobny kontrakt kosztu i dopuszczalności. Dla małych zbiorów można pokazywać cały front Pareto; heurystyka powinna jawnie ujawniać ograniczenie i znany kontrprzykład. **Nie przeniesiono teraz algorytmu do produktu i nie zamknięto E6.5.**
