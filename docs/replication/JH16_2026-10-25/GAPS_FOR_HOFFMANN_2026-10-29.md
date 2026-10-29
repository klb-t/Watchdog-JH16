# JH16 — luki przed pokazaniem prof. Hoffmannowi (2026-10-29)

Dla właściciela. Gałąź `claude/jh16-gaps-20261029`, odgałęziona od `claude/goal-favourites-20261029`.
Nic nie zostało wysłane prof. Hoffmannowi ani na żaden adres. Nic nie wdrożono. Nie wykonano płatnych
zapytań (SerpApi, Vertex).

**Skąd pochodzą wyniki sprawdzeń.**
- Wszystkie liczby sprawdziłem z zapisanych plików albo przeliczyłem kodem (skrypty Pythona bez kodu
  WatchDoga). Żadnej liczby nie szacowałem.
- Pliki: `results.json`, eksporty w `docs/history/evidence/2026-10-25-jh16/`,
  `docs/history/evidence/2026-10-28-request-hoffmann/` i `fixtures/jh2016/paper_reported.json`.
- Podgląd projektu pracy i grafu dowodów po poprawkach zbudowałem z **kopii** bazy audytowej
  `~/wt/jh16_audit_2026-10-25/inst_e57b2`. Kopia leżała w katalogu tymczasowym i była czytana bez
  serwera. Wynik przed decyzją: 29 przebiegów, 89 węzłów, 1 luka. Po decyzji (opcja C): 90 węzłów, 0 luk.
- Danych syntetycznych użyto tylko w testach. Testy budują przebiegi z liczb publikacji przez
  zapisany kształt odpowiedzi SerpApi oraz ręcznie zbudowane podsumowania przebiegów. Testy:
  `tests/integration/replication_dossier.test.ts` i `tests/integration/jh16_estimator_consistency.test.ts`.
- Twojej instalacji (kontener `watchdog`) nie dotykałem. Tam, gdzie piszę o niej, opieram się na
  `OWNER_TEST.md`.

## Podsumowanie

| # | Luka | Status |
|---|---|---|
| 1 | Przyczyna „Zmiana sposobu szacowania przez Google od 2014 r.” ma status „prawdopodobna” bez dowodu | **zamknięte decyzją koordynatora 2026-10-29 (opcja C)**: zostaje „prawdopodobna”, jako hipoteza zgodna z danymi, z dowodem spójności liczb |
| 2 | „Region Google” na Twojej instalacji: brak przebiegów gl=us i gl=pl | **wymaga płatnych kredytów** (160) |
| 3 | Linki do dowodów prowadziły do gałęzi bez jednego z plików | **poprawione w tej gałęzi** |
| 4 | Aneks pracy przypisywał przeliczeniu 32 pobrania, choć nic nie pobrało | **poprawione w tej gałęzi** |
| 5 | Słowo „reproduced” w pracy bez definicji | **poprawione w tej gałęzi** |
| 6 | Streszczenie pomijało późniejszy niekompletny pomiar | **poprawione w tej gałęzi** |
| 7 | Tabela kalibracji bez n i bez przebiegu porównania (A3b = 1,000 przy n = 6) | **poprawione w tej gałęzi** |
| 8 | „Rozbieżności” i praca sugerowały dowód, którego nie ma na instalacji | **poprawione w tej gałęzi** |
| 9 | Graf liczył niekompletne przebiegi jako dowód | **poprawione w tej gałęzi** |
| 10 | Tekst przeczy późniejszym wynikom („jeden dzień”, „popularność nadal mierzalna”) | **poprawione w tej gałęzi** (uzupełnienia z datą) |
| 11 | Angielskie słowa i kody w polskiej pracy i interfejsie | **częściowo poprawione**; reszta poniżej |
| 12 | Raport zlecenia z tekstu jest po angielsku i ma uwagi wewnętrzne | **decyzja właściciela**; nie przetłumaczono |
| 13 | Brak jako 0 na wykresie porównania przebiegów | **poprawione w tej gałęzi** |
| 14 | Stany konta SerpApi w raportach bez zapisanego źródła | **bieżący stan sprawdzony** (2026-10-29T22:01:05Z); dawne stany oznaczone „niezweryfikowane” |
| 15 | Ścieżki plików w pobranej pracy (Markdown/HTML) nie są linkami | **nie zamknięte** (drobne) |
| — | Liczby w REPORT, CALIBRATION, raporcie zlecenia wobec zapisanych danych | **sprawdzone: zgodne** |

