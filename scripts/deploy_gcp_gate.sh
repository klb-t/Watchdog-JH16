#!/usr/bin/env bash
# E3.20 — sleeping VM behind an always-available Cloud Run gate. Run in Cloud Shell
# after deploy_gcp_vm.sh --owner EMAIL (sign-in must be on). Changes only: one service
# account, its start/stop right on this one VM, one VM-scoped firewall rule (tcp:8080 from
# the gate's subnet), one Cloud Run service and one Cloud Scheduler job.
set -Eeuo pipefail
usage() {
  cat <<'EOF'
Usage: bash scripts/deploy_gcp_gate.sh --project PROJECT --zone ZONE --instance VM
         [--idle-minutes 30] [--wake-schedule "0 */6 * * *"] [--service watchdog-gate]
         [--scheduler-location REGION] [--plan]
The gate's https://…run.app address becomes WatchDog's public address. The VM powers itself
off after IDLE minutes without use; a visit, or the wake schedule (for collection jobs), starts it.
--plan prints intent without changing anything.
EOF
}
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
project=''; zone=''; instance=''; idle=30; schedule='0 */6 * * *'; service='watchdog-gate'; scheduler_location=''; plan=false
while (($#)); do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    --plan) plan=true; shift ;;
    --project|--zone|--instance|--idle-minutes|--wake-schedule|--service|--scheduler-location)
      (($# >= 2)) || die "Missing value for $1"
      case "$1" in --project) project=$2;; --zone) zone=$2;; --instance) instance=$2;; --idle-minutes) idle=$2;;
        --wake-schedule) schedule=$2;; --service) service=$2;; --scheduler-location) scheduler_location=$2;; esac
      shift 2 ;;
    *) die "Unknown option: $1" ;;
  esac
done
for tool in gcloud python3; do command -v "$tool" >/dev/null || die "Install $tool first (available in Cloud Shell)."; done
project=${project:-$(gcloud config get-value project 2>/dev/null)}
[[ $project =~ ^[a-z][a-z0-9-]{4,61}[a-z0-9]$ ]] || die 'Supply --project PROJECT_ID.'
[[ $zone =~ ^[a-z]+-[a-z0-9]+[0-9]-[a-z]$ ]] || die 'Supply --zone, e.g. europe-central2-a.'
[[ $instance =~ ^[a-z]([a-z0-9-]{0,61}[a-z0-9])?$ ]] || die 'Supply a valid --instance name.'
[[ $idle =~ ^[0-9]+$ ]] && ((idle >= 10 && idle <= 1440)) || die '--idle-minutes must be 10–1440.'
[[ $service =~ ^[a-z]([a-z0-9-]{0,47}[a-z0-9])?$ ]] || die 'Invalid --service name.'
[[ $schedule =~ ^[0-9*/,-]+( [0-9*/,-]+){4}$ ]] || die '--wake-schedule must be a 5-field cron expression.'
region=${zone%-*}
scheduler_location=${scheduler_location:-$region}
[[ $scheduler_location =~ ^[a-z]+-[a-z0-9]+[0-9]$ ]] || die 'Invalid --scheduler-location.'
printf 'Target: %s / %s / %s; gate %s in %s; idle %s min; wake schedule "%s"\n' "$project" "$zone" "$instance" "$service" "$region" "$idle" "$schedule"
printf '%s\n' 'Creates: service account, start/stop right on this VM only, firewall tcp:8080 from the gate subnet, Cloud Run gate, Cloud Scheduler wake job.'
if $plan; then exit 0; fi

stage=$(mktemp -d); trap 'rm -rf -- "$stage"' EXIT
repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
[[ -f $repo/deploy/gate/server.mjs ]] || die 'deploy/gate is missing from this checkout.'
gcloud compute instances describe "$instance" --project "$project" --zone "$zone" --format=json > "$stage/vm.json"
python3 - "$stage/vm.json" > "$stage/target" <<'PY'
import json, sys
vm = json.load(open(sys.argv[1]))
nics = vm.get('networkInterfaces', [])
if len(nics) != 1: raise SystemExit('A dedicated VM with one network interface is required.')
n = nics[0]
parts = n['network'].split('/')
print(n['network'].split('/')[-1]); print(parts[parts.index('projects') + 1])
print(n['subnetwork'].split('/')[-1]); print(n['subnetwork'].split('/regions/')[1].split('/')[0])
print(n['networkIP']); print('wd-' + str(vm['id'])); print(vm.get('status', ''))
PY
mapfile -t t < "$stage/target"
network=${t[0]}; network_project=${t[1]}; subnet=${t[2]}; subnet_region=${t[3]}; internal_ip=${t[4]}; tag=${t[5]}; status=${t[6]}
[[ $subnet_region == "$region" ]] || die "The VM's subnet is in $subnet_region; the gate must run in the same region."
[[ $internal_ip =~ ^[0-9.]+$ && $tag =~ ^wd-[0-9]+$ ]] || die 'Unexpected VM network identity.'
cidr=$(gcloud compute networks subnets describe "$subnet" --project "$network_project" --region "$region" --format='value(ipCidrRange)')
[[ $cidr =~ ^[0-9.]+/[0-9]+$ ]] || die 'Cannot read the subnet range.'

gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com cloudscheduler.googleapis.com compute.googleapis.com --project "$project" --quiet

sa="$service@$project.iam.gserviceaccount.com"
gcloud iam service-accounts describe "$sa" --project "$project" >/dev/null 2>&1 \
  || gcloud iam service-accounts create "$service" --project "$project" --display-name 'WatchDog gate (starts one VM)' --quiet
# Instance-level only: the gate can read and start this VM and nothing else in the project.
gcloud compute instances add-iam-policy-binding "$instance" --project "$project" --zone "$zone" \
  --member "serviceAccount:$sa" --role roles/compute.instanceAdmin.v1 --quiet >/dev/null

rule="$tag-gate"
if gcloud compute firewall-rules describe "$rule" --project "$network_project" --format=json > "$stage/rule.json" 2>/dev/null; then
  python3 - "$stage/rule.json" "$tag" <<'PY'
import json, sys
r = json.load(open(sys.argv[1]))
if r.get('targetTags') != [sys.argv[2]] or r.get('direction') != 'INGRESS' or not r.get('allowed'):
    raise SystemExit('Existing gate rule has a different scope; refusing to overwrite it.')
PY
  gcloud compute firewall-rules update "$rule" --project "$network_project" --source-ranges "$cidr" --rules tcp:8080 --priority 0 --no-disabled --quiet
else
  gcloud compute firewall-rules create "$rule" --project "$network_project" --network "$network" --direction INGRESS --action ALLOW \
    --rules tcp:8080 --source-ranges "$cidr" --target-tags "$tag" --priority 0 --quiet
fi

gcloud run deploy "$service" --project "$project" --region "$region" --source "$repo/deploy/gate" \
  --service-account "$sa" --allow-unauthenticated \
  --network "$network" --subnet "$subnet" --vpc-egress private-ranges-only \
  --min-instances 0 --max-instances 3 --concurrency 80 --cpu 1 --memory 256Mi --timeout 3600 \
  --set-env-vars "GATE_PROJECT=$project,GATE_ZONE=$zone,GATE_INSTANCE=$instance,GATE_TARGET=http://$internal_ip:8080" --quiet
url=$(gcloud run services describe "$service" --project "$project" --region "$region" --format='value(status.url)')
[[ $url =~ ^https://[a-z0-9.-]+$ ]] || die 'Could not read the gate URL.'

job="$service-wake"
if gcloud scheduler jobs describe "$job" --project "$project" --location "$scheduler_location" >/dev/null 2>&1; then
  gcloud scheduler jobs update http "$job" --project "$project" --location "$scheduler_location" --schedule "$schedule" --uri "$url/__wake" --http-method GET --time-zone 'Europe/Warsaw' --quiet
else
  gcloud scheduler jobs create http "$job" --project "$project" --location "$scheduler_location" --schedule "$schedule" --uri "$url/__wake" --http-method GET --time-zone 'Europe/Warsaw' --quiet
fi

if [[ $status != RUNNING ]]; then
  gcloud compute instances start "$instance" --project "$project" --zone "$zone" --quiet
fi
ssh_vm() { gcloud compute ssh "$instance" --project "$project" --zone "$zone" --tunnel-through-iap --quiet --command "$1"; }
printf -v cmd 'sudo watchdogctl enable-gate %q %q %q' "$url" "$internal_ip" "$idle"
ssh_vm "$cmd"

printf '\nWatchDog address: %s\n' "$url"
printf 'The VM powers off after %s minutes without use. Opening the address starts it (about 1–2 minutes).\n' "$idle"
printf 'Collection jobs: the VM is woken on schedule "%s" (Europe/Warsaw) and runs anything due.\n' "$schedule"
printf '%s\n' 'If you used --public before: the static IP is no longer needed; release it in the console to stop its charge.'
