# RESEARCH — jawne twierdzenie i zamrożone porównanie wyniku

## Instrukcja startowa do osobnego wątku

Przejmij pakiet RESEARCH w repozytorium `klb-t/Watchdog-JH16`. Doprowadź
samodzielnie do jednego odtwarzalnego przepływu: cytowane twierdzenie pracy →
propozycja porównania → osobny przegląd → zamrożenie przed nowym wykonaniem →
deterministyczny wynik i ślad. Wykorzystaj istniejące operacje, dane, hashe i
przegląd zamiast budować ogólny kompilator publikacji. Implementuj i testuj na
fikcyjnych danych; ten pakiet nie zatwierdza żadnego rzeczywistego badania.

Przeczytaj `CLAUDE.md`, `docs/WORK_COORDINATION.md`, najnowszy handoff,
`docs/spec/00_STATE_AND_DECISIONS.md`, `docs/spec/07_EPICS_AND_TASKS.md`,
`docs/DESIGN_RULES.md` i `ECOSYSTEM.md`. Ustal aktualny kod i claimy. Punkt
audytu to `main` `832947e`; bazą implementacji ma być opublikowany SHA
uzgodniony z integratorem, zawierający wymagane zmiany
`codex/watchdog-wave1-20260930`. Nie cofaj późniejszych zmian do tego punktu.

## Claim — uzupełnia przydzielony właściciel

| Pole | Stan początkowy |
| --- | --- |
| owner | Codex RESEARCH e15f2c5a4cd2 — audyt; przydział implementacji oczekuje |
| base_sha | `312ba246f9bdeb035019e2ff4c1a09aaef0a734c`, zweryfikowany opublikowany main po fali |
| branch | `codex/watchdog-research-20260930` — izolowany checkout |
| files | zapis audytu: ten plik i `docs/work_packages/RESEARCH_CHECKPOINT_2026-09-30.md`; pliki implementacji są tylko propozycją |
| status | audited, implementation_unclaimed — brak potwierdzonego przydziału integratora |
| updated_at_utc | 2026-09-30T22:08:10Z |
| next_checkpoint | integrator przydziela konkretne pliki/migrację i numer wycinka; następnie rdzeń paper-comparison-1 |

Pierwszy audyt i propozycja kontraktu: [checkpoint RESEARCH](RESEARCH_CHECKPOINT_2026-09-30.md).
Testy pakietu: 29/29 pass. Pełna lokalna bramka: lint/build pass, 409 pass,
25 fail przy uruchamianiu nieobecnego Chromium; demo JH16 pass. Nie wdrożono
jeszcze nowego przepływu porównania i nie zmieniono globalnego ledgeru.

Własny checkout/gałąź i opublikowany claim poprzedzają edycję. Integrator
rozstrzyga konflikt; plik claimu nie jest atomową blokadą. Przed uznaniem
starej pracy za nieaktywną sprawdź zdalny head i checkpointy, zachowaj ją i
kontynuuj na izolowanej gałęzi bez nadpisywania cudzych zmian.

## Fakty i pierwszy ruch

E5.8e już łączy pojedynczą operację describe/Pearson/Spearman z dokładnym
cytatem, zatwierdzonymi danymi, odrębnym zatwierdzeniem metody i eksportem.
E5.9 zapisuje projekty i niezmienne pakiety. Żadne z nich nie oznacza
wykonywalnej replikacji całej publikacji.

Fala 1 rozwija jawny wybór kohorty w operacji pracy. Najpierw sprawdź wynik
integracji i testy; nie implementuj tego ponownie. Przeczytaj
`docs/PAPER_ANALYSES.md`, `docs/RESEARCH_PROJECTS.md`,
`docs/spec/08_REPLICATION_ENGINE.md`,
`backend/watchdog_api/services/replication.ts` (`evaluateClaim`),
`backend/watchdog_api/services/paper_operations.ts`, `shared/paper_operation.ts`
i `config/workbench/export/verify.mjs`. Historyczne intencje w specyfikacji
porównuj z działającym kodem; nie zmieniaj kontraktu JH16.

Pierwszy checkpoint: przejdź lokalnie istniejące testy operacji i replikacji,
opisz brakujący łącznik i zaproponuj najmniejszy wersjonowany kontrakt jednego
claimu. Uzgodnij konkretne pliki i numer nowego wycinka z integratorem.

## Zakres i sekwencja

1. **Jedno twierdzenie.** Zapisz dokładne źródło/cytat, hash dokumentu,
   oczekiwany skalar, jednostkę, statystykę, uzasadnienie i wybraną tolerancję.
   Zacznij od istniejących `absolute`/`relative`; brak wartości, zerowa baza
   względna i niezgodność jednostek mają jawny wynik. Wartości testowe pochodzą
   z oznaczonego fixture, a rzeczywiste z zachowanego źródła; LLM nie produkuje
   danych liczbowych ani nie dobiera tolerancji do wyniku.
