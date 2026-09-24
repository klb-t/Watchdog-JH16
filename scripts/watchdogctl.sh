#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
ENV_FILE=/etc/watchdog/app.env

need_root() { ((EUID == 0)) || { echo 'Use sudo.' >&2; exit 1; }; }

# Rewrites one KEY=VALUE line of the service environment (docker --env-file:
# no quoting, the value runs to the end of the line). A value of "" deletes it.
set_env() {
  python3 - "$ENV_FILE" "$1" "$2" <<'PYEOF'
import sys, os
path, key, value = sys.argv[1:4]
if '\n' in value: sys.exit('Refusing a value containing a newline.')
lines = open(path).read().splitlines() if os.path.exists(path) else []
lines = [l for l in lines if not l.startswith(key + '=')]
if value != '': lines.append(f'{key}={value}')
tmp = path + '.tmp'
with open(tmp, 'w') as f: f.write('\n'.join(lines) + '\n')
os.chmod(tmp, 0o600); os.replace(tmp, path)
PYEOF
}

# Access administration runs inside the container, against the live database.
admin() { docker exec watchdog node dist/watchdog-admin.cjs "$@"; }

case "${1:-help}" in
  people|grant|signin-link|invite|open-link)
    need_root; admin "$@" ;;
  enable-accounts)
    # Switches the private installation from one shared local user to sign-in,
    # with EMAIL as the operator-granted developer who can then admit others.
    need_root
    email=${2:-}
    [[ $email =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] || { echo 'Usage: sudo watchdogctl enable-accounts YOUR_EMAIL' >&2; exit 1; }
    email=${email,,}
    set_env WATCHDOG_AUTH accounts
    set_env WATCHDOG_ALLOW_OPEN_INSTANCE ''
    set_env WATCHDOG_GRANTS "{\"$email\":\"developer\"}"
    systemctl restart watchdog.service
    for _ in {1..60}; do curl --fail --silent --max-time 2 http://127.0.0.1:8080/api/auth/config >/dev/null && break; sleep 2; done
    printf 'Sign-in is on. %s is the operator (developer), which the UI cannot remove.\n' "$email"
    printf 'Existing runs belong to "local-user"; claim them from People & access after signing in.\n\n'
    admin signin-link "$email" ;;
  set-public-url)
    need_root
    url=${2:-}
    [[ $url =~ ^https://[^[:space:]/]+$ ]] || { echo 'Usage: sudo watchdogctl set-public-url https://your.domain (no path)' >&2; exit 1; }
    set_env WATCHDOG_PUBLIC_URL "$url"
    systemctl restart watchdog.service
    echo "Public URL set to $url." ;;
  set-mail)
    # Prompted, never an argument: an SMTP password on the command line lands in
    # shell history and in the process list.
    need_root
    read -r -p 'From address (e.g. WatchDog <you@gmail.com>): ' from
    read -r -s -p 'SMTP URL (e.g. smtps://you%40gmail.com:APP_PASSWORD@smtp.gmail.com:465): ' smtp; echo
    [[ $smtp =~ ^smtps?:// && -n $from ]] || { echo 'Both values are required; SMTP URL must start with smtp:// or smtps://.' >&2; exit 1; }
    set_env MAIL_FROM "$from"
    set_env SMTP_URL "$smtp"
    unset smtp
    systemctl restart watchdog.service
    echo 'Mail configured. Sign-in by emailed code is now offered on the login screen.' ;;
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
  *) cat <<'USAGE'
Usage: sudo watchdogctl COMMAND
  status | logs | restart | backup
  enable-accounts YOUR_EMAIL     turn on sign-in; you become the operator
  set-public-url https://HOST    address people open (needed to email links)
  set-mail                       configure outgoing mail (prompts, nothing in history)
  people                         who has access, who is waiting
  grant EMAIL ROLES              give access now (e.g. researcher,responder)
  invite EMAIL ROLES             print an invitation link bound to EMAIL
  open-link ROLES [--uses N]     print a link anyone may use (never admin)
  signin-link EMAIL              one-time sign-in link, 15 minutes
USAGE
    [[ ${1:-help} == help ]] ;;
esac
