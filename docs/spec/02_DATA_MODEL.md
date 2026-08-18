# Data model and provenance

Written for SQLite at E1, migrating mechanically to PostgreSQL at E3. Use TEXT for
identifiers (ULID or UUIDv7), INTEGER for counts, REAL for measured values, TEXT ISO-8601 UTC
for timestamps, and JSON-encoded TEXT where a JSONB column is intended later.

## Universal columns

Every row that a researcher can own or that participates in provenance carries:

| Column | Rule |
|---|---|
| `owner_principal_id` | TEXT NOT NULL. Constant `'local-user'` until E4. |
| `visibility` | TEXT NOT NULL, one of `private`, `project`, `shared`. Default `private`. |
| `created_at` | TEXT NOT NULL, ISO-8601 UTC. |

## Identity

```
principals(id, email, display_name, identity_provenance, active, created_at)
roles(id, name UNIQUE, description)
principal_roles(principal_id, role_id)
```

At E1 exactly one principal row exists: `local-user`. Do not add authentication tables now;
their absence is the point.

## Substances

```
substances(id, canonical_name, normalized_name, description, active, created_at)
aliases(id, substance_id, alias, language, jurisdiction, alias_type, source_id, confidence,
        valid_from, valid_to)
external_identifiers(substance_id, namespace, value, provenance)
```

Canonical identity is separate from the query label used by a preset. The FAITHFUL preset's
query strings are never replaced by aliases. See `03_JH2016_CONTRACT.md`.

## Sources and providers

```
sources(id, source_key UNIQUE, display_name, capability_id, enabled, license_notes,
        retention_policy, status, created_at)
capabilities(id, capability_key UNIQUE, display_name, input_contract, output_contract)
providers(id, provider_key UNIQUE, capability_id, display_name, adapter_id, adapter_version,
          status, discovery_provenance, approved_by, approved_at, created_at)
provider_credentials(id, provider_id, secret_ref, status, updated_at)
```

`status` on both sources and providers is one of `implemented`, `fixture`, `planned`,
`blocked`. The UI must render non-`implemented` entries as unavailable and must never count
them as capability. `provider_credentials.secret_ref` is a pointer into the secret store,
never a key.

## Runs and provenance

```
runs(id, run_type, preset_id, preset_version, status, trigger_type, parent_run_id,
     supersedes_run_id, owner_principal_id, visibility, created_at, started_at, completed_at,
     app_version, git_commit, effective_config_hash, warning_count, error_code)

run_steps(id, run_id, step_name, sequence, status, started_at, completed_at,
          implementation_version, input_hash, output_hash, warning_json, error_json)

artifacts(id, run_id, kind, media_type, object_uri, sha256, byte_size, immutable,
          owner_principal_id, visibility, created_at, metadata_json)

manifests(run_id UNIQUE, schema_version, object_uri, sha256, finalized_at)
```

`kind` on artifacts: `raw`, `normalized`, `analysis`, `figure`, `export`, `narrative`,
`method_spec`, `manifest`.

## Fetch events and content-addressed raw storage

```
fetch_events(id, run_id, source_id, provider_id, provider_version, request_hash,
             rendered_query, requested_at, completed_at, status, provider_request_id,
             http_status, raw_blob_id, error_code, metadata_json)

raw_blobs(id, sha256 UNIQUE, object_uri, byte_size, media_type, retention_class, created_at)
```

Two fetches that return identical bytes share one blob row. **The fetch events remain
distinct.** Logical fetch history is never deduplicated away — two identical results on two
dates is itself a finding.

`rendered_query` stores the exact string sent to the provider, after templating. This is
scientific evidence, not a debug convenience.

## Observations and series

```
series(id, metric_key, substance_id, source_id, geography, language, query_role, unit,
       owner_principal_id, visibility, metadata_json)

observations(id, series_id, run_id, observed_at, retrieved_at, numeric_value, text_value,
             is_missing, missing_reason, raw_artifact_id, fetch_event_id, provider_id,
             query_text, method_version, quality_flags_json, created_at)
```

`is_missing` is a real column with a real reason. A missing observation has
`numeric_value = NULL` and `is_missing = 1`. Nothing downstream may coerce that to zero.

`query_role` distinguishes the JH2016 popularity query from the harm query on the same
substance.

