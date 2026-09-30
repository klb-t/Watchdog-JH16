# CLINICAL — checkpoint 0: audyt i kontrakt do przydziału

Data audytu: 2026-09-30 UTC.

**Aktualizacja wznowienia:** integrator w zdalnym `main` `9a8adba` przyjął ten
kontrakt i przydzielił dokładne pliki. CLINICAL-COORD-1 jest rozwiązany; claim
`d0a228b` i postęp implementacji zapisuje `CLINICAL.md`. Poniżej zachowano
historyczny audyt sprzed przydziału.

Stan: **audyt zakończony; implementacja nie rozpoczęta; claim oczekuje przydziału**.
Ten dokument nie zamyka E6.4 ani E6.5. Nie stanowi aprobaty medycznej.

## Baza i koordynacja

| Pole | Wartość |
| --- | --- |
| Właściciel audytu | `clinical-20260930` — osobny wątek CLINICAL |
| Zweryfikowany zdalny `main` | `312ba246f9bdeb035019e2ff4c1a09aaef0a734c` |
| Drzewo bazy | `6e142be013eed96393770067f02051507b382c97` |
| Zintegrowana fala | PR #5, merge `860c844913ad3b51a653ba30ac78583a3f4e6b0b` |
| Zdalny head fali | `a1449bd5acb8a1a3fb211d849a6f3d179634435f` |
| Własna gałąź audytu | `codex/clinical-audit-20260930` |
| Zmiany tego checkpointu | Wyłącznie niniejszy dokument |
| Status implementacyjnego claimu | `awaiting-integrator-assignment`, nie `claimed` |
| Następny checkpoint | Opublikowany przydział bazy i dokładnych plików; potem walidator i fixture E6.4a |

`git ls-remote --heads origin` sprawdzono po odczycie dokumentacji i ponownie
po regresji. Nie było zdalnej gałęzi CLINICAL ani opublikowanego claimu w jego
pakiecie. To nie jest atomowa rezerwacja ani dowód, że inny wątek nie przygotowuje
zmian. Nie edytowano istniejącego claimu, globalnego ledgeru ani stanu.

Końcowy handoff fali pozwala wybrać nieprzydzielony pakiet. Bieżąca instrukcja
CLINICAL wymaga jednak przed implementacją uzgodnienia SHA i rozłącznych plików
z integratorem. Ten dodatkowy warunek pozostaje niespełniony. Audyt i kontrakt
przygotowano we własnym checkoutcie; nie przyjęto samodzielnie roli integratora.

## Różnica stan–cel, potwierdzona w kodzie

| Dowód w bazie | Wniosek dla pakietu |
| --- | --- |
| `shared/field.ts`, `AssertionDocument`, `ReferenceDocument` | Opis cytowanej referencji; brak modelu przypadku i wykonywalnego predykatu. |
| `shared/field.ts`, `FieldProfile` | Prezentacja, TTL, regiony, kontakty; brak katalogu dostępnych pomiarów. |
| `shared/field_lookup.ts`, `lookupField` | Dopasowanie i projekcja referencji; nie interpreter zależności przypadku. |
| `backend/watchdog_api/db/repositories/field_reference.ts`, `get`, `envelope`, `saveApproval`, `revoke` | Hash opisu jest przeliczany, aprobata wiąże się z zawartością; nie aprobuje osobnej reguły. |
| Ten sam plik, `list`; `backend/watchdog_api/field/service.ts`, `snapshot` | Wspólny katalog nie filtruje po właścicielu; etykieta principal w snapshocie nie zapewnia prywatnej własności jego rekordów. |
| `backend/watchdog_api/domain/approval.ts`, `ApprovableKind` | Brak osobnego rodzaju reguły CLINICAL. Nie używać `reference_mapping` jako zamiennika. |
| `docs/spec/07_EPICS_AND_TASKS.md`, E6.4/E6.5 | Oba zadania rzeczywiście pozostają otwarte. |

