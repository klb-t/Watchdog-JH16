# Pakiety badań

Pakiet łączy pytanie badawcze, cel, stan zadania i wybrane własne materiały. Każdy
zapis tworzy niezmienną wersję z hashem oraz odwołaniem do poprzedniej wersji.
Zmiana pytania, zakresu lub powiązania zachowuje wcześniejszy stan. To prywatny
warsztat i archiwum pracy; utworzenie pakietu nie zatwierdza metod, nie uruchamia
obliczeń i nie wydaje werdyktu replikacji.

## Praca w interfejsie

Otwórz **Projekty badawcze** (`/projects`), wpisz nazwę i pytanie, a następnie
dobierz materiały z własnego katalogu. Powiązaniu nadaj rolę oraz opis jego
znaczenia, różnic i ograniczeń. Zapisany tekst publikacji, propozycja metodologii,
zbiór danych, specyfikacja metody, zakończony wynik z manifestem, zapisany wykres,
zakończone zadanie zbierania i harmonogram mogą wejść do jednego pakietu.

Stan `DRAFT`, `ACTIVE`, `PAUSED`, `COMPLETED` albo `ARCHIVED` jest etykietą
organizacyjną wybraną przez właściciela. Oznaczenie `faithful`, `enhanced`,
`reanalysis`, `proxy` lub `simulation` też pochodzi od niego. Wierna próba nie
certyfikuje zgodności ze źródłem; reanaliza nie staje się niezależną replikacją;
symulacja nie staje się obserwacją empiryczną. Domyślne `unspecified` zachowuje
brak rozstrzygnięcia. Istniejące indywidualne zatwierdzanie danych i metod działa
niezależnie od pakietu.

Historia otwiera wersje tylko do odczytu. Każdy link zachowuje wybrany hash,
znaczenie powiązania, hash metadanych i listę przypiętych plików. Interfejs
osobno pokazuje zgodność bieżącego materiału, zmianę lub jego niedostępność.
Zmiana zatwierdzenia danych jest widoczna i nie przepisuje archiwalnej wersji.
Link do wykresu lub metody warsztatu przywraca dokładne ustawienia; nadal
obowiązują bieżące warunki dostępu i zatwierdzenia źródła. Inne metody mają
podgląd dokładnego własnego artefaktu z oczekiwanym hashem, bez podmiany na
benchmark JH16.

Katalogi wyświetlają po 50 pozycji, liczbę wszystkich wyników i kolejne strony.
Pakiet ma najwyżej 50 jawnych powiązań. To limit struktury pakietu, a nie
ograniczenie liczby znalezionych materiałów w katalogu.

## Harmonogram i wynik są odrębnymi powiązaniami

Powiązanie `schedule` jest **żywym wskaźnikiem na harmonogram**, z zachowaną
definicją i stanem włączenia z chwili zapisu. Przyszłe wykonania ani wyniki nie
są automatycznie dopisywane do pakietu. Aby utrwalić wynik konkretnej realizacji,
właściciel dołącza zakończony `job` lub wynik `run` w nowej wersji.

Hash definicji harmonogramu i jego bieżący stan operacyjny są odrębne. Wstrzymanie
przez pracownika po utracie uprawnień może zmienić stan operacyjny bez zmiany
przypiętej definicji. Pakiet pokazuje tę różnicę i zachowuje wcześniejsze dane.

## Prywatność i trwałość

API wymaga `method.propose`. Wszystkie odczyty projektu, historii, eksportu oraz
bezpośrednio dołączanego materiału sprawdzają bieżącego właściciela. Obcy projekt
i obcy materiał zwracają niedostępność, również po podaniu ich identyfikatorów.
Żądania modyfikacji przechodzą istniejącą kontrolę pochodzenia żądania.

Bezpośredni link do zbioru danych obecnie wymaga własności; zatwierdzenie
udostępnionego agregatu nie daje prawa do przejęcia go do własnego pakietu.
Własny wykres, metoda lub wynik mogą jednak zawierać odwołania do współdzielonego
źródła albo wspólnego benchmarku. Takie zależności pozostają odwołaniami:
system nie kopiuje automatycznie cudzych tabel ani ich prywatnych metod.
Własny zakończony wynik opiera się na swoim niezmiennym manifeście i własnych
artefaktach, także gdy wspólna metoda JH16 jest przypisana innemu użytkownikowi.

