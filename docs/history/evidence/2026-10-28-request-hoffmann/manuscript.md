# Replikacja: Can Google Searches Predict the Popularity and Harm of Psychoactive Agents?

_Wygenerowano 2026-10-28T14:21:34.127Z z zapisanych wyników WatchDoga (kod 2da5c0bec26499445a6cbda0a5209c37ae276d6c, dane wejściowe ae66170f5e918efd). Liczby pochodzą z wymienionych przebiegów; tekst nie był redagowany przez model językowy._

## Streszczenie

Praca Jankowski, Wojciech, Hoffmann, Marcin (J Med Internet Res 2016, doi:10.2196/jmir.4033) podała korelację wskaźnika szkodliwości z oceną ekspercką 81,6% (n = 16).

_Źródło: konfiguracja 10.2196/jmir.4033_

Przeliczenie danych z publikacji w WatchDogu daje Pearson 0,816 (p 1,15e-4); werdykt: reproduced. To sprawdzenie obliczeń, nie niezależna replikacja.

_Źródło: przebieg b4b6f5cc_

Nowy pomiar (2026-10-26) daje Pearson -0,088 (p 0,7464), Spearman 0,262; werdykt H-harm: deviates; odczyt według reguły ustalonej przed danymi: dane przeczą hipotezie. Ranking popularności względem Tabeli 1: Spearman 0,837, werdykt reproduced.

_Źródło: przebieg c17d1147_

Wykazane przyczyny rozbieżności: Szacunki Google dla zapytań złożonych łamią logikę zbiorów (podzbiór większy od całości; OR większe od sumy części lub mniejsze od jednej z nich); Liczby „zapadnięte” do liczby wyników osiągalnych przez stronicowanie (w części zapytań każdego przebiegu, za każdym razem innych); Ograniczenia metody pierwotnej (korelacja zależna od alkoholu, n = 16).

## Wprowadzenie i hipotezy

Replikowana praca: „Can Google Searches Predict the Popularity and Harm of Psychoactive Agents?”, Jankowski, Wojciech, Hoffmann, Marcin, J Med Internet Res 2016;18(2):e38, doi:10.2196/jmir.4033.

- H-harm (główna): Wskaźnik szkodliwości Hi = Ni_harm / Ni × 100% z liczby wyników Google koreluje dodatnio i istotnie z ekspercką oceną szkodliwości Nutt i in. 2010.
- H-pop (opisowa): Liczba wyników Ni daje ranking popularności Pi = Ni / max(Ni) × 100%; publikacja weryfikuje go jakościowo, WatchDog — stabilnością rankingu względem Tabeli 1.

_Źródło: konfiguracja dossier_

## Metoda pracy oryginalnej

- Google, nazwa substancji w cudzysłowie, SafeSearch wyłączony, 16 substancji z pracy Nutt i in. 2010 (bez nazw wielowyrazowych, tytoniu i grzybów).
- Zapytanie szkodliwości: "nazwa" "harm" OR "harmful".
- Pomiar 2014-06-20; korelacja Hi z oceną Nutta (z przeliczenia Tabel 1 i 3 wynika współczynnik Pearsona).

## Metoda replikacji i odstępstwa

- Zablokowany preset jh2016-faithful: te same 32 zapytania, wzory i odniesienie, wykonywane przez zatwierdzony MethodSpec.
- Nowe liczby: Google przez SerpApi (search_information.total_results), safe=off, hl=en; surowe odpowiedzi archiwizowane z sha256.
- Kryteria oceny i reguła odczytu hipotezy ustalone przed danymi (commit 3d74e15).

_Źródło: docs/replication/JH16_2026-10-25/PROTOCOL.md_

| Element | Oryginał | Replikacja | Powód |
|---|---|---|---|
| Dostęp do Google | przeglądarka | SerpApi (API pośrednika) | jedyny dostępny, powtarzalny dostęp do liczby wyników |
| Region i domena Google | nie podano | domyślne ustawienie dostawcy (google.com, bez gl); w rozszerzeniu gl=us i gl=pl | publikacja tego nie określa |
| Data | 2014-06-20 | data pobrania zapisana w każdym przebiegu | danych z 2014 r. nie da się pobrać ponownie |
| Test istotności | nie podano (p = 0,000143) | t dla współczynnika korelacji, n − 2 stopni swobody | podane p nie wynika ze standardowego testu |

_Źródło: konfiguracja dossier_

