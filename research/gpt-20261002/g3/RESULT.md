# G3 — wybór kohorty i niezależna ocena

**Status: wykonany pilot syntetyczny; 10 000 prób, dokładny replay potwierdzony.**

Wybieranie najlepszego wyniku z 20 niezależnych kohort i ocenianie go na tych samych danych dało pod nullem 63,24% nominalnych odrzuceń. Zamrożenie wyboru na osobnym bloku i jeden test na holdoucie dały 4,68%. Obie metody w tym porównaniu mają budżet 4000 obserwacji i 20 kandydatów; liczność samej oceny wynosi odpowiednio 200 i 100 na kohortę.

**Nie wynika z tego, że podział danych zawsze jest najlepszą metodą.** Przy z góry ustalonej rodzinie niezależnych testów korekta Bonferroniego na pełnych danych także kontrolowała błąd pod nullem i zachowała więcej wykryć znanego sygnału niż podział. Ten wynik należy zachować obok wyniku wspierającego tezę G3.

## Zamrożenie i pochodzenie

- Baza repo: `61daefd82cc778e28d2d3868eaaf0689d856fc49`.
- Protokół zapisany: `2026-10-02T09:58:42.756439+00:00`; pierwszy run: `2026-10-02T10:01:40.190177+00:00`.
- SHA-256 protokołu: `24fbe9963cd014879b5291709cdee323d84ce64fb18e88644e87b9772445b647`.
- SHA-256 kodu: `f5c51859774612a09538721de0e79e64dd8bc7b75ffc01aef4d74f687ff00c86`.
- Dokładny eksperymentalny head zostanie nadany przy publikacji pakietu; powyższy hash identyfikuje wykonane bajty kodu. Nie podajemy nieistniejącego SHA commitu.
- Jest to lokalny zapis protokołu przed wykonaniem nowego pilota. Nie jest zewnętrzną rejestracją ani retrospektywną prerejestracją wcześniejszych badań.

## Dane i mianowniki

Dwa scenariusze: wszystkie średnie równe 0 oraz jedna z góry wskazana kohorta 0 o średniej 0,3. W każdym: 5000 niezależnych prób, 20 niezależnych rozłącznych kohort oraz trzy niezależne bloki A/B/C po 100 obserwacji na kohortę. Generujemy bezpośrednio dokładny gaussowski rozkład statystyki wystarczającej (z przy znanym sigma=1), zamiast materializować pojedyncze obserwacje. Raw to 10 000 wierszy z pełną precyzją 60 statystyk z, nie dane osób.

Budżety przeszukiwania 1/5/20 używają prefiksów tych samych kohort. Wybór maksymalizuje |z|; test jest dwustronny, alfa=0,05. Wersje Bonferroniego używają alfa/m. Confirmatory wybiera jeden indeks na A i ocenia go raz na niezależnym B lub B+C. Nie sprawdza innych wyników holdoutu przy wyborze. Brak przeszukiwania oznacza uprzednio wskazaną kohortę 0; przy sygnale jest to korzystna kontrola z prawidłowo wskazanym celem, a nie metoda odkrywania nieznanej lokalizacji.

Każdy odsetek w tabelach ma mianownik **5000 prób**, nie liczbę pojedynczych testów. Budżety i metody są sparowane na tych samych losowaniach. Przedziały w nawiasach to marginalne 95% przedziały Wilsona dla niepewności Monte Carlo. Nie stanowią jednoczesnego pokrycia wszystkich porównań ani przedziałów dla rzeczywistej populacji. Przedziały sparowanych różnic są w summary.json.

## Błąd pod pełnym nullem