`quality_flags_json` carries flags including `PROVIDER_DISCONTINUITY`,
`COUNT_PARSE_UNCERTAIN`, `PROVIDER_ESTIMATE`, `SAFESEARCH_UNKNOWN`.

## Analysis

```
method_specs(id, name, version, spec_json, spec_hash UNIQUE, approval_state,
             approved_by, approved_at, source_prose, compiler_provider_id, compiler_model,
             owner_principal_id, created_at)

analysis_runs(id, run_id, method_spec_id, input_series_ids_json, input_hashes_json,
              executor_id, executor_version, status, created_at)

analysis_results(id, analysis_run_id, substance_id, metric_key, value_numeric, value_text,
                 unit, is_missing, statistic_metadata_json, created_at)

reference_score_sets(id, set_key, version, citation_json, created_at)
reference_scores(set_id, substance_id, score, notes)
```

`approval_state` is `PROPOSED` or `APPROVED`. It is bound to `spec_hash`: if the spec JSON
changes, the hash changes, and the row's approval no longer applies. Implement this by
recomputing the hash on read and treating a mismatch as `PROPOSED`. Do not rely on an update
trigger; rely on the hash.

## Narrative

```
narratives(id, run_id, template_id, template_version, provider_id, model, generation_params_json,
           input_payload_hash, content, content_hash, approval_state, approved_by, approved_at,
           created_at)
```

The narrative service receives a frozen structured payload and its hash. It cannot read the
database, cannot recompute, cannot alter a scientific value. Every generated paragraph is
`PROPOSED` until approved, and is rendered visually distinct from deterministic content
wherever it appears, including in exports.

## Replication

New at E1. See `08_REPLICATION_ENGINE.md` for semantics.

```
replication_targets(id, title, identifier_type, identifier, citation_json,
                    method_description_prose, status, owner_principal_id, created_at)

replication_claims(id, target_id, claim_key, claim_type, claimed_value_numeric,
                   claimed_value_text, unit, tolerance_kind, tolerance_value, notes)

replication_attempts(id, target_id, run_id, method_spec_id, started_at, completed_at, status)

replication_verdicts(id, attempt_id, claim_id, observed_value_numeric, observed_value_text,
                     within_tolerance, deviation, verdict, rationale, created_at)
```

`verdict` is one of `reproduced`, `deviates`, `not_computable`, `method_unclear`. There is no
`failed` — a replication that does not match is a result, not an error, and the vocabulary
must not push toward one conclusion.

`tolerance_kind` is `absolute`, `relative`, `rank_correlation_floor`, or `interval`.

## Datasets and transforms (schema now, use at E5)

```
datasets(id, name, version, schema_json, created_by_run, artifact_id, sha256, row_count,
         column_count, owner_principal_id, visibility, created_at)
dataset_columns(dataset_id, name, physical_type, semantic_type, unit, role, metadata_json)
dataset_inputs(dataset_id, input_dataset_id, input_artifact_id, relationship)
transform_specs(id, version, transform_key, parameters_json, implementation_version, created_at)
transform_runs(id, run_id, spec_id, input_hashes_json, output_dataset_id, output_hash, warnings_json)
```

Create these tables at E1 as part of the initial migration. They cost nothing empty and
prevent a schema fork later. Do not build features against them before E5.

## Evidence tier (shared concept)

A single ordinal classification of how a fact was established. It applies wherever this
package draws on heterogeneous source types: general substance knowledge, symptom
associations, and specimen identification alike.

```
evidence_tier: PRIMARY_EMPIRICAL | CURATED_SECONDARY | RAW_OBSERVATIONAL
             | MODELED_PREDICTED | SPECULATIVE | UNKNOWN
```

Full definition, the UI colour convention, and its relationship to `approval_state` and to
per-row `quality_flags_json` are in `10_EVIDENCE_TIER_AND_TRUST_UI.md`. In one sentence, because
it matters enough to repeat here: tier is about the *kind* of evidence, `approval_state` is
about whether a *human signed off*, and `quality_flags_json` is *situational caveats* — three
independent axes that can all apply to the same row at once.

`reference_scores` gains a nullable `evidence_tier` column now; backfill existing rows to
`CURATED_SECONDARY`, since a versioned published score set is secondary-curated by this
definition.

## Field reference: symptoms, samples, pills — schema now, Epic E6 decomposes the rest

