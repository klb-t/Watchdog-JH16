# Test właściciela — JH16 w WatchDogu (przygotowane 2026-10-25)

Wyniki i ocena, które ten test ma sprawdzić: [REPORT.md](REPORT.md).

## Dostęp

| | |
|---|---|
| Adres | https://watchdog.34-158-117-249.sslip.io |
| Logowanie | użytkownik `marcin`, hasło Caddy: na VM `sudo bash ~/chatadhd/tools/gcp/aliases.sh --show-pass` |
| Wersja kodu | `5364332` (czoło stosu PR #13–#22, gałąź `claude/e5-7b-evidence-graph-20261026`); widoczna w każdym przebiegu i manifeście jako `git_commit` |
| Obraz | `watchdog:5364332…` na VM; poprzednie (`05e2fdc`, `0ce79a4`, `6b7e63e`, `84a9e71`, `10744c9`, `e33504e`, `c3508c16`) zachowane do cofnięcia |
| Kopie danych sprzed aktualizacji | `/var/backups/watchdog/watchdog-data-before-e33504e…-20261025T125242Z.tar.gz` (sha256 `504e329b…17b8`) `…before-10744c9…-20261025T143201Z.tar.gz` (sha256 `d3c1cf3d…04e0`) `…before-84a9e71…-20261025T162352Z.tar.gz` (sha256 `43323380…1737`) `…before-6b7e63e…-20261026T173110Z.tar.gz` (sha256 `a3c6407f…1182`) `…before-0ce79a4…-20261026T175225Z.tar.gz` (sha256 `d1d56d53…2e1c`) `…before-05e2fdc…-20261026T182117Z.tar.gz` (sha256 `e7bbeccd…b4f4`) i `…before-5364332…-20261026T194907Z.tar.gz` (sha256 `839eab61…3cbc`), z kopiami `release.env` |
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

## Aktualizacja do `5364332` (2026-10-26 19:49 UTC)

Do instalacji trafiły:
- rodziny porównań z priorytetem i bramkowaniem;
- projekt PostgreSQL, tylko kod: baza zostaje na SQLite;
- kod okresowej kopii poza maszynę, niezainstalowany, bo czeka na Twoją zgodę;
- druga replikacja CR2014;
- zakładka „Dowody”.

Przebieg wdrożenia:
1. Obraz zbudowano z testami: 667/667.
2. Przed przełączeniem zrobiono kopię danych (powyżej).
3. Migracji nie przybyło (25).

Po wdrożeniu:
- **Drugie przejście audytu:** 28 stron, bez błędów strony, nieudanych żądań i śladów danych testowych.
- **Test dymny nowych ekranów, tylko do odczytu** (nic nie zamrożono ani nie uruchomiono w Twoich danych):
  - wszystkie zakładki CR2014 oraz „Dowody” i „Protokół” JH16 działają na komputerze i telefonie, bez przewijania w bok;
  - panel pomiaru CR2014 pokazuje koszt 1 zapytania, limit 100/100 i Twój zapisany klucz;
  - przycisk jest nieaktywny do zatwierdzenia presetu.

Luki w zakładce „Dowody” na Twojej instalacji:
- **CR2014:** brak przebiegu (uruchomisz go w kroku A3).
- **JH16, „Region Google”:** dowodem są przebiegi wariantów gl=us i gl=pl, a na Twojej instalacji ich nie ma. Uruchomienie rozszerzenia w kreatorze (160 kredytów) usuwa tę lukę.
- **JH16, „Zmiana sposobu szacowania…”:** pytanie do Ciebie w kroku A4.

## Audyt interfejsu przed testem (2026-10-26)

Przegląd wszystkich 28 stron na VM: komputer, zbieranie błędów strony, nieudanych żądań, widocznych
słów typu „test/fixture/mock/demo/planned” i stanu każdego przycisku. Raport:
`docs/history/evidence/2026-10-25-jh16/ui_audit/`.

Znalezione i poprawione (`05e2fdc`):
- źródło `offline_fixture` (dane wyłącznie do testów) było widoczne w „Źródłach pomiarów”, „Ustawieniach”,
  wyszukiwaniu i kartotece — usunięte z interfejsu (zostaje w testach);
- przycisk „Uruchom źródło testowe” wysyłał przebieg bez języka i planu, więc zawsze kończył się
  błędem — teraz każde źródło ma tylko działającą akcję („Przelicz JH16 z danych publikacji”, „Nowy
  pomiar w kreatorze”) albo napis „Niedostępne” z powodem;
- przyciski wymagające modelu językowego (redakcja narracji, ocena metodologii pracy, propozycja
  parsera) były aktywne bez klucza i kończyły się błędem — teraz są wyłączone z podanym powodem;
- opisy źródeł po polsku zamiast żargonu; przełącznik „Język” nazywa się „Język menu” (zmienia tylko
  menu); pulpit ma kafel „Zobacz replikację JH16 i projekt pracy”.

Znane ograniczenia, które zostają (oznaczone w interfejsie):
- część ekranów ma nagłówki po angielsku (np. „Results”, lista uruchomień); przełącznik języka nie
  tłumaczy treści;
- redakcja projektu pracy przez Vertex jest wyłączona w konfiguracji do czasu sprawdzenia
  prawdziwego wywołania;
- na Twojej instalacji nie ma zamrożonego protokołu — to Twoja decyzja (zakładka „Protokół”);
- źródła „planned” (np. PubChem przez katalog referencyjny, Erowid) są widoczne jako plan, bez akcji.

Nie sprawdzono w audycie: klikania przycisków zapisujących (zaproszenia, role, harmonogramy) na Twojej
instalacji, żeby nie zmieniać Twoich danych; są pokryte testami przeglądarkowymi na osobnej bazie.

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
   „Pobierz Markdown” / „Pobierz HTML”. Redakcja językowa przez model (Vertex) jest widoczna, ale
   wyłączona w konfiguracji, dopóki nie sprawdzimy prawdziwego wywołania na tej instalacji.

**A2. Protokół potwierdzający (E5.7b, bez kosztu)**
- Replikacje → JH16 → **Protokół**: wybierz rodzinę porównań, punkt główny, korektę (Holm) i alfa,
  wpisz uzasadnienie → „Zamroź protokół”. Zamrożenia nie da się zmienić ani usunąć.
- W kreatorze (punkt 6) w „Rola nowych danych JH16” wybierz ten protokół: nowy pomiar metodą wierną
  będzie danymi potwierdzającymi. Zakładka „Protokół” pokaże p surowe i skorygowane oraz decyzję
  względem alfa; „Przebiegi” oznaczą przebieg jako „potwierdzające”, a projekt pracy dostanie sekcję
  „Protokół potwierdzający”. Wcześniejsze przebiegi zostają eksploracyjne (z podanym powodem).
- **Priorytet i kilka rodzin (E5.7b-2):** przy każdym porównaniu wybierz numer rodziny i priorytet;
  każda rodzina ma własną korektę (także „Sekwencja ustalona”: test w podanej kolejności do pierwszego
  nieodrzucenia). Przy dwóch rodzinach wybierz bramkowanie: „szeregowe” testuje rodzinę 2 tylko, gdy
  wszystkie hipotezy rodziny 1 odrzucono. Podgląd nad uzasadnieniem pokazuje, co zostanie zamrożone.
  Sprawdzone na kopii danych 26.10: H-harm w rodzinie 1, H-pop w rodzinie 2, nowy pomiar `51a9567b`:
  H-harm p 0,71 (nieodrzucona), więc H-pop „nietestowane: bramka zamknięta”, mimo surowego p 1,25e-4.
  Protokoły zamrożone wcześniej liczą się jak dotąd (jedna rodzina, bez priorytetu).

**A3. Druga replikacja: CR2014 (1 kredyt SerpApi)**
- Replikacje → **„Monitoring of non-cigarette tobacco use using Google Trends”** (Cavazos-Rehg i wsp. 2014).
  Sprawdza, czy mechanizm replikacji nie jest szyty pod JH16: Google Trends dla cygar w 2011 r.
  według stanów USA wobec odsetka uczniów palących cygara (YRBS 2011, otwarte dane CDC).
- Na Twojej instalacji nie ma jeszcze przebiegu CR2014. Wynik z kopii danych audytowych z 26.10:
  Pearson 0,358 (p 0,032, n 36) wobec 0,39 (p 0,018) w pracy, „reproduced”, odczyt „wspierają”.
  Raport: `docs/replication/CR2014_2026-10-26/REPORT.md`.
- Ścieżka:
  - **Protokół** (opcjonalnie): zamroź protokół z jedną rodziną.
  - **Nowy pomiar**: panel pokazuje terminy, parametry, koszt (1 zapytanie), limit dzienny i hash
    presetu. Zaznacz „Zatwierdzam ten preset”, wybierz rolę danych, potem „Uruchom pomiar”.
  - Po kilku sekundach przebieg jest w **Przeglądzie** i w **Przebiegach**. Wybierz przebieg: zobaczysz
    wykres rozrzutu stan po stanie, a kliknięcie stanu pokaże zapytanie i surową odpowiedź.
  - **Projekt pracy** ma sekcję „Czego nie powtórzono”. Trzech z czterech wyników pracy nie da się
    sprawdzić na otwartych danych.
- Twój wynik może się trochę różnić od tego z 26.10, bo Trends ponownie próbkuje dane.

**A4. Dowody (bez kosztu)**
- W każdej replikacji zakładka **„Dowody”** pokazuje graf, który łączy:
  - hipotezy, kryteria i prerejestrację;
  - protokoły i przebiegi (werdykt na krawędzi);
  - pliki i przyczyny rozbieżności;
  - sekcje projektu pracy.
- Kliknięcie węzła pokazuje jego połączenia i odnośniki. Nad grafem są **luki**: kryterium bez
  kompletnego przebiegu, przyczyna bez dowodu, tabela pracy bez źródła.
- **Pytanie do Ciebie (JH16):** jedyna luka w JH16 to przyczyna „Zmiana sposobu szacowania przez Google
  od 2014 r.”. Ma status „prawdopodobna”, ale nie wskazuje żadnego dowodu (dawnego narzędzia Google nie
  da się już uruchomić). Masz trzy wyjścia:
  - zostawić ją jako prawdopodobną bez dowodu, a luka zostaje widoczna;
  - zmienić status na „nierozstrzygnięta”;
  - wskazać źródło, np. dokumentację Google o zmianie szacunków, jeśli takie znasz.

**A5. Zlecenie z tekstu: wklej cytat prof. Hoffmanna (ok. 32 kredyty SerpApi)**
- Menu → Prace i replikacje → **„Zlecenie z tekstu”**. Wklej cytat razem z linkiem i kliknij „Rozpoznaj”.
- Oczekiwane po rozpoznaniu:
  - praca doi:10.2196/jmir.4033, rozpoznana przez Crossref (strona JMIR ma ochronę przed botami, co widać w „Pobraniach”);
  - 3 prośby, każda z cytatem;
  - plan: przeliczenie danych z pracy i nowy pomiar 32 zapytaniami;
  - propozycje z kosztem;
  - 4 pytania;
  - informacja, że odczyt modelem jest wyłączony, z powodem.
- Zaznacz zgodę i kliknij „Wyślij i rozpocznij”. Część dosłowna startuje od razu. Propozycje uruchamiasz przyciskiem „Akceptuj i uruchom”. Odpowiedzi na pytania zapisujesz bez wstrzymywania pracy.
- Na kopii testowej 28.10:
  - przeliczenie dało 0,8162, „reproduced”;
  - nowy pomiar był niekompletny: Google zwrócił prawdziwy szacunek dla mniej niż połowy zapytań, a dla „khat” harm nic. Werdykt „nie da się ocenić” jest więc poprawny;
  - Trends A1 w 4 regionach wyniósł 0,75–0,92.

  Raport: `docs/replication/REQUEST_HOFFMANN_2026-10-28/REPORT.md`.
- **Do potwierdzenia:** rzeczywista cena Twoich dodatkowych kredytów SerpApi. Automat przyjmuje 0,014 € za zapytanie i limit 1 € dziennie.

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

**B2. Dokumenty HTML i PDF (E5.8b, bez kosztu)**
- Prace i replikacje → „Tekst, metodologia i ekstrakcja” → „Wczytaj HTML lub PDF”: tekst pracy
  powstaje w kodzie (pdf.js / parse5); notka pokazuje parser, sha256 pliku i liczbę stron.
- Zakładka „Ekstraktory danych” → format „HTML (tabele)” → wczytaj stronę z tabelą → „Pokaż tabele
  w tym HTML” → wpisz numer tabeli i nagłówki kolumn w „Zdefiniuj kopiowanie”: wartości są kopiowane
  dokładnie, z pozycją komórki w pliku. Tabele z PDF nie są jeszcze obsługiwane.

**B3. Tabele z PDF (E5.8b, bez kosztu)**
- „Ekstraktory danych” → „PDF (tabela, odczyt jawny)” → wczytaj PDF → ustaw stronę i zakres → „Pokaż
  wiersze tekstu i proponowane granice kolumn” → granice wpisują się do planu jako propozycja; dopisz
  nazwy kolumn. Każda wartość zapisuje stronę, fragmenty i prostokąt w pliku.

**C. Kontrola niezależna (opcjonalnie, na VM)**
9. Z wyników przebiegu pobierz „JSON” i uruchom
   `python3 -I scripts/verify_jh16_run.py pobrany.json` (kod wyjścia 0 = zgodne). Dla kalibracji:
   `python3 -I scripts/verify_trends_calibration.py eksport.json run.json` (run.json z
   `/api/runs/<id>`).

Ustawienia kroku 2 (języki, geografia, slang, sentyment) zapisują plan eksploracyjny; nie zmieniają
zablokowanego przebiegu JH16 — kreator mówi to wprost.

## Czego nie sprawdzono

Lista w [REPORT.md, sekcja 7](REPORT.md#czego-jeszcze-nie-zweryfikowano).