- Kryterium harm_index_vs_reference_pearson: pearson, interval [0.7; 1] — ustalone przed danymi (commit 2e417c6).
- Kryterium popularity_ranking_stability: spearman, rank_correlation_floor ≥ 0.6 — ustalone przed danymi (commit 2e417c6).

_Źródło: konfiguracja claims_

## Dane i ich pochodzenie

| Przebieg | Pochodzenie | Wariant/region | Pobranie (UTC) | Kod | Stan |
|---|---|---|---|---|---|
| 52eedd1f | Kalibracja eksploracyjna (Google Trends) | WORLD | 2026-10-28T14:21–14:21 | 2da5c0b | COMPLETED |
| df6be58d | Kalibracja eksploracyjna (Google Trends) | US | 2026-10-28T14:21–14:21 | 2da5c0b | COMPLETED |
| 11f82e98 | Kalibracja eksploracyjna (Google Trends) | PL | 2026-10-28T14:21–14:21 | 2da5c0b | COMPLETED |
| a44e493a | Kalibracja eksploracyjna (Google Trends) | GB | 2026-10-28T14:21–14:21 | 2da5c0b | COMPLETED |
| ea2b7078 | Nowe pobranie (metoda wierna) | — | 2026-10-28T14:20–14:21 | 2da5c0b | niekompletny (1 braków) |
| b4b6f5cc | Przeliczenie danych z publikacji | — | 2026-10-28T14:20–14:20 | 2da5c0b | kompletny |
| c17d1147 | Nowe pobranie (metoda wierna) | — | 2026-10-26T17:23–17:23 | c1de877 | kompletny |
| a26c2c78 | Przeliczenie zapisanych danych (bez pobierania) | PL | 2026-10-25T14:20–14:20 | dbc8a0c | COMPLETED |
| c0157fed | Przeliczenie zapisanych danych (bez pobierania) | GB | 2026-10-25T14:20–14:20 | dbc8a0c | COMPLETED |
| 4cfb78ac | Przeliczenie zapisanych danych (bez pobierania) | US | 2026-10-25T14:20–14:20 | dbc8a0c | COMPLETED |
| 787d429f | Przeliczenie zapisanych danych (bez pobierania) | WORLD | 2026-10-25T14:20–14:20 | dbc8a0c | COMPLETED |
| 19fe2736 | Kalibracja eksploracyjna (Google Trends) | WORLD | 2026-10-25T14:20–14:20 | 7c082f5 | COMPLETED |
| 3f9640d8 | Kalibracja eksploracyjna (Google Trends) | US | 2026-10-25T14:20–14:20 | 7c082f5 | COMPLETED |
| 54735b11 | Kalibracja eksploracyjna (Google Trends) | PL | 2026-10-25T14:20–14:20 | 7c082f5 | COMPLETED |
| 407bcb23 | Kalibracja eksploracyjna (Google Trends) | GB | 2026-10-25T14:20–14:20 | 7c082f5 | COMPLETED |
| 3e247989 | Kalibracja eksploracyjna (Google Trends) | WORLD | 2026-10-25T14:17–14:17 | 58ee80c | FAILED |
| e4b5a5d3 | Kalibracja eksploracyjna (Google Trends) | US | 2026-10-25T14:17–14:17 | 58ee80c | FAILED |
| cda6f194 | Kalibracja eksploracyjna (Google Trends) | PL | 2026-10-25T14:17–14:17 | 58ee80c | FAILED |
| db58f683 | Kalibracja eksploracyjna (Google Trends) | GB | 2026-10-25T14:17–14:17 | 58ee80c | FAILED |
| 051f9b60 | Nowe pobranie — wariant rozszerzenia (nie replikacja) | gl-pl | 2026-10-25T12:39–12:41 | 6402358 | kompletny |
| f4c9d3d5 | Nowe pobranie — wariant rozszerzenia (nie replikacja) | gl-us | 2026-10-25T12:39–12:40 | 6402358 | kompletny |
| 4e8ff376 | Nowe pobranie — wariant rozszerzenia (nie replikacja) | repeat-2 | 2026-10-25T12:39–12:41 | 6402358 | kompletny |
| d935c03b | Nowe pobranie — wariant rozszerzenia (nie replikacja) | repeat-1 | 2026-10-25T12:39–12:40 | 6402358 | kompletny |
| 2e701755 | Nowe pobranie (metoda wierna) | — | 2026-10-25T12:39–12:40 | 6402358 | kompletny |
| 8d97fefd | Nowe pobranie — wariant rozszerzenia (nie replikacja) | gl-pl | 2026-10-25T12:23–12:27 | 55674c3 | niekompletny (8 braków) |
| 4369e19e | Nowe pobranie — wariant rozszerzenia (nie replikacja) | gl-us | 2026-10-25T12:23–12:28 | 55674c3 | niekompletny (12 braków) |
| a6f35b44 | Nowe pobranie — wariant rozszerzenia (nie replikacja) | repeat-2 | 2026-10-25T12:23–12:27 | 55674c3 | niekompletny (8 braków) |
| cf1b454a | Nowe pobranie — wariant rozszerzenia (nie replikacja) | repeat-1 | 2026-10-25T12:23–12:27 | 55674c3 | niekompletny (8 braków) |
| d5b9a571 | Nowe pobranie (metoda wierna) | — | 2026-10-25T12:23–12:29 | 55674c3 | niekompletny (14 braków) |
| a0d88a49 | Przeliczenie danych z publikacji | — | 2026-10-25T12:23–12:23 | 55674c3 | kompletny |
| 9d80efca | Przeliczenie zapisanych danych (bez pobierania) | — | 2026-10-25T11:58–11:58 | 55674c3 | kompletny |
| e2aa7643 | Nowe pobranie (metoda wierna) | — | 2026-10-25T11:58–11:58 | nie zapisano | COMPLETED |
| bd79aa29 | Przeliczenie danych z publikacji | — | 2026-10-25T11:53–11:53 | nie zapisano | COMPLETED |
| acb0c4a0 | Nowe pobranie (metoda wierna) | — | 2026-10-25T11:53–11:53 | nie zapisano | COMPLETED |

