import { test } from 'node:test';
import * as assert from 'node:assert';
import { sourceRegistry } from '../../backend/watchdog_api/sources/registry';
import { NotImplementedError } from '../../backend/watchdog_api/utils/errors';
import { pearson, spearman, calculateRatio } from '../../backend/watchdog_api/analytics/stats';

// Required from E0.2 (docs/spec/07_EPICS_AND_TASKS.md) and 09_TESTS.md's
// "Anti-fabrication test": a planned/blocked capability must throw rather
// than silently returning a plausible-looking result, and a scientific
// function must never return a value that ignores its inputs.

test('Anti-fabrication: every non-executable source throws NotImplementedError, not a value', () => {
  const registeredIds = ['offline_fixture', 'serp_generic', 'google_trends', 'pubchem', 'scientific_literature', 'erowid', 'drug_checking', 'manual_dataset'];
  let sawAtLeastOnePlannedOrBlocked = false;

  for (const id of registeredIds) {
    const entry = sourceRegistry.getEntry(id);
    assert.ok(entry, `source '${id}' must be registered`);

    if (entry!.status === 'implemented' || entry!.status === 'fixture') {
      // Must actually return a working adapter, not throw.
      assert.doesNotThrow(() => sourceRegistry.getAdapter(id));
    } else {
      sawAtLeastOnePlannedOrBlocked = true;
      assert.throws(() => sourceRegistry.getAdapter(id), NotImplementedError,
        `'${id}' has status '${entry!.status}' and must throw NotImplementedError, not return an adapter`);
    }
  }

  assert.ok(sawAtLeastOnePlannedOrBlocked, 'test fixture assumption: at least one registered source must be non-executable');
});

test('Anti-fabrication: pearson/spearman depend on their inputs, never a constant', () => {
  const x = [1, 2, 3, 4, 5];
  const yStrongPositive = [2, 4, 6, 8, 10];
  const yStrongNegative = [10, 8, 6, 4, 2];
  const yNoRelation = [3, 1, 4, 1, 5];

  const pPos = pearson(x, yStrongPositive);
  const pNeg = pearson(x, yStrongNegative);
  const pMixed = pearson(x, yNoRelation);

  assert.notStrictEqual(pPos, pNeg, 'pearson must vary with its inputs, not return a fixed value');
  assert.notStrictEqual(pPos, pMixed);

  const sPos = spearman(x, yStrongPositive);
  const sNeg = spearman(x, yStrongNegative);
  assert.notStrictEqual(sPos, sNeg, 'spearman must vary with its inputs, not return a fixed value');

  // Zero-variance denominator is undefined, and must surface as null, never as a fabricated 0.
  const constant = [5, 5, 5, 5, 5];
  assert.strictEqual(pearson(x, constant), null);
  assert.strictEqual(spearman(x, constant), null);
});

test('Anti-fabrication: calculateRatio never divides by a non-positive denominator', () => {
  assert.strictEqual(calculateRatio(50, 100, true), 50);
  // Ni <= 0 must be undefined (null), never a fabricated 0 or Infinity.
  assert.strictEqual(calculateRatio(50, 0, true), null);
  assert.strictEqual(calculateRatio(50, -3, true), null);
});
