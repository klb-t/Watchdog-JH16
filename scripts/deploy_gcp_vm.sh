#!/usr/bin/env bash
# Run in Cloud Shell (or a terminal with Bash 4+, gcloud, git and Python 3).
# Existing, dedicated VM only. GitHub credentials stay on this machine.
set -Eeuo pipefail
usage() {
  cat <<'EOF'
Usage: bash scripts/deploy_gcp_vm.sh --project PROJECT --zone ZONE --instance VM [--ref REF] [--plan]
Default ref: astra/watchdog-continuation-20260908. Run from a GitHub checkout.
Without flags, project defaults to gcloud's current project; zone/VM are prompted.
Configures only the selected VM, scoped firewall rules and boot-disk retention.
App access: SSH through IAP + Cloud Shell Web Preview, port 8080.
--plan validates/prints intent without fetching code or changing cloud resources.
EOF
}
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
project=''; zone=''; instance=''; ref='astra/watchdog-continuation-20260908'; plan=false
while (($#)); do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    --plan) plan=true; shift ;;
    --project|--zone|--instance|--ref)
      (($# >= 2)) || die "Missing value for $1"
      case "$1" in --project) project=$2;; --zone) zone=$2;; --instance) instance=$2;; --ref) ref=$2;; esac
      shift 2 ;;
    *) die "Unknown option: $1" ;;
  esac
done
for tool in gcloud git python3 tar; do command -v "$tool" >/dev/null || die "Install $tool first (available in GCP Cloud Shell)."; done
project=${project:-$(gcloud config get-value project 2>/dev/null)}
if [[ -z $instance && -t 0 ]]; then read -r -p 'Existing VM name: ' instance; fi
if [[ -z $zone && -t 0 ]]; then read -r -p 'VM zone (e.g. europe-central2-a): ' zone; fi
[[ $project =~ ^[a-z][a-z0-9-]{4,61}[a-z0-9]$ ]] || die 'Supply --project PROJECT_ID.'
[[ $zone =~ ^[a-z]+-[a-z0-9]+[0-9]-[a-z]$ ]] || die 'Supply --zone, for example europe-central2-a.'
[[ $instance =~ ^[a-z]([a-z0-9-]{0,61}[a-z0-9])?$ ]] || die 'Supply a valid --instance name.'
[[ $ref =~ ^[a-zA-Z0-9][a-zA-Z0-9._/-]*$ && $ref != *..* ]] || die 'Invalid Git ref.'
printf 'Target: %s / %s / %s; Git ref: %s\n' "$project" "$zone" "$instance" "$ref"
printf '%s\n' 'Dedicated VM: deny external ingress; allow SSH from IAP; bind app to 127.0.0.1:8080.'
printf '%s\n' 'Data: /var/lib/watchdog; backups: /var/backups/watchdog; keep boot disk after VM deletion.'
if $plan; then exit 0; fi

repo=$(git -C "$(dirname "${BASH_SOURCE[0]}")/.." rev-parse --show-toplevel)
# Authentication, when needed for a private repository, happens here, not on the VM.
git -C "$repo" fetch origin "$ref"
commit=$(git -C "$repo" rev-parse 'FETCH_HEAD^{commit}')
[[ $commit =~ ^[a-f0-9]{40}$ ]] || die 'Cannot resolve exact commit.'
git -C "$repo" cat-file -e "$commit:scripts/gcp_vm_bootstrap.sh" || die 'Selected ref has no VM installer.'
stage=$(mktemp -d)
trap 'rm -rf -- "$stage"' EXIT
git -C "$repo" archive --format=tar.gz --output="$stage/source.tar.gz" "$commit"
checksum=$(python3 - "$stage/source.tar.gz" <<'PY'
import hashlib, sys
with open(sys.argv[1], 'rb') as stream:
    digest = hashlib.sha256()
    for chunk in iter(lambda: stream.read(1024 * 1024), b''): digest.update(chunk)
    print(digest.hexdigest())
PY
)
gcloud compute instances describe "$instance" --project "$project" --zone "$zone" --format=json > "$stage/vm.json"
python3 - "$stage/vm.json" > "$stage/target" <<'PY'
import json, sys
vm = json.load(open(sys.argv[1]))
if vm.get('status') != 'RUNNING': raise SystemExit('VM must be RUNNING.')
nics = vm.get('networkInterfaces', [])
if len(nics) != 1: raise SystemExit('This installer requires a dedicated VM with one network interface.')
network = nics[0]['network']
parts = network.split('/')
project = parts[parts.index('projects') + 1]
disk = next(d for d in vm['disks'] if d.get('boot'))
print(network); print(project); print('wd-' + str(vm['id'])); print(disk['source'].split('/')[-1])
PY
mapfile -t target < "$stage/target"
network=${target[0]}; network_project=${target[1]}; tag=${target[2]}; boot_disk=${target[3]}
[[ $tag =~ ^wd-[0-9]+$ ]] || die 'Unexpected VM identity.'
gcloud services enable compute.googleapis.com iap.googleapis.com --project "$project" --quiet