Przeczytano kontrakt agenta, koordynację, końcowy handoff fali, stan i ledger,
DESIGN_RULES, ECOSYSTEM, CONVERSATION_DELTA oraz wskazane moduły referencji.
Dwa niezależne audyty tylko do odczytu sprawdziły kontrakt i granice dostępu.
Nie przeprowadzano nowego przeszukiwania archiwów rozmów ani badań medycznych.

## Minimalny proponowany kontrakt E6.4a

To projekt kontraktu do przeglądu, nie istniejący eksport TypeScript ani gotowy
walidator. Pierwszy przepływ wybiera wyłącznie dostarczony `fixtureId`; nie ma
importu dowolnej historii ani swobodnych danych pacjenta.

Każdy semantycznie wymagany atrybut ma jawny stan:

```ts
type KnownOrMissing<T> =
  | { state: 'known'; value: T }
  | { state: 'missing'; reason: string };
```

Powód braku pochodzi z zamkniętej, wersjonowanej listy, np. `not_recorded`,
`not_measured`, `unknown`, `not_applicable`. Konflikt nie jest rodzajem braku
nadpisującym wartości: przechowujemy konkurencyjne obserwacje i ich relację.

| Obiekt | Wymagane pola i reguły |
| --- | --- |
| Przypadek | `schemaVersion`, `fixtureId`, `purpose: software-demonstration`, `revision`, `previousCaseHash`, `referenceTime: KnownOrMissing<timestamp>`, kontekst gatunku/populacji/setting, ekspozycje, leki, współchorobowości, obserwacje, hipotezy. |
| Kontekst | Każdy wymiar jako `KnownOrMissing<string>`; fikcyjne identyfikatory bez domyślnego człowieka/populacji/setting. |
| Ekspozycja i lek | Własne ID, `known` lub `possible`, substancje/klasy, jawny nieznany skład, droga i czas jako oddzielne `KnownOrMissing`, źródło fixture. Status `known` oznacza wyłącznie wiedzę zapisaną w fikcyjnym scenariuszu. |
| Obserwacja | ID, abstrakcyjna wielkość, osobno wartość, jednostka, czas zdarzenia i pomiaru; `reported` lub `measured`; źródło; `contradicts[]`; `supersedes` lub null. |
| Hipoteza | ID; typ `substance`, `class`, `mixture`, `unknown_composition`, `comorbidity` lub `non_toxicological`; jawne odsyłacze do składników i przesłanek. |
| Wygląd próbki | Oddzielna opisowa przesłanka, bez automatycznego utworzenia potwierdzonej ekspozycji lub składu przypadku. |

Walidacja: strict objects; skończone liczby; ograniczenia długości i rozmiarów;
unikalne ID; istniejące odsyłacze; brak samoodniesień i cykli supersession.
Znana liczba z brakującą jednostką jest poprawnym **niekompletnym** przypadkiem,
który później daje `undetermined`. Istniejący walidator referencji odrzuca taki
zapis próbki, dlatego nie można bezpośrednio użyć go do przypadku.

Supersession jest jawne, w tej samej wielkości/semantyce obserwacji; starsze
obserwacje pozostają w historii. Bez reguły „najnowsza wygrywa”. Kilka aktywnych
obserwacji pasujących do jednego wejścia oznacza niejednoznaczność, chyba że
reguła wskazuje dokładne ID. Jawny nierozstrzygnięty konflikt używanego wejścia
blokuje obliczenie; interpreter nie wybiera wygodniejszej wartości.

Przykładowa obserwacja do fixture (fragment, nie kompletny przypadek):

```json
{
  "id": "observation-a",
  "quantityId": "fixture:q-alpha",
  "value": {"state": "known", "value": 2},
  "unit": {"state": "known", "value": "fixture:u-alpha"},
  "eventTime": {"state": "known", "value": "2026-01-01T00:00:00Z"},
  "measurementTime": {"state": "missing", "reason": "not_recorded"},
  "mode": "reported",
  "sourceId": "fixture:source-a",
  "contradicts": [],
  "supersedes": null
}
```

