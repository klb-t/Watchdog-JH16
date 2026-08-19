import { Observation } from '../domain/observation';
import { AnalysisResultValue } from '../domain/method_spec';

export type { AnalysisResultValue };

/** Retained alias while E1.15 migrates JH2016 onto MethodSpec. */
export type StatisticalResult = AnalysisResultValue;

export interface AnalysisSpec {
  method_id: string;
  method_version: string;
  parameters: Record<string, any>;
}

export interface Analyzer {
  analyzer_id: string;
  analyzer_version: string;
  validate_inputs(inputs: readonly Observation[], config: AnalysisSpec): void;
  analyze(inputs: readonly Observation[], config: AnalysisSpec): AnalysisResultValue[];
}
