# WatchDog — uzgodnienia, sprzeczności i pominięcia

Stan rekonstrukcji: 30 września 2026. Ten dokument wykorzystuje audyt rozmów przekazany do
bieżącej sesji oraz dokumenty i kod w repozytorium. Nie jest drugim przeszukaniem archiwów.
Daty historycznych ustaleń pochodzą z audytu; bez zachowanego tu lokatora surowej wiadomości
nie podajemy ich jako dosłownych cytatów. Interpretacja asystenta nie jest decyzją właściciela.

Dokument opisuje wymagania i ich konflikty. Bieżący stan implementacji i wyniki testów
znajdują się w [stanie projektu](spec/00_STATE_AND_DECISIONS.md) i
[rejestrze zadań](spec/07_EPICS_AND_TASKS.md). Nowe kryteria w
[regułach projektowych](DESIGN_RULES.md) pozostają oczekiwaniami do zweryfikowania, dopóki
handoff nie potwierdzi wykonania.

## Obowiązujący kierunek

WatchDog ma być ogólnym warsztatem pozyskiwania danych, odtwarzalnej analizy i pracy badawczej.
Substancje psychoaktywne oraz JH16 są pierwszymi konkretnymi zastosowaniami. Nie wyznaczają
trwałej listy dozwolonych dziedzin, źródeł ani metod. Jednocześnie ogólność architektury nie
oznacza, że dostępne już są dowolne analizy lub replikacja dowolnej publikacji.

Ostatni układ produktu obejmuje siedem głównych obszarów: pulpit, dane i źródła, ręczne
analizy/wykresy/mapy, zbieranie cykliczne, projekty badawcze, analizę metodologii publikacji
i replikację oraz przeszukiwalną bazę wiedzy. Konfiguracja, uprawnienia, przegląd dowodów
i diagnostyka pozostają potrzebne, ale nie uzasadniają piętnastu równorzędnych wejść w menu.

Upoważnienie z 30 września pozwala samodzielnie kontynuować rutynowe, odwracalne prace,
łączyć istniejące funkcje i aktualizować dokumentację. Nie jest zgodą na zmianę zamrożonej
metody naukowej, dopisywanie pomiarów, płatne wydatki ani usuwanie historii. Dawne ograniczenia
procesu pracy trzeba oceniać w ich pierwotnym etapie, zamiast używać ich jako stałego zakazu.

Istniejące role są zestawami zdolności, a nie prostą hierarchią. W bieżącej kontynuacji
operacyjny admin może przygotować i unieważnić zaproszenie (`principal.invite`), natomiast
developer/dev zatwierdza przyjęcie, nadaje profile i odbiera dostęp (`principal.manage`).
Przyjęcie zaproszenia składa wniosek; sam link nie nadaje profilu. Instalacja musi mieć
odpowiedni bootstrap właściciela, bo samo `admin` nie wystarcza do zatwierdzania wniosków.
Jest to opis obecnego kontraktu wdrożeniowego, nie wsteczne przypisanie każdej nazwy roli
do wcześniejszych wypowiedzi właściciela.

## Rzeczywiste rozbieżności i ich konsekwencje

