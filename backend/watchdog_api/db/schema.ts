import { sqliteTable, text, integer, real, primaryKey } from 'drizzle-orm/sqlite-core';

/**
 * Drizzle table definitions mirroring `migrations/001_initial_schema.ts`.
 *
 * The migration SQL is authoritative for the physical schema; this file is the
 * typed query surface over it. When they disagree the migration wins, and
 * `tests/integration/persistence.test.ts` compares the two so they cannot drift
 * apart silently.
 */

export const principals = sqliteTable('principals', {
  id: text('id').primaryKey(),
  email: text('email'),
  display_name: text('display_name'),
  identity_provenance: text('identity_provenance').notNull(),
  active: integer('active').notNull().default(1),
  created_at: text('created_at').notNull(),
});

export const substances = sqliteTable('substances', {
  id: text('id').primaryKey(),
  canonical_name: text('canonical_name').notNull(),
  normalized_name: text('normalized_name').notNull(),
  description: text('description'),
  active: integer('active').notNull().default(1),
  created_at: text('created_at').notNull(),
});

export const capabilities = sqliteTable('capabilities', {
  id: text('id').primaryKey(),
  capability_key: text('capability_key').notNull().unique(),
  display_name: text('display_name'),
  input_contract: text('input_contract'),
  output_contract: text('output_contract'),
});

export const sources = sqliteTable('sources', {
  id: text('id').primaryKey(),
  source_key: text('source_key').notNull().unique(),
  display_name: text('display_name'),
  capability_id: text('capability_id'),
  enabled: integer('enabled').notNull().default(1),
  license_notes: text('license_notes'),
  retention_policy: text('retention_policy'),
  status: text('status').notNull(),
  created_at: text('created_at').notNull(),
});

export const providers = sqliteTable('providers', {
  id: text('id').primaryKey(),
  provider_key: text('provider_key').notNull().unique(),
  capability_id: text('capability_id'),
  display_name: text('display_name'),
  adapter_id: text('adapter_id'),
  adapter_version: text('adapter_version'),
  status: text('status').notNull(),
  discovery_provenance: text('discovery_provenance'),
  approved_by: text('approved_by'),
  approved_at: text('approved_at'),
  created_at: text('created_at').notNull(),
});

export const runs = sqliteTable('runs', {
  id: text('id').primaryKey(),
  run_type: text('run_type').notNull(),
  preset_id: text('preset_id'),
  preset_version: text('preset_version'),
  status: text('status').notNull(),
  trigger_type: text('trigger_type'),
  parent_run_id: text('parent_run_id'),
  supersedes_run_id: text('supersedes_run_id'),
  owner_principal_id: text('owner_principal_id').notNull(),
  visibility: text('visibility').notNull().default('private'),
  created_at: text('created_at').notNull(),
  started_at: text('started_at'),
  completed_at: text('completed_at'),
  app_version: text('app_version'),
  git_commit: text('git_commit'),
  effective_config: text('effective_config'),
  effective_config_hash: text('effective_config_hash'),
  warning_count: integer('warning_count').notNull().default(0),
  error_code: text('error_code'),
  error_details: text('error_details'),
});

export const runSteps = sqliteTable('run_steps', {
  id: text('id').primaryKey(),
  run_id: text('run_id').notNull().references(() => runs.id),
  step_name: text('step_name').notNull(),
  sequence: integer('sequence').notNull(),
  status: text('status').notNull(),
  started_at: text('started_at'),
  completed_at: text('completed_at'),
  implementation_version: text('implementation_version'),
  input_hash: text('input_hash'),
  output_hash: text('output_hash'),
  warning_json: text('warning_json'),
  error_json: text('error_json'),
});

export const rawBlobs = sqliteTable('raw_blobs', {
  id: text('id').primaryKey(),
  sha256: text('sha256').notNull().unique(),
  object_uri: text('object_uri').notNull(),
  byte_size: integer('byte_size').notNull(),
  media_type: text('media_type'),
  retention_class: text('retention_class'),
  created_at: text('created_at').notNull(),
});

