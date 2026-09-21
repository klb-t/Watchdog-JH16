#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
case "${1:-help}" in
  status) systemctl --no-pager status watchdog.service; cat /etc/watchdog/release.env ;;
  logs) journalctl -u watchdog.service -n 150 --no-pager ;;
  restart)
    ((EUID == 0)) || { echo 'Use sudo.' >&2; exit 1; }
    exec 9>/run/lock/watchdog-install.lock
    flock -n 9 || { echo 'Another install/backup is running.' >&2; exit 1; }
    systemctl restart watchdog.service ;;
  backup)
    ((EUID == 0)) || { echo 'Use sudo.' >&2; exit 1; }
    exec 9>/run/lock/watchdog-install.lock
    flock -n 9 || { echo 'Another install/backup is running.' >&2; exit 1; }
    install -d -m 0700 /var/backups/watchdog
    active=false; systemctl is-active --quiet watchdog.service && active=true
    # Always restart a previously running service if tar/disk space fails.
    trap 'if $active; then systemctl start watchdog.service; fi' EXIT
    systemctl stop watchdog.service
    file="/var/backups/watchdog/$(date -u +%Y%m%dT%H%M%SZ)-$$.tar.gz"
    tar -czf "$file.partial" -C / etc/watchdog var/lib/watchdog etc/systemd/system/watchdog.service usr/local/sbin/watchdogctl
    mv "$file.partial" "$file"
    sha256sum "$file" > "$file.sha256"
    printf 'Private backup (contains vault keys): %s\n' "$file"
    ;;
  *) printf '%s\n' 'Usage: sudo watchdogctl status | logs | restart | backup'; [[ ${1:-help} == help ]] ;;
esac