| Temat | Co się rozchodzi | Klasyfikacja i obecne rozstrzygnięcie |
| --- | --- | --- |
| Kolory dowodów | W rozmowach z 2025 r. zmieniał się opis zieleni/oliwki, raportów użytkowników i przewidywań. W audycie zapisano ponowną korektę z 2 maja 2026: kolory nie miały ograniczać się do trzech, a raporty i synteza LLM były ponownie rozróżniane innym układem barw. Repo opisuje sześć rodzajów oraz uproszczenie ratownicze do trzech. | **Nierozstrzygnięta prezentacja, nie sprzeczny model danych.** Zachować sześć rodzajów i osobny profil wyświetlania. Trzykolorowy widok nie jest potwierdzoną zgodą właściciela tylko dlatego, że specyfikacja tak go opisuje. |
| Rodzaj dowodu a wiarygodność | Korekta właściciela z 15 września 2025 oddzielała obiektywność/subiektywność od wiarygodności i przydatności dla eksperta. Spec/10 nadal opisuje rodzaj dowodu jako odpowiedź na pytanie o zaufanie. | **Przesunięcie znaczenia w dokumentacji.** Rodzaj dowodu opisuje sposób ustanowienia twierdzenia. Nie wyznacza uniwersalnej wiarygodności, relewancji ani prawdopodobieństwa. |
| Wagi 1 / 0,75 / 0,5 / 0,25 / 0,1 | W historii pojawiła się propozycja syntezy rodzajów dowodów w jeden wynik. W specyfikacji została zachowana jako kandydat. | **Propozycja, nie zatwierdzona metoda.** Nie implementować automatycznej punktacji bez jawnej semantyki, walidacji, założeń zależności i przeglądu metody. |
| Czerwień propozycji LLM | W sierpniu 2026 czerwony znacznik sygnalizował brak zatwierdzenia propozycji; czerwień w klasyfikacji dowodów oznacza również spekulację. | **Dwa niezależne znaczenia.** Zatwierdzenie i rodzaj dowodu muszą mieć osobne etykiety. Przejście PROPOSED → APPROVED nie zmienia przewidywania w pomiar. |
| PK/PD na górze a kolejność kolorów | Właściciel wskazał, że PK/PD mają pozostać wysoko także wtedy, gdy konkretna informacja jest przybliżona/przewidywana. | **Jawna korekta wcześniejszego uproszczenia.** Pozycja kategorii nie może zależeć od koloru. PK/PD nie otrzymują automatycznie zieleni. |
| Prawdopodobne alternatywy a zawężanie | We wrześniu 2025 właściciel chciał wyróżniania bardziej prawdopodobnych możliwości bez zasłaniania pozostałych. Późniejsza dyskusja z września 2026 opisywała deterministyczne ograniczanie hipotez. | **Zgodne dopiero po określeniu granic.** Zachować alternatywy i mieszaniny. Wykluczenie wymaga kompletnego, adekwatnego wejścia i przejrzystej reguły; brak danych lub krawędzi nie wyklucza substancji. Żaden obecny przykład asystenta nie dostarcza gotowej reguły klinicznej. |
| Region a globalny wygląd próbki | Wcześniejszy lookup był lokalny z opcjonalnym kontekstem regionów nadrzędnych. Późniejsze wymaganie obejmuje podobne próbki na świecie, przy zachowaniu miejsca/czasu jako kontekstu. | **Późniejsze rozszerzenie zakresu.** Dodać osobne globalne kandydatury. Nie mieszać ich z lokalnym mianownikiem ani nie wnioskować z podobieństwa o tożsamości, składzie lub trasie dystrybucji. |
| Zielona tabletka z X | Scenariusz ilustrował ścieżkę od wyglądu do rzeczywiście oznaczonego składu oraz interakcji w kontekście miejsca i czasu. Asystent potrafił sprowadzić go do zielonego znaku medycznego albo zielonej wiarygodności. | **Błędna interpretacja przykładu.** Nie ograniczać systemu do zielonych tabletek, znaku X ani jednego symbolu produktu. Kolor próbki i kolor rodzaju dowodu są różnymi danymi. |
| Logowanie odłożone do E4 | Pierwotna kolejność rozwoju odkładała uwierzytelnianie, aby uruchomić pierwszy przepływ. Później powstało OIDC/RBAC, a 21 września właściciel jawnie wymagał logowania, aplikacji o dostęp i zaproszeń. | **Ograniczenie etapu zostało zastąpione.** Dokończyć admission. Zweryfikowany email nie oznacza przyjęcia do przestrzeni; odebranie dostępu działa na aktywnej sesji. |
| Bez kreatora/trybów a późniejsza konfiguracja | Wczesny prosty interfejs i demonstracja statyczna nie potrzebowały rozbudowanego Settings. Późniejsze ustalenia obejmowały kreator oraz proste/standardowe/eksperckie ustawienia. | **Różny etap i późniejszy zakres.** Zachować działające ustawienia i stopniowe odsłanianie opcji. Nie traktować wymagań PoC jako zakazu dla pełnego produktu. |
| E1 jako jedyny wycinek | Stary kontrakt agenta blokował rozszerzanie E1. Aktualne repo zawiera już warsztat, badania, automatykę i ratownika, a właściciel zlecił szersze prace. | **Przestarzała instrukcja procesu.** Kończyć aktualne wycinki wraz z testami, bez resetowania projektu do E1. Integralność naukowa nadal obowiązuje. |
| Graf jako zaplecze a obowiązkowy ekran | Właściciel rozwijał relacje i graf wiedzy, lecz profesjonalny widok grafu miał pozostać opcjonalny. | **Pozorna sprzeczność.** Model relacji może służyć wielu widokom. Nie wymuszać manipulowania grafem do importu, wyszukiwania, statystyki ani planowania zadania. |
| Około siedmiu a co najmniej dziesięć profili LLM | Kolejne wypowiedzi zwiększały oczekiwaną liczbę/zakres profili i różnicowały koszt oraz zadanie: tanią obróbkę, semantykę relacji użytkowników, trudniejsze rozumowanie. | **Późniejsze rozszerzenie, nie stała liczba providerów.** Profile zadań i endpointów to konfiguracja. Ich liczba nie dowodzi działających kont, pokrycia ani testów na żywych płatnych usługach. |
| LLM nie liczy a proponuje kod | Zakaz dotyczył drogi liczbowej. Późniejsze pomysły dopuszczały generowanie adapterów lub kodu, pod warunkiem testów i odpowiedniej izolacji. | **Różne operacje.** Propozycja kodu nie jest pomiarem. Obecne kopiowanie JSON/CSV jest deklaratywne; nie reklamować gotowego wykonywania dowolnego kodu LLM. |
| Odtworzenie na danych autorów a niezależna replikacja | Wcześniej mówiono ogólnie o replikacji JH16; później wyraźnie odróżniono użycie oryginalnych liczb i samo-sprawdzenie od nowego materiału. | **Korekta rodzaju twierdzenia.** Oryginalne dane dają reanalizę/self-check. Proxy, panel ekspercki i dane syntetyczne są jawnymi wariantami o różnej wartości potwierdzającej. |
| Wszystkie aktywne substancje a pion narkotykowy | W repo pierwsze źródła i ontologia są narkotykowe. Właściciel mówił także o innych toksynach i dalszych domenach biologicznych/radiologicznych. | **Zastosowanie nie jest granicą silnika.** Zachować rozszerzalne kontrakty, lecz nie deklarować gotowych adapterów ani bezpieczeństwa w tych przyszłych domenach. |
| Wszystkie pobrania a tylko zmiany/heartbeat | Jedne ustalenia wymagają pełnej historii raw, drugie opisują oszczędny monitoring. Istnieją też propozycje retencji/purge. | **Częściowo zgodne, retencja pozostaje otwarta.** Każda próba ma osobny event; identyczny payload może być jeden fizycznie. Badawcze archiwum i monitoring mogą mieć różne profile. Nie interpretować tego jako zgody na nieodwracalne kasowanie istniejących surowych danych. |
| Legalny dostęp a pomysły obchodzenia ograniczeń | We wcześniejszej dyskusji występowały szare scenariusze/symulowanie człowieka. Późniejsze wymaganie wyraźnie obejmuje transparentny i uzgodniony dostęp do społeczności. | **Późniejsze wymaganie oraz rozdzielenie wypowiedzi właściciela od pomysłów modelu.** Widoczność strony/API nie jest zgodą na dowolne pozyskanie. Nie przejmować rotacji tożsamości czy fikcyjnych person z podsumowania asystenta. |
| Publiczny kod a prywatna instalacja | Historycznie rozdzielano usługę, źródła i publikowanie kodu. Aktualne repo jest publiczne i ma dokumenty licencji, a wymóg konkretnej instalacji pozostaje prywatny. | **Dwa niezależne zakresy.** Publiczne repo nie daje dostępu do kont, kluczy, danych ani przestrzeni badawczej. Ta rekonstrukcja nie jest zleceniem zmiany widoczności repo lub interpretacją prawną licencji. |
| ChatADHD i ekosystem a cały produkt w czacie | [ECOSYSTEM.md](../ECOSYSTEM.md) opisuje możliwość interfejsu badawczego i sterującego oraz dwukierunkowe używanie zdolności. | **Brainstorm, nie hurtowe zlecenie integracji.** Nie wymusza jednej aplikacji/bazy/ontologii ani zastąpienia map i wykresów czatem. Wybór konkretnego połączenia wymaga rzeczywistego kontraktu i testu. |

