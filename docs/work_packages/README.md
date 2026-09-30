# Pakiety dla osobnych wątków WatchDoga

Te instrukcje przygotowują trzy większe strumienie pracy. Nie uruchamiają nowych
czatów. Subagenci działający w bieżącej sesji nie są osobnymi głównymi wątkami;
w tej sesji nie ma narzędzia automatycznie tworzącego takie wątki.

Repozytorium: `https://github.com/klb-t/Watchdog-JH16`. Punkt audytu: `main`
`832947e`; bieżąca fala: `codex/watchdog-wave1-20260930`. To identyfikatory
historycznego punktu wyjścia, nie polecenie cofania aktualnego kodu. Przed
uruchomieniem pakietu odczytaj opublikowany checkpoint fali i wybierz z
integratorem dokładny bazowy SHA zawierający potrzebne poprawki.

| Pakiet | Pierwszy działający rezultat | Warunek rozpoczęcia |
| --- | --- | --- |
| [RESEARCH](RESEARCH.md) | Jeden jawny claim, przegląd i zamrożona tolerancja przed nowym wykonaniem istniejącej operacji | Zintegrowana fala z wyborem kohorty; przydział plików badawczych |
| [CLINICAL](CLINICAL.md) | Fikcyjny przypadek z osią czasu i odtwarzalnym śladem sprawdzenia warunków | Przydział E6.4; uzgodniony kontrakt bez danych pacjentów |
| [OPERATIONS](OPERATIONS.md) | Próba backup → odtworzenie oraz awarie aktualizacji na izolowanych danych | Zintegrowane poprawki wdrożenia; lokalny runtime lub jawny blocker |

Każdy plik zawiera gotową instrukcję startową, zakres i bramki. Można wkleić
całą jego treść do nowego wątku albo wskazać plik po udostępnieniu repozytorium.
Nowy agent musi odczytać bieżący kod, nie tylko treść wklejonego pakietu.

## Własność i synchronizacja

Wiążąca procedura: [WORK_COORDINATION](../WORK_COORDINATION.md).

1. Integrator przydziela rozłączne zakresy; nowy wątek pracuje we własnym
   checkoutcie/worktree i na własnej gałęzi. Zanim zacznie pisać kod, uzupełnia
   sekcję claim w swoim pakiecie i publikuje checkpoint. Sam plik nie jest
   atomową blokadą; konflikt rozstrzyga integrator.
2. Claim zawiera właściciela, pełny bazowy SHA, gałąź, konkretne pliki, stan,
   czas UTC i następny checkpoint. Brak przydziału pozwala na odczyt i audyt;
   nie pozwala przejąć nakładającego się zakresu przez samo dopisanie nazwiska.
3. Stary timestamp nie zwalnia zakresu. Sprawdź zdalną gałąź, jej head i
   checkpointy. Przy niepewności zachowaj cudzą pracę, użyj własnej izolowanej
   gałęzi i przekaż różnicę integratorowi. Bez force-push, resetowania cudzych
   zmian ani nadpisywania wcześniejszego claimu jako rzekomo porzuconego.
4. Synchronizacja odbywa się przez gałęzie, commity i opublikowane checkpointy.
   Wyszukiwanie historii rozmów pomaga odzyskać intencję; nie jest blokadą,
   kolejką wiadomości ani potwierdzeniem aktualności innego wątku.
5. Globalny ledger, stan, handoff integracji i `WORK_COORDINATION.md` prowadzi
   integrator. Pracownik przekazuje mu dokładną propozycję aktualizacji wraz
   z dowodami. Własny pakiet aktualizuje w swojej gałęzi.

## Agenci i krótkie etapy

W bieżącej sesji limit wynosi prowadzący + sześciu subagentów. Nie zakładaj,
że osobny czat automatycznie zwielokrotnia dostępny limit. W każdym pakiecie
prowadzący przydziela agentom rozłączne pliki: implementacja, testy, audyt
kontraktu i interfejs mogą działać równolegle po ustaleniu wspólnego kontraktu.
Przegląd zmian powinien wykonać agent, który ich nie napisał.

Checkpoint po każdym spójnym wycinku: audyt → kontrakt → działający rdzeń →
przepływ/API → testy i integracja. Zapisuj bazę/head, listę plików, polecenia
z kodami wyjścia, wynik, ograniczenia i jednoznaczne następne działanie.
Utrwalaj małe commity bez oczekiwania na ukończenie całego pakietu. Nieudany
push jest blockerem trwałego checkpointu, nie sukcesem publikacji; procedurę
awaryjnego bundle opisuje dokument koordynacji. Logi i fixture nie zawierają
sekretów, prywatnych rozmów ani danych użytkowników.

Pełną bramkę `npm run clean && npm run test:all` oraz `npm run demo:jh16`
uruchamia integrator na konkretnym łącznym headzie, w odrębnym checkoutcie.
Test pakietu nie zastępuje tej bramki. Niedostępna przeglądarka, Docker lub
sieć pozostają jawnym ograniczeniem; nie oznaczaj takiej walidacji jako passed.

Żaden pakiet nie zatwierdza naukowo metody ani treści, nie nadaje zgody na
płatne wywołania, kontaktowanie osób, publikację prywatnych informacji lub
pracę na rzeczywistych danych medycznych. Gdy taki krok staje się konieczny,
przygotuj konkretny wynik do decyzji i kontynuuj dostępny zakres bez niego.