export const artifacts = sqliteTable('artifacts', {
  id: text('id').primaryKey(),
  run_id: text('run_id').notNull().references(() => runs.id),
  kind: text('kind').notNull(),
  media_type: text('media_type'),
  object_uri: text('object_uri').notNull(),
  sha256: text('sha256').notNull(),
  byte_size: integer('byte_size'),
  immutable: integer('immutable').notNull().default(1),
  owner_principal_id: text('owner_principal_id').notNull(),
  visibility: text('visibility').notNull().default('private'),
  created_at: text('created_at').notNull(),
  metadata_json: text('metadata_json'),
});

export const manifests = sqliteTable('manifests', {
  run_id: text('run_id').primaryKey().references(() => runs.id),
  schema_version: text('schema_version').notNull(),
  object_uri: text('object_uri').notNull(),
  sha256: text('sha256').notNull(),
  finalized_at: text('finalized_at').notNull(),
});

export const fetchEvents = sqliteTable('fetch_events', {
  id: text('id').primaryKey(),
  run_id: text('run_id').notNull().references(() => runs.id),
  source_id: text('source_id').notNull(),
  provider_id: text('provider_id'),
  provider_version: text('provider_version'),
  request_hash: text('request_hash'),
  rendered_query: text('rendered_query'),
  requested_at: text('requested_at'),
  completed_at: text('completed_at'),
  status: text('status').notNull(),
  provider_request_id: text('provider_request_id'),
  http_status: integer('http_status'),
  raw_blob_id: text('raw_blob_id').references(() => rawBlobs.id),
  error_code: text('error_code'),
  metadata_json: text('metadata_json'),
  created_at: text('created_at').notNull(),
});

export const series = sqliteTable('series', {
  id: text('id').primaryKey(),
  metric_key: text('metric_key').notNull(),
  substance_id: text('substance_id'),
  source_id: text('source_id'),
  geography: text('geography'),
  language: text('language'),
  query_role: text('query_role'),
  unit: text('unit'),
  owner_principal_id: text('owner_principal_id').notNull(),
  visibility: text('visibility').notNull().default('private'),
  metadata_json: text('metadata_json'),
  created_at: text('created_at').notNull(),
});

export const observations = sqliteTable('observations', {
  id: text('id').primaryKey(),
  series_id: text('series_id').notNull().references(() => series.id),
  run_id: text('run_id').notNull().references(() => runs.id),
  observed_at: text('observed_at'),
  retrieved_at: text('retrieved_at').notNull(),
  numeric_value: real('numeric_value'),
  text_value: text('text_value'),
  is_missing: integer('is_missing').notNull().default(0),
  missing_reason: text('missing_reason'),
  raw_artifact_id: text('raw_artifact_id'),
  fetch_event_id: text('fetch_event_id'),
  provider_id: text('provider_id'),
  source_adapter_version: text('source_adapter_version'),
  query_text: text('query_text'),
  method_version: text('method_version'),
  quality_flags_json: text('quality_flags_json'),
  created_at: text('created_at').notNull(),
});

export const methodSpecs = sqliteTable('method_specs', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  version: text('version').notNull(),
  spec_json: text('spec_json').notNull(),
  spec_hash: text('spec_hash').notNull().unique(),
  approval_state: text('approval_state').notNull().default('PROPOSED'),
  approved_hash: text('approved_hash'),
  approved_by: text('approved_by'),
  approved_at: text('approved_at'),
  source_prose: text('source_prose'),
  compiler_provider_id: text('compiler_provider_id'),
  compiler_model: text('compiler_model'),
  owner_principal_id: text('owner_principal_id').notNull(),
  created_at: text('created_at').notNull(),
});

export const analysisRuns = sqliteTable('analysis_runs', {
  id: text('id').primaryKey(),
  run_id: text('run_id').notNull().references(() => runs.id),
  method_spec_id: text('method_spec_id'),
  input_series_ids_json: text('input_series_ids_json'),
  input_hashes_json: text('input_hashes_json'),
  executor_id: text('executor_id'),
  executor_version: text('executor_version'),
  status: text('status').notNull(),
  created_at: text('created_at').notNull(),
});

