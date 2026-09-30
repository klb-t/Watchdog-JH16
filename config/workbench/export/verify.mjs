#!/usr/bin/env node
// Standalone verifier: Node.js built-ins only; no network, packages or database.
import { readFileSync, realpathSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => value === null || value === undefined ? 'null' : typeof value !== 'object' ? JSON.stringify(value)
  : Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
const hash = value => sha(canonical(value));
const check = (condition, message) => { if (!condition) throw new Error(message); };
function verifyComparisonCalculation(claim, result, core, plan) {
  check(Array.isArray(result.artifact.results), 'Missing analysis result inventory.');
  const matches = result.artifact.results.filter(r => r.metricKey === claim.statistic), selected = matches.length === 1 ? matches[0] : null;
  check(!selected || selected.valueNumeric === null || Number.isFinite(selected.valueNumeric), 'Nonfinite comparison observation.');
  check(core.statistic === claim.statistic && core.expectedValue === claim.expectedValue && core.expectedUnit === claim.unit && core.observedValue === (selected?.valueNumeric ?? null) && core.observedUnit === (selected?.unit ?? null) && hash(core.tolerance) === hash(claim.tolerance), 'Comparison selected scalar, unit or claim mismatch.');
  check(hash(core.plan) === hash(plan) && hash(core.inputs) === hash(result.inputs) && core.inputHash === result.inputHash && hash(core.inputs) === core.inputHash && hash(core.executor) === hash({ id: result.artifact.executorId, version: result.artifact.executorVersion }), 'Comparison deterministic core is detached from its inputs or executor.');
  const issues = [];
  if (matches.length > 1) issues.push('ambiguous_result');
  if (selected?.entityId != null) issues.push('non_scalar_result');
  if (!claim.unit || selected && (!selected.unit || claim.unit !== selected.unit) || ['pearson', 'spearman'].includes(claim.statistic) && claim.unit !== 'dimensionless') issues.push('unit_mismatch');
  if (!matches.length) issues.push('missing_result');
  if (selected && (selected.isMissing || selected.valueNumeric === null)) issues.push('missing_value');
  if (claim.expectedValue === null) issues.push('absent_expected');
  if (claim.tolerance.kind === 'relative' && claim.expectedValue === 0) issues.push('zero_relative_base');
  check(hash(core.issues) === hash(issues), 'Comparison diagnostic ordering or completeness mismatch.');
  let verdict, withinTolerance = null, deviation = null, reason, rationale;
  if (issues.length) {
    reason = issues.find(issue => ['ambiguous_result', 'non_scalar_result', 'unit_mismatch'].includes(issue)) ?? (claim.tolerance.kind === 'absolute' && issues.includes('absent_expected') ? 'absent_expected' : issues[0]);
    verdict = ['ambiguous_result', 'non_scalar_result', 'unit_mismatch'].includes(reason) || reason === 'absent_expected' && claim.tolerance.kind === 'absolute' ? 'method_unclear' : 'not_computable';
    rationale = {
      missing_result: 'The exact selected metric is absent.',
      ambiguous_result: 'The selected metric does not identify exactly one scalar.',
      non_scalar_result: 'An entity-indexed result is not the selected scalar.',
      missing_value: 'The selected scalar is explicitly missing.',
      unit_mismatch: 'Expected and observed units must be explicit and identical; correlations require dimensionless units.',
      absent_expected: claim.tolerance.kind === 'absolute' ? 'An absolute tolerance needs a claimed value, and none is registered.' : 'A relative tolerance is undefined against a zero or absent claimed value.',
      zero_relative_base: 'A relative tolerance is undefined against a zero or absent claimed value.',
    }[reason];
  } else {
    const observed = selected.valueNumeric, expected = claim.expectedValue, tolerance = claim.tolerance.value;
    deviation = claim.tolerance.kind === 'absolute' ? observed - expected : (observed - expected) / Math.abs(expected);
    check(Number.isFinite(deviation), 'Comparison arithmetic overflow.');
    withinTolerance = Math.abs(deviation) <= tolerance;
    verdict = withinTolerance ? 'reproduced' : 'deviates';
    reason = withinTolerance ? 'within_tolerance' : 'outside_tolerance';
    rationale = claim.tolerance.kind === 'absolute'
      ? `Observed ${observed.toFixed(4)} is ${Math.abs(deviation).toFixed(4)} from the claimed ${expected}, ${withinTolerance ? 'within' : 'outside'} the pre-registered ±${tolerance}.`
      : `Observed ${observed.toFixed(4)} differs from the claimed ${expected} by ${(deviation * 100).toFixed(1)}%, ${withinTolerance ? 'within' : 'outside'} the pre-registered ±${(tolerance * 100).toFixed(0)}%.`;
  }
  check(core.verdict === verdict && core.withinTolerance === withinTolerance && core.deviation === deviation && core.reason === reason && core.rationale === rationale, 'Comparison verdict, arithmetic or rationale does not follow recorded semantics.');
}

// Independent semantic verification of the frozen scalar comparison. It deliberately
// does not evaluate the underlying statistic or treat these receipts as signatures.
function verifyComparison(envelope, result, binding, provenance, identity, selection, datasetReceipt) {
  const { comparison, review, freeze, attempt, core, coreHash } = envelope;
  check(comparison && comparison.id && hash(comparison.body) === comparison.hash && comparison.hash === identity.comparisonHash, 'Comparison revision identity mismatch.');
  check(core && hash(core) === coreHash && coreHash === identity.comparisonCoreHash && attempt?.id === identity.comparisonAttemptId, 'Comparison calculation core identity mismatch.');
  check(core.comparisonHash === comparison.hash && core.artifactHash === hash(result.artifact), 'Calculation core does not bind its complete claim and executor artifact.');
  const b = comparison.body, claim = b.claim, plan = b.plan, source = b.source;
  check(b.version === 'paper-comparison-1' && core.version === 'paper-comparison-core-1', 'Unsupported comparison semantics.');
  check(claim && ['pearson', 'spearman', 'describe.mean', 'describe.median', 'describe.sd', 'describe.min', 'describe.max'].includes(claim.statistic), 'Unsupported comparison scalar selector.');
  const text = value => typeof value === 'string' && value.trim().length > 0;
  check((claim.expectedValue === null || Number.isFinite(claim.expectedValue)) && (claim.unit === null || text(claim.unit)) && text(claim.rationale) && text(claim.tolerance?.rationale) && ['absolute', 'relative'].includes(claim.tolerance.kind) && Number.isFinite(claim.tolerance.value) && claim.tolerance.value >= 0, 'Invalid comparison expected value, unit or tolerance.');
  check(plan.operationId === binding.id && plan.operationHash === binding.hash && plan.methodId === result.methodId && plan.methodHash === result.methodHash && plan.methodHash === hash(result.methodSpec) && plan.datasetId === binding.body.datasetId && plan.datasetHash === result.datasetHash && plan.selectionHash === hash(result.selection), 'Comparison plan differs from the immutable operation.');
  const selectedFigure = result.selection.figure;
  check(hash(result.selection.columns) === hash(selection.columns) && selectedFigure.datasetId === plan.datasetId && hash({ datasetHash: selectedFigure.datasetHash, columns: result.selection.columns, filters: selectedFigure.filters, selectedIds: [...new Set(selectedFigure.selectedIds)].sort(), time: selectedFigure.channels.time, timeValue: selectedFigure.timeValue }) === hash(selection), 'Comparison run selection differs from verified statistical inputs.');
  check((claim.statistic.startsWith('describe.') ? 'describe' : claim.statistic) === binding.body.method, 'Comparison selector is incompatible with its operation.');
  check(source.documentId === binding.body.document.id && source.documentHash === binding.body.document.hash && source.provenance === 'USER_DECLARED_SOURCE_INTERPRETATION', 'Comparison source identity or interpretation provenance mismatch.');
  const documentText = binding.body.document.body.text.slice(0, binding.body.excerptCharacters), anchor = source.anchor;
  check(typeof claim.quote === 'string' && claim.quote.length > 0 && anchor.quote === claim.quote && sha(documentText) === anchor.textHash && Number.isInteger(anchor.startUtf16) && anchor.startUtf16 >= 0 && documentText.indexOf(claim.quote) === anchor.startUtf16 && anchor.endUtf16 === anchor.startUtf16 + claim.quote.length && documentText.indexOf(claim.quote, anchor.startUtf16 + 1) === -1, 'Comparison quote does not match its unique source span.');
  check(hash(b.limitations.fidelity) === hash({ method: 'NOT_ASSESSED', data: 'NOT_ASSESSED', population: 'NOT_ASSESSED', analysis: 'NOT_ASSESSED' }), 'Comparison fidelity is not an independently assessed claim.');
  check(b.limitations.operationHash === binding.hash && b.limitations.meaning === binding.body.meaning && b.limitations.scope === binding.body.scope && b.limitations.originsVerified === false, 'Comparison omitted or changed operation limitations.');
  for (const [event, kind] of [[review, 'APPROVE'], [freeze, 'FREEZE'], [attempt, 'ATTEMPT']]) {
    check(event && text(event.id) && event.kind === kind && event.comparisonId === comparison.id && event.comparisonHash === comparison.hash && Number.isSafeInteger(event.sequence) && event.sequence > 0 && text(event.actorId) && text(event.createdAt) && text(event.requestId), `Invalid comparison ${kind} receipt.`);
  }
  check(review.sequence < freeze.sequence && freeze.sequence < attempt.sequence && new Set([review.id, freeze.id, attempt.id]).size === 3, 'Comparison review/freeze/run chronology mismatch.');
  check(freeze.data.reviewId === review.id && attempt.freezeId === freeze.id && attempt.runId === result.runId && provenance.runId === attempt.runId, 'Run is not linked to its exact prior comparison freeze.');
  check(attempt.data.runId === attempt.runId && attempt.data.freezeId === freeze.id, 'Attempt receipt contains inconsistent run references.');
  const run = envelope.run, config = run?.effectiveConfig, ref = config?.paperComparison;
  check(run?.id === result.runId && run.ownerId === attempt.actorId && freeze.actorId === attempt.actorId && hash(config) === run.effectiveConfigHash, 'Run birth configuration identity mismatch.');
  check(ref?.id === comparison.id && ref.hash === comparison.hash && ref.reviewId === review.id && ref.freezeId === freeze.id && ref.attemptId === attempt.id && config.methodId === result.methodId && config.methodHash === result.methodHash && config.datasetHash === result.datasetHash && hash(config.selection) === plan.selectionHash, 'Run birth configuration does not pin the frozen comparison.');
  const approvals = config.approvalReceipts;
  check(approvals?.method?.hash === plan.methodHash && approvals.dataset?.hash === plan.datasetHash && text(approvals.method.eventId) && text(approvals.dataset.eventId) && approvals.method.actor === provenance.method.approvedBy && approvals.method.at === provenance.method.approvedAt && approvals.dataset.actor === datasetReceipt.approvedBy && approvals.dataset.at === datasetReceipt.approvedAt, 'Comparison run approval receipts differ from exported method or dataset approval.');
  check(b.priorExposure?.external === 'UNKNOWN' && Array.isArray(b.priorExposure.versions) && Array.isArray(b.priorExposure.operationRuns) && Array.isArray(b.priorExposure.attempts), 'Comparison exposure history is absent or overclaims knowledge.');
  check(b.supersedes === null || b.priorExposure.versions.some(v => v.id === b.supersedes.id && v.hash === b.supersedes.hash), 'Comparison predecessor is absent from preserved history.');
  const beforeRun = freeze.data.priorExposure;
  for (const exposure of [b.priorExposure, beforeRun]) {
    check(exposure?.external === 'UNKNOWN' && Array.isArray(exposure.versions) && Array.isArray(exposure.operationRuns) && Array.isArray(exposure.attempts), 'Invalid prior exposure snapshot.');
    for (const list of [exposure.versions, exposure.operationRuns, exposure.attempts]) check(new Set(list.map(v => v.id)).size === list.length, 'Duplicate exposure reference.');
    check(exposure.versions.every(v => text(v.id) && /^[a-f0-9]{64}$/.test(v.hash)), 'Invalid prior revision identity.');
    check(exposure.operationRuns.every(r => text(r.id) && r.id !== result.runId), 'Prior exposure contains the future run.');
    check(exposure.attempts.every(a => a.kind === 'ATTEMPT' && a.id !== attempt.id && a.runId !== result.runId && Number.isSafeInteger(a.sequence) && a.sequence < freeze.sequence && a.data.runId === a.runId && a.data.freezeId === a.freezeId && exposure.versions.some(v => v.id === a.comparisonId && v.hash === a.comparisonHash) && exposure.operationRuns.some(r => r.id === a.runId)), 'Prior attempt history is inconsistent.');
  }
  check(beforeRun.versions.some(v => v.id === comparison.id && v.hash === comparison.hash), 'Frozen history omits its own revision.');
  check(b.priorExposure.versions.every(v => beforeRun.versions.some(r => r.id === v.id && r.hash === v.hash)) && b.priorExposure.operationRuns.every(v => beforeRun.operationRuns.some(r => r.id === v.id)) && b.priorExposure.attempts.every(v => beforeRun.attempts.some(r => r.id === v.id && r.runId === v.runId && r.comparisonHash === v.comparisonHash)), 'Frozen history drops known prior exposure.');
  verifyComparisonCalculation(claim, result, core, plan);
}

try {
  const root = realpathSync(process.argv[2] ?? path.dirname(fileURLToPath(import.meta.url)));
  const read = name => {
    check(/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\.[a-z0-9]+$/.test(name), `Unsafe package path: ${name}`);
    const filename = path.join(root, name), actual = realpathSync(filename);
    check(actual === filename && actual.startsWith(root + path.sep) && lstatSync(filename).isFile(), `Non-regular package file: ${name}`);
    return readFileSync(filename);
  };
  const manifestBytes = read('package-manifest.json'), manifest = JSON.parse(manifestBytes);
  const packageHash = sha(manifestBytes);
  check(['watchdog-research-package-1', 'watchdog-research-package-2'].includes(manifest.version), 'Unsupported research package version.');
  if (process.argv[3]) check(packageHash === process.argv[3], 'Trusted package manifest hash does not match.');
  check(Array.isArray(manifest.files) && manifest.files.length > 0, 'Missing file inventory.');
  const names = new Set();
  for (const file of manifest.files) {
    check(!names.has(file.path), `Duplicate package file: ${file.path}`); names.add(file.path);
    const bytes = read(file.path);
    check(bytes.length === file.bytes && sha(bytes) === file.sha256, `File integrity mismatch: ${file.path}`);
  }
  const json = name => { check(names.has(name), `Required file is not inventoried: ${name}`); return JSON.parse(read(name)); };
  for (const name of ['figure.svg', 'selected.csv', 'README.md', 'verify.mjs']) check(names.has(name), `Missing ${name}`);
  const figure = json('figure.json'), dataset = json('dataset.json'), receipt = json('dataset-receipt.json'), profile = json('profile.json');
  const workspace = json('workspace.json');
  check(hash(workspace.figure) === hash(figure) && hash(workspace.profile) === hash(profile), 'Workspace restoration snapshot mismatch.');
  check(hash(figure) === manifest.identity.figureHash, 'Figure identity mismatch.');
  check(hash(dataset) === manifest.identity.datasetHash && figure.datasetHash === manifest.identity.datasetHash, 'Dataset identity mismatch.');
  check(receipt.id === figure.datasetId && receipt.contentHash === figure.datasetHash && receipt.approvedHash === figure.datasetHash && receipt.approvalState === 'APPROVED', 'Dataset approval receipt mismatch.');
  const { contentHash, ...profileDocument } = profile;
  check(hash(profileDocument) === contentHash && contentHash === figure.profileHash && contentHash === manifest.identity.profileHash, 'Profile identity mismatch.');
  check(figure.rendererVersion === manifest.identity.rendererVersion, 'Renderer identity mismatch.');
  if (dataset.rawInput) check(names.has('source.csv') && read('source.csv').equals(Buffer.from(dataset.rawInput.text)), 'Raw CSV source mismatch.');
  if(dataset.sourceCopy){
    check(hash(json('extraction/source-copy.json'))===hash(dataset.sourceCopy),'Extraction lineage mismatch.');
    const sourceName=`extraction/source.${dataset.sourceCopy.plan.format}`;
    check(names.has(sourceName)&&sha(read(sourceName))===dataset.sourceCopy.rawHash&&read(sourceName).equals(Buffer.from(dataset.sourceCopy.raw)),'Raw extraction source mismatch.');
    check(names.has('extraction/replay.cjs'),'Missing extraction replay implementation.');
    const {createRequire}=await import('node:module');
    const replay=createRequire(import.meta.url)(path.join(root,'extraction/replay.cjs'));
    const copied=replay.verifyDatasetExtraction(dataset);
    check(hash(copied)===hash(json('extraction/copied.json')),'Extraction output does not replay from source.');
  }
  if (figure.renderer === 'map') json('rendering/basemap.json');
  if (figure.geography) {
    const geometry = json('rendering/geometry.json'), geometryReceipt = json('rendering/geometry-receipt.json');
    check(hash(geometry) === figure.geography.layerHash && figure.geography.layerHash === manifest.identity.geometryHash, 'Geometry identity mismatch.');
    check(geometryReceipt.id === figure.geography.layerId && geometryReceipt.contentHash === figure.geography.layerHash && geometryReceipt.approvedHash === figure.geography.layerHash && geometryReceipt.approvalState === 'APPROVED', 'Geometry approval receipt mismatch.');
    // Independent join verification: selection is statistical, never regional aggregation.
    const rows = dataset.rows.filter(row => figure.filters.every(filter => {
      const value = row.values[filter.column];
      if (value === null || value === undefined) return false;
      if (filter.operator === 'equals') return value === filter.values[0];
      if (filter.operator === 'contains') return String(value).normalize('NFKC').toLowerCase().includes(String(filter.values[0]).normalize('NFKC').toLowerCase());
      return value >= filter.values[0] && value <= filter.values[1];
    }) && (!figure.channels.time || figure.timeValue === null || row.values[figure.channels.time] === figure.timeValue));
    const groups = new Map(), compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
    for (const row of rows) {
      const facet = figure.channels.facet ? row.values[figure.channels.facet] : null, key = JSON.stringify(facet);
      if (!groups.has(key)) groups.set(key, { facet, rows: [] }); groups.get(key).rows.push(row);
    }
    if (!groups.size) groups.set('empty', { facet: null, rows: [] });
    const mappings = new Map(Object.entries(figure.geography.mappings));
    const panels = [...groups.entries()].sort(([a], [b]) => compare(a, b)).map(([, group]) => {
      const buckets = new Map(geometry.features.map(f => [f.id, []])), unmatched = [];
      for (const target of mappings.values()) check(buckets.has(target), 'Unknown mapped geometry feature.');
      for (const row of group.rows) {
        const region = row.values[figure.channels.region], featureId = region === null || region === undefined ? null : mappings.get(String(region)) ?? String(region);
        if (featureId !== null && buckets.has(featureId)) buckets.get(featureId).push(row);
        else unmatched.push({ rowId: row.id, region: region ?? null, reason: featureId === null ? 'Missing region identifier' : `No exact geometry match for ${JSON.stringify(region)}` });
      }
      const regions = [...buckets.entries()].map(([featureId, source]) => {
        const value = source.length === 1 ? source[0].values[figure.channels.color] : null;
        return { featureId, rowIds: source.map(r => r.id).sort(), state: source.length === 0 ? 'no_observation' : source.length > 1 ? 'ambiguous' : typeof value === 'number' ? 'value' : 'missing', value: typeof value === 'number' ? value : null };
      }).sort((a, b) => compare(a.featureId, b.featureId));
      return { facet: group.facet, version: 'region-join-1', regions, unmatched: unmatched.sort((a, b) => compare(a.rowId, b.rowId)) };
    });
    check(hash(json('rendering/region-join.json')) === hash({ version: 'region-join-report-1', regionColumn: figure.channels.region, valueColumn: figure.channels.color, panels }), 'Region join report does not match source observations.');
    if (geometry.rawInput) check(names.has('rendering/source.geojson') && read('rendering/source.geojson').equals(Buffer.from(geometry.rawInput.text)), 'Original GeoJSON mismatch.');
  }
  if (figure.analysis) {
    const result = json('analysis/result.json'), provenance = json('analysis/manifest.json');
    const method = json('analysis/method.json'), inputs = json('analysis/inputs.json');
    check(hash(result) === figure.analysis.resultHash && figure.analysis.resultHash === manifest.identity.resultHash, 'Analysis result identity mismatch.');
    check(hash(provenance) === manifest.identity.analysisManifestHash && provenance.runId === result.runId, 'Analysis manifest mismatch.');
    check(provenance.outputs.some(output => output.sha256 === figure.analysis.resultHash), 'Result is absent from the analysis manifest.');
    check(hash(method) === figure.analysis.methodHash && hash(result.methodSpec) === figure.analysis.methodHash && result.methodId === figure.analysis.methodId, 'Method identity mismatch.');
    check(provenance.method.approvedHash === figure.analysis.methodHash && provenance.method.id === figure.analysis.methodId, 'Method approval receipt mismatch.');
    check(hash(inputs) === result.inputHash && hash(result.inputs) === result.inputHash && provenance.inputs.combinedHash === result.inputHash, 'Analysis inputs mismatch.');
    check(result.datasetHash === figure.datasetHash, 'Analysis dataset mismatch.');
    const columnNames = method.steps[0].primitive === 'describe' ? [figure.channels.y] : [figure.channels.x, figure.channels.y];
    const selection = { datasetHash: figure.datasetHash, columns: columnNames, filters: figure.filters, selectedIds: [...new Set(figure.selectedIds)].sort(), time: figure.channels.time, timeValue: figure.timeValue };
    check(method.assumptions.includes(`selection_sha256=${hash(selection)}`), 'Figure and method selections disagree.');
    const paperReferences = method.assumptions.filter(a => a.startsWith('paper_binding_sha256='));
    if (result.paperBinding || paperReferences.length) {
      const binding = json('research/paper-binding.json'), b = binding.body;
      check(hash(binding) === hash(result.paperBinding) && hash(b) === binding.hash, 'Paper context identity mismatch.');
      check(paperReferences.length === 1 && paperReferences[0] === `paper_binding_sha256=${binding.hash}`, 'Method does not pin the exact paper context.');
      const explicitCohort = b.version === 'paper-operation-2' && b.scope === 'selected_operation_explicit_cohort';
      check(binding.methodId === result.methodId && (explicitCohort || b.version === 'paper-operation-1' && b.scope === 'selected_operation_all_dataset_rows') && b.replicability === 'NOT_YET_ESTABLISHED' && b.originsVerified === false, 'Unsupported paper analysis scope.');
      check(b.datasetId === figure.datasetId && b.datasetHash === figure.datasetHash, 'Paper dataset mismatch.');
      check(hash(b.document.body) === b.document.hash, 'Paper document mismatch.');
      check(Number.isInteger(b.excerptCharacters) && b.excerptCharacters > 0 && b.excerptCharacters <= b.document.body.text.length, 'Invalid paper excerpt length.');
      const excerpt = b.document.body.text.slice(0, b.excerptCharacters), anchor = b.anchor;
      check(anchor.quote.length > 0 && sha(excerpt) === anchor.textHash && excerpt.indexOf(anchor.quote) === anchor.startUtf16 && anchor.endUtf16 === anchor.startUtf16 + anchor.quote.length && excerpt.indexOf(anchor.quote, anchor.startUtf16 + 1) === -1, 'Paper quote does not match its unique source span.');
      if (b.source.kind === 'assessment_operation') {
        const a = b.assessment, operation = a?.body?.assessment?.operations[b.source.operationIndex];
        check(a && a.id === b.source.assessmentId && a.hash === b.source.assessmentHash && hash(a.body) === a.hash && a.documentId === b.document.id && a.body.documentHash === b.document.hash && a.body.excerptHash === hash(excerpt) && a.body.excerptCharacters === b.excerptCharacters, 'Assessment source mismatch.');
        check(operation && operation.name === b.method && hash(operation.anchor) === hash(anchor), 'Assessment operation mismatch.');
        check(hash(b.otherOperations) === hash(a.body.assessment.operations.filter((_,i) => i !== b.source.operationIndex)) && hash(b.ambiguities) === hash(a.body.assessment.ambiguities), 'Omitted paper limitations.');
        check(hash(b.unboundRequirements) === hash(a.body.assessment.dataRequirements.filter(r => !b.bindings.some(v => v.requirementId === r.id))), 'Omitted unbound requirements.');
      } else check(b.source.kind === 'manual_quote' && b.source.documentId === b.document.id && b.source.documentHash === b.document.hash && b.source.quote === anchor.quote && b.excerptCharacters === b.document.body.text.length && b.assessment === null, 'Manual paper source mismatch.');
      const { contentHash: uiHash, ...uiProfile } = b.profile;
      check(hash(uiProfile) === uiHash, 'Paper UI profile mismatch.');
      check(['describe','pearson','spearman'].includes(b.method) && method.steps.length === 1 && method.steps[0].primitive === b.method && method.steps[0].missingPolicy === b.missingPolicy, 'Paper operation or missing policy mismatch.');
      check(figure.filters.length === 0 && figure.channels.time === null && figure.timeValue === null, 'Paper cohorts cannot add unrecorded filters or time selections.');
      let paperRows = dataset.rows;
      if (explicitCohort) {
        const cohort = b.cohort, ids = cohort?.rowIds, sourceIds = new Set(dataset.rows.map(r => r.id));
        check(cohort?.version === 'paper-cohort-1' && cohort.interpretation === 'USER_DECLARED_EXPLORATORY_COHORT' && Array.isArray(ids) && ids.length > 0 && new Set(ids).size === ids.length && ids.every(id => sourceIds.has(id)) && hash(ids) === hash([...ids].sort()) && cohort.sourceRowCount === dataset.rows.length && typeof cohort.rationale === 'string' && cohort.rationale.trim().length > 0, 'Invalid explicit paper cohort.');
        const a = cohort.anchor;
        check(a && typeof a.quote === 'string' && a.quote.length > 0 && sha(excerpt) === a.textHash && excerpt.indexOf(a.quote) === a.startUtf16 && a.endUtf16 === a.startUtf16 + a.quote.length && excerpt.indexOf(a.quote, a.startUtf16 + 1) === -1, 'Cohort quote does not match its unique source span.');
        check(hash(figure.selectedIds) === hash(ids), 'Paper cohort and figure selection disagree.');
        const selected = new Set(ids);
        paperRows = dataset.rows.filter(r => selected.has(r.id));
      } else check(figure.selectedIds.length === 0 && !('cohort' in b), 'Paper scope requires all dataset rows.');
      check(b.bindings.length === columnNames.length && inputs.length === b.bindings.length, 'Paper input count mismatch.');
      const rawHash = dataset.sourceCopy?.rawHash ?? (dataset.rawInput ? sha(dataset.rawInput.text) : null);
      for (let i=0; i<b.bindings.length; i++) {
        const v=b.bindings[i], column=dataset.columns.find(c=>c.key===v.column), input=inputs[i];
        check(v.role === (i===0?'a':'b') && v.column === columnNames[i] && column && hash(column) === hash(v.columnDefinition), 'Paper column binding mismatch.');
        check(input.name === v.role && input.unit === column.unit && input.semanticType === column.semanticType && hash(input.entityIds) === hash(paperRows.map(r=>r.id)) && hash(input.values) === hash(paperRows.map(r=>r.values[v.column])), 'Paper inputs do not reproduce the declared source columns.');
        if (v.substitution) {
          const sub=v.substitution;
          check(hash(sub.body) === sub.hash && sub.body.assessmentId === b.assessment?.id && sub.body.assessmentHash === b.assessment?.hash && sub.body.requirementId === v.requirementId && sub.body.kind === v.origin, 'Paper substitution mismatch.');
          check(v.sourceFileVerified === !!sub.body.sourceHash && (!sub.body.sourceHash || sub.body.sourceHash === rawHash), 'Substitution raw file hash mismatch.');
        }
      }
      const origins=b.bindings.map(v=>v.origin);
      const meaning=origins.includes('synthetic_scenario')?'SIMULATION_NOT_EMPIRICAL_EVIDENCE':origins.every(o=>o==='original_data_reuse')?'REANALYSIS_NOT_INDEPENDENT_REPLICATION':origins.some(o=>['prior_dataset','proxy_measure','new_expert_panel'].includes(o))?'EXPLORATORY_METHOD_VARIANT':'SCOPED_ANALYSIS_NOT_REPLICATION';
      check(b.meaning === meaning && hash(b.evidenceTiers) === hash([...new Set(paperRows.map(r=>r.evidenceTier))]), 'Paper interpretation or evidence tiers changed.');
    } else check(!names.has('research/paper-binding.json'), 'Unexpected paper context.');
    if (result.paperComparison) {
      check(manifest.version === 'watchdog-research-package-2', 'Comparison requires research package version 2.');
      check(names.has('COMPARISON.md'), 'Missing comparison scope and verification limitations.');
      const comparison = json('research/comparison.json');
      check(hash(comparison) === hash(result.paperComparison), 'Comparison differs from immutable analysis result.');
      verifyComparison(comparison, result, json('research/paper-binding.json'), provenance, manifest.identity, selection, receipt);
    } else check(manifest.version === 'watchdog-research-package-1' && !names.has('research/comparison.json') && !('comparisonHash' in manifest.identity) && !('comparisonCoreHash' in manifest.identity) && !('comparisonAttemptId' in manifest.identity), 'Unexpected comparison reference.');

  } else check(manifest.version === 'watchdog-research-package-1' && !names.has('research/comparison.json') && !('comparisonHash' in manifest.identity) && !('comparisonCoreHash' in manifest.identity) && !('comparisonAttemptId' in manifest.identity) && manifest.identity.resultHash === null && manifest.identity.analysisManifestHash === null, 'Unexpected analysis reference.');
  console.log(`Verified ${names.size} files and linked figure/data/profile/geometry/analysis identities.\nPackage manifest SHA-256: ${packageHash}`);
  console.log(process.argv[3] ? 'Matches the independently supplied manifest hash.' : 'No independent hash supplied: internal consistency checked, not authorship.');
  if (manifest.version === 'watchdog-research-package-2') console.log('Comparison scalar/tolerance arithmetic and recorded ordering checked. No whole-paper replication, independent confirmation, reviewer authentication or trustworthy clock is established. External prior exposure is unknown.');
  console.log('Approval receipts describe the export snapshot; they do not grant access or establish current approval. Statistics were not rerun.');
} catch (error) { console.error(`Verification failed: ${error.message}`); process.exitCode = 1; }
