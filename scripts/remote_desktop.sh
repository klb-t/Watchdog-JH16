#!/usr/bin/env bash
# Compatibility entrypoint for the unfinished Claude handoff. No shell configuration/eval.
set -Eeuo pipefail
exec python3 "$(dirname "${BASH_SOURCE[0]}")/remote_desktop.py" "$@"
