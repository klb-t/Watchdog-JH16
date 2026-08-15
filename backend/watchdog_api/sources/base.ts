export type SourceCapability =
  | 'result_count'
  | 'interest_over_time'
  | 'interest_by_region'
  | 'entity_reference'
  | 'scientific_literature'
  | 'numeric_reference_table'
  | 'chemical_properties'
  | 'pharmacology'
  | 'lab_sample'
  | 'alert_feed'
  | 'free_text_reports'
  | 'geospatial'
  | 'manual_dataset';

export interface RawFetchResult {
  payload: Buffer | null;
  status: string; // e.g. "SUCCESS", "ZERO_RESULTS", "RATE_LIMIT"
  http_status?: number;
  metadata?: Record<string, any>;
  raw_blob_id?: string; // Assigned by persistence layer
}

export interface Observation {
  entity_id: string;
  dimension: string;
  query_text: string;
  result_count: number | null;
  retrieved_at: string;
  source_id: string;
  source_adapter_version: string;
  locale?: string;
  country?: string;
  safe_search?: boolean;
  raw_artifact_id?: string;
  quality_flags?: string[];
}

export interface ProvenanceMetadata {
  retention_policy: string;
  license: string;
  attribution: string;
}

export interface ValidatedParams {
  valid: boolean;
  normalized_params: Record<string, any>;
  errors?: string[];
}

export interface SourceAdapter {
  adapter_id: string;
  adapter_version: string;
  
  capabilities(): SourceCapability[];
  validate_params(params: Record<string, any>): ValidatedParams;
  fetch(params: Record<string, any>): Promise<RawFetchResult>;
  normalize(raw: RawFetchResult, params: Record<string, any>): Observation[];
  provenance(raw: RawFetchResult): ProvenanceMetadata;
}