Rewizje i metadane plików mają blokady WORM w SQLite. Bajty źródeł i wyników
przechodzą weryfikację SHA-256 oraz trafiają do magazynu pod adresami zawartości.
Zapis ponownie sprawdza wszystkie materiały wewnątrz transakcji po odczycie
plików. Eksport ponownie sprawdza własność po odczytach. Przeniesienie danych
`local-user` do konta zachowuje hashe i archiwalne bajty; nie odtwarza uprawnień.

## Eksport i weryfikacja

**Pobierz tę wersję z manifestem i plikami** daje deterministyczny ZIP:

- `revision.json`: pytanie, stan, jawne znaczenie, historia hashy i metadane powiązań;
- `objects/<sha256>`: dokładne przypięte bajty zbiorów, wyników, manifestów i odpowiedzi źródeł;
- `project-manifest.json`: hashe, rozmiary plików i jawne ograniczenia archiwum;
- `verify.mjs`: niezależny weryfikator wymagający tylko Node.

Teksty publikacji i propozycje metodologii są zachowane w metadanych rewizji.
Eksport nie pobiera danych uwierzytelniania, kluczy, sesji ani rekordów tożsamości.
Treści źródłowe wpisane przez właściciela oraz oryginalne naukowe manifesty są
zachowywane jako źródła; archiwum nie jest procesem anonimizacji takich treści.
Nie dołącza przyszłych wykonań harmonogramu ani niepowiązanych zależności.

Po rozpakowaniu:

```bash
node verify.mjs . <hash-z-nagłówka-X-Package-Manifest-SHA256>
```

Nagłówek `X-Package-SHA256` identyfikuje cały ZIP. Weryfikator sprawdza osobny
hash manifestu, bajty wszystkich plików, tożsamość rewizji, hashe metadanych
powiązań i rozróżnienie harmonogramu od artefaktu. Bez zewnętrznego hasha mówi
wyłącznie o wewnętrznej spójności archiwum. Weryfikacja nie oznacza zatwierdzenia
naukowego ani werdyktu replikacji.

Profil `config/research_projects/mvp.json` opisuje nazwy, znaczenia i limit
archiwum. Domyślne 32 MiB obejmuje dokładny rozmiar ZIP: źródła, metadane UTF-8,
weryfikator, manifest i nagłówki archiwum. Zbyt duży pakiet jest odrzucany przed
zapisem rewizji; eksport również respektuje bieżący limit operacyjny.

## API

| Żądanie | Zachowanie |
|---|---|
| `GET /api/projects?limit=50&offset=0` | Profil i strona własnych projektów z liczbą wszystkich pozycji |
| `GET /api/projects/resources?kind=paper` | Strona własnych dostępnych materiałów danego rodzaju |
| `GET /api/projects/resources/:kind/:id?expectedHash=...` | Dokładny własny materiał; podany hash musi się zgadzać |
| `POST /api/projects` | Nowy projekt i pierwsza niezmienna rewizja |
| `GET /api/projects/:id` | Bieżąca rewizja i osobne stany aktualnych powiązań |
| `GET /api/projects/:id?revision=<hash>` | Dokładna własna historyczna rewizja |
| `GET /api/projects/:id/history` | Historia bez nadpisywania poprzednich wersji |
| `POST /api/projects/:id/revisions` | `{expectedHash, draft}`; stary hash jest konfliktem 409 |
| `GET /api/projects/:id/export?revision=<hash>` | ZIP przypiętej rewizji z dwoma nagłówkami SHA-256 |

Zapis przyjmuje `name`, `question`, `purpose`, `state`, `meaning` i `links`.
Każdy link zawiera `kind`, `id`, `expectedHash`, `role` i `notes`. Pusty lub
nieznany materiał nie jest odgadywany. Zakończony `run` wymaga manifestu;
niezakończony `job` nie jest zamrożonym wynikiem.

## Granice tej wersji

Pakiety organizują i utrwalają istniejące przepływy. Nie kompilują automatycznie
dowolnego artykułu do pełnej wykonywalnej replikacji, nie budują DAG-u transformacji,
nie generują brakujących danych i nie uruchamiają nowego harmonogramu przy zmianie
stanu zadania. Odtwarzanie pakietu przez import, współdzielona edycja i automatyczne
dołączanie wyników pozostają przyszłymi etapami. Aktualne pakiety zachowują dane
przez restart i można je zweryfikować niezależnie po wyeksportowaniu.

Walidacja: `tests/integration/research_projects.test.ts` oraz
`tests/e2e/research_projects.test.ts` obejmują własność, migrację właściciela,
wyścigi podczas I/O, blokady WORM, zgodność hashy, restart, harmonogramy,
kontrolę rozmiaru, rzeczywisty interfejs i samodzielny weryfikator ZIP.
