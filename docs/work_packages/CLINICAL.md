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

## Claim — clinical-20260930

Przydział integratora: zdalny `main`, commit `9a8adba` (odczytany 2026-09-30 UTC).
Zastępuje wcześniejsze awaiting-assignment w audycie; zakres to czysty rdzeń
syntetyczny w pamięci, bez API, migracji, wspólnej aprobaty i nawigacji.

| Pole | Stan |
| --- | --- |
| owner | clinical-20260930 |
| base_sha | 312ba246f9bdeb035019e2ff4c1a09aaef0a734c |
| branch | codex/clinical-audit-20260930, PR #6 |
| status | claimed; ready for integration; E6.4a/b + E6.5a source-run demo verified |
| updated_at_utc | 2026-09-30T22:49:31Z |
| next_checkpoint | integrator review + full gate on combined head; API/persistence/UI remain a later allocation |

Dokładnie przydzielone pliki:
- `shared/clinical_demo.ts`
- `shared/clinical_demo_validation.ts`
- `tests/helpers/clinical_demo.ts`
- `backend/watchdog_api/clinical_demo/executor.ts`
- `backend/watchdog_api/clinical_demo/executor_manifest.ts`
- `shared/clinical_demo_profile.ts`
- `shared/clinical_demo_selector.ts`
- `tests/unit/clinical_demo_case.test.ts`
- `tests/unit/clinical_demo_executor.test.ts`
- `tests/unit/clinical_demo_profile.test.ts`
- `scripts/demo_clinical.ts`
- `docs/work_packages/CLINICAL.md`
- `docs/work_packages/CLINICAL_AUDIT_2026-09-30.md`

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


## Checkpoint 1 — E6.4a, 2026-09-30 UTC

Przydział integratora odczytany z `main` `9a8adba8a22671769ecd2b0291e23e1007d8c6fc`.
Claim opublikowany jako `d0a228b47465d2beb504d9f3bd59e641b6488f3e`.
Bazowy kod pozostaje `312ba246f9bdeb035019e2ff4c1a09aaef0a734c`.

Zaimplementowano `shared/clinical_demo.ts`, `shared/clinical_demo_validation.ts`,
`tests/helpers/clinical_demo.ts` i `tests/unit/clinical_demo_case.test.ts`.
Ścisły model zachowuje jawne braki, oba zegary, źródła, reported/measured,
konflikty, poprzednie obserwacje, mieszaniny częściowo nieznane i alternatywy.
Supersession może korygować reported na measured, zachowując obie obserwacje.
Nie ma importu danych pacjenta, API ani trwałego zapisu.

`node --import tsx --test tests/unit/clinical_demo_case.test.ts`: **14/14 pass**.
`npm run lint`: **exit 0** po korekcie typowania wyniku strict parse Zod;
wcześniejsza próba wykazała trzy TS2322 i została poprawiona bez zmiany tsconfig.
Niezależny audyt: **18 dodatkowych jednorazowych assertions pass**, nie są
wliczane do 14 testów repo. Schemat nie dowodzi fikcyjnego pochodzenia dowolnego
tekstu: uruchamialne demo będzie wybierać wyłącznie dostarczone fixture.
Odrębny przegląd nie zatwierdza treści medycznej. E6.4b i E6.5a pozostają otwarte.


## Checkpoint 2 — E6.4b, 2026-09-30 UTC

Poprzedni opublikowany etap E6.4a: `12ea35996cfe5368c6347c7a779c48bd84f4ae60`.
Dodano `backend/watchdog_api/clinical_demo/executor.ts`, `executor_manifest.ts`
i `tests/unit/clinical_demo_executor.test.ts`. Brak I/O w interpreterze; wykonanie
czyta jawny snapshot fixture. Własny manifest przypina bajty modułów i lockfile
oraz wersję Node; CLI ma dostarczać rzeczywiste bajty checkoutu. Manifest nie jest
podpisem ani atestacją rzeczywiście zainstalowanych zależności.

Reguły mają osobny przegląd dokładnego hasha, fikcyjną applicability i typowane
porównanie skalarne. Trace rozróżnia wynik, applicability, kwalifikację reguły,
operacje i komplet braków. Zachowuje wykluczone superseded ID, wymagane i faktyczne
hashe źródeł. Archiwum obejmuje cały niezmieniony przypadek i zależności; historyczny
odczyt wymaga bieżących praw do hasha przypadku, wszystkich reguł i źródeł. Replay
weryfikuje identyczność z archiwum, nie przywraca prawa do nowego wykonania.

Niezależny audyt wykrył i potwierdził naprawę dwóch problemów: cofnięte źródło
obserwacji spoza cytatów reguły nie blokowało jej wykonania; przypadek wiązał
obserwacje z samym ID źródła. Teraz `sourcePins` zastępuje `sourceIds` i wymaga
konkretnych hashy. Zmienione/ponownie zatwierdzone źródło nie zmienia pochodzenia
starej obserwacji: potrzebny jest nowy przypadek/pin i nowy hash. Cofnięte,
niezatwierdzone i nieczytelne źródło blokuje także kwalifikację całej reguły dla
selektora, nawet gdy inna zależność jest zwyczajnie niezmierzona.

`node --import tsx --test tests/unit/clinical_demo_case.test.ts tests/unit/clinical_demo_executor.test.ts`:
**46/46 pass** (15 przypadek + 31 interpreter), zero fail/skipped/cancelled.
`npm run lint`: **exit 0**. Niezależny przegląd: 19 pierwszych i 7 końcowych
jednorazowych assertions; dodatkowe scenariusze zostały utrwalone w testach repo.

