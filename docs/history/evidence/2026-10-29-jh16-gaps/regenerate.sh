#!/usr/bin/env bash
# Regenerates estimator_consistency.json from stored files only (no network, no paid request).
# Run from the repository root:  bash docs/history/evidence/2026-10-29-jh16-gaps/regenerate.sh > docs/history/evidence/2026-10-29-jh16-gaps/estimator_consistency.json
set -euo pipefail
E=docs/history/evidence
exec python3 -I scripts/jh16_estimator_consistency.py --root . \
  --paper fixtures/jh2016/paper_reported.json \
  --entities "R1 2026-10-25=docs/replication/JH16_2026-10-25/results.json#9d80efca" \
  --export "R3-faithful 2026-10-25=$E/2026-10-25-jh16/R3_faithful_export.json" \
  --export "R3 repeat-1 2026-10-25=$E/2026-10-25-jh16/R3_ext1_export.json" \
  --export "R3 repeat-2 2026-10-25=$E/2026-10-25-jh16/R3_ext2_export.json" \
  --export "R3 gl-us 2026-10-25=$E/2026-10-25-jh16/R3_ext3_export.json" \
  --export "R3 gl-pl 2026-10-25=$E/2026-10-25-jh16/R3_ext4_export.json" \
  --export "VM 2026-10-25=$E/2026-10-25-jh16/VM_smoke_faithful_export.json" \
  --entities "kopia 2026-10-26=$E/2026-10-28-request-hoffmann/replication.json#c17d1147" \
  --export "kopia 2026-10-28=$E/2026-10-28-request-hoffmann/export_ea2b7078.json" \
  --or-decomposition "$E/2026-10-25-jh16/T3_or_decomposition_results.json"