## Ustalenia, które wcześniej ginęły w podsumowaniach

- **Najpierw uniwersalne prymitywy, potem branżowy profil.** System ma pracować na różnych
  tabelach, seriach, źródłach i pytaniach. Lista bieżących Erowid/psychonaut źródeł nie jest
  zamkniętym zakresem nauki.
- **Linki i tożsamość wyników, nie tylko liczby.** Porównywanie wyszukanych stron może
  ujawnić nakładanie się zbiorów. Sama różnica liczników nie opisuje tego samego zjawiska.
- **Języki, slang i fałszywe trafienia.** Alias ma kontekst: ice, crack czy snow mogą
  oznaczać coś innego. Wykrywanie języka nie ustala pochodzenia osoby ani geografii badania.
- **Hierarchia geograficzna.** Miejscowość, gmina, prowincja/region, kraj, kontynent i
  poziom globalny są różnymi zakresami, niezależnymi od języka i uprawnień.
- **Cykliczne zadania miały cel badawczy.** Codzienny monitoring, m.in. Noord-Brabant i
  literatury, miał łączyć odkrycia z pytaniami, projektami i analizą. Scheduler sam nie
  dostarcza wskazanego źródła, Scholar ani pełnego tekstu.
- **Źródła i metody powinny być poznane przed automatyzacją.** Wpis do katalogu oraz
  instrukcja od modelu nie zastępują sprawdzenia struktury, zakresu, jednostek i dostępu.