| Kandydaci | Eksploracja, n=200 | Confirmatory, n=100 | Eksploracja n=200 + Bonferroni | Oczekiwane bez korekty |
|---:|---|---|---|---|
| 1 | 233/5000 = 4.66% [4.11%–5.28%] | 253/5000 = 5.06% [4.49%–5.70%] | 233/5000 = 4.66% [4.11%–5.28%] | 5.00% |
| 5 | 1110/5000 = 22.20% [21.07%–23.37%] | 230/5000 = 4.60% [4.05%–5.22%] | 239/5000 = 4.78% [4.22%–5.41%] | 22.62% |
| 20 | 3162/5000 = 63.24% [61.89%–64.57%] | 234/5000 = 4.68% [4.13%–5.30%] | 226/5000 = 4.52% [3.98%–5.13%] | 64.15% |

Analityczna kontrola wynika z niezależności: P(co najmniej jedno p ≤ alfa) = 1−(1−alfa)^m. Dla Bonferroniego: 1−(1−alfa/m)^m. Dla jednego niezależnego testu po wyborze: alfa, ponieważ indeks wybrany na A jest niezależny od statystyk B pod nullem. Wszystkie **36** z góry określonych kontroli analitycznych znalazło się w tolerancji 5 błędów standardowych Monte Carlo. To kontrola implementacji, a nie dodatkowy dowód nowej teorii.

## Równa liczność oceny i koszty danych, m=20

| Metoda | n w ocenie | Wykorzystane obserwacje | Odrzucenia pod nullem |
|---|---:|---:|---|
| explore_100 | 100 | 2000 | 3175/5000 = 63.50% [62.16%–64.82%] |
| confirm_100 | 100 | 4000 | 234/5000 = 4.68% [4.13%–5.30%] |
| explore_200 | 200 | 4000 | 3162/5000 = 63.24% [61.89%–64.57%] |
| confirm_200 | 200 | 6000 | 247/5000 = 4.94% [4.37%–5.58%] |
| no_search_100 | 100 | 100 | 253/5000 = 5.06% [4.49%–5.70%] |
| no_search_200 | 200 | 200 | 253/5000 = 5.06% [4.49%–5.70%] |

Porównanie explore_100/confirm_100 i explore_200/confirm_200 utrzymuje liczność oceny, ale holdout wymaga dodatkowych danych. Porównanie explore_200/confirm_100 utrzymuje całkowity koszt danych i budżet przeszukiwania, lecz dzieli informacje między wybór i ocenę. Nie przedstawiamy strat mocy wynikających z podziału jako bezkosztowego ulepszenia. Kontrola bez przeszukiwania zużywa dane tylko jednej kohorty.

## Znany sygnał, m=20

| Metoda | Dowolne odrzucenie | Trafione wykrycie kohorty sygnałowej | Błędne wykrycie kohorty zerowej |
|---|---|---|---|
| explore_100 | 4717/5000 = 94.34% [93.66%–94.95%] | 3831/5000 = 76.62% [75.43%–77.77%] | 886/5000 = 17.72% [16.69%–18.80%] |
| explore_100_bonferroni | 2567/5000 = 51.34% [49.95%–52.72%] | 2412/5000 = 48.24% [46.86%–49.63%] | 155/5000 = 3.10% [2.65%–3.62%] |
| confirm_100 | 3415/5000 = 68.30% [67.00%–69.58%] | 3357/5000 = 67.14% [65.83%–68.43%] | 58/5000 = 1.16% [0.90%–1.50%] |
| explore_200 | 4982/5000 = 99.64% [99.43%–99.77%] | 4851/5000 = 97.02% [96.51%–97.46%] | 131/5000 = 2.62% [2.21%–3.10%] |
| explore_200_bonferroni | 4483/5000 = 89.66% [88.79%–90.47%] | 4436/5000 = 88.72% [87.81%–89.57%] | 47/5000 = 0.94% [0.71%–1.25%] |
| confirm_200 | 3941/5000 = 78.82% [77.67%–79.93%] | 3886/5000 = 77.72% [76.55%–78.85%] | 55/5000 = 1.10% [0.85%–1.43%] |
| no_search_100 | 4263/5000 = 85.26% [84.25%–86.22%] | 4263/5000 = 85.26% [84.25%–86.22%] | 0/5000 = 0.00% [0.00%–0.08%] |
| no_search_200 | 4936/5000 = 98.72% [98.37%–99.00%] | 4936/5000 = 98.72% [98.37%–99.00%] | 0/5000 = 0.00% [0.00%–0.08%] |

