# E3.22 — shared development machine: recovery and desktops

## Source and scope

Owner request, 7 October 2026: finish the interrupted Claude deployment/desktop work,
provide one Cloud Shell entrypoint, keep all development/alpha projects on one machine,
and improve separation of operational policy from code and exception handling.

Base: `edafa9e4064e5c2cd5b899bd1c684269204040c4`, tree
`dd7b918881a1db7cbba9725cdc24449cc8e08636`, on
`claude/ai-studio-last-commit-gjqxy4`. It is 10 commits ahead of main
`58a0c93bd0135e3715dcbc4d92fb80e61bd31215`. Claude's published work includes
comparison families, diagnostic recording, the Cloud Run wake gate and shared-host
installation. Its advertised `scripts/remote_desktop.sh` was **not published** at
that head. This implementation is new work, not recovery of its unpublished bytes.

The screenshot's successful diagnostic commands ran in **Cloud Shell after failed
SSH**, not on the target VM. Its RAM, disk and systemd error cannot establish the
VM's state. An unchanged observed IP also does not prove the VM never stopped or
that the address is reserved. The installer queries the actual Compute identity.

## Implemented increment

- `config/deployment/devbox.json`: versioned, validated operational profile. The
  project ID, VM identity, owner email, authorization codes and passwords are not
  committed. Default minimums are 16 GiB RAM and a 50 GB boot disk; larger existing
  resources are retained. Capacity changes require `--ensure-capacity`; an IP is
  reserved before a required stop. A static IP, disk and the gate's supporting
  services can incur charges while the VM is off. No resources are automatically
  released just because WatchDog no longer uses them.
- `scripts/devbox.py cloud`: fresh/pinned Git archive, integrity checks, IAP-only
  SSH, metadata identity check, private root-owned staging and a named systemd job.
  The VM build/install survives loss of the phone/Cloud Shell connection. Re-running
  the same commit/request rejoins an active job or reuses completed local work.
  Cloud gate provisioning is a separate rerunnable phase, not a claim that the
  Cloud Shell process itself survives disconnection.
- Existing managed WatchDog: retain its established build-before-stop,
  image/database-bound verified backup, recovery marker and no-database-downgrade
  behavior. This is an update, not deletion of research evidence. A recognized
  old `/opt/watchdog` systemd project can be backed up and quarantined with
  `--replace-legacy`. Unknown layouts, unmanaged containers/volumes, recovery
  markers, foreign desktop configuration and insufficient space stop with an
  explanation. There is no `docker system prune`, data-directory wipe, apt-lock
  deletion or public-SSH fallback.
- `remote_desktop.py` / `.sh`: KDE and GNOME X11 sessions, separate `wd-rdp`,
  `wd-vnc`, `wd-crd` Unix accounts and a shared `/srv/devbox` project directory.
  RDP binds to localhost; TigerVNC uses its own account/display and localhost.
  New desktop services are masked until configuration, passwords are generated
  once and kept root-private, SSH password authentication is disabled for these
  accounts, and existing personal desktop configuration is not overwritten.
  Chrome Remote Desktop and Chrome use official Google packages; versions and
  download hashes are recorded on the VM, not claimed to be reproducibly pinned
  package builds. Google authorization and the PIN are interactive and not logged.
- `devbox_idle.py`: opt-in shared-host systemd drop-in, leaving the previous
  dedicated-host controller and its tests unchanged. Every observed busy signal
  resets a persistent clock. SSH without a TTY, IAP, loopback RDP/VNC and desktop
  input count; after the last observation a full 30-minute window must pass.
  Missing/malformed required observations are errors, not "idle". A fresh controller
  state gets a fresh grace period; clock rollback does not trigger shutdown.
  Checks use the existing install/backup lock. The poll period is one minute.

## Operational use

Run `python3 scripts/devbox.py cloud --help` in a pinned clean checkout.
`--plan` validates and prints intent without cloud writes. The deployment invocation
requires `--project`, `--zone`, `--instance`, `--owner`; add `--ensure-capacity`,
`--preserve-ip`, `--replace-legacy` as authorized, and `--configure-crd` to finish with
interactive Google authorization. No credentials need to be copied into the repo.

The VM's private job state is under `/var/lib/watchdog-host/jobs/`; the installer
prints the exact job identifier. `status.json` records the last phase and
`install.log` contains private diagnostic output. The original bootstrap can print
an operator sign-in link there: do not publish this log or the credentials file.
A timeout/interruption requires inspection of the current job and any recovery
marker; it is not permission to erase state or rerun a failed database migration.

On the VM:

```bash
sudo watchdog-desktop status
sudo watchdog-desktop credentials
sudo watchdog-desktop select gnome     # or kde; takes effect after desktop logout
sudo watchdog-desktop crd-register    # hidden Google code; PIN entered directly
sudo watchdogctl keep-awake 3
sudo watchdogctl keep-awake off
```

RDP/VNC clients must connect through an SSH tunnel **on the client device**, not
through a localhost socket on the unrelated Cloud Shell host. Chrome Remote Desktop
is the practical phone path. A sleeping VM must first be woken through the WatchDog
gate; CRD itself cannot contact a powered-off guest. Other projects do not gain
independent wake URLs merely because they share the machine.

## Validation and limits

Local checkpoint: **48/48 Python standard-library contract tests passed**;
Python compilation and Bash launcher syntax passed. The locally reconstructed
upstream `watchdog_idle.py` blob was verified as
`70f71a4e0eb93c625891005c8904186fe68be6bf` and is **unchanged** in this increment.
The new TypeScript test bridge runs these tests inside the existing complete
product and container gates. Full product/guard/container CI status must be read
for the published commit; an earlier green Claude commit is not proof for this one.

The working environment has no gcloud, Docker, installed product dependencies or
network route for a full clone, so no local full-product/guard/container result is
claimed. GitHub publication and CI are separate checkpoints. **No live owner VM,
visible KDE/GNOME login, CRD OAuth/PIN or external browser sign-in has been tested.**
E3.18 remains open; this report does not close scientific/product backlog tasks.

Remaining explicit boundaries: arbitrary foreign services cannot be migrated by
name alone; old dedicated-host firewall policies are not blindly reset; a custom
image without automatic boot-filesystem growth may still need a filesystem-specific
operation after disk resize. An unattended low-load job in another project should
hold `watchdogctl keep-awake` or integrate an activity signal. Polling is not proof
that every sub-minute operation in every program was observed. A GNOME/X11 or
package incompatibility must be reported, not silently replaced with another desktop.

The inherited gate uses an instance-scoped `roles/compute.instanceAdmin.v1` grant.
Its scope is one VM, but that role is broader than its get/start/resume calls need;
a narrow custom role is a follow-up hardening task, not something this report calls
"least privilege". Public unauthenticated traffic can request a wake; sign-in is
still enforced by the application, but that does not prevent wake-related costs.

## Design consequences, not slogans

Configuration describes *which policy*, code implements *which mechanisms*. Moving
arbitrary shell into JSON would not separate data from code; this profile accepts
bounded values and named choices, not executable strings. Unknown state is a third
state, separate from true/false. Exceptions are classified by side effect and phase:
retry a read/connection; rejoin an identified job; retain a verified backup; stop
before an ambiguous migration. A catch-all "try harder" loop around mutations would
make this installer less reliable, not more autonomous.

Source identity, policy identity, phase and evidence are recorded separately. A
successful package install is not a successful GUI session; a passed mock is not
a live cloud acceptance; a copy/quarantine is not a schema migration. These
boundaries are the practical part of the requested coding philosophy.