Granice: to zaufany harness fixture w pamięci, nie serwer uprawnień. Przekazane
booleany/listy dostępu nie nadają żadnych rzeczywistych praw. Posiadanie reguły w
wejściu pochodzi z harnessu; osobna produkcyjna kontrola prawa odczytu reguły
przed nowym wykonaniem pozostaje zadaniem przyszłego API. Wspólny model aprobat,
referencje/offline, migracje i nawigacja nie zostały zmienione. Gate rdzenia
pozwala teraz rozpocząć E6.5a bez dodatkowej decyzji właściciela.


## Checkpoint 3 — E6.5a i działające demo, 2026-09-30 UTC

Poprzedni opublikowany rdzeń E6.4b: `5f8ab5812d22906ccb5577e9853c4dca1837ee9d`.
Dodano `shared/clinical_demo_profile.ts`, `shared/clinical_demo_selector.ts`,
`tests/unit/clinical_demo_profile.test.ts` oraz `scripts/demo_clinical.ts`.

Selector ponownie oblicza trace z bieżącego wejścia fixture, zamiast przyjmować
historyczne `eligible=true`. Źródła, osobny przegląd reguły i applicability
warunkują kwalifikację. Propozycje pochodzą wyłącznie z brakującej obserwacji lub
wartości, zgodnej z profilem wielkości, dokładnej jednostki, trybu, kontekstu
i jawnie prospektywnego czasu. Profil jest niezależny od `FieldProfile` i praw.

Wszystkie pierwotne braki pozostają widoczne również przy znalezieniu kandydata.
Niedostępny test, niezgodne jednostki/czas, `not_applicable`, konflikt, źródło lub
aprobata pozostają lukami. Przyszły pomiar nie naprawia metadanych historycznych
ani konkretnego pinned observation ID. Przy konflikcie/niejednoznaczności ta
pierwsza wersja wstrzymuje propozycje dla całej reguły i jawnie podaje powód.
Kolejność według ID nie jest rankingiem. Nie utworzono pomiaru ani zlecenia.

### Uruchomienie i zaobserwowane wyniki

Z katalogu repo z zainstalowanymi zależnościami:

```sh
node --import tsx scripts/demo_clinical.ts fixture:case-a available
node --import tsx scripts/demo_clinical.ts fixture:case-b available
node --import tsx scripts/demo_clinical.ts fixture:case-b unavailable
```

| Fixture / profil | Wynik reguły | Kandydaci pomiaru | Zachowane luki |
| --- | --- | --- | --- |
| A / available | supported | 0 | Brak luk zależności tej reguły; hipotezy bez reguł nadal jawne. |
| B / available | undetermined | 1 | missing_value — propozycja nie wypełnia pomiaru. |
| B / unavailable | undetermined | 0 | missing_value oraz test_unavailable. |

JSON na stdout zawiera pełny przypadek, reguły, źródła, trace, archiveHash,
profileHash, wynik historycznego replay oraz próbę cofnięcia źródła. Dwa identyczne
uruchomienia dają identyczne bajty. Zmiana dostępności zmienia profileHash i
propozycje bez zmiany caseHash, traceHash lub aprobat. CLI przyjmuje tylko dwa
wbudowane identyfikatory przypadku i dwie wersje dostępności; odrzuca JSON,
ścieżki plików i dodatkowe argumenty. Bez zapisu, sieci lub dowolnego importu.

`executorHash` przypina rdzeń, schemat, lockfile i Node. Osobne `recipe` oraz
`recipeHash` przypinają rzeczywiste bajty CLI, selektora, profilu i helpera fixture,
wiążąc je z executorem. `reportHash` obejmuje wynik całej demonstracji. Te hashe
sprawdzają zawartość; nie stanowią podpisu, zaufanej atestacji ani zatwierdzenia
medycznego. Zmiana selektora nie unieważnia automatycznie rdzenia historycznego
replay, bo obie tożsamości pozostają oddzielne.

### Końcowa walidacja tego pakietu

```sh
npm run lint
npm run build
node --import tsx --test tests/unit/clinical_demo_case.test.ts tests/unit/clinical_demo_executor.test.ts tests/unit/clinical_demo_profile.test.ts tests/integration/field_reference.test.ts tests/integration/field_shell.test.ts tests/unit/field_ui.test.ts
```

Testy: **91/91 pass**, zero fail/skipped/cancelled — 15 przypadku, 31 executora,
19 profilu/CLI i 26 istniejącej regresji referencji. Testy CLI uruchamiają
rzeczywiste procesy, sprawdzają allowlist, komplet przepływu, deterministyczny
stdout oraz zachowanie historycznego replay po cofnięciu źródła.
`npm run lint`: **exit 0**.
Produkcyjny `npm run build`: **exit 0** (trzy istniejące ostrzeżenia import.meta/CJS).
Niezależny odbiór E6.5a: 24 jednorazowe dodatkowe assertions pass, bez edycji kodu
przez audytora. Wykryte granice czasu (precyzja sekund i zakres roku), historycznej
missingness oraz źródeł objęto testami repo.

Nie ma nowego browser flow, bo integrator wyłączył API/nawigację z przydziału.
Wcześniejszy lokalny blocker Chromium pozostaje jawny i nie jest raportowany jako
browser pass. Nie testowano trwałej izolacji właścicieli, restartu ani stale
revision serwisu, ponieważ serwis przypadku nie powstał. Profile/read grants
pochodzą z zaufanego harnessu; produkcyjne API musi ustalać je samodzielnie.

**Pierwszy następny ruch:** integrator odbiera opublikowany head PR #6 i uruchamia
pełną bramkę na wspólnym headzie, a dopiero w kolejnym przydziale łączy demo z
rzeczywistą autoryzacją, zapisem/API i kontekstowym UI. Nie oznaczać całych E6.4
ani E6.5 jako ukończonych; zamknięty jest wyłącznie opisany syntetyczny wycinek.
