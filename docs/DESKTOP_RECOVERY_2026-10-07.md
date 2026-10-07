# Desktop and shared-VM recovery — 2026-10-07

Base: `edafa9e4064e5c2cd5b899bd1c684269204040c4` on
`claude/ai-studio-last-commit-gjqxy4`. The uploaded 578-line `remote_desktop.sh`
was not present at `scripts/remote_desktop.sh` in that commit. This increment
finishes specific defects in that upload and its integration; it does not mark
all product work, the real VM, or graphical sessions accepted.

## Evidence and acceptance

Locally executed: 40 standard-library Python regression tests; Bash syntax for
all three desktop/workstation shell entry points; the Node test bridge was also
executed successfully with all 40 Python cases.
Tests use temporary files and recorded/stubbed privileged/cloud commands. They
never install packages, contact GCP, or start graphical sessions.

The complete source checkout was unavailable in the editing container (GitHub
connector reads worked; a container Git clone failed DNS). Therefore the full
repository guard, typecheck, build, application/browser suite and real container
acceptance were NOT run there. No prior Claude test receipt is relabeled as a
receipt for this change. Do not merge based on the local tests alone. The branch
is a deployment/review candidate, not an accepted main increment.

`deploy_workstation.sh` runs these regressions and the real repository guard
(using pinned tsx, full Git history) before any VM mutation. The existing VM
installer then builds the full application image with lint/build/all tests before
replacing a managed old service. A new Node test bridge includes the Python suite
in that image's test gate; Git is added only to the builder for its isolated Git
fixtures. The runtime image gains no Git dependency.

## Implemented corrections

- Replace `tr /dev/urandom | head` password generation, which reproduces exit 141
  under `pipefail`, with Python secrets and checked VNC credential encoding.
  Credentials are private files created as the desktop user.
- Use atomic managed-file replacement, distinct backups and symlink refusal;
  quote keyboard variants and do not disable KWallet.
- Configure both Debian/Ubuntu TigerVNC Perl configuration layouts; allocate a
  free display without overwriting an exhausted mapping; compute TCP ports
  arithmetically. Stop the relevant service if loopback-only validation fails.
- Prevent package scripts from starting unconfigured services; restore the
  previous package-start policy on normal/error exit. Hold both desktop and
  WatchDog installation locks while configuring the desktop.
- Parse the Google CRD setup command into arguments, not `bash -c`; validate the
  program, options and redirect. Ask for Google consent/PIN on the terminal.
- Consume the existing `/run/keep-awake` desktop contract in `watchdog_idle.py`.
  Persist actual last input/pulse timestamps, including after logout removes a
  signal. A still-recent pulse must not refresh its own deadline indefinitely.
- Remember observed terminal/load/network use. Start a full idle interval at the
  first quiet observation after continuous use. Match graphical WHO entries to
  their own user/display signal. Invalid/missing observations fail awake.
- Adapt existing sleep fixtures to include an explicit empty TCP observation and
  persisted history; separate independent sensor examples from time-transition
  tests instead of requiring immediate shutdown after recent activity.

## One Cloud Shell workflow

Use a fresh full-history checkout of this increment. Then:

```bash
bash scripts/deploy_workstation.sh \
  --project YOUR_PROJECT --zone YOUR_ZONE --instance YOUR_VM \
  --owner YOU@example.com
```

Stages: offline/guard checks → read/start the existing VM → managed WatchDog
update via IAP and `--shared-host` → KDE/GNOME and loopback RDP/VNC plus CRD →
existing Cloud Run wake gate with a 30-minute idle policy → interactive Linux
password and CRD registration. `--non-interactive` defers only that final account
step; run `sudo bash /opt/watchdog/current/scripts/workstation_finish.sh` on the
VM later. Do not paste passwords, PINs, OAuth setup codes or sign-in links into a
public report or issue.

The entry point does not delete/recreate the VM, resize it, reset VPC/UFW defaults,
prune Docker, or erase WatchDog data. It does not kill arbitrary processes called
Node or services that merely have a similar name. A recognized older managed
WatchDog is updated with the existing verified-backup/recovery protocol. Unknown
legacy state, an occupied application port, a conflicting Docker engine or too
little disk must stop safely with the original evidence intact. Such a stop is
not a completed migration and requires inspection of the actual host.

## Live checks still required

1. Actual target OS, RAM, free disk and Docker version; the supplied screenshot's
   15 GiB/overlay filesystem came from Cloud Shell, after the target SSH timed out.
2. One successful connection, usable graphics and reconnect for each required
   protocol/desktop. Separate D-Bus sessions do NOT prove full concurrent GNOME
   isolation for one Unix account. KDE remains the default.
3. Idle transition and wake on the real host, including intended long-running
   low-CPU jobs. Uninstrumented work is not inferable from a process name;
   `watchdogctl keep-awake HOURS` remains the explicit hold mechanism.
4. Google CRD consent/PIN must be completed by the owner. A stopped VM must first
   be woken through the WatchDog gate or GCP; CRD alone is not that wake gate.
5. The existing gate uses guest `poweroff`, not RAM-preserving suspend: unsaved
   desktop state is not retained. The unchanged gate installer applies its default
   six-hour Cloud Scheduler wake schedule, including on redeployment. The helper
   does not assert the total cloud bill is zero while idle.

## Architecture findings, without unrelated product rewrites

The concrete failure was a missing producer/consumer contract, not an absence of
another `try/catch`: one component wrote an activity signal that the next never
read. The regression now spans both names/formats and the decision module.

Policy remains explicit data: desktop choice, keyboard, heartbeat interval and
active-input threshold in `/etc/remote-desktop.conf`; idle duration, load threshold
and `WATCHDOG_IDLE_IGNORE_PORTS` in `/etc/watchdog/idle.env`. Mechanisms perform
validated observation and actions; unknown measurements are not converted to
"idle". Configuration should describe a supported behavior, not invent arbitrary
shell execution as a supposed universal exception handler.

Deferred findings in unchanged code: the gate's `roles/compute.instanceAdmin.v1`
grant is wider than its get/start/resume API calls, despite a "least privilege"
test title; public visitors can trigger wakes before app sign-in; the gate opens
8080 to a subnet, not an individual service identity. These warrant a separate
IAM/network acceptance increment, not an untested rewrite during desktop recovery.
The earlier claim that a stable public IP proves the VM never stopped is not
established; inspect its actual address reservation instead.
