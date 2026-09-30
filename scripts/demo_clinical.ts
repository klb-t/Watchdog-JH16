/** A closed fixture demonstration. No case-file import, HTTP, persistent case
 * storage, medical thresholds or treatment actions are exposed by this command. */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalHash, canonicalizeJson } from '../backend/watchdog_api/domain/canonical';
import { CLINICAL_EXECUTOR_FILES, buildExecutorManifest } from '../backend/watchdog_api/clinical_demo/executor_manifest';
import { executeClinicalDemo, replayClinicalDemoArchive, type ClinicalExecutionInput } from '../backend/watchdog_api/clinical_demo/executor';
import { createDemoTestProfile } from '../shared/clinical_demo_profile';
import { selectClinicalMeasurements } from '../shared/clinical_demo_selector';
import { testClinicalCase, testClinicalCaseB, testClinicalRule, testClinicalRuleReview,
  testClinicalSourceState } from '../tests/helpers/clinical_demo';

const root = fileURLToPath(new URL('../', import.meta.url));
export function runClinicalDemo(fixtureId = 'fixture:case-b', availability = 'available') {
  if (!['fixture:case-a', 'fixture:case-b'].includes(fixtureId)
    || !['available', 'unavailable'].includes(availability))
    throw new Error('Choose a bundled fixture (fixture:case-a|fixture:case-b) and profile (available|unavailable). Case/profile JSON import is not supported.');
  const manifest = buildExecutorManifest(Object.fromEntries(CLINICAL_EXECUTOR_FILES.map(path =>
    [path, readFileSync(resolve(root, path), 'utf8')])), process.version);
  const rule = testClinicalRule();
  const input: ClinicalExecutionInput = {
    case: fixtureId === 'fixture:case-a' ? testClinicalCase() : testClinicalCaseB(),
    rules: [rule], sources: [testClinicalSourceState()], reviews: [testClinicalRuleReview(rule)], executorManifest: manifest,
  };
  const execution = executeClinicalDemo(input);
  const access = { caseHash: execution.trace.caseHash, caseReadable: true,
    readableReferenceHashes: input.sources.map(source => canonicalHash(source.document)),
    readableRuleHashes: input.rules.map(item => canonicalHash(item)) };
  const historicalReplay = replayClinicalDemoArchive(execution.archive, access, manifest);
  const profile = createDemoTestProfile(availability as 'available' | 'unavailable');
  const selection = selectClinicalMeasurements(input, profile);
  const previousTrace = canonicalizeJson(execution.trace);
  const revoked = structuredClone(input);
  revoked.sources[0].status = 'revoked';
  revoked.sources[0].approvedHash = null;
  const afterRevocation = executeClinicalDemo(revoked);
  // Pin the selector and demonstration recipe separately, so a presentation or
  // availability implementation change need not invalidate the core replay.
  const recipe = {
    version: 'clinical-demo-recipe-1', executorHash: manifest.hash,
    files: ['scripts/demo_clinical.ts', 'shared/clinical_demo_profile.ts',
      'shared/clinical_demo_selector.ts', 'tests/helpers/clinical_demo.ts'].map(path => ({ path,
      sha256: createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex') })),
  };
  const report = {
    version: 'clinical-demo-report-1', purpose: 'software-demonstration',
    label: 'FICTIONAL SOFTWARE DEMONSTRATION — no clinical usefulness, medical approval or treatment advice is claimed.',
    fixtureId, availability,
    meaning: 'A missing measurement proposal does not create a measurement or place an order. All numbers, units, sources and reviews are fictional fixtures.',
    recipe, recipeHash: canonicalHash(recipe), execution, historicalReplay, profile, selection,
    revocationProbe: {
      trace: afterRevocation.trace, traceHash: afterRevocation.traceHash,
      earlierTraceUnchanged: previousTrace === canonicalizeJson(execution.trace),
      historicalReplayAfterRevocation: replayClinicalDemoArchive(execution.archive, access, manifest),
    },
  };
  return { ...report, reportHash: canonicalHash(report) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write('Usage: node --import tsx scripts/demo_clinical.ts [fixture:case-a|fixture:case-b] [available|unavailable]\nClosed synthetic fixtures only; JSON goes to stdout. No case-file import or persistent writes.\n');
  } else {
    if (args.length > 2) throw new Error('Expected at most a bundled fixture ID and an availability profile.');
    process.stdout.write(canonicalizeJson(runClinicalDemo(args[0], args[1])) + '\n');
  }
}
