#!/usr/bin/env bash
# Zdalny pulpit dla maszyny bez monitora (Ubuntu 22.04+ / Debian 12+): KDE Plasma i GNOME,
# dostępne przez RDP (xrdp), Pulpit zdalny Chrome (CRD) i VNC (TigerVNC).
# Wspólna konfiguracja; działanie sesji graficznej wymaga odbioru na docelowej VM.
#
# Instalacja (na maszynie, przez SSH):
#   sudo bash remote_desktop.sh [--user NAZWA] [--desktops kde,gnome] [--default kde|gnome]
#        [--protocols rdp,crd,vnc] [--keyboard pl] [--rdp-listen local|all] [--no-password-prompt]
# Potem:
#   sudo remote-desktop status | doctor | use kde|gnome [UŻYTKOWNIK] | reset [UŻYTKOWNIK]
#                       | crd-register | vnc-password | tunnel
#
# Można uruchamiać wielokrotnie: każdy krok sprawdza, co już jest, i nie nadpisuje cudzych plików
# (robi kopię). Domyślnie nic nie nasłuchuje z internetu: RDP i VNC tylko na 127.0.0.1 (łączysz się
# tunelem SSH), Pulpit zdalny Chrome nie potrzebuje żadnego otwartego portu.
#
# Znane pułapki, które ten skrypt rozwiązuje:
#  * ograniczenie konfliktów sesji (nie gwarantuje równoległych sesji GNOME jednego konta):
#    każda sesja dostaje własną szynę D-Bus, KDE startuje bez systemd (startkderc), GNOME w trybie
#    wbudowanym, gdy jest dostępny;
#  * GNOME domyślnie na Waylandzie: zdalne sesje są zawsze X11 z poprawnymi zmiennymi sesji Ubuntu;
#  * xrdp nie czyta certyfikatu (grupa ssl-cert), Xorg odmawia startu (Xwrapper);
#  * okienka „Authentication required to create a color managed device” (polkit);
#  * blokada ekranu i usypianie wewnątrz pulpitu przy koncie bez hasła (wyłączone; pulpit nie może
#    uśpić maszyny);
#  * menedżer logowania (gdm3/sddm) na maszynie bez ekranu: wyłączony;
#  * konto Google Cloud bez hasła: logowanie RDP wymaga hasła, skrypt prosi o jego ustawienie;
#  * indeksowanie plików i kompozycja okien zjadające CPU bez karty graficznej: wyłączone w KDE;
#  * usypianie maszyny w trakcie pracy na pulpicie: pulpit zostawia sygnał w /run/keep-awake.
set -Eeuo pipefail
umask 022
MARKER='Managed by remote_desktop.sh'
CONF=/etc/remote-desktop.conf
SIGNALS=/run/keep-awake
FAILED=0
declare -a REPORT=()

say()  { printf '%s\n' "$*"; }
ok()   { REPORT+=("OK     $*"); printf '  ✔ %s\n' "$*"; }
warn() { REPORT+=("UWAGA  $*"); printf '  ! %s\n' "$*" >&2; }
bad()  { REPORT+=("BŁĄD   $*"); printf '  ✘ %s\n' "$*" >&2; FAILED=$((FAILED + 1)); }
die()  { printf 'BŁĄD: %s\n' "$*" >&2; exit 1; }
need_root() { ((EUID == 0)) || die 'Uruchom przez sudo.'; }

export DEBIAN_FRONTEND=noninteractive NEEDRESTART_SUSPEND=1 NEEDRESTART_MODE=l
APT=(apt-get -o DPkg::Lock::Timeout=600 -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold -y)
have_pkg() { apt-cache show "$1" >/dev/null 2>&1; }
installed() { dpkg-query -W -f='${Status}' "$1" 2>/dev/null | grep -q 'install ok installed'; }
unit_exists() { systemctl cat "$1" >/dev/null 2>&1; }
# Local addresses a TCP port listens on, one per line (e.g. 127.0.0.1:3389, [::]:3389).
listen_addrs() { ss -Htln "sport = :$1" 2>/dev/null | awk '{print $4}' | sort -u; }
wait_listen() { local i; for i in $(seq 1 20); do [[ -n $(listen_addrs "$1") ]] && return 0; sleep 1; done; return 1; }
only_loopback() { local a; for a in $(listen_addrs "$1"); do [[ $a == 127.0.0.1:* || $a == '[::1]':* ]] || return 1; done; [[ -n $(listen_addrs "$1") ]]; }
home_of() { getent passwd "$1" | cut -d: -f6; }
as_user() { local u=$1; shift; runuser -u "$u" -- env HOME="$(home_of "$u")" USER="$u" LOGNAME="$u" "$@"; }
# Writes a managed file; an existing file without our marker is kept as FILE.bak-remote-desktop.
write_managed() {
  local path=$1 mode=$2 content=$3 owner=${4:-}
  local -a runner=(python3)
  # Files in a user's home are written as that user, never as root through user-controlled symlinks.
  [[ -z $owner ]] || runner=(runuser -u "${owner%%:*}" -- python3)
  "${runner[@]}" - "$path" "$mode" "$content" "$MARKER" <<'PYWRITE'
import os, pathlib, shutil, sys, tempfile
path = pathlib.Path(sys.argv[1]); mode = int(sys.argv[2], 8)
content, marker = sys.argv[3:5]
path.parent.mkdir(parents=True, exist_ok=True)
if path.is_symlink():
    raise SystemExit(f'Refusing symlink: {path}')
if path.exists() and marker not in path.read_text(errors='replace'):
    fd, backup = tempfile.mkstemp(prefix=path.name + '.bak-remote-desktop-', dir=path.parent)
    os.close(fd); shutil.copy2(path, backup)
    print(f'  ! Backup: {backup}')
fd, name = tempfile.mkstemp(prefix='.' + path.name + '-', dir=path.parent)
try:
    with os.fdopen(fd, 'w') as out:
        out.write(content + '\n'); out.flush(); os.fsync(out.fileno()); os.fchmod(out.fileno(), mode)
    os.replace(name, path)
finally:
    if os.path.exists(name): os.unlink(name)
PYWRITE
}
# System-wide defaults: written only when absent or already ours, never replacing someone's settings.
write_default() {
  local path=$1 content=$2
  if [[ -e $path ]] && ! grep -q "$MARKER" "$path" 2>/dev/null; then warn "zostawiam istniejący $path (nie nadpisuję cudzych ustawień)"; return 0; fi
  install -d -m 0755 "$(dirname "$path")"; printf '%s\n' "$content" > "$path"; chmod 0644 "$path"
}