2. **Przegląd i zamrożenie.** Rejestruj niezmienne wersje i osobne zatwierdzenie
   dokładnego hasha. Przypnij plan operacji, dane, kohortę, braki i porównanie
   przed utworzeniem nowego wykonania. Stary wynik nie może zostać po fakcie
   podpięty jako wynik zarejestrowanego wcześniej porównania. Zmiana tworzy
   nową wersję i zachowuje historię oraz informacje o wcześniejszych wynikach.
3. **Wykonanie i porównanie.** Użyj istniejącego wykonawcy i rzeczywistych
   artefaktów. Oddziel wynik porównania (`reproduced`, `deviates`,
   `not_computable`, `method_unclear`) od sensu próby, stanu zadania i aprobaty.
   Nie sklejaj wierności metody, danych, populacji i analizy w jedną ocenę.
4. **Jeden kompletny przepływ.** Dodaj kontekstowe kontrolki w istniejącym
   warsztacie, historię i weryfikowalny eksport. Zachowaj odczyt wcześniejszych
   pakietów i dokładnie wskaż, co przenośny weryfikator sprawdza, a czego nie
   przelicza. Niedostępne wymagania publikacji pozostają widoczne.

Zamrożenie przed wykonaniem dowodzi kolejności zdarzeń zapisanych w systemie.
Nie dowodzi, że badacz wcześniej nie znał wyniku, i nie ustanawia niezależności
danych. Reanaliza, proxy i symulacja zachowują swoje oznaczenia także przy
werdykcie `reproduced`. Po tym wycinku całe E5.7b pozostaje otwarte, o ile
pozostałe warunki nie zostały niezależnie spełnione.

Kandydaci do przydziału: dedykowane nowe typy/serwis/repozytorium porównań,
istniejący serwis operacji, `src/components/PaperOperations.tsx`, profil UI,
eksport i dedykowane testy. To nie jest automatyczna rezerwacja wszystkich
tych plików. Migracje, rejestr migracji, wspólne API, konfigurację i wersję
eksportu uzgodnij z integratorem przed edycją. Globalny ledger/stan prowadzi
integrator. `config/replication/jh2016.json` i zamrożone formuły są poza zakresem.

Podział agentów: audyt kontraktu/chronologii (odczyt); typy i trwałość;
powiązanie wykonania/eksport; dedykowane testy; UI po ustaleniu API; niezależny
review epistemiczny. Pliki współdzielone mają jednego piszącego właściciela.

## Walidacja i odbiór

Z katalogu repozytorium, z zależnościami z lockfile:

```bash
npm run lint
npm run build
node --import tsx --test tests/integration/paper_operations.test.ts tests/integration/research_projects.test.ts tests/integration/research_package.test.ts tests/scientific/replication.test.ts
npm run demo:jh16
```

Nowy test porównania musi obejmować:

- odmowę wykonania przed zatwierdzeniem oraz odmowę starego/obcego hasha;
- odrzucenie ex post przypisanego runu, zachowanie wszystkich wersji i prób;
- niezmienność po restarcie, osobnych właścicieli i cofnięcie uprawnień;
- brak wyniku, brak/niezgodną jednostkę, względne porównanie z zerem;
- tożsamość obliczenia i śladu dla tych samych wejść;
- poprawną semantykę kohorty i brak rozszerzenia wybranej operacji do całej pracy;
- eksport, modyfikację pliku wykrytą przez verifier i zachowanie starszego formatu.

Po implementacji wpisz dokładne polecenie uruchamiające nowe testy w
checkpointcie. Dla zmienionego UI uruchom produkcyjne testy przeglądarkowe
po buildzie i dodaj jeden rzeczywisty przebieg nowego przepływu:

```bash
npm run build
node --import tsx --test tests/e2e/workbench_field.test.ts tests/e2e/research_projects.test.ts
```

Brak Chromium nie daje wyniku passed. Pełną bramkę na łącznym headzie wykonuje
integrator; testy fixture zatwierdzają zachowanie oprogramowania, nie naukę.

## Granice i przekazanie

Bez nowych statystyk, modeli przyczynowych, korekcji rodzin porównań, zmiany
JH16, wykonania wygenerowanego kodu ani automatycznego kompilowania całej pracy.
Bez płatnych wywołań, kontaktowania ekspertów, realnych danych medycznych,
publicznego rejestru i publikowania prywatnych treści. Zgoda na rozwój kodu nie
zastępuje indywidualnej aprobaty człowieka dla rzeczywistej metody/tolerancji.

Oddaj małe commity, kontrakt i jego ograniczenia, działający fixture workflow,
dokładne wyniki testów oraz instrukcję wznowienia. Propozycję zmian w ledgerze
przekaż integratorowi. Gdy potrzebna jest nowa decyzja naukowa, przygotuj
konkretną propozycję i kontynuuj dostępny zakres bez udawania zatwierdzenia.