## 1. Przyczyna „prawdopodobna” bez dowodu — decyzja koordynatora: opcja C

**Decyzja (koordynator, 2026-10-29): opcja C.**
- Status zostaje „prawdopodobna”.
- Przyczyna jest przedstawiana jako **hipoteza zgodna z danymi, nie jako wynik**. Nigdy nie pada słowo „wykazana”.
- Dowodem w dossier jest plik `docs/history/evidence/2026-10-29-jh16-gaps/estimator_consistency.json`.
  - Zmiana: `config/replication/jh2016-dossier.json`, wersja `2026-10-29-v3`, z polem `status_decided`.
  - Linki wskazują commit `a4c9a6307e725121a14e771e89a2d621737a36e1`, który zawiera ten plik.
- Graf „Dowody” pokazuje teraz krawędź „popiera” od pliku do przyczyny i nie zgłasza już luki.
- Węzeł przyczyny ma opis „hipoteza zgodna z danymi, nie wykazana”. Ten sam napis jest w „Rozbieżnościach” i w projekcie pracy.
- Test: „the probable cause "Zmiana sposobu szacowania" names its consistency evidence and stays labelled a hypothesis”.

**Wynik w skrócie.** Zasada Ni_harm ≤ Ni jest złamana w **0 z 16** par z 2014 r. i w **35 ze 143** par z 2026 r. Szczegóły i ograniczenia są niżej.

Opcje A, B, D i E zostają opisane poniżej jako alternatywy. Właściciel może do nich wrócić.


**Dowód luki.**
- Wpis w dossier: `config/replication/jh2016-dossier.json`, wiersz 143.
- Ma `"status": "probable"` i `"evidence": []`.
- Graf dowodów nazywa go luką: `backend/watchdog_api/services/evidence_graph.ts`, reguła „any other status must point at evidence”.
- Podgląd z kopii daje dokładnie 1 lukę: `cause:0f09ab482e1e`, „a diagnosis marked 'probable' names no evidence”.
- To samo w `REPORT.md`, wiersz 172, i w pytaniu w `OWNER_TEST.md`, wiersze 170–175.

**Co przygotowałem (bez nowych zapytań, tylko z zapisanych plików).**
- Skrypt: `scripts/jh16_estimator_consistency.py`.
- Wynik: `docs/history/evidence/2026-10-29-jh16-gaps/estimator_consistency.json`.
- Polecenie odtworzenia: `docs/history/evidence/2026-10-29-jh16-gaps/regenerate.sh`. Test sprawdza zgodność bajt w bajt.

**Zasada.** Zapytanie szkodliwości `"X" "harm" OR "harmful"` trafia tylko w strony, które zawierają też `"X"`.
- Prawdziwa liczba stron nie może więc dać Ni_harm > Ni, czyli Hi > 100%.
- Takie naruszenie nie może wynikać ze zmiany treści w sieci. Wynika wyłącznie ze sposobu liczenia.

**Wyniki** (wszystkie z pliku wynikowego):

| Zbiór | Pary | Ni_harm > Ni | To samo bez liczb < 1000 |
|---|---:|---:|---|
| 2014, Tabele 1 i 3 publikacji | 16 | **0** | 0 z 16; najmniejsza liczba w 2014 r. to 92 000 |
| R1 `9d80efca` (dane `e2aa7643`), 25.10 | 16 | 3 | 1 z 13 |
| R3-faithful `2e701755`, 25.10 | 16 | 3 | 2 z 13 |
| R3 repeat-1 `d935c03b` | 16 | 3 | 2 z 13 |
| R3 repeat-2 `4e8ff376` | 16 | 4 | 2 z 14 |
| R3 gl-us `f4c9d3d5` | 16 | 6 | 4 z 13 |
| R3 gl-pl `051f9b60` | 16 | 2 | 1 z 13 |
| VM `b14ccbaa`, 25.10 | 16 | 3 | 1 z 13 |
| kopia `c17d1147`, 26.10 | 16 | 4 | 4 z 16 |
| kopia `ea2b7078`, 28.10 | 15 (khat: brak) | 7 | 2 z 5 |
| razem 2026 | 143 | 35 | 19 z 113 |

- Rozbicie zapytania OR (T3, `d1bd7e5d`): w 5 z 8 substancji grupa OR jest większa od sumy składników albo mniejsza od jednego z nich.
  - Substancje: alcohol, amphetamine, buprenorphine, mephedrone, methadone.
  - Przykład: mephedrone 53 500 + 54 200 → 4 690 000.
