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
| Google Trends 2012–2026 | Google Trends przez SerpApi, 17 żądań, 2026-10-25 | nowe pobranie danych historycznych |
| Europe PMC do 2014 i do 2026 | API Europe PMC, 64 zapytania, 2026-10-25 | nowe pobranie, inny korpus (literatura naukowa) |

## 1. Oryginalne dane Google autorów

Surowych danych autorów nie ma: publikacja nie ma materiałów uzupełniających. Archiwum Internet
Archive nie zawiera zapisanych stron wyników dla zapytań w cudzysłowie (sprawdzone dla 5 substancji
i domen google.com/google.pl, lata 2011–2015). Jedyny trafny zapis to strona Google z 2013-04-02 dla
`alcohol` **bez** cudzysłowu: „About 445,000,000 results”. To inne zapytanie, ale ten sam rząd
wielkości co 389 mln w Tabeli 1 (czerwiec 2014). Liczba nie pasuje natomiast do kolumn Tabeli 2
z lat 2012–2013 (42,6–68,4 mln); to zgodne z tym, że tamte kolumny są wyszukiwaniami ograniczonymi
datą, a nie stanem z danego dnia.

## 2. Google Trends (skala wspólna, kotwica „cocaine”, rzadkie hasła przez „methadone”)

| Analiza | Świat | US | GB | PL |
|---|---|---|---|---|
| A1: Trends, czerwiec 2014 vs Pi z Tabeli 1 (Spearman) | **0,948** | 0,850 | 0,754 | 0,818 |
| A2: zmiana 05.2012 → 06.2014, Trends vs Tabela 2 | 0,157 | 0,063 | −0,195 | 0,496 (n = 10) |
| A3: Trends, ostatnie 12 mies. vs nasze Pi 2026 (R3) | 0,594 | 0,538 | 0,624 | 0,750 |
| A3b: to samo bez 3 liczb „osiągalne wyniki” (n = 13) | 0,742 | 0,599 | 0,698 | 0,747 |
| A4: zmiana 2014 → 2026, Trends vs Pi (n = 13) | 0,544 | 0,516 | 0,209 | 0,345 |

Wnioski (eksploracyjne):

- **Ranking popularności z publikacji jest zgodny z niezależnymi danymi Google z tego samego okresu**
  (Spearman 0,95 na świecie). Dane wejściowe autorów dla Ni są więc wiarygodne co do rangi, choć
  dokładnych liczb nie da się sprawdzić.
- **Zmian w czasie z Tabeli 2 Trends nie potwierdza** (0,16). To spójne z ograniczeniem metody
  opisanym w protokole: Tabela 2 łączy wyszukiwania ograniczone datą z jednym nieograniczonym, więc
  nie mierzy zmian popularności.
- Nasze Pi z 2026 r. jest umiarkowanie zgodne z dzisiejszym Trends (0,59; 0,74 bez zapadniętych
  liczb). Popularność da się więc nadal mierzyć liczbą wyników, harm index — nie (REPORT.md).
- Trends nie kalibruje Hi: to inna wielkość, a zapytania typu „X harm” mają w Trends znikomą
  liczbę wyszukiwań.
- Powtórzone żądanie zwróciło identyczne wartości, więc szumu próbkowania Trends nie zmierzono
  (Google/SerpApi podają tę samą próbkę tego samego dnia). W PL pięć haseł jest poniżej
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

## Koszt

SerpApi: 18 kredytów z puli dokupionej na Google Trends (zostało 2693); łącznie dziś 250 darmowych
i 80 dokupionych. Europe PMC i Internet Archive są bezpłatne. OpenRouter i Google Cloud nie były
używane.

## Granice

- Google Trends nie jest częścią produktu: źródło `trends_interest_index` pozostaje `planned`,
  bo obserwacja WatchDoga nie ma jeszcze wymiaru czasu (wiele wartości na substancję).
  Kalibrację wykonano skryptem z zapisanymi surowymi odpowiedziami i hashami
  (`docs/history/evidence/2026-10-25-jh16/independent/`).
- Surowe odpowiedzi Trends (dane Google przez SerpApi) zostają na VM w
  `~/wt/jh16_audit_2026-10-25/independent/trends_raw/`. Ich sha256 są w `trends_fetch_log.json`.
