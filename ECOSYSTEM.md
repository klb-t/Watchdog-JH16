# Ekosystem — koncepcje współpracy

> 2026-09-30 · Notatka z brainstormu. Możliwe kierunki, nie opis gotowych integracji ani zlecenie ich wdrożenia.

## 1. Wspólny opis ekosystemu

Projekty rozwijamy jako ekosystem wzajemnie użytecznych zdolności, a nie sztywny łańcuch aplikacji o rozłącznych rolach. Każdy może udostępniać innym wiedzę, narzędzia, sposoby interakcji i doświadczenia, a także z nich korzystać. Współpraca nie wymaga rezygnacji z samodzielnej użyteczności projektów.

**Najbardziej bezpośredni kierunek to ChatADHD jako interfejs do AGEDS oraz do części lub całości WatchDoga.** Nie tylko do zadawania pytań o wyniki, ale również do pracy z materiałem i kierowania zadaniami. Dalej można rozważać ChatADHD jako interfejs do pozostałych projektów. Szersza filozofia dopuszcza wszelkie możliwe powiązania interfejsów z danymi i sterowaniem: rozmowę, głos, graf, widok przestrzenny, gesty czy urządzenia. To horyzont koncepcyjny, nie obecny plan implementacji; czat nie musi zastępować innych interfejsów.

**Przepływ jest dwukierunkowy.** iOmatrix nie jest wyłącznie wejściem i wyjściem: może korzystać ze struktur wiedzy i pamięci rozwijanych w ekosystemie, np. do zapisywania nauczonych rzeczy o użytkowniku, jego słowniku, preferencjach, otoczeniu i sposobach działania. Wiedza ta nie musi należeć do interfejsu ChatADHD. Analogicznie inne projekty mogą wzajemnie korzystać ze swoich metod i doświadczeń.

Wspólne obszary do rozważenia to pamięć i kontekst pracy, schowek dla grafów i innych struktur, zaznaczanie nieostre, przechodzenie między reprezentacjami, pamięć korekt i niedokończonych zadań, pochodzenie informacji oraz przenoszenie nauczonych procedur. Obserwacja, wypowiedź użytkownika, hipoteza modelu i wynik działania pozostają rozróżnialne. Współdzielenie nie oznacza automatycznego dostępu do wszystkich danych ani uprawnień do działania.

Mapa obejmuje ChatADHD, iOmatrix (repozytorium Custom-Keyboard-Pro), Loom, AGEDS, WatchDog, program LEM i jego Workbench oraz PixelSpace AR. Otwarta pozostaje także na książkę/meta-książkę, wątki Legal Flow, narzędzia multimedialne i rekonstrukcję scen, agentów i avatar, DevBox i środowiska pracy, analizę archiwów oraz programy badawcze takie jak RCH. Dawny projekt może wrócić jako samodzielny produkt, współdzielona zdolność albo źródło metod; nie oznacza to automatycznego wznowienia wszystkich prac.

Nie rozstrzygamy tutaj jednej aplikacji, bazy, technologii, podziału repozytoriów ani ostatecznego modelu danych. Różne grafy nie muszą mieć tej samej semantyki. Zachowujemy alternatywy i szukamy rzeczywistych korzyści współpracy zamiast łączyć wszystko na siłę. Ta notatka nie zmienia bieżących priorytetów, kontraktów ani kryteriów gotowości funkcji.

## 2. Znaczenie dla WatchDoga

Punkt wyjścia: pozyskiwanie i analiza danych, odtwarzalne badania, pamięć źródeł oraz prezentacja wyników.

- **ChatADHD jako interfejs badawczy i sterujący:** formułowanie pytań, praca z materiałem, kierowanie zadaniami, dobieranie analiz i omawianie wyników. Integracja może obejmować część albo całość WatchDoga; nie ograniczamy jej z góry do odczytu raportów.
- **Wiele równorzędnych widoków:** rozmowa, wykresy, mapy, wyszukiwarka i warsztat analityczny mogą dotyczyć tego samego materiału. Zaznaczenie nieostre i schowek strukturalny mogłyby przenosić zakres zainteresowania między nimi oraz do iOmatrix i PixelSpace.
- **Zaplecze badawcze dla innych projektów:** metody zbierania źródeł, analizy publikacji, replikacji i porównywania hipotez mogą służyć LEM, RCH, agentom i dalszym programom badawczym. Ich pytania i doświadczenia mogą zwrotnie rozwijać warsztat WatchDoga.
- **AGEDS, Loom i LEM:** możliwe współdzielenie metod zachowania pochodzenia, reprezentowania relacji, sprzeczności i niepewności, bez mieszania surowych danych z interpretacją.
- **iOmatrix, książka i avatar:** nowe sposoby sterowania, dostarczania kontekstu oraz objaśniania wyników różnym odbiorcom. Wiedza o celu użytkownika pomaga określić pytanie i formę prezentacji, nie dopasowywać wynik do oczekiwań.

Niezależnie od interfejsu pozostają w mocy reguły odtwarzalności i integralności danych. Czat może proponować i objaśniać działania; narracja modelu nie zastępuje obliczeń ani pomiarów. Ogólny agent badawczy pozostaje kierunkiem rozwoju, nie deklaracją gotowej replikacji dowolnej publikacji.
