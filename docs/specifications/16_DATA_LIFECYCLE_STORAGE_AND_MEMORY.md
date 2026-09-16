# Data Lifecycle, Storage, Archival and Memory Architecture

## Design goal
WatchDog is a long-lived research memory, not a transient dashboard. It must be possible to answer:
- what exactly was fetched,
- when and with what parameters,
- what raw bytes/provider response existed,
- how those bytes became a dataset/observation/series,
- what transformations were applied,
- which analyses and figures consumed them,
- which paper claims/results depend on them.

The architecture must minimize unnecessary physical duplication without sacrificing logical history.

## Non-negotiable: every fetch is archived
Every fetch attempt that reaches an external/manual source receives a durable `fetch_event` / acquisition-step record, whether it:
- succeeds,
- returns zero results,
- returns identical content to a previous fetch,
- is rate-limited,
- partially fails,
- returns malformed/schema-changed content.

For a successful retainable response, archive the maximal legally permitted raw representation locally/S3-compatible object storage before normalization.

### Logical history vs physical deduplication
Use content-addressed raw blobs:

```text
fetch_event A -> raw_blob sha256:abc
fetch_event B -> raw_blob sha256:abc
fetch_event C -> raw_blob sha256:def
```

A and B remain two independent historical fetches with their own timestamps, parameters, request/provider IDs and manifests, but identical payload bytes may be stored only once under the same SHA-256 object.

This reconciles exhaustive fetch history with storage efficiency.

## Storage layers
Do not force every data shape into relational tables.

### 1. PostgreSQL: control plane / index / relationships
Store:
- identities/roles,
- source registry,
- entities/substances/aliases/relationships,
- run/fetch/dataset/series metadata,
- provenance and lineage edges,
- schemas,
- schedules,
- analysis metadata/results suitable for queries,
- paper/project metadata,
- artifact pointers/hashes,
- audit indexes.

JSONB is acceptable for bounded heterogeneous metadata, not as an excuse to avoid modeling stable core relationships.

### 2. S3-compatible object storage / MinIO locally: immutable artifact plane
Store:
- raw responses,
- uploaded files,
- source snapshots,
- large normalized artifacts,
- Parquet datasets/series,
- figures,
- exports,
- diagnostic bundles,
- paper evidence packages.

Objects should be content-addressed or immutably named and checksum-verified.

### 3. Parquet: analytical table/series bodies
Use for large rectangular analytical data, repeated observations, derived datasets and portable research snapshots.

### 4. DuckDB / Polars: local analytical execution
Use when appropriate to query/transform Parquet without loading everything into PostgreSQL. Keep this behind an analytical storage/query abstraction.

### 5. TimescaleDB: optional optimization
Historical discussions considered TimescaleDB for time-series indexing/as-of queries. Treat it as an optional optimization justified by benchmarks, not a domain dependency. The canonical model must work with ordinary PostgreSQL + Parquet/object storage.

## Data zones / lifecycle
Use explicit lineage-preserving zones. Names may vary, semantics may not.

```text
RAW -> PARSED -> VALIDATED -> CLEAN/NORMALIZED -> DERIVED DATASET -> SERIES -> ANALYSIS -> FIGURE/EXPORT -> PAPER EVIDENCE
```

### RAW
Exact permitted source payload or imported file. Immutable.

### PARSED
Mechanical parsing only. Preserve parser version and rejected/unparsed portions.

### VALIDATED
Schema/domain validation results, quality flags, missingness, unit checks, identity resolution status.

### CLEAN/NORMALIZED
Canonical names/IDs, normalized units/types, explicit missingness. Never silently invent missing values.

### DERIVED DATASET
A reproducible selection/join/filter/transform of one or more upstream datasets. Defined by a transformation DAG and immutable input hashes.

### SERIES
A dataset materialized into one or more ordered series with explicit:
- value field,
- time/index field,
- entity/substance grouping,
- geography,
- language/query role,
- unit,
- resolution,
- aggregation,
- missing-value policy,
- timezone/calendar semantics,
- transformation lineage.

### ANALYSIS
Deterministic statistical/model outputs referencing immutable dataset/series IDs and exact method parameters/version.

### FIGURE/EXPORT
Rendered views of stored analytical outputs; rendering configuration is versioned.

### PAPER EVIDENCE
Frozen set of datasets, analysis outputs, figures, methodology manifests and citations used by one paper/draft version.

## Dataset as first-class object
Create an explicit `Dataset` entity, not just ad-hoc lists of snapshots.

Minimum:
```text
dataset_id
name/version
schema_id/version
created_by_run
artifact_id/hash
row_count
column_count
semantic_column_metadata
source/input lineage
quality summary
permissions
created_at
```

Dataset operations produce new datasets; they do not mutate finalized upstream data.

## Transformation DAG
Every transformation is a node with:
```text
transform_id/version
input_dataset_ids/hashes
operation
parameters
code/version
output_dataset_id/hash
warnings
```

Seed transforms to expose through a registry and UI:
- select/rename columns,
- filter rows,
- sort,
- deduplicate with explicit key/policy,
- type/unit conversion,
- canonical entity/substance resolution,
- join/union/concat,
- group/aggregate,
- pivot/unpivot,
- resample,
- rolling/window functions,
- lag/lead,
- normalize/standardize,
- log/power transform,
- difference/percent change,
- detrend/seasonal adjustment,
- geographic/time alignment,
- missingness handling with explicit policy,
- derive formula/metric,
- text feature extraction as clearly labeled derived data.

The agent should expand the registry with standard transformations while keeping every operation reproducible and inspectable.

## Baseline vs research vs operational collections
Historical design distinguished:
- low-resolution baseline series,
- high-resolution ad-hoc research pulls,
- operational monitoring/deltas.

Keep these as collection purposes/metadata, not three divergent code pipelines. They use the same acquisition/storage machinery with different schedules/resolution/retention/export policies.

## Geographic/language hierarchy
The old design explicitly wanted multiple scales: locality/municipality -> province/region -> country -> continent/global, with language and dialect context. Model geography as stable IDs/hierarchy and language/locale separately. A series may be scoped to both.

Role/authorization may limit which geographic/detail level a user can access without changing the underlying scientific model.

## User-local vs shared memory
Historical discussion considered user-local storage for large one-off analyses while keeping enough shared proactive cache/monitoring centrally.

Architect for storage policies:
- shared institutional baseline/monitoring,
- project/team research artifacts,
- private user research workspace,
- export/materialize-to-local capability.

Do not couple scientific identity to physical location. The same immutable artifact interface should support local MinIO/filesystem and later institutional S3-compatible storage.

## Retention
Retention is source/policy-specific, but provenance records and hashes should survive even when payload retention is legally disallowed or expires. Deletion/expiry must leave an auditable tombstone describing what was removed, why and under which policy.
