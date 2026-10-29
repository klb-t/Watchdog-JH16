# JH16 — przyspieszona replikacja przed testem właściciela: raport (2026-10-25)

Protokół z kryteriami zapisano i opublikowano **przed** pobraniem danych: [PROTOCOL.md](PROTOCOL.md),
commit `3d74e15`. Wartości liczbowe poniżej pochodzą z zapisanych wyników WatchDoga
([results.json](results.json)); każdy przebieg sprawdzono niezależnym skryptem
`scripts/verify_jh16_run.py` (0 rozbieżności). Żadna liczba nie została policzona ani poprawiona
przez model językowy.

## Najkrócej

- **Obliczenia są poprawne.** Liczby z publikacji przechodzą przez produkt i dają dokładnie Tabelę 1
  i 3 oraz 81,6% (Pearson 0,8162). Wszystkie nowe przebiegi przeliczone niezależnie — zgodne.
- **Nowe dane z Google (przez SerpApi) nie odtwarzają związku Hi z oceną Nutta.** W 5 kompletnych
  przebiegach z 25.10.2026 Pearson wynosi od −0,23 do −0,10 (publikacja: 0,816). Ranking
  popularności nadal zgadza się z Tabelą 1 (Spearman 0,71–0,88, próg 0,60).
- **Przyczyna rozbieżności jest wykazana i leży w narzędziu pomiaru, nie w programie:** szacunki
  liczby wyników Google dla zapytań złożonych łamią logikę zbiorów (np. „mephedrone” + „harm” OR
  „harmful” daje 4,69 mln, choć osobno „harm” 53,5 tys. i „harmful” 54,2 tys.), a w każdym przebiegu
  2–4 z 32 liczb losowo spadają do kilkudziesięciu. Formalnie, wg reguły ustalonej przed danymi,
  dane **przeczą** hipotezie; merytorycznie **nie pozwalają jej rozstrzygnąć**, bo Hi z dzisiejszych
  szacunków nie jest poprawną proporcją.
- **Znaleziono i poprawiono 9 wad produktu** (m.in. źródło zwracające zmyśloną liczbę 42000, brak
  oceny hipotezy w produkcie, przerwanie całego badania po jednym błędzie). Pełny zestaw testów:
  622/622.

**Uzupełnienie (to samo popołudnie):** niezależne dane historyczne i kalibracja Google Trends /
Europe PMC — [CALIBRATION.md](CALIBRATION.md). Google Trends jest teraz źródłem WatchDoga, a
kalibracja przebiega przez produkt. Ranking popularności z 2014 r. zgadza się z niezależnym Google
Trends (Spearman 0,89–0,95 zależnie od próbki); zmiany w czasie z Tabeli 2 — nie; spójny licznik
(Europe PMC) nie odtwarza związku Hi z Nuttem.

## 1. Co replikujemy

Szczegóły i braki metody: [PROTOCOL.md §1](PROTOCOL.md). Streszczenie:

| Element | Ustalenie |
|---|---|
| Hipoteza główna (H-harm) | Hi = Ni_harm/Ni × 100% z liczby wyników Google koreluje z ekspercką oceną szkodliwości Nutt 2010 (16 substancji). Publikacja: 81,6%, p = 0,000143, α = 0,01 |
| Hipoteza opisowa (H-pop) | Pi = Ni/max(Ni) × 100% daje ranking popularności; w publikacji weryfikowany jakościowo (UNODC, EMCDDA), bez kryterium liczbowego |
| Dane | Google, nazwa w cudzysłowie, SafeSearch off; 32 zapytania; 2014-06-20 |
| Analiza | korelacja Hi z oceną Nutta; z przeliczenia Tabel 1 i 3: Pearson 0,8162 (zgodny z 81,6%), Spearman 0,560 |
| Czego publikacja nie podaje | region/domena Google, język interfejsu, rodzaj testu istotności (podane p nie wynika ze standardowego testu t: 0,000115), powtórzenia pomiaru |
| Poza zakresem | Tabela 2 (wyszukiwania ograniczone datą); jej ostatnia kolumna jest bez ograniczenia daty i nie jest porównywalna z pozostałymi |

