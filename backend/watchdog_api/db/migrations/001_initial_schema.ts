/**
 * Migration 001 — the full schema of `02_DATA_MODEL.md`.
 *
 * Written as a TypeScript string export rather than a `.sql` file on purpose:
 * `npm run build` bundles the server with esbuild, which would not carry loose
 * `.sql` files into `dist/`. A migration that exists in development and
 * vanishes in production is worse than no migration system.
 *
 * Conventions from `02_DATA_MODEL.md`: TEXT identifiers, INTEGER counts, REAL
 * measured values, TEXT ISO-8601 UTC timestamps, JSON-encoded TEXT where a
 * JSONB column is intended at E3.
 */
export const MIGRATION_001_INITIAL_SCHEMA = `
-- ---------------------------------------------------------------- identity
CREATE TABLE IF NOT EXISTS principals (
  id TEXT PRIMARY KEY,
  email TEXT,
  display_name TEXT,
  identity_provenance TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT
);

CREATE TABLE IF NOT EXISTS principal_roles (
  principal_id TEXT NOT NULL REFERENCES principals(id),
  role_id TEXT NOT NULL REFERENCES roles(id),
  PRIMARY KEY (principal_id, role_id)
);

-- -------------------------------------------------------------- substances
CREATE TABLE IF NOT EXISTS substances (
  id TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  description TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_substances_normalized ON substances(normalized_name);

CREATE TABLE IF NOT EXISTS aliases (
  id TEXT PRIMARY KEY,
  substance_id TEXT NOT NULL REFERENCES substances(id),
  alias TEXT NOT NULL,
  language TEXT,
  jurisdiction TEXT,
  alias_type TEXT,
  source_id TEXT,
  confidence REAL,
  valid_from TEXT,
  valid_to TEXT
);

CREATE TABLE IF NOT EXISTS external_identifiers (
  substance_id TEXT NOT NULL REFERENCES substances(id),
  namespace TEXT NOT NULL,
  value TEXT NOT NULL,
  provenance TEXT,
  PRIMARY KEY (substance_id, namespace, value)
);

-- ------------------------------------------------- sources and providers
CREATE TABLE IF NOT EXISTS capabilities (
  id TEXT PRIMARY KEY,
  capability_key TEXT NOT NULL UNIQUE,
  display_name TEXT,
  input_contract TEXT,
  output_contract TEXT
);

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  source_key TEXT NOT NULL UNIQUE,
  display_name TEXT,
  capability_id TEXT REFERENCES capabilities(id),
  enabled INTEGER NOT NULL DEFAULT 1,
  license_notes TEXT,
  retention_policy TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  provider_key TEXT NOT NULL UNIQUE,
  capability_id TEXT REFERENCES capabilities(id),
  display_name TEXT,
  adapter_id TEXT,
  adapter_version TEXT,
  status TEXT NOT NULL,
  discovery_provenance TEXT,
  approved_by TEXT,
  approved_at TEXT,
  created_at TEXT NOT NULL
);

-- secret_ref is a pointer into the secret store, never a key.
CREATE TABLE IF NOT EXISTS provider_credentials (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES providers(id),
  secret_ref TEXT NOT NULL,
  status TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ------------------------------------------------------ runs and provenance
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  run_type TEXT NOT NULL,
  preset_id TEXT,
  preset_version TEXT,
  status TEXT NOT NULL,
  trigger_type TEXT,
  parent_run_id TEXT REFERENCES runs(id),
  supersedes_run_id TEXT REFERENCES runs(id),
  owner_principal_id TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'private',
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  app_version TEXT,
  git_commit TEXT,
  effective_config TEXT,
  effective_config_hash TEXT,
  warning_count INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  error_details TEXT
);

CREATE TABLE IF NOT EXISTS run_steps (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  step_name TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  implementation_version TEXT,
  input_hash TEXT,
  output_hash TEXT,
  warning_json TEXT,
  error_json TEXT
);

CREATE TABLE IF NOT EXISTS raw_blobs (
  id TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL UNIQUE,
  object_uri TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  media_type TEXT,
  retention_class TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  kind TEXT NOT NULL,
  media_type TEXT,
  object_uri TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  byte_size INTEGER,
  immutable INTEGER NOT NULL DEFAULT 1,
  owner_principal_id TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'private',
  created_at TEXT NOT NULL,
  metadata_json TEXT
);

CREATE TABLE IF NOT EXISTS manifests (
  run_id TEXT PRIMARY KEY REFERENCES runs(id),
  schema_version TEXT NOT NULL,
  object_uri TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  finalized_at TEXT NOT NULL
);

-- Two fetches returning identical bytes share one blob row; the fetch events
-- stay distinct. Logical fetch history is never deduplicated away.
CREATE TABLE IF NOT EXISTS fetch_events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  source_id TEXT NOT NULL,
  provider_id TEXT,
  provider_version TEXT,
  request_hash TEXT,
  rendered_query TEXT,
  requested_at TEXT,
  completed_at TEXT,
  status TEXT NOT NULL,
  provider_request_id TEXT,
  http_status INTEGER,
  raw_blob_id TEXT REFERENCES raw_blobs(id),
  error_code TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);

-- --------------------------------------------------- observations and series
CREATE TABLE IF NOT EXISTS series (
  id TEXT PRIMARY KEY,
  metric_key TEXT NOT NULL,
  substance_id TEXT,
  source_id TEXT,
  geography TEXT,
  language TEXT,
  query_role TEXT,
  unit TEXT,
  owner_principal_id TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'private',
  metadata_json TEXT,
  created_at TEXT NOT NULL
);

-- is_missing is a real column with a real reason. A missing observation has
-- numeric_value NULL and is_missing 1. Nothing downstream may coerce to zero.
CREATE TABLE IF NOT EXISTS observations (
  id TEXT PRIMARY KEY,
  series_id TEXT NOT NULL REFERENCES series(id),
  run_id TEXT NOT NULL REFERENCES runs(id),
  observed_at TEXT,
  retrieved_at TEXT NOT NULL,
  numeric_value REAL,
  text_value TEXT,
  is_missing INTEGER NOT NULL DEFAULT 0,
  missing_reason TEXT,
  raw_artifact_id TEXT,
  fetch_event_id TEXT REFERENCES fetch_events(id),
  provider_id TEXT,
  source_adapter_version TEXT,
  query_text TEXT,
  method_version TEXT,
  quality_flags_json TEXT,
  created_at TEXT NOT NULL,
  CHECK (is_missing IN (0, 1)),
  CHECK ((is_missing = 1 AND numeric_value IS NULL) OR (is_missing = 0)),
  CHECK ((is_missing = 0) OR (missing_reason IS NOT NULL))
);

-- ----------------------------------------------------------------- analysis
CREATE TABLE IF NOT EXISTS method_specs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  spec_json TEXT NOT NULL,
  spec_hash TEXT NOT NULL UNIQUE,
  approval_state TEXT NOT NULL DEFAULT 'PROPOSED',
  approved_hash TEXT,
  approved_by TEXT,
  approved_at TEXT,
  source_prose TEXT,
  compiler_provider_id TEXT,
  compiler_model TEXT,
  owner_principal_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS analysis_runs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  method_spec_id TEXT REFERENCES method_specs(id),
  input_series_ids_json TEXT,
  input_hashes_json TEXT,
  executor_id TEXT,
  executor_version TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS analysis_results (
  id TEXT PRIMARY KEY,
  analysis_run_id TEXT NOT NULL REFERENCES analysis_runs(id),
  substance_id TEXT,
  metric_key TEXT NOT NULL,
  value_numeric REAL,
  value_text TEXT,
  unit TEXT,
  is_missing INTEGER NOT NULL DEFAULT 0,
  statistic_metadata_json TEXT,
  created_at TEXT NOT NULL,
  CHECK (is_missing IN (0, 1))
);

CREATE TABLE IF NOT EXISTS reference_score_sets (
  id TEXT PRIMARY KEY,
  set_key TEXT NOT NULL,
  version TEXT NOT NULL,
  citation_json TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_reference_set_key_version
  ON reference_score_sets(set_key, version);

-- evidence_tier nullable per D12; a versioned published score set is
-- CURATED_SECONDARY by that definition.
CREATE TABLE IF NOT EXISTS reference_scores (
  set_id TEXT NOT NULL REFERENCES reference_score_sets(id),
  substance_id TEXT NOT NULL,
  score REAL NOT NULL,
  notes TEXT,
  evidence_tier TEXT,
  PRIMARY KEY (set_id, substance_id)
);

-- ---------------------------------------------------------------- narrative
CREATE TABLE IF NOT EXISTS narratives (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  template_id TEXT,
  template_version TEXT,
  provider_id TEXT,
  model TEXT,
  generation_params_json TEXT,
  input_payload_hash TEXT NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  approval_state TEXT NOT NULL DEFAULT 'PROPOSED',
  approved_hash TEXT,
  approved_by TEXT,
  approved_at TEXT,
  created_at TEXT NOT NULL
);

-- -------------------------------------------------------------- replication
CREATE TABLE IF NOT EXISTS replication_targets (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  identifier_type TEXT,
  identifier TEXT,
  citation_json TEXT,
  method_description_prose TEXT,
  status TEXT NOT NULL,
  owner_principal_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- tolerance_kind: absolute | relative | rank_correlation_floor | interval
CREATE TABLE IF NOT EXISTS replication_claims (
  id TEXT PRIMARY KEY,
  target_id TEXT NOT NULL REFERENCES replication_targets(id),
  claim_key TEXT NOT NULL,
  claim_type TEXT,
  claimed_value_numeric REAL,
  claimed_value_text TEXT,
  unit TEXT,
  tolerance_kind TEXT NOT NULL,
  tolerance_value REAL,
  notes TEXT,
  created_at TEXT NOT NULL,
  CHECK (tolerance_kind IN ('absolute', 'relative', 'rank_correlation_floor', 'interval'))
);

CREATE TABLE IF NOT EXISTS replication_attempts (
  id TEXT PRIMARY KEY,
  target_id TEXT NOT NULL REFERENCES replication_targets(id),
  run_id TEXT NOT NULL REFERENCES runs(id),
  method_spec_id TEXT REFERENCES method_specs(id),
  started_at TEXT,
  completed_at TEXT,
  status TEXT NOT NULL
);

-- verdict vocabulary is deliberately closed and contains no 'failed'.
CREATE TABLE IF NOT EXISTS replication_verdicts (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL REFERENCES replication_attempts(id),
  claim_id TEXT NOT NULL REFERENCES replication_claims(id),
  observed_value_numeric REAL,
  observed_value_text TEXT,
  within_tolerance INTEGER,
  deviation REAL,
  verdict TEXT NOT NULL,
  rationale TEXT,
  created_at TEXT NOT NULL,
  CHECK (verdict IN ('reproduced', 'deviates', 'not_computable', 'method_unclear'))
);

-- ------------------------------- datasets and transforms (schema now, E5 use)
CREATE TABLE IF NOT EXISTS datasets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT,
  schema_json TEXT,
  created_by_run TEXT REFERENCES runs(id),
  artifact_id TEXT REFERENCES artifacts(id),
  sha256 TEXT,
  row_count INTEGER,
  column_count INTEGER,
  owner_principal_id TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'private',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dataset_columns (
  dataset_id TEXT NOT NULL REFERENCES datasets(id),
  name TEXT NOT NULL,
  physical_type TEXT,
  semantic_type TEXT,
  unit TEXT,
  role TEXT,
  metadata_json TEXT,
  PRIMARY KEY (dataset_id, name)
);

CREATE TABLE IF NOT EXISTS dataset_inputs (
  dataset_id TEXT NOT NULL REFERENCES datasets(id),
  input_dataset_id TEXT REFERENCES datasets(id),
  input_artifact_id TEXT REFERENCES artifacts(id),
  relationship TEXT
);

CREATE TABLE IF NOT EXISTS transform_specs (
  id TEXT PRIMARY KEY,
  version TEXT,
  transform_key TEXT NOT NULL,
  parameters_json TEXT,
  implementation_version TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS transform_runs (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  spec_id TEXT REFERENCES transform_specs(id),
  input_hashes_json TEXT,
  output_dataset_id TEXT REFERENCES datasets(id),
  output_hash TEXT,
  warnings_json TEXT
);

-- ---------------------- field reference: E6 skeleton, empty at E1 (per D12)
CREATE TABLE IF NOT EXISTS symptoms (
  id TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL,
  body_system TEXT,
  description TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS symptom_aliases (
  id TEXT PRIMARY KEY,
  symptom_id TEXT NOT NULL REFERENCES symptoms(id),
  alias TEXT NOT NULL,
  language TEXT,
  source_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS substance_symptom_associations (
  id TEXT PRIMARY KEY,
  substance_id TEXT NOT NULL REFERENCES substances(id),
  symptom_id TEXT NOT NULL REFERENCES symptoms(id),
  relation_type TEXT,
  onset_notes TEXT,
  evidence_tier TEXT,
  reference_set_id TEXT REFERENCES reference_score_sets(id),
  citation_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pill_types (
  id TEXT PRIMARY KEY,
  shape TEXT,
  color_json TEXT,
  logo_text TEXT,
  score_line TEXT,
  size_mm REAL,
  image_artifact_id TEXT REFERENCES artifacts(id),
  geography_id TEXT,
  first_observed_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tested_samples (
  id TEXT PRIMARY KEY,
  pill_type_id TEXT REFERENCES pill_types(id),
  source_id TEXT,
  test_method TEXT,
  tested_at TEXT,
  lab_reference TEXT,
  raw_result_artifact_id TEXT REFERENCES artifacts(id),
  evidence_tier TEXT,
  geography_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pill_type_composition (
  id TEXT PRIMARY KEY,
  pill_type_id TEXT NOT NULL REFERENCES pill_types(id),
  substance_id TEXT NOT NULL REFERENCES substances(id),
  concentration_value REAL,
  concentration_unit TEXT,
  evidence_tier TEXT,
  tested_sample_id TEXT REFERENCES tested_samples(id),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS batch_alert_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  definition_json TEXT,
  approval_state TEXT NOT NULL DEFAULT 'PROPOSED',
  approved_hash TEXT,
  approved_by TEXT,
  approved_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS batch_alerts (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL REFERENCES batch_alert_rules(id),
  pill_type_id TEXT REFERENCES pill_types(id),
  geography_id TEXT,
  alert_type TEXT,
  window_start TEXT,
  window_end TEXT,
  sample_count INTEGER,
  status TEXT,
  created_at TEXT NOT NULL,
  CHECK (alert_type IS NULL OR alert_type IN
    ('new_composition', 'adulterant_detected', 'look_alike_warning', 'series_anomaly'))
);

-- -------------------------------------------------------------------- audit
CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  object_type TEXT,
  object_id TEXT,
  request_id TEXT,
  metadata_json TEXT,
  previous_event_hash TEXT,
  event_hash TEXT NOT NULL
);

-- ------------------------------------------------------------------ indexes
CREATE INDEX IF NOT EXISTS idx_observations_run ON observations(run_id);
CREATE INDEX IF NOT EXISTS idx_observations_series ON observations(series_id);
CREATE INDEX IF NOT EXISTS idx_fetch_events_run ON fetch_events(run_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_run ON artifacts(run_id);
CREATE INDEX IF NOT EXISTS idx_run_steps_run ON run_steps(run_id);
CREATE INDEX IF NOT EXISTS idx_analysis_results_arun ON analysis_results(analysis_run_id);
CREATE INDEX IF NOT EXISTS idx_analysis_runs_run ON analysis_runs(run_id);
`;
