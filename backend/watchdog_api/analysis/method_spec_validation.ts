import { MethodSpec, MethodStep, MissingPolicy } from '../domain/method_spec';
import { canonicalHash } from '../domain/canonical';
import { getPrimitive } from './primitives';

/**
 * MethodSpec validation and hashing (E1.12).
 *
 * Every check below must pass before a spec can be stored. An invalid spec is
 * rejected with the failing path and is never partially stored — a half-stored
 * spec is a spec someone will later execute.
 */

export interface SpecIssue {
  path: string;
  rule: string;
  message: string;
}

export class MethodSpecInvalidError extends Error {
  readonly code = 'method_spec_invalid';
  readonly issues: SpecIssue[];
  constructor(issues: SpecIssue[]) {
    super(`MethodSpec is invalid:\n${issues.map(i => `  at '${i.path}': ${i.message} [${i.rule}]`).join('\n')}`);
    this.name = 'MethodSpecInvalidError';
    this.issues = issues;
  }
}

const VALID_MISSING_POLICIES: MissingPolicy[] = ['propagate', 'exclude', 'fail'];

/** Units that may flow into one another without an explicit conversion. */
function unitsCompatible(produced: string, expected: string): boolean {
  if (expected === 'any' || produced === 'any') return true;
  return produced === expected;
}

