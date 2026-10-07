#!/usr/bin/env bash
# Interactive VM-only step. Do not pass passwords or OAuth codes as script arguments.
set -Eeuo pipefail
((EUID == 0)) || { echo 'Use sudo.' >&2; exit 1; }
[[ -r /etc/remote-desktop.conf && -d /run/systemd/system ]] || { echo 'Desktop is not installed on this VM.' >&2; exit 1; }
. /etc/remote-desktop.conf
[[ -n ${RD_USER:-} && $RD_USER != root ]] || { echo 'No desktop user configured.' >&2; exit 1; }
if [[ $(passwd -S "$RD_USER" | awk '{print $2}') != P ]]; then
  printf 'Set the Linux password for RDP account %s. SSH policy is unchanged.\n' "$RD_USER"
  passwd "$RD_USER"
fi
home=$(getent passwd "$RD_USER" | cut -d: -f6)
if ! compgen -G "$home/.config/chrome-remote-desktop/host#*.json" >/dev/null; then
  remote-desktop crd-register
fi
remote-desktop status
printf '%s\n' 'Now test Chrome Remote Desktop from your phone. Do not send your PIN, password or sign-in link to chat.'
