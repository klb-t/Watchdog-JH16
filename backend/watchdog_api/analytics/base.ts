export interface StatisticalResult {
  entity_id?: string;
  metric_key: string;
  value_numeric: number | null;
  value_text?: string;
  unit?: string;
  metadata?: Record<string, any>;
}

export interface AnalysisSpec {
  method_id: string;
  method_version: string;
  parameters: Record<string, any>;
}

export interface Analyzer {
  analyzer_id: string;
  analyzer_version: string;
  validate_inputs(inputs: any[], config: AnalysisSpec): void;
  analyze(inputs: any[], config: AnalysisSpec): StatisticalResult[];
}