# Upsert only names derived from the VM's immutable numeric ID. Never delete or
# edit shared default-allow-ssh rules. On a shared VPC, use its host project.
firewall() {
  local name=$1 direction=$2 priority=$3 source=$4 rules=$5
  local common=(--project "$network_project" --priority "$priority" --source-ranges "$source" --target-tags "$tag" --quiet)
  if gcloud compute firewall-rules describe "$name" --project "$network_project" --format=json > "$stage/rule.json" 2>/dev/null; then
    python3 - "$stage/rule.json" "$network" "$tag" "$direction" <<'PY'
import json, sys
r = json.load(open(sys.argv[1]))
if r.get('network') != sys.argv[2] or r.get('targetTags') != [sys.argv[3]] or r.get('direction') != 'INGRESS':
    raise SystemExit('Existing rule has a different scope; refusing to overwrite it.')
if not r.get('allowed' if sys.argv[4] == 'allow' else 'denied'):
    raise SystemExit('Existing rule has a different action; refusing to overwrite it.')
PY
    # The action cannot change on update. --rules edits either existing action.
    gcloud compute firewall-rules update "$name" "${common[@]}" --rules "$rules" --no-disabled
  else
    gcloud compute firewall-rules create "$name" "${common[@]}" --network "$network" --direction INGRESS --action "${direction^^}" --rules "$rules"
  fi
}
firewall "$tag-iap" allow 0 '35.235.240.0/20' 'tcp:22'
gcloud compute instances add-tags "$instance" --project "$project" --zone "$zone" --tags "$tag" --quiet
ssh_vm() { gcloud compute ssh "$instance" --project "$project" --zone "$zone" --tunnel-through-iap --quiet --command "$1"; }
# Prove IAP works BEFORE closing previous SSH paths. No automatic IAM grants.
ssh_vm 'true' || die 'IAP SSH failed. Check roles/iap.tunnelResourceAccessor and OS Login/SSH permissions; restrictive rules were not installed.'
firewall "$tag-private-v4" deny 1 '0.0.0.0/0' all
firewall "$tag-private-v6" deny 1 '::/0' all
ssh_vm 'true' || die 'IAP check after firewall update failed. Inspect the two VM-scoped private rules in the GCP console.'
gcloud compute instances set-disk-auto-delete "$instance" --project "$project" --zone "$zone" --disk "$boot_disk" --no-auto-delete --quiet
remote_dir=$(ssh_vm 'umask 077; mktemp -d /tmp/watchdog-deploy.XXXXXXXX')
[[ $remote_dir =~ ^/tmp/watchdog-deploy\.[a-zA-Z0-9]{8}$ ]] || die 'Unexpected remote staging path.'
gcloud compute scp "$stage/source.tar.gz" "$instance:$remote_dir/source.tar.gz" --project "$project" --zone "$zone" --tunnel-through-iap --quiet
printf -v remote_command 'set -eu; cd %q; printf "%%s  source.tar.gz\\n" %q | sha256sum -c -; tar -xzf source.tar.gz scripts/gcp_vm_bootstrap.sh; sudo bash scripts/gcp_vm_bootstrap.sh --archive %q --commit %q' "$remote_dir" "$checksum" "$remote_dir/source.tar.gz" "$commit"
ssh_vm "$remote_command"
ssh_vm "rm -rf -- $remote_dir"
printf '\nInstalled commit: %s\n' "$commit"
printf 'Open a tunnel (leave this terminal running):\n'
printf 'gcloud compute ssh %q --project %q --zone %q --tunnel-through-iap -- -N -o ExitOnForwardFailure=yes -L 127.0.0.1:8080:127.0.0.1:8080\n' "$instance" "$project" "$zone"
printf '%s\n' 'Cloud Shell: Web Preview → Preview on port 8080. Local terminal: http://127.0.0.1:8080/setup'
