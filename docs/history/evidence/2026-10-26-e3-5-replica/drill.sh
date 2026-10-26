#!/bin/bash
# Restore drill on a COPY of the audit data (never the owner's VM data); destination is a local directory.
set -euo pipefail
R=/home/kielbowicz_marcin/Watchdog-JH16; T=$HOME/wt/replica_test_2026-10-26; S=$HOME/wt/jh16_audit_2026-10-25/inst_e57b2
rm -rf $T/bucket $T/restored $T/state.json $T/push.log
start() { (cd $R && PORT=$1 DB_PATH=$2/watchdog.sqlite STORE_BACKEND=local STORE_PATH=$2/store WATCHDOG_VAULT_KEY_FILE=$3 WATCHDOG_DIAGNOSTICS_MODE=OFF WATCHDOG_ALLOW_OPEN_INSTANCE=true WATCHDOG_ALLOW_EPHEMERAL_STORAGE=true WATCHDOG_GIT_COMMIT=replica-drill nohup node dist/server.cjs > $2/server.log 2>&1 & echo $! > $2/pid)
  for i in $(seq 40); do curl -sf http://127.0.0.1:$1/api/health >/dev/null && return; sleep 1; done; echo "instance $1 did not start"; exit 1; }
start 8192 $S $S/vault.key
H=$(curl -s http://127.0.0.1:8192/api/replications/jh2016 | python3 -c 'import json,sys;print(json.load(sys.stdin)["hashes"]["dossier"])')
# Writer: 20 protocol freezes through the HTTP API while pushes run.
( for i in $(seq 20); do curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'Content-Type: application/json' -H 'Origin: http://127.0.0.1:8192' \
   --data "{\"consent\":true,\"name\":\"drill $i\",\"primary\":[\"harm_index_vs_reference_pearson\"],\"families\":[{\"label\":\"A\",\"endpoints\":[\"harm_index_vs_reference_pearson\"],\"multiplicity\":\"holm\"}],\"alpha\":0.01,\"rationale\":\"restore drill write $i\",\"expectedDossierHash\":\"$H\"}" \
   http://127.0.0.1:8192/api/replications/jh2016/protocols; sleep 0.3; done ) > $T/writes.log &
W=$!
for i in 1 2 3; do python3 $R/scripts/watchdog_replica.py push --db $S/watchdog.sqlite --store $S/store --dest file://$T/bucket --state $T/state.json >> $T/push.log; sleep 1.5; done
wait $W
python3 $R/scripts/watchdog_replica.py push --db $S/watchdog.sqlite --store $S/store --dest file://$T/bucket --state $T/state.json >> $T/push.log
python3 $R/scripts/watchdog_replica.py restore --src file://$T/bucket --out $T/restored > $T/restore.json
python3 $R/scripts/watchdog_replica.py compare --db $S/watchdog.sqlite --db $T/restored/watchdog.sqlite > $T/compare.json || true
# The app expects STORE_PATH = object_store; the audit layout calls it store.
mv $T/restored/object_store $T/restored/store
cp $S/vault.key $T/vault.key.separate   # the key comes from the separate private backup, not from the replica
start 8193 $T/restored $T/vault.key.separate
for p in 8192 8193; do curl -s http://127.0.0.1:$p/api/replications/jh2016 | python3 -c '
import json,sys;d=json.load(sys.stdin);print(sys.argv[1], "runs", len(d["runs"]), "protocols", len(d["protocols"]), "c17d1147 adj", [e["p_adjusted"] for p in d["protocols"] for r in p["evaluation"]["confirmation_runs"] if r["run_id"].startswith("c17d1147") for e in r["endpoints"]])' $p; done > $T/apps.txt
RUN=51a9567b-8d47-497d-ad68-8eb62d455678
for p in 8192 8193; do curl -s "http://127.0.0.1:$p/api/runs/$RUN/export?format=json" | sha256sum | cut -c1-16; done > $T/export_hashes.txt
kill $(cat $S/pid) $(cat $T/restored/pid)
cat $T/writes.log | sort | uniq -c; cat $T/push.log; cat $T/restore.json $T/compare.json $T/apps.txt $T/export_hashes.txt
