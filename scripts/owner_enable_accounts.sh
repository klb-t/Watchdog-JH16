#!/bin/bash
# Turn on WatchDog's own sign-in (Google) and drop Caddy basic auth for watchdog.*, keeping all existing data.
#
#   sudo bash enable_accounts.sh --email YOUR_GOOGLE_EMAIL [--contact ADDRESS] [--dry-run]
#   --contact is the public contact shown on /privacy; it is left as it is unless given (your sign-in address is never used for it).
#
# Requires the deployed image to contain the access package (watchdog-admin claim-local-user).
# Steps, each checked before the next:
#   1. backup: data, app.env, aliases.sh and the Caddyfile (service stopped for the data copy)
#   2. app.env: WATCHDOG_AUTH=accounts, WATCHDOG_GRANTS (+ your address as developer), GOOGLE_OAUTH_CLIENT_ID,
#      SESSION_SIGNING_KEY (kept if present), WATCHDOG_PUBLIC_URL, WATCHDOG_TRUST_PROXY, contact and data location
#   3. restart; then claim-local-user YOUR_EMAIL, BEFORE anyone signs in, so your Google sign-in lands on the
#      existing owner (local-user) and keeps every run, protocol and stored key
#   4. Caddy: watchdog alias from basic to none in aliases.sh, Caddyfile regenerated and validated
#   5. checks over HTTPS; prints the rollback command
set -euo pipefail
EMAIL='' CONTACT='' DRY=0
LOCATION=${LOCATION:-'Google Cloud VM, region europe-west4 (Holandia, UE)'}
CLIENT_ID=${CLIENT_ID:-827013441656-g7vn65dpo6ddvdehu1arj1hka18k9eg6.apps.googleusercontent.com}
HOST=${HOST:-watchdog.34-158-117-249.sslip.io}
APP_ENV=${APP_ENV:-/etc/watchdog/app.env}; DATA=${DATA:-/var/lib/watchdog}; CONTAINER=${CONTAINER:-watchdog}; SERVICE=${SERVICE:-watchdog.service}
ALIASES=${ALIASES:-$(getent passwd "${SUDO_USER:-$USER}" | cut -d: -f6)/chatadhd/tools/gcp/aliases.sh}; CADDYFILE=${CADDYFILE:-/etc/caddy/Caddyfile}
BACKUPS=${BACKUPS:-/var/backups/watchdog}
while [ $# -gt 0 ]; do case "$1" in --email) EMAIL=${2,,}; shift 2;; --contact) CONTACT=$2; shift 2;; --dry-run) DRY=1; shift;; *) sed -n '2,15p' "$0"; exit 2;; esac; done
die() { echo "STOP: $*" >&2; exit 1; }
[[ $EMAIL =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] || die 'Give --email with the Google address you will sign in with.'
((EUID == 0)) || die 'Run with sudo.'
for f in "$APP_ENV" "$ALIASES" "$CADDYFILE"; do [ -f "$f" ] || die "$f not found."; done
docker exec "$CONTAINER" node dist/watchdog-admin.cjs help 2>/dev/null | grep -q claim-local-user \
  || die 'The running image has no claim-local-user. Deploy the version with the access package first (deploy_main.sh).'
grep -q '^  "watchdog|127.0.0.1:8080|basic"$' "$ALIASES" || grep -q '^  "watchdog|127.0.0.1:8080|none"$' "$ALIASES" || die "Unexpected watchdog line in $ALIASES; edit it by hand."

# The app.env change, computed once and shown with secrets masked.
NEW_ENV=$(mktemp); trap 'rm -f "$NEW_ENV"' EXIT
python3 - "$APP_ENV" "$NEW_ENV" "$EMAIL" "$CLIENT_ID" "https://$HOST" "$CONTACT" "$LOCATION" <<'PY'
import json, os, secrets, sys
src, out, email, client, url, contact, location = sys.argv[1:]
lines = open(src).read().splitlines(); env = {}
for l in lines:
    if '=' in l and not l.lstrip().startswith('#'): k, v = l.split('=', 1); env[k] = v
grants = json.loads(env.get('WATCHDOG_GRANTS') or '{}'); grants[email] = 'developer'
want = {'WATCHDOG_AUTH': 'accounts', 'WATCHDOG_GRANTS': json.dumps(grants, separators=(',', ':')), 'GOOGLE_OAUTH_CLIENT_ID': client,
        'SESSION_SIGNING_KEY': env.get('SESSION_SIGNING_KEY') or secrets.token_hex(32), 'WATCHDOG_PUBLIC_URL': url, 'WATCHDOG_TRUST_PROXY': 'loopback,uniquelocal',
        'WATCHDOG_DATA_LOCATION': location}
if contact: want['WATCHDOG_OPERATOR_CONTACT'] = contact
for k, v in want.items():
    if '\n' in v or '\r' in v: sys.exit(f'{k} cannot contain a newline')
kept = [l for l in lines if not any(l.startswith(k + '=') for k in [*want, 'WATCHDOG_ALLOW_OPEN_INSTANCE'])]
open(out, 'w').write('\n'.join(kept + [f'{k}={v}' for k, v in want.items()]) + '\n'); os.chmod(out, 0o600)
mask = lambda k, v: v if k not in ('SESSION_SIGNING_KEY',) and 'SMTP' not in k and 'KEY' not in k else '<kept>' if env.get(k) == v else '<new secret>'
for k, v in want.items(): print(f'  {k}: {mask(k, env.get(k, "")) if k in env else "(unset)"} -> {mask(k, v)}')
if 'WATCHDOG_ALLOW_OPEN_INSTANCE' in env: print('  WATCHDOG_ALLOW_OPEN_INSTANCE: removed')
PY
[ -n "$CONTACT" ] || echo "  WATCHDOG_OPERATOR_CONTACT: not set by this script (/privacy says no contact is given; add --contact ADDRESS to publish one)"
echo "Caddy: $ALIASES watchdog basic -> none; $CADDYFILE regenerated"
if [ "$DRY" = 1 ]; then echo 'Dry run: nothing changed.'; exit 0; fi

TS=$(date -u +%Y%m%dT%H%M%SZ); mkdir -p "$BACKUPS"; chmod 700 "$BACKUPS"
systemctl stop "$SERVICE"
tar -C "$(dirname "$DATA")" -czf "$BACKUPS/watchdog-data-before-accounts-$TS.tar.gz" "$(basename "$DATA")"
cp -p "$APP_ENV" "$BACKUPS/app.env.before-accounts-$TS"; cp -p "$ALIASES" "$BACKUPS/aliases.sh.before-accounts-$TS"; cp -p "$CADDYFILE" "$BACKUPS/Caddyfile.before-accounts-$TS"
sha256sum "$BACKUPS/watchdog-data-before-accounts-$TS.tar.gz"
ROLLBACK="sudo systemctl stop $SERVICE; sudo cp -p $BACKUPS/app.env.before-accounts-$TS $APP_ENV; sudo tar -C $(dirname "$DATA") -xzf $BACKUPS/watchdog-data-before-accounts-$TS.tar.gz; sudo cp -p $BACKUPS/aliases.sh.before-accounts-$TS $ALIASES; sudo cp -p $BACKUPS/Caddyfile.before-accounts-$TS $CADDYFILE; sudo systemctl reload caddy; sudo systemctl start $SERVICE"
trap 'rm -f "$NEW_ENV"; echo; echo "Something failed. Roll back with:"; echo "  $ROLLBACK"' ERR

install -m 600 -o root -g root "$NEW_ENV" "$APP_ENV"
systemctl start "$SERVICE"
for i in $(seq 1 90); do curl -sf http://127.0.0.1:8080/api/auth/config >/dev/null && break; sleep 1; done
curl -sf http://127.0.0.1:8080/api/auth/config | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["mode"]=="accounts", d["mode"]; assert d["methods"]["google"], "Google sign-in not configured"; print("accounts mode with Google sign-in: ok")'
docker exec "$CONTAINER" node dist/watchdog-admin.cjs claim-local-user "$EMAIL"

sed -i 's#^  "watchdog|127.0.0.1:8080|basic"$#  "watchdog|127.0.0.1:8080|none"#' "$ALIASES"
bash "$ALIASES" >/dev/null
code=$(curl -s -o /dev/null -w '%{http_code}' "https://$HOST/api/auth/config")
[ "$code" = 200 ] || { echo "HTTPS check returned $code (expected 200 without basic auth)"; false; }
for p in privacy terms; do [ "$(curl -s -o /dev/null -w '%{http_code}' "https://$HOST/$p")" = 200 ] || { echo "/$p is not reachable"; false; }; done
trap - ERR
echo
echo "Done. Open https://$HOST and sign in with Google as $EMAIL: you land on your existing data."
echo "Google OAuth consent screen: home page https://$HOST/  privacy https://$HOST/privacy  terms https://$HOST/terms"
echo "Rollback, if ever needed:"; echo "  $ROLLBACK"
