# E3.21 — field deployment: explicit transports and upgrade preservation

Base: `789806807c357db298607fc49eb11d8ee8ab0b91` on
`astra/desktop-recovery-20261007`. This is an additive desktop increment, not a
WatchDog application/database deployment, a VM replacement or a main integration.
The existing `scripts/remote_desktop.sh` is imported as a function library without
modification (Git blob `3f4a5633ec3616834ca7f715475ecdc6451f4511`).

## Owner request, 7 October 2026

Keep RDP, VNC and Chrome Remote Desktop; include NICE/Amazon DCV where possible.
Do not substitute CRD for learning SSH tunnels. Provide one Cloud Shell paste for
a user working from a phone with intermittent attention. Reuse the partial Claude
installation, and preserve settings/data for future releases. Permission to erase
an empty test machine is not a requirement to erase it.

## Implemented scope

- `desktop_cloud.py`: explicit target validation, IAP-first SSH with ordinary-SSH
  fallback, no firewall/IAM relaxation, upload of an explicit source file list,
  checksum verification, detached target-side launch, progress/status and saved
  client control. Starts/resumes an existing stopped/suspended VM but never
  creates, resizes, deletes, reformats, reserves an IP or prunes Docker.
- `desktop_field.py`: immutable root-owned source release, named systemd job,
  private status/log, phase checkpoints and retries, installation/backup locks,
  package-start guard, per-method failure/unsupported status and capability-aware
  session start. Browser/SSH disconnect does not terminate the installation.
  The install job is not enabled at boot; after a VM reboot the same paste resumes
  it. A hard crash can still require apt/package-policy recovery; that is not
  represented as completed work.
- KDE and GNOME packages are considered separately from usable X11 sessions.
  This adapter accepts GNOME X11 only below version 49 with an installed X11
  session entry. GNOME 49+ is reported blocked rather than killing the RDP/VNC/CRD
  pipeline. The preferred desktop is kept even if that session must explicitly
  fall back to another configured, available desktop. A native GNOME Wayland RDP
  backend is NOT implemented by this increment.
- xrdp loopback on 3389; TigerVNC under the existing Unix account and preserved
  display/credential mapping. A custom systemd unit avoids distro-specific VNC
  unit-template/config-layout failures; only inactive native units for the exact
  adopted user/display are disabled before that replacement. Running recognized
  sessions are reused instead of killed.
- CRD is installed/configured but Google consent and PIN are never fabricated or
  fed automatically. `needs-auth` does not block other transports. Run
  `~/wd-desktop authorize` in Cloud Shell when ready; it opens a TTY on the VM.
- noVNC + websockify bind only to VM loopback. An actual gcloud/SSH `-L` forwards
  that HTTP/WebSocket service to Cloud Shell. Cloud Shell's owner-authenticated
  HTTPS Web Preview is the browser entry point. An existing recoverable VNC
  password can be supplied in the URL fragment, not the query or server log.
  This PRIVATE link still contains a credential: do not share or screenshot it.
  If only an existing encoded VNC password is present, it is preserved and the
  browser asks for it instead of silently resetting it.
- RDP, native VNC and DCV also get explicit loopback-only SSH forwards. Their
  local endpoints are on the computer running SSH. Cloud Shell localhost is NOT
  Android localhost. A ready shell command with those mappings is saved for
  inspection/reuse from a computer with gcloud. SSH TCP forwarding does not
  tunnel DCV QUIC/UDP; the DCV adapter explicitly disables QUIC.
- DCV: upstream Ubuntu 22.04/24.04 amd64 archives pinned to 2025.0-20103, checked
  against the publisher's HTTPS SHA-256 file before extraction/installation.
  Archives with path traversal, links or special devices are refused. The
  installer selects server/web-viewer/Xdcv, preserves unrelated DCV configuration,
  license and certificate files, configures loopback 8443/system authentication
  and a managed virtual session. Other OS/architecture combinations are blocked;
  it does NOT force a 24.04 package onto 26.04 or Debian.
  On GCP an existing valid license or the vendor's automatic 30-day evaluation is
  required. There is no license purchase, AWS VM creation or license workaround.

## Persistence and migration contract (limited to the desktop layer)

1. Shipped defaults/package/artifact policy:
   `config/deployment/desktop-field.json` (versioned source data).
2. Local operational preferences:
   `/etc/watchdog-desktop/settings.json` (`schema_version: 1`). Existing supported
   settings win; missing keys acquire defaults. Package/artifact defaults are
   deliberately not frozen as user overrides. Unknown local metadata is retained;
   an unknown schema version blocks implicit migration/downgrade.
