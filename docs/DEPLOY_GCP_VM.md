# Watchdog na istniejącej maszynie GCP

Ten instalator uruchamia zintegrowaną gałąź `main` na jednej, przeznaczonej dla Watchdoga
maszynie Compute Engine. Wykonujesz go w **Cloud Shell**, nie w terminalu SSH samej VM.
Instalacja nie wymaga klucza LLM. Domyślnie pozostaje prywatna przez IAP/SSH. Opcja
`--public --owner EMAIL` włącza konta i Caddy HTTPS; bez domeny używa adresu sslip.io,
a `--domain HOST` wybiera własną domenę. To opis działającego kodu i lokalnych testów;
nie jest protokołem odbioru rzeczywistej VM. Trybu local-user nie udostępniaj innym.

## Przygotuj VM

- Ubuntu 24.04 LTS lub Debian 12/13; obsługiwane również Ubuntu 22.04/26.04.
- Co najmniej 4 GB RAM; do budowania i testów sugerowane 2 vCPU / 8 GB RAM.
- Dysk 50 GB; instalator wymaga co najmniej 12 GB wolnego miejsca przed budowaniem.
- Jedna karta sieciowa, działający SSH i `sudo`. Instalator zamyka przychodzący ruch do tej
  VM, zostawiając SSH z IAP; użyj maszyny przeznaczonej dla Watchdoga.
- Wyjście do internetu do pobrania pakietów, obrazu Node, npm i Chromium. VM może mieć
  zewnętrzny IP z zamkniętym ruchem przychodzącym; bez zewnętrznego IP potrzebuje np. Cloud NAT.
- W trybie prywatnym nie otwierasz HTTP/HTTPS. `--public` dodaje scoped reguły 80/443 i zachowuje aplikację na loopback; 8080 nie jest publiczny.

