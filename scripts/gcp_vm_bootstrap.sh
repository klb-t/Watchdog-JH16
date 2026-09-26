#!/usr/bin/env bash
# Called by deploy_gcp_vm.sh over a verified SSH/IAP session. No cloud credentials.
set -Eeuo pipefail
umask 077
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
archive=''; commit=''; public_host=''; owner=''
while (($#)); do
  case "$1" in
    --help|-h) printf '%s\n' 'Internal VM bootstrap: sudo bash gcp_vm_bootstrap.sh --archive SOURCE.tar.gz --commit FULL_SHA [--public-host HOST] [--owner EMAIL]'; exit 0 ;;
    --archive|--commit|--public-host|--owner)
      (($# >= 2)) || die "Missing value for $1"
      case "$1" in --archive) archive=$2;; --commit) commit=$2;; --public-host) public_host=${2,,};; --owner) owner=${2,,};; esac; shift 2 ;;
    *) die "Unknown option: $1" ;;
  esac
done
[[ $commit =~ ^[a-f0-9]{40}$ && -f $archive ]] || die 'A source archive and full commit SHA are required.'
[[ -z $public_host || $public_host =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$ ]] || die 'Invalid public host name.'
[[ -z $owner || $owner =~ ^[^[:space:]@\"]+@[^[:space:]@\"]+\.[^[:space:]@\"]+$ ]] || die 'Invalid owner email.'
((EUID == 0)) || die 'Run through sudo.'
# A public address in front of the shared local user would give the instance to
# anyone. Checked before anything is built or changed.
if [[ -n $public_host && -z $owner ]] && ! grep -qsx 'WATCHDOG_AUTH=accounts' /etc/watchdog/app.env; then
  die 'Public access needs sign-in: pass --owner YOUR_EMAIL (you become the operator).'
fi
# shellcheck source=/dev/null
. /etc/os-release
case "$ID:$VERSION_ID" in ubuntu:22.04|ubuntu:24.04|ubuntu:26.04|debian:12|debian:13) ;; *) die 'Supported: Ubuntu 22.04/24.04/26.04 or Debian 12/13.';; esac
command -v systemctl >/dev/null || die 'systemd is required.'
exec 9>/run/lock/watchdog-install.lock
flock -n 9 || die 'Another Watchdog install/backup is running.'
awk '/MemTotal:/ {exit ($2 < 3000000)}' /proc/meminfo || die 'Use at least 4 GB RAM; 8 GB is recommended for building and browser tests.'
free_kb=$(df --output=avail /var | tail -1 | tr -d ' ')
((free_kb >= 12000000)) || die 'At least 12 GB free space is needed; a 50 GB boot disk is recommended.'
if [[ -e /etc/systemd/system/watchdog.service ]]; then
  grep -q 'Managed by scripts/gcp_vm_bootstrap.sh' /etc/systemd/system/watchdog.service || die 'An unmanaged watchdog.service already exists.'
elif [[ ( -e /etc/watchdog || -e /var/lib/watchdog ) && ! -f /etc/watchdog/installer-v1 ]]; then
  die 'Existing Watchdog state has no managed service. Inspect it before installing.'
fi
if command -v docker >/dev/null; then
  other=$(docker ps --format '{{.Names}}' | grep -v '^watchdog$' || true)
  [[ -z $other ]] || die 'Use a dedicated VM: other containers are running.'
fi
export DEBIAN_FRONTEND=noninteractive
apt-get -o DPkg::Lock::Timeout=120 update
apt-get -o DPkg::Lock::Timeout=120 install -y --no-install-recommends ca-certificates curl openssl python3 ufw
if ! command -v docker >/dev/null; then
  # Refuse conflicting engines rather than silently removing someone else's runtime.
  for package in docker.io docker-compose podman-docker containerd runc; do
    if dpkg-query -W -f='${Status}' "$package" 2>/dev/null | grep -q 'install ok installed'; then
      die "Conflicting package $package is installed. Use a fresh dedicated VM."
    fi
  done
  install -d -m 0755 /etc/apt/keyrings
  curl --fail --silent --show-error --location --retry 3 "https://download.docker.com/linux/$ID/gpg" -o /etc/apt/keyrings/docker.asc
  chmod 0644 /etc/apt/keyrings/docker.asc
  cat > /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/$ID
Suites: ${VERSION_CODENAME}
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
  chmod 0644 /etc/apt/sources.list.d/docker.sources
  apt-get -o DPkg::Lock::Timeout=120 update
  apt-get -o DPkg::Lock::Timeout=120 install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker
docker_major=$(docker version --format '{{.Server.Version}}' | cut -d. -f1)
[[ $docker_major =~ ^[0-9]+$ ]] && ((docker_major >= 28)) || die 'Docker Engine 28+ is required for localhost port isolation; update Docker and rerun.'

# IAP SSH first, then deny other SSH clients; keep existing rules rather than reset
# another firewall. Docker bypasses UFW, so the container MUST also bind loopback.
# Append the allow first, then the deny. Unlike "ufw insert 1", this also works
# on a pristine UFW ruleset; UFW de-duplicates identical rules on reruns.
ufw allow from 35.235.240.0/20 to any port 22 proto tcp comment 'Watchdog IAP SSH'
ufw deny 22/tcp comment 'Watchdog SSH only through IAP'
ufw default deny incoming
ufw default allow outgoing
ufw --force enable

install -d -m 0755 /opt/watchdog /opt/watchdog/releases
release=$(mktemp -d "/opt/watchdog/releases/$commit.XXXXXXXX")
tar -xzf "$archive" --no-same-owner -C "$release"
image="watchdog:$commit"
printf '\nBuilding and testing %s. The previous service keeps running during the build.\n' "$commit"
docker build --pull --tag "$image" --label "org.opencontainers.image.revision=$commit" "$release"

# Stop only after the replacement image passes every build/test gate. One writer.
was_active=false; systemctl is-active --quiet watchdog.service && was_active=true
if [[ -f /etc/systemd/system/watchdog.service ]]; then systemctl stop watchdog.service; fi
restart_previous=true
trap 'code=$?; if ((code != 0)) && $restart_previous && $was_active; then systemctl start watchdog.service; fi' EXIT
if [[ -f /etc/watchdog/release.env ]]; then
  install -d -m 0700 /var/backups/watchdog
  backup="/var/backups/watchdog/$(date -u +%Y%m%dT%H%M%SZ)-pre-$commit-$$.tar.gz"
  tar -czf "$backup.partial" -C / etc/watchdog var/lib/watchdog etc/systemd/system/watchdog.service usr/local/sbin/watchdogctl
  mv "$backup.partial" "$backup"
  sha256sum "$backup" > "$backup.sha256"
  printf 'Pre-update backup: %s\n' "$backup"
fi
# After changing the runtime, never automatically downgrade a migrated database.
restart_previous=false
install -d -m 0700 /etc/watchdog
touch /etc/watchdog/installer-v1
install -d -m 0700 -o 1000 -g 1000 /var/lib/watchdog
if [[ ! -f /etc/watchdog/app.env ]]; then
  cat > /etc/watchdog/app.env <<EOF
NODE_ENV=production
PORT=8080
WATCHDOG_ALLOW_OPEN_INSTANCE=true
DB_PATH=/mnt/watchdog/watchdog.sqlite
STORE_BACKEND=local
STORE_PATH=/mnt/watchdog/object_store
WATCHDOG_DIAGNOSTICS_MODE=NORMAL
WATCHDOG_DIAGNOSTICS_DIR=/mnt/watchdog/diagnostics
WATCHDOG_VAULT_KEY_FILE=/mnt/watchdog/secrets/master.key
SESSION_SIGNING_KEY=$(openssl rand -hex 32)
EOF
fi
chmod 0600 /etc/watchdog/app.env
printf 'WATCHDOG_IMAGE=%s\nWATCHDOG_COMMIT=%s\n' "$image" "$commit" > /etc/watchdog/release.env
install -m 0644 "$release/deploy/watchdog.service" /etc/systemd/system/watchdog.service
install -m 0644 "$release/deploy/watchdog-proxy.service" /etc/systemd/system/watchdog-proxy.service
install -m 0755 "$release/scripts/watchdogctl.sh" /usr/local/sbin/watchdogctl
systemctl daemon-reload
systemctl enable --now watchdog.service
ready=false
for attempt in {1..60}; do
  if curl --fail --silent --max-time 2 http://127.0.0.1:8080/api/auth/config >/dev/null; then ready=true; break; fi
  sleep 2
done
if ! $ready; then
  printf '%s\n' 'Startup failed. Inspect sudo watchdogctl logs. Previous images and backups are retained; no database downgrade was attempted.' >&2
  exit 1
fi
ln -sfn "$release" /opt/watchdog/current
printf '\nWatchdog ready at VM loopback port 8080, commit %s.\n' "$commit"
# Sign-in before the public address, always: enable-public refuses otherwise.
if [[ -n $owner ]]; then /usr/local/sbin/watchdogctl enable-accounts "$owner" --no-link; fi
if [[ -n $public_host ]]; then /usr/local/sbin/watchdogctl enable-public "$public_host"; fi
if systemctl is-enabled --quiet watchdog-proxy.service 2>/dev/null; then systemctl restart watchdog-proxy.service; fi
if [[ -n $owner ]]; then
  printf '\nYour one-time sign-in link (15 minutes):\n'
  /usr/local/sbin/watchdogctl signin-link "$owner"
fi
printf '%s\n' 'Commands: sudo watchdogctl status | logs | backup | people. Re-run the Cloud Shell installer to update.'