Poprawność implementacji metody oddzielono od pytania, czy nowe dane wspierają hipotezę (sekcja 4).

## 2. Przebiegi przez produkt

Wszystkie pomiary wykonano normalnym przepływem WatchDoga (kreator w Ustawieniach lub strona Study →
pobranie → zapis surowych odpowiedzi → obliczenia MethodSpec → ocena → wyniki i eksport) na lokalnej
instancji audytowej na VM (`~/wt/jh16_audit_2026-10-25/`, baza i surowe odpowiedzi zachowane).
Skrypty pomocnicze służyły tylko do sterowania przeglądarką i do niezależnej weryfikacji.

| Przebieg | Co to jest | Pobranie (UTC) | Kod | Kompletny |
|---|---|---|---|---|
| R-hist `a0d88a49` | przeliczenie liczb z publikacji (strona Study) | — (dane z 2014) | `55674c3` | 16/16 |
| R1 `e2aa7643` | nowe pobranie, metoda wierna, **wersja przed poprawkami** | 11:58:09–11:58:57 | `58a0c93` (wtedy nie zapisywano wersji) | 16/16 |
| R1-recompute `9d80efca` | ponowne przeliczenie zapisanych liczb R1 poprawionym kodem, bez pobierania | — | `55674c3` | 16/16 |
| R2 (5 przebiegów, plan `8a0aa82d`) | pierwsza próba planu z rozszerzeniem; przerwana przez dzienny limit zapytań (wada nr 7) | 12:23 | `55674c3` | 2–8/16 — zachowane, nie interpretowane |
| R3-faithful `2e701755` | nowe pobranie, metoda wierna | 12:39:21–12:40:10 | `6402358` | 16/16 |
| R3 repeat-1 `d935c03b`, repeat-2 `4e8ff376` | rozszerzenie: powtórzenia warunków wiernych | 12:39–12:41 | `6402358` | 16/16 |
| R3 gl-us `f4c9d3d5`, gl-pl `051f9b60` | rozszerzenie: jawny kraj Google (google.com/us, google.pl/pl) | 12:39–12:41 | `6402358` | 16/16 |
| VM `0e5ed635`, `b14ccbaa` | test dymny wdrożonej wersji na VM: przeliczenie historyczne i nowy pomiar przez kreator | 12:53:35–12:54:13 | `e33504e` | 16/16 |
| T3 `d1bd7e5d` | test rozróżniający: rozbicie zapytania OR (24 zapytania) | 12:42:57–12:43:25 | `6402358` | — |

Przyspieszenie: plan uruchamia wierny przebieg i cztery warianty jednocześnie (ok. 2 min na 160
zapytań); przeliczenia utrwalonych danych nie pobierają niczego ponownie. Zużycie SerpApi według konta: 312
zapytań (cały darmowy limit 250 na październik i 62 z dokupionych kredytów; zostało 2711).

## 3. Replikacja a rozszerzenie SERP API

| | Wariant wierny (FAITHFUL) | Rozszerzenie (ENHANCED, `config/presets/jh2016-serp-extension.json`) |
|---|---|---|
| Substancje, zapytania, wzory, odniesienie | jak w publikacji | bez zmian |
| Dostawca | Google przez SerpApi, `safe=off`, `hl=en` | ten sam |
| Region | domyślny dostawcy: google.com, bez `gl` (publikacja nie podaje) | `gl=us`/google.com oraz `gl=pl`/google.pl |
| Powtórzenia | jedno | dwa dodatkowe, `no_cache` |
| Audyt pól | — | dla każdej odpowiedzi zapisane `total_results` i liczba zwróconych rekordów |
| Nazwa wyniku | „niezależna próba, czasowa ponowna ocena” | „wariant rozszerzenia — nie jest replikacją” |

