# WatchDog — wznowienie i pierwsza fala równoległa

Data: 2026-09-30. Baza `main`: `832947e` (integracja PR #4 + dokumentacja).
Gałąź: `codex/watchdog-wave1-20260930`. Ten dokument kontynuuje, nie zastępuje
historycznych wyników z [poprzedniego handoffu](HANDOFF_2026-09-30.md).

## Checkpoint 0 — odtworzenie stanu

- Sklonowano aktualne repo i przeczytano kontrakt agenta, stan, ledger,
  uzgodnienia specyfikacji, reguły projektowe oraz `ECOSYSTEM.md`.
- Repo potwierdza integrację siedmiu obszarów, wyszukiwania, admission i trwałych
  projektów. Historyczna bramka 419/419 jest wynikiem poprzedniego etapu,
  nie ponownym testem tej sesji.
- Historia dostępna głównemu agentowi wskazała aktualny repo/handoff; zawierała
  także niepasujące trafienia ChatADHD/AGEDS, których nie użyto jako stanu
  Watchdoga. Subagent historii nie uzyskał dodatkowego dostępu i korzystał
  wyłącznie z przekazanych fragmentów. Nie wykonano nowego pełnego skanu Takeout.
- E5.7b/E5.8b i E6.4/E6.5 pozostają otwarte; istniejące E5.8e już łączy wybrane
  operacje publikacji z zamrożonymi metodami i danymi. Nie zaczynamy od zera.
- Przydziały i zasady odzyskiwania: [WORK_COORDINATION](WORK_COORDINATION.md).

## Potwierdzone problemy; prace w toku

1. Ratio łączyło szeregi pozycyjnie mimo identyfikatorów encji. Audyt odtworzył
   błędny wynik po permutacji mianownika. Naprawa kontraktów i walidacji jest
   przypisana agentowi analizy; nie oznacza zmiany formuł JH16.
2. Odczyt współdzielonego zbioru po cofnięciu zatwierdzenia ma zbyt szeroki bypass
   `review`. Agent dostępu przygotowuje izolowany test API i poprawkę.
3. Instalator VM domyślnie pobiera starą gałąź kontynuacji mimo scalonego `main`.
   Agent operacyjny aktualizuje domyślne źródło i sprawdza powiązane regresje.
4. Analiza publikacji wymusza wszystkie wiersze. Powstaje jawny, utrwalony
   wybór podzbioru z pochodzeniem i kompatybilnością wcześniejszych eksportów.

Te punkty są wynikami audytu/zadaniami, nie ogłoszeniem gotowej naprawy.

## Środowisko i granice

Pierwsze `npm ci` nie zakończyło się sukcesem: node-gyp nie rozpakował nagłówków
Node 24.19.0 z powodu `fchown EINVAL` w środowisku. Trwa naprawa środowiska bez
zmian zależności projektu. Przed oznaczeniem zadań jako wykonane trzeba uruchomić
testy regresji i bramkę integracji. Nie wykonano płatnych wywołań, zatwierdzeń
metod w imieniu właściciela, kontaktów do osób ani instalacji na rzeczywistej VM.

## Następny krok po przerwaniu

Sprawdź head/remote oraz `git status`; nie zakładaj, że opis prac w toku jest
nadal aktualny. Odczytaj późniejsze checkpointy poniżej, wyniki agentów i pakiety.
Najpierw utrwal/zweryfikuj istniejące zmiany; nie rozpoczynaj drugiej implementacji
tego samego wycinka. Nie scalaj nieprzetestowanego zestawu do `main`.
