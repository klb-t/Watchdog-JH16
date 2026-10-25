# Test właściciela — JH16 w WatchDogu (przygotowane 2026-10-25)

Wyniki i ocena, które ten test ma sprawdzić: [REPORT.md](REPORT.md).

## Dostęp

| | |
|---|---|
| Adres | https://watchdog.34-158-117-249.sslip.io |
| Logowanie | użytkownik `marcin`, hasło Caddy: na VM `sudo bash ~/chatadhd/tools/gcp/aliases.sh --show-pass` |
| Wersja kodu | `84a9e71` (gałąź `claude/jh16-hoffmann-test-20261025`); widoczna w każdym przebiegu i manifeście jako `git_commit` |
| Obraz | `watchdog:84a9e71…` na VM; poprzednie (`10744c9`, `e33504e`, `c3508c16`) zachowane do cofnięcia |
| Kopie danych sprzed aktualizacji | `/var/backups/watchdog/watchdog-data-before-e33504e…-20261025T125242Z.tar.gz` (sha256 `504e329b…17b8`) `…before-10744c9…-20261025T143201Z.tar.gz` (sha256 `d3c1cf3d…04e0`) i `…before-84a9e71…-20261025T162352Z.tar.gz` (sha256 `43323380…1737`), z kopiami `release.env` |
| Klucz SerpApi | zapisany w Twoim zaszyfrowanym sejfie w WatchDogu (Ustawienia → krok 1 pokazuje „serpapi: zapisany”) |

Każdy nowy pomiar (32 zapytania) zużywa kredyty SerpApi z Twojego konta: darmowy limit
października jest już wyczerpany, zostało ok. 2645 dokupionych kredytów (stan konta 25.10, 16:30 UTC). Plan z rozszerzeniem
zużywa 160.

## Wdrożenie (2026-10-25 12:52 UTC)

Obraz `watchdog:e33504edfdb71050d9cc6c3da2435562ffee0494` (id `sha256:f7b51bd2…c647`) zbudowano
z tym samym Dockerfile co poprzednio; w trakcie budowy przeszło 622/622 testów. Zmieniono tylko
`WATCHDOG_IMAGE`/`WATCHDOG_COMMIT` w `/etc/watchdog/release.env`; jednostka systemd, Caddy, zapora
i tryb lokalnego właściciela bez zmian. Baza przeszła migracje 020–023 przy starcie.

Test dymny po wdrożeniu, tą samą ścieżką: przeliczenie historyczne `0e5ed635` (Pearson 0,8162,
oba werdykty „reproduced”) i nowy pomiar `b14ccbaa` przez kreator (16/16, Pearson −0,234,
Spearman Pi vs Tabela 1 0,708); oba zgodne z niezależnym skryptem. Te dwa przebiegi widzisz
na liście „Uruchomienia”.

Cofnięcie: `sudo systemctl stop watchdog`, przywróć `release.env.before-…` do `/etc/watchdog/release.env`,
rozpakuj kopię danych do `/var/lib` (stara wersja nie zna migracji 020–023, więc wymaga starej bazy),
`sudo systemctl start watchdog`.

Druga aktualizacja (2026-10-25 14:32 UTC) do `10744c9`: Google Trends jako źródło i kalibracja w
kreatorze (626/626 testów w buildzie). Test dymny: kalibracja „cały świat” `af61af36` porównana z
`b14ccbaa`, A1 = 0,923, niezależny skrypt bez rozbieżności.

Trzecia aktualizacja (16:24 UTC) do `84a9e71`: „Replikacje” w aplikacji i projekt pracy
(629/629 testów w buildzie). Na VM dodano kalibrację dla US, GB i PL (`32c2c4be`, `8e45b9f9`,
`08701e76`; skrypt bez rozbieżności) i przejrzano wszystkie zakładki na komputerze i telefonie
(bez błędów strony i przewijania w bok).

## Gotowa konfiguracja

- preset wierny: `config/presets/jh2016-faithful.json` (zablokowany, 16 substancji, 32 zapytania);
- rozszerzenie SERP API: `config/presets/jh2016-serp-extension.json` (2 powtórzenia, gl=us, gl=pl);
- kryteria oceny: `config/replication/jh2016.json` i `config/replication/jh2016-interpretation.json`;
- dostawca: `config/providers/search_result_count.json` (Google przez SerpApi, `safe=off`);
- kalibracja: `config/calibration/jh2016-trends.json`, dostawca Trends `config/providers/trends_interest.json`.