Scenariusz ma zawierać fikcyjne A/B, mieszaninę A+B, ekspozycję o nieznanym
składzie, współchorobowość i alternatywę nietoksykologiczną. Żaden wynik reguły
nie usuwa którejkolwiek hipotezy. Nie są to rzeczywiste substancje ani diagnozy.

## Minimalny proponowany kontrakt E6.4b

Reguła zawiera wersję schematu i treści, ID, znacznik demonstracji, dokładne
`referenceId/contentHash`, applicability, dependencies, typowany predykat,
powiązaną hipotezę oraz znaczenie każdego wyniku. Dependencies deklarują
wielkość, dokładną jednostkę, dozwolone `reported/measured`, wymagane zegary
i okno względem jawnego czasu odniesienia przypadku. Brak tego czasu przy zależności
czasowej daje `undetermined`. Nie używają czasu systemu.

Pierwszy interpreter: pojedyncze porównanie liczbowe `eq/lt/lte/gt/gte` do
abstrakcyjnej stałej w tej samej fikcyjnej jednostce. Stała jest danymi reguły,
nie zaszytym progiem w kodzie. Bez `eval`, JS, modeli językowych, ilościowej PK
i konwersji jednostek. Nieznana jednostka pozostaje niezgodnością.

Przegląd jest osobnym obiektem z dokładnym `ruleHash`, identyfikatorem
przeglądającego i zakresem `synthetic_fixture_test`. W testach może istnieć
fikcyjny reviewer, jawnie oznaczony jako fixture. Nie tworzy to rzeczywistej
aprobaty człowieka przez istniejące API ani zgody medycznej. Dedykowane źródła
fixture i reguły nie są automatycznie importowane do wspólnego katalogu.

| Sytuacja | Applicability | Wynik | Wykonanie |
| --- | --- | --- | --- |
| Zgodny kontekst, wszystkie zależności spełnione, predykat prawdziwy | `applicable` | `supported` | `evaluated` |
| Jak wyżej, predykat fałszywy | `applicable` | `contradicted` | `evaluated` |
| Brak wartości/jednostki/wymaganego czasu lub konflikt wejścia | `applicable` | `undetermined` | `blocked`, szczegółowe przyczyny |
| Niezgodny gatunek/populacja/setting | `inapplicable` | `undetermined` | `blocked`, bez predykatu |
| Brak wymiaru kontekstu | `undetermined` | `undetermined` | `blocked` |
| Zmieniona/cofnięta/niezatwierdzona reguła albo źródło | Niezależnie wyliczony status kontekstu | `undetermined` | `blocked`, przyczyna gate |

Brak reguły to `no_rule`, nie `contradicted` ani dowód braku interakcji.
`supported` znaczy wyłącznie zgodność z określoną fikcyjną regułą, nie
identyfikację substancji, diagnozę, prawdopodobieństwo ani skuteczność kliniczną.

Ślad zachowuje case/rule/reference/executor hashes, wejścia (w tym odrzucone
ID i przyczynę), wszystkie sprawdzenia zależności, uporządkowane operacje,
applicability, wynik, braki oraz ograniczenia. Przy wielu brakach pokaże wszystkie,
zamiast kończyć na pierwszym. Zależności i wyniki sortowane po stabilnych ID;
kolejność operacji jest semantyczna. Nie sortować arbitralnie historii.

`canonicalHash` i `canonicalizeJson` można wykorzystać po ścisłej walidacji.
Ich traktowanie `undefined` jak null nie może maskować nieobecnych pól.
`executorHash` przypina rzeczywiste bajty executora, walidatora i jego zależności
lub weryfikowalny manifest modułów/lockfile; samo `executor-v1` nie wystarcza.
UUID, czas audytu i aktualny stan uprawnień pozostają poza deterministycznym
artefaktem. Zmiana danych tworzy nowy hash, nigdy nie poprawia starego śladu.

