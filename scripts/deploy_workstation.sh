#!/usr/bin/env bash
# Cloud Shell entry point: verified application update, desktops, then the wake gate.
# No VM deletion, data purge, machine resize, default-firewall reset or Docker prune.
set -Eeuo pipefail
umask 077
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
project=''; zone=''; instance=''; owner=''; interactive=true
while (($#)); do
  case "$1" in
    --project|--zone|--instance|--owner)
      (($# >= 2)) || die "Missing value: $1"
      case "$1" in --project) project=$2;; --zone) zone=$2;; --instance) instance=$2;; --owner) owner=$2;; esac
      shift 2 ;;
    --non-interactive) interactive=false; shift ;;
    --help|-h) echo 'Usage: deploy_workstation.sh --project ID --zone ZONE --instance VM --owner EMAIL [--non-interactive]'; exit 0 ;;
    *) die "Unknown option: $1" ;;
  esac
done
[[ $project =~ ^[a-z][a-z0-9-]{4,61}[a-z0-9]$ ]] || die 'Invalid project.'
[[ $zone =~ ^[a-z]+-[a-z0-9]+[0-9]-[a-z]$ ]] || die 'Invalid zone.'
[[ $instance =~ ^[a-z]([a-z0-9-]{0,61}[a-z0-9])?$ ]] || die 'Invalid VM name.'
[[ $owner =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$ ]] || die 'Invalid owner email.'
for tool in git gcloud python3 node npx; do command -v "$tool" >/dev/null || die "Missing $tool (run in Cloud Shell)."; done
repo=$(git -C "$(dirname "${BASH_SOURCE[0]}")/.." rev-parse --show-toplevel)
cd "$repo"
git diff --quiet && git diff --cached --quiet || die 'Tracked checkout files have changed. Use a fresh checkout; nothing is discarded.'
commit=$(git rev-parse HEAD)
[[ $commit =~ ^[a-f0-9]{40}$ ]] || die 'Cannot resolve deployment commit.'
phase=validation
trap 'code=$?; printf "FAILED in phase %s (exit %s). Earlier completed phases are not rolled back or claimed undone.\n" "$phase" "$code" >&2; exit "$code"' ERR
for script in remote_desktop.sh deploy_gcp_vm.sh deploy_gcp_gate.sh; do bash -n "scripts/$script"; done
python3 -m unittest discover -s tests -p test_desktop_recovery.py -v
# Run the repository's actual guard without installing the entire application in Cloud Shell.
# Full Git history is required by this guard. tsx is pinned to the repository's version.
npx --yes --package=tsx@4.23.12 tsx scripts/guard/run.ts
common=(--project "$project" --zone "$zone")
phase=vm-state
status=$(gcloud compute instances describe "$instance" "${common[@]}" --format='value(status)')
case "$status" in
  RUNNING) ;;
  TERMINATED) gcloud compute instances start "$instance" "${common[@]}" --quiet ;;
  SUSPENDED) gcloud compute instances resume "$instance" "${common[@]}" --quiet ;;
  *) die "VM state is $status. Wait for it to settle; no forced reset is performed." ;;
esac
gcloud compute instances describe "$instance" "${common[@]}" --format='table(name,status,machineType.basename(),disks.deviceName,networkInterfaces[].accessConfigs[].natIP)'
phase=watchdog
# This installer builds/tests first, backs up a managed previous installation,
# and only then replaces it. Unknown legacy state is refused, not guessed away.
bash scripts/deploy_gcp_vm.sh "${common[@]}" --instance "$instance" --ref "$commit" --owner "$owner" --shared-host
phase=desktops
remote='set -eu; test -d /run/systemd/system; free -h; df -h /; sudo bash /opt/watchdog/current/scripts/remote_desktop.sh --user "$(id -un)" --desktops kde,gnome --default kde --protocols rdp,crd,vnc --rdp-listen local --no-password-prompt'
gcloud compute ssh "$instance" "${common[@]}" --tunnel-through-iap --quiet --command "$remote"
phase=wake-gate
bash scripts/deploy_gcp_gate.sh "${common[@]}" --instance "$instance" --idle-minutes 30
phase=access
printf -v remote 'sudo watchdogctl signin-link %q' "$owner"
gcloud compute ssh "$instance" "${common[@]}" --tunnel-through-iap --quiet --command "$remote"
if $interactive; then
  phase=desktop-account
  # Explicit TTY: Google consent/PIN and Linux password never enter this script or chat.
  gcloud compute ssh "$instance" "${common[@]}" --tunnel-through-iap --quiet --ssh-flag=-tt \
    --command 'sudo bash /opt/watchdog/current/scripts/workstation_finish.sh' </dev/tty
fi
printf '\nInstallation commands completed for %s. Verify an actual GUI connection before calling the desktop accepted.\n' "$commit"
printf '%s\n' 'The wake gate starts a stopped VM; Chrome Remote Desktop itself does not.'
