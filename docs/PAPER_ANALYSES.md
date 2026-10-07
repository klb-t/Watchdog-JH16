# Analiza powiązana z pracą

Otwórz **Warsztat replikacji → Analizy prac**. Możesz też wybrać **Powiąż operację
z danymi bez LLM** przy zapisanej publikacji. Ten przebieg nie wymaga klucza API.

1. Dodaj tekst pracy w zakładce **Prace i warianty**. Zapisany fragment zachowa
   oznaczenie fragmentu; abstrakt nie staje się pełnym tekstem.
2. Przygotuj dane w warsztacie statystycznym lub przekaż je ze sprawdzonego
   ekstraktora. Przejrzyj źródło, mapowanie, jednostki i braki, a następnie
   zatwierdź wersję zbioru.
3. W **Analizach prac** wskaż dokładny, jednoznaczny cytat i operację. Możesz
   użyć obsługiwanej operacji z zapisanej oceny metodologii. Ocena LLM zachowuje
   swój cytat i jest propozycją interpretacji do przeglądu.
4. Przypisz kolumny A/B, wyjaśnij ich znaczenie i ograniczenia. Określ pochodzenie
   każdej kolumny. Przy ocenie metodologii możesz powiązać wymaganie i zapisany
   wariant danych. Opisz odstępstwa i zakres wykonywanej części pracy.
5. Wybierz postępowanie z brakami. Korelacje obsługują wykluczanie niekompletnych
   par lub przerwanie analizy. Statystyki opisowe raportują liczby wartości
   dostępnych i brakujących, a miary liczą z dostępnych wartości. Nie ma imputacji.
6. Przygotuj plan i przeczytaj cytat, powiązania oraz dokładną specyfikację.
   Zaznacz przegląd i zatwierdź metodę. Zatwierdzenie dotyczy tej wersji planu.
7. Wykonaj analizę bez LLM. Historia przechowuje ukończone i nieudane wykonania.
   W zapisanym wyniku znajdziesz statystyki, liczebność, identyfikator przebiegu,
   ślad diagnostyczny i wersje danych/metody.
8. Pobierz pakiet z publikacją. Zawiera SVG, dane, metodę, wejścia, wynik, manifest
   wykonania i pełny dostarczony tekst pracy z kontekstem analizy. Przejrzyj te
   materiały przed udostępnieniem. Zapisz osobno pokazany SHA-256 manifestu.

Po rozpakowaniu pakietu sprawdź go poleceniem:

```sh
node verify.mjs . ZAPISANY_SHA256_MANIFESTU
```

Weryfikacja działa lokalnie bez sieci. Sprawdza integralność, cytaty, powiązania
kolumn oraz wejścia. Nie przelicza statystyk; do tego służy wskazana wersja
wykonawcy z repozytorium Watchdog. Sam hash wewnątrz archiwum nie poświadcza autora.

## Co oznacza wynik

| Oznaczenie | Znaczenie |
|---|---|
| `SCOPED_ANALYSIS_NOT_REPLICATION` | Wybrana operacja; replikacja całości nieustalona |
| `REANALYSIS_NOT_INDEPENDENT_REPLICATION` | Ponowne użycie oryginalnych danych |
| `EXPLORATORY_METHOD_VARIANT` | Istniejący inny zbiór, miara zastępcza lub nowy panel |
| `SIMULATION_NOT_EMPIRICAL_EVIDENCE` | Co najmniej jedno wejście zadeklarowano jako symulowane |

Pochodzenie jest deklaracją użytkownika. Zgodność pliku z zapisanym SHA-256
potwierdza tożsamość pliku, nie jego prawdziwość ani przydatność konstruktu.
Klasy dowodów w danych i zatwierdzenie metody są odrębnymi informacjami.

Każdy plan obejmuje obecnie jedną operację: statystyki opisowe, Pearsona lub
Spearmana, na wszystkich wierszach albo jawnie wybranej kohorcie jednego zbioru. Niepowiązane wymagania,
pozostałe operacje i niejasności pozostają w pakiecie. Zatwierdzenie wybranej
operacji nie zatwierdza całej pracy ani automatycznej interpretacji metodologii.