_Źródło: przebieg 52eedd1f, przebieg df6be58d, przebieg 11f82e98, przebieg a44e493a, przebieg ea2b7078, przebieg b4b6f5cc, przebieg c17d1147, przebieg a26c2c78, przebieg c0157fed, przebieg 4cfb78ac, przebieg 787d429f, przebieg 19fe2736, przebieg 3f9640d8, przebieg 54735b11, przebieg 407bcb23, przebieg 3e247989, przebieg e4b5a5d3, przebieg cda6f194, przebieg db58f683, przebieg 051f9b60, przebieg f4c9d3d5, przebieg 4e8ff376, przebieg d935c03b, przebieg 2e701755, przebieg 8d97fefd, przebieg 4369e19e, przebieg a6f35b44, przebieg cf1b454a, przebieg d5b9a571, przebieg a0d88a49, przebieg 9d80efca, przebieg e2aa7643, przebieg bd79aa29, przebieg acb0c4a0_

## Wyniki

| Przebieg | Pochodzenie | Pearson Hi | p | Spearman Hi | Spearman Pi vs Tab. 1 | Werdykt H-harm | Werdykt rankingu | Odczyt hipotezy |
|---|---|---|---|---|---|---|---|---|
| b4b6f5cc | Przeliczenie danych z publikacji | 0,816 | 1,15e-4 | 0,560 | 0,999 | reproduced | reproduced | dane wspierają hipotezę |
| c17d1147 | Nowe pobranie (metoda wierna) | -0,088 | 0,7464 | 0,262 | 0,837 | deviates | reproduced | dane przeczą hipotezie |
| 051f9b60 | Nowe pobranie — wariant rozszerzenia (nie replikacja) · gl-pl | -0,101 | 0,7111 | 0,203 | 0,880 | deviates | reproduced | dane przeczą hipotezie |
| f4c9d3d5 | Nowe pobranie — wariant rozszerzenia (nie replikacja) · gl-us | -0,234 | 0,3830 | -0,320 | 0,708 | deviates | reproduced | dane przeczą hipotezie |
| 4e8ff376 | Nowe pobranie — wariant rozszerzenia (nie replikacja) · repeat-2 | -0,101 | 0,7097 | 0,111 | 0,787 | deviates | reproduced | dane przeczą hipotezie |
| d935c03b | Nowe pobranie — wariant rozszerzenia (nie replikacja) · repeat-1 | -0,101 | 0,7111 | 0,113 | 0,834 | deviates | reproduced | dane przeczą hipotezie |
| 9d80efca | Przeliczenie zapisanych danych (bez pobierania) | 0,472 | 0,0650 | 0,236 | 0,584 | deviates | deviates | dane przeczą hipotezie |

_Źródło: przebieg b4b6f5cc, przebieg c17d1147, przebieg 051f9b60, przebieg f4c9d3d5, przebieg 4e8ff376, przebieg d935c03b, przebieg 9d80efca_

