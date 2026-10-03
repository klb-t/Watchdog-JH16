# G1 — pilot liczenia pochodzenia: ukończony

Status: **completed, synthetic-only, research artifact**. Wykonano 96 syntetycznych korpusów (12 seedów × 8 scenariuszy), porównano 3 metody i zachowano wszystkie 288 wyników. **7/7 testów przeszło**, w tym ponowne wygenerowanie wszystkich deterministycznych bajtów.

Wynik: liczba dokumentów i liczba różnych treści nie są liczbą niezależnych źródeł. Znane pochodzenie usuwa ten problem wyłącznie w zakresie jakości dostarczonych metadanych. Błędne pochodzenie daje błędy w obu kierunkach. To demonstracja kontraktu na jawnie skonstruowanych danych; nie eksperymentalny dowód, że można rozpoznać niezależność rzeczywistych publikacji.

## Dane i kolejność

- Baza produktu: `61daefd82cc778e28d2d3868eaaf0689d856fc49`.
- Źródło pytania: `docs/PARALLEL_RESEARCH_GPT.md`, G1, na powyższej bazie. Nie korzystano z zewnętrznych danych ani prywatnych rozmów.
- `protocol.json` zapisano przed kodem generatora i wynikami: 2026-10-02 09:57:06 UTC; SHA-256 `62d09d35ea5b9d66a8bb40f9d364a30d9e0f9fd2a5fa26863b859fc1a0f08f00`.
- Run badawczy: 2026-10-02 09:59:25 UTC; następnie testy i oddzielne odtworzenie w nowym katalogu. Brak nieudanego runu i brak zmian zamrożonego protokołu.
- Kolejność jest zapisem lokalnym, bez niezależnego poświadczenia czasu. Nie nazywamy jej zewnętrzną prerejestracją.
- Tożsamość kodu określają hashe wejść w `raw/receipt.json`; tożsamość publikacji określa commit gałęzi badawczej zawierający ten pakiet i zewnętrzny receipt koordynatora. Nie wpisujemy fikcyjnego SHA przyszłego commitu do jego własnej treści. Pole `artifact_head` w receipt jest historycznym stanem z chwili runu.

Każdy korpus ma **12 niezależnych początków wyłącznie z definicji generatora**. Dokument zawiera tekst, `truth_origin` i osobne `observed_lineage`. Algorytmy otrzymują wyłącznie obserwowalne pola; prawda generatora trafia do ewaluatora. Kontrole błędnych metadanych zachowują dokładnie ten sam tekst, identyfikatory i prawdę co scenariusz `mixed`.

## Wyniki

Liczba zgłoszonych grup; wartość to średnia z 12 seedów, a zakres pojawia się przy zmienności. Prawda generatora wynosi 12 w każdym wierszu. Brak zmienności większości wierszy wynika ze stałej konstrukcji; nowe seedy zmieniają tekstowe identyfikatory i losowaną brakującą metadokumentację, nie tworzą niezależnej walidacji modelu świata.

| Scenariusz | Dokumenty jako grupy | Dokładny hash treści | Deklarowane pochodzenie |
|---|---:|---:|---:|
| independent_unique | 12 | 12 | 12 |
| shared_exact | 60 | 12 | 12 |
| shared_paraphrase | 60 | 36 | 12 |
| independent_identical | 12 | 9 | 12 |
| mixed | 36 | 21 | 12 |
| mixed_missing_lineage | 36 | 21 | 27.75 (24–31) |
| mixed_false_merge | 36 | 21 | 9 |
| mixed_false_split | 36 | 21 | 24 |

W scenariuszu `mixed` hash daje 21 grup zamiast 12. Ten błąd netto +9 ukrywa **12 nadmiarowych zliczeń tego samego pochodzenia** i **3 scalenia niezależnych pochodzeń**. Dlatego `double_count_excess` i `collapse_excess` są oddzielne; ich różnica dokładnie równa się błędowi liczby grup. `collapse_excess` opisuje nadmiar pochodzeń wewnątrz grup, nie utraconą liczbę dokumentów. Zachowano też liczbę różnych par niezależnych pochodzeń połączonych w jedną grupę.

