#!/usr/bin/env bash
#
# One-shot deploy to Cloud Run. Reads its settings from the environment so that
# nothing here has to be edited, and prints every command before running it so
# the script can be read as documentation for doing it by hand.
#
# See docs/DEPLOY_GCP.md for what each variable is and how to get one.

set -euo pipefail

: "${PROJECT_ID:?Set PROJECT_ID to your Google Cloud project id}"
REGION="${REGION:-europe-west4}"
SERVICE="${SERVICE:-watchdog}"
BUCKET="${BUCKET:-${PROJECT_ID}-watchdog-blobs}"
SERVICE_ACCOUNT="${SERVICE_ACCOUNT:-watchdog-run@${PROJECT_ID}.iam.gserviceaccount.com}"

run() { echo "+ $*" >&2; "$@"; }

echo "== Enabling the APIs this needs =="
run gcloud services enable \
  run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com \
  secretmanager.googleapis.com storage.googleapis.com \
  --project "${PROJECT_ID}"

echo "== Service account =="
if ! gcloud iam service-accounts describe "${SERVICE_ACCOUNT}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
  run gcloud iam service-accounts create "watchdog-run" \
    --display-name "WatchDog Cloud Run" --project "${PROJECT_ID}"
fi

echo "== Bucket for the blob store =="
if ! gcloud storage buckets describe "gs://${BUCKET}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
  # Uniform access, versioning on. Versioning is the safety net under a WORM
  # store: the application refuses to overwrite, and the bucket makes an
  # accidental delete recoverable.
  run gcloud storage buckets create "gs://${BUCKET}" \
    --project "${PROJECT_ID}" --location "${REGION}" --uniform-bucket-level-access
  run gcloud storage buckets update "gs://${BUCKET}" --versioning
fi

run gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
  --member "serviceAccount:${SERVICE_ACCOUNT}" --role roles/storage.objectAdmin \
  --project "${PROJECT_ID}"

echo "== Secrets =="
# Created empty if absent; you add versions yourself so no key is ever an
# argument to this script and none reaches your shell history.
for secret in SESSION_SIGNING_KEY OPENROUTER_API_KEY SERPAPI_API_KEY; do
  if ! gcloud secrets describe "${secret}" --project "${PROJECT_ID}" >/dev/null 2>&1; then
    run gcloud secrets create "${secret}" --replication-policy automatic --project "${PROJECT_ID}"
    echo "   created empty secret ${secret}; add a value with:" >&2
    echo "     printf %s 'THE-VALUE' | gcloud secrets versions add ${secret} --data-file=- --project ${PROJECT_ID}" >&2
  fi
  run gcloud secrets add-iam-policy-binding "${secret}" \
    --member "serviceAccount:${SERVICE_ACCOUNT}" --role roles/secretmanager.secretAccessor \
    --project "${PROJECT_ID}"
done

echo "== Deploy =="
# --max-instances=1 is load-bearing, not a cost setting. The database is SQLite
# on a single mounted volume; a second instance would be a second writer.
# Remove it only once the Postgres backend exists (see the Blocked entry in
# docs/spec/07_EPICS_AND_TASKS.md).
run gcloud run deploy "${SERVICE}" \
  --source . \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --service-account "${SERVICE_ACCOUNT}" \
  --max-instances 1 \
  --min-instances 0 \
  --cpu 1 --memory 1Gi \
  --timeout 900 \
  --add-volume "name=wd,type=cloud-storage,bucket=${BUCKET}" \
  --add-volume-mount "volume=wd,mount-path=/mnt/watchdog" \
  --set-env-vars "NODE_ENV=production,STORE_BACKEND=gcs,GCS_BUCKET=${BUCKET},GCS_PREFIX=blobs,DB_PATH=/mnt/watchdog/watchdog.sqlite" \
  --set-secrets "SESSION_SIGNING_KEY=SESSION_SIGNING_KEY:latest,OPENROUTER_API_KEY=OPENROUTER_API_KEY:latest,SERPAPI_API_KEY=SERPAPI_API_KEY:latest" \
  --no-allow-unauthenticated

echo
echo "Deployed. The service is NOT publicly reachable yet, on purpose."
echo "Finish the sign-in setup in docs/DEPLOY_GCP.md, then re-run with"
echo "--allow-unauthenticated so Google sign-in becomes the front door."