export const analysisResults = sqliteTable('analysis_results', {
  id: text('id').primaryKey(),
  analysis_run_id: text('analysis_run_id').notNull().references(() => analysisRuns.id),
  substance_id: text('substance_id'),
  metric_key: text('metric_key').notNull(),
  value_numeric: real('value_numeric'),
  value_text: text('value_text'),
  unit: text('unit'),
  is_missing: integer('is_missing').notNull().default(0),
  statistic_metadata_json: text('statistic_metadata_json'),
  created_at: text('created_at').notNull(),
});

export const referenceScoreSets = sqliteTable('reference_score_sets', {
  id: text('id').primaryKey(),
  set_key: text('set_key').notNull(),
  version: text('version').notNull(),
  citation_json: text('citation_json'),
  created_at: text('created_at').notNull(),
});

export const referenceScores = sqliteTable('reference_scores', {
  set_id: text('set_id').notNull().references(() => referenceScoreSets.id),
  substance_id: text('substance_id').notNull(),
  score: real('score').notNull(),
  notes: text('notes'),
  evidence_tier: text('evidence_tier'),
}, (t) => [primaryKey({ columns: [t.set_id, t.substance_id] })]);

export const narratives = sqliteTable('narratives', {
  id: text('id').primaryKey(),
  run_id: text('run_id').notNull().references(() => runs.id),
  template_id: text('template_id'),
  template_version: text('template_version'),
  provider_id: text('provider_id'),
  model: text('model'),
  generation_params_json: text('generation_params_json'),
  input_payload_hash: text('input_payload_hash').notNull(),
  content: text('content').notNull(),
  content_hash: text('content_hash').notNull(),
  approval_state: text('approval_state').notNull().default('PROPOSED'),
  approved_hash: text('approved_hash'),
  approved_by: text('approved_by'),
  approved_at: text('approved_at'),
  created_at: text('created_at').notNull(),
});

export const replicationTargets = sqliteTable('replication_targets', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  identifier_type: text('identifier_type'),
  identifier: text('identifier'),
  citation_json: text('citation_json'),
  method_description_prose: text('method_description_prose'),
  status: text('status').notNull(),
  owner_principal_id: text('owner_principal_id').notNull(),
  created_at: text('created_at').notNull(),
});

export const replicationClaims = sqliteTable('replication_claims', {
  id: text('id').primaryKey(),
  target_id: text('target_id').notNull().references(() => replicationTargets.id),
  claim_key: text('claim_key').notNull(),
  claim_type: text('claim_type'),
  claimed_value_numeric: real('claimed_value_numeric'),
  claimed_value_text: text('claimed_value_text'),
  unit: text('unit'),
  tolerance_kind: text('tolerance_kind').notNull(),
  tolerance_value: real('tolerance_value'),
  notes: text('notes'),
  created_at: text('created_at').notNull(),
});

export const replicationAttempts = sqliteTable('replication_attempts', {
  id: text('id').primaryKey(),
  target_id: text('target_id').notNull().references(() => replicationTargets.id),
  run_id: text('run_id').notNull().references(() => runs.id),
  method_spec_id: text('method_spec_id'),
  started_at: text('started_at'),
  completed_at: text('completed_at'),
  status: text('status').notNull(),
});

export const replicationVerdicts = sqliteTable('replication_verdicts', {
  id: text('id').primaryKey(),
  attempt_id: text('attempt_id').notNull().references(() => replicationAttempts.id),
  claim_id: text('claim_id').notNull().references(() => replicationClaims.id),
  observed_value_numeric: real('observed_value_numeric'),
  observed_value_text: text('observed_value_text'),
  within_tolerance: integer('within_tolerance'),
  deviation: real('deviation'),
  verdict: text('verdict').notNull(),
  rationale: text('rationale'),
  created_at: text('created_at').notNull(),
});

export const auditEvents = sqliteTable('audit_events', {
  id: text('id').primaryKey(),
  timestamp: text('timestamp').notNull(),
  actor_type: text('actor_type').notNull(),
  actor_id: text('actor_id'),
  action: text('action').notNull(),
  object_type: text('object_type'),
  object_id: text('object_id'),
  request_id: text('request_id'),
  metadata_json: text('metadata_json'),
  previous_event_hash: text('previous_event_hash'),
  event_hash: text('event_hash').notNull(),
});
