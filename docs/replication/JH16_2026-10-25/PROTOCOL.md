# JH16 — przyspieszona replikacja przed testem właściciela: protokół (prerejestracja)

Zapisano 2026-10-25, **przed** pobraniem jakichkolwiek nowych danych w tym badaniu. Commit, który
wprowadza ten plik, jest zapisem prerejestracji; zmiana kryteriów po zobaczeniu wyników wymaga
nowej, widocznej wersji tego pliku z powodem.

Źródło metody: Jankowski W, Hoffmann M. *Can Google Searches Predict the Popularity and Harm of
Psychoactive Agents?* J Med Internet Res 2016;18(2):e38, doi:10.2196/jmir.4033. Tekst odczytany
z Europe PMC (PMC4786686, pełny JATS XML, sha256
`28f9df3ac7561f96fcd765bf5a81cfc6fe3434777ecc3148d84abf69d4bbf2b7`, pobrany 2026-10-25).

## 1. Co replikujemy

### Cel i hipotezy publikacji

Cel (Objective): „zaproponować szybką metodę rangowania najpopularniejszych i najbardziej
szkodliwych substancji na podstawie łatwo dostępnych danych z internetu”. Publikacja nie formułuje
hipotez testowalnych wprost; z wyników i wniosków odtwarzamy dwie:

- **H-harm (główna, ilościowa).** Wskaźnik szkodliwości `Hi = Ni_harm / Ni × 100%` z liczby
  wyników Google koreluje dodatnio i istotnie z ekspercką oceną szkodliwości Nutt i in. 2010
  (MCDA, 16 substancji). Wynik publikacji: współczynnik 81,6%, p = 0,000143, α = 0,01, n = 16.
- **H-pop (opisowa).** Liczba wyników `Ni` daje ranking popularności `Pi = Ni / max(Ni) × 100%`;
  autorzy porównują go jakościowo z raportami UNODC 2011 i EMCDDA 2014. Brak liczbowego kryterium
  zgodności w publikacji — nie da się go testować tak samo; testujemy tylko stabilność rankingu
  względem Tabeli 1 (kryterium z rejestru, niżej).

Twierdzenie o monitorowaniu trendów (Tabela 2, wyszukiwania ograniczone datą) **nie jest
replikowane**: Google nie udostępnia przez SerpApi tej samej wstecznej daty indeksu, a sama Tabela 2
łączy pięć zapytań ograniczonych datą z jednym nieograniczonym (max(Ni) skacze z 85,6 mln do
389 mln) — kolumny nie są wzajemnie porównywalne.

### Operacjonalizacja (z publikacji)

| Element | Publikacja | W WatchDogu |
|---|---|---|
| Substancje | 16 (lista Nutt et al. bez dwóch nazw wielowyrazowych, tytoniu i grzybów) | `config/presets/jh2016-faithful.json`, zablokowany |
| Zapytanie popularności | nazwa w cudzysłowie | `"{query_label}"` |
| Zapytanie szkodliwości | `"alcohol" "harm" OR "harmful"` | `"{query_label}" "harm" OR "harmful"` |
| Etykiety | GHB, LSD skrótem w tabelach | `query_label` GHB, LSD (kanoniczne nazwy pełne) |
| Wyszukiwarka | Google, SafeSearch off | Google przez SerpApi, `safe=off` |
| Miara | „frequency of hits” (szacunek liczby wyników) | `search_information.total_results` |
| Data | 2014-06-20 | data pobrania zapisana w surowej odpowiedzi |
| Analiza | korelacja Hi z Nutt 2010 | Pearson i Spearman, n, p dwustronne (t, n−2) |

### Czego publikacja nie określa (braki zapisane jawnie, nie dopowiadane)

1. **Region, domena i język interfejsu Google** — nie podano (autorzy z Poznania; mogło to być
   google.pl lub google.com). Wariant wierny używa domyślnych ustawień dostawcy z `hl=en`
   i zapisuje faktyczne `google_domain`/`gl`, które dostawca zwraca. Region jest analizowany
   w rozszerzeniu jako czynnik, a nie dobierany do wyniku.
2. **Rodzaj korelacji** — proza mówi o „ranking”, ale 81,6% odpowiada Pearsonowi na surowych Hi
   (0,8162), a nie Spearmanowi (0,560 na surowych, 0,567 na zaokrąglonych). Raportujemy oba;
   kryterium główne pozostaje Pearson, jak w rejestrze z 2026-08-18.
3. **Test istotności** — podane p = 0,000143 nie wynika ze standardowego testu t dla r = 0,8162,
   n = 16 (daje 0,000115). Nie wiadomo, jakiego testu użyto; to rozbieżność opisowa, nie kryterium.