| Substancja | Ni (nowy) | Ni 2014 | Hi % (nowy) | Hi % 2014 | Nutt | Flagi |
|---|---|---|---|---|---|---|
| alcohol | 717000000 | 389000000 | 29.85 | 27.5 | 72 |  |
| amphetamine | 5960000 | 9070000 | 97.65 | 5.1 | 23 |  |
| benzodiazepines | 4600000 | 4520000 | 75.22 | 10.3 | 15 |  |
| buprenorphine | 8220000 | 6400000 | 131.39 | 5.8 | 7 | HI_ABOVE_100 |
| butane | 21200000 | 11800000 | 6.51 | 3.3 | 11 |  |
| cannabis | 134000000 | 59100000 | 16.42 | 4.6 | 20 |  |
| cocaine | 47600000 | 58600000 | 179.83 | 25.6 | 27 | HI_ABOVE_100 |
| ecstasy | 55800000 | 42900000 | 16.47 | 1.6 | 9 |  |
| gamma-hydroxybutyric acid | 7920000 | 23500000 | 5.16 | 1.2 | 19 |  |
| heroin | 25600000 | 46800000 | 61.72 | 25 | 55 |  |
| ketamine | 10900000 | 8400000 | 37.34 | 4.9 | 15 |  |
| khat | 13700000 | 10600000 | 3.53 | 6.7 | 9 |  |
| lysergic acid diethylamide | 40600000 | 48600000 | 8.23 | 1.2 | 7 |  |
| mephedrone | 670000 | 2050000 | 680.6 | 4.5 | 13 | HI_ABOVE_100 |
| methadone | 5290000 | 13400000 | 57.47 | 4.1 | 14 |  |
| methamphetamine | 10300000 | 8780000 | 101.94 | 5.8 | 33 | HI_ABOVE_100 |

_Źródło: przebieg c17d1147, fixtures/jh2016/paper_reported.json_

## Porównanie z pracą oryginalną

Publikacja: 81,6%, p = 0,000143. Przeliczenie: Pearson 0,816, p 1,15e-4. Nowe dane: Pearson -0,088. Warianty rozszerzenia: gl-pl -0,101, gl-us -0,234, repeat-2 -0,101, repeat-1 -0,101.

_Źródło: przebieg b4b6f5cc, przebieg c17d1147, przebieg 051f9b60, przebieg f4c9d3d5, przebieg 4e8ff376, przebieg d935c03b_

## Kalibracja eksploracyjna (Google Trends)

Google Trends to względne zainteresowanie wyszukiwaniem, nie liczba wyników; porównywane są tylko rangi, bez werdyktów. Próbka Trends zmienia się między pobraniami.

| Region (przebieg) | A1 | A2 | A3 | A3b | A4 |
|---|---|---|---|---|---|
| WORLD (52eedd1f) | 0,917 | 0,015 | 0,126 | 1,000 | 0,257 |
| US (df6be58d) | 0,825 | -0,229 | 0,144 | 0,771 | 0,143 |
| PL (11f82e98) | 0,861 | 0,284 | -0,121 | 1,000 | 0,800 |
| GB (a44e493a) | 0,749 | -0,109 | 0,076 | 0,771 | 0,257 |
| PL (a26c2c78) | 0,818 | 0,443 | 0,750 | 0,747 | 0,345 |
| GB (c0157fed) | 0,744 | -0,138 | 0,624 | 0,698 | 0,212 |
| US (4cfb78ac) | 0,859 | 0,059 | 0,532 | 0,599 | 0,501 |
| WORLD (787d429f) | 0,893 | -0,091 | 0,594 | 0,742 | 0,549 |

_Źródło: przebieg 52eedd1f, przebieg df6be58d, przebieg 11f82e98, przebieg a44e493a, przebieg a26c2c78, przebieg c0157fed, przebieg 4cfb78ac, przebieg 787d429f_

## Protokół potwierdzający i rodzina porównań

Protokół „JH16 — potwierdzenie” zamrożony 2026-10-26 17:23 UTC (sha256 d8f5f1dbb8ef1edb): punkty główne harm_index_vs_reference_pearson; rodzina porównań harm_index_vs_reference_pearson, popularity_ranking_stability; korekta holm, alfa 0,01. Uzasadnienie: Rodzina: H-harm (główne) i H-pop; Holm, alfa 0,01 jak w publikacji. Zamrożone przed nowym pomiarem 2026-10-26.

_Źródło: konfiguracja protocol f4eabbbf-9ede-4f6e-8487-e1aab1f29e2d_

