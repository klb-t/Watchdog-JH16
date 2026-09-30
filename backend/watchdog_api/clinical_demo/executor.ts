import { z } from 'zod';
import { CLINICAL_DEMO_VERSION, type ClinicalApplicability, type ClinicalCase, type ClinicalDependency,
  type ClinicalDependencyTrace, type ClinicalGap, type ClinicalOutcome, type ClinicalRule,
  type ClinicalRuleTrace, type ClinicalSourceState, type ClinicalTrace } from '../../../shared/clinical_demo';
import { ClinicalCaseSchema, ClinicalRuleSchema, ClinicalSourceStateSchema, ClinicalRuleReviewSchema,
  ClinicalDependencySchema } from '../../../shared/clinical_demo_validation';
import { canonicalHash, canonicalizeJson } from '../domain/canonical';
import { validateExecutorManifest, type ClinicalExecutorManifest } from './executor_manifest';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.string().regex(/^fixture:[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/);
const InputSchema = z.object({
  case: ClinicalCaseSchema, rules: z.array(ClinicalRuleSchema).max(100),
  sources: z.array(ClinicalSourceStateSchema).max(200), reviews: z.array(ClinicalRuleReviewSchema).max(100),
  executorManifest: z.unknown(),
}).strict().superRefine((input, ctx) => {
  for (const [name, values] of [
    ['rules', input.rules.map(rule => rule.id)],
    ['sources', input.sources.map(source => source.document.id)],
    ['reviews', input.reviews.map(review => review.ruleId)],
  ] as const) {
    if (new Set(values).size !== values.length) ctx.addIssue({ code: 'custom', message: `Duplicate ${name} identities` });
  }
});
export interface ClinicalExecutionInput {
  case: ClinicalCase;
  rules: ClinicalRule[];
  sources: ClinicalSourceState[];
  reviews: z.infer<typeof ClinicalRuleReviewSchema>[];
  executorManifest: ClinicalExecutorManifest;
}
export interface ClinicalDemoArchive {
  version: 'clinical-demo-archive-1';
  input: ClinicalExecutionInput;
  trace: ClinicalTrace;
  traceHash: string;
  archiveHash: string;
}
export interface ClinicalExecutionResult { trace: ClinicalTrace; traceHash: string; archive: ClinicalDemoArchive }
/** Supplied by the trusted fixture harness. This is not an authentication service,
 * and callers cannot grant real rights by constructing this object. */
export interface ClinicalHistoricalAccess {
  caseHash: string;
  caseReadable: boolean;
  readableReferenceHashes: string[];
  readableRuleHashes: string[];
}
export interface ClinicalHistoricalResult {
  mode: 'historical-verification';
  trace: ClinicalTrace;
  traceHash: string;
}

function parseInput(raw: unknown): ClinicalExecutionInput {
  const parsed = InputSchema.parse(raw);
  return { ...parsed, executorManifest: validateExecutorManifest(parsed.executorManifest) } as ClinicalExecutionInput;
}
const byId = <T extends { id: string }>(items: T[]): T[] => [...items].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
function gap(code: string, detail: string, dependencyId: string | null = null, observationIds: string[] = []): ClinicalGap {
  return { code, detail, dependencyId, observationIds: [...observationIds].sort() };
}

function relevantSupersessionRecords(record: ClinicalCase, candidates: ClinicalCase['observations']): ClinicalCase['observations'] {
  const relevantIds = new Set(candidates.map(observation => observation.id));
  for (const other of record.observations) {
    if (candidates.some(candidate => candidate.contradicts.includes(other.id) || other.contradicts.includes(candidate.id)))
      relevantIds.add(other.id);
  }
  const successors = new Map<string, ClinicalCase['observations']>();
  for (const observation of byId(record.observations)) {
    if (observation.supersedes !== null)
      successors.set(observation.supersedes, [...(successors.get(observation.supersedes) ?? []), observation]);
  }
  const pending = [...relevantIds].sort();
  const visited = new Set<string>();
  const consulted = new Map<string, ClinicalCase['observations'][number]>();
  for (let index = 0; index < pending.length; index++) {
    const target = pending[index];
    if (visited.has(target)) continue;
    visited.add(target);
    for (const successor of successors.get(target) ?? []) {
      consulted.set(successor.id, successor);
      pending.push(successor.id);
    }
  }
  return byId([...consulted.values()]);
}

function checkApplicability(record: ClinicalCase, rule: ClinicalRule): { applicability: ClinicalApplicability; gaps: ClinicalGap[] } {
  const gaps: ClinicalGap[] = [];
  let mismatch = false;
  for (const dimension of ['species', 'population', 'setting'] as const) {
    const context = record.context[dimension];
    if (context.state === 'missing') gaps.push(gap('applicability_missing', `${dimension}: ${context.reason}`));
    else if (!rule.applicability[dimension].includes(context.value)) {
      mismatch = true;
      gaps.push(gap('applicability_mismatch', `${dimension}: ${context.value} is outside the declared applicability.`));
    }
  }
  return { applicability: mismatch ? 'inapplicable' : gaps.length ? 'undetermined' : 'applicable', gaps };
}

function checkDependency(record: ClinicalCase, dependency: ClinicalDependency, sources: Map<string, ClinicalSourceState>): ClinicalDependencyTrace {
  const gaps: ClinicalGap[] = [];
  const superseded = new Set(record.observations.flatMap(observation => observation.supersedes === null ? [] : [observation.supersedes]));
  const candidates = byId(record.observations.filter(observation => dependency.observationId === null
    ? observation.quantityId === dependency.quantityId : observation.id === dependency.observationId));
  const active = candidates.filter(observation => !superseded.has(observation.id));
  const add = (code: string, detail: string, ids: string[] = []) => gaps.push(gap(code, detail, dependency.id, ids));
  const checkedSources = new Set<string>();
  const checkObservationSource = (observation: ClinicalCase['observations'][number]) => {
    if (checkedSources.has(observation.id)) return;
    checkedSources.add(observation.id);
    const ids = [observation.id], source = sources.get(observation.sourceId);
    if (!source) add('source_missing', `Observation source ${observation.sourceId} is unavailable.`, ids);
    else {
      if (!source.readable) add('source_unreadable', `Observation source ${observation.sourceId} is not currently readable.`, ids);
      const actualHash = canonicalHash(source.document);
      const casePin = record.sourcePins.find(pin => pin.referenceId === observation.sourceId);
      if (actualHash !== source.contentHash || !casePin || actualHash !== casePin.contentHash)
        add('source_changed', `Observation source ${observation.sourceId} does not match the case-pinned content hash.`, ids);
      if (source.status !== 'approved' || source.approvedHash !== actualHash)
        add('source_unapproved', `Observation source ${observation.sourceId} lacks current approval for its exact content.`, ids);
    }
  };
  // Supersession is evidence too: a record outside an ID-pinned dependency can
  // remove a conflicting observation. Validate every successor in the relevant
  // chains, even intermediate records, before that exclusion permits execution.
  // Unrelated observation chains do not become dependencies of this rule.
  for (const successor of relevantSupersessionRecords(record, candidates)) checkObservationSource(successor);
  if (!candidates.length) add('missing_observation', `No observation matches ${dependency.quantityId}.`);
  else if (!active.length) add('observation_superseded', 'All matching observations are explicitly superseded.', candidates.map(value => value.id));
  if (active.length > 1) add('observation_ambiguous', 'Multiple active observations match; no newest-value selection is performed.', active.map(value => value.id));
  if (dependency.eventWindow && record.referenceTime.state === 'missing')
    add('missing_reference_time', `Case reference time: ${record.referenceTime.reason}.`);

  for (const observation of active) {
    const ids = [observation.id];
    if (observation.quantityId !== dependency.quantityId) add('observation_quantity_mismatch', 'Pinned observation describes a different quantity.', ids);
    if (!dependency.allowedModes.includes(observation.mode)) add('observation_mode_mismatch', `Mode ${observation.mode} is not allowed.`, ids);
    const conflicts = record.observations.filter(other => other.id !== observation.id && !superseded.has(other.id)
      && (observation.contradicts.includes(other.id) || other.contradicts.includes(observation.id)));
    if (conflicts.length) add('observation_conflict', 'An explicit active contradiction remains unresolved.', [observation.id, ...conflicts.map(value => value.id)]);
    if (observation.value.state === 'missing') add('missing_value', `Value: ${observation.value.reason}.`, ids);
    if (observation.unit.state === 'missing') add('missing_unit', `Unit: ${observation.unit.reason}.`, ids);
    else if (observation.unit.value !== dependency.unit) add('unit_mismatch', `Expected exact unit ${dependency.unit}; received ${observation.unit.value}. No conversion performed.`, ids);
    if (dependency.requireEventTime && observation.eventTime.state === 'missing') add('missing_event_time', `Event time: ${observation.eventTime.reason}.`, ids);
    if (dependency.requireMeasurementTime && observation.measurementTime.state === 'missing') add('missing_measurement_time', `Measurement time: ${observation.measurementTime.reason}.`, ids);
    if (dependency.eventWindow && record.referenceTime.state === 'known' && observation.eventTime.state === 'known') {
      const offset = Date.parse(observation.eventTime.value) - Date.parse(record.referenceTime.value);
      if (offset < dependency.eventWindow.minOffsetMs || offset > dependency.eventWindow.maxOffsetMs)
        add('event_window_mismatch', `Event offset ${offset} ms falls outside the declared inclusive window.`, ids);
    }
    checkObservationSource(observation);
  }
  const accepted = active.length === 1 && !gaps.length ? active[0] : null;
  return { dependency, observationIds: candidates.map(value => value.id), acceptedObservationId: accepted?.id ?? null,
    value: accepted?.value.state === 'known' ? accepted.value.value : null, gaps };
}

function evaluateRule(input: ClinicalExecutionInput, rule: ClinicalRule): ClinicalRuleTrace {
  const ruleHash = canonicalHash(rule);
  const sources = new Map(input.sources.map(source => [source.document.id, source]));
  const applicability = checkApplicability(input.case, rule);
  const gates = [...applicability.gaps];
  const operations: ClinicalRuleTrace['operations'] = [{ operation: 'applicability', detail: applicability.applicability }];
  if (!input.case.hypotheses.some(hypothesis => hypothesis.id === rule.hypothesisId))
    gates.push(gap('hypothesis_missing', `Rule hypothesis ${rule.hypothesisId} is absent from the case.`));
  const review = input.reviews.find(item => item.ruleId === rule.id);
  if (!review || review.status !== 'approved') gates.push(gap('rule_unapproved', 'No current approved synthetic-fixture review for this rule.'));
  if (review && review.ruleHash !== ruleHash) gates.push(gap('rule_review_hash_mismatch', 'Rule content differs from the separately reviewed exact hash.'));
  operations.push({ operation: 'rule_review', detail: review ? `${review.status}:${review.ruleHash}` : 'missing' });
  for (const reference of [...rule.references].sort((a, b) => a.referenceId < b.referenceId ? -1 : 1)) {
    const source = sources.get(reference.referenceId);
    if (!source) gates.push(gap('source_missing', `Reference ${reference.referenceId} is unavailable.`));
    else {
      const actual = canonicalHash(source.document);
      if (actual !== source.contentHash || actual !== reference.contentHash)
        gates.push(gap('source_changed', `Reference ${reference.referenceId} no longer matches the pinned content hash.`));
      if (source.status !== 'approved' || source.approvedHash !== actual)
        gates.push(gap('source_unapproved', `Reference ${reference.referenceId} lacks approval for its current exact content.`));
      if (!source.readable) gates.push(gap('source_unreadable', `Reference ${reference.referenceId} is not currently readable.`));
    }
    operations.push({ operation: 'source_gate', detail: canonicalizeJson({ referenceId: reference.referenceId, requiredHash: reference.contentHash,
      current: source ? { contentHash: source.contentHash, actualHash: canonicalHash(source.document), status: source.status, readable: source.readable, approvedHash: source.approvedHash } : null }) });
  }
  const dependencies = byId(rule.dependencies).map(dependency => checkDependency(input.case, dependency, sources));
  for (const dependency of dependencies) {
    operations.push({ operation: 'dependency', detail: `${dependency.dependency.id}:${dependency.gaps.length ? 'blocked' : 'satisfied'}` });
    const candidates = input.case.observations.filter(item => dependency.observationIds.includes(item.id));
    for (const successor of relevantSupersessionRecords(input.case, candidates)) {
      const source = sources.get(successor.sourceId);
      operations.push({ operation: 'supersession_provenance', detail: canonicalizeJson({
        dependencyId: dependency.dependency.id, observationId: successor.id, supersedes: successor.supersedes,
        sourceId: successor.sourceId, casePinnedHash: input.case.sourcePins.find(pin => pin.referenceId === successor.sourceId)?.contentHash ?? null,
        actualHash: source ? canonicalHash(source.document) : null, contentHash: source?.contentHash ?? null,
        readable: source?.readable ?? false, status: source?.status ?? null, approvedHash: source?.approvedHash ?? null,
      }) });
    }
    for (const observationId of dependency.observationIds) {
      const observation = input.case.observations.find(item => item.id === observationId)!;
      const successors = input.case.observations.filter(item => item.supersedes === observationId).map(item => item.id).sort();
      if (successors.length) operations.push({ operation: 'observation_excluded', detail: canonicalizeJson({
        dependencyId: dependency.dependency.id, observationId, reason: 'superseded', successorIds: successors }) });
      const source = sources.get(observation.sourceId);
      operations.push({ operation: 'observation_provenance', detail: canonicalizeJson({ dependencyId: dependency.dependency.id, observationId,
        sourceId: observation.sourceId, casePinnedHash: input.case.sourcePins.find(pin => pin.referenceId === observation.sourceId)?.contentHash ?? null, actualHash: source ? canonicalHash(source.document) : null, contentHash: source?.contentHash ?? null, readable: source?.readable ?? false, status: source?.status ?? null, approvedHash: source?.approvedHash ?? null }) });
    }
  }
  // Source eligibility applies to the whole rule, including observation provenance.
  // A different missing dependency cannot authorize a proposal around a revoked source.
  const provenanceBlocked = dependencies.some(dependency => dependency.gaps.some(item => item.code.startsWith('source_')));
  const eligible = applicability.applicability === 'applicable' && gates.length === 0 && !provenanceBlocked;
  const gaps = [...gates, ...dependencies.flatMap(dependency => dependency.gaps)];
  let outcome: ClinicalOutcome = 'undetermined';
  if (!gaps.length) {
    const value = dependencies.find(item => item.dependency.id === rule.predicate.dependencyId)!.value!;
    const threshold = rule.predicate.value;
    const comparisons = { eq: value === threshold, lt: value < threshold, lte: value <= threshold, gt: value > threshold, gte: value >= threshold };
    outcome = comparisons[rule.predicate.operator] ? 'supported' : 'contradicted';
    operations.push({ operation: 'scalar_comparison', detail: `${rule.predicate.dependencyId}: ${value} ${rule.predicate.operator} ${threshold} ${rule.predicate.unit} => ${outcome}` });
  } else operations.push({ operation: 'predicate_blocked', detail: 'No scalar comparison was executed.' });
  return { ruleId: rule.id, ruleHash, references: rule.references, hypothesisId: rule.hypothesisId,
    applicability: applicability.applicability, outcome, execution: outcome === 'undetermined' ? 'blocked' : 'evaluated',
    meaning: rule.meanings[outcome], eligible, dependencies, gaps, operations };
}

/** Pure fixture evaluation. The harness supplies a current source/review snapshot.
 * No network lookup, clock, implicit unit conversion, history import or clinical
 * authorization is performed. Historical approval snapshots are not current authority. */
export function executeClinicalDemo(rawInput: unknown): ClinicalExecutionResult {
  const input = parseInput(rawInput);
  const trace: ClinicalTrace = {
    schemaVersion: CLINICAL_DEMO_VERSION, purpose: 'software-demonstration',
    caseHash: canonicalHash(input.case), executorHash: input.executorManifest.hash,
    rules: byId(input.rules).map(rule => evaluateRule(input, rule)),
    unresolvedHypothesisIds: input.case.hypotheses.filter(hypothesis => !input.rules.some(rule => rule.hypothesisId === hypothesis.id)).map(value => value.id).sort(),
    limitations: [
      'Synthetic software demonstration; no clinical interpretation or medical approval.',
      'Unresolved hypothesis IDs mean no_rule; absent interaction edges do not establish absence of interactions.',
      'Appearance is descriptive only and never confirms an exposure or composition.',
      'Contradicted hypotheses and all original observations remain in the archived case.',
      'Source/review/readability state is supplied by a trusted fixture harness; this is not a production authorization boundary.',
    ],
  };
  const traceHash = canonicalHash(trace);
  const body = structuredClone({ version: 'clinical-demo-archive-1' as const, input, trace, traceHash });
  return { trace, traceHash, archive: { ...body, archiveHash: canonicalHash(body) } };
}

const GapSchema = z.object({ code: z.string().min(1).max(100), dependencyId: id.nullable(), observationIds: z.array(id).max(200), detail: z.string().max(2000) }).strict();
const DependencyTraceSchema = z.object({ dependency: ClinicalDependencySchema, observationIds: z.array(id).max(200), acceptedObservationId: id.nullable(),
  value: z.number().finite().nullable(), gaps: z.array(GapSchema).max(2000) }).strict();
const RuleTraceSchema = z.object({ ruleId: id, ruleHash: digest, references: z.array(z.object({ referenceId: id, contentHash: digest }).strict()).max(100), hypothesisId: id,
  applicability: z.enum(['applicable', 'inapplicable', 'undetermined']), outcome: z.enum(['supported', 'contradicted', 'undetermined']), execution: z.enum(['evaluated', 'blocked']),
  meaning: z.string().min(1).max(1000), eligible: z.boolean(), dependencies: z.array(DependencyTraceSchema).max(100), gaps: z.array(GapSchema).max(200100),
  operations: z.array(z.object({ operation: z.string().max(100), detail: z.string().max(32768) }).strict()).max(60500),
}).strict();
const TraceSchema = z.object({ schemaVersion: z.literal(CLINICAL_DEMO_VERSION), purpose: z.literal('software-demonstration'), caseHash: digest, executorHash: digest,
  rules: z.array(RuleTraceSchema).max(100), unresolvedHypothesisIds: z.array(id).max(100), limitations: z.array(z.string().max(2000)).max(100) }).strict();
const ArchiveSchema = z.object({ version: z.literal('clinical-demo-archive-1'), input: z.unknown(), trace: TraceSchema, traceHash: digest, archiveHash: digest }).strict();
const hashes = z.array(digest).max(200).refine(values => new Set(values).size === values.length, 'Duplicate access hashes');
const AccessSchema = z.object({ caseHash: digest, caseReadable: z.boolean(), readableReferenceHashes: hashes, readableRuleHashes: hashes }).strict();

function readArchive(rawArchive: unknown, rawAccess: unknown): ClinicalDemoArchive {
  const parsed = ArchiveSchema.parse(rawArchive);
  const input = parseInput(parsed.input);
  const archive = { ...parsed, input } as ClinicalDemoArchive;
  const { archiveHash, ...body } = archive;
  if (canonicalHash(body) !== archiveHash || canonicalHash(archive.trace) !== archive.traceHash)
    throw new Error('Historical archive integrity hash mismatch.');
  if (archive.trace.caseHash !== canonicalHash(input.case) || archive.trace.executorHash !== input.executorManifest.hash)
    throw new Error('Historical archive input pins mismatch.');
  if (archive.trace.rules.length !== input.rules.length) throw new Error('Historical archive rule count mismatch.');
  const orderedRules = byId(input.rules);
  for (let index = 0; index < orderedRules.length; index++) {
    const rule = orderedRules[index];
    const result = archive.trace.rules[index];
    if (result.ruleId !== rule.id || result.ruleHash !== canonicalHash(rule) || result.hypothesisId !== rule.hypothesisId
      || canonicalHash(result.references) !== canonicalHash(rule.references)
      || canonicalHash(result.dependencies.map(item => item.dependency)) !== canonicalHash(byId(rule.dependencies)))
      throw new Error('Historical archive rule/reference/dependency pins mismatch.');
  }
  const access = AccessSchema.parse(rawAccess);
  if (!access.caseReadable || access.caseHash !== archive.trace.caseHash) throw new Error('Current read access to the archived case is denied.');
  if (input.rules.some(rule => !access.readableRuleHashes.includes(canonicalHash(rule))))
    throw new Error('Current read access to an archived rule is denied.');
  if (input.sources.some(source => !access.readableReferenceHashes.includes(canonicalHash(source.document))))
    throw new Error('Current read access to an archived source is denied.');
  return archive;
}

/** Reading is not execution or renewed approval. Current read rights cover every
 * original source/rule, including unused records disclosed by the archive. */
export function readClinicalDemoArchive(archive: unknown, currentAccess: unknown): ClinicalHistoricalResult {
  const verified = readArchive(archive, currentAccess);
  return { mode: 'historical-verification', trace: verified.trace, traceHash: verified.traceHash };
}

/** Replay checks an old computation with its archived approval snapshot. It does
 * not make a revoked rule eligible for a NEW execution. Current read denial always
 * wins, and another executor source manifest cannot claim an exact replay. */
export function replayClinicalDemoArchive(archive: unknown, currentAccess: unknown, currentExecutorManifest: unknown): ClinicalHistoricalResult {
  const verified = readArchive(archive, currentAccess);
  const manifest = validateExecutorManifest(currentExecutorManifest);
  if (manifest.hash !== verified.input.executorManifest.hash) throw new Error('Historical replay executor manifest mismatch.');
  const replay = executeClinicalDemo(verified.input);
  if (replay.traceHash !== verified.traceHash || canonicalizeJson(replay.trace) !== canonicalizeJson(verified.trace))
    throw new Error('Historical replay differs from the archived trace.');
  return { mode: 'historical-verification', trace: replay.trace, traceHash: replay.traceHash };
}
