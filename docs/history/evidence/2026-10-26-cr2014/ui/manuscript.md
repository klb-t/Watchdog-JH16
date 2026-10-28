# Replikacja: Monitoring of non-cigarette tobacco use using Google Trends

_Wygenerowano 2026-10-26T19:31:37.667Z z zapisanych wyników WatchDoga (kod 7cec4482466c994af261527f52275e1e21743664-dirty, dane wejściowe 4779d5e81cc05739). Liczby pochodzą z wymienionych przebiegów; tekst nie był redagowany przez model językowy._

## Streszczenie

RSV „cigar” (2011) vs odsetek uczniów palących cygara (YRBS 2011): praca podała r = 0,390 (n = 36, p = 0,0180). Nowy pomiar (2026-10-26) daje pearson 0,358 (p 0,0321, n = 36); werdykt względem pasma ustalonego przed danymi: reproduced; odczyt hipotezy: dane wspierają hipotezę.

_Źródło: przebieg fcf2ed4a, fixtures/cr2014/paper_reported.json_

Nie powtórzono 3 z wyników pracy z powodu braku otwartych danych referencyjnych (sekcja „Czego nie powtórzono”).

_Źródło: konfiguracja dossier_

## Wprowadzenie i hipotezy

Replikowana praca: „Monitoring of non-cigarette tobacco use using Google Trends”, Cavazos-Rehg, Patricia A, Krauss, Melissa J, Spitznagel, Edward L, Lowery, Ashley, Grucza, Richard A, Chaloupka, Frank J, Bierut, Laura Jean, Tobacco Control 2014;23(5):445-447, doi:10.1136/tobaccocontrol-2013-051276.

- H-cigar-youth (główna): Stany z większym względnym zainteresowaniem wyszukiwaniem cygar w Google (2011) mają wyższy odsetek uczniów szkół średnich palących cygara (YRBS 2011).

_Źródło: konfiguracja dossier_

## Metoda pracy oryginalnej

- Google Trends, USA, rok 2011, względne zainteresowanie według stanów dla 15 terminów dotyczących cygar (lista z pracy).
- Odniesienie: odsetek uczniów klas 9–12 palących cygara w ostatnich 30 dniach, YRBS 2011, 36 stanów z danymi ważonymi.
- Współczynnik Pearsona (SAS 9.3); p < 0,05 uznane za istotne. Dodatkowo: wrażliwość bez stanów wpływowych (UT, RI) i wersja ważona populacją.

## Metoda replikacji i odstępstwa

- Zablokowany preset cr2014-faithful: ta sama lista terminów połączona operatorem + w jednym zapytaniu Trends (interest by region), geo=US, region=REGION, 2011-01-01…2011-12-31, low-volume włączone.
- Google Trends przez SerpApi (GEO_MAP_0); surowa odpowiedź archiwizowana z sha256 przed obliczeniami.
- Odniesienie: otwarty zbiór CDC YRBSS (data.cdc.gov svam-8dhg), pytanie H38, ogółem; plik surowy przypięty sha256, przekształcenie deterministyczne (scripts/reference_from_yrbss.py).
- Pearson i p (t z n − 2 stopniami swobody) liczone deterministycznie; pasmo i reguła odczytu ustalone przed danymi.

_Źródło: docs/replication/CR2014_2026-10-26/PROTOCOL.md_

| Element | Oryginał | Replikacja | Powód |
|---|---|---|---|
| Dostęp do Google Trends | przeglądarka (2012–2013) | SerpApi, data pobrania zapisana w przebiegu | jedyny powtarzalny dostęp; Trends dziś ponownie próbkuje dane z 2011 r. |
| Lista terminów | 15 terminów (lista z pracy) | 8 terminów obejmujących te same wyszukiwania (każdy termin z pracy zawiera wszystkie słowa któregoś z nich), połączone „+” | dostawca odrzuca zapytania Trends dłuższe niż 100 znaków; zmiana w wersji v2 presetu przed jakąkolwiek wartością dla cygar |
| Łączenie terminów | „dane dla dowolnego z terminów” | operator + bez odstępów w jednym zapytaniu | udokumentowany sposób Trends na sumę terminów; zapis bez odstępów sprawdzony na neutralnej parze (identyczne wartości dla 51 regionów) |
| Stany o małym wolumenie | wartość 0 | include_low_search_volume=true | aby stany o małym wolumenie miały wartość, a nie znikały |
| Wersja ważona populacją | r ważone = 0,47 | nie powtarzana | wymaga szacunków populacji ze spisu; poza zakresem tej próby |

