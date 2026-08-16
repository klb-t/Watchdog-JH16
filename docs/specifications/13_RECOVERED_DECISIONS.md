# Recovered Project Decisions

Historical decisions reconciled into this package.

## Retained
- FastAPI backend.
- Next.js/TypeScript/Tailwind frontend.
- PostgreSQL metadata store.
- MinIO/S3 object store.
- Parquet analytical storage.
- Docker Compose.
- Worker/scheduler separate from HTTP API.
- Configuration-driven from the beginning.
- UI theme/components/layout/navigation in versioned config.
- Pages: Dashboard, Data, Schedules, Analysis, Sources, Summary, Settings.
- Data page: source -> parameters -> fetch -> store; source configuration in Settings.
- JH16 Ni/Ni_harm/Pi/Hi.
- Source adapters for SERP-style acquisition and later sources.
- WORM manifests, lineage, hashes.
- OAuth/RBAC.
- Multi-format export.
- LLM summary only after deterministic analysis.

## Deferred, not rejected
Pill/lab DB, drug-checking integration, emergency mobile UI, alerts/SMS/push, receptor-affinity prediction, trip-report NLP, geography, Granger/changepoint, automatic publication drafting.

## Reconciliation
Older docs sometimes called WatchDog “the JH16 replication tool”. Obsolete. Correct model: **WatchDog = general pipeline; JH16 = one locked benchmark/preset.**

Older docs also mixed Google Trends with JH16 result counts. Keep separate source/metric concepts. FAITHFUL JH16 uses result-count semantics, not a silent substitution with normalized Google Trends interest.


## Extended archive recovery
See `19_RECOVERED_ARCHIVE_DECISIONS_V3.md` for recovered source/storage/generic-analysis/paper-pipeline decisions from 2024-2026 conversations.
