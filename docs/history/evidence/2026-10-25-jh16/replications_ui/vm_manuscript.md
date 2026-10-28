# Replikacja: Can Google Searches Predict the Popularity and Harm of Psychoactive Agents?

_Wygenerowano 2026-10-25T16:24:50.939Z z zapisanych wyników WatchDoga (kod 84a9e717fc002b3b8c8394f4a377dae719c00daa, dane wejściowe 766d319c55e38489). Liczby pochodzą z wymienionych przebiegów; tekst nie był redagowany przez model językowy._

## Streszczenie

Praca Jankowski, Wojciech, Hoffmann, Marcin (J Med Internet Res 2016, doi:10.2196/jmir.4033) podała korelację wskaźnika szkodliwości z oceną ekspercką 81,6% (n = 16).

_Źródło: konfiguracja 10.2196/jmir.4033_

Przeliczenie danych z publikacji w WatchDogu daje Pearson 0,816 (p 1,15e-4); werdykt: reproduced. To sprawdzenie obliczeń, nie niezależna replikacja.

_Źródło: przebieg 0e5ed635_

Nowy pomiar (2026-10-25) daje Pearson -0,234 (p 0,3835), Spearman -0,158; werdykt H-harm: deviates; odczyt według reguły ustalonej przed danymi: dane przeczą hipotezie. Ranking popularności względem Tabeli 1: Spearman 0,708, werdykt reproduced.

_Źródło: przebieg b14ccbaa_

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

- Kryterium harm_index_vs_reference_pearson: pearson, interval [0.7; 1] — ustalone przed danymi (commit 2e417c6).
- Kryterium popularity_ranking_stability: spearman, rank_correlation_floor ≥ 0.6 — ustalone przed danymi (commit 2e417c6).

_Źródło: konfiguracja claims_

## Dane i ich pochodzenie

| Przebieg | Pochodzenie | Wariant/region | Pobranie (UTC) | Kod | Stan |
|---|---|---|---|---|---|
| 32c2c4be | Kalibracja eksploracyjna (Google Trends) | US | 2026-10-25T16:24–16:24 | 84a9e71 | COMPLETED |
| 08701e76 | Kalibracja eksploracyjna (Google Trends) | PL | 2026-10-25T16:24–16:24 | 84a9e71 | COMPLETED |
| 8e45b9f9 | Kalibracja eksploracyjna (Google Trends) | GB | 2026-10-25T16:24–16:24 | 84a9e71 | COMPLETED |
| af61af36 | Kalibracja eksploracyjna (Google Trends) | WORLD | 2026-10-25T14:32–14:32 | 10744c9 | COMPLETED |
| b14ccbaa | Nowe pobranie (metoda wierna) | — | 2026-10-25T12:53–12:54 | e33504e | kompletny |
| 0e5ed635 | Przeliczenie danych z publikacji | — | 2026-10-25T12:53–12:53 | e33504e | kompletny |
| 5aedcdea | Nowe pobranie (metoda wierna) | — | — | nie zapisano | FAILED |

_Źródło: przebieg 32c2c4be, przebieg 08701e76, przebieg 8e45b9f9, przebieg af61af36, przebieg b14ccbaa, przebieg 0e5ed635, przebieg 5aedcdea_

## Wyniki

| Przebieg | Pochodzenie | Pearson Hi | p | Spearman Hi | Spearman Pi vs Tab. 1 | Werdykt H-harm | Werdykt rankingu | Odczyt hipotezy |
|---|---|---|---|---|---|---|---|---|
| b14ccbaa | Nowe pobranie (metoda wierna) | -0,234 | 0,3835 | -0,158 | 0,708 | deviates | reproduced | dane przeczą hipotezie |
| 0e5ed635 | Przeliczenie danych z publikacji | 0,816 | 1,15e-4 | 0,560 | 0,999 | reproduced | reproduced | dane wspierają hipotezę |

_Źródło: przebieg b14ccbaa, przebieg 0e5ed635_

| Substancja | Ni (nowy) | Ni 2014 | Hi % (nowy) | Hi % 2014 | Nutt | Flagi |
|---|---|---|---|---|---|---|
| alcohol | 705000000 | 389000000 | 30.07 | 27.5 | 72 |  |
| amphetamine | 6020000 | 9070000 | 98.01 | 5.1 | 23 |  |
| benzodiazepines | 4640000 | 4520000 | 73.92 | 10.3 | 15 |  |
| buprenorphine | 8440000 | 6400000 | 76.07 | 5.8 | 7 |  |
| butane | 20500000 | 11800000 | 6.78 | 3.3 | 11 |  |
| cannabis | 135000000 | 59100000 | 16.07 | 4.6 | 20 |  |
| cocaine | 47900000 | 58600000 | 41.13 | 25.6 | 27 |  |
| ecstasy | 65 | 42900000 | 7200000 | 1.6 | 9 | HI_ABOVE_100, PROVIDER_COUNT_EQUALS_REACHABLE_RESULTS |
| gamma-hydroxybutyric acid | 8140000 | 23500000 | 5.01 | 1.2 | 19 |  |
| heroin | 25700000 | 46800000 | 61.87 | 25 | 55 |  |
| ketamine | 11300000 | 8400000 | 38.23 | 4.9 | 15 |  |
| khat | 13000000 | 10600000 | 0 | 6.7 | 9 | PROVIDER_COUNT_EQUALS_REACHABLE_RESULTS |
| lysergic acid diethylamide | 41200000 | 48600000 | 98.06 | 1.2 | 7 |  |
| mephedrone | 65 | 2050000 | 7107692.31 | 4.5 | 13 | HI_ABOVE_100, PROVIDER_COUNT_EQUALS_REACHABLE_RESULTS |
| methadone | 5340000 | 13400000 | 58.24 | 4.1 | 14 |  |
| methamphetamine | 10400000 | 8780000 | 101.92 | 5.8 | 33 | HI_ABOVE_100 |