Przy cofnięciu zatwierdzenia danych lub metody nowe obliczenia i odczyt/eksport
historycznego wyniku zostaną zablokowane. Przebiegi już pobrane opisują stan
z chwili eksportu. Historię można ponownie otworzyć po odświeżeniu strony.

## Jawny dobór kohorty

Domyślnie plan obejmuje wszystkie wiersze. W polu **Wiersze objęte analizą** wybierz
**Jawnie wybrana kohorta**, podaj dokładny cytat dotyczący doboru oraz uzasadnienie
jego zastosowania do danych, a następnie zaznacz wiersze. Wyszukiwanie pomaga je
odnaleźć i nie zmienia wcześniejszego wyboru; lista pokazuje najwyżej 100 pasujących
wierszy. Pusta kohorta nie może zostać zapisana. Przy operacji z oceny LLM cytat musi
występować w faktycznie ocenionym fragmencie, a nie dopiero poza nim.

Przegląd pokazuje cytat, uzasadnienie, dokładne identyfikatory oraz liczebność przed
zastosowaniem zasad braków. Plan zamraża ten wybór; inny dobór tworzy nową propozycję
metody wymagającą własnego zatwierdzenia. Wartości i braki pozostają niezmienione,
a wykonawca zachowuje kolejność wierszy w oryginalnym zbiorze. Liczba pełnych par
w korelacji może być mniejsza od liczby wierszy kohorty.

Jest to deklarowana przez użytkownika kohorta eksploracyjna. Cytat potwierdza
pochodzenie tekstu, nie poprawność jego interpretacji ani reprezentatywność wyboru.
Zapis przed wykonaniem nie jest prerejestracją, a wybrane wiersze nie stają się
nietkniętą próbą potwierdzającą. Replikacja całości nadal pozostaje nieustalona.

Eksport nadal zawiera **cały zbiór, również pominięte wiersze**, i pełny dostarczony
tekst. `selected.csv` oraz wejścia statystyczne zawierają kohortę; wykres zachowuje
kontekst pozostałych punktów zgodnie z istniejącą semantyką zaznaczenia. Samodzielny
weryfikator sprawdza dokładny cytat, identyfikatory, powiązanie z metodą i wartości
wybranych kolumn. Obsługuje również wcześniejsze pakiety ze wszystkimi wierszami.

## Profile i rozszerzanie

Etykiety, rodzaje pochodzenia i opcje braków są w `config/paper-operation-ui.json`.
Walidator porównuje obsługiwane zasady z rejestrem wykonawców. Dodanie etykiety
nie dodaje implementacji obliczeń. Nowy wykonawca wymaga kontraktu i weryfikacji
numerycznej; ogólny kompilator całych prac pozostaje osobnym zadaniem.

## E5.7d — twierdzenie i zamrożone porównanie

Pod zapisanym planem dostępne jest **Porównanie z twierdzeniem pracy**. Wskaż
dokładny cytat twierdzenia, oczekiwaną wartość, jednostkę i statystykę oraz
uzasadnij interpretację i tolerancję bezwzględną albo względną. Tolerancja
względna jest proporcją (np. 0,1 oznacza 10%). Formularz nie sugeruje tolerancji
na podstawie wyniku. Nieznaną wartość lub jednostkę oznacz jako brak; nie wpisuj
zera w zastępstwie brakującej informacji.

1. **Zapisz niezmienną wersję porównania**. Wersja przypina źródło, cytat,
   operację, metodę, dane, kohortę i postępowanie z brakami. Zachowuje znane
   wcześniejsze wersje i wykonania, również nieudane; ekspozycja poza systemem
   pozostaje nieznana.
2. Przeczytaj zapisany claim, zaznacz osobny przegląd i wybierz **Zatwierdź tę
   wersję porównania**. To osobna czynność wobec zatwierdzenia metody i danych.
   Nie jest wymagany drugi człowiek ani przyznawane zatwierdzenie całej pracy.