- Kryterium cigar_youth_pearson: pearson, interval [0.07; 0.64] — ustalone przed danymi (commit aa7e2ea).

_Źródło: konfiguracja claims_

## Czego nie powtórzono

| Wynik pracy | Powód |
|---|---|
| Pearson RSV cygara vs dorośli (NSDUH 2010–2011), r = 0,49 | dane stanowe NSDUH pochodzą z R-DAS o ograniczonym dostępie; brak otwartej tabeli |
| Pearson RSV tytoń bezdymny vs dorośli (NSDUH), r = 0,48 | jak wyżej |
| Pearson RSV tytoń bezdymny vs młodzież (YRBS 2011), r = 0,46 | otwarty zbiór YRBSS ma to pytanie dopiero od 2017 r.; nie znaleziono otwartej tabeli stanowej za 2011 r. |

_Źródło: konfiguracja dossier_

## Dane i ich pochodzenie

| Przebieg | Pochodzenie | Pobranie (UTC) | Kod | Stan |
|---|---|---|---|---|
| fcf2ed4a | Nowe pobranie (metoda wierna) | 2026-10-26T19:28–19:28 | 7cec448 | kompletny |
| 7aa42db5 | Nowe pobranie (metoda wierna) | 2026-10-26T19:24–19:24 | cb8c9fd | niekompletny (braki: 36) |

_Źródło: przebieg fcf2ed4a, przebieg 7aa42db5_

## Wyniki

| Przebieg | Pochodzenie | Porównanie | Statystyka | Wartość | p | n | Werdykt | Odczyt hipotezy |
|---|---|---|---|---|---|---|---|---|
| fcf2ed4a | Nowe pobranie (metoda wierna) | RSV „cigar” (2011) vs odsetek uczniów palących cygara (YRBS 2011) | pearson | 0,358 | 0,0321 | 36/36 | reproduced | dane wspierają hipotezę |

_Źródło: przebieg fcf2ed4a_

Eksploracyjnie (bez werdyktu), the paper's own influence check (published r=0.26, p=.130, n=34); descriptive, never a verdict: wykluczone US-RI, US-UT; r 0,194, p 0,2724, n = 34; praca: r = 0,260 (n = 34, p = 0,1300).

_Źródło: przebieg fcf2ed4a_

| Podmiot | Pomiar | Referencja |
|---|---|---|
| US-AK | 62 | 10.2835 |
| US-AL | 68 | 15.7757 |
| US-AR | 61 | 14.444 |
| US-AZ | 75 | 15.848 |
| US-DE | 82 | 12.9135 |
| US-GA | 82 | 17.8314 |
| US-HI | 70 | 6.8316 |
| US-IA | 47 | 12.7949 |
| US-ID | 44 | 10.9702 |
| US-IL | 78 | 13.1285 |
| US-IN | 70 | 14.6463 |
| US-KS | 74 | 10.7414 |
| US-KY | 65 | 17.5154 |
| US-LA | 69 | 17.0138 |
| US-MA | 84 | 14.2941 |
| US-MD | 73 | 12.9331 |
| US-ME | 58 | 12.6297 |
| US-MI | 69 | 12.0617 |
| US-MS | 62 | 14.6404 |
| US-MT | 54 | 16.1065 |
| US-ND | 52 | 13.4669 |
| US-NE | 63 | 9.5951 |
| US-NH | 75 | 16.3686 |
| US-NM | 66 | 15.0888 |
| US-OH | 74 | 13.6807 |
| US-OK | 66 | 14.1227 |
| US-RI | 99 | 13.2816 |
| US-SC | 79 | 18.3121 |
| US-TN | 74 | 15.5293 |
| US-TX | 71 | 15.9617 |
| US-UT | 33 | 4.9575 |
| US-VA | 81 | 11.9786 |
| US-VT | 61 | 12.8392 |
| US-WI | 58 | 14.7745 |
| US-WV | 67 | 11.6698 |
| US-WY | 61 | 16.5617 |