| Przebieg | Rodzina, priorytet | Porównanie | Główne | Werdykt | p | p skorygowane | < alfa |
|---|---|---|---|---|---|---|---|
| c17d1147 | F1 | Pearson Hi vs Nutt 2010 | tak | deviates | 0,7464 | 0,7464 | nie |
| c17d1147 | F1 | Spearman Pi vs Tabela 1 | nie | reproduced | 5,19e-5 | 1,04e-4 | tak |

_Źródło: przebieg c17d1147_

## Rozbieżności i ich przyczyny

| Możliwa przyczyna | Test | Status | Dowód |
|---|---|---|---|
| Błąd obliczeń lub implementacji | przeliczenie danych z publikacji; niezależny skrypt dla każdego przebiegu | wykluczona | scripts/verify_jh16_run.py |
| Szacunki Google dla zapytań złożonych łamią logikę zbiorów (podzbiór większy od całości; OR większe od sumy części lub mniejsze od jednej z nich) | rozbicie zapytania OR na składniki dla 8 substancji | wykazana | docs/history/evidence/2026-10-25-jh16/T3_or_decomposition_results.json |
| Liczby „zapadnięte” do liczby wyników osiągalnych przez stronicowanie (w części zapytań każdego przebiegu, za każdym razem innych) | powtórzenia i głębokość stronicowania; flaga PROVIDER_COUNT_EQUALS_REACHABLE_RESULTS | wykazana | docs/history/evidence/2026-10-25-jh16/cross_runs.txt |
| Region Google | warianty gl=us i gl=pl | wykluczona | warianty w tabeli przebiegów |
| Losowa zmienność szacunku | powtórzenia w tych samych warunkach | wykluczona | docs/history/evidence/2026-10-25-jh16/cross_runs.txt |
| Zmiana sposobu szacowania przez Google od 2014 r. | brak dostępu do dawnego narzędzia; dane 2014 są wewnętrznie spójne | prawdopodobna | — |
| Zmiana badanego zjawiska (treści w sieci) | nie do oddzielenia przy niespójnym narzędziu | nierozstrzygnięta | — |
| Ograniczenia metody pierwotnej (korelacja zależna od alkoholu, n = 16) | analiza bez alkoholu na danych publikacji; ten sam wskaźnik w Europe PMC | wykazana | docs/replication/JH16_2026-10-25/CALIBRATION.md |
| Rodzaj testu istotności w publikacji | przeliczenie p | nierozstrzygnięta | — |

_Źródło: konfiguracja dossier_

## Ograniczenia

- Pomiar z jednego dnia; stabilność szacunków Google w czasie nie jest znana.
- Reguła flagi „osiągalne wyniki” jest heurystyczna.
- Google Trends to względne zainteresowanie wyszukiwaniem, nie liczba wyników; kalibracja porównuje wyłącznie rangi.
- Dawne narzędzie Google z 2014 r. jest niedostępne; danych autorów nie zachowano.

## Wnioski

- Implementacja metody odtwarza wyniki publikacji na jej własnych danych.
- Na nowych danych dane przeczą hipotezie (reguła ustalona przed danymi).
- Wykazano przyczyny rozbieżności (sekcja „Rozbieżności i ich przyczyny”); odczyt hipotezy trzeba interpretować razem z nimi.
- Ocena (analiza z 2026-10-25): Wykazane przyczyny dotyczą narzędzia pomiaru (szacunki Google dla zapytań złożonych) i ograniczeń metody pierwotnej; jakość nowych danych nie pozwala traktować odczytu „przeczą” jako rozstrzygnięcia hipotezy merytorycznej.
- Ocena (analiza z 2026-10-25): Ranking popularności z publikacji jest zgodny z niezależnymi danymi Google Trends z tego samego okresu; zmiany w czasie z Tabeli 2 nie są potwierdzone.
- Wynik negatywny jest wynikiem: praca dokumentuje go w całości, z danymi i ich pochodzeniem.

_Źródło: przebieg b4b6f5cc, przebieg c17d1147, docs/replication/JH16_2026-10-25/REPORT.md, docs/replication/JH16_2026-10-25/CALIBRATION.md_

## Aneks: odtwarzalność