## Test przez aplikację (ok. 15 minut, działa z telefonu)

Wszystko poniżej robisz w aplikacji; pliki w repozytorium są tylko kopią.

**A. Przegląd replikacji (bez kosztu)**
1. Menu → „Prace i replikacje” → **„Replikacje”** → kafel „Can Google Searches Predict…”.
2. **Przegląd:** hipotezy H-harm i H-pop, tabela werdyktów najnowszych kompletnych przebiegów
   każdego rodzaju z kolorową etykietą pochodzenia liczb („Przeliczenie danych z publikacji”,
   „Nowe pobranie”, „Przeliczenie zapisanych danych”, „Kalibracja”), ocena i odstępstwa od metody.
   Oczekiwane: przeliczenie danych z publikacji daje 0,816 i „reproduced”, nowe pobranie Pearson
   ujemny i „deviates”.
3. **Przebiegi:** filtry rodzaju i „tylko kompletne”. Zaznacz dwa przebiegi JH16 → porównanie
   z wykresem Pearsona i tabelą Hi/Pi każdej substancji. Kliknij substancję (np. heroin) →
   wysłane zapytania, liczby, flagi i link „pobierz” do surowej odpowiedzi dostawcy.
4. **Rozbieżności:** przyczyny ze statusem (wykazana / prawdopodobna / nierozstrzygnięta / wykluczona)
   i dowodami. **Kalibracja:** A1–A4 dla 4 regionów. **Rejestr kryteriów:** progi ustalone przed
   danymi, commit prerejestracji, sha256 konfiguracji.
5. **Projekt pracy:** praca złożona z zapisanych wyników (streszczenie, hipotezy, metody,
   odstępstwa, dane i pochodzenie, wyniki, porównanie, kalibracja, rozbieżności, ograniczenia,
   wnioski, aneks odtwarzalności). Pod każdym blokiem jest źródło z linkiem do przebiegu.
   „Pobierz Markdown” / „Pobierz HTML”.

**B. Nowe pomiary (kredyty SerpApi)**
6. Ustawienia → kreator. Krok 1: „serpapi: zapisany” i, w trybie „Standardowy”, dzienny limit
   SerpApi. Krok 2: „Punkt odniesienia” → „JH16: nowe pomiary przez własny SerpApi” (32 kredyty)
   albo „JH16 + rozszerzenie SERP API” (160); opcjonalnie zaznacz regiony w „Kalibracja przez
   Google Trends” (4 kredyty na region). Odznacz „Zasil kartoteki” i „Przejrzyj arXiv…”, jeśli
   nie chcesz dodatkowych zadań. Krok 3 pokazuje metodę, liczbę zapytań, limit i przebieg, z którym
   nastąpi porównanie kalibracji. „Zezwól i uruchom”.
7. Po ok. minucie wróć do **Replikacje → JH16**: nowy przebieg jest w „Przebiegach” i w
   „Przeglądzie”, a „Projekt pracy” zawiera jego liczby. Konkretne wartości będą trochę inne niż
   25.10, bo Google zmienia szacunki i próbkę Trends.
8. **Ustawienia działają:** ustaw dzienny limit poniżej liczby zapytań planu → krok 3 pokazuje
   „Limit nie wystarczy”, a uruchomienie jest odrzucone bez wysłania zapytań.

**C. Kontrola niezależna (opcjonalnie, na VM)**
9. Z wyników przebiegu pobierz „JSON” i uruchom
   `python3 -I scripts/verify_jh16_run.py pobrany.json` (kod wyjścia 0 = zgodne). Dla kalibracji:
   `python3 -I scripts/verify_trends_calibration.py eksport.json run.json` (run.json z
   `/api/runs/<id>`).

Ustawienia kroku 2 (języki, geografia, slang, sentyment) zapisują plan eksploracyjny; nie zmieniają
zablokowanego przebiegu JH16 — kreator mówi to wprost.

## Czego nie sprawdzono

Lista w [REPORT.md, sekcja 7](REPORT.md#czego-jeszcze-nie-zweryfikowano).