Added at E1 as an empty skeleton, following the same reasoning as the datasets/transforms
tables above: cheap to seed now, expensive to retrofit once real data exists without it. Do not
build UI or acquisition against these tables before E6. This section is deliberately indicative
rather than exhaustively columned — E2 through E5 receive the same treatment in
`07_EPICS_AND_TASKS.md`, and E6 is no different: full design happens when its turn comes,
against real source data and a real UI, not in advance of either.

**Symptom ontology**, mirroring the existing substance/alias pattern:

```
symptoms(id, canonical_name, body_system, description, active, created_at)
symptom_aliases(id, symptom_id, alias, language, source_id, created_at)
```

**Substance–symptom associations** — the direction this runs matters and is easy to get
backwards. The community-extraction pipeline above mines *text → candidate symptom mentions*
for population-level signal. This is the opposite direction: *given observed symptoms, which
substances are known to produce them*, for individual-case decision support. Both use the same
`extraction_candidates` / `verification_state` promotion path where a model is involved; they
are different consumers of the same substance/symptom ontology, not the same pipeline.

```
substance_symptom_associations(id, substance_id, symptom_id, relation_type, onset_notes,
    evidence_tier, reference_set_id, citation_json, created_at)
```

`relation_type` is a small controlled vocabulary, defined in full in
`11_FIELD_AND_CLINICAL_INTERFACES.md`: intoxication sign, overdose sign, withdrawal sign,
interaction sign.

**Pills, composition and tested specimens** — extends the existing
substance ↔ pill ↔ sample ↔ event ontology already scoped for this project. A visual pattern
(what a responder or a photo recognises) is distinct from a specific tested specimen (what a
lab actually confirmed); composition links the two and always traces to the specimen(s) that
established it.

```
pill_types(id, shape, color_json, logo_text, score_line, size_mm, image_artifact_id,
    geography_id, first_observed_at, created_at)

tested_samples(id, pill_type_id, source_id, test_method, tested_at, lab_reference,
    raw_result_artifact_id, evidence_tier, geography_id, created_at)

pill_type_composition(id, pill_type_id, substance_id, concentration_value, concentration_unit,
    evidence_tier, tested_sample_id, created_at)
```

A pill type with no `tested_samples` row and only a visual-match composition guess is exactly
the dangerous case `10_EVIDENCE_TIER_AND_TRUST_UI.md` addresses: composition from visual
matching alone is capped at `MODELED_PREDICTED`, never higher, regardless of how confident the
match looks, because counterfeit pills are adversarial against visual identification by design.

**Alert rules and firings** — reuses the approval gate rather than inventing new semantics for
it. A rule is approved once, like a method spec; each firing is an automatic, deterministic
consequence of an already-approved rule, like an analysis result is a consequence of an
approved method spec.

```
batch_alert_rules(id, name, definition_json, approval_state, approved_by, approved_at,
    created_at)

batch_alerts(id, rule_id, pill_type_id, geography_id, alert_type, window_start, window_end,
    sample_count, status, created_at)
```

`alert_type`: `new_composition`, `adulterant_detected`, `look_alike_warning`, `series_anomaly`.

## Audit

```
audit_events(id, timestamp, actor_type, actor_id, action, object_type, object_id, request_id,
             metadata_json, previous_event_hash, event_hash)
```

Hash-chained. Recorded for: approval and revocation, provider approval, credential changes,
configuration changes, run cancellation, manifest supersession, privileged export.

## Manifest minimum content

Every finalised run writes a manifest artifact containing at least:

- schema version, run id, run type, status, timestamps
- app version and git commit
- effective configuration hash, and the canonicalised effective configuration itself
- preset id and version, and whether it is locked
- for each fetch: source id, provider id and version, rendered query, request hash,
  raw blob sha256, http status
- for each analysis: method spec id and hash, approval state and approver, executor id and
  version, input series ids and their content hashes
- every quality flag raised anywhere in the run, including `PROVIDER_DISCONTINUITY`
- output artifact list with sha256 for each
- explicit list of missing observations with reasons
- for narrative artifacts: provider, model, generation parameters, input payload hash,
  approval state

A manifest that omits a substitution, a missing value or a flag is a defect of the highest
severity in this project. The manifest is the scientific claim; everything else is working
material.