**Co mierzą pola dostawcy.** `search_information.total_results` to szacunek Google liczby wszystkich
pasujących stron (ta wartość jest Ni). `organic_results` to rekordy zwrócone na jednej stronie (7–10).
WatchDog zapisuje obie wartości osobno; druga nigdy nie wchodzi do Pi ani Hi. Gdy Google zamiast
szacunku podaje liczbę nie większą niż wyniki osiągalne przez jego stronicowanie (np. 74 przy 8
stronach), obserwacja dostaje flagę `PROVIDER_COUNT_EQUALS_REACHABLE_RESULTS`; wartość nie jest
zmieniana ani usuwana.

Wyników z 2026 r. nie przedstawiamy jako odtworzenia zbioru z 2014 r. Dane historyczne (Tabele 1 i 3)
posłużyły osobno do sprawdzenia obliczeń (R-hist).

## 4. Ocena

### Czy implementacja realizuje zadeklarowaną metodę?

Tak, z jawnymi odstępstwami. 32 zapytania są bajtowo zgodne z publikacją (`query_label`, cudzysłowy,
`"harm" OR "harmful"`), wzory Pi i Hi wykonuje zatwierdzony MethodSpec, brak nie jest zerem, Hi nie
jest obcinane. Odstępstwa wymuszone dostępnymi źródłami: Google przez API zamiast przeglądarki,
nieznany region zastąpiony ustawieniem domyślnym dostawcy (sprawdzonym w odpowiedziach), data 2026.

### Czy obliczenia są poprawne?

Tak. R-hist odtwarza wszystkie 32 wartości Pi/Hi z Tabel 1 i 3 (po zaokrągleniu do 0,1 — zero
różnic), Pearson 0,8162 = 81,6%. Każdy nowy przebieg przeliczono niezależnym skryptem bez kodu
WatchDoga: 0 rozbieżności wartości i korelacji. Jedyna niewyjaśniona różnica dotyczy publikacji:
podane p = 0,000143 nie odpowiada testowi t dla r = 0,8162 i n = 16 (0,000115).

### Zgodność z wynikami odniesienia

| Przebieg | Pearson Hi–Nutt (p) | Spearman Hi–Nutt | Werdykt H-harm (próg 0,70) | Spearman Pi vs Tabela 1 | Werdykt rankingu (próg 0,60) |
|---|---|---|---|---|---|
| R-hist | 0,816 (0,000115) | 0,560 | reproduced | 0,999 | reproduced |
| R1 | 0,472 (0,065) | 0,236 | deviates | 0,584 | deviates |
| R3-faithful | −0,104 (0,70) | 0,217 | deviates | 0,764 | reproduced |
| R3 repeat-1 | −0,101 (0,71) | 0,114 | deviates | 0,834 | reproduced |
| R3 repeat-2 | −0,101 (0,71) | 0,111 | deviates | 0,787 | reproduced |
| R3 gl-us | −0,234 (0,38) | −0,320 | deviates | 0,708 | reproduced |
| R3 gl-pl | −0,101 (0,71) | 0,203 | deviates | 0,880 | reproduced |
| VM (po wdrożeniu) | −0,234 | −0,158 | deviates | 0,708 | reproduced |

„reproduced” oznacza mieszczenie się w progu ustalonym przed pomiarem, nie identyczność danych.
Wartości punktowe (tabela poniżej) różnią się od 2014 r. — opisowo, bez werdyktu, zgodnie z rejestrem.

### Czy nowe dane wspierają hipotezę?