| Przebieg | Kod | Hash konfiguracji | Manifest sha256 | Pobrania |
|---|---|---|---|---|
| 52eedd1f-0693-42b7-8c09-3dd804bed208 | 2da5c0bec26499445a6cbda0a5209c37ae276d6c | 678b290fac6267a0604f6e5aef5c9bb66341f46f9e106c4e77df63bf88172dbf | 029d706b064dfa4f0384af09dd40c7b0b65bc846b52a5d66743d6005665bc220 | 4 |
| df6be58d-7d45-4dad-ae6a-400b620264ed | 2da5c0bec26499445a6cbda0a5209c37ae276d6c | f9581cb13c6d6d31538ef76afccaf059ebabed55f34bdab7a42cc3716e3441d8 | 799a207ba67e872dd58cfd3ea829fe48577001deb78ae582115f3a086eb30760 | 4 |
| 11f82e98-44cb-4b6e-965f-3bf5a6761000 | 2da5c0bec26499445a6cbda0a5209c37ae276d6c | 638d61a125a690e4b0f3b4c2480b694552f30898f8a964de6037fded6bd8e757 | 972dd5239654de63479e3b9fa9e51716106d4fcdb1f811e53268d4a502b865ea | 4 |
| a44e493a-791c-499b-8f3c-2c2e93cdbf9e | 2da5c0bec26499445a6cbda0a5209c37ae276d6c | e3a82c75fb499d89746494ff63cefd8fb272b6e2a757f34848b86b2871629e1a | 0d16763ad1921e51b5756185361d20f645e8c0f0101d7d3518c2caf3609edb3e | 4 |
| ea2b7078-a708-4205-ab29-b784486a26c1 | 2da5c0bec26499445a6cbda0a5209c37ae276d6c | 18bd87f683a23833e3270f4294c1d1be985cdc7b077d2aab05b96199e88ba109 | a9f1712880a3999837b338a127f19c8d6f7757ef2c514acb48fac71e97591200 | 32 |
| b4b6f5cc-30b4-47a9-b798-a1f7e6454879 | 2da5c0bec26499445a6cbda0a5209c37ae276d6c | 3d16788ec133993f5f2f0bd4b346f7782f8145fd55a27ea8fb7ba0ad7925317f | 1f2c8885b6a8d56cba17273e0c1320038ac009c0fecea400812e6dcde1a27e9a | 32 |
| c17d1147-c4c9-44f5-8c78-e966593ea97a | c1de877905ed699701830c1308cd1cb5ff2f9613 | 0e6b3f24996772479708846baa41e37c830859202be19cd281bd8d989dcb5a95 | 01da42cfbe63ddb369d72ea4623399be7648d15f7712d0092b59230d36514ee2 | 32 |
| a26c2c78-1c5c-4d3e-a7ff-241de5755c27 | dbc8a0c63b69497365aa2a8e536a60e818353e45 | 5598584920fb0e2471623302d940fb8fe606b100233f8e2dcb4adef0db7cc562 | f2f2ff8b6b5a093e2bdb6b71a07d62c1b97072e45850170b10508cc73942cc81 | 4 |
| c0157fed-09c5-4402-a932-cd08dafc1ad0 | dbc8a0c63b69497365aa2a8e536a60e818353e45 | 97dbd8663acf389aabdae95af479926a61fa0e92e25d8df0875c00a646ba8eb3 | f95ab659bf5e75dd1c4c5abc86072b379f1ac0cc5628d083a69c85679f826fa4 | 4 |
| 4cfb78ac-a024-4781-b9bb-e1262a713305 | dbc8a0c63b69497365aa2a8e536a60e818353e45 | a1d2b84e3cb79a37ebe60b57fe1f5053a4f394f138a5f51b17b101fd311078c2 | 4a49ea4d4a75d5986d68a7899948c085c5253a42d09005ee1ee678dc74d97c0c | 4 |
| 787d429f-f5c5-4118-9348-a4b38d750e7a | dbc8a0c63b69497365aa2a8e536a60e818353e45 | 434e6bb10a65352d0f30afb3dbc59040055bee6b26f56c86ae20018452768265 | b5f4c2b9bb7eefef2f2405c342ff890e872932646cca02cf264da296fa2fc31c | 4 |
| 19fe2736-c765-4a41-98c1-c5f303e041cf | 7c082f5146c0aacf2e9ba9e13c14f1dbd6112854 | 9448768959386783cdda90ca4c81bf6a828a0878ec6c2abc2d031b14ed5c4c15 | d808e4e1118f233eb2834eb4568ab6a51c697d3ac74b794faad71afcb0c06a05 | 4 |
| 3f9640d8-77fc-4804-83dd-d3e1bc854138 | 7c082f5146c0aacf2e9ba9e13c14f1dbd6112854 | 4436e2c84cf0a7bb0d0db096cdea2c3ada0d4635e918ba0cb4c20dabd19d6c93 | 48c8d74294766f774293ae584ceaeb890174b7c90fe5d8c66af009e556c38e72 | 4 |
| 54735b11-30d2-4f8c-82e0-bf6d83df60f4 | 7c082f5146c0aacf2e9ba9e13c14f1dbd6112854 | 39e098bc08ab8d7e45e46b14f972f63d13908f016409a8218a69c58cc0f2a9e5 | 17c1ca5f173b58f02aea3be27bd884d4cb80dfd725b62de2cca37c013be54aca | 4 |
| 407bcb23-f7ae-4f89-90ee-f376552f3926 | 7c082f5146c0aacf2e9ba9e13c14f1dbd6112854 | 1f1965a6c96b157222690fdc9783b6e2cd077e88b0bab9c7a935ca6054c7e00b | 049bd4113ec5a727572ee652f00684dcc73053324bc6e4ad6b15771dedf41197 | 4 |
| 3e247989-e052-4f4d-b1da-290afdd8896e | 58ee80c9ef46bbac0de0a504fdd69dfceb0f23a6 | 71d471f34768ee92ce399a5012ed022351dddbf543ff856082ab529535c623f3 | — | 4 |
| e4b5a5d3-feee-4002-b991-f031aa34b674 | 58ee80c9ef46bbac0de0a504fdd69dfceb0f23a6 | 02656a82d27d6d579b614e50c167f3479efbffb59ce8834ab785f2e758828917 | — | 4 |
| cda6f194-9710-4609-91d6-10781d601bc7 | 58ee80c9ef46bbac0de0a504fdd69dfceb0f23a6 | 2e40709ae4fd347504f0263ae1b7b1df92dbab484268580f026e848ffbae0bf3 | — | 4 |
| db58f683-660c-40cf-a37b-475be954bd75 | 58ee80c9ef46bbac0de0a504fdd69dfceb0f23a6 | 4fcc3735e23683d37005f1cebd80bad080e354e7c5a041b6785cc7083b233ef1 | — | 4 |
| 051f9b60-31a4-483b-ab01-9c9c717417aa | 64023580775afe0a0b5e68afa499bfb8f504ffa2 | 897904dc7c9b6d8a9fc2ac9645e1ede9f64a5517bffdec5584e75c91f48aaf65 | b64d80110939e9611ed13584aba69b92facd7678edb16cbdafb4d573ec34e16f | 32 |
| f4c9d3d5-3217-4b80-a3ca-eca6de63c3cb | 64023580775afe0a0b5e68afa499bfb8f504ffa2 | 2084ef7ebb88847006f3cbc05715d1255fd793419cf26683080bd81a8e7acb88 | a0eef171d64847870e9758b6a91dcf16961597c4ee82739a4a8eeef4245fa5a3 | 32 |
| 4e8ff376-52e1-4097-870c-5aac4dbb2cf5 | 64023580775afe0a0b5e68afa499bfb8f504ffa2 | 2365253fc457aec0c6b1ff9cf887e6d5a5ff672226f2856e5b1cd6eecbf9aaf7 | 8ce11271a62c2300622a26db79383ab239df9b0411c1c2de65e3aae56e1b5e8a | 32 |
| d935c03b-0b1c-4971-b6f2-d9b0ba15333d | 64023580775afe0a0b5e68afa499bfb8f504ffa2 | 5ca00b53bd697b218e81403301690d67122cc2d2b936b26dd2ff9aa1c6203da1 | 3af6788196e1c7f525c51821d487ac9721b0bf60760ec73d57a8bdbc5dba8a81 | 32 |
| 2e701755-e83a-42dd-a39d-b3d247d9eed2 | 64023580775afe0a0b5e68afa499bfb8f504ffa2 | f12cf6c0997fe4b39a0c311a796444f386fe420ebc469479cac51f619ccf529d | 6c678147c198c1c37dc4c471d6186588689b68a54e37ca061392fbade8c611f5 | 32 |
| 8d97fefd-a9de-434e-8505-ab43e225da3e | 55674c3a3633c0da759f035978214e2edb4576ec | 690e212ec6512e7523576ae70f3d753db8646dd8d83426a121f25e0f0660a808 | 5f49a184eee6af24e58c4f43fa42c98b5f44196df7afee29c55112bee70d0a3a | 32 |
| 4369e19e-af9b-44de-94fc-cf86fd902661 | 55674c3a3633c0da759f035978214e2edb4576ec | 18c5435a391beb8ffaa270506f396f712363454c7b66cb84940102268ae7a003 | 0f60c7565c9303af63afe864b5dca59c9efad491300d1091e9040e6e3615e5c1 | 32 |
| a6f35b44-fbbe-4ab2-8020-4a40abc50b2d | 55674c3a3633c0da759f035978214e2edb4576ec | cff916c96dec77257e527aee497f9aeadd2b5e0f0a6ff62f0da73312cfb28224 | 9af65a4d89ee465392706797e4553fdd4011be787d0f4a86bbe683733d413af2 | 32 |
| cf1b454a-efa2-418c-a37f-a67f51bbba2d | 55674c3a3633c0da759f035978214e2edb4576ec | fcf84c1e46fcbb2695d4c08eb9cf3daf42e8187bf443fc2e738037dabc782c1a | 464468a992bd3b6229a0ba2561034aba874739eb306e9fe4a927897a797fa6e0 | 32 |
| d5b9a571-f429-4e7b-a461-3410f468afef | 55674c3a3633c0da759f035978214e2edb4576ec | 12f9b63b691e6e8a859eeeb4a8e815ced47f4e01b07e17e74d43a23860d41fde | 64a168594bcce15e5d63e2d661671a7c13362a47ffa89738fc8280d4d655fd16 | 32 |
| a0d88a49-f110-492f-b29b-95b71ac844b6 | 55674c3a3633c0da759f035978214e2edb4576ec | dc93f506511795dab0316f3888d89a5f6b9645a3ed8b8d2e65bbc831fe846501 | 40002a09b744a3507501821f95c5faf6feaffb97b20424b529ed094964cbb5f3 | 32 |
| 9d80efca-d819-49fb-9b0c-fec57c0e8d74 | 55674c3a3633c0da759f035978214e2edb4576ec | 05a083f6f60cdeb6a2c0718c7588c42af80c3a745771555a228886e65e01ed7a | 3d6e620ef4a11d053ceb24846bff61beecb904f05f15a3ba3d7a628d7add3fb4 | 32 |
| e2aa7643-fa2d-4c6b-b75f-1085f9082c6f | nie zapisano | f27714d8ba42d9ba513102839b9337d133b0f225fde676ce9c8d06ffc83232dd | 3f8581e43501253c923e6b482ad855923a67994016fb74abb7b8f756cacb62de | 32 |
| bd79aa29-1209-4d00-9c99-bc99fd5e5f50 | nie zapisano | 0e9c151d95ab5f0382f70bb9be9cd19daedcfce97cb0a85862dbd71fdf08d960 | 033ebf25f9ed6080d62d72ae8d73885b21b7ccb0bf542fca630433681e50eb4e | 32 |
| acb0c4a0-3b92-4bbe-8ff6-f9f96aec14a0 | nie zapisano | 1c7b6016d14aa1ee7340e889e65cb4716acf7c0ff1f2dc4e7c7fe96e084731ca | e5c122858961705d23ff9dfb54935a5e31cb4f01d74f204344aac03471a2666f | 6 |