- **Rachunek eksploracyjny** (poza protokołem, niczego nie rozstrzyga). Pytanie: gdyby Google w 2014 r. łamał zasadę tak często jak w 2026 r., jak prawdopodobne byłoby 0 naruszeń w 16 parach publikacji? Założenie: niezależne pary.

  | Wariant | Częstość 2026 | P(0 z 16) |
  |---|---|---|
  | wszystkie przebiegi razem | 35/143 | 0,011 |
  | przebieg z najniższą częstością | 2/16 | 0,118 |
  | bez liczb < 1000, razem | 19/113 | 0,053 |
  | bez liczb < 1000, najniższa częstość | 1/13 | 0,278 |

**Ograniczenia tego dowodu.** Piszę je wprost, bo od nich zależy decyzja.
- Naruszenia skupiają się na dwóch substancjach: mephedrone i methamphetamine występują prawie w każdym przebiegu. Pary nie są więc niezależne, a rachunek z założeniem niezależności przesadza.
- Dane z 2014 r. to jedna migawka, przepisana z tabel publikacji. Nie wiadomo, czy autorzy powtarzali lub odsiewali zapytania.
- Plik pokazuje, że **dzisiejszy** licznik jest niespójny, a liczby z 2014 r. tej niespójności nie mają. Nie pokazuje, **kiedy ani jak** Google zmienił sposób szacowania.

**Pytanie, na które odpowiedział koordynator:** jaki status i jaki dowód ma mieć ta przyczyna?

Opcje (wybrano C):
- **A.** Zostawić „prawdopodobna” bez dowodu. Luka zostaje widoczna w „Dowodach” i ją zobaczy.
- **B.** Zmienić na „nierozstrzygnięta”. Luka znika, bo ten status z definicji nie wymaga dowodu. Wniosek staje się ostrożniejszy.
- **C.** Zostawić „prawdopodobna” i wskazać jako dowód przygotowany plik `estimator_consistency.json`, z opisem jego ograniczeń.
  - **Wybrana 2026-10-29 przez koordynatora i wykonana w tej gałęzi.**
- **D.** Wskazać zewnętrzne źródło, np. dokumentację Google o zmianie szacunków, jeśli takie znasz.
- **E.** Zapytać autora o surowe liczby z 20.06.2014. Pytanie „original_data” jest już w dossier. To jedyna droga, która mogłaby oddzielić zmianę narzędzia od zmiany zjawiska.

Statusu „wykazana” nie proponuję. Ten plik nie oddziela zmiany sposobu szacowania od innych wyjaśnień braku naruszeń w 2014 r.

## 2. „Region Google” na Twojej instalacji — wymaga płatnych kredytów

**Dowód luki.**
- Wpis `config/replication/jh2016-dossier.json`, wiersz 121, ma status „wykluczona”.
- Jego dowodem są przebiegi rodzaju `enhanced_variant`.
- Na instalacji audytowej istnieją: `f4c9d3d5` (gl-us), `051f9b60` (gl-pl), oba kompletne.
- Na Twojej instalacji ich nie ma (`OWNER_TEST.md`, wiersz 68).

**Co poprawiłem.** Wcześniej „Rozbieżności” i projekt pracy pokazywały tylko etykietę „warianty w tabeli przebiegów”, także tam, gdzie żadnego wariantu nie ma. Teraz pokazują:
- listę kompletnych przebiegów tego rodzaju z linkami,
- albo napis „brak kompletnych przebiegów tego rodzaju w tej instalacji”.

Na kopii audytowej wynik to: `051f9b60, 4e8ff376, d935c03b, f4c9d3d5`.

**Czego nie zrobiłem.** Nie uruchomiłem rozszerzenia.
- Plan „JH16 + rozszerzenie SERP API” w kreatorze zużywa 160 kredytów SerpApi.
- Przy przyjętej cenie 0,014 € za zapytanie to ok. 2,24 €. Prawdziwej ceny Twoich kredytów nie znam.
- Bez tego luka w „Dowodach” na Twojej instalacji zostaje.

## 3. Linki do dowodów — poprawione

