#!/bin/bash
# E3.5 option B': prepare the bucket and the periodic push for scripts/watchdog_replica.py.
#
# Prints what it would do unless --apply is given. --apply creates a cloud
# resource and a timer on this machine, so it needs the owner's approval
# first. It never touches ufw, ssh, Docker or the running service.
#
#   scripts/watchdog_replica_setup.sh bucket --project P --bucket B [--location europe-west4] [--retention-days 30] [--apply]
#   scripts/watchdog_replica_setup.sh units  --dest gs://B/watchdog --interval-minutes 15 [--user ubuntu] [--apply]
set -euo pipefail
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
cmd=${1:-}; shift || true
apply=false project='' bucket='' location=europe-west4 retention=30 dest='' interval=15 user=ubuntu
while (($#)); do
  case $1 in
    --apply) apply=true; shift;;
    --project) project=$2; shift 2;; --bucket) bucket=$2; shift 2;; --location) location=$2; shift 2;;
    --retention-days) retention=$2; shift 2;; --dest) dest=$2; shift 2;;
    --interval-minutes) interval=$2; shift 2;; --user) user=$2; shift 2;;
    *) die "unknown argument $1";;
  esac
done
run() { if $apply; then "$@"; else printf '+ %q' "$1"; shift; printf ' %q' "$@"; printf '\n'; fi; }

case $cmd in
  bucket)
    [[ $project && $bucket ]] || die 'bucket needs --project and --bucket'
    [[ $retention =~ ^[0-9]+$ ]] && ((retention >= 8)) || die '--retention-days must be at least 8 (longer than the 7-day refresh)'
    lifecycle=$(mktemp); trap 'rm -f "$lifecycle"' EXIT
    # Snapshots older than the retention go; overwritten or deleted objects stay as noncurrent versions for the same time.
    printf '{"rule":[{"action":{"type":"Delete"},"condition":{"age":%d,"matchesPrefix":["db/"]}},{"action":{"type":"Delete"},"condition":{"daysSinceNoncurrentTime":%d}}]}\n' "$retention" "$retention" > "$lifecycle"
    run gcloud storage buckets create "gs://$bucket" --project "$project" --location "$location" --default-storage-class STANDARD \
      --uniform-bucket-level-access --public-access-prevention
    run gcloud storage buckets update "gs://$bucket" --versioning --lifecycle-file "$lifecycle"
    $apply || { printf 'lifecycle: '; cat "$lifecycle"; }
    ;;
  units)
    [[ $dest == gs://* ]] || die 'units needs --dest gs://bucket/prefix'
    [[ $interval =~ ^[0-9]+$ ]] && ((interval >= 5)) || die '--interval-minutes must be a whole number of at least 5'
    id -u "$user" >/dev/null 2>&1 || die "no such user $user"
    service=$(cat <<EOF
[Unit]
Description=WatchDog periodic replica push (not continuous; recovery point = timer interval)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=$user
Environment=CLOUDSDK_CONFIG=/var/lib/watchdog-replica/gcloud
ExecStart=/usr/bin/python3 /usr/local/lib/watchdog/watchdog_replica.py push --db /var/lib/watchdog/watchdog.sqlite --store /var/lib/watchdog/object_store --dest $dest --state /var/lib/watchdog-replica/state.json
EOF
)
    timer=$(cat <<EOF
[Unit]
Description=WatchDog replica push every $interval minutes

[Timer]
OnBootSec=5min
OnUnitActiveSec=${interval}min
Persistent=true

[Install]
WantedBy=timers.target
EOF
)
    if $apply; then
      install -d -m 0700 -o "$user" /var/lib/watchdog-replica
      install -m 0755 "$(dirname "$0")/watchdog_replica.py" /usr/local/lib/watchdog/watchdog_replica.py
      printf '%s\n' "$service" > /etc/systemd/system/watchdog-replica.service
      printf '%s\n' "$timer" > /etc/systemd/system/watchdog-replica.timer
      systemctl daemon-reload && systemctl start watchdog-replica.service && systemctl enable --now watchdog-replica.timer
      journalctl -u watchdog-replica.service -n 5 --no-pager
    else
      printf '# /etc/systemd/system/watchdog-replica.service\n%s\n\n# /etc/systemd/system/watchdog-replica.timer\n%s\n' "$service" "$timer"
    fi
    ;;
  *) die 'usage: watchdog_replica_setup.sh bucket|units [options] [--apply]';;
esac