read_conf() { DEFAULT_DESKTOP=kde; KEYBOARD=pl; RD_USER=''; VNC_DISPLAY=''; [[ -r $CONF ]] && . "$CONF"; return 0; }

# Package scripts must not start an unconfigured public xrdp/VNC listener.
# Restore even on apt failure; never permanently replace the host's service policy.
RD_POLICY_BACKUP=''; RD_POLICY_ACTIVE=false
restore_package_policy() {
  $RD_POLICY_ACTIVE || return 0
  if ! grep -qx '# remote-desktop temporary package guard' /usr/sbin/policy-rc.d; then
    warn "policy-rc.d zmieniono w trakcie instalacji; kopia: $RD_POLICY_BACKUP"
    return 1
  fi
  if [[ -n $RD_POLICY_BACKUP ]]; then mv -f -- "$RD_POLICY_BACKUP" /usr/sbin/policy-rc.d
  else rm -f /usr/sbin/policy-rc.d; fi
  RD_POLICY_ACTIVE=false
}
finish_desktop_install() {
  local code=$?
  trap - EXIT
  restore_package_policy || code=1
  if ((code)); then printf 'Instalacja pulpitu przerwana (kod %s). Nie jest to potwierdzenie gotowości.\n' "$code" >&2; fi
  exit "$code"
}
pause_package_autostart() {
  if [[ -e /usr/sbin/policy-rc.d || -L /usr/sbin/policy-rc.d ]]; then
    RD_POLICY_BACKUP=$(mktemp /usr/sbin/.policy-rc.d.remote-desktop.XXXXXXXX)
    cp -a --no-dereference /usr/sbin/policy-rc.d "$RD_POLICY_BACKUP"
  fi
  local temporary; temporary=$(mktemp /usr/sbin/.policy-rc.d.new.XXXXXXXX)
  printf '#!/bin/sh\n# remote-desktop temporary package guard\nexit 101\n' > "$temporary"
  chmod 0755 "$temporary"
  mv -f -- "$temporary" /usr/sbin/policy-rc.d
  RD_POLICY_ACTIVE=true
}