**Dowód.**
- `evidence_base_url` wskazywał gałąź `claude/jh16-hoffmann-test-20261025` (stary `config/replication/jh2016-dossier.json`, wiersz 10).
- Na tej gałęzi nie ma pliku `docs/history/evidence/2026-10-28-request-hoffmann/README.md`. Sprawdziłem `git ls-tree`.
- Ten plik jest dowodem przyczyny „Google przestał podawać szacunek…”, więc link w „Rozbieżnościach” i „Dowodach” dawał 404.
- Gałąź jest też ruchoma: może zniknąć albo się zmienić.

**Poprawka.**
- CR2014 wskazuje teraz commit `0743eb9393ef4ca935b690d4e1f81df62c4118d7` (obecny `main`).
- JH16 wskazuje commit `a4c9a6307e725121a14e771e89a2d621737a36e1` (pierwszy commit tej gałęzi). Zawiera on wszystko z `0743eb9` i dodatkowo nowy plik dowodu (sekcja 1). Commity PR pozostają dostępne.
- Test sprawdza, że każdy linkowany plik istnieje. Sprawdziłem też, że `0743eb9` jest przodkiem `a4c9a63`.
- Repozytorium jest publiczne, więc linki otworzą się bez konta.
- Test: „every file a dossier links to exists, and links point at one pinned commit”.

Zmiana działa po wdrożeniu nowej wersji. Wersja dossier: JH16 `2026-10-29-v3`, CR2014 `2026-10-29-v2`.

## 4. Pobrania przeliczeń — poprawione

**Dowód.**
- `results.json` podaje dla R1-recompute `9d80efca` `"fetches": 0`.
- Aneks projektu pracy podawał 32 (`docs/history/evidence/2026-10-28-request-hoffmann/manuscript.md`, wiersz 238).
- Kod: stary `replication_dossier.ts`, wiersz 138, liczył pobrania przebiegu źródłowego.

**Poprawka.** Aneks pokazuje teraz „0 (liczby z przebiegu e2aa7643: 32)”. Tabela „Dane” pokazuje „dane z e2aa7643: …”. To samo dotyczy przeliczeń kalibracji, np. „0 (liczby z przebiegu 19fe2736: 4)”.

## 5. „reproduced” bez definicji — poprawione

**Dowód.** W pracy (`manuscript.md`, wiersze 11 i 103–109) słowo „reproduced” stoi bez wyjaśnienia. Czytelnik może je wziąć za „replikacja potwierdzona”. Definicja była tylko w interfejsie, w „Przeglądzie”.

**Poprawka.** W sekcji „Metoda replikacji i odstępstwa” jest teraz akapit z definicjami (zgodnie z `docs/spec/08_REPLICATION_ENGINE.md`):
- „reproduced” oznacza wartość w paśmie ustalonym przed danymi;
- nie oznacza identyczności danych ani rozstrzygnięcia hipotezy;
- definicje mają też „deviates”, „not_computable” i „method_unclear”.

## 6. Późniejszy niekompletny pomiar — poprawione

**Dowód.**
- Na kopii z 28.10 streszczenie pracy podawało jako „nowy pomiar” przebieg `c17d1147` z 26.10 (`manuscript.md`, wiersz 15).
- Nowszy `ea2b7078` z 28.10 pojawiał się tylko w tabeli „Dane”.
- Ten nowszy pomiar jest niekompletny (khat) i nie ma werdyktu.

**Poprawka.** Gdy po ostatnim kompletnym pomiarze są nowsze niekompletne, streszczenie wymienia je z datą i brakami. Przykład: „Późniejsze nowe pomiary bez werdyktu (niekompletne dane): ea2b7078 (2026-10-28, braki: khat)”. Wniosek wskazuje też, którego przebiegu dotyczy odczyt.

## 7. Tabela kalibracji — poprawione

**Dowód.**
- Na kopii z 28.10 komórka WORLD A3b wynosi 1,000, a PL A4 0,800 (`manuscript.md`, wiersze 146–148).
- Według `replication.json` mają one n = 6 i n = 4.
- Porównano je z niekompletnym przebiegiem `ea2b7078`: `compare_run_id` w `run_52eedd1f.json`.
- Tabela nie pokazywała ani n, ani przebiegu porównania.

**Poprawka.**
- Każda komórka ma n.
- Doszła kolumna „Porównanie z przebiegiem”.
- Przebieg porównania jest w źródłach.
- Nad tabelą jest zdanie, że przy małym n wartość jest mało informatywna.

## 8 i 9. Dowód „rodzajem przebiegu” — poprawione

**Dowód.**
- Stary `evidence_graph.ts`, wiersz 69, uznawał za dowód każdy przebieg danego rodzaju, także niekompletny.
- Przykład: przerwane przez limit R2 `8d97fefd`/`4369e19e` (braki 8 i 12) zamknęłyby lukę „Region Google”.