_Źródło: przebieg b14ccbaa, fixtures/jh2016/paper_reported.json_

## Porównanie z pracą oryginalną

Publikacja: 81,6%, p = 0,000143. Przeliczenie: Pearson 0,816, p 1,15e-4. Nowe dane: Pearson -0,234.

_Źródło: przebieg 0e5ed635, przebieg b14ccbaa_

## Kalibracja eksploracyjna (Google Trends)

Google Trends to względne zainteresowanie wyszukiwaniem, nie liczba wyników; porównywane są tylko rangi, bez werdyktów. Próbka Trends zmienia się między pobraniami.

| Region (przebieg) | A1 | A2 | A3 | A3b | A4 |
|---|---|---|---|---|---|
| US (32c2c4be) | 0,840 | 0,059 | 0,764 | 0,808 | 0,698 |
| PL (08701e76) | 0,818 | 0,500 | 0,692 | 0,775 | 0,167 |
| GB (8e45b9f9) | 0,754 | -0,195 | 0,731 | 0,835 | 0,055 |
| WORLD (af61af36) | 0,923 | 0,067 | 0,779 | 0,792 | 0,621 |

_Źródło: przebieg 32c2c4be, przebieg 08701e76, przebieg 8e45b9f9, przebieg af61af36_

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

_Źródło: przebieg 0e5ed635, przebieg b14ccbaa, docs/replication/JH16_2026-10-25/REPORT.md, docs/replication/JH16_2026-10-25/CALIBRATION.md_

## Aneks: odtwarzalność

| Przebieg | Kod | Hash konfiguracji | Manifest sha256 | Pobrania |
|---|---|---|---|---|
| 32c2c4be-37a7-4f09-bbda-2ab38095300f | 84a9e717fc002b3b8c8394f4a377dae719c00daa | 1bfeb6081f15aee663c7aa751e41a76e16124dbc1ae8b02e3f9933748d47af7d | 1cb5af34bed9da0ce2370388b6c8389dc8abfd6b653599710309f227901a9e19 | 4 |
| 08701e76-377b-464d-8a83-06c2124b07ad | 84a9e717fc002b3b8c8394f4a377dae719c00daa | eca9bd2000cb91a38d408baa127e146e20a3e594d34a79ac47c0ed7b5c8a4ca3 | d60650b7ddc39fba0f87eb5efb54ded3acd321f3afafea696e1f6266650058c1 | 4 |
| 8e45b9f9-c289-40c6-9f77-336733c907ee | 84a9e717fc002b3b8c8394f4a377dae719c00daa | 9ffc9345696f23586127d385094f2c8a96f4fe6f65c81143def7dd03feb1285a | e1191043a827b1678739dbc05b8ef52a330e019681357295a9dd0747a1ae766f | 4 |
| af61af36-362e-4c19-abb6-bcd5075d3a25 | 10744c9d29546e083d699998050609bab2ceaba9 | ceecb2cb00b9b534b2b0da9bfe34dd19417e2c1ef925c277bd79b37defeb9bbc | ccd8ba0761acd1fb70f94fae67cdc3bce855d5742b992a8f054ae45457912b80 | 4 |
| b14ccbaa-6ebb-49e7-a1bc-297ffbbf1269 | e33504edfdb71050d9cc6c3da2435562ffee0494 | f8fbea916aa4f105860c1010aea8797c4e767d4d7645daf7420979cc5205142e | d8f2236b46012c74d036d1516e28dea42f970ba9115c6ca3353dfe7241db9e86 | 32 |
| 0e5ed635-f9d9-4d8c-8e37-16bcdb545635 | e33504edfdb71050d9cc6c3da2435562ffee0494 | dc93f506511795dab0316f3888d89a5f6b9645a3ed8b8d2e65bbc831fe846501 | eb9e4dba3fc281c546fb534a97a7fae225aecb796ab7688ae22a9e8781acfbbe | 32 |
| 5aedcdea-d40e-42dd-a712-b876c46e8278 | nie zapisano | 717d57ff0a6fd4d78ff5cd76a0090a1cdb766d2a5a8fa96591a934e440fe2869 | — | 0 |

_Źródło: przebieg 32c2c4be, przebieg 08701e76, przebieg 8e45b9f9, przebieg af61af36, przebieg b14ccbaa, przebieg 0e5ed635, przebieg 5aedcdea_

- Kryteria: 210e12ba1087e19a805960de4653d4cb9fe6fda7bb1c9c89e00b5c3a33a7e778
- Interpretacja: ff543fed8a1024521847cfddff2756de60d17119ea9cbcc4601c20e123ed68c1
- Dossier: d83bc8265208cec0cdbe61cae83c8420321a35dd3ae6ee3b2aabfc9481d56111
- Prerejestracja: docs/replication/JH16_2026-10-25/PROTOCOL.md (commit 3d74e15)
- Wersja kodu generującego: 84a9e717fc002b3b8c8394f4a377dae719c00daa