_Źródło: przebieg fcf2ed4a_

## Porównanie z pracą oryginalną

| Porównanie | Praca | Nowy pomiar | Pasmo (przed danymi) |
|---|---|---|---|
| RSV „cigar” (2011) vs odsetek uczniów palących cygara (YRBS 2011) | r = 0,390 (n = 36, p = 0,0180) | r = 0,358 (n = 36, p = 0,0321) | [0.07; 0.64] |

_Źródło: przebieg fcf2ed4a, fixtures/cr2014/paper_reported.json_

## Protokół potwierdzający i rodzina porównań

Protokół „JH16 — potwierdzenie” zamrożony 2026-10-26 19:24 UTC (sha256 76ee2ff3aa60c41b): punkty główne cigar_youth_pearson; rodziny porównań w kolejności priorytetu: F1 „Główna” (cigar_youth_pearson; korekta holm); bramkowanie szeregowe (rodzina testowana tylko po odrzuceniu wszystkich hipotez wcześniejszych rodzin), alfa 0,05. Uzasadnienie: Jedno wcześniej zarejestrowane porównanie (H-cigar-youth), Holm w rodzinie jednoelementowej, alfa 0,05 jak w pracy. Zamrożone przed pomiarem.

_Źródło: konfiguracja protocol c4cf1588-d7b1-4e14-abfb-44ff5c29ea74_

| Przebieg | Rodzina, priorytet | Porównanie | Główne | Werdykt | p | p skorygowane | < alfa |
|---|---|---|---|---|---|---|---|
| 7aa42db5 | F1.1 | Pearson RSV cygar vs YRBS 2011 | tak | not_computable | — | — | nietestowane: brak wartości p |

_Źródło: przebieg 7aa42db5_

Protokół „JH16 — potwierdzenie” zamrożony 2026-10-26 19:28 UTC (sha256 cfaba63576acb223): punkty główne cigar_youth_pearson; rodziny porównań w kolejności priorytetu: F1 „Główna” (cigar_youth_pearson; korekta holm); bramkowanie szeregowe (rodzina testowana tylko po odrzuceniu wszystkich hipotez wcześniejszych rodzin), alfa 0,05. Uzasadnienie: Jedno wcześniej zarejestrowane porównanie (H-cigar-youth), Holm w rodzinie jednoelementowej, alfa 0,05 jak w pracy. Zamrożone przed pomiarem.

_Źródło: konfiguracja protocol ab477acf-0c75-4eaf-88af-acd85c808801_

| Przebieg | Rodzina, priorytet | Porównanie | Główne | Werdykt | p | p skorygowane | < alfa |
|---|---|---|---|---|---|---|---|
| fcf2ed4a | F1.1 | Pearson RSV cygar vs YRBS 2011 | tak | reproduced | 0,0321 | 0,0321 | tak |

_Źródło: przebieg fcf2ed4a_

## Rozbieżności i ich przyczyny

