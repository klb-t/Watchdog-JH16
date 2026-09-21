#!/usr/bin/env bash
# Real image startup, private publish and DB persistence across container replacement.
# Never touches an installed Watchdog instance. Intended for CI or a Docker workstation.
set -Eeuo pipefail
image=${1:?Usage: bash scripts/check_container.sh IMAGE}
stage=$(mktemp -d); name="watchdog-check-$$"; volume="watchdog-check-$$"
cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; docker volume rm "$volume" >/dev/null 2>&1 || true; rm -rf -- "$stage"; }
trap cleanup EXIT
docker volume create "$volume" >/dev/null
docker run --rm --user 0:0 --mount "type=volume,src=$volume,dst=/mnt/watchdog" "$image" sh -c 'chown 1000:1000 /mnt/watchdog; chmod 700 /mnt/watchdog'
start() {
  docker run -d --name "$name" --init --user 1000:1000 --read-only --cap-drop ALL --security-opt no-new-privileges=true \
    --pids-limit 512 --tmpfs /tmp:rw,nosuid,nodev,size=256m --publish 127.0.0.1::8080 \
    --mount "type=volume,src=$volume,dst=/mnt/watchdog" \
    --env NODE_ENV=production --env WATCHDOG_ALLOW_OPEN_INSTANCE=true \
    --env DB_PATH=/mnt/watchdog/watchdog.sqlite --env STORE_PATH=/mnt/watchdog/object_store \
    --env WATCHDOG_DIAGNOSTICS_DIR=/mnt/watchdog/diagnostics "$image" >/dev/null
  endpoint="http://$(docker port "$name" 8080/tcp)"
  [[ $endpoint == http://127.0.0.1:* ]] || { echo 'Port is not bound to loopback.' >&2; exit 1; }
  for attempt in {1..60}; do
    if curl --fail --silent "$endpoint/api/source-access" > "$stage/overview.json"; then return; fi
    sleep 1
  done
  docker logs "$name" >&2; exit 1
}
start
test "$(docker exec "$name" id -u)" = 1000
curl --fail --silent --show-error "$endpoint/" | grep -q '<html'
curl --fail --silent --show-error --header 'Content-Type: application/json' --header "Origin: $endpoint" \
  --data '{"label":"Container persistence test","family":"institutional","homepage":"https://example.org/fixture","channels":["manual"],"description":"Fictional metadata for an isolated container persistence check."}' \
  "$endpoint/api/source-access/candidates" > "$stage/created.json"
docker stop --time 30 "$name" >/dev/null
docker rm "$name" >/dev/null
start
python3 - "$stage/created.json" "$stage/overview.json" <<'PY'
import json, sys
created = json.load(open(sys.argv[1]))['source']
rows = json.load(open(sys.argv[2]))['rows']
assert any(row['source']['entry']['id'] == created['id'] for row in rows), 'Record did not survive container replacement'
print('Container: production start, non-root, read-only image, loopback HTTP, API write and persistence passed.')
PY