3. First adoption imports supported assignments from `/etc/remote-desktop.conf`
   as DATA using shlex, never source/eval. Unknown legacy contents remain in the
   private pre-change backup, not a public metadata file. Unsupported shell syntax
   blocks migration instead of executing it.
4. Before applying the desktop change, selected system and user desktop settings,
   VNC credentials and CRD host registration are archived to a root-only directory
   under `/var/lib/watchdog-desktop/backups/`. These backups contain secrets.
5. Existing Unix password, VNC password/display, CRD registration and user desktop
   preference are reused. Modern VNC encoded credentials are adopted without
   regeneration. No home/project directory, WatchDog DB or application dataset is
   deleted. The application is NOT upgraded by this desktop-only workflow.
6. A manifest of generated system files detects later manual edits at an upgrade
   boundary. Such a conflict stops before overwriting the edited file. This is
   NOT a universal three-way merger of arbitrary Linux/application configuration.
7. Config backups are NOT full disk images or live database snapshots. This
   increment does NOT implement automatic rollback of packages, PAM, schema
   downgrades or every global setting made by the earlier Claude installer.
   In particular, an old KWallet override is archived but not silently removed.
8. This installer does not change the VM's existing idle/poweroff policy. It holds
   the common installation lock while working and installs the existing desktop
   heartbeat producer. Actual producer/consumer compatibility with an older
   deployed WatchDog must still be checked; no preservation of RAM/unsaved GUI
   work is claimed. Keep-awake/wake acceptance remains a VM-side test.

## Commands

In a full checkout of this branch, from Cloud Shell:

```sh
python3 scripts/desktop_cloud.py install --project PROJECT --zone ZONE --instance INSTANCE
```

The owner-facing pinned paste first verifies its commit, runs the 78 isolated
Python regressions and the existing repository principles guard, then calls the
controller above. Existing working tree content is never reset or discarded.

Once installed, saved Cloud Shell control:

```sh
~/wd-desktop status
~/wd-desktop tunnel
~/wd-desktop authorize
```

The first two do not request a password/PIN. `authorize` is the explicit Google
consent handoff. VM log: `/var/lib/watchdog-desktop/install.log` (sudo required).
Private state: `/var/lib/watchdog-desktop/status.json`. The `credentials` command
is intentionally separate from status and installation logging.

## Executed acceptance and boundaries

Executed in the editing container on 7 October 2026:

- **78 Python tests passed:** 40 unchanged prior desktop/idle regressions plus
  38 new policy, migration, archive, phase-recovery, transport and secret-handling
  regressions. These tests do not run apt, change systemd, connect to GCP or
  establish an actual graphical session.
- Both new Python scripts compile; existing Bash helper passes `bash -n`.
- The added Node test bridge passed using Node's TypeScript stripping; the normal
  application test harness also discovers that bridge in CI.
- Full repository clone/npm guard/build/browser/real-container execution was
  unavailable in this editing runtime (GitHub connector works; shell Git clone
  fails DNS). Therefore prior CI receipts are NOT receipts for this increment.
  The branch must pass its own CI before main integration. The owner paste runs
  the actual guard before target mutation.
- Real VM installation, KDE/GNOME rendering, clipboard/audio, CRD registration,
  noVNC WebSocket through Google's preview proxy, DCV licensing/session creation,
  reconnect and idle/wake behavior remain live acceptance, not proven by a socket
  listener, package install or offline tests.

## Primary documentation used (checked 7 October 2026)

- DCV licensing: https://docs.aws.amazon.com/dcv/latest/adminguide/setting-up-license.html
- Supported DCV servers: https://docs.aws.amazon.com/dcv/latest/adminguide/servers.html
- DCV packages/checksums: https://www.amazondcv.com/
- DCV Linux installation: https://docs.aws.amazon.com/dcv/latest/adminguide/setting-up-installing-linux-server.html
- DCV bind addresses: https://docs.aws.amazon.com/dcv/latest/adminguide/manage-port-addr.html
- DCV session options: https://docs.aws.amazon.com/dcv/latest/adminguide/managing-sessions-start.html
- Google preview proxy: https://docs.cloud.google.com/shell/docs/using-web-preview
- gcloud SSH forwarding: https://docs.cloud.google.com/sdk/gcloud/reference/compute/ssh
- TigerVNC wrapper options: https://manpages.debian.org/trixie/tigervnc-standalone-server/tigervncserver.1.en.html
- noVNC fragment parameters: https://github.com/novnc/noVNC/blob/v1.6.0/app/webutil.js
