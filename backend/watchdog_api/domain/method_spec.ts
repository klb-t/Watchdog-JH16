/**
 * MethodSpec types, per D6 and `04_METHOD_COMPILER_AND_APPROVAL.md`.
 *
 * A MethodSpec is data. It is never `eval`'d, never templated into source,
 * never written to disk as executable anything. The compiler emits it; the
 * executor accepts nothing else.
 *
 * Types only here — validation and hashing are E1.12, the primitive registry is
 * E1.11, and the executor is E1.14.
 */

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/** How a step behaves when it meets a missing value. Declared, never implicit. */
export type MissingPolicy = 'propagate' | 'exclude' | 'fail';

export type SemanticType = 'count' | 'proportion' | 'percentage' | 'score' | 'rank' | 'coefficient';

export interface InputBinding {
  readonly name: string;
  readonly unit: string;
  readonly semanticType: SemanticType;
}

export interface OutputBinding {
  readonly name: string;
  readonly unit: string;
  readonly semanticType: SemanticType;
  /** The step id producing this output. Validation checks it resolves. */
  readonly fromStep: string;
}

export interface MethodStep {
  readonly id: string;
  /** Must exist in the primitive registry; an unknown primitive is rejected. */
  readonly primitive: string;
  readonly params: Record<string, JsonValue>;
  /** References to input names or prior step ids. */
  readonly inputs: Record<string, string>;
  readonly missingPolicy: MissingPolicy;
  /**
   * Set by the compiler where the prose admits more than one reading. An
   * ambiguous step blocks approval until a human chooses, and if no
   * disambiguation is available it becomes a `method_unclear` verdict rather
   * than being resolved by a guess.
   */
  readonly ambiguous?: boolean;
  readonly alternatives?: readonly MethodStep[];
  /** Which sentence of the source prose this step came from. */
  readonly rationale?: string;
}

export interface MethodSpec {
  readonly specVersion: string;
  readonly name: string;
  readonly inputs: readonly InputBinding[];
  readonly steps: readonly MethodStep[];
  readonly outputs: readonly OutputBinding[];
  readonly assumptions: readonly string[];
}

/** A series handed to an executor, carrying its declared unit and semantics. */
export interface TypedSeries {
  readonly name: string;
  readonly unit: string;
  readonly semanticType: SemanticType;
  /** Aligned with `entityIds`; `null` is missing and never coerced to zero. */
  readonly values: readonly (number | null)[];
  readonly entityIds: readonly string[];
}

export interface AnalysisResultValue {
  readonly entityId?: string;
  readonly metricKey: string;
  readonly valueNumeric: number | null;
  readonly valueText?: string;
  readonly unit?: string;
  readonly isMissing: boolean;
  readonly statisticMetadata?: Record<string, JsonValue>;
}

export interface AnalysisArtifact {
  readonly specHash: string;
  readonly executorId: string;
  readonly executorVersion: string;
  readonly results: readonly AnalysisResultValue[];
  /** Every flag raised anywhere in execution, for the manifest. */
  readonly qualityFlags: readonly string[];
}

/**
 * `01_ARCHITECTURE.md` §MethodExecutor. Pure with respect to its inputs: same
 * spec, same series, same bytes out. No clock, no random, no locale-dependent
 * formatting, no unordered iteration.
 */
export interface MethodExecutor {
  readonly executorId: string;
  readonly executorVersion: string;
  supports(spec: MethodSpec): boolean;
  execute(spec: MethodSpec, inputs: readonly TypedSeries[]): Promise<AnalysisArtifact>;
}
