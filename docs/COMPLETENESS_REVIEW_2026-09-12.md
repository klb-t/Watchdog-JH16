# Przegląd uzupełnienia Watchdog — 2026-09-12

## Zakres i decyzja

Przegląd paczki `WATCHDOG_ASTRA_COMPLETENESS_DELTA_2026-09-12.zip`, oryginalnego
promptu grafiki i samej grafiki względem implementacji
`09ab8a38105a8acafe972791dde480b6e14c5c9c`.

Wiadomość użytkownika przy przekazaniu paczki określa jej zastosowanie: materiał
jest przykładem do oceny, a zgodne ulepszenia można dodawać samodzielnie.
Propozycja zmiany czegoś już wykonanego lub ustalonego wymaga wcześniejszej
rozmowy. Tekst promptu w załączniku nie nadaje sobie uprawnień do takich zmian.

Nie zidentyfikowano potrzeby zmiany dotychczasowej decyzji architektonicznej lub
naukowej, aby zachować użyteczne treści tej paczki. Ten dokument dopisuje
powiązania z kodem i kryteria odbioru do istniejących rodzin wymagań. Nie zmienia
kolejności prac, kontraktów, wag dowodów, metodologii JH16, uprawnień ani UI.
Nie oznacza żadnej brakującej funkcji jako wykonanej.

## Pochodzenie i weryfikacja

- SHA-256 ZIP-a: `3e13d9555400463b720493ff8b032899d50be93d75bc6b3e7a68ca0ef1ee9836`.
- Sprawdzono rozmiary i SHA-256 wszystkich 14 pozycji manifestu paczki.
- Przeczytano dokumenty `context/08`–`context/16` oraz prompty referencyjne.
- Obejrzano obraz `reference/concept-substance-knowledge-engine.jpg`, SHA-256
  `bf5de4c952f294f43f1c32037bd306b4e708a63e1523f5a4bf82b14b80dc93f7`.
