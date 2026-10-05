#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
root=${WATCHDOG_ROOT:-/}
[[ $root == /* && -d $root ]] || die 'WATCHDOG_ROOT must be an existing absolute directory.'
root=$(cd "$root" && pwd -P)
[[ $root != / ]] || root=''
helper="$root/usr/local/lib/watchdog/watchdog_backup.py"
require_admin() { [[ -n $root ]] || ((EUID == 0)) || die 'Use sudo.'; }
# An isolated filesystem does not isolate host commands: require explicit stubs.
require_commands() {
  [[ -n $root ]] || return 0
  local cmd resolved
  for cmd in "$@"; do
    resolved=$(command -v "$cmd") || die "Missing test command: $cmd"
    resolved=$(readlink -f "$resolved")
    [[ $resolved == "$root/"* ]] || die "Isolated WATCHDOG_ROOT requires $cmd stub beneath that root."
  done
}
lock() {
  install -d -m 0755 "$root/run/lock"
  exec 9>"$root/run/lock/watchdog-install.lock"
  flock -n 9 || die 'Another install/backup is running.'
}
image_id() {
  local value reference
  value=$(docker inspect --format '{{.Image}}' watchdog 2>/dev/null) || value=''
  if [[ ! $value =~ ^sha256:[a-f0-9]{64}$ ]]; then
    reference=$(sed -n 's/^WATCHDOG_IMAGE=//p' "$root/etc/watchdog/release.env")
    if [[ $reference =~ ^sha256:[a-f0-9]{64}$ ]]; then value=$reference
    else value=$(docker image inspect --format '{{.Id}}' "$reference") || return 1; fi
  fi
  [[ $value =~ ^sha256:[a-f0-9]{64}$ ]] || return 1
  printf '%s\n' "$value"
}
case "${1:-help}" in
  people|grant|invite|open-link|signin-link|enable-accounts|enable-public|disable-public|enable-gate|disable-gate|proxy-logs|set-public-url|set-mail)
    module="$root/usr/local/lib/watchdog/watchdog_access.sh"
    [[ -f $module ]] || die 'Access administration module missing; update the installation.'
    . "$module"
    access_command "$@" ;;
  status)
    require_commands systemctl
    code=0; systemctl --no-pager status watchdog.service || code=$?
    if [[ -f $root/etc/watchdog/recovery-required ]]; then cat "$root/etc/watchdog/recovery-required"; fi
    if [[ -f $root/etc/watchdog/release.env ]]; then cat "$root/etc/watchdog/release.env"; fi
    exit "$code"
    ;;
  logs) require_commands journalctl; journalctl -u watchdog.service -n 150 --no-pager ;;
  errors|trace|diag-summary)
    diag="$root/usr/local/lib/watchdog/watchdog_diag.py"
    [[ -f $diag ]] || die 'Diagnostics reader missing; update the installation.'
    sub=$1; shift; [[ $sub == diag-summary ]] && sub=summary
    WATCHDOG_ROOT="${root:-/}" python3 "$diag" "$sub" "$@" ;;
  idle-check)
    # Run every 5 minutes by watchdog-idle.timer when the gate is enabled. Powers the VM off
    # only when: the gate is configured, the machine has been up longer than the idle time,
    # nobody has used the app (activity file) for that long, and no install/backup holds the lock.
    require_admin; require_commands systemctl
    [[ -f $root/etc/watchdog/idle.env ]] || { echo 'Gate not enabled; nothing to do.'; exit 0; }
    idle=$(sed -n 's/^WATCHDOG_IDLE_MINUTES=//p' "$root/etc/watchdog/idle.env")
    [[ $idle =~ ^[0-9]+$ ]] && ((idle >= 10)) || die 'Invalid WATCHDOG_IDLE_MINUTES.'
    up=$(cut -d' ' -f1 "$root/proc/uptime"); up=${up%.*}
    if ((up < idle * 60)); then echo "Up ${up}s; staying on for at least ${idle} minutes after boot."; exit 0; fi
    activity="$root/var/lib/watchdog/activity.json"
    if [[ -f $activity ]]; then
      age=$(( $(date +%s) - $(stat -c %Y "$activity") ))
      if ((age < idle * 60)); then echo "Last use ${age}s ago; staying on."; exit 0; fi
    fi
    install -d -m 0755 "$root/run/lock"
    exec 9>"$root/run/lock/watchdog-install.lock"
    flock -n 9 || { echo 'Install or backup in progress; staying on.'; exit 0; }
    logger -t watchdog-idle "No use for ${idle} minutes; powering off. The gate starts the VM on the next visit." 2>/dev/null || true
    echo "No use for ${idle} minutes; powering off."
    systemctl poweroff ;;
  diagnostics-mode)
    (($# == 2)) && [[ $2 =~ ^(OFF|ERRORS|NORMAL|TRACE)$ ]] || die 'Usage: watchdogctl diagnostics-mode OFF|ERRORS|NORMAL|TRACE'
    require_admin; require_commands systemctl
    python3 - "$root/etc/watchdog/app.env" "$2" <<'PYEOF'
import os, sys
path, mode = sys.argv[1:3]
lines = [l for l in open(path).read().splitlines() if not l.startswith('WATCHDOG_DIAGNOSTICS_MODE=')] + [f'WATCHDOG_DIAGNOSTICS_MODE={mode}']
tmp = path + '.tmp'
open(tmp, 'w').write('\n'.join(lines) + '\n'); os.chmod(tmp, 0o600); os.replace(tmp, path)
PYEOF
    systemctl restart watchdog.service
    printf 'Diagnostics mode %s. Daily request/error records are kept in every mode except OFF.\n' "$2" ;;
  restart)
    require_admin; require_commands systemctl; lock
    [[ ! -e $root/etc/watchdog/recovery-required ]] || die 'Recovery required; inspect /etc/watchdog/recovery-required before starting.'
    systemctl restart watchdog.service ;;
  backup)
    (($# <= 2)) || die 'Usage: watchdogctl backup [ABSOLUTE_ARCHIVE]'
    require_admin; require_commands systemctl docker; lock
    [[ ! -e $root/etc/watchdog/recovery-required ]] || die 'Recovery required; preserve the pre-update backup and inspect the marker first.'
    install -d -m 0700 "$root/var/backups/watchdog"
    file=${2:-"$root/var/backups/watchdog/$(date -u +%Y%m%dT%H%M%SZ)-$$.tar.gz"}
    [[ $file == /* ]] || die 'Backup destination must be absolute.'
    immutable=$(image_id) || die 'Cannot determine the immutable image compatible with this state.'
    active=false; systemctl is-active --quiet watchdog.service && active=true
    finish_backup() {
      local code=$?
      trap - EXIT
      if $active; then
        if ! systemctl start watchdog.service; then
          printf '%s\n' 'ERROR: backup ended but the previously active service could not restart.' >&2
          code=1
        fi
      fi
      exit "$code"
    }
    trap finish_backup EXIT
    trap 'exit 130' INT
    trap 'exit 143' TERM
    systemctl stop watchdog.service
    if ! running=$(docker inspect --format '{{.State.Running}}' watchdog 2>/dev/null); then
      containers=$(docker ps --all --format '{{.Names}}') || die 'Cannot verify that Docker has stopped the data writer.'
      if printf '%s\n' "$containers" | grep -qx watchdog; then die 'Cannot inspect the existing Watchdog container.'; fi
      running=absent
    fi
    [[ $running == false || $running == absent ]] || die 'A Watchdog container is still running; refusing an inconsistent backup.'
    python3 "$helper" create --root "${root:-/}" --output "$file" --image-id "$immutable"
    python3 "$helper" verify --archive "$file"
    printf 'Private verified backup (contains vault keys): %s\n' "$file"
    ;;
  verify)
    (($# == 2)) || die 'Usage: watchdogctl verify ARCHIVE'
    python3 "$helper" verify --archive "$2" ;;
  restore)
    (($# == 3)) || die 'Usage: watchdogctl restore ARCHIVE NEW_ABSOLUTE_DIRECTORY'
    # Staging only: never touches the active installation or invokes Docker/systemd.
    python3 "$helper" restore --archive "$2" --destination "$3" ;;
  *) printf '%s\n' 'Usage: watchdogctl status | logs | errors [N] | trace TRACE_ID | diag-summary | diagnostics-mode MODE | idle-check | enable-gate URL INTERNAL_IP [MIN] | disable-gate | restart | backup [ABSOLUTE_ARCHIVE] | verify ARCHIVE | restore ARCHIVE NEW_ABSOLUTE_DIRECTORY | people | grant | invite | open-link | signin-link | enable-accounts EMAIL | enable-public HOST | disable-public | proxy-logs | set-public-url URL | set-mail'; [[ ${1:-help} == help ]] ;;
esac