# ---------------------------------------------------------------- installation
install_all() {
  need_root
  local user='' desktops='kde,gnome' default='' protocols='rdp,crd,vnc' keyboard='pl' rdp_listen='local' ask_password=true
  while (($#)); do
    case "$1" in
      --user|--desktops|--default|--protocols|--keyboard|--rdp-listen)
        (($# >= 2)) || die "Brak wartości dla $1"
        case "$1" in --user) user=$2;; --desktops) desktops=$2;; --default) default=$2;; --protocols) protocols=$2;;
          --keyboard) keyboard=$2;; --rdp-listen) rdp_listen=$2;; esac; shift 2 ;;
      --no-password-prompt) ask_password=false; shift ;;
      -h|--help) sed -n '2,13p' "${BASH_SOURCE[0]}"; exit 0 ;;
      *) die "Nieznana opcja: $1" ;;
    esac
  done
  [[ $desktops =~ ^(kde|gnome)(,(kde|gnome))?$ ]] || die '--desktops: kde, gnome albo kde,gnome'
  [[ $protocols =~ ^(rdp|crd|vnc)(,(rdp|crd|vnc)){0,2}$ ]] || die '--protocols: dowolne z rdp,crd,vnc'
  [[ $rdp_listen =~ ^(local|all)$ ]] || die '--rdp-listen: local albo all'
  [[ $keyboard =~ ^[a-z]{2,3}(\([a-z0-9_]+\))?$ ]] || die '--keyboard: np. pl, us, de'
  default=${default:-${desktops%%,*}}
  [[ ,$desktops, == *,$default,* ]] || die "--default $default nie jest na liście --desktops"
  user=${user:-${SUDO_USER:-}}
  [[ -n $user && $user != root ]] || die 'Podaj --user NAZWA (konto, na którym ma działać pulpit; nie root).'
  [[ $user =~ ^[a-z_][a-z0-9_.-]*\$?$ ]] || die "Nieprawidłowa nazwa konta: $user"
  id -u "$user" >/dev/null 2>&1 || die "Nie ma użytkownika $user."
  local home; home=$(home_of "$user"); [[ -d $home ]] || die "Użytkownik $user nie ma katalogu domowego."
  [[ -d /run/systemd/system ]] || die 'Potrzebny jest systemd (zwykła maszyna wirtualna, nie kontener).'
  # shellcheck source=/dev/null
  . /etc/os-release
  local major=${VERSION_ID%%.*}; major=${major:-0}
  case "$ID" in
    ubuntu) ((major >= 22)) || die "Ubuntu $VERSION_ID jest za stare; potrzebne 22.04 lub nowsze." ;;
    debian) ((major >= 12)) || die "Debian $VERSION_ID jest za stary; potrzebny 12 lub nowszy." ;;
    *) die "Obsługiwane: Ubuntu 22.04+ i Debian 12+ (jest: ${PRETTY_NAME:-nieznany})." ;;
  esac
  local need_gb=5; [[ $desktops == *,* ]] && need_gb=8
  local avail_kb; avail_kb=$(df --output=avail -k / | tail -1 | tr -d ' ')
  ((avail_kb >= need_gb * 1024 * 1024)) || die "Za mało miejsca na dysku: potrzeba ok. ${need_gb} GB wolnego."
  awk '/MemTotal:/ {exit ($2 < 3500000)}' /proc/meminfo || warn 'mniej niż 4 GB RAM: pulpity będą działać wolno'
  local arch; arch=$(dpkg --print-architecture)
  install -d -m 0755 /run/lock
  exec 8>/run/lock/remote-desktop-install.lock
  flock -n 8 || die 'Inna instalacja pulpitu już działa.'
  # This also prevents watchdogctl idle-check during desktop package installation.
  exec 9>/run/lock/watchdog-install.lock
  flock -n 9 || die 'Trwa instalacja/kopia WatchDoga; uruchom pulpit po jej zakończeniu.'
  if [[ ,$protocols, == *,rdp,* && -n $(listen_addrs 3389) ]]; then
    systemctl is-active --quiet xrdp || die 'Port 3389 jest zajęty przez inną usługę; niczego nie zatrzymuję.'
  fi
  trap finish_desktop_install EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  pause_package_autostart

  say "== Zdalny pulpit dla $user na $PRETTY_NAME: pulpity $desktops (domyślny $default), dostęp $protocols"
  say '== Pakiety (to potrwa kilka–kilkanaście minut)'
  "${APT[@]}" update || { sleep 5; "${APT[@]}" update; }
  local base=(python3 dbus-x11 dbus-user-session x11-utils x11-xserver-utils xauth xprintidle xserver-xorg-video-dummy fonts-dejavu-core curl ca-certificates iproute2)
  "${APT[@]}" install "${base[@]}" || die 'Nie udało się zainstalować pakietów podstawowych (sieć? apt?).'
  ok 'pakiety podstawowe'

  local kde=false gnome=false
  if [[ ,$desktops, == *,kde,* ]]; then
    if "${APT[@]}" install kde-plasma-desktop konsole dolphin; then
      if ! command -v startplasma-x11 >/dev/null; then
        local p; for p in plasma-session-x11 plasma-workspace-x11; do have_pkg "$p" && "${APT[@]}" install "$p" && break; done
      fi
      if command -v startplasma-x11 >/dev/null; then kde=true; ok 'KDE Plasma (sesja X11)'; else bad 'KDE zainstalowane, ale bez sesji X11 (startplasma-x11)'; fi
    else bad 'instalacja KDE nie powiodła się'; fi
  fi
  if [[ ,$desktops, == *,gnome,* ]]; then
    local gpk=(gnome-terminal nautilus gnome-control-center dconf-cli)
    if [[ $ID == ubuntu ]]; then gpk=(ubuntu-session "${gpk[@]}"); else gpk=(gnome-session gnome-shell "${gpk[@]}"); fi
    if "${APT[@]}" install "${gpk[@]}"; then
      local gv; gv=$(gnome-shell --version 2>/dev/null || true); gv=$(printf '%s\n' "$gv" | sed -n 's/^[^0-9]*\([0-9][0-9]*\).*/\1/p'); gv=${gv:-0}
      if ((gv >= 49)); then bad "GNOME $gv: ten instalator nie potwierdza sesji X11 dla tej wersji; użyj KDE"
      elif command -v gnome-session >/dev/null; then gnome=true; ok "GNOME $gv (sesja X11)"
      else bad 'GNOME bez gnome-session'; fi
    else bad 'instalacja GNOME nie powiodła się'; fi
  fi
  $kde || $gnome || die 'Żaden pulpit nie jest dostępny; zobacz błędy powyżej.'
  if [[ $default == kde ]] && ! $kde; then default=gnome; fi
  if [[ $default == gnome ]] && ! $gnome; then default=kde; fi

  local rdp=false vnc=false crd=false
  if [[ ,$protocols, == *,rdp,* ]]; then
    if "${APT[@]}" install xrdp xorgxrdp; then rdp=true; else bad 'instalacja xrdp nie powiodła się'; fi
  fi
  if [[ ,$protocols, == *,vnc,* ]]; then
    local vpk=(tigervnc-standalone-server tigervnc-common); have_pkg tigervnc-tools && vpk+=(tigervnc-tools)
    if "${APT[@]}" install "${vpk[@]}"; then vnc=true; else bad 'instalacja TigerVNC nie powiodła się'; fi
  fi
  if [[ ,$protocols, == *,crd,* ]]; then
    if [[ $arch != amd64 ]]; then bad "Pulpit zdalny Chrome jest tylko dla amd64 (jest: $arch)"
    elif installed chrome-remote-desktop; then crd=true
    else
      local tmp; tmp=$(mktemp -d)
      if curl -fsSL --retry 3 -o "$tmp/crd.deb" https://dl.google.com/linux/direct/chrome-remote-desktop_current_amd64.deb \
         && dpkg-deb -I "$tmp/crd.deb" >/dev/null 2>&1 && "${APT[@]}" install "$tmp/crd.deb"; then crd=true
      else bad 'nie udało się pobrać/zainstalować Pulpitu zdalnego Chrome (dl.google.com)'; fi
      rm -rf "$tmp"
    fi
  fi

  restore_package_policy
  say '== Konfiguracja systemu'
  configure_headless
  write_managed "$CONF" 0644 "# $MARKER — ustawienia wspólne dla RDP, CRD i VNC
DEFAULT_DESKTOP=$default
KEYBOARD='$keyboard'
RD_USER='$user'
# Ile sekund między sprawdzeniami i od ilu milisekund bez wejścia pulpit uznaje się za nieużywany.
HEARTBEAT_SECONDS=60
HEARTBEAT_ACTIVE_MS=300000"
  install_launchers
  configure_desktop_defaults "$kde" "$gnome" "$keyboard"
  configure_polkit
  configure_signals
  configure_user "$user" "$home" "$default" "$ask_password" "$rdp"
  if $rdp; then configure_rdp "$user" "$home" "$rdp_listen"; fi
  if $vnc; then configure_vnc "$user" "$home"; fi
  if $crd; then configure_crd "$user" "$home"; fi
  install -m 0755 "$(readlink -f "${BASH_SOURCE[0]}")" /usr/local/sbin/remote-desktop.tmp && mv -f /usr/local/sbin/remote-desktop.tmp /usr/local/sbin/remote-desktop
  ok 'komenda: sudo remote-desktop status | doctor | use | reset | crd-register | vnc-password | tunnel'

  say ''
  say '== Podsumowanie'
  printf '%s\n' "${REPORT[@]}"
  say ''
  print_how_to_connect "$user"
  ((FAILED == 0)) || { say "Część kroków się nie udała ($FAILED). Szczegóły: sudo remote-desktop doctor"; exit 2; }
}