| Możliwa przyczyna | Test | Status | Dowód |
|---|---|---|---|
| Inne dane referencyjne niż w pracy | porównanie skrajnych wartości YRBS 2011 podanych w pracy (SC 18,3; GA 17,8; KY 17,5; LA 17; UT 5; HI 6,8; NE 9,6; AK 10,3) i liczby stanów (36) z otwartym zbiorem | wykluczona | fixtures/cr2014/yrbss_2011_current_cigar_use.json; fixtures/cr2014/paper_reported.json |
| Zapytanie dłuższe niż limit dostawcy | pierwszy przebieg (7aa42db5, kopia testowa): HTTP 400 od SerpApi, brak wartości | wykazana | config/presets/cr2014-faithful.json |
| Inna próbka Google Trends niż ta, którą widzieli autorzy | porównanie 9 skrajnych wartości RSV podanych w pracy z pomiarem fcf2ed4a (FL 100→100, RI 98→99, PA 91→94, NY 90→82, DC 90→95; UT 34→33, ID 41→44, IA 49→47, ND 51→52) | prawdopodobna | docs/history/evidence/2026-10-26-cr2014/independent_check.jsonl |
| Zbiór 8 terminów (v2) obejmuje inne wyszukiwania niż 15 terminów pracy | te same skrajne wartości: różnice do 8 punktów, zgodne kolejności skrajnych stanów; nie da się oddzielić od ponownego próbkowania Trends | nierozstrzygnięta | config/presets/cr2014-faithful.json |
| Błąd obliczeń | niezależny skrypt bez kodu WatchDoga z surowych plików Trends i CDC | wykluczona | scripts/verify_cr2014_run.py; docs/history/evidence/2026-10-26-cr2014/independent_check.jsonl |

_Źródło: konfiguracja dossier_

## Ograniczenia

- Google Trends to względny indeks z próby; wartości dla 2011 r. pobrane dziś mogą się różnić od tych, które widzieli autorzy.
- Jeden pomiar Trends; zmienność między pobraniami nie jest znana bez powtórzeń.
- Powtórzony jest jeden z czterech głównych wyników pracy (pozostałe: brak otwartych danych referencyjnych).
- Dystrykt Kolumbii nie ma danych YRBS 2011, więc nie wchodzi do porównania.

## Wnioski

- RSV „cigar” (2011) vs odsetek uczniów palących cygara (YRBS 2011): werdykt reproduced; dane wspierają hipotezę (reguła ustalona przed danymi).
- Ocena (analiza z 2026-10-26, po danych): Wynik główny pracy powtarza się na danych pobranych dziś: Pearson 0,358 (p 0,032, n 36) wobec 0,39 (p 0,018); wartość mieści się w paśmie (przedział ufności pracy). Wrażliwość bez UT i RI także odtwarza kierunek i brak istotności (0,194 wobec 0,26). Powtórzono jeden z czterech wyników; trzech nie da się sprawdzić na otwartych danych.
- Wynik negatywny jest wynikiem: praca dokumentuje go w całości, z danymi i ich pochodzeniem.

_Źródło: przebieg fcf2ed4a, docs/replication/CR2014_2026-10-26/REPORT.md_

## Aneks: odtwarzalność

| Przebieg | Kod | Hash konfiguracji | Manifest sha256 | Pobrania |
|---|---|---|---|---|
| fcf2ed4a-4f41-4756-8497-6fc9b41d3628 | 7cec4482466c994af261527f52275e1e21743664 | f97f975e1b40bb49fbb751580b4d43b73ffaf2767d035a0c7666b32a15f47b77 | 1cdec2581a92489e005da12da46452303aa9c178de240904192c589c321f0e4c | 1 |
| 7aa42db5-dee8-444d-813c-9aa54712ed08 | cb8c9fd2ae32c6d9e1bc1b3e888ddc2d8b7a14b2 | cc9e0734edff965311d25fc7fd0c78fdf4d3133e4d6cda269d3d2f75a6d2cc88 | b3399b3984a2c10f606d72273a629deee8989124002679ceaccc199afe0f5910 | 1 |

_Źródło: przebieg fcf2ed4a, przebieg 7aa42db5_

- Kryteria: 1dedc007d7b16acf075d4808f9d32d3cc10af0d46074d13d04b88b6d3cd14c5c
- Interpretacja: 6666a59a481452bf20fd9e4248d2d55278ce52a9d12819e00d3175b3cb7c4c6a
- Dossier: eac8accef3eb4232cffa21cc3ebe0199f45123996425934ab4e996443ec0879f
- Prerejestracja: docs/replication/CR2014_2026-10-26/PROTOCOL.md (commit aa7e2ea)
- Wersja kodu generującego: 7cec4482466c994af261527f52275e1e21743664-dirty