„Dowolne odrzucenie” w scenariuszu mieszanym nie jest automatycznie mocą: może dotyczyć kohorty zerowej. Błędne wykrycia powyżej są liczone na wszystkie 5000 prób, nie na liczbę odrzuceń; tabela nie raportuje FDR. Korekta na pełnych danych wykryła właściwy sygnał w 4436/5000 prób (88,72%), a holdout n=100 w 3357/5000 (67,14%). Obie metody miały po 4000 obserwacji i 20 kandydatów. Zależnie od pytania oraz możliwości zamrożenia całej rodziny, korekta wielokrotności jest realną alternatywą dla podziału.

## Odtworzenie

Python 3.12.14, wyłącznie biblioteka standardowa; bez sieci, API, instalacji pakietów i opłat. Z katalogu głównego repo:

```bash
python3 research/gpt-20261002/g3/run.py --verify research/gpt-20261002/g3/results
```

Polecenie weryfikuje hashe wejść i wyników, przelicza wszystkie liczniki z zapisanych raw oraz generuje nowy komplet w katalogu tymczasowym, wymagając identycznych bajtów raw i summary. Dla nowego jawnego katalogu wyników:

```bash
python3 research/gpt-20261002/g3/run.py --out /tmp/watchdog-g3-independent-replay
```

Katalog musi być pusty. receipt.json zawiera rzeczywiste czasy i środowisko, dlatego sam receipt nie jest porównywany bajtowo. Dokładność między różnymi implementacjami math/libm lub wersjami kompresora nie jest gwarantowana; zapisane raw pozwalają oddzielić różnice generatora od analizy. replay.txt potwierdza lokalny odbiór.

Pierwszy run trwał 5.08 s; skompresowane raw: 5629833 B; summary: 71888 B. Manifest i hashe są w results/receipt.json. Wszystkie surowe wyniki obejmują także nieodrzucone próby.

## Kontrakt do rozważenia przez Claude’a w E5.7b

1. Oddzielić role danych `exploratory` i `confirmatory`; zapisać hash podziału, źródła oraz identyfikatory obserwacji. Izolacja musi dotyczyć faktycznego dostępu, nie wyłącznie etykiety.
2. Przed udostępnieniem holdoutu związać wybór kohorty, rodzinę kandydatów, kierunek testu, alfa, liczność i strategię wielokrotności z niezmiennym hashem protokołu.
3. Rejestrować każdą próbę i mianowniki, w tym wyniki zerowe i błędy. Kolejny wybór lub kolejne użycie holdoutu tworzy nowy, jawny etap; nie dziedziczy automatycznie statusu potwierdzenia.
4. Dopuszczać jawną korektę wielokrotności jako osobną strategię przy odpowiednich założeniach, wraz z wielkością rodziny i zużyciem danych; nie kodować zawsze-obowiązkowego podziału na podstawie tego pilota.
5. Raportować równolegle liczbę kandydatów, koszt danych, moc wobec prawdy generatora i błędne odrzucenia. Akceptacja adaptera wymaga osobnego testu wycieku danych i decyzji prowadzącego.

## Granice

Badanie obejmuje rozłączne niezależne kohorty, znaną wariancję, jeden z góry zapisany search i jeden holdout. Nie modeluje nakładających się podgrup, adaptacyjnego zatrzymywania, brakujących danych ani wielokrotnego podglądania holdoutu. Generowanie B/C dla wszystkich kohort upraszcza uczciwy pomiar budżetu; możliwe sekwencyjne oszczędności pomiarowe nie są tu badane. Teza o inflacji jest potwierdzona w tym modelu; skala nie przenosi się automatycznie na rzeczywiste wyszukiwanie. Pilot nie stanowi ogólnego silnika replikacji, walidacji JH16 ani wniosków klinicznych. Produkcyjny kod i locked JH16 nie zostały zmienione.
