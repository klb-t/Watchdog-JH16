/**
 * Run lifecycle, mirroring `01_ARCHITECTURE.md` §Run lifecycle and the domain
 * state machine in `backend/watchdog_api/domain/run_state.ts`. The two must
 * agree; the domain module is authoritative.
 */
export type RunStatus =
  | 'CREATED'
  | 'VALIDATING'
  | 'QUEUED'
  | 'RUNNING'
  | 'NORMALIZING'
  | 'ANALYZING'
  | 'EXPORTING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export interface Run {
  id: string;
  run_type: string;
  status: RunStatus;
  effective_config?: string;
  effective_config_hash?: string | null;
  preset_id?: string | null;
  preset_version?: string | null;
  owner_principal_id: string;
  visibility: string;
  warning_count?: number;
  error_code?: string | null;
  error_details?: string | null;
  created_at: string;
  started_at?: string | null;
  completed_at?: string | null;
}

/** Registry status; only `implemented` and `fixture` may be selected for a run. */
export type SourceStatus = 'implemented' | 'fixture' | 'planned' | 'blocked-by-license/auth';

export interface Source {
  source_id: string;
  adapter: string;
  status: SourceStatus;
  capabilities: string[];
  description: string;
}

export interface Analyzer {
  preset_id: string;
  analyzer_id: string;
}

export type QueryExpansionMode =
  | 'STRICT_CANONICAL'
  | 'SCIENTIFIC_SYNONYMS'
  | 'LOCALIZED_SYNONYMS'
  | 'EXPERIMENTAL_SLANG_EXPANSION';

export interface RunSubmission {
  type: 'ACQUISITION' | 'ANALYSIS' | 'PIPELINE';
  config: {
    source_id?: string;
    source_params?: Record<string, any>;
    method_id?: string;
    method_params?: Record<string, any>;
    source_run_id?: string;
    /** Part of the query plan's identity (D15). Never defaulted server-side. */
    language?: string;
    query_expansion_mode?: QueryExpansionMode;
    entities?: string[];
    query_templates?: Record<string, string>;
  };
}

export interface FetchEvent {
  id: string;
  run_id: string;
  source_id: string;
  raw_blob_id: string | null;
  status: string;
  created_at: string;
}

export interface Manifest {
  run_id: string;
  object_uri: string;
  sha256: string;
  finalized_at: string;
}