3. **Zamroź porównanie i wykonaj nową próbę** zapisuje zamrożenie, a następnie
   tworzy nowy run z trwałym powiązaniem. Nie można dołączyć istniejącego runu
   po fakcie. Kolejność potwierdzają numery zdarzeń, także gdy czasy są identyczne.
4. Odczytaj wynik i pobierz pakiet. **Przygotuj kolejną wersję** zachowuje
   poprzednika oraz historię; zmiana nie poprawia wcześniejszego werdyktu.

Obsługiwane są Pearson, Spearman i średnia/mediana/odchylenie standardowe/
minimum/maksimum istniejącej operacji describe. Liczności describe pozostają
wyłączone, ponieważ dotychczasowy format przypisuje im jednostkę pomiaru.
Nie zmieniamy jednostek starych artefaktów. Porównanie wymaga dokładnego klucza
jednego skalara; nie wybiera dowolnej pierwszej liczby ani nie przelicza jednostek.

| Stan porównania | Znaczenie |
| --- | --- |
| reproduced | Wartość mieści się w zadeklarowanej tolerancji, z uwzględnieniem jej granicy |
| deviates | Wartość leży poza tolerancją; odchylenie pozostaje zapisane |
| not_computable | Brak wyniku albo niewykonalne porównanie, np. zerowa baza względna |
| method_unclear | Niejednoznaczny skalar, niezgodne/brakujące jednostki lub brak wymaganej interpretacji |

Wynik zawiera uporządkowane przyczyny. Niejednoznaczność metody/jednostek ma
pierwszeństwo przed brakiem liczby. Nieprawidłowe i nieskończone wartości są
odrzucane przed hashowaniem; przepełnienie obliczenia kończy próbę błędem,
zamiast zapisać pozorny werdykt. Stan wykonania FAILED jest odrębny od werdyktu.

Porównanie nie zmienia oznaczenia reanalizy, proxy ani symulacji. Wierność
metody, danych, populacji i analizy pozostaje osobno nieoceniona względem całej
publikacji. Zamrożenie dowodzi tylko kolejności zapisanej w tym systemie;
nie dowodzi wcześniejszej nieznajomości danych ani niezależności badania.

Kontrola wykonania wiąże konkretne zdarzenia zatwierdzenia porównania, metody
i danych. Cofnięcie i ponowne zatwierdzenie w trakcie zapisu przerywa próbę,
nawet jeśli hash danych i czas zegarowy się nie zmieniły. Wyniki związane ze
zastąpionymi aprobatami nie są ponownie udostępniane jako aktualnie zatwierdzone:
historia pozostaje, a nowe wykonanie otrzymuje nowe powiązanie. Przerwana próba
przeżywa restart z dotychczasowym stanem; system nie usuwa jej ani nie dopisuje
wyniku. Przeniesienie lokalnego właściciela na konto zachowuje pierwotnych
aktorów zapisanych w archiwalnych zdarzeniach.

### Weryfikowalny eksport porównania

Pakiet z porównaniem ma wersję `watchdog-research-package-2`, plik
`research/comparison.json` i objaśnienia w `COMPARISON.md`. Pakiety bez
porównania pozostają w wersji 1, a wcześniejsze konteksty operacji są nadal
odczytywane. Pełny tekst źródła i niewybrane wiersze nadal są w archiwum.

Weryfikator sprawdza dokładny cytat, plan i wejścia, hashe, zdarzenia przeglądu/
zamrożenia/runu oraz przelicza samo porównanie skalar–tolerancja. **Nie przelicza
statystyki źródłowej**, nie potwierdza tożsamości recenzenta ani wiarygodnego
zegara, nie ocenia naukowej poprawności. Zachowaj hash manifestu poza archiwum.

Deterministyczny rdzeń ma hash claimu, plan, wejścia, hash artefaktu wykonawcy,
wersję algorytmu i wynik porównania. Numery runów, śladów i czasy należą do
osobnej koperty zdarzeń. Dwie próby tej samej zamrożonej wersji i danych mają
identyczny rdzeń, lecz różne identyfikatory wykonania.

