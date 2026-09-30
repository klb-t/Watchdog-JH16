# CLINICAL — fikcyjny przypadek i jawne zależności reguł

## Instrukcja startowa do osobnego wątku

Przejmij pakiet CLINICAL w repozytorium `klb-t/Watchdog-JH16`. Zbuduj i sprawdź
mały przepływ demonstracyjny E6.4: fikcyjny przypadek → jawne sprawdzenie
warunków → odtwarzalny ślad i braki. Następnie, jeśli rdzeń przejdzie odbiór,
dodaj E6.5a: wykaz brakujących pomiarów zgodny z fikcyjnym profilem dostępnych
testów. Wynik ma demonstrować mechanizm, bez deklaracji użyteczności klinicznej.
Nie używaj rzeczywistych przypadków, progów medycznych ani porad terapeutycznych.

Przeczytaj `CLAUDE.md`, `docs/WORK_COORDINATION.md`, najnowszy handoff,
`docs/spec/00_STATE_AND_DECISIONS.md`, `docs/spec/07_EPICS_AND_TASKS.md`,
`docs/DESIGN_RULES.md` i `ECOSYSTEM.md`. Punkt audytu: `main` `832947e`;
przed implementacją ustal z integratorem dokładny opublikowany SHA i claim.
Uwzględnij wynik `codex/watchdog-wave1-20260930`; zakres E6.4/E6.5 sprawdź
ponownie w kodzie. Nie traktuj tego pliku jako aktualnego raportu implementacji.

## Claim — uzupełnia przydzielony właściciel

| Pole | Stan początkowy |
| --- | --- |
| owner | nieprzydzielony |
| base_sha | do ustalenia z integratorem po checkpointcie fali |
| branch | nieutworzona; własna gałąź pakietu |
| files | poniższy zakres jest propozycją do rozłącznego przydziału |
| status | prepared, unclaimed |
| updated_at_utc | 2026-09-30 |
| next_checkpoint | zweryfikowany brak kontraktu przypadku i mały schema/fixture do przeglądu |

Własny checkout/gałąź i opublikowany claim poprzedzają zmiany. Integrator
przydziela rozłączne pliki; status w Markdown nie jest atomową blokadą.
Nie przejmuj starego claimu na podstawie wieku. Sprawdź zdalną gałąź i
checkpointy, zachowaj wcześniejszą pracę i przy niepewności użyj własnej
izolowanej gałęzi; konflikt przekazuj integratorowi.

## Fakty i pierwszy ruch

Audyt bazowego kodu potwierdził otwarte E6.4/E6.5. Są cytowane referencje,
zatwierdzanie hashy, field lookup i snapshoty offline; nie ma wykonywalnej
reguły klinicznej ani prywatnego modelu przypadku. `AssertionDocument` zawiera
opis referencji — zatwierdzenie tego opisu nie zatwierdza reguły wykonawczej.
`FieldProfile` opisuje prezentację/TTL/kontakty; nie jest katalogiem badań
instytucji. ChEMBL assay nie staje się wskazówką kliniczną.

Pierwszy ruch: odczytaj `docs/CONVERSATION_DELTA_2026-09-20.md`,
`docs/FIELD_REFERENCE.md`, `shared/field.ts`, `shared/field_validation.ts`,
`shared/field_lookup.ts`, `backend/watchdog_api/field/service.ts`,
`backend/watchdog_api/db/repositories/field_reference.ts` i
`tests/helpers/field.ts`. Zapisz krótką różnicę stan–cel oraz najmniejszy
kontrakt przypadku i śladu. Uruchom regresję istniejących referencji.

## Trzy checkpointy

1. **E6.4a — fikcyjny przypadek.** Ścisły schema obejmuje znane/możliwe
   ekspozycje, leki, drogę i czas z jawnymi brakami. Obserwacja zachowuje
   jednostkę, czas zdarzenia i pomiaru, źródło, reported/measured, missingness,
   sprzeczności oraz supersession. Hipotezy zachowują klasy/substancje,
   mieszaniny, nieznany skład, współchorobowość i alternatywy nietoksykologiczne.
   Początkowo wybierane dostarczone fixture, bez importu dowolnej historii
   pacjenta. Nie wkładaj przypadku do wspólnego katalogu referencji/snapshotu.
2. **E6.4b — ograniczony interpreter.** Wersjonowana reguła wskazuje hashe
   źródeł, applicability (m.in. gatunek, populacja, setting), wymagane
   wejścia/jednostki/czas, typowany predykat i znaczenie wyniku. Osobny przegląd
   dotyczy dokładnego hasha reguły. Wynik per reguła to
   supported/contradicted/undetermined, odrębny status applicability i ślad
   wejść, operacji oraz braków. Sprzeczność nie usuwa hipotezy. Replay pinuje
   case/rule/reference/executor hashes. Testowa aprobata fixture nie jest
   zatwierdzeniem rzeczywistej treści medycznej.