Nowe wykonanie wymaga bieżącego odczytu aprobaty źródeł i reguły. Historyczny
snapshot offline nie spełnia tego warunku, gdyż celowo opóźnia wiedzę o cofnięciu.
Odtworzenie historycznych obliczeń to osobna operacja sprawdzająca integralność
archiwum; nie reaktywuje cofniętej reguły. Odczyt/replay wymaga aktualnego prawa
do wszystkich ujawnianych danych. Zapisany dawny reviewer nie nadaje tego prawa.
Przy trwałym serwisie potrzebne jest ponowne sprawdzenie rewizji uprawnień/źródeł
przed zapisem wyniku, aby wykluczyć cofnięcie podczas asynchronicznego odczytu.

## E6.5a — dopiero po odbiorze powyższego rdzenia

Osobny wersjonowany `SyntheticTestProfile` opisuje test ID, abstrakcyjną wielkość,
dokładną jednostkę, availability, zakres setting oraz wymagania czasowe i inne
jawne ograniczenia. `FieldProfile` pozostaje bez zmian. Profil nie nadaje praw.

Selector przyjmuje zweryfikowany trace i profil. Uwzględnia tylko brakujące
zależności aktualnie kwalifikujących się reguł: osobno zatwierdzonych, ze zgodnym
kontekstem i aktualnymi źródłami. Brak kontekstu, cofnięta aprobata lub konflikt
obserwacji pozostają osobnymi lukami; nie tworzą automatycznego zlecenia pomiaru.

Propozycja zawiera test/profile hash, dependency IDs, rule hashes, referencje,
powód i założenia. Jedna propozycja może grupować kilka identycznych zależności,
z zachowaniem wszystkich odsyłaczy. Test niedostępny, ze złą jednostką lub
niezgodnymi ograniczeniami nie trafia do propozycji; luka pozostaje widoczna.
Nie sugerować przyszłego testu jako naprawy brakującej jednostki, czasu zdarzenia
lub czasu pomiaru historycznej obserwacji. Nowy pomiar kwalifikuje się tylko,
jeżeli jego rzeczywisty czas pozyskania może spełnić wymagane okno zależności;
w przeciwnym razie pozostaje luka historyczna. Dostarczenie brakujących
metadanych to inny typ działania.

Zmiana profilu zmienia propozycje/profile hash, nie caseHash, pomiary, reguły ani
uprawnienia. Bez entropii, rankingu probabilistycznego, priorytetu terapeutycznego
i wywołania urządzeń. E5.7b nie jest zależnością tego wycinka.

## Propozycja rozłącznego przydziału dla integratora

**Nie jest to opublikowany claim.** Proponowana baza jest zweryfikowana, ale
integrator musi potwierdzić ją i poniższe ścieżki przed zmianami kodu.

| Etap / piszący | Dokładne proponowane pliki |
| --- | --- |
| Schema i fixture | `shared/clinical_demo.ts`, `shared/clinical_demo_validation.ts`, `tests/helpers/clinical_demo.ts` |
| Interpreter, po kontrakcie | `backend/watchdog_api/clinical_demo/executor.ts`, `backend/watchdog_api/clinical_demo/executor_manifest.ts` |
| Selector, po dependencies i odbiorze | `shared/clinical_demo_profile.ts`, `shared/clinical_demo_selector.ts` |
| Testy dedykowane | `tests/unit/clinical_demo_case.test.ts`, `tests/unit/clinical_demo_executor.test.ts`, `tests/unit/clinical_demo_profile.test.ts` |
| Demonstracja lokalna | `scripts/demo_clinical.ts` |
| Dokumentacja pakietu | `docs/work_packages/CLINICAL.md`, `docs/work_packages/CLINICAL_AUDIT_2026-09-30.md` |

Pierwszy etap jest czystym rdzeniem fixture w pamięci i odtwarzalnym eksportem.
Nie deklaruje trwałego przypadku. API, migracja, rozszerzenie rodzaju aprobaty,
nawigacja, wspólne profile i globalny ledger mają osobnych właścicieli.
Ich zakres wymaga dodatkowego przydziału, zanim powstanie integracja UI.
UI powinien zostać kontekstowo osadzony w obecnym obszarze referencji.

