export interface Run {
  id: string;
  type: string;
  status: 'QUEUED' | 'ACQUIRING' | 'NORMALIZING' | 'ANALYZING' | 'SUCCESS' | 'FAILED';
  effective_config: Record<string, any>;
  error_code?: string;
  error_details?: string;
  created_at: string;
  updated_at: string;
}

export interface Source {
  source_id: string;
  adapter: string;
}

export interface Analyzer {
  preset_id: string;
  analyzer_id: string;
}

export interface RunSubmission {
  type: 'ACQUISITION' | 'ANALYSIS' | 'PIPELINE';
  config: {
    source_id?: string;
    source_params?: Record<string, any>;
    method_id?: string;
    method_params?: Record<string, any>;
    source_run_id?: string;
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