3. **E6.5a — brakujące pomiary.** Oddzielny wersjonowany profil wskazuje
   dostępne testy, wielkości, jednostki i ograniczenia. Propozycje wynikają
   wyłącznie z brakujących zależności kwalifikujących się reguł; każda ma
   przyczynę, źródło, powiązane reguły i założenia. Niedostępny test pozostaje
   luką. Bez entropii, probabilistycznego rankingu i zlecania badań.

E6.5a zależy od jawnych dependencies E6.4b, nie od E5.7b ani urządzeń.
Wykorzystuj mechanizmy własności, rewizji i hashy; nie ogłaszaj projektu
badawczego gotową dokumentacją przypadku. Nowy przepływ ma być kontekstowy
w obecnym obszarze referencji, bez mnożenia głównych działów nawigacji.

Proponowany zakres: nowe dedykowane moduły przypadku/reguł, walidatory,
fikcyjne profile i własne testy. Integrator przydziela dokładne ścieżki;
migracje, API, nawigacja, wspólne profile i ledger mają osobnego właściciela.
Nie zmieniaj przy okazji reguł publikacji/udostępniania referencji.

Podział agentów: schema i validator; interpreter po ustaleniu kontraktu;
selector profilu po dependencies; dedykowane testy; niezależny audyt granic;
UI po API. Nie przydzielaj dwóch piszących agentów do tych samych plików.

## Walidacja i odbiór

Istniejąca regresja z katalogu repozytorium:

```bash
npm run lint
npm run build
node --import tsx --test tests/integration/field_reference.test.ts tests/integration/field_shell.test.ts tests/unit/field_ui.test.ts
```

Dostarcz nowe testy dla przypadku, interpretera i profilu; ich nazwy oraz
dokładne polecenia zapisz w checkpointcie. Odbiór wymaga:

- identycznych wyników i trace dla identycznych wejść; nowego hasha po zmianie;
- jawnego undetermined/przyczyny przy braku wartości, jednostki, czasu lub
  niezgodnym gatunku/setting; braku cichego przeliczania nieznanych jednostek;
- zachowania konfliktów, supersession i wcześniejszych obserwacji;
- obecności mieszaniny, nieznanej ekspozycji i nietoksykologicznej alternatywy;
- braku utożsamienia nieobecnej krawędzi z brakiem interakcji oraz wyglądu
  próbki z potwierdzoną ekspozycją;
- blokowania nowych wykonań po zmianie/cofnięciu źródła albo reguły; zachowania
  niezmiennego śladu historycznego z aktualnymi warunkami uprawnionego odczytu;
- zmiany propozycji po zmianie dostępnych testów bez zmiany pomiarów lub praw;
- przy trwałym zapisie: izolacji dwóch właścicieli, restartu, stale revision,
  eksportu i braku przypadku w udostępnianym/offline snapshotcie referencji.

Fixture rozszerzają wzorzec `tests/helpers/field.ts`: fikcyjne A/B, abstrakcyjne
wielkości i jednostki testowe, bez rzeczywistych progów klinicznych. Po
zbudowaniu UI dodaj jeden produkcyjny browser flow: fixture case → trace →
braki → profil testów → jawnie oznaczony wynik demonstracji. Zachowaj regresję:

```bash
npm run build
node --import tsx --test tests/e2e/workbench_field.test.ts
```

To polecenie samo nie obejmuje przyszłego przepływu, dopóki nie dodasz jego
testu. Pełną bramkę na zintegrowanym headzie wykonuje integrator; brak
przeglądarki jest blockerem, a nie sukcesem. Syntetyczny przepływ nie zamyka
automatycznie całych E6.4/E6.5.

## Granice i przekazanie

Zatrzymaj rozszerzenie wymagające rzeczywistych danych pacjenta, klinicznych
reguł/progów, zatwierdzenia medycznego, ilościowej PK, prawdopodobieństw lub
urządzeń. Przygotuj konkretny blocker i oddaj ukończony zakres syntetyczny.
Nie zastępuj brakujących źródeł wiedzą modelu; brak reguły to brak reguły.
Bez płatnych wywołań, kontaktowania osób, publikowania danych i zaleceń leczenia.

Oddaj małe commity, kontrakt, fikcyjne fixture, działający przebieg, testy
i checkpoint z pierwszym następnym działaniem. Integrator aktualizuje globalny
stan i ledger na podstawie rzeczywistych wyników, nie aspiracji pakietu.
