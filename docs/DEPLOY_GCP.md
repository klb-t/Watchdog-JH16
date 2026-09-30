# Cloud Run deployment — legacy recipe disabled

As of 2026-09-30, `scripts/deploy_cloudrun.sh` stops with exit code 2 before any
`gcloud` invocation. `--help` and `-h` explain the blocker and exit successfully.
There is no override flag. The previous provisioning code remains below the guard
for historical inspection, not as an installation procedure.

Use [the private Compute Engine VM installer](DEPLOY_GCP_VM.md) for the current
single-host deployment path. Its SQLite file lives on the VM disk through a Docker
bind mount; this correction does not change that installer or existing services.

## Why the former recipe is unsupported

The legacy script mounted a Cloud Storage bucket at `/mnt/watchdog` and placed
`DB_PATH=/mnt/watchdog/watchdog.sqlite` inside that mount. Google documents that
Cloud Run uses Cloud Storage FUSE for these mounts. FUSE lacks file locking and is
not fully POSIX compliant; Google's FUSE documentation also advises against using
it as database storage. `--max-instances=1` does not supply the missing filesystem
semantics. The prior claim that this configuration was a correct durable SQLite
deployment is withdrawn.

Primary sources checked on 2026-09-30:

- [Cloud Run Cloud Storage volume mounts: limitations](https://docs.cloud.google.com/run/docs/configuring/services/cloud-storage-volume-mounts#limitations)
- [Cloud Storage FUSE: limitations](https://docs.cloud.google.com/storage/docs/cloud-storage-fuse/overview#limitations)

This is a finding from code and documented platform contracts. It is not a live
Cloud Run test or a finding that an existing installation has lost data. No GCP
resources were inspected, changed, deleted or provisioned by this correction.

The GCS `ObjectStore` adapter remains a separate implemented capability for archived
objects. Its existence does not make a bucket-mounted SQLite database compatible.
The container persistence check uses an ordinary Docker volume; passing it is not
evidence about Cloud Storage FUSE behavior. The current startup durability gate
checks configured path roots, not the filesystem's locking and transaction semantics.

## Requirements before a replacement can deploy

A new Cloud Run path needs a supported, tested database arrangement and explicit
migration/backup/restore behavior. PostgreSQL remains planned; this correction does
not implement it or authorize paid infrastructure. Test actual transactions, process
replacement and recovery before making deployment claims.

The historical first-install sequence also needs repair: it references secret
versions before the operator creates them and starts production before configuring
Google OAuth. Optional provider credentials must remain optional. Configure the
owner bootstrap, authentication and required secret versions before the first
application startup; do not publish the service as a shortcut around those gates.

The application still rejects missing production authentication or ephemeral
storage. `WATCHDOG_ALLOW_OPEN_INSTANCE=true` and
`WATCHDOG_ALLOW_EPHEMERAL_STORAGE=true` are deliberate waivers for appropriate
local/throwaway scenarios; neither makes the legacy Cloud Run recipe supported.
The private VM installer uses the first waiver with loopback-only IAP access and
persistent local storage.

For a future authenticated migration, ownership transfer from `local-user` remains
an explicit authorized operation (`/api/auth/principals/migrate-local-user`). It is
not performed by this guard. Admission and invitation behavior is documented in
[ADMISSION.md](ADMISSION.md).

## Local verification

```bash
bash scripts/deploy_cloudrun.sh --help
node --import tsx --test tests/integration/cloudrun_guard.test.ts
```

The regression test supplies a fake `gcloud`, tries configured and unconfigured
projects, and asserts zero cloud calls. It tests the prevention mechanism only;
it does not validate or deploy a replacement Cloud Run architecture.