Reguła ustalona przed danymi (Pearson < 0,62 i Spearman < 0,50 → „przeczą”) daje **„przeczą”** we
wszystkich 5 kompletnych przebiegach R3 i w R1. Analizy eksploracyjne (nie zmieniają werdyktu), R3:
bez alkoholu Pearson −0,25…−0,05; bez liczb oznaczonych jako osiągalne wyniki −0,23…−0,10. W R1 bez
alkoholu Pearson wynosi 0,79, ale wyłącznie przez zapadniętą liczbę dla heroiny (Hi ≈ 21 mln %).

### Czy zakres i jakość danych wystarczają do takiego wniosku?

**Nie.** Test T3 wykazał, że dzisiejsze szacunki Google dla zapytań złożonych nie zachowują się jak
liczby stron: wynik zapytania-podzbioru przewyższa wynik zapytania nadrzędnego (Ni_harm > Ni w 2–6
substancjach na przebieg), OR bywa 87× większe od każdego składnika albo mniejsze od jednego z nich.
Wartość „przeczą” jest więc poprawnym zastosowaniem reguły, ale nie dowodem przeciw związkowi
między dyskusją o szkodliwości w sieci a oceną ekspercką. Rzetelny wniosek: **procedura JH16 w
obecnym brzmieniu nie daje już poprawnego wskaźnika Hi; hipoteza merytoryczna pozostaje
nierozstrzygnięta tą metodą.**

### Wartości R3-faithful (2026-10-25) obok publikacji (2014-06-20)

| Substancja | Ni 2026 | Ni 2014 | Ni_harm 2026 | Hi 2026 % | Hi 2014 % | Pi 2026 % | Pi 2014 % | Nutt | Flagi |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| alcohol | 704 000 000 | 389 000 000 | 212 000 000 | 30,1 | 27,5 | 100 | 100 | 72 | |
| amphetamine | 6 020 000 | 9 070 000 | 5 900 000 | 98,0 | 5,1 | 0,86 | 2,3 | 23 | |
| benzodiazepines | 4 640 000 | 4 520 000 | 58 | 0,0 | 10,3 | 0,66 | 1,2 | 15 | osiągalne wyniki |
| buprenorphine | 8 410 000 | 6 400 000 | 6 400 000 | 76,1 | 5,8 | 1,19 | 1,6 | 7 | |
| butane | 56 | 11 800 000 | 67 | 119,6 | 3,3 | 0,00 | 3,0 | 11 | osiągalne wyniki, Hi > 100 |
| cannabis | 135 000 000 | 59 100 000 | 134 000 000 | 99,3 | 4,6 | 19,18 | 15,2 | 20 | |
| cocaine | 47 900 000 | 58 600 000 | 19 600 000 | 40,9 | 25,6 | 6,80 | 15,1 | 27 | |
| ecstasy | 55 300 000 | 42 900 000 | 9 160 000 | 16,6 | 1,6 | 7,86 | 11,0 | 9 | |
| GHB | 8 170 000 | 23 500 000 | 409 000 | 5,0 | 1,2 | 1,16 | 6,0 | 19 | |
| heroin | 25 700 000 | 46 800 000 | 15 900 000 | 61,9 | 25,0 | 3,65 | 12,0 | 55 | |
| ketamine | 11 300 000 | 8 400 000 | 4 410 000 | 39,0 | 4,9 | 1,61 | 2,2 | 15 | |
| khat | 13 100 000 | 10 600 000 | 481 000 | 3,7 | 6,7 | 1,86 | 2,7 | 9 | |
| LSD | 40 400 000 | 48 600 000 | 72 | 0,0 | 1,2 | 5,74 | 12,5 | 7 | osiągalne wyniki |
| mephedrone | 664 000 | 2 050 000 | 4 620 000 | 695,8 | 4,5 | 0,09 | 0,5 | 13 | Hi > 100 |
| methadone | 5 300 000 | 13 400 000 | 3 070 000 | 57,9 | 4,1 | 0,75 | 3,4 | 14 | |
| methamphetamine | 10 400 000 | 8 780 000 | 10 600 000 | 101,9 | 5,8 | 1,48 | 2,3 | 33 | Hi > 100 |