configure_headless() {
  # Bez monitora menedżer logowania tylko zjada pamięć i potrafi blokować sesje zdalne.
  if [[ $(systemctl get-default) == graphical.target ]]; then systemctl set-default multi-user.target >/dev/null; fi
  local dm
  for dm in gdm3 gdm sddm lightdm; do
    if unit_exists "$dm.service"; then systemctl disable --now "$dm.service" >/dev/null 2>&1 || true; fi
  done
  ok 'maszyna bez ekranu: menedżer logowania wyłączony, start w trybie tekstowym'
  # xorgxrdp i CRD uruchamiają Xorg spoza konsoli.
  local xw=/etc/X11/Xwrapper.config
  if [[ -f $xw ]] && grep -q '^allowed_users=' "$xw"; then sed -i 's/^allowed_users=.*/allowed_users=anybody/' "$xw"
  else install -d /etc/X11; printf 'allowed_users=anybody\n' >> "$xw"; fi
}

install_launchers() {
  write_managed /usr/local/bin/remote-desktop-session 0755 '#!/bin/bash
# '"$MARKER"' — wspólny start pulpitu dla RDP, Pulpitu zdalnego Chrome i VNC.
# Pulpit (KDE/GNOME) wybiera: sudo remote-desktop use kde|gnome. Dziennik: ~/.local/state/remote-desktop/session.log
DEFAULT_DESKTOP=kde; KEYBOARD=pl
[ -r /etc/remote-desktop.conf ] && . /etc/remote-desktop.conf
state="${XDG_STATE_HOME:-$HOME/.local/state}/remote-desktop"; mkdir -p "$state"
log="$state/session.log"
if [ -f "$log" ] && [ "$(stat -c %s "$log")" -gt 5000000 ]; then mv -f "$log" "$log.1"; fi
exec >>"$log" 2>&1
pref="${XDG_CONFIG_HOME:-$HOME/.config}/remote-desktop/desktop"
desktop=$(head -n1 "$pref" 2>/dev/null | tr -cd a-z); desktop=${desktop:-$DEFAULT_DESKTOP}
has_kde() { command -v startplasma-x11 >/dev/null; }
has_gnome() { command -v gnome-session >/dev/null && command -v gnome-shell >/dev/null; }
case "$desktop" in
  kde) has_kde || { has_gnome && desktop=gnome; } ;;
  gnome) has_gnome || { has_kde && desktop=kde; } ;;
esac
echo "== $(date -Is) pulpit=$desktop DISPLAY=$DISPLAY"
export XDG_SESSION_TYPE=x11
case ":$PATH:" in *:/snap/bin:*) ;; *) PATH="$PATH:/snap/bin" ;; esac; export PATH
# Własna szyna D-Bus ogranicza konflikty; nie izoluje wszystkich usług per-user GNOME.
unset DBUS_SESSION_BUS_ADDRESS
if [ -n "$KEYBOARD" ]; then
  layout=${KEYBOARD%%(*}; variant=""
  case "$KEYBOARD" in *\(*\)) variant=${KEYBOARD#*(}; variant=${variant%)} ;; esac
  setxkbmap -layout "$layout" -variant "$variant" || echo "setxkbmap $KEYBOARD nie zadziałał"
fi
/usr/local/bin/remote-desktop-heartbeat &
case "$desktop" in
  gnome)
    if [ -r /usr/share/gnome-session/sessions/ubuntu.session ]; then
      export XDG_CURRENT_DESKTOP=ubuntu:GNOME GNOME_SHELL_SESSION_MODE=ubuntu DESKTOP_SESSION=ubuntu XDG_SESSION_DESKTOP=ubuntu
      export XDG_CONFIG_DIRS=/etc/xdg/xdg-ubuntu:/etc/xdg
      export XDG_DATA_DIRS=/usr/share/ubuntu:/usr/local/share:/usr/share:/var/lib/snapd/desktop
      session=ubuntu
    else
      export XDG_CURRENT_DESKTOP=GNOME DESKTOP_SESSION=gnome XDG_SESSION_DESKTOP=gnome
      export XDG_DATA_DIRS=/usr/local/share:/usr/share:/var/lib/snapd/desktop
      session=gnome
    fi
    mode=""; gnome-session --help 2>&1 | grep -q -- "--builtin" && mode=--builtin
    exec dbus-run-session -- gnome-session --session="$session" $mode ;;
  kde)
    export XDG_CURRENT_DESKTOP=KDE DESKTOP_SESSION=plasma XDG_SESSION_DESKTOP=KDE
    export XDG_DATA_DIRS=/usr/local/share:/usr/share:/var/lib/snapd/desktop
    exec dbus-run-session -- startplasma-x11 ;;
esac
echo "Nie ma zainstalowanego pulpitu KDE ani GNOME."; sleep 30'
  write_managed /usr/local/bin/remote-desktop-heartbeat 0755 '#!/bin/bash