Kontrprzykład `independent_identical` zawiera trzy pary niezależnych początków o identycznym tekście. Hash zgłasza 9 grup, a nie 12. `shared_paraphrase` zawiera pięć dokumentów na pochodzenie, korzystających z trzech zapisanych wariantów sformułowania: hash pozostawia 36 grup. Parafrazy są szablonami syntetycznymi, nie materiałem ocenionym przez niezależnych ludzi ani LLM.

Poprawne deklarowane pochodzenie daje dokładny wynik, ponieważ dostarczono mu poprawną etykietę. **Jest to kontrola z dostarczoną prawdą, a nie wykazanie przewagi metody odkrywania pochodzenia.** Braki etykiet powodują 24–31 grup. Fałszywe scalenia dają 9, fałszywe rozdzielenia 24. Żadna metoda nie otrzymuje gwarancji poprawności dla rzeczywistego nieznanego pochodzenia.

## Koszt i granice

Wszystkie metody odwiedzają każdy dokument raz; raw wynik podaje osobno liczbę odwiedzonych dokumentów, bajtów hashowanych przez SHA-256 i przechowywanych kluczy grup. To proste liczniki pracy, nie pełny model pamięci ani koszt wydobywania pochodzenia.

Cały deterministyczny generator i ewaluator: 0.035545 s wall, 0.035546 s CPU w tym runie. Środowisko: CPython 3.12.14, Linux x86_64, standard library, bez zewnętrznych pakietów. Wywołania sieci/API: 0, płatne wywołania: 0, wydatki API: 0 EUR. Czas nie obejmuje uzyskania rzeczywistych metadanych i nie jest benchmarkiem produkcyjnym.

Nie zmieniono JH16, produktu ani reguł oceny rzeczywistych źródeł. Nie badano sprzecznych twierdzeń, niezależności statystycznej, wspólnego ukrytego sponsora, zależności tematycznej, grafów wielu rodziców ani odzyskiwania pochodzenia z tekstu. Wspólna etykieta jest uproszczeniem do jednej grupy; brak etykiety pozostaje osobnym dokumentem, nie dowodem niezależności.

## Odtworzenie offline

Z katalogu głównego repozytorium:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 research/gpt-20261002/g1/test_replay.py
```

Test czyta zamrożony protokół, odtwarza `datasets.jsonl`, `results.jsonl` i `summary.json` dwukrotnie i porównuje bajt po bajcie z archiwum. Sprawdza SHA-256 kodu/protokołu/testu, hashe wyników, pełne pokrycie kombinacji oraz osobne małe kontrprzykłady. Trzy warianty uszkodzenia lineage mają identyczny materiał bazowy. `raw/receipt.json` i log testu zawierają rzeczywiste czasy, które z definicji nie są deterministycznym wynikiem.

Nowy osobny run, bez nadpisywania archiwum:

```bash
PYTHONDONTWRITEBYTECODE=1 python3 research/gpt-20261002/g1/run.py --output /tmp/watchdog-g1-replay-new
cmp research/gpt-20261002/g1/raw/datasets.jsonl /tmp/watchdog-g1-replay-new/datasets.jsonl
cmp research/gpt-20261002/g1/raw/results.jsonl /tmp/watchdog-g1-replay-new/results.jsonl
cmp research/gpt-20261002/g1/raw/summary.json /tmp/watchdog-g1-replay-new/summary.json
```

Ścieżka wyjściowa musi nie istnieć. Generator odmawia nadpisania istniejącego runu. Dla zgodności bajtowej użyj przypiętej linii CPython 3.12; receipt zapisuje dokładną wersję. Hashe wszystkich plików pakietu poza samym manifestem znajdują się w `manifest.json`.

## Do rozpatrzenia przez Claude’a

Ewentualny przyrost produktu powinien zachowywać osobno liczby dokumentów, unikatowych treści, zadeklarowanych grup pochodzenia oraz braków/konfliktów metadanych. Nie proponujemy jednego automatycznego „confidence score”. Dołączenie małego adaptera wymaga oddzielnego odbioru kontraktu przez prowadzącego; ten pilot sam nie upoważnia do naukowej aprobaty ani zmiany głównej metody.