_Źródło: przebieg 52eedd1f, przebieg df6be58d, przebieg 11f82e98, przebieg a44e493a, przebieg ea2b7078, przebieg b4b6f5cc, przebieg c17d1147, przebieg a26c2c78, przebieg c0157fed, przebieg 4cfb78ac, przebieg 787d429f, przebieg 19fe2736, przebieg 3f9640d8, przebieg 54735b11, przebieg 407bcb23, przebieg 3e247989, przebieg e4b5a5d3, przebieg cda6f194, przebieg db58f683, przebieg 051f9b60, przebieg f4c9d3d5, przebieg 4e8ff376, przebieg d935c03b, przebieg 2e701755, przebieg 8d97fefd, przebieg 4369e19e, przebieg a6f35b44, przebieg cf1b454a, przebieg d5b9a571, przebieg a0d88a49, przebieg 9d80efca, przebieg e2aa7643, przebieg bd79aa29, przebieg acb0c4a0_

- Kryteria: 210e12ba1087e19a805960de4653d4cb9fe6fda7bb1c9c89e00b5c3a33a7e778
- Interpretacja: ff543fed8a1024521847cfddff2756de60d17119ea9cbcc4601c20e123ed68c1
- Dossier: 14b97c49edeff0d8481ca36ef750a5ea9c51c2a4c39cd18e7096ea61befdc477
- Prerejestracja: docs/replication/JH16_2026-10-25/PROTOCOL.md (commit 3d74e15)
- Wersja kodu generującego: 2da5c0bec26499445a6cbda0a5209c37ae276d6c
