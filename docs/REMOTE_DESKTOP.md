# Pulpit zdalny na maszynie (KDE, GNOME, RDP, Pulpit zdalny Chrome, VNC)

Skrypt `scripts/host/remote_desktop.sh` instaluje i konfiguruje pulpity KDE Plasma i GNOME oraz
trzy sposoby dostępu: RDP (xrdp), Pulpit zdalny Chrome (CRD) i VNC (TigerVNC). Nie jest częścią
WatchDoga; działa na tej samej maszynie obok niego (i obok innych usług). Ubuntu 22.04/24.04
i Debian 12.

## Instalacja (jedna wklejka, w SSH na maszynie)

```bash
curl -fsSL https://raw.githubusercontent.com/klb-t/Watchdog-JH16/claude/ai-studio-last-commit-gjqxy4/scripts/host/remote_desktop.sh -o /tmp/remote_desktop.sh && sudo bash /tmp/remote_desktop.sh
```

Domyślnie: oba pulpity, KDE dla nowych sesji, wszystkie trzy protokoły, klawiatura `pl`,
użytkownik ten, który wywołał `sudo`. Opcje: `--user NAZWA`, `--desktops kde,gnome`,
`--default kde|gnome`, `--protocols rdp,crd,vnc`, `--keyboard pl`, `--rdp-listen local|all`,
`--no-password-prompt`. Trwa 10–20 minut (pobiera ok. 2–3 GB). Można go uruchamiać wielokrotnie:
działające sesje zostają, jeśli nic się nie zmieniło. Na końcu wypisuje podsumowanie OK / UWAGA /
BŁĄD; kod wyjścia 2 znaczy „część kroków się nie udała” (szczegóły: `sudo remote-desktop doctor`).

Jeśli konto nie ma hasła, skrypt o nie zapyta (RDP loguje hasłem systemowym). VNC dostaje osobne,
losowe hasło zapisane w `~/.vnc/password.txt`.

## Połączenie

* **Telefon:** aplikacja „Pulpit zdalny Chrome”. Raz, w SSH: `sudo remote-desktop crd-register`
  — komenda prowadzi przez stronę remotedesktop.google.com/headless (kod autoryzacji + PIN).
  Nic nie trzeba otwierać w zaporze.
* **Komputer:** RDP lub VNC przez tunel IAP; porty 3389 i 5901 słuchają tylko na 127.0.0.1.
  `sudo remote-desktop tunnel` wypisuje gotową komendę, np.:

  ```bash
  gcloud compute ssh devbox-20260923 --zone europe-west4-c --project clever-stone-467803-g7 \
    --tunnel-through-iap -- -N -L 3389:127.0.0.1:3389 -L 5901:127.0.0.1:5901
  ```

  potem RDP na `localhost:3389` albo VNC na `localhost:5901`.

## Komendy

| Komenda | Co robi |
|---|---|
| `sudo remote-desktop status` | pulpity, porty, hasło, sygnały używania |
| `sudo remote-desktop doctor` | status + ostatnie logi usług i sesji |
| `sudo remote-desktop use kde\|gnome [UŻYTKOWNIK]` | pulpit dla nowych sesji |
| `sudo remote-desktop reset [UŻYTKOWNIK]` | kończy zawieszone sesje zdalne (nigdy SSH) i uruchamia VNC/CRD od nowa |
| `sudo remote-desktop crd-register` | rejestracja Pulpitu zdalnego Chrome |
| `sudo remote-desktop vnc-password` | nowe hasło VNC |
| `sudo remote-desktop tunnel` | komenda tunelu dla tej maszyny |

## Co skrypt rozwiązuje (typowe problemy zdalnych sesji)

* Jedna wspólna komenda startu sesji dla RDP, CRD i VNC; każda sesja ma własną magistralę D-Bus,
  więc ten sam użytkownik może mieć jednocześnie sesję VNC i RDP.
* Czarny ekran po ponownym połączeniu: pozostałości poprzedniej sesji na tym samym ekranie są
  kończone przy starcie nowej; VNC jest restartowany przez stop → czekanie na koniec starej
  sesji → start (zwykły restart pozwalał staremu procesowi VNC zabić nowy serwer).
* Bez blokady ekranu, wygaszacza i usypiania w obu pulpitach; okna autoryzacji (colord, sieć,
  aktualizacje) nie wyskakują; z pulpitu nie da się uśpić maszyny.
* NetworkManager, którego wciągają KDE/GNOME, nie przejmuje sieci maszyny w chmurze (utrata
  dostępu): jeśli go nie było, dostaje zakaz zarządzania urządzeniami i zostaje wyłączony.
* Maszyna startuje bez ekranu logowania (multi-user.target); zarządzanie energią KDE, które bez
  monitora się wywraca, jest w sesjach zdalnych wyłączone.
* Polski układ klawiatury w każdej sesji.

## Usypianie maszyny

Odłączony pulpit nie trzyma maszyny włączonej. Pulpit, przy którym ktoś pisze lub rusza myszą,
dotyka co minutę pliku w `/run/keep-awake/`; `watchdogctl idle-check` traktuje świeży plik jako
używanie (patrz [DEPLOY_GCP_VM.md](DEPLOY_GCP_VM.md)). Interwał i próg bezczynności:
`HEARTBEAT_SECONDS` i `HEARTBEAT_ACTIVE_MS` w `/etc/remote-desktop.conf` (ponowna instalacja ich
nie nadpisuje).

## Granice

Sprawdzone w kontenerze Ubuntu 24.04 z systemd: instalacja i ponowna instalacja, logowanie RDP
(xfreerdp) do KDE, VNC w KDE i GNOME 46, jednoczesne sesje VNC i RDP, 6/6 restartów działającej
sesji, sygnał używania. Pulpitu zdalnego Chrome nie dało się tam pobrać (sieć testowa) — jego
instalacja i rejestracja wymagają sprawdzenia na prawdziwej maszynie.