**Poprawka.**
- Liczą się tylko przebiegi ukończone i kompletne. Funkcje: `completeRun` i `diagnosisEvidenceRuns`.
- Tę samą listę dostają projekt pracy i zakładka „Rozbieżności”: `diagnosis_evidence_runs` w `GET /api/replications/:id`.
- Test: „diagnosis evidence by kind of run counts only complete runs…”.

## 10. Tekst sprzeczny z późniejszymi wynikami — poprawione

- **Ograniczenie w dossier „Pomiar z jednego dnia”.**
  - Gdzie: stary `jh2016-dossier.json`, wiersz 184.
  - Czemu przeczy: istnieją pomiary z 26.10 (`c17d1147`, `51a9567b`) i 28.10 (`ea2b7078`).
  - Poprawka: zastąpione opisem trzech dni i niestabilności szacunków z 28.10.
- **`CALIBRATION.md`, wiersz 67: „Popularność da się więc nadal mierzyć liczbą wyników”.**
  - Czemu przeczy: 28.10 Spearman Pi wobec Tabeli 1 wynosi 0,019, a 14 z 32 liczb to wyniki osiągalne (`export_ea2b7078.json`, `raw/index_ea2b7078.json`).
  - Poprawka: dopisałem datowane uzupełnienie. Pierwotnego zdania nie zmieniłem, bo to zapis historyczny.
- **`REPORT.md`, sekcja 7.** Dopisałem uzupełnienie o pomiarach z 26 i 28.10 oraz link do tego dokumentu.

## 11. Język — częściowo poprawione

Poprawione:
- **Projekt pracy:**
  - kryteria: „przedział [0,7; 1]”, „dolny próg ≥ 0,6” zamiast „interval [0.7; 1]” i „rank_correlation_floor ≥ 0.6”;
  - flagi słowami, np. „Hi > 100%”, „liczba = wyniki osiągalne przez stronicowanie”, zamiast kodów;
  - stany „ukończony”/„nieudany” zamiast COMPLETED/FAILED;
  - przecinek dziesiętny w Hi, wcześniej „29.85”.
- **Interfejs:**
  - stan przebiegu w tabelach „Przebiegi”;
  - tekst luki „table N has no source” (`gapText`).

Zostaje, świadomie albo do decyzji:
- słowa werdyktów (`reproduced`, `deviates`) — to słownik z `08_REPLICATION_ENGINE.md`, teraz z definicją;
- klucze kryteriów (`harm_index_vs_reference_pearson`);
- identyfikatory wariantów (`gl-us`, `repeat-1`, `WORLD`);
- angielskie nazwy substancji (`query_label` z presetu);
- angielskie README w katalogach dowodów;
- nagłówki części ekranów (znane z `OWNER_TEST.md`, wiersz 89).

## 12. Raport zlecenia z tekstu — decyzja właściciela

**Dowód.**
- `docs/replication/REQUEST_HOFFMANN_2026-10-28/REPORT.md` jest w całości po angielsku. Cytat i reszta materiałów są po polsku.
- Raport zawiera uwagi wewnętrzne, nie dla prof. Hoffmanna:
  - „My mistake” o adresie e-mail w `mailto` (wiersz 63);
  - prośbę o cenę kredytów (wiersz 62);
  - założenia kosztowe.
- Liczby w nim są zgodne z danymi (patrz niżej).

**Status.** Nie przetłumaczono w tej gałęzi. Narzędzie tej sesji odrzuciło zapis nowego pliku raportu.

**Pytanie do Ciebie.** Co ma zobaczyć prof. Hoffmann?

Opcje:
- **A.** Ten raport bez zmian.
- **B.** Polskie tłumaczenie wiernie, w całości.
- **C.** Polskie tłumaczenie bez sekcji wewnętrznych (koszt, błąd z `mailto`, pytanie o cenę).
- **D.** Tylko zakładki w aplikacji, bez raportu.

## 13. Brak jako zero na wykresie — poprawione

**Dowód.** Stary `src/pages/Replications.tsx`, wiersz 131: `hi(r, 'pearson')?.value ?? 0`. Przebieg bez współczynnika dostawał słupek 0 z podpisem „0.00”.

**Poprawka.** Taki przebieg ma teraz napis „brak” i nie ma słupka.

