# Test właściciela — JH16 w WatchDogu (przygotowane 2026-10-25)

Wyniki i ocena, które ten test ma sprawdzić: [REPORT.md](REPORT.md).

## Dostęp

| | |
|---|---|
| Adres | https://watchdog.34-158-117-249.sslip.io |
| Logowanie | użytkownik `marcin`, hasło Caddy: na VM `sudo bash ~/chatadhd/tools/gcp/aliases.sh --show-pass` |
| Wersja kodu | `e33504e` (gałąź `claude/jh16-hoffmann-test-20261025`); widoczna w każdym przebiegu i manifeście jako `git_commit` |
| Obraz | `watchdog:e33504e…` na VM; poprzedni `watchdog:c3508c16…` zachowany do cofnięcia |
| Kopia danych sprzed aktualizacji | `/var/backups/watchdog/watchdog-data-before-e33504e…-20261025T125242Z.tar.gz`, sha256 `504e329b…17b8`, oraz `release.env.before-20261025T125242Z` |
| Klucz SerpApi | zapisany w Twoim zaszyfrowanym sejfie w WatchDogu (Ustawienia → krok 1 pokazuje „serpapi: zapisany”) |

Każdy nowy pomiar (32 zapytania) zużywa kredyty SerpApi z Twojego konta: darmowy limit
października jest już wyczerpany, zostało ok. 2700 dokupionych kredytów (stan konta 25.10, 13:00 UTC). Plan z rozszerzeniem
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

## Gotowa konfiguracja

- preset wierny: `config/presets/jh2016-faithful.json` (zablokowany, 16 substancji, 32 zapytania);
- rozszerzenie SERP API: `config/presets/jh2016-serp-extension.json` (2 powtórzenia, gl=us, gl=pl);
- kryteria oceny: `config/replication/jh2016.json` i `config/replication/jh2016-interpretation.json`;
- dostawca: `config/providers/search_result_count.json` (Google przez SerpApi, `safe=off`).

## Test (ok. 10 minut, działa z telefonu)

1. **Dane historyczne (bez kosztu).** Menu → „Prace i replikacje” → „Nowe badanie” (strona Study),
   wybierz `fixture_jh2016`, „Start JH16 run”. Po kilku sekundach otwórz „Wyniki”
   (adres `/runs/<id>/results`). Oczekiwane: panel „JH16: ocena…” — „Ponowne przeliczenie danych
   z publikacji”, Pearson Hi–Nutt **0,8162**, oba werdykty „reproduced”. `serp_generic` jest
   nieaktywne.
2. **Nowy pomiar (32 kredyty).** Ustawienia → kreator. Krok 1: sprawdź „serpapi: zapisany” i, w
   trybie „Standardowy”, dzienny limit SerpApi (domyślnie 100). Krok 2: „Punkt odniesienia” →
   „JH16: nowe pomiary przez własny SerpApi”; odznacz „Zasil kartoteki” i „Przejrzyj arXiv…”, jeśli
   nie chcesz dodatkowych zadań. „Zapisz konfigurację i przygotuj plan”. Krok 3: przejrzyj metodę i
   licznik zapytań, zaznacz zgodę, „Zezwól i uruchom”. Po ok. minucie „Wyniki JH16”.
   Oczekiwane (to jest wynik, nie błąd): Pearson ujemny lub bliski zera, werdykt H-harm „deviates”,
   ranking popularności zwykle „reproduced”, kilka flag „osiągalne wyniki” lub „Hi > 100”.
   Konkretne liczby będą trochę inne niż 25.10 — Google zmienia szacunki.
3. **Ustawienia działają.** Ustaw dzienny limit poniżej 32 (np. 10), przygotuj plan jeszcze raz:
   krok 3 pokazuje „Limit nie wystarczy”, a uruchomienie jest odrzucone bez wysłania zapytań.
   Przywróć limit.
4. **Rozszerzenie (160 kredytów, opcjonalnie).** Jak w punkcie 2, ale „JH16 + rozszerzenie SERP API”
   (limit dzienny co najmniej 160 + już użyte). Wyniki wiernego przebiegu pokazują tabelę „Inne
   przebiegi tego planu” z wariantami repeat-1, repeat-2, gl-us, gl-pl.
5. **Eksport.** Na stronie wyników „CSV” lub „JSON”: zawiera liczby Ni/Ni_harm z zapytaniami,
   dostawcą i flagami, Pi/Hi, ocenę z p i werdyktami. Niezależne sprawdzenie (na VM w katalogu
   repozytorium): `python3 -I scripts/verify_jh16_run.py pobrany.json` → kod wyjścia 0.

Ustawienia kroku 2 (języki, geografia, slang, sentyment) zapisują plan eksploracyjny; nie zmieniają
zablokowanego przebiegu JH16 — kreator mówi to wprost.

## Czego nie sprawdzono

Lista w [REPORT.md, sekcja 7](REPORT.md#czego-jeszcze-nie-zweryfikowano).