# '"$MARKER"' — dopóki ktoś faktycznie używa tego pulpitu (wejście z klawiatury/myszy w ostatnich
# minutach), zostawia sygnał w /run/keep-awake, żeby usypianie maszyny nie przerwało pracy.
HEARTBEAT_SECONDS=60; HEARTBEAT_ACTIVE_MS=300000
[ -r /etc/remote-desktop.conf ] && . /etc/remote-desktop.conf
dir=/run/keep-awake
name=$(printf "desktop-%s-%s" "$(id -un)" "${DISPLAY#:}" | tr -c "A-Za-z0-9._-" "_")
file="$dir/$name"
trap "rm -f \"$file\"" EXIT
fails=0
[ ! -d "$dir" ] || touch "$file"
while sleep "$HEARTBEAT_SECONDS"; do
  xprop -root >/dev/null 2>&1 || exit 0
  if idle=$(xprintidle 2>/dev/null); then
    fails=0
    if [ "$idle" -lt "$HEARTBEAT_ACTIVE_MS" ] && [ -d "$dir" ]; then
      touch -d "@$(( $(date +%s) - idle / 1000 ))" "$file"
    fi
  else
    fails=$((fails + 1))
    [ ! -d "$dir" ] || touch "$file"
    [ "$fails" -eq 3 ] && echo "$(date -Is) xprintidle nie działa na $DISPLAY: brak pomiaru bezczynności: utrzymuję maszynę włączoną" >&2
  fi
done'
  write_managed /usr/share/xsessions/remote-desktop.desktop 0644 "[Desktop Entry]
# $MARKER
Name=Remote desktop (KDE or GNOME)
Comment=Started by RDP, Chrome Remote Desktop and VNC alike
Exec=/usr/local/bin/remote-desktop-session
Type=Application"
  ok 'wspólny starter pulpitu (/usr/local/bin/remote-desktop-session)'
}

configure_desktop_defaults() {
  local kde=$1 gnome=$2 keyboard=$3
  keyboard=${keyboard/(/+}; keyboard=${keyboard%)}
  if $kde; then
    write_default /etc/xdg/startkderc "# $MARKER
[General]
systemdBoot=false"
    write_default /etc/xdg/kscreenlockerrc "# $MARKER
[Daemon]
Autolock=false
LockOnResume=false"
    write_default /etc/xdg/kwinrc "# $MARKER
[Compositing]
Enabled=false"
    write_default /etc/xdg/baloofilerc "# $MARKER
[Basic Settings]
Indexing-Enabled=false"
    ok 'KDE: bez blokady ekranu, bez kompozycji i indeksowania, start bez systemd'
  fi
  if $gnome; then
    local profile=/etc/dconf/profile/user
    if [[ ! -f $profile ]]; then install -d /etc/dconf/profile; printf 'user-db:user\nsystem-db:local\n' > "$profile"
    elif ! grep -qx 'system-db:local' "$profile"; then printf 'system-db:local\n' >> "$profile"; fi
    write_managed /etc/dconf/db/local.d/00-remote-desktop 0644 "# $MARKER
[org/gnome/desktop/screensaver]
lock-enabled=false
[org/gnome/desktop/session]
idle-delay=uint32 0
[org/gnome/desktop/lockdown]
disable-lock-screen=true
[org/gnome/settings-daemon/plugins/power]
sleep-inactive-ac-type='nothing'
sleep-inactive-battery-type='nothing'
[org/gnome/desktop/interface]
enable-animations=false
[org/gnome/desktop/input-sources]
sources=[('xkb', '${keyboard}')]"
    if dconf update; then ok 'GNOME: bez blokady ekranu, usypiania i animacji'; else bad 'dconf update nie powiódł się'; fi
  fi
}