- **Nieustalone hipotezy również mają być zachowane.** Potrzebne są twierdzenia jawne
  i niejawne, sprzeczności oraz brakujące powiązania; nie tylko wygodna lista potwierdzeń.
  Automatyczny podział eksploracji/potwierdzenia i korekty rodzin porównań pozostają osobnymi
  zadaniami, nie wynikiem samego uruchomienia korelacji.
- **Pigułki odłożone nie zostały porzucone.** Wątek był czasowo przesuwany, a później
  ponownie otrzymał priorytet. Kolor i logo prowadzą do próbki i cytowanego oznaczenia,
  nie stanowią oznaczenia chemicznego.
- **Ograniczenie 10 wyników było źle przypisane.** Audyt odnotował korektę właściciela
  z 16 kwietnia: oczekiwał 50 zamiast 10. Nie ustanawia to jednej wartości dla wszystkich
  ekranów. Domyślny limit, całkowita liczba i dalsze strony powinny być jawne i konfigurowalne.
- **Wątki korespondencji i pomysłów wdrożeniowych** bywały niewidoczne w powierzchownym
  przeglądzie historii. Nie są automatycznie normatywnym projektem UI, listą kont użytkowników
  ani zgodą na kontakt. Dane osób z prywatnych rozmów nie są potrzebne w publicznej specyfikacji.
- **Dawki, interakcje, odtrutki i pierwsza pomoc wymagają cytowanego korpusu.** Nie istnieją
  dlatego, że asystent podał przykładową odpowiedź. Nie wolno wypełniać luk liczbami z LLM.
- **Pamięć pracy obejmuje niedokończone zadania i korekty.** Projekt, bibliografia,
  zależności i zamrożony pakiet powinny przetrwać sesję; eksport jednego wyniku nie zastępuje
  pełnego projektu badawczego.

## Granice obecnej kontynuacji

Autonomiczne prace mogą domknąć nawigację, wspólne wyszukiwanie, admission/uprawnienia,
trwałe projekty i rozdzielenie lokalnego/globalnego kontekstu wyglądu. Istniejące deterministyczne
obliczenia i przepływy publikacji pozostają ich podstawą. Nowy ekran nie jest dowodem pełnego
wykonania ogólnego programu badawczego.

Nadal odrębnych kontraktów i walidacji wymagają: dowolna publikacja → wykonywalna metoda,
pełny DAG transformacji, zaawansowane szeregi czasowe/przyczynowość, żywe Google Trends,
automatyczna niezależna replikacja, kliniczny model przypadku i interpretacja PK/PD,
integracje urządzeń oraz generowane wykonywalne moduły. Nie wprowadzamy identyfikujących
danych pacjentów ani fikcyjnych odczytów urządzeń do działającej ścieżki.

Przed wybraniem wariantu trzeba zapisać jego źródło, zakres i kryterium ponownego rozważenia.
Profile są sposobem zachowania rzeczywistych alternatyw, a nie obietnicą obsługi każdej
hipotetycznej kombinacji. Decyzja wykonawcza z 30 września nie może być retrospektywnie
opisana jako wcześniejsza zgoda właściciela na konkretną skalę kolorów czy metodę statystyczną.