API pod `/api/research/comparisons` udostępnia utworzenie wersji, listę dla
`operationId`, odczyt `/:id`, osobne POST `/:id/approve`, `/:id/revoke`,
`/:id/execute` z dokładnym `expectedHash` oraz odczyt/eksport
`/:id/runs/:runId`. Właściciel pochodzi z sesji; zapis nie przyjmuje aktora
ani starego runu. Obowiązują istniejące uprawnienia method.propose,
workbench.analyze i method.approve oraz kontrola pochodzenia żądań.

E5.7d nie zamyka ogólnego kompilatora publikacji i replikacji E5.7b.

## Zamrożone rodziny porównań (E5.7b.1)

Rodzina to uporządkowana lista **zatwierdzonych** porównań E5.7d z jednej wersji
jednej pracy, zamrożona przed uruchomieniem. Utworzenie rodziny wymaga dokładnej
recenzji każdego członka; członek może wystąpić raz. Zapis rodziny i jej zdarzeń
jest niezmienny (wyzwalacze WORM w migracji 024).

Wynik zawsze pokazuje **wszystkich** członków względem zamrożonego mianownika:
zgodne w tolerancji, poza tolerancją, nie do policzenia, metoda niejasna, próba
nieudana, odrzucone przed uruchomieniem (np. cofnięta recenzja — z powodem),
w toku, jeszcze nieuruchomione. Liczby zawsze sumują się do mianownika. Nie
istnieje werdykt dla całej rodziny, test istotności ani korekta wielokrotności:
tolerancja każdego członka była recenzowana osobno, a to, ile zgodności
„wystarcza”, jest oceną człowieka. Uzasadnienie: pilotaże G1–G3
([PARALLEL_RESEARCH_GPT.md](PARALLEL_RESEARCH_GPT.md)) — wybór raportowanych
porównań po obejrzeniu wyników zawyża zgodność.

Próby wykonane przed zamrożeniem rodziny są ujawnione w `priorExposure`, ale nie
liczą się jako wynik rodziny. Ekspozycja poza systemem pozostaje `UNKNOWN`;
zamrożenie nie jest prerejestracją. Zmiana składu tworzy nową rodzinę z
`supersedes`; stara pozostaje czytelna z pełnym mianownikiem i wynikami, a widok
pokazuje „zastąpiona przez”. Ponowne wykonanie dopisuje próby; liczy się
ostatnia, wszystkie pozostają w historii. Werdykty są odczytywane przez
zweryfikowaną ścieżkę wyników E5.7d; jeśli nie da się ich potwierdzić (np. po
cofnięciu recenzji), członek ma stan „metoda niejasna” z powodem, nigdy „zgodne”.

API `/api/research/comparison-families`: lista dla `documentId`, POST utworzenia
(`documentId`, `title`, `rationale`, `members[{comparisonId, hash}]`,
`supersedes`), odczyt `/:id`, POST `/:id/execute` z `expectedHash`. Widok jest
kontekstowy w „Analizach prac”, pod porównaniem wybranego planu.

### Pakiet rodziny (E5.7b.1a)

GET `/api/research/comparison-families/:id/export` zwraca
`watchdog-comparison-family.zip` (format `watchdog-comparison-family-package-1`;
pakiety badawcze v1/v2 bez zmian): `family.json`, `events.json`, `summary.json`,
pełny pakiet E5.7d ostatniej ukończonej próby każdego członka w `members/N/`
oraz jawny powód dla członków bez pakietu (nieudane, odrzucone, nieuruchomione).
`node verify-family.mjs . [hash-manifestu]` działa offline, sprawdza wszystkie
bajty, uruchamia weryfikator każdego członka przypięty do jego hasha i od nowa
przelicza podsumowanie — sfałszowane podsumowanie odrzuca nawet przy poprawnie
przeliczonych hashach. Statystyk członków nie przelicza ponownie; zamrożenie nie
jest prerejestracją.

Poza zakresem: partycje potwierdzające (E5.7b.2) i zapis replikacji całej pracy
(E5.7b.3).