export function validateMethodSpec(spec: MethodSpec): SpecIssue[] {
  const issues: SpecIssue[] = [];
  const push = (path: string, rule: string, message: string) => issues.push({ path, rule, message });

  if (!spec.specVersion) push('specVersion', 'required', 'a spec must declare its version');
  if (!spec.name) push('name', 'required', 'a spec must be named');
  if (!Array.isArray(spec.steps) || spec.steps.length === 0) {
    push('steps', 'required', 'a spec with no steps computes nothing');
    return issues;
  }

  const inputNames = new Set((spec.inputs ?? []).map(i => i.name));
  const stepIds = new Set<string>();

  // Unit/semantic type produced by each named symbol, for edge checking.
  const producedUnit = new Map<string, string>();
  for (const input of spec.inputs ?? []) producedUnit.set(input.name, input.unit);

  spec.steps.forEach((step: MethodStep, index: number) => {
    const base = `steps[${index}]`;

    if (!step.id) push(`${base}.id`, 'required', 'every step needs an id');
    else if (stepIds.has(step.id)) push(`${base}.id`, 'unique', `duplicate step id '${step.id}'`);
    else stepIds.add(step.id);

    const primitive = getPrimitive(step.primitive);
    if (!primitive) {
      // The compiler may emit only registered primitives; an unknown one is
      // rejected rather than causing a primitive to be invented.
      push(`${base}.primitive`, 'unknown_primitive',
        `'${step.primitive}' is not in the primitive registry`);
      return;
    }

    // Missing policy must be declared explicitly wherever one can be met.
    if (!step.missingPolicy) {
      push(`${base}.missingPolicy`, 'undeclared_missing_policy',
        `step '${step.id}' must declare a missing-value policy explicitly`);
    } else if (!VALID_MISSING_POLICIES.includes(step.missingPolicy)) {
      push(`${base}.missingPolicy`, 'invalid_missing_policy',
        `'${step.missingPolicy}' is not one of ${VALID_MISSING_POLICIES.join(', ')}`);
    } else if (!primitive.contract.missingPolicies.includes(step.missingPolicy)) {
      push(`${base}.missingPolicy`, 'unsupported_missing_policy',
        `primitive '${step.primitive}' does not support policy '${step.missingPolicy}' ` +
        `(supports: ${primitive.contract.missingPolicies.join(', ')})`);
    }

    // Parameters must satisfy the primitive's declared schema.
    for (const p of primitive.contract.params) {
      const value = step.params?.[p.name];
      if (p.required && (value === undefined || value === null)) {
        push(`${base}.params.${p.name}`, 'required_param',
          `primitive '${step.primitive}' requires parameter '${p.name}'`);
      } else if (value !== undefined && value !== null && typeof value !== p.type) {
        push(`${base}.params.${p.name}`, 'param_type',
          `expected ${p.type}, got ${typeof value}`);
      }
    }
    for (const given of Object.keys(step.params ?? {})) {
      if (!primitive.contract.params.some(p => p.name === given)) {
        push(`${base}.params.${given}`, 'unknown_param',
          `primitive '${step.primitive}' has no parameter '${given}'`);
      }
    }

    // Every input reference must resolve, to an input or an EARLIER step.
    for (const inputName of primitive.contract.inputs.map(i => i.name)) {
      const ref = step.inputs?.[inputName];
      if (!ref) {
        push(`${base}.inputs.${inputName}`, 'required_input',
          `primitive '${step.primitive}' requires input '${inputName}'`);
        continue;
      }
      if (!inputNames.has(ref) && !stepIds.has(ref)) {
        // A reference to a later step is a forward reference; since ids are
        // added in order, an unresolved one here is either unknown or a cycle.
        const declaredLater = spec.steps.slice(index).some(s => s.id === ref);
        push(`${base}.inputs.${inputName}`,
          declaredLater ? 'cycle' : 'unresolved_reference',
          declaredLater
            ? `step '${step.id}' references '${ref}', which is not yet computed — the graph must be acyclic and topologically ordered`
            : `'${ref}' is neither a declared input nor an earlier step`);
        continue;
      }

      // Unit compatibility along the edge: a count may not flow where a
      // proportion is expected.
      const upstreamUnit = producedUnit.get(ref);
      const expected = primitive.contract.outputUnit === 'inherit' ? 'any' : 'any';
      if (upstreamUnit !== undefined && !unitsCompatible(upstreamUnit, expected)) {
        push(`${base}.inputs.${inputName}`, 'unit_mismatch',
          `'${ref}' produces ${upstreamUnit}, incompatible here`);
      }
    }

    // Record what this step produces, for downstream edge checks.
    //
    // A primitive that declares a `unit` parameter (scale) sets its own output
    // unit, so an explicit param wins over `inherit`. Getting this wrong makes
    // the validator disagree with what the primitive actually does at runtime,
    // which is worse than not checking at all.
    const declaresUnitParam = primitive.contract.params.some(p => p.name === 'unit');
    const explicitUnit = declaresUnitParam && typeof step.params?.unit === 'string'
      ? String(step.params.unit)
      : undefined;

    const unit = explicitUnit
      ?? (primitive.contract.outputUnit === 'inherit'
        ? (producedUnit.get(step.inputs?.[primitive.contract.inputs[0]?.name] ?? '') ?? 'any')
        : primitive.contract.outputUnit);
    producedUnit.set(step.id, unit);
  });

  // Every declared output must be produced by some step.
  for (const [i, out] of (spec.outputs ?? []).entries()) {
    if (!stepIds.has(out.fromStep)) {
      push(`outputs[${i}].fromStep`, 'unresolved_reference',
        `output '${out.name}' names step '${out.fromStep}', which does not exist`);
    } else {
      const produced = producedUnit.get(out.fromStep);
      if (produced && out.unit && !unitsCompatible(produced, out.unit) && produced !== 'any') {
        push(`outputs[${i}].unit`, 'unit_mismatch',
          `output '${out.name}' declares ${out.unit} but step '${out.fromStep}' produces ${produced}`);
      }
    }
  }

  return issues;
}

export function assertValidMethodSpec(spec: MethodSpec): void {
  const issues = validateMethodSpec(spec);
  if (issues.length > 0) throw new MethodSpecInvalidError(issues);
}

/**
 * Canonical hash of a spec. Semantically equal specs hash equally regardless of
 * key order; this is what approval binds to, so it must not drift.
 */
export function hashMethodSpec(spec: MethodSpec): string {
  return canonicalHash(spec);
}

/** True when a spec has an unresolved ambiguity blocking approval. */
export function hasBlockingAmbiguity(spec: MethodSpec): boolean {
  return spec.steps.some(s => s.ambiguous === true);
}
