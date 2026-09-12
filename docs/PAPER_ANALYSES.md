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
Spearmana, na wszystkich wierszach jednego zbioru. Niepowiązane wymagania,
pozostałe operacje i niejasności pozostają w pakiecie. Zatwierdzenie wybranej
operacji nie zatwierdza całej pracy ani automatycznej interpretacji metodologii.

Przy cofnięciu zatwierdzenia danych lub metody nowe obliczenia i odczyt/eksport
historycznego wyniku zostaną zablokowane. Przebiegi już pobrane opisują stan
z chwili eksportu. Historię można ponownie otworzyć po odświeżeniu strony.

## Profile i rozszerzanie

Etykiety, rodzaje pochodzenia i opcje braków są w `config/paper-operation-ui.json`.
Walidator porównuje obsługiwane zasady z rejestrem wykonawców. Dodanie etykiety
nie dodaje implementacji obliczeń. Nowy wykonawca wymaga kontraktu i weryfikacji
numerycznej; ogólny kompilator całych prac pozostaje osobnym zadaniem.
