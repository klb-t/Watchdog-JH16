# Request from text, Hoffmann quote: evidence (2026-10-28)

**Data.** A copy of the audit instance at port 8196, code `2da5c0b`. Real network calls: JMIR, Crossref, SerpApi. No synthetic data.

**Files.**
- **Probe:** `probe.cjs` (browser flow), `quote.txt` (the pasted text), `probe_log.txt`, `request.json` (stored request with events and runs).
- **Screenshots:** `preview.png`, `request.png`, `request_phone.png`.
- **Run data:** `export_<run>.json` and `run_<run>.json` (exports), `replication.json`, `manuscript.md`.
- **Independent checks:** `verify_jh16_*.txt` and `verify_trends_*.txt`, both exit 0.
- **Raw responses:** `raw/index_ea2b7078.json` lists every query of the new measurement with `total_results`, the provider state and the raw sha256. `raw/<sha256>.json` holds the raw SerpApi responses for alcohol, cannabis and khat, which show the collapsed counts and the empty khat harm query. No API key is in these files.
