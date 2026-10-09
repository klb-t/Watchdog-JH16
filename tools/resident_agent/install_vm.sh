#!/usr/bin/env bash
# Called over an interactive SSH terminal. Existing host/projects are NOT reinstalled.
set -Eeuo pipefail
umask 077
[[ $(id -u) != 0 ]] || { echo 'Run as the shared VM owner, not root.' >&2; exit 1; }
base=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
export RESIDENT_HOME="$HOME/devbox-agent"
export PATH="$HOME/.local/bin:$PATH"
python3 "$base/agentctl.py" init
# Install versioned helper files; no user preference/config files overwritten.
release=$(cat "$base/agentctl.py" "$base/review.py" | sha256sum | cut -c1-16)
mkdir -p "$RESIDENT_HOME/releases/$release"
cp "$base/agentctl.py" "$base/review.py" "$RESIDENT_HOME/releases/$release/"
if [[ -e "$RESIDENT_HOME/current" && ! -L "$RESIDENT_HOME/current" ]]; then
  echo 'current is an unmanaged non-symlink; refusing replacement' >&2; exit 1
fi
ln -sfn "$RESIDENT_HOME/releases/$release" "$RESIDENT_HOME/current.new"
mv -Tf "$RESIDENT_HOME/current.new" "$RESIDENT_HOME/current"
python3 - "$base/owner.json" <<'PY'
import json,pathlib,sys,os
root=pathlib.Path(os.environ['RESIDENT_HOME']); owner=json.loads(pathlib.Path(sys.argv[1]).read_text())
sys.path.insert(0,str(root/'current'));import agentctl as a
# Keep prior owner instructions; append this dated request as a separately named evidence file.
a.write(root/'private/source_manifest.json',a.jbytes(owner['sources']),True)
a.write(root/'workspace/OWNER_TASK.md',owner['task'])
key=a.digest(owner['task'].encode())[:16]
a.write(root/'workspace/requests'/f'{key}.md',owner['task'])
a.write(root/'state/latest-request-id',key,True)
PY
if ! command -v codex >/dev/null 2>&1; then
  curl --fail --show-error --silent --location --retry 3 \
    --connect-timeout 15 --max-time 180 https://chatgpt.com/codex/install.sh -o "$base/codex-install.sh"
  sh "$base/codex-install.sh"
  hash -r
fi
command -v codex >/dev/null || { echo 'Codex installer did not supply a binary on PATH' >&2; exit 1; }
codex --version
if ! codex login status; then codex login --device-auth; fi
python3 "$RESIDENT_HOME/current/agentctl.py" inventory > "$RESIDENT_HOME/state/bootstrap-inventory.json"
python3 "$RESIDENT_HOME/current/agentctl.py" catalogue > "$RESIDENT_HOME/state/catalogue-output.json" || \
  echo 'Model discovery unavailable; no cheap/Astra model has been assumed.'
request_id=$(cat "$RESIDENT_HOME/state/latest-request-id")
python3 "$RESIDENT_HOME/current/agentctl.py" queue --id "onboarding-$request_id" --file "$RESIDENT_HOME/workspace/requests/$request_id.md"
# Bounded installation window, using only the already-installed controller API.
if command -v watchdogctl >/dev/null; then
  if sudo -n watchdogctl keep-awake 3; then
    echo 'Temporary WatchDog keep-awake accepted (3h); active-job integration still needs inspection.'
  else
    echo 'Existing controller did not grant keep-awake: idle protection NOT VERIFIED.'
  fi
fi
# No root-owned agent daemon; elevate only this named login-session persistence setting.
if command -v loginctl >/dev/null; then
  sudo -n loginctl enable-linger "$(id -un)" || echo 'Linger not enabled: automatic restart after logout/reboot remains unverified.'
fi
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"
python3 - <<'PY'
import os,pathlib,sys,shutil
root=pathlib.Path(os.environ['RESIDENT_HOME']);sys.path.insert(0,str(root/'current'));import agentctl as a
# Quote systemd tokens, including literal percent/dollar characters.
def q(s):return '"'+str(s).replace('\\','\\\\').replace('"','\\"').replace('%','%%')+'"'
p=pathlib.Path.home()/'.config/systemd/user/resident-agent.service'
unit='''# resident-agent/1
[Unit]
Description=Private owner Codex task queue
StartLimitIntervalSec=300
StartLimitBurst=3
[Service]
Type=simple
UMask=0077
Restart=on-failure
RestartSec=30
KillMode=control-group
TimeoutStopSec=30
Nice=10
CPUWeight=25
IOWeight=25
MemoryHigh=6G
'''
unit+='Environment='+q('RESIDENT_HOME='+str(root))+'\n'
unit+='Environment='+q('PATH='+os.environ['PATH'])+'\n'
unit+='WorkingDirectory='+q(root/'workspace')+'\n'
unit+='ExecStart='+q(shutil.which('python3'))+' '+q(root/'current/agentctl.py')+' worker\n'
unit+='[Install]\nWantedBy=default.target\n'
if p.exists() and 'resident-agent/1' not in p.read_text():raise SystemExit('Existing foreign resident-agent service; nothing overwritten')
a.write(p,unit,True)
launcher=pathlib.Path.home()/'agent'
import shlex
shell='#!/bin/sh\n# resident-agent/1\nexport PATH="$HOME/.local/bin:$PATH"\n[ "$#" -gt 0 ] || set -- console\nexec python3 '+shlex.quote(str(root/'current/agentctl.py'))+' "$@"\n'
if launcher.exists() and 'resident-agent/1' not in launcher.read_text():raise SystemExit('Existing ~/agent left untouched')
a.write(launcher,shell,True);launcher.chmod(0o700)
PY
if systemctl --user daemon-reload && systemctl --user enable --now resident-agent.service; then
  echo 'RESIDENT_SERVICE_STARTED'
else
  echo 'User service unavailable: starting one detached queue worker, not claiming reboot persistence.'
  nohup python3 "$RESIDENT_HOME/current/agentctl.py" worker </dev/null >>"$RESIDENT_HOME/state/worker.log" 2>&1 &
fi
printf '\nAgent is on this VM. Workspace: %s\n' "$RESIDENT_HOME/workspace"
echo 'Goals and status: ~/agent'
echo 'System-level actions requiring privileges are recorded in workspace/NEEDS_OWNER.md, not bypassed.'
