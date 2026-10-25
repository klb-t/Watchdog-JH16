# JH16 — niezależne dane i kalibracja (uzupełnienie, 2026-10-25)

Zadanie od właściciela: nie opierać oceny wyłącznie na liczbach z publikacji. Spróbować znaleźć w
sieci dane Google z tamtego okresu i skalibrować wyniki m.in. przez Google Trends. Wszystko tutaj ma
charakter **eksploracyjny** (bez werdyktów): plan zapisano przed pobraniem
(`docs/history/evidence/2026-10-25-jh16/independent/CALIBRATION_PLAN.md`). Google Trends mierzy
względne zainteresowanie wyszukiwaniem, **nie liczbę wyników**, więc nigdy nie zastępuje Ni.

## Skąd pochodzi każda liczba

| Rodzaj | Źródło | Status |
|---|---|---|
| Przeliczenie danych autorów | Tabele 1–3 publikacji, przez produkt (R-hist) | przeliczenie, nie pomiar |
| Nowe liczby wyników 2026 | Google przez SerpApi, przez produkt (R1, R3, VM) | nowe pobranie ([REPORT.md](REPORT.md)) |
| Historyczna strona Google 2013 | Internet Archive, zapis z 2013-04-02 | niezależny dokument historyczny |
| Google Trends 2012–2026 | źródło WatchDoga `trends_interest_index` (16 żądań, 4 regiony) oraz osobno skrypt (17 żądań), 2026-10-25 | nowe pobranie danych historycznych |
| Europe PMC do 2014 i do 2026 | API Europe PMC, 64 zapytania, 2026-10-25 | nowe pobranie, inny korpus (literatura naukowa) |

## 1. Oryginalne dane Google autorów

Surowych danych autorów nie ma: publikacja nie ma materiałów uzupełniających. Archiwum Internet
Archive nie zawiera zapisanych stron wyników dla zapytań w cudzysłowie (sprawdzone dla 5 substancji
i domen google.com/google.pl, lata 2011–2015). Jedyny trafny zapis to strona Google z 2013-04-02 dla
`alcohol` **bez** cudzysłowu: „About 445,000,000 results”. To inne zapytanie, ale ten sam rząd
wielkości co 389 mln w Tabeli 1 (czerwiec 2014). Liczba nie pasuje natomiast do kolumn Tabeli 2
z lat 2012–2013 (42,6–68,4 mln); to zgodne z tym, że tamte kolumny są wyszukiwaniami ograniczonymi
datą, a nie stanem z danego dnia.

## 2. Google Trends — w produkcie

Od commita `7c082f5` Google Trends jest źródłem WatchDoga (`trends_interest_index`, SerpApi
google_trends, `config/providers/trends_interest.json`). Obserwacje mają okres, którego dotyczą
(`observedAt`), i flagę `RELATIVE_INTEREST_NOT_A_COUNT`. Metoda kalibracji
`jh16_trends_calibration` czyta grupy, kotwice, okna i analizy z
`config/calibration/jh2016-trends.json`. Uruchamia się ją z kreatora (krok 2, „Kalibracja przez
Google Trends”), jeden przebieg na region. Porównanie dotyczy ostatniego ukończonego nowego pomiaru
JH16 (tu R3-faithful `2e701755`).

Wyniki z produktu (pobranie 2026-10-25 14:20:35–14:20:49 UTC, kod `7c082f5`; po poprawce remisów
przeliczone z zapisanych obserwacji kodem `dbc8a0c`, bez ponownego pobierania). Niezależny skrypt
`scripts/verify_trends_calibration.py`, liczący z eksportu bez kodu WatchDoga, daje 0 rozbieżności
we wszystkich regionach.

| Analiza (Spearman) | Świat `787d429f` | US `4cfb78ac` | GB `c0157fed` | PL `a26c2c78` |
|---|---|---|---|---|
| A1: Trends, czerwiec 2014 vs Pi z Tabeli 1 | **0,893** | 0,859 | 0,744 | 0,818 |
| A2: zmiana 05.2012 → 06.2014, Trends vs Tabela 2 | −0,091 | 0,059 | −0,138 | 0,443 (n = 10) |
| A3: Trends, ostatnie 12 mies. vs nasze Pi 2026 (R3) | 0,594 | 0,532 | 0,624 | 0,750 |
| A3b: to samo bez 3 liczb „osiągalne wyniki” (n = 13) | 0,742 | 0,599 | 0,698 | 0,747 |
| A4: zmiana 2014 → 2026, Trends vs Pi (n = 13) | 0,549 | 0,501 | 0,212 | 0,345 (n = 10) |

