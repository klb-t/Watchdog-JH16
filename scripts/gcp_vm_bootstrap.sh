#!/usr/bin/env bash
# Called by deploy_gcp_vm.sh over a verified SSH/IAP session. No cloud credentials.
set -Eeuo pipefail
umask 077
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
root=${WATCHDOG_ROOT:-/}
[[ $root == /* && -d $root ]] || die 'WATCHDOG_ROOT must be an existing absolute directory.'
root=$(cd "$root" && pwd -P)
[[ $root != / ]] || root=''
# The root prefix redirects files, not commands. Isolated tests must supply stubs.
if [[ -n $root ]]; then
  for cmd in systemctl docker apt-get ufw curl; do
    resolved=$(command -v "$cmd") || die "Missing test command: $cmd"
    resolved=$(readlink -f "$resolved")
    [[ $resolved == "$root/"* ]] || die "Isolated WATCHDOG_ROOT requires $cmd stub beneath that root."
  done
fi
archive=''; commit=''
while (($#)); do
  case "$1" in
    --help|-h) printf '%s\n' 'Internal VM bootstrap: sudo bash gcp_vm_bootstrap.sh --archive SOURCE.tar.gz --commit FULL_SHA'; exit 0 ;;
    --archive|--commit)
      (($# >= 2)) || die "Missing value for $1"
      case "$1" in --archive) archive=$2;; --commit) commit=$2;; esac; shift 2 ;;
    *) die "Unknown option: $1" ;;
  esac
done
[[ $commit =~ ^[a-f0-9]{40}$ && -f $archive ]] || die 'A source archive and full commit SHA are required.'
[[ -n $root ]] || ((EUID == 0)) || die 'Run through sudo.'
# shellcheck source=/dev/null
. "$root/etc/os-release"
case "$ID:$VERSION_ID" in ubuntu:22.04|ubuntu:24.04|ubuntu:26.04|debian:12|debian:13) ;; *) die 'Supported: Ubuntu 22.04/24.04/26.04 or Debian 12/13.';; esac
command -v systemctl >/dev/null || die 'systemd is required.'
install -d -m 0755 "$root/run/lock"
exec 9>"$root/run/lock/watchdog-install.lock"
flock -n 9 || die 'Another Watchdog install/backup is running.'
awk '/MemTotal:/ {exit ($2 < 3000000)}' "$root/proc/meminfo" || die 'Use at least 4 GB RAM; 8 GB is recommended for building and browser tests.'
free_kb=$(df --output=avail "$root/var" | tail -1 | tr -d ' ')
((free_kb >= 12000000)) || die 'At least 12 GB free space is needed; a 50 GB boot disk is recommended.'
if [[ -e "$root/etc/systemd/system/watchdog.service" ]]; then
  grep -q 'Managed by scripts/gcp_vm_bootstrap.sh' "$root/etc/systemd/system/watchdog.service" || die 'An unmanaged watchdog.service already exists.'
elif [[ ( -e "$root/etc/watchdog" || -e "$root/var/lib/watchdog" ) && ! -f "$root/etc/watchdog/installer-v1" ]]; then
  die 'Existing Watchdog state has no managed service. Inspect it before installing.'
fi
if command -v docker >/dev/null; then
  other=$(docker ps --format '{{.Names}}' | grep -v '^watchdog$' || true)
  [[ -z $other ]] || die 'Use a dedicated VM: other containers are running.'
fi
[[ ! -e $root/etc/watchdog/recovery-required ]] || die 'Recovery required; inspect /etc/watchdog/recovery-required before another update.'
[[ ! -f $root/etc/systemd/system/watchdog.service || -f $root/etc/watchdog/release.env ]] || die 'Managed service has no release metadata; inspect the incomplete installation before updating.'
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
  install -d -m 0755 "$root/etc/apt/keyrings"
  curl --fail --silent --show-error --location --retry 3 "https://download.docker.com/linux/$ID/gpg" -o "$root/etc/apt/keyrings/docker.asc"
  chmod 0644 "$root/etc/apt/keyrings/docker.asc"
  cat > "$root/etc/apt/sources.list.d/docker.sources" <<EOF
Types: deb
URIs: https://download.docker.com/linux/$ID
Suites: ${VERSION_CODENAME}
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: $root/etc/apt/keyrings/docker.asc
EOF
  chmod 0644 "$root/etc/apt/sources.list.d/docker.sources"
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

install -d -m 0755 "$root/opt/watchdog" "$root/opt/watchdog/releases"
release=$(mktemp -d "$root/opt/watchdog/releases/$commit.XXXXXXXX")
tar -xzf "$archive" --no-same-owner -C "$release"
[[ -f $release/scripts/watchdog_backup.py ]] || die 'Source archive lacks the backup helper.'

# Capture the old immutable identity before any build can retag an image.
old_image=''
if [[ -f $root/etc/watchdog/release.env ]]; then
  old_image=$(docker inspect --format '{{.Image}}' watchdog 2>/dev/null) || old_image=''
  if [[ ! $old_image =~ ^sha256:[a-f0-9]{64}$ ]]; then
    old_reference=$(sed -n 's/^WATCHDOG_IMAGE=//p' "$root/etc/watchdog/release.env")
    if [[ $old_reference =~ ^sha256:[a-f0-9]{64}$ ]]; then old_image=$old_reference
    else old_image=$(docker image inspect --format '{{.Id}}' "$old_reference") || die 'Cannot resolve previous image.'; fi
  fi
  [[ $old_image =~ ^sha256:[a-f0-9]{64}$ ]] || die 'Previous immutable image ID is unavailable.'
fi
# Unique tags also leave legacy tag-based release.env files unchanged on failure.
image="watchdog:$(basename "$release")"
printf '\nBuilding and testing %s. The previous service keeps running during the build.\n' "$commit"
docker build --pull --tag "$image" --label "org.opencontainers.image.revision=$commit" "$release"
new_image=$(docker image inspect --format '{{.Id}}' "$image")
[[ $new_image =~ ^sha256:[a-f0-9]{64}$ ]] || die 'Built image has no immutable ID.'

was_active=false; systemctl is-active --quiet watchdog.service && was_active=true
phase=backup
backup=''
finish_install() {
  local code=$?
  trap - EXIT
  if ((code != 0)); then
    if [[ $phase == backup ]]; then
      if $was_active; then
        systemctl start watchdog.service || printf '%s\n' 'ERROR: could not restart previous service after backup failure.' >&2
      fi
    else
      # A start attempt may already have migrated SQLite. Never downgrade it.
      systemctl stop watchdog.service || printf '%s\n' 'ERROR: could not stop failed new service; stop it manually before recovery.' >&2
      systemctl disable watchdog.service || printf '%s\n' 'ERROR: could not disable failed service; prevent reboot startup manually.' >&2
      printf '%s\n' 'RECOVERY REQUIRED: new runtime failed; automatic restart/downgrade disabled.' "Marker: $root/etc/watchdog/recovery-required" "Pre-update backup: ${backup:-none (first installation)}" >&2
    fi
  fi
  exit "$code"
}
# Install traps BEFORE stop: failures/signals must not strand the old service.
trap finish_install EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
if [[ -f $root/etc/systemd/system/watchdog.service ]]; then systemctl stop watchdog.service; fi
if [[ -n $old_image ]]; then
  if ! running=$(docker inspect --format '{{.State.Running}}' watchdog 2>/dev/null); then
    containers=$(docker ps --all --format '{{.Names}}') || die 'Cannot verify that Docker has stopped the data writer.'
    if printf '%s\n' "$containers" | grep -qx watchdog; then die 'Cannot inspect the existing Watchdog container.'; fi
    running=absent
  fi
  [[ $running == false || $running == absent ]] || die 'A Watchdog container is still running; refusing an inconsistent backup.'
  install -d -m 0700 "$root/var/backups/watchdog"
  backup="$root/var/backups/watchdog/$(date -u +%Y%m%dT%H%M%SZ)-pre-$commit-$$.tar.gz"
  python3 "$release/scripts/watchdog_backup.py" create --root "${root:-/}" --output "$backup" --image-id "$old_image"
  python3 "$release/scripts/watchdog_backup.py" verify --archive "$backup"
  printf 'Pre-update backup: %s (verified)\n' "$backup"
fi
install -d -m 0700 "$root/etc/watchdog"
# Persist recovery evidence before the first runtime change, even on interruption.
printf 'RECOVERY REQUIRED until startup verification succeeds\ncommit=%s\nprevious_image=%s\nnew_image=%s\nbackup=%s\n' "$commit" "$old_image" "$new_image" "$backup" > "$root/etc/watchdog/recovery-required"
phase=runtime
# Keep unverified runtime off the persistent boot path, including power loss.
if [[ -f $root/etc/systemd/system/watchdog.service ]]; then systemctl disable watchdog.service; fi
# After changing the runtime, never automatically downgrade a migrated database.
touch "$root/etc/watchdog/installer-v1"
if [[ -n $root ]]; then install -d -m 0700 "$root/var/lib/watchdog"
else install -d -m 0700 -o 1000 -g 1000 "$root/var/lib/watchdog"; fi
if [[ ! -f $root/etc/watchdog/app.env ]]; then
  cat > "$root/etc/watchdog/app.env" <<EOF
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
chmod 0600 "$root/etc/watchdog/app.env"
printf 'WATCHDOG_IMAGE=%s\nWATCHDOG_COMMIT=%s\n' "$new_image" "$commit" > "$root/etc/watchdog/release.env"
install -m 0644 "$release/deploy/watchdog.service" "$root/etc/systemd/system/watchdog.service"
install -d -m 0755 "$root/usr/local/sbin" "$root/usr/local/lib/watchdog"
install -m 0755 "$release/scripts/watchdogctl.sh" "$root/usr/local/sbin/watchdogctl"
install -m 0755 "$release/scripts/watchdog_backup.py" "$root/usr/local/lib/watchdog/watchdog_backup.py"
systemctl daemon-reload
systemctl enable --runtime --now watchdog.service
ready=false
for attempt in {1..60}; do
  if curl --fail --silent --max-time 2 http://127.0.0.1:8080/api/auth/config >/dev/null; then ready=true; break; fi
  sleep 2
done
$ready || die 'Startup failed. Inspect watchdogctl logs and the recovery marker; no database downgrade was attempted.'
systemctl enable watchdog.service
ln -sfn "$release" "$root/opt/watchdog/current"
rm -- "$root/etc/watchdog/recovery-required"
trap - EXIT INT TERM
printf '\nWatchdog ready at VM loopback port 8080, commit %s, image %s.\n' "$commit" "$new_image"
printf '%s\n' 'Commands: sudo watchdogctl status | logs | backup. Re-run the Cloud Shell installer to update.'