configure_polkit() {
  getent group remotedesktop >/dev/null || groupadd --system remotedesktop
  if [[ -d /etc/polkit-1/rules.d ]] || [[ $(pkaction --version 2>/dev/null) != *0.105* ]]; then
    write_managed /etc/polkit-1/rules.d/45-remote-desktop.rules 0644 "// $MARKER
// Zdalne pulpity: bez okienek o profilach kolorów i odświeżaniu repozytoriów; pulpit nie może uśpić maszyny.
polkit.addRule(function(action, subject) {
  if (!subject.isInGroup(\"remotedesktop\")) return polkit.Result.NOT_HANDLED;
  if (action.id.indexOf(\"org.freedesktop.color-manager.\") === 0) return polkit.Result.YES;
  if (action.id === \"org.freedesktop.packagekit.system-sources-refresh\") return polkit.Result.YES;
  if (/^org\\.freedesktop\\.login1\\.(suspend|hibernate|hybrid-sleep)/.test(action.id)) return polkit.Result.NO;
  return polkit.Result.NOT_HANDLED;
});"
  fi
  if [[ -d /etc/polkit-1/localauthority ]] || [[ $(pkaction --version 2>/dev/null) == *0.105* ]]; then
    write_managed /etc/polkit-1/localauthority/50-local.d/45-remote-desktop.pkla 0644 "# $MARKER
[Remote desktop: colour profiles]
Identity=unix-group:remotedesktop
Action=org.freedesktop.color-manager.*
ResultAny=yes
ResultInactive=yes
ResultActive=yes

[Remote desktop: package source refresh]
Identity=unix-group:remotedesktop
Action=org.freedesktop.packagekit.system-sources-refresh
ResultAny=yes
ResultInactive=yes
ResultActive=yes

[Remote desktop: never suspend the machine]
Identity=unix-group:remotedesktop
Action=org.freedesktop.login1.suspend*;org.freedesktop.login1.hibernate*;org.freedesktop.login1.hybrid-sleep*
ResultAny=no
ResultInactive=no
ResultActive=no"
  fi
  ok 'polkit: bez zbędnych okienek autoryzacji, bez usypiania z pulpitu'
}

configure_signals() {
  # Ten sam mechanizm co w usypianiu maszyny (WatchDog E3.20): plik w /run/keep-awake = maszyna w użyciu.
  write_managed /etc/tmpfiles.d/keep-awake.conf 0644 "# $MARKER
d /run/keep-awake 1777 root root -"
  install -d -m 1777 "$SIGNALS"
  ok "sygnał używania pulpitu dla usypiania maszyny ($SIGNALS)"
}

configure_user() {
  local user=$1 home=$2 default=$3 ask_password=$4 rdp=$5
  usermod -aG remotedesktop "$user"
  local cfg="$home/.config/remote-desktop"
  as_user "$user" mkdir -p "$cfg"
  [[ -s $cfg/desktop ]] || as_user "$user" sh -c 'printf "%s\n" "$2" > "$1"' sh "$cfg/desktop" "$default"
  local status; status=$(passwd -S "$user" 2>/dev/null | awk '{print $2}')
  if [[ $status == P ]]; then ok "$user ma hasło (potrzebne do logowania przez RDP)"
  elif $ask_password && [[ -t 0 ]]; then
    say ''
    say "Konto $user nie ma hasła. Do logowania przez RDP (i do sudo w okienkach) jest potrzebne."
    say 'Hasło może także umożliwić SSH z hasłem, jeśli sshd to dopuszcza; ten skrypt nie zmienia konfiguracji SSH.'
    local i; for i in 1 2 3; do passwd "$user" && break; done
    [[ $(passwd -S "$user" | awk '{print $2}') == P ]] && ok "hasło ustawione dla $user" || warn "$user nadal bez hasła: RDP nie zaloguje (CRD i VNC działają)"
  else
    if $rdp; then warn "$user nie ma hasła: RDP nie zaloguje. Ustaw: sudo passwd $user"; else warn "$user nie ma hasła"; fi
  fi
}

configure_rdp() {
  local user=$1 home=$2 listen=$3
  getent group ssl-cert >/dev/null && usermod -aG ssl-cert xrdp
  local ini=/etc/xrdp/xrdp.ini want='port=tcp://.:3389'
  [[ $listen == all ]] && want='port=3389'
  if [[ -f $ini ]]; then sed -i "0,/^port=/s|^port=.*|$want|" "$ini"; fi
  write_managed "$home/startwm.sh" 0755 "#!/bin/sh
# $MARKER — sesja RDP (xrdp) startuje wspólny pulpit.
if [ -r /etc/profile ]; then . /etc/profile; fi
exec /etc/X11/Xsession /usr/local/bin/remote-desktop-session" "$user:$(id -gn "$user")"
  systemctl enable xrdp >/dev/null 2>&1 || true
  systemctl restart xrdp
  if ! wait_listen 3389; then bad 'xrdp nie nasłuchuje na porcie 3389 (sudo remote-desktop doctor)'; return; fi
  if [[ $listen == local ]]; then
    if only_loopback 3389; then ok 'RDP: port 3389 tylko lokalnie (tunel SSH)'; else systemctl stop xrdp; systemctl disable xrdp >/dev/null 2>&1 || true; bad "RDP zatrzymany: nasłuch był szerszy niż lokalny"; fi
  else
    warn "RDP nasłuchuje na wszystkich adresach ($(listen_addrs 3389 | xargs)). W domyślnej sieci Google Cloud reguła default-allow-rdp otwiera go dla całego internetu; chroni go tylko hasło."
  fi
}

configure_vnc() {
  local user=$1 home=$2
  local unit=''
  for unit in tigervncserver@ vncserver@; do unit_exists "$unit.service" && break; unit=''; done
  [[ -n $unit ]] || { bad 'TigerVNC bez usługi systemd (tigervncserver@/vncserver@)'; return; }
  local users=/etc/tigervnc/vncserver.users n='' line
  install -d /etc/tigervnc; touch "$users"
  n=$(sed -n "s/^:\([0-9]\+\)=$user\$/\1/p" "$users" | head -1)
  if [[ -z $n ]]; then
    local candidate
    for candidate in $(seq 1 99); do
      grep -q "^:$candidate=" "$users" && continue
      [[ -e /tmp/.X${candidate}-lock || -n $(listen_addrs "$((5900 + candidate))") ]] && continue
      n=$candidate; break
    done
    [[ -n $n ]] || { bad 'Brak wolnego ekranu VNC (1–99); nie nadpisuję mapowania'; return; }
    printf ':%s=%s\n' "$n" "$user" >> "$users"
  fi
  sed -i '/^VNC_DISPLAY=/d' "$CONF"; printf 'VNC_DISPLAY=%s\n' "$n" >> "$CONF"
  local vdir="$home/.vnc"; as_user "$user" mkdir -p "$vdir"; chmod 0700 "$vdir"
  # Debian/Ubuntu 1.12–1.13 use ~/.vnc/tigervnc.conf; newer packages use
  # ~/.config/tigervnc/config.pl. Write both supported layouts, with one credential path.
  local modern="$home/.config/tigervnc" vcfg
  as_user "$user" mkdir -p "$modern"
  vcfg="# $MARKER
\$session = \"remote-desktop\";
\$geometry = \"1920x1080\";
\$localhost = \"yes\";
\$SecurityTypes = \"VncAuth\";
\$vncPasswdFile = \"\$ENV{HOME}/.vnc/passwd\";
\$vncStartup = \"/usr/local/bin/remote-desktop-session\";"
  write_managed "$vdir/tigervnc.conf" 0600 "$vcfg" "$user:$(id -gn "$user")"
  write_managed "$modern/config.pl" 0600 "$vcfg" "$user:$(id -gn "$user")"
  if [[ ! -s $vdir/passwd ]]; then set_vnc_password "$user" "$home" >/dev/null; fi
  systemctl enable "$unit:$n.service" >/dev/null 2>&1 || true
  systemctl restart "$unit:$n.service" || { bad "Nie uruchomił się $unit:$n.service"; return; }
  local port=$((5900 + n))
  if ! wait_listen "$port"; then bad "VNC (:$n) nie wystartował (sudo remote-desktop doctor)"; return; fi
  if only_loopback "$port"; then ok "VNC: ekran :$n, port $port tylko lokalnie (tunel SSH)"; else systemctl stop "$unit:$n.service"; systemctl disable "$unit:$n.service" >/dev/null 2>&1 || true; bad "VNC zatrzymany: nasłuch był szerszy niż lokalny"; fi
}

set_vnc_password() {
  local user=$1 home=$2 tool
  tool=$(command -v tigervncpasswd || command -v vncpasswd || true)
  [[ -n $tool ]] || { bad 'brak vncpasswd'; return 1; }
  # No tr|head: under pipefail it terminates with SIGPIPE (141).
  # The credential is never put in argv; all files are created privately as the user.
  runuser -u "$user" -- python3 - "$home" "$tool" <<'PYPASS'
import os, pathlib, secrets, subprocess, sys, tempfile
os.umask(0o077)
d = pathlib.Path(sys.argv[1]) / '.vnc'; d.mkdir(mode=0o700, exist_ok=True)
if d.is_symlink(): raise SystemExit('Refusing symlink .vnc')
pw = ''.join(secrets.choice('ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789') for _ in range(8))
result = subprocess.run([sys.argv[2], '-f'], input=(pw + '\n').encode(), stdout=subprocess.PIPE, check=True)
if not result.stdout: raise SystemExit('vncpasswd returned an empty credential')
for filename, data in (('passwd', result.stdout), ('password.txt', (pw + '\n').encode())):
    fd, name = tempfile.mkstemp(prefix='.' + filename + '-', dir=d)
    try:
        with os.fdopen(fd, 'wb') as out: out.write(data)
        os.replace(name, d / filename)
    finally:
        if os.path.exists(name): os.unlink(name)
print(pw)
PYPASS
}

configure_crd() {
  local user=$1 home=$2
  write_managed /etc/chrome-remote-desktop-session 0755 "# $MARKER — Pulpit zdalny Chrome startuje wspólny pulpit.
exec /etc/X11/Xsession /usr/local/bin/remote-desktop-session"
  getent group chrome-remote-desktop >/dev/null && usermod -aG chrome-remote-desktop "$user"
  if compgen -G "$home/.config/chrome-remote-desktop/host#*.json" >/dev/null; then
    systemctl restart "chrome-remote-desktop@$user.service" || { bad 'CRD nie wystartował'; return; }
    ok 'Pulpit zdalny Chrome: zarejestrowany, uruchomiony ponownie z nowym pulpitem'
  else
    warn 'Pulpit zdalny Chrome zainstalowany, ale ta maszyna nie jest jeszcze dodana do Twojego konta: sudo remote-desktop crd-register'
  fi
}

# ---------------------------------------------------------------- after installation
print_how_to_connect() {
  local user=$1 n port; read_conf; n=${VNC_DISPLAY:-1}; port=$((5900 + n))
  local host; host=$(hostname)
  say '== Jak się połączyć'
  say '* Z telefonu (najprościej): aplikacja „Pulpit zdalny Chrome” — po jednorazowym sudo remote-desktop crd-register.'
  say '* Z komputera, RDP lub VNC przez tunel (nic nie jest otwarte na świat). W terminalu z gcloud:'
  say "    gcloud compute ssh $host --tunnel-through-iap -- -N -L 3389:127.0.0.1:3389 -L $port:127.0.0.1:$port"
  say "  potem RDP na localhost:3389 (login $user i jego hasło) albo VNC na localhost:$port (hasło: ~$user/.vnc/password.txt)."
  say '* Pulpit (dla nowych sesji): sudo remote-desktop use kde|gnome.  Zawieszona sesja / czarny ekran: sudo remote-desktop reset'
}

cmd_use() {
  need_root; read_conf
  local desktop=${1:-} user=${2:-${RD_USER:-${SUDO_USER:-}}}
  [[ $desktop =~ ^(kde|gnome)$ ]] || die 'Użycie: sudo remote-desktop use kde|gnome [UŻYTKOWNIK]'
  [[ -n $user ]] && id -u "$user" >/dev/null 2>&1 || die 'Podaj użytkownika.'
  local home; home=$(home_of "$user")
  as_user "$user" mkdir -p "$home/.config/remote-desktop"
  as_user "$user" sh -c 'printf "%s\n" "$2" > "$1"' sh "$home/.config/remote-desktop/desktop" "$desktop"
  say "Nowe sesje $user będą w $desktop. Trwające sesje zostają; zakończ je: sudo remote-desktop reset $user"
}

# Ends stuck remote desktop sessions of a user (never SSH), then restarts VNC/CRD hosts.
cmd_reset() {
  need_root; read_conf
  local user=${1:-${RD_USER:-${SUDO_USER:-}}} id name service ended=0
  [[ -n $user ]] || die 'Podaj użytkownika.'
  while read -r id _; do
    [[ -n $id ]] || continue
    name=$(loginctl show-session "$id" -p Name --value 2>/dev/null || true)
    service=$(loginctl show-session "$id" -p Service --value 2>/dev/null || true)
    if [[ $name == "$user" && $service =~ ^(xrdp-sesman|xrdp|chrome-remote-desktop|tigervnc|vncserver|vncsession)$ ]]; then
      loginctl terminate-session "$id" && ended=$((ended + 1))
    fi
  done < <(loginctl list-sessions --no-legend 2>/dev/null)
  if [[ -n ${VNC_DISPLAY:-} ]]; then
    local u; for u in tigervncserver@ vncserver@; do unit_exists "$u.service" && { systemctl restart "$u:$VNC_DISPLAY.service" || true; break; }; done
  fi
  systemctl restart "chrome-remote-desktop@$user.service" 2>/dev/null || true
  say "Zakończone sesje zdalne: $ended. VNC i Pulpit zdalny Chrome uruchomione ponownie. Połącz się jeszcze raz."
}

cmd_crd_register() {
  need_root; read_conf
  local user=${RD_USER:-${SUDO_USER:-}} cmd
  [[ -n $user && $user != root ]] || die 'Brak konta pulpitu.'
  installed chrome-remote-desktop || die 'Pulpit zdalny Chrome nie jest zainstalowany.'
  say 'Otwórz https://remotedesktop.google.com/headless → Autoryzuj → polecenie Debian Linux.'
  say 'Wklej polecenie tutaj. PIN podasz bezpośrednio programowi Google (nie do czatu).'
  [[ -r /dev/tty ]] || die 'Rejestracja wymaga interaktywnego SSH z TTY.'
  IFS= read -r -p '> ' cmd </dev/tty
  # stdin contains Python, not the PIN. The child gets the real terminal.
  python3 - "$user" "$(home_of "$user")" "$cmd" <<'PYCRD'
import os, shlex, socket, subprocess, sys
user, home, text = sys.argv[1:]
args = shlex.split(text)
if args and args[0] == 'DISPLAY=': args.pop(0)
expected = '/opt/google/chrome-remote-desktop/start-host'
if not args or args.pop(0) != expected: raise SystemExit('Nieprawidłowy program CRD')
values = {}
for item in args:
    key, sep, value = item.partition('=')
    if not sep or key not in ('--code', '--redirect-url', '--name') or key in values:
        raise SystemExit('Nieprawidłowe lub powtórzone opcje CRD')
    values[key] = value
if set(values) != {'--code', '--redirect-url', '--name'} or not values['--code']:
    raise SystemExit('Brak wymaganych opcji CRD')
if values['--redirect-url'] != 'https://remotedesktop.google.com/_/oauthredirect':
    raise SystemExit('Nieprawidłowy redirect CRD')
if values['--name'] in ('$(hostname)', '${HOSTNAME}', '$HOSTNAME'):
    values['--name'] = socket.gethostname()
argv = ['runuser', '-u', user, '--', 'env', 'DISPLAY=', 'HOME=' + home, expected]
argv.extend(key + '=' + values[key] for key in ('--code', '--redirect-url', '--name'))
with open('/dev/tty', 'r+') as terminal:
    subprocess.run(argv, stdin=terminal, check=True)
PYCRD
  if ! compgen -G "$(home_of "$user")/.config/chrome-remote-desktop/host#*.json" >/dev/null; then
    die 'Program Google zakończył się, ale brak pliku rejestracji CRD; sprawdź jego komunikaty.'
  fi
  systemctl restart "chrome-remote-desktop@$user.service" || die 'CRD zapisany, ale usługa nie wystartowała.'
  systemctl is-active --quiet "chrome-remote-desktop@$user.service" || die 'CRD nie jest aktywny.'
  say 'CRD zarejestrowany i usługa aktywna. Sprawdź połączenie i obraz pulpitu na telefonie.'
}

cmd_vnc_password() {
  need_root; read_conf
  local user=${RD_USER:-${SUDO_USER:-}} pw
  pw=$(set_vnc_password "$user" "$(home_of "$user")") || exit 1
  say "Nowe hasło VNC: $pw (zapisane też w ~$user/.vnc/password.txt). Działa od następnego połączenia."
}

cmd_status() {
  need_root; read_conf
  local user=${RD_USER:-?} n=${VNC_DISPLAY:-} pref
  pref=$(head -n1 "$(home_of "$user" 2>/dev/null)/.config/remote-desktop/desktop" 2>/dev/null || echo "$DEFAULT_DESKTOP")
  say "Użytkownik: $user   pulpit dla nowych sesji: $pref   klawiatura: $KEYBOARD"
  say "Pulpity: KDE $(command -v startplasma-x11 >/dev/null && echo tak || echo nie), GNOME $(command -v gnome-session >/dev/null && echo tak || echo nie)"
  say "RDP:  $(systemctl is-active xrdp 2>/dev/null) na $(listen_addrs 3389 | xargs)"
  if [[ -n $n ]]; then
    local u; for u in tigervncserver@ vncserver@; do unit_exists "$u.service" && break; done
    say "VNC:  $(systemctl is-active "$u:$n.service" 2>/dev/null) ekran :$n na $(listen_addrs $((5900 + n)) | xargs)"
  fi
  if installed chrome-remote-desktop; then
    local reg=nie; compgen -G "$(home_of "$user")/.config/chrome-remote-desktop/host#*.json" >/dev/null && reg=tak
    say "CRD:  $(systemctl is-active "chrome-remote-desktop@$user.service" 2>/dev/null) zarejestrowany: $reg"
  fi
  say "Hasło $user: $(passwd -S "$user" 2>/dev/null | awk '{print ($2=="P")?"jest":"brak"}')   start systemu: $(systemctl get-default)"
  say "Sygnały używania ($SIGNALS): $(ls -1 "$SIGNALS" 2>/dev/null | xargs || true)"
}

cmd_doctor() {
  cmd_status
  local user=${RD_USER:-} home; home=$(home_of "$user" 2>/dev/null || true)
  say ''; say '== Sesje (loginctl)'; loginctl list-sessions --no-legend 2>/dev/null || true
  local f
  for f in /var/log/xrdp-sesman.log /var/log/xrdp.log "$home/.local/state/remote-desktop/session.log" "$home/.xsession-errors"; do
    [[ -r $f ]] || continue; say ''; say "== $f (ostatnie linie)"; tail -n 25 "$f"
  done
  say ''; say '== Usługi (dziennik)'
  journalctl -u xrdp -u xrdp-sesman -u "tigervncserver@*" -u "vncserver@*" -u "chrome-remote-desktop@*" -n 40 --no-pager 2>/dev/null || true
  say ''
  say 'Typowe przyczyny: czarny ekran = zawieszona sesja → sudo remote-desktop reset; „login failed” w RDP = brak hasła → sudo passwd UŻYTKOWNIK;'
  say 'GNOME nie startuje, gdy ten sam użytkownik ma już GNOME w innej sesji → użyj KDE albo zakończ tamtą sesję.'
}

cmd_tunnel() { read_conf; print_how_to_connect "${RD_USER:-$(id -un)}"; }

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
case "${1:-install}" in
  install|--*) [[ ${1:-} == install ]] && shift; install_all "$@" ;;
  status) cmd_status ;;
  doctor) cmd_doctor ;;
  use) shift; cmd_use "$@" ;;
  reset) shift; cmd_reset "$@" ;;
  crd-register) cmd_crd_register ;;
  vnc-password) cmd_vnc_password ;;
  tunnel) cmd_tunnel ;;
  -h|--help|help) sed -n '2,13p' "${BASH_SOURCE[0]}" ;;
  *) die "Nieznane polecenie: $1 (status, doctor, use, reset, crd-register, vnc-password, tunnel)" ;;
esac
fi