Konto uruchamiające skrypt musi móc opisać VM, dodać tag, zmienić reguły firewalla i retencję
dysku, włączyć Compute/IAP oraz połączyć się przez IAP i SSH z `sudo`. W zależności od
konfiguracji projektu obejmuje to IAP Tunnel Resource Accessor oraz odpowiednie uprawnienia
Compute/OS Login; polityki organizacji mogą nakładać dalsze ograniczenia. Instalator nie
nadaje kontom nowych ról IAM. Shared VPC wymaga też uprawnień do firewalla w projekcie sieci.
Szczegóły połączenia: [oficjalny opis IAP](https://docs.cloud.google.com/iap/docs/using-tcp-forwarding).

## Instalacja

Otwórz Cloud Shell przyciskiem terminala w konsoli Google Cloud. Wklej:

```bash
git clone --branch main https://github.com/klb-t/Watchdog-JH16.git
cd Watchdog-JH16
bash scripts/deploy_gcp_vm.sh --project TWOJ_PROJEKT --zone TWOJA_STREFA --instance TWOJA_VM
```

Podmień trzy wartości, np. strefę na `europe-central2-a`. Nazwy wypisze też:

```bash
gcloud compute instances list --project TWOJ_PROJEKT
```

Jeśli masz już checkout, zamiast klonować drugi raz przejdź do niego i zaktualizuj
instalator z `main` (samo `git pull` na dawnej gałęzi kontynuacji nie pobierze integracji):

```bash
git fetch origin
git switch main
git pull --ff-only origin main
```

Repozytorium prywatne wymaga zalogowania GitHuba w Cloud Shell: `gh auth login`,
potem `gh auth setup-git`. Klucze i historia `.git` nie są kopiowane na VM.

`--plan` pokazuje zakres bez pobierania kodu i zmian w chmurze. `--ref PEŁNY_SHA` pozwala
wybrać konkretny commit; domyślnie skrypt pobiera wymienioną wyżej gałąź i zapisuje jej dokładny
SHA. Instalator oraz bootstrap muszą istnieć w wybranym commicie.

Skrypt:

1. Pobiera GitHub do lokalnego checkoutu, archiwizuje dokładny commit i wylicza SHA-256.
2. Dodaje tag `wd-NUMERYCZNE_ID_VM` i regułę SSH z `35.235.240.0/20` (priorytet 0).
3. Sprawdza IAP; dopiero potem dodaje reguły deny IPv4/IPv6 (priorytet 1) dla tego tagu.
   Nie edytuje wspólnych reguł VPC. Ponownie sprawdza IAP po zmianie.
4. Wyłącza automatyczne kasowanie dysku startowego przy usunięciu VM. Zachowany dysk
   nadal może generować opłaty. Nie tworzy nowej VM, NAT ani dodatkowych dysków.
5. Wysyła archiwum przez IAP, sprawdza jego SHA-256 i uruchamia bootstrap przez `sudo`.
6. Instaluje zależności i Docker z podpisanego repozytorium producenta. Wymaga Engine 28+
   ze względu na izolację portów localhost; istniejącego starego silnika sam nie usuwa.
7. Konfiguruje UFW: SSH tylko z IAP, domyślnie blokowany ruch przychodzący. Kontener
   dodatkowo publikuje **wyłącznie `127.0.0.1:8080`**, ponieważ Docker może omijać UFW.
8. Buduje obraz na Node 24, uruchamia typecheck, build i cały zestaw testów z Chromium.
   Poprzednia wersja aplikacji pracuje do ukończenia budowania.
9. Przy aktualizacji zatrzymuje usługę, tworzy spójną kopię bazy, blobów, konfiguracji i kluczy,
   po czym uruchamia nowy obraz. Sprawdza odpowiedź API i włącza start po restarcie.

Źródła szczegółów Docker: [instalacja Ubuntu](https://docs.docker.com/engine/install/ubuntu/),
[Debian](https://docs.docker.com/engine/install/debian/),
[publikacja portów](https://docs.docker.com/engine/network/port-publishing/).
Polityki organizacji, reguły o nadrzędnym priorytecie i inne usługi na istniejącej VM wymagają
oddzielnej oceny; te skrypty nie rekonfigurują całej organizacji GCP.

## Otwórz interfejs

Na końcu skrypt wypisuje komendę tunelu z właściwymi nazwami. Uruchom ją w Cloud Shell
i pozostaw terminal działający. Następnie **Web Preview → Preview on port 8080**.
Wejdź na `/setup`, uruchom kreator i w razie potrzeby podaj własne klucze.
Nie używaj publicznego IP VM jako adresu aplikacji.

Po zamknięciu Cloud Shell tunel znika, ale system i harmonogramy dalej działają na VM.
Kolejne wejście wymaga ponownego uruchomienia tunelu. Z komputera z `gcloud` ta sama
komenda udostępnia interfejs pod `http://127.0.0.1:8080`. Tunel nasłuchuje tylko na localhost.
Możesz zmienić lewy port 8080 na inny, jeśli jest już zajęty.

## Publiczne wejście z kontami

W Cloud Shell, z aktualnym checkoutem:

```bash
bash scripts/deploy_gcp_vm.sh --project TWOJ_PROJEKT --zone TWOJA_STREFA --instance TWOJA_VM --public --owner owner@example.test
```

Zastąp adres własnym. Opcjonalnie dodaj `--domain TWOJA_DOMENA` i skieruj DNS na VM.
Tryb publiczny wymaga zewnętrznego IP; skrypt rezerwuje go jako statyczny i otwiera
80/443 tylko dla tagu tej VM. To może generować koszty chmury. `--plan` pokazuje zakres.
Domyślnie host ma postać `IP-Z-MYSLNIKAMI.sslip.io`; dostępność DNS/ACME trzeba potwierdzić.

Na już zaktualizowanej VM przez SSH:

```bash
sudo watchdogctl enable-accounts owner@example.test
sudo watchdogctl enable-public TWOJ_HOST
sudo watchdogctl set-mail
sudo watchdogctl people
sudo watchdogctl proxy-logs
```

`enable-public` na samej VM konfiguruje host i UFW, ale nie zastępuje reguł GCP/DNS
ustanawianych przez instalator Cloud Shell. `enable-accounts` zachowuje pozostałe granty,
nie przenosi własności `local-user`, usuwa wyjątek otwartego trybu i wypisuje jednorazowy
link operatora. Jeżeli stary trwały override odwołał temu adresowi dostęp, napraw go
w istniejącym panelu zarządzania przed przełączeniem. `set-mail` pyta interaktywnie;
sekret SMTP nie jest argumentem procesu. Bez maila działa link operatora, nie kody e-mail.

`sudo watchdogctl disable-public` zatrzymuje proxy i zamyka UFW; pozostawia konta.
Reguły GCP i statyczny adres nie są automatycznie kasowane. Caddyfile/public-host oraz
app.env są w `/etc/watchdog`; certyfikaty w `/var/lib/watchdog-proxy`. Backup zawiera
konfigurację, moduł dostępu i jednostkę proxy, **nie cache certyfikatów**. Po izolowanym
restore aktywacja HTTPS wymaga ponownego uzyskania certyfikatu i odbioru instalacji.

Odbiór na realnej VM: HTTPS bez ostrzeżeń → logowanie → adresowe zaproszenie i poprawna
rola → cofnięcie w istniejącej sesji → restart z danymi → weryfikacja backupu i izolowane
odtworzenie → osobno kontrolowana aktywacja. Lokalny test skryptów nie zamyka tych punktów.
Nie używaj szerokiego wyjątku produkcyjnego local-user do ominięcia awarii logowania.

## Wspólna maszyna: WatchDog obok innych usług (`--shared-host`)

Domyślnie instalator zakłada maszynę tylko dla WatchDoga: zamyka na niej cały ruch przychodzący
poza SSH przez IAP, włącza zaporę z domyślną odmową i odmawia, gdy chodzą inne kontenery.
Gdy na maszynie ma działać więcej serwisów, dodaj do instalacji `--shared-host`. Wtedy:

- w VPC nie powstają reguły blokujące (tylko jedna reguła zezwalająca na SSH przez IAP);
- zapora na maszynie nie jest włączana ani zmieniana (jeśli już działa, dostaje tylko zgodę na SSH z IAP);
- inne kontenery nie przeszkadzają;
- WatchDog nasłuchuje tylko na `127.0.0.1:8080` (i na adresie prywatnym dla budzika), więc nie wystawia nic światu;
- instalacja zatrzymuje się z komunikatem, jeśli **port 8080 zajmuje inna usługa** albo istnieje cudzy
  kontener o nazwie `watchdog` / `watchdog-proxy` (unit usuwa kontenery o tych nazwach);
- nadal wymagany jest Docker 28+ i 4 GB RAM / 12 GB wolnego miejsca (minimum; przy 16–32 GB RAM
  i 50 GB dysku jest zapas na kilka usług).

Podawaj `--shared-host` przy **każdej** aktualizacji tej maszyny. Zmiana rozmiaru maszyny, jeśli
trzeba (VM musi być zatrzymana): `gcloud compute instances set-machine-type NAZWA --zone STREFA
--machine-type e2-standard-4` (16 GB) lub `e2-highmem-4` (32 GB); dysk można tylko powiększyć:
`gcloud compute disks resize NAZWA --zone STREFA --size 50GB`.

Uwaga: kto ma inne usługi na tej maszynie, musi pamiętać o skutkach usypiania opisanych niżej.

## Usypiana VM: stały adres, koszty tylko przy użyciu (E3.20)

Po instalacji z `--owner` (bez `--public`) uruchom w Cloud Shell:

```bash
bash scripts/deploy_gcp_gate.sh --project TWOJ_PROJEKT --zone TWOJA_STREFA --instance TWOJA_VM
```

Powstaje mały „budzik” na Cloud Run z adresem `https://watchdog-gate-…run.app`. To jest od teraz
adres WatchDoga: w zaproszeniach, linkach i mailach. Działanie:

- VM **sama się wyłącza** po 30 minutach bez użycia (`--idle-minutes N`, 10–1440), ale tylko gdy
  poza procesami systemowymi nic się nie dzieje. Maszyna zostaje włączona, jeśli: ktoś używa
  WatchDoga (zalogowane żądania, zadania zbierania danych; sprawdzanie gotowości przez budzik się
  nie liczy); jest otwarta sesja logowania (SSH, konsola); 15-minutowe obciążenie wynosi co
  najmniej 0,50 (`WATCHDOG_IDLE_MAX_LOAD` w `/etc/watchdog/idle.env`); z publicznego internetu
  trwa połączenie z jakąkolwiek inną usługą na maszynie (poza SSH i WatchDogiem; połączenia
  z sieci prywatnej, loopbacku i między kontenerami się nie liczą); trwa instalacja lub kopia
  zapasowa; nie minęło N minut od startu; albo ręcznie przytrzymasz ją komendą
  `sudo watchdogctl keep-awake GODZINY` (1–72; `off` zwalnia); albo inna usługa lub pulpit
  zdalny dotknął w ostatnich N minutach pliku w `/run/keep-awake/` (pulpit robi to sam, gdy ktoś
  przy nim pracuje — [REMOTE_DESKTOP.md](REMOTE_DESKTOP.md)). Odłączone pulpity zdalne i sesje
  tmux/screen nie liczą się jako sesja logowania. Gdy decyzja nie da się podjąć,
  maszyna zostaje włączona.
- **Inne usługi a usypianie:** budzik budzi maszynę tylko na adres WatchDoga. Usługa, której nikt
  nie używa przez pół godziny i która nie obciąża procesora, nie zatrzyma snu; jej użytkownicy
  zastaną wyłączoną maszynę. Takie usługi albo wystaw przez ten sam budzik (osobna reguła w
  `deploy/gate`, do zrobienia na życzenie), albo przytrzymaj maszynę `keep-awake`.
- **Zmienny adres IP:** zatrzymana maszyna traci zewnętrzny adres IP, jeśli nie jest statyczny.
  Wszystko, co dotychczas działało pod tym adresem (usługi na innych portach, DNS), po przebudzeniu
  będzie pod nowym. Zachowaj adres: `gcloud compute addresses create NAZWA --region REGION
  --addresses OBECNY_IP` (płatny także, gdy maszyna śpi).
- Wejście na adres, gdy VM śpi: budzik ją uruchamia i pokazuje stronę „Uruchamiam WatchDoga…”,
  która sama się odświeża (zwykle 1–2 minuty).
- **Harmonogramy zbierania danych:** Cloud Scheduler budzi VM co 6 godzin
  (`--wake-schedule "0 */6 * * *"`, czas warszawski). Zaległe terminy wykonują się po
  przebudzeniu raz (scalone), więc zadanie może się spóźnić najwyżej o odstęp budzenia.
- Budzik ma prawo wyłącznie odczytać i uruchomić **tę jedną** VM. Reguła firewalla wpuszcza
  na port 8080 tylko jego podsieć. Logowanie, uprawnienia i dane obsługuje wyłącznie aplikacja.

Koszty, orientacyjnie (sprawdź cennik GCP dla swojego regionu): za maszynę płacisz tylko za
godziny pracy. Dysk jest płatny stale (50 GB to kilka $ miesięcznie). Cloud Run, Cloud Scheduler
(do 3 zadań) i Cloud Build mieszczą się zwykle w darmowych limitach. Statyczny IP nie jest
potrzebny; jeśli wcześniej użyłeś `--public`, zwolnij go w konsoli (płatny także, gdy VM śpi).
Każdy, kto zna adres, może obudzić VM. Bez zalogowania nie utrzyma jej jednak włączonej: zaśnie
po czasie bezczynności.

Wyłączenie: `sudo watchdogctl disable-gate` na VM (VM zostaje włączona na stałe), potem usuń
usługę `watchdog-gate` i zadanie `watchdog-gate-wake` w konsoli.

## Diagnostyka: gdzie szukać, gdy coś nie działa

Nowa instalacja zapisuje **pełny ślad** (`WATCHDOG_DIAGNOSTICS_MODE=TRACE`) w
`/var/lib/watchdog/diagnostics/RRRR-MM-DD/`. Niezależnie od trybu (poza `OFF`) każdego dnia
powstają też pliki:

| Plik | Co zawiera |
|---|---|
| `requests.jsonl` | każde żądanie API: status, czas, kto, kod i komunikat błędu, `trace_id` |
| `server-errors.jsonl` | każdy nieoczekiwany błąd serwera z pełnym stosem i łańcuchem przyczyn |
| `process-errors.jsonl` | awaria procesu lub odmowa startu (np. zła konfiguracja) z przyczyną |
| `client-errors.jsonl` | błędy z przeglądarek użytkowników: wyjątki JS, odrzucone obietnice, odpowiedzi 5xx, zerwane połączenia |
| `<trace_id>/events.jsonl` | w TRACE: każdy krok żądania lub analizy po kolei, z danymi wejściowymi i decyzjami |

Każda odpowiedź z błędem zawiera `trace_id` (też w nagłówku `x-trace-id`), a konsola
(`watchdogctl logs`) wypisuje każde nieudane lub wolne żądanie razem z nim. Dane są
redagowane przed zapisem (hasła, tokeny, klucze); przeglądarka wysyła tylko metadane, bez
treści formularzy i bez parametrów adresu.

Przez SSH na VM, bez otwierania aplikacji:

```bash
sudo watchdogctl errors          # ostatnie awarie: serwer, proces, przeglądarki, nieudane żądania
sudo watchdogctl trace TRACE_ID  # wszystko o jednym zdarzeniu, krok po kroku
sudo watchdogctl diag-summary    # dzisiejsze liczby, tryb, zajęte miejsce
sudo watchdogctl logs            # konsola usługi (journald)
sudo watchdogctl proxy-logs      # HTTPS / certyfikat
sudo watchdogctl diagnostics-mode NORMAL   # lżejszy tryb po zakończeniu testów
```

Retencja: 14 dni i maks. 2048 MB (`WATCHDOG_DIAGNOSTICS_RETENTION_DAYS`,
`WATCHDOG_DIAGNOSTICS_MAX_MB` w `/etc/watchdog/app.env`); dzisiejszy dzień nie jest usuwany.
Programista widzi te same ślady w aplikacji (Analiza › Diagnostyka) i może pobrać paczkę ZIP.
Starsze instalacje zachowują swój tryb; przełącz go komendą `diagnostics-mode`.

## Utrzymanie i dane

Polecenia wykonywane **przez SSH na VM**:

```bash
sudo watchdogctl status
sudo watchdogctl logs
sudo watchdogctl backup
sudo watchdogctl verify /var/backups/watchdog/NAZWA.tar.gz
sudo watchdogctl restore /var/backups/watchdog/NAZWA.tar.gz /var/tmp/watchdog-recovered
sudo watchdogctl restart
```

| Miejsce na VM | Zawartość |
|---|---|
| `/var/lib/watchdog` | baza SQLite, obiekty źródłowe, diagnostyka, klucz sejfu |
| `/etc/watchdog/app.env` | prywatne ustawienia procesu, wygenerowany klucz sesji |
| `/etc/watchdog/release.env` | niezmienny Docker image ID (`sha256:…`) i commit |
| `/etc/watchdog/recovery-required` | stan wymagający odzyskania po nieudanym starcie aktualizacji |
| `/usr/local/lib/watchdog/watchdog_backup.py` | weryfikacja i izolowane odtwarzanie backupu |
| `/var/backups/watchdog` | kopie `.tar.gz` i sumy SHA-256, dostęp tylko root |
| `/opt/watchdog/releases` | kod kolejnych wdrożeń |
| `/opt/watchdog/current` | ostatnie wdrożenie, które przeszło sprawdzenie API |

Ponownie uruchom `deploy_gcp_vm.sh`, aby zainstalować aktualizację. Klucze i dane są zachowywane.
Nie uruchamiaj dwóch kontenerów nad tą samą bazą. Kopie są pełne, zawierają tajne klucze
i nie są automatycznie usuwane ani wysyłane poza VM. Zapis na tym samym dysku chroni przed
nieudaną aktualizacją, nie przed utratą całego dysku. Oddzielna kopia poza VM pozostaje
zadaniem operatora; nie uruchamiamy automatycznie płatnej usługi backupu.

### Sprawdzenie i izolowane odtworzenie

Nowy backup ma wersjonowany manifest: wykaz plików, rozmiary, SHA-256, uprawnienia,
identyfikator obrazu, commit i metadane schematu SQLite. Polecenie `backup` zatrzymuje
usługę na czas kopiowania i przywraca jej poprzednią aktywność także przy błędzie.
Weryfikacja wykonuje kontrolę SQLite na prywatnej kopii. Sekrety nigdy nie trafiają
do komunikatów, ale samo archiwum **zawiera klucze i prywatne dane**.

`verify` oraz `restore` wymagają archiwum i towarzyszącego pliku `.sha256`. Suma
chroni przed uszkodzeniem; nie stanowi podpisu ani dowodu autentyczności. Używaj
zaufanej kopii. Historyczne paczki tar bez nowego manifestu nie spełniają tego
kontraktu i nie są automatycznie importowane. Format v1 ogranicza paczkę do
100 000 wpisów, 10 GiB na plik i 20 GiB danych; manifest do 32 MiB.
Odtwarzanie atomowe wymaga Linux `renameat2`; katalogi nadrzędne muszą być
zaufane. Kontrola SQLite ma limit 60 sekund i odrzuca bazę wymagającą
odzyskania z aktywnego dziennika rollback.

`restore ARCHIVE NEW_ABSOLUTE_DIRECTORY` odtwarza do **nowego, nieistniejącego**
katalogu. Sprawdza wszystkie składniki przed udostępnieniem wyniku, odrzuca
niebezpieczne ścieżki, dowiązania, duplikaty i pliki specjalne. Istniejący katalog,
nawet pusty, nie zostanie nadpisany. Polecenie nie uruchamia kontenera ani kodu
z backupu i nie zmienia aktywnej instalacji. W wyniku otrzymujesz drzewo
`etc/watchdog`, `var/lib/watchdog`, definicję usługi i narzędzia oraz manifest.

Wspierana konfiguracja obejmuje lokalny magazyn i standardowe ścieżki wewnątrz
`/mnt/watchdog`. Inny backend lub zewnętrzna ścieżka danych/klucza wymaga osobnego
kontraktu; polecenie odmawia zamiast nazywać niepełną kopię kompletną. Klucz sejfu
może pochodzić z pliku lub `WATCHDOG_VAULT_KEY` w zachowanym `app.env`. Brak klucza
jest dopuszczalny wyłącznie przy niewykorzystanym sejfie.

**Zgodność obrazu nie oznacza jego dostępności.** Paczka zapisuje niezmienny image
ID, ale nie zawiera obrazu Docker. Przed utratą maszyny operator musi zachować
zgodny obraz poza nią (np. osobne `docker image save`) lub zapewnić jego dostępność
w zatwierdzonym registry. Ponowny build tego samego commita nie dowodzi identyczności.
Sprawdź dostępność przez `docker image inspect sha256:IDENTYFIKATOR_Z_MANIFESTU`.

Przeniesienie odtworzonego drzewa do aktywnej instalacji pozostaje osobną operacją
operatora: zatrzymanie jedynego writera, zachowanie obecnego stanu, przywrócenie
**razem** konfiguracji, danych i klucza, ustawienie właściciela danych na UID/GID
`1000:1000`, prywatnych uprawnień i użycie dokładnego image ID z manifestu.
Restore zachowuje prywatne tryby, lecz właścicielem wyniku jest wywołujący użytkownik;
nie nadaje automatycznie własności kontenera. Nie uruchamiaj starego obrazu na
potencjalnie zmigrowanej aktywnej bazie. Ten pakiet nie automatyzuje podmiany instalacji.

### Model awarii aktualizacji

| Miejsce awarii | Stan usługi i danych | Dalsze działanie |
|---|---|---|
| Build obrazu | Stara usługa działa; release i dane bez zmiany | Popraw build i ponów aktualizację |
| Stop lub backup przed zmianą runtime | Próba wznowienia wcześniej aktywnej usługi; stary release zachowany | Sprawdź błąd i dostępne miejsce; nie używaj niezweryfikowanej paczki |
| Start, migracja lub kontrola HTTP nowej wersji | Zatrzymanie i wyłączenie autostartu; marker `recovery-required`; brak automatycznego downgrade | Odczytaj marker i logi; zweryfikuj wskazany backup i odtwórz go izolowanie |

Marker powstaje przed zmianą runtime. Po awarii `watchdogctl restart`, `backup`
i kolejna aktualizacja odmawiają zwykłego wykonania. Udany kontrolowany start
usuwa marker. Autostart trwały jest wyłączany przed zmianą runtime; podczas
walidacji używane jest tylko włączenie systemd `--runtime`, a trwałe włączenie
następuje dopiero po poprawnym HTTP. `SIGKILL` nie wykonuje pułapki powłoki:
żywa usługa testowanej wersji może wtedy pozostać uruchomiona do ręcznego
zatrzymania. Marker nie jest blokadą bezpośrednich poleceń `systemctl`.
Nie usuwaj go tylko po to, by ominąć błąd: decyzja operatora o
odzyskaniu musi uwzględnić zgodność danych i obrazu. Przy pierwszej instalacji
poprzedni backup może nie istnieć.

### Powtarzalna lokalna próba

```bash
node --import tsx --test tests/integration/operations_backup.test.ts tests/integration/operations_update.test.ts
```

Testy używają wyłącznie fikcyjnych danych. Próba restore faktycznie odczytuje rekord
z odtworzonej SQLite, blob oraz odszyfrowuje sekret przez `UserVault.resolve`.
Testy aktualizacji wykonują skrypty z atrapami Docker/systemd/apt/UFW pod odrębnym
`WATCHDOG_ROOT`; kontrolują build, backup i start/migrację. Ten prefiks służy
izolowanym testom, a skrypty wymagają wtedy atrap poleceń umieszczonych w tym drzewie.
Nie jest to tryb wdrożenia systemu pod dowolnym prefiksem.

Osobne sprawdzenie prawdziwego kontenera pozostaje:

```bash
docker build -t watchdog:operations-check .
bash scripts/check_container.sh watchdog:operations-check
```

Start/trwałość kontenera, restore plików/SQLite i rzeczywiste wdrożenie GCP są
trzema różnymi wynikami. Brak Dockera uniemożliwia lokalne potwierdzenie pierwszego;
żaden z tych testów nie oznacza wykonania zmian na rzeczywistej VM.

## Gdy instalacja przerwie się

- Błąd GitHuba: sprawdź dostęp do repo w Cloud Shell; VM nie potrzebuje tokena GitHuba.
- Błąd pierwszego IAP: brakujące uprawnienia, OS Login lub polityka sieci; skrypt nie zdążył
  jeszcze dodać swoich reguł deny. Skorzystaj z `gcloud compute ssh ... --troubleshoot`.
- Błąd pakietów: sprawdź wyjście VM do internetu i wolne miejsce. Nie wyłączaj testów,
  żeby przepchnąć nieudaną instalację.
- Błąd budowania: dotychczasowa wersja nadal działa. Zachowaj końcowy fragment logu.
- Błąd startu: `sudo watchdogctl logs`; dane i kopie pozostają na dysku.
- Jeżeli instalacja była przerwana, ponowne uruchomienie używa tych samych reguł i zachowuje
  ustawienia. Kolizja nazwy reguły z innym zakresem lub istniejąca niezarządzana usługa
  kończy się błędem, zamiast nadpisywać cudzą konfigurację.

Walidacja automatyczna obejmuje kolejność operacji GCP z atrapą CLI, odmowę przy błędach
IAP/kolizjach, składnię Bash oraz w CI prawdziwe budowanie i restart kontenera z zapisem API.
Nie zastępuje to pierwszej instalacji w konkretnym projekcie GCP. Agent nie uruchamiał
provisioningu ani nie zmieniał ustawień Twojego konta GCP.

Uzupełnienie 2026-10-02: `recovery-required` blokuje również people/grant/invite/open-link/signin-link przed uruchomieniem kontenera CLI. Nawet people ładuje bazę i może wykonać migracje, więc diagnostykę awarii prowadź przez status/logs i zachowany marker. Nie usuwaj markera tylko po to, aby ominąć odmowę komendy.