4. **Jednorazowy pomiar** — publikacja nie podaje powtórzeń ani zmienności szacunku Google.

## 2. Warianty

- **R-hist — ponowne przeliczenie danych historycznych.** Liczby z Tabel 1 i 3 (zamrożone
  w `fixtures/jh2016/faithful_2014-06-20`) przez normalny przepływ produktu. Sprawdza obliczenia.
  Nie jest niezależną replikacją (`pipeline_self_check`).
- **R-faithful — nowe pobranie, metoda wierna.** 32 zapytania zablokowanego presetu przez SerpApi
  (Google), `safe=off`, `hl=en`, bez dodatkowych parametrów. Wynik współczesny: nie odtwarza
  historycznego zbioru z 2014 r., testuje, czy ta sama procedura dziś daje ten sam związek
  (`independent_attempt`, czasowa ponowna ocena).
- **R-ext — rozszerzenie oparte na SERP API (wariant ENHANCED, nigdy „replikacja”).** Te same
  zapytania i wzory; zmienia wyłącznie warunki pomiaru, każda zmiana wyliczona w presecie:
  1. powtórzenie pomiaru wiernego (2 dodatkowe przebiegi, `no_cache`) — zmienność szacunku;
  2. jawna geografia Google: `gl=us` (google.com) oraz `gl=pl` (google.pl) — wrażliwość na region;
  3. audyt pól dostawcy: dla każdej odpowiedzi zapis `total_results` (szacunek wszystkich wyników)
     obok liczby zwróconych rekordów `organic_results` (zawsze ≤ ok. 10 na stronę) — te dwie
     wielkości nie są wymienne i druga nigdy nie wchodzi do Pi/Hi.

Budżet: R-faithful 32 + R-ext 2×32 + 2×32 = 160 zapytań, w darmowym planie (250/mies.).
Ponowny przebieg po poprawkach programu może dodać do 32.

## 3. Kryteria oceny (ustalone przed danymi)

Kryteria główne są te z rejestru `config/replication/jh2016.json` (wpisane 2026-08-18, commit
`2e417c6`), **bez zmian**:

| Twierdzenie | Statystyka | Kryterium „reproduced” |
|---|---|---|
| `harm_index_vs_reference_pearson` | Pearson Hi vs Nutt 2010, n = 16 | r ∈ [0,70; 1,0] |
| `popularity_ranking_stability` | Spearman Pi vs Pi z Tabeli 1 | ρ ≥ 0,60 |

Dodatkowe zasady interpretacji (nowe, ustalone teraz, przed danymi):

- **Kompletność.** Werdykt liczony jest tylko przy n = 16 ważnych par. Przy n < 16 werdykt
  głównego twierdzenia to `not_computable` z listą brakujących substancji; wartości przy n < 16
  są opisowe.
- **Wsparcie hipotezy H-harm** (odpowiedź na „czy nowe dane wspierają hipotezę”):
  *wspierają*, gdy Pearson ≥ 0,70 **i** p dwustronne < 0,01 (α autorów);
  *przeczą*, gdy Pearson < 0,62 (próg istotności dla α = 0,01, n = 16) **i** Spearman < 0,50;
  w pozostałych przypadkach *nie rozstrzygają*.
- **Wrażliwość (eksploracyjna, osobno oznaczona):** korelacja bez alkoholu (n = 15), bo alkohol
  dominuje Pearsona; zmienność między powtórzeniami; różnica gl=us vs gl=pl. Nie zmienia werdyktu.
- **Zgodność wartości punktowych** Pi/Hi z publikacją: tylko opisowo (odchylenia dla każdej
  substancji), bez werdyktu — zgodnie z rejestrem (brak obronnej tolerancji).
- **Rozbieżności** klasyfikowane jako wykazane / prawdopodobne / nierozstrzygnięte; test
  rozróżniający jest wymieniony przy każdej.

## 4. Zasady wykonania

- Wszystkie pomiary przez produkt (kreator lub API uruchomień), nie przez osobny skrypt.
  Skrypty pomocnicze tylko do niezależnej weryfikacji obliczeń (`scripts/verify_jh16_run.py`).
- Surowe odpowiedzi dostawcy archiwizowane bajtowo (WORM), hash w manifeście; klucz nigdy nie
  trafia do zapisu.
- Przebieg sprzed poprawek programu zostaje zachowany; poprawiony przebieg jest nowym przebiegiem
  z podanym powodem. Ponowne przeliczenie utrwalonych obserwacji jest oznaczone jako takie i
  odróżnione od nowego pobrania.
