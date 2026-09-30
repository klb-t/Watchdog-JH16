# Watchdog na istniejącej maszynie GCP

Ten instalator uruchamia obecną gałąź rozwojową na jednej, przeznaczonej dla Watchdoga
maszynie Compute Engine. Wykonujesz go w **Cloud Shell**, nie w terminalu SSH samej VM.
Instalacja nie wymaga klucza LLM. To prywatna instalacja właściciela: dostęp przez IAP/SSH,
w aplikacji wspólna tożsamość `local-user` z pełnymi możliwościami deweloperskimi.
Ekran zamkniętego logowania, formularz prośby o dostęp i zaproszenia e-mail są kolejnym
etapem E4.5. Nie udostępniaj tego tunelu innym użytkownikom jako gotowego systemu kont.

## Przygotuj VM

- Ubuntu 24.04 LTS lub Debian 12/13; obsługiwane również Ubuntu 22.04/26.04.
- Co najmniej 4 GB RAM; do budowania i testów sugerowane 2 vCPU / 8 GB RAM.
- Dysk 50 GB; instalator wymaga co najmniej 12 GB wolnego miejsca przed budowaniem.
- Jedna karta sieciowa, działający SSH i `sudo`. Instalator zamyka przychodzący ruch do tej
  VM, zostawiając SSH z IAP; użyj maszyny przeznaczonej dla Watchdoga.
- Wyjście do internetu do pobrania pakietów, obrazu Node, npm i Chromium. VM może mieć
  zewnętrzny IP z zamkniętym ruchem przychodzącym; bez zewnętrznego IP potrzebuje np. Cloud NAT.
- Nie trzeba otwierać HTTP/HTTPS ani portu 8080 w konsoli GCP.

Konto uruchamiające skrypt musi móc opisać VM, dodać tag, zmienić reguły firewalla i retencję
dysku, włączyć Compute/IAP oraz połączyć się przez IAP i SSH z `sudo`. W zależności od
konfiguracji projektu obejmuje to IAP Tunnel Resource Accessor oraz odpowiednie uprawnienia
Compute/OS Login; polityki organizacji mogą nakładać dalsze ograniczenia. Instalator nie
nadaje kontom nowych ról IAM. Shared VPC wymaga też uprawnień do firewalla w projekcie sieci.
Szczegóły połączenia: [oficjalny opis IAP](https://docs.cloud.google.com/iap/docs/using-tcp-forwarding).

## Instalacja

Otwórz Cloud Shell przyciskiem terminala w konsoli Google Cloud. Wklej:

```bash
git clone --branch astra/watchdog-continuation-20260908 https://github.com/klb-t/Watchdog-JH16.git
cd Watchdog-JH16
bash scripts/deploy_gcp_vm.sh --project TWOJ_PROJEKT --zone TWOJA_STREFA --instance TWOJA_VM
```

Podmień trzy wartości, np. strefę na `europe-central2-a`. Nazwy wypisze też:

```bash
gcloud compute instances list --project TWOJ_PROJEKT
```

Jeśli masz już checkout, zamiast klonować drugi raz przejdź do niego i wykonaj `git pull
--ff-only`. Repozytorium prywatne wymaga zalogowania GitHuba w Cloud Shell: `gh auth login`,
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

## Utrzymanie i dane

Polecenia wykonywane **przez SSH na VM**:

```bash
sudo watchdogctl status
sudo watchdogctl logs
sudo watchdogctl backup
sudo watchdogctl restart
```

| Miejsce na VM | Zawartość |
|---|---|
| `/var/lib/watchdog` | baza SQLite, obiekty źródłowe, diagnostyka, klucz sejfu |
| `/etc/watchdog/app.env` | prywatne ustawienia procesu, wygenerowany klucz sesji |
| `/etc/watchdog/release.env` | identyfikator obrazu i commit |
| `/var/backups/watchdog` | kopie `.tar.gz` i sumy SHA-256, dostęp tylko root |
| `/opt/watchdog/releases` | kod kolejnych wdrożeń |
| `/opt/watchdog/current` | ostatnie wdrożenie, które przeszło sprawdzenie API |

Ponownie uruchom `deploy_gcp_vm.sh`, aby zainstalować aktualizację. Klucze i dane są zachowywane.
Nie uruchamiaj dwóch kontenerów nad tą samą bazą. Kopie są pełne, zawierają tajne klucze
i nie są automatycznie usuwane ani wysyłane poza VM. Zapis na tym samym dysku chroni przed
nieudaną aktualizacją, nie przed utratą całego dysku. Oddzielna kopia poza VM pozostaje
zadaniem operatora; nie uruchamiamy automatycznie płatnej usługi backupu.

Odtworzenie wymaga zatrzymania `watchdog.service`, sprawdzenia sumy archiwum i przywrócenia
**razem** `/var/lib/watchdog`, `/etc/watchdog` i zgodnej wersji usługi/obrazu. Zachowaj wcześniej
kopię obecnego stanu. Nie cofaj samego obrazu po migracji schematu: starszy kod może nie
obsługiwać nowszej bazy. Instalator nie wykonuje takiego automatycznego cofnięcia.

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
