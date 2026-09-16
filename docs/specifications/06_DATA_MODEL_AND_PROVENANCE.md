# Data Model and Provenance Contract

## Identity/access
`organizations(id,name,created_at)`
`users(id,email UNIQUE,display_name,organization_id,active,created_at,last_login_at)`
`roles(id,name UNIQUE,description)`
`user_roles(user_id,role_id,organization/context)` unique composite
`oauth_sessions(...)`
`access_requests(requester,requested capability/role,status,reviewer,timestamps,reason)`

## Sources
`sources(id,source_key UNIQUE,display_name,adapter_id,adapter_version,enabled,capabilities,license_notes,retention_policy,created_at)`
`source_credential_refs(source_id,owner/org,secret_ref,status,updated_at)` — never plaintext key.
`source_permissions(...)`

## Substance ontology
`substances(id,canonical_name,normalized_name,description,active,created_at)`
`aliases(id,substance_id,alias,language,jurisdiction,alias_type,source_id,confidence,valid_from,valid_to)`
`external_identifiers(substance_id,namespace,value,provenance)`

## Runs
`runs(id,run_type,preset_id/version,status,trigger_type,parent_run_id,created_by,created_at,started_at,completed_at,app_version,git_commit,effective_config_hash,warning_count,error_code)`
`run_steps(id,run_id,step_name,sequence,status,timestamps,implementation_version,input_hash,output_hash,warning/error metadata)`

## Artifacts/manifests
`artifacts(id,run_id,kind,media_type,object_uri,sha256,byte_size,immutable,created_at,source_id,metadata)`
`manifests(run_id UNIQUE,schema_version,object_uri,sha256,finalized_at)`
Finalized manifest immutable.

## Observations/time series
`series(id,metric_key,substance_id,source_id,geography,language,query_role,unit,metadata)`
`snapshots(id,series_id,run_id,observed_at,retrieved_at,numeric_value,text_value,raw_artifact_id,query_text,method_version,quality_flags,created_at)`
Append only. Corrections are superseding observations/runs.

## Analysis
`analysis_results(id,run_id,substance_id,metric_key,value_numeric,value_text,unit,statistic_metadata,input_artifact_hashes,analyzer_id/version)`
`reference_harm_scores(reference_set_id/version,substance_id,score,citation_metadata)`

## Schedules
`schedules(id,name,owner_id,enabled,preset/source config reference or snapshot,recurrence,timezone,next_run_at,last_run_id,consecutive_failures,created_at,updated_at)`
Editing schedule never changes historical effective configs.

## Audit
`audit_events(id,timestamp,actor_type,actor_id,action,object_type,object_id,request_id,metadata,previous_event_hash?,event_hash?)`
Append only. Optional hash chain especially for privileged changes.

## Future entities
Pill/Sample, LabResult, Alert, ReceptorProfile, EvidenceClaim, GeographicEvent, GeneratedSummary.

## Manifest minimum scientific provenance
Exact query, provider/adapter/version, timestamp, locale/geography, SafeSearch, substance/query label, count/missing state, raw response hash or documented non-retention, effective config/hash, implementation/git version.


## Fetch events and content-addressed raw archive
Every external/manual fetch attempt is a first-class record:
`fetch_events(id,run_id,source_id,request_hash,requested_at,completed_at,status,provider_request_id,http/status metadata,raw_blob_id,error_code,metadata)`.

`raw_blobs(id,sha256 UNIQUE,object_uri,byte_size,media_type,retention_class,created_at)` stores retainable payload bytes content-addressably. Multiple fetch events may point to one identical blob; logical fetch history is never deduplicated away.

## First-class datasets
`datasets(id,name,version,schema_id,created_by_run,artifact_id,sha256,row_count,column_count,quality_summary,permissions,created_at)`
`dataset_columns(dataset_id,name,physical_type,semantic_type,unit,role,metadata)`
`dataset_inputs(dataset_id,input_dataset_id/input_artifact_id,relationship)`

## Transformations / lineage DAG
`transform_specs(id,version,transform_key,parameters,implementation_version,created_at)`
`transform_runs(id,run_id,spec_id,input_dataset_ids/hashes,output_dataset_id/hash,warnings)`
Finalized derived datasets are immutable; edits create a new dataset/version.

## Series materialization
Extend `series` metadata with source dataset, value/time fields, resolution, timezone/calendar, aggregation, group dimensions, missing policy and transform lineage. Series bodies may live in Parquet while PostgreSQL stores metadata/indexes.

## Analysis specifications
`analysis_specs(id,name,version,method_id/version,input_contract,parameters,created_by,created_at)`
An interactive analysis can be saved and rerun/scheduled on later datasets.

## Research projects and papers
`research_projects(id,title,version,status,owner,question,hypotheses,scope,created_at)`
`project_inputs(project_id,dataset/run/literature/spec/figure references,role,version)`
`literature_items(id,project_id,doi_or_identifier,citation_metadata,artifact_id/hash,verification_state,tags)`
`evidence_packages(id,project_id,version,manifest_artifact_id/hash,finalized_at)`
`paper_drafts(id,project_id,evidence_package_id,version,template_version,provider/model metadata,artifact_id/hash,status,created_at)`
`claim_evidence_links(draft_id,section,claim_id,claim_type,evidence_type,evidence_id,citation_id,validation_status)`


## Figures and visualization specifications
`figure_specs(id,name,version,visualization_id/version,input_dataset_or_analysis_ids,render_parameters,created_by,created_at)`
`figures(id,spec_id,run_id,artifact_id/hash,renderer_version,created_at)`
Edits create new specs/figures; a paper pins exact figure IDs/hashes.

## Semantic/community extraction candidates
`extraction_candidates(id,source_artifact_id,source_span,extractor_id/version,candidate_type,raw_value,normalized_candidate,confidence,verification_state,created_at)`
`candidate_mappings(candidate_id,ontology_id/version,target_id,confidence,method,verification_state)`
Candidates cannot silently become canonical substance/symptom/dose facts.

## Geography / locale
`geographies(id,parent_id,type,canonical_name,code,metadata)` with hierarchy independent of source/user identity.
Series/datasets may reference geography IDs plus language/locale. Sensitive raw location evidence can have stricter access than aggregated derived geography.