Wcześniejszy skrypt na osobnym pobraniu (12:5x UTC, [wyniki](../../history/evidence/2026-10-25-jh16/independent/calibration_results.txt))
dał A1 = 0,948 / 0,850 / 0,754 / 0,818. Różnica wynika z danych, nie z obliczeń: Google Trends
przy każdym pobraniu losuje próbkę. Między dwoma pobraniami odległymi o 1,5 h różniło się 624 z 3560
wartości, zwykle o 1 punkt. Przy rzadkich hasłach (wartości poniżej 1–5) przesuwa to rangi.
Kierunek wniosków jest więc stabilny, druga cyfra po przecinku nie.

Wnioski (eksploracyjne):

- **Ranking popularności z publikacji jest zgodny z niezależnymi danymi Google z tego samego okresu**
  (Spearman 0,89–0,95 na świecie, zależnie od próbki Trends). Dane wejściowe autorów dla Ni są więc wiarygodne co do rangi, choć
  dokładnych liczb nie da się sprawdzić.
- **Zmian w czasie z Tabeli 2 Trends nie potwierdza** (−0,09 do 0,16 na świecie). To spójne z ograniczeniem metody
  opisanym w protokole: Tabela 2 łączy wyszukiwania ograniczone datą z jednym nieograniczonym, więc
  nie mierzy zmian popularności.
- Nasze Pi z 2026 r. jest umiarkowanie zgodne z dzisiejszym Trends (0,59; 0,74 bez zapadniętych
  liczb). Popularność da się więc nadal mierzyć liczbą wyników, harm index — nie (REPORT.md).
- Trends nie kalibruje Hi: to inna wielkość, a zapytania typu „X harm” mają w Trends znikomą
  liczbę wyszukiwań.
- Szum próbkowania Trends: powtórzenie w tej samej minucie dało identyczne wartości, ale pobranie
  1,5 h później różniło się w 17,5% wartości (patrz wyżej). W PL pięć haseł jest poniżej
  rozdzielczości Trends w czerwcu 2014 r.

## 3. Europe PMC — ten sam wskaźnik w wyszukiwarce liczącej spójnie

Hi_lit = liczba prac z `"X" AND ("harm" OR "harmful")` / liczba prac z `"X"`. Europe PMC liczy
dokładnie, więc nie łamie logiki zbiorów (0 naruszeń; Hi 3–27% do 2014 r., 9–38% do 2026 r.).

| Okres | Pearson Hi_lit–Nutt (p) | Spearman (p) | bez alkoholu: Pearson / Spearman |
|---|---|---|---|
| publikacje do 2014 | 0,073 (0,79) | 0,090 (0,74) | 0,389 / 0,258 |
| publikacje do 2026 | 0,031 (0,91) | 0,097 (0,72) | 0,364 / 0,215 |

To inny korpus niż Google (w literaturze o heroinie i metadonie dominuje „harm reduction”, a
„LSD” trafia też na test statystyczny o tym skrócie), więc nie jest replikacją. Pokazuje jednak, że
przy spójnym liczniku sam pomysł „udziału stron ze słowem harm” nie odtwarza oceny ekspertów.
Wysoka korelacja z 2014 r. mogła więc zależeć od konkretnego stanu Google i od alkoholu
(bez alkoholu: 0,72 na danych autorów).

## Wady znalezione przez przebieg kalibracji w produkcie (poprawione)

| Wada | Skutek | Commit |
|---|---|---|
| zapis 3560 obserwacji jednym poleceniem przekraczał limit zmiennych SQLite | pierwsze 4 przebiegi FAILED („too many SQL variables”); 16 zapytań wysłanych, surowe odpowiedzi zarchiwizowane | `7c082f5` |
| Spearman rozróżniał wartości równe matematycznie, a różne w ostatnim bicie (7/9 liczone dwiema drogami) | GB A4 0,2143 w produkcie vs 0,2088 w skrypcie; wykryte przez niezależną kontrolę | `dbc8a0c` |
| panel kalibracji wywracał stronę dla przeliczenia bez własnych parametrów źródła | pusta strona wyników | `10744c9` |

Test zapisu używa teraz pełnego okna 178 miesięcy i bez poprawki odtwarza błąd.

## Koszt

SerpApi: 18 kredytów (skrypt) i 32 (produkt: 16 w nieudanej pierwszej próbie, 16 w udanej) na
Google Trends. Łącznie dziś 250 darmowych zapytań i 112 dokupionych kredytów; zostało 2661.
Europe PMC i Internet Archive są bezpłatne. OpenRouter i Google Cloud nie były używane.

## Granice

- Kalibracja jest eksploracyjna i nie daje werdyktów. Trends nigdy nie zastępuje Ni ani Hi.
- Skrypt ze ścieżki `docs/history/evidence/2026-10-25-jh16/independent/` jest niezależną kontrolą
  na osobnym pobraniu; jego surowe odpowiedzi zostają na VM w
  `~/wt/jh16_audit_2026-10-25/independent/trends_raw/` (sha256 w `trends_fetch_log.json`).
  Eksporty i weryfikacje przebiegów produktu: `docs/history/evidence/2026-10-25-jh16/trends_product/`.