## 5. Diagnoza rozbieżności

| Możliwa przyczyna | Test | Wynik | Status |
|---|---|---|---|
| Błąd obliczeń | niezależne przeliczenie wszystkich przebiegów; R-hist na danych publikacji | 0 rozbieżności; R-hist = publikacja | **wykluczona** |
| Błąd implementacji zapytań | porównanie 32 wysłanych zapytań i parametrów w surowych odpowiedziach | zgodne z publikacją; `safe=off`, `hl=en`, domena zgodna z wariantem | **wykluczona** |
| Wady programu | przebieg przez produkt przed i po poprawkach | 9 wad (sekcja 6); żadna nie zmieniła wartości kompletnego przebiegu — R1 przeliczone poprawionym kodem daje to samo | **wykazane, poprawione, bez wpływu na liczby** |
| Losowa zmienność szacunku | 4 przebiegi w tych samych warunkach | mediana zmienności 0,4%; ten sam wniosek we wszystkich | **wykluczona jako główna przyczyna** |
| „Zapadnięte” liczby (Google podaje wyniki osiągalne, np. 56 dla "butane") | powtórzenia + głębokość stronicowania | 2–4 z 32 na przebieg, za każdym razem inne zapytania; wyłączenie ich nie przywraca korelacji | **wykazane; część przyczyny** |
| Szacunki dla zapytań złożonych łamią logikę zbiorów | T3: `"X" "harm"`, `"X" "harmful"`, `"X" ("harm" OR "harmful")` dla 8 substancji | mefedron: 53,5 tys. / 54,2 tys. / 4,69 mln; metadon: 5,63 mln / 0,31 mln / 3,02 mln; metamfetamina: koniunkcja ≈ sama nazwa (10,3 vs 10,4 mln) | **wykazane; główna przyczyna** |
| Region Google | gl=us i gl=pl | ten sam wniosek; różnice wartości w obrębie tej samej niespójności | **wykluczona jako przyczyna wniosku** |
| Zmiana algorytmu szacowania Google od 2014 r. | brak dostępu do dawnego narzędzia; dane 2014 są wewnętrznie spójne (Hi ≤ 27,5%, Ni_harm < Ni) | spójne z hipotezą, niesprawdzalne | **prawdopodobna** |
| Zmiana badanego zjawiska (treści w sieci) | niemożliwa do oddzielenia przy niespójnym narzędziu | — | **nierozstrzygnięta** |
| Ograniczenia metody pierwotnej | przeliczenie danych z 2014 r. | Pearson zależy od alkoholu (bez niego 0,72); Spearman 0,56; n = 16; sami autorzy opisują anomalię „cat” OR „dog” | **wykazane** |
| Test istotności w publikacji | przeliczenie p | 0,000115 zamiast 0,000143 | **nierozstrzygnięta** (rodzaj testu nieznany) |
| Zmienność w ciągu dni | jeden dzień pomiaru | — | **nierozstrzygnięta** |

## 6. Poprawki i ponowne sprawdzenie

Wszystkie znalezione przez rzeczywisty przebieg, nie przez przegląd kodu:

| # | Wada | Skutek przed poprawką | Commit |
|---|---|---|---|
| 1 | źródło `serp_generic` zwracało 42000 dla każdego zapytania i było wybieralne na stronie Study | zmyślone Pi = Hi = 100% wyglądające jak pomiar | `55674c3` |
| 2 | strona Study uruchamiała 3 substancje i oceny Nutta wpisane w kod, niezależnie od źródła | „JH16” na 3/16 substancji | `55674c3` |
| 3 | jeden nieudany pobór przerywał cały przebieg | utrata wszystkich obserwacji zamiast jawnych braków | `55674c3` |
| 4 | korelacja z Nuttem, p i werdykty istniały tylko w skrypcie demo | interfejs nie pokazywał oceny hipotezy, wykres rozrzutu był pusty | `55674c3` |
| 5 | eksport bez liczb Ni/Ni_harm, zapytań, dostawcy i oceny | eksport nie pozwalał sprawdzić wyniku | `55674c3` |
| 6 | przebiegi i manifesty bez wersji kodu; zdarzenia pobrania bez dostawcy i hasha żądania | brak śladu audytowego | `55674c3` |
| 7 | plan 160 zapytań uruchamiał się mimo limitu 100/dzień; wyczerpanie limitu zapisywane jako `FETCH_FAILED` i ponawiane | niekompletne przebiegi R2 bez ostrzeżenia | `caf3b95` |
| 8 | ponowne przygotowanie identycznego planu zwracało stare uruchomienie | „Plan uruchomiony” z linkami do starych przebiegów; brak powtórzenia pomiaru | `6402358` |
| 9 | wyniki na telefonie przewijały się w bok i obcinały liczby | nieczytelne na telefonie | `caf3b95` |

Dodatkowo: flaga osiągalnych wyników (także dla liczby bez stronicowania, `e33504e`), parametry
wariantu na poziomie przebiegu (dozwolone tylko `gl`, `google_domain`, `location`; inne odrzucane
zamiast cicho ignorowane), preset ENHANCED z wyliczonymi różnicami.

Ponowne sprawdzenie: R1 przeliczone poprawionym kodem (to samo co niezależny skrypt), R2 zachowane
jako dowód wady nr 7, R3 pobrane ponownie po poprawkach. Odmowa planu przekraczającego limit
sprawdzona na żywo bez wysłania zapytań. Testy: 622/622 (było 613: 10 nowych testów regresji, 1 usunięty — sprawdzał
zmyślone źródło `serp_generic`), typecheck i build. Żadnego testu nie wyłączono ani nie pominięto.

## 7. Przekazanie do testu

Wdrożenie, dostęp i instrukcja testu: [OWNER_TEST.md](OWNER_TEST.md). Zachowane eksporty,
zrzuty ekranu i skrypty sterujące: `docs/history/evidence/2026-10-25-jh16/` (z `SHA256SUMS`).
Surowe odpowiedzi SerpApi (warunki dostawcy) i baza instancji audytowej są na VM w
`~/wt/jh16_audit_2026-10-25/`; ich sha256 są w manifestach przebiegów.

### Czego jeszcze nie zweryfikowano

- redakcji projektu pracy przez model językowy (np. Vertex): praca jest składana deterministycznie
  z zapisanych wyników; opcja z modelem nie jest jeszcze zrobiona;

- stabilności szacunków Google w kolejnych dniach (tylko 25.10.2026);
  *uzupełnienie 2026-10-29:* kopie testowe mają pomiary z 26.10 (`c17d1147`, `51a9567b`) i 28.10
  (`ea2b7078`). 28.10 Google zwrócił wyniki osiągalne dla 14 z 32 zapytań, więc szacunki nie są
  stabilne nawet w skali dni. Lista otwartych luk przed pokazaniem prof. Hoffmannowi:
  [GAPS_FOR_HOFFMANN_2026-10-29.md](GAPS_FOR_HOFFMANN_2026-10-29.md);
- czy flaga „osiągalne wyniki” wyłapuje wszystkie zapadnięte liczby (reguła heurystyczna,
  sprawdzona na 192 odpowiedziach);
- dawnego zachowania Google z 2014 r. (niedostępne);
- testu przez telefon właściciela na publicznym adresie (sprawdzono tylko emulowaną szerokość 390 px);
- logowania kontami/Google, SMTP i pełnego odtworzenia z kopii na tej VM (poza zakresem; instancja
  działa w trybie lokalnego właściciela za hasłem Caddy);
- kreatora w trybie „Prosty”: pole dziennego limitu SerpApi jest widoczne tylko od trybu
  „Standardowy”;
- innych metod niż JH16 i analiz z modelem językowym (nieużywane).