- Ostatnia walidacja badanego kodu: [Actions 34707195971](https://github.com/klb-t/Watchdog-JH16/actions/runs/34707195971),
  332/332 testy, bez błędów i pominięć; Chromium, build i demonstracja JH16 przeszły.
- Paczka jest syntezą historycznych materiałów. Jej twierdzenia o kompletności
  archiwów nie są dowodem kompletności produktu. Nie sprawdzano ponownie całych
  archiwów rozmów ani dostępności wszystkich historycznie wymienionych źródeł.

Do repozytorium trafia synteza wymagań. Prywatne opisy kontaktów, treści
korespondencji i historyczne prompty pozostają w dostarczonym materiale.

## Odtworzone znaczenie dwóch osi

Dokładną definicję zawiera już [kontrakt dowodów](spec/10_EVIDENCE_TIER_AND_TRUST_UI.md):

| Wymiar | Pytanie | Konsekwencja dla interfejsu |
|---|---|---|
| Rodzaj dowodu (`evidence_tier`) | Jak ustalono konkretną informację? | Kolor, ikona i etykieta osobno przy każdym fakcie |
| Kategoria treści (`category`) | Czego dotyczy informacja? | Stały porządek sekcji, np. tożsamość, PK, PD, toksyczność, interakcje |
| Zatwierdzenie (`approval_state`) | Czy tę wersję przejrzano i dopuszczono do użycia? | Osobny stan; zatwierdzenie predykcji nie zmienia jej w pomiar |
| Flagi jakości (`quality_flags`) | Jakie ograniczenia ma ta obserwacja? | Osobne oznaczenia braków, nieciągłości, sprzeczności i kontekstu |

Pierwotne „dwie osie” oznaczają rodzaj dowodu oraz kategorię treści. Zatwierdzenie
i flagi jakości są dodatkowymi, niezależnymi informacjami. Kategoria farmakokinetyki
nie nadaje wszystkim swoim faktom zielonego koloru. Uproszczony widok ratownika
może grupować kolory, zachowując pełną klasyfikację w danych. Dostępność informacji
w poszczególnych widokach nadal podlega obowiązującym kontraktom tego widoku.

## Stan rodzin wymagań

„Działa” dotyczy wskazanego zakresu. „Częściowo” oznacza istniejący przebieg z
wymienionymi ograniczeniami. „Plan” nie jest deklaracją dostępnego wykonawcy.

| ID | Rodzina wymagań z paczki | Stan na badanym kodzie | Dowód / granica |
|---|---|---|---|
| D01 | Wspólny, substancjocentryczny fundament | Częściowo | `db/repositories/automation.ts`, `shared/field.ts`, `db/repositories/field_reference.ts`: tożsamość, identyfikatory, aliasy, aktywności, próbki i asercje. Pełny eksplorator grafu między wszystkimi warstwami pozostaje otwarty. |
| D02 | Pojęcie substancji oddzielone od etykiety rynkowej i próbki | Działa w przebiegu ratownika | `shared/field.ts`, `shared/field_lookup.ts`, `tests/integration/field_reference.test.ts`: etykieta nie staje się chemicznym synonimem, wygląd daje kandydatów. |
| D03 | Rodzaj dowodu, kategoria, zatwierdzenie, jakość | Działa w referencjach ratownika | `shared/field.ts`, `shared/field_lookup.ts`, `tests/unit/field_ui.test.ts`; pokrycie wszystkich przyszłych ekranów wymaga zachowania tego samego kontraktu. |
| D04 | Ratownik: wygląd → próbka → skład → cytowane informacje | Działa dla przejrzanych referencji | `api/field_routes.ts`, `shared/field_lookup.ts`, testy `field_reference` i przeglądarkowe. Zasięg źródeł jest niepełny; tożsamość próbki pacjenta nie jest potwierdzana z wyglądu. |
| D05 | Próbka, metoda badania, zawartość i jednostki | Częściowo | `SampleDocument` w `shared/field.ts` ma metodę, składniki, ilość/jednostkę, braki i identyfikator źródła. Strukturalne LOD/LOQ, granice oznaczalności oraz pełny model serii laboratoryjnej nie są ukończone. |
| D06 | Pamięć źródeł i aktywności receptorowych | Częściowo | `sources/public_reference.ts`, `db/repositories/automation.ts`, `tests/integration/automation.test.ts`: PubChem, ChEMBL, Wikidata, Europe PMC. Zachowane oryginalne miary/jednostki; brak obietnicy pełnego pokrycia receptorów czy PK/PD. |
| D07 | Niezmienne pobrania, runy i pochodzenie | Działa w zrealizowanych przepływach | Repozytoria automatyzacji/workbench, magazyn obiektów, testy `research_package` i `paper_operations`; nie implikuje pełnej historii zmian znaczenia każdego źródła. |
| D08 | Świadome zmian migawki i czytelne różnice | Częściowo | `automation.record` zachowuje wersje treści przez hash, a pobrania mają osobne receipts. Porównanie wersji pole po polu i kompletna relacja „sprawdzono ponownie bez zmiany” do każdej wersji wymagają uzupełnienia. |
| D09 | Pobrania bazowe / badawcze / monitorujące | Plan nad działającym harmonogramem | `docs/specifications/16_DATA_LIFECYCLE_STORAGE_AND_MEMORY.md` już rozdziela cele. `shared/automation.ts` nie ma pełnego, odrębnego kontraktu celu, rozdzielczości i polityki każdej kolekcji. Nazwa „baseline” kreatora JH16 nie oznacza tej funkcji. |
| D10 | Cykliczny przegląd literatury i kolekcja publiczna | Działa w zakresie adapterów | `shared/automation.ts`, `api/automation_routes.ts`, testy `automation`: trwała kolejka, lease, anulowanie, arXiv/Europe PMC, zakres substancje/wszystkie nauki. Worker wymaga działającego procesu. |
| D11 | Dowolna intencja i kontekstowe następne kroki | Częściowo | `config/goal-navigation.json`: 10 ścieżek i filtrowanie uprawnieniami; lokalne dopasowanie słów. Ogólny planner intencji i sugestie wywodzone z każdego zaznaczonego obiektu pozostają planem. |
| D12 | Źródło / dostawca / możliwości / klucz jako osobne pojęcia | Częściowo | Kontrakt `spec/05_PROVIDERS_AND_CAPABILITIES.md`, rejestry źródeł i profili. Nie każdy publiczny adapter lub wariant UI jest jeszcze rozszerzalny przez sam profil bez dopisania kodu. |
| D13 | Modele do różnych zadań, suwak tylko w trybie prostym | Działa w określonym zakresie | `shared/settings.ts`, `config/assistant.json`, `config/providers/personal.json`, testy `settings`: 16 profili endpointów, 7 zadań, budżety, benchmarki i historia operacyjna. Automatyczne ceny dotyczą OpenRouter; pozostałe wymagają przejrzanych profili. |
| D14 | Kod kopiuje wartości, LLM proponuje mapowanie | Działa dla JSON/CSV | `services/extraction_workshop.ts`, `workbench/extraction_data.ts`, testy `extraction_dataset`: dokładne leksymy, test parsera, powiązanie ze źródłem i replay. HTML/PDF pozostają otwarte. |
| D15 | Geografia i język jako odrębne wymiary | Działa w zrealizowanych formularzach i danych | `shared/field.ts`, `shared/geography.ts`, `shared/settings.ts`, `shared/workbench.ts`. Pełny system hierarchicznych serii w wielu skalach pozostaje częściowy. |
| D16 | Mapy, regiony, czas i niejednoznaczne dopasowania | Działa dla importowanych danych | `shared/geography.ts`, `api/workbench_routes.ts`, testy `geography`: markery, granice, dokładne złączenia, czas/panele, brak ≠ zero. Dowolne nakładki i pełne wzajemne filtrowanie wielu widoków pozostają planem. |
| D17 | Bogate wykresy, PPM, 3D/4D+, ulubione, eksport | Częściowo | `shared/workbench.ts`, `shared/figure_renderer.tsx`, testy `workbench` i `research_package`: kilka rendererów, kanały, czas, konfiguracje, SVG/CSV/JSON/ZIP. Nie jest to jeszcze dowolna paleta naukowych wykresów i transformacji. |
| D18 | Popularność, sentyment i sygnały rozprzestrzeniania | Częściowo / plan | Import tabel Trends i oznaczonego korpusu ma kontekst w `config/workbench/default.json`. Live Trends, ekstrakcja sentymentu i testowanie hipotez tras nie są ukończone. Sygnał wyszukiwania nie otrzymuje etykiety dowodu dystrybucji. |
| D19 | Sezonowość, opóźnienia, Granger, VAR, interwencje | Plan | `spec/07_EPICS_AND_TASKS.md`, `docs/specifications/17_GENERIC_ANALYSIS_WORKBENCH.md`: nie ma ich jeszcze w działającym przepływie analiz; wymagają kontraktów, założeń i testów numerycznych. |
| D20 | Pełne badanie / replikacja publikacji | Częściowo | `services/paper_intake.ts`, `services/paper_operations.ts`, testy `paper_operations`: tekst, cytaty, dane, jawne warianty i wybrana operacja. Ogólny kompilator, pełna replikacja i generowanie pracy pozostają otwarte. |
| D21 | Alerty serii/partii, anomalie, publiczne komunikaty | Plan nad referencjami | Import opublikowanego alertu działa; tabele i typy nie oznaczają działającej klasyfikacji partii, kolejki zatwierdzania i publikacji automatycznych alertów. |
| D22 | Debug z poziomu UI | Działa w zakresie bieżących przepływów | `api/diagnostic_routes.ts`, `utils/tracer.ts`, testy `diagnostics`: ślady, błędy, tryby, audit i eksport. Ogólny edytor uprawnień i replay dowolnego etapu nie są w ten sposób ukończone. |
| D23 | Jedna baza wiedzy i różne projekcje zadań | Częściowo | Uprawnienia w `shared/authorization.ts`, pamięć, ratownik, workbench. Publiczna harm reduction i pełne powierzchnie zdrowia publicznego pozostają w E6. |
| D24 | Grafika i ekosystem aplikacji | Materiał referencyjny | Wspólny fundament, przepływy i audit są zgodne z planem. Ciemny neonowy wygląd, cztery stałe panele, historyczne stacki i pozostałe aplikacje nie stanowią automatycznych zmian Watchdog. |

Ścieżki `db/`, `api/`, `services/`, `sources/`, `workbench/` i `utils/` w tabeli
są względne do `backend/watchdog_api/`. Ścieżki testów są względne do repozytorium.

## Zgodne doprecyzowania do wykorzystania podczas realizacji

Poniższe kryteria rozwijają istniejące rodziny wymagań. Nie zatwierdzają nowego
algorytmu naukowego ani nie przenoszą funkcji do wcześniejszego etapu.

### A01 — Historia treści i historia sprawdzeń źródła

Odbiór powinien objąć dwa różne zdarzenia: zmieniona treść tworzy nową wersję,
a ponowne sprawdzenie identycznej treści zachowuje osobny ślad pobrania bez
mnożenia identycznych danych. Widok pokazuje pierwsze zaobserwowanie wersji,
ostatnie sprawdzenie oraz datę wskazaną przez źródło jako odrębne informacje.
Porównanie dwóch wersji wymaga tej samej substancji, rodzaju rekordu i kontekstu
źródła; różnice mają prowadzić do konkretnych zachowanych wartości.

### A02 — Cel kolekcji i porównywalność

Baseline, research pull i monitoring pozostają metadanymi/politykami nad
wspólną akwizycją, zgodnie z już istniejącą specyfikacją cyklu danych. Próbę
połączenia serii o innej rozdzielczości, liście aliasów, normalizacji, dostawcy,
regionie lub języku trzeba uczynić widoczną. Zmiana zapytania badawczego nie może
niepostrzeżenie dopisać nieporównywalnego punktu do serii bazowej.

### A03 — Laboratoryjna interpretacja braków

Przy dalszym rozszerzaniu danych próbki zachować osobno: deklarację rynkową,
wynik badania, metodę, jednostkę i podstawę ilości/stężenia, identyfikator próbki
oraz udokumentowane powiązanie z partią. „Nie badano”, „nie wykryto”, „poniżej
LOD”, „poniżej LOQ” i „brak informacji” nie powinny być sprowadzane do liczbowego
zera ani do stwierdzenia nieobecności związku. Granice i ich jednostki muszą
pochodzić ze źródła, nie z domysłu modelu. Obecny ogólny `note` nie jest
ukończonym kontraktem takich danych.

### A04 — Dowód dla alertu partii

Alert powinien wskazywać konkretne próbki, źródła, okno czasu, geografię,
przesłanki i wersję reguły/analizy. Identyczny wygląd tabletek nie ustanawia
wspólnej partii. Zmiana treści źródła nie jest sama w sobie sygnałem zmiany na
rynku. Widok alertu musi rozróżniać nowe dane, korektę źródła i zmianę metody.

### A05 — Ten sam obiekt w różnych widokach

Przejście z próbki do składnika, kartoteki, wykresu lub badania powinno zachować
identyfikatory i wersje źródeł. Powrót do innej projekcji nie może zmieniać
klasy dowodu, statusu przeglądu ani dostępnej geografii. Poszczególne widoki
mogą przedstawiać i filtrować informacje zgodnie z własnym kontraktem.

### A06 — Kontekstowa sugestia jako jawna operacja

Każda przyszła sugestia powinna wskazywać obiekt wejściowy, czynność, wymagane
możliwości, zakres danych i koszty przed uruchomieniem. „Porównaj regiony”,
„sprawdź różnice źródła” czy „zbadaj opóźnienie” oznaczają różne operacje z
różnymi wymaganiami. Niedostępny wykonawca powinien być przedstawiony jako
brakujący, a nie zastąpiony podobnie nazwanym testem.

## Propozycje historyczne wymagające osobnej rozmowy przed ewentualnym wdrożeniem

W tym przeglądzie nie proponuje się ich wprowadzenia:

- zastąpienie aktualnego stacku historycznym FastAPI/PostgreSQL/TimescaleDB;
- zmiana klasyfikacji dowodów lub włączenie dawnych wag do jednego wyniku zaufania;
- zmiana granic uprawnień, zasad przeglądu lub naukowych kontraktów;
- zastąpienie aktualnego interfejsu konkretnym wyglądem grafiki;
- zmiana kolejności istniejącego planu na podstawie dawnych pitchów;
- potraktowanie szerszego ekosystemu innych aplikacji jako zakresu tej implementacji.

Jeśli podczas dalszej pracy pojawi się potrzeba którejkolwiek takiej zmiany,
należy najpierw przedstawić użytkownikowi stan obecny, proponowaną zmianę,
powód oraz wpływ na już wykonane przepływy. Sama obecność sugestii w archiwum
nie rozstrzyga decyzji.