## 14. Stany konta SerpApi — bieżący stan sprawdzony, dawne niezweryfikowane

**Bieżący stan, sprawdzony.**
- Źródło: `https://serpapi.com/account.json`. Ten endpoint nie zużywa kredytów.
- Odczytał go koordynator 2026-10-29T22:01:05Z.
- Stan:
  - plan „Free Plan”, 250 wyszukiwań miesięcznie;
  - wykorzystane w tym miesiącu: 250; zostało z planu: 0;
  - dodatkowe kredyty: **2530**;
  - łącznie do wykorzystania: **2521**.
- Zapis: `docs/history/evidence/2026-10-29-jh16-gaps/serpapi_balance_2026-10-29.json`. Zapisano tylko wybrane pola, bez surowej odpowiedzi, adresu e-mail i klucza.
- Agent nie wywoływał SerpApi.

**Dawne stany.** Wymienione niżej oznaczyłem w każdym raporcie datowaną uwagą „niezweryfikowane” ze wskazaniem na bieżący stan. Pierwotnego tekstu nie zmieniałem.


**Dowód.** W repozytorium nie ma zapisanego odczytu konta, który potwierdzałby te liczby (szukałem wartości w `docs/`):
- `REPORT.md`, wiersz 68: „zostało 2711”;
- `CALIBRATION.md`: „zostało 2661”;
- `OWNER_TEST.md`: „ok. 2645”;
- raport zlecenia: „2578”.

To dane operacyjne, nie naukowe, i prof. Hoffmann ich nie potrzebuje. Z `account.json` nie da się ich sprawdzić wstecz.

## 15. Ścieżki w pobranej pracy nie są linkami — nie zamknięte

W pobranym Markdown/HTML źródła-pliki to zwykły tekst. Przykład: `docs/replication/JH16_2026-10-25/CALIBRATION.md` w `manuscriptHtml`. W aplikacji przebiegi są linkami, pliki nie. Nic nie jest zepsute, ale czytelnik pliku HTML nie kliknie w dowód. Do zrobienia osobno, jeśli chcesz.

## Sprawdzone liczby — zgodne

Poniższe sprawdziłem skryptem na zapisanych plikach. Rozbieżności: 0.
- **`REPORT.md` §4 i najkrótsze podsumowanie** wobec `results.json`:
  - wszystkie wiersze tabeli zgodności: Pearson, p, Spearman Hi, Spearman Pi, werdykty;
  - zakresy −0,23…−0,10 i 0,71–0,88;
  - analizy bez alkoholu (−0,25…−0,05; R1 0,786) i bez liczb osiągalnych (−0,23…−0,10);
  - liczba naruszeń 2–6 na przebieg;
  - wszystkie 16 wierszy tabeli R3-faithful.
- **Wiersz „VM (po wdrożeniu)”** wobec `VM_smoke_faithful_export.json`: −0,234, −0,158 i 0,708.
- **T3 w §5** wobec `T3_or_decomposition_results.json`:
  - mephedrone 53 500 / 54 200 / 4 690 000;
  - methadone 5 630 000 / 306 000 / 3 020 000;
  - methamphetamine 10 300 000 wobec 10 400 000;
  - „87×” = 4 690 000 / 54 200 = 86,5.
- **„mediana zmienności 0,4%”** wobec `cross_runs.txt` („median CV 0.004”).
- **Przeliczenie publikacji z fixture:**
  - Pearson 0,81616, p 0,000115;
  - Spearman 0,5601 surowe i 0,5668 zaokrąglone (`PROTOCOL.md` podaje 0,560 i 0,567).
- **`CALIBRATION.md`:**
  - tabela A1–A4 wobec zapisów kalibracji;
  - wartości skryptu (0,948 / 0,850 / 0,754 / 0,818) wobec `independent/calibration_results.txt`.
- **Raport zlecenia wobec eksportów z 28.10:**
  - 0,8162 / 0,9993;
  - 15 z 16, khat „Fully empty”;
  - 0,377 (p 0,166), n = 15, werdykty `not_computable`;
  - 14 z 32 liczb poniżej 1000;
  - cannabis 63 wobec 134 000 000 w `c17d1147`;
  - A1 0,917 / 0,825 / 0,861 / 0,749.

## Testy

- **Nowe testy:**
  - 3 w `tests/integration/replication_dossier.test.ts`;
  - 2 w `tests/integration/jh16_estimator_consistency.test.ts`.
- **Wynik pełnego `npm run test:all`:** w opisie PR.