## Walidacja rzeczywiście wykonana na bazie

Zależności skopiowano z istniejącej instalacji tego samego repo; lockfile bez
zmian. Nie jest to test świeżego `npm ci`. Testy używały własnego checkoutu
i izolowanych baz. Kod aplikacji nie został zmieniony.

| Polecenie | Wynik |
| --- | --- |
| `npm run lint` | Exit 0. |
| `npm run build` | Exit 0; zachowane ostrzeżenia bundlera, w tym trzy `import.meta` przy wyjściu CJS. |
| `node --import tsx --test tests/integration/field_reference.test.ts tests/integration/field_shell.test.ts tests/unit/field_ui.test.ts` | Exit 0; **26/26 pass**, zero fail/skipped/cancelled. |
| `node --import tsx --test tests/e2e/workbench_field.test.ts` | Exit 1; **0/6 pass**, sześć błędów wspólnego startu: brak standardowego Chromium headless shell rewizji 1234. |

Dodatkowa próba uruchomienia istniejącego lokalnego Chromium przez
`chromium.launch({executablePath: "/tmp/watchdog-browser/chrome-linux64/chrome"})`
również zakończyła się błędem (exit 1, SIGABRT): `socket() failed: Operation not
permitted`. Nie obchodzono ograniczenia środowiska.

Nie są to testy E6.4/E6.5, bo kod tych wycinków nie powstał. Nie uruchamiano
pełnej bramki integratora. Historyczne 434/434 z PR #5 pozostaje historycznym
wynikiem fali, nie wynikiem tego checkoutu.

Planowane polecenia po przydziale (pliki testów jeszcze nie istnieją):

```sh
node --import tsx --test tests/unit/clinical_demo_case.test.ts
node --import tsx --test tests/unit/clinical_demo_executor.test.ts
node --import tsx --test tests/unit/clinical_demo_profile.test.ts
node --import tsx scripts/demo_clinical.ts
```

Macierz odbioru: identyczność canonical bytes/replay; zmiana każdego wejściowego
hasha; osobne braki wartości/jednostki/obu czasów; niewłaściwy gatunek i setting;
nieznane operatory/jednostki; konflikt i supersession bez utraty historii;
pozostawienie mieszaniny i alternatyw; brak krawędzi i wygląd bez wniosku o
tożsamości; osobna aprobata reguły; cofnięcie/zmiana każdego źródła i reguły;
niezmienność historycznego trace; zmiana profilu bez zmiany przypadku/praw.

Przy trwałym zapisie osobne testy wymagają dwóch właścicieli, restartu, stale
revision, eksportu z aktualnym dostępem i nieobecności przypadku w snapshotach
referencji. Przy UI potrzebny dedykowany produkcyjny browser flow: fixture →
trace → braki → profil → wynik z jawnym oznaczeniem demonstracji. Istniejący
workbench_field.test.ts sam nie sprawdzi przyszłego przepływu.

## Bloker i pierwsze następne działanie

**CLINICAL-COORD-1:** brak przydziału integratora wymaganego w instrukcji
startowej i `docs/WORK_COORDINATION.md`. Gotowy do przyjęcia zakres jest powyżej;
nie potrzeba nowego wyboru architektury przez właściciela projektu. Integrator
publikuje potwierdzony base SHA, przydział plików oraz owner `clinical-20260930`.
Następnie pracownik publikuje właściwy claim i zaczyna E6.4a od walidatora,
fixture oraz testu zachowania niekompletnej obserwacji.

**CLINICAL-BROWSER-1:** standardowa lokalna regresja browser nie wystartowała.
Przed odbiorem UI wymagane działające Chromium i rzeczywisty nowy przepływ;
nie zastępować tego sukcesem lint/build ani testem renderowania.

Bez rzeczywistych przypadków, progów medycznych, porad terapeutycznych,
płatnych wywołań, kontaktowania osób i zmian zasad publikacji referencji.
