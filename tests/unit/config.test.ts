import { test } from 'node:test';
import * as assert from 'node:assert';
import { ConfigLoader } from '../../backend/watchdog_api/config/loader';
import { hashConfig, canonicalizeJson } from '../../backend/watchdog_api/config/canonicalize';
import { ConfigValidationError, ConfigIssue } from '../../backend/watchdog_api/utils/errors';

test('Config canonicalization and stable hash', () => {
  const obj1 = { b: 2, a: 1, c: [3, 2, 1] };
  const obj2 = { a: 1, c: [3, 2, 1], b: 2 };
  
  assert.strictEqual(canonicalizeJson(obj1), canonicalizeJson(obj2), "Order of keys should not affect canonical json");
  assert.strictEqual(hashConfig(obj1), hashConfig(obj2), "Hashes should match");
});

test('Config precedence and lock enforcement', () => {
  const loader = new ConfigLoader({
    // schema_version is required at every level as of E1.1; this fixture
    // previously relied on the silent default that has since been removed.
    schema_version: "1.0",
    analysis_presets: {
      "jh16-faithful": {
        schema_version: "1.0",
        preset_id: "jh16-faithful",
        locked: true,
        entities: ["alcohol"],
        query_templates: { popularity: "pop", harm: "harm" },
        missing_data_policy: "error"
      },
      "jh16-enhanced": {
        schema_version: "1.0",
        preset_id: "jh16-enhanced",
        locked: false,
        entities: ["alcohol"],
        query_templates: { popularity: "pop", harm: "harm" },
        missing_data_policy: "error"
      }
    }
  });

  const result = loader.loadEffectiveConfig({}, {}, {}, {
    analysis_presets: {
      "jh16-enhanced": {
        entities: ["alcohol", "cannabis"]
      }
    }
  });
  assert.deepStrictEqual(result.config.analysis_presets["jh16-enhanced"].entities, ["alcohol", "cannabis"]);

  assert.throws(() => {
    loader.loadEffectiveConfig({}, {}, {}, {
      analysis_presets: {
        "jh16-faithful": {
          entities: ["alcohol", "cannabis"]
        }
      }
    });
  }, /Cannot override locked preset/);
});

test('Config schema validation fails fast', () => {
  const loader = new ConfigLoader();
  assert.throws(() => {
    loader.loadEffectiveConfig({}, {}, {}, {
      diagnostics_mode: "INVALID_MODE"
    });
  });
});

// E1.1 clause 2: "an invalid config fails with a precise message".
// 01_ARCHITECTURE.md §Configuration requires the failing path and the schema
// rule, not merely that something threw.
test('Config validation reports the failing path and the schema rule', () => {
  const loader = new ConfigLoader({ schema_version: "1.0" });

  try {
    loader.loadEffectiveConfig({}, {}, {}, {
      diagnostics_mode: "INVALID_MODE"
    });
    assert.fail('expected invalid diagnostics_mode to be rejected');
  } catch (err: any) {
    assert.ok(err instanceof ConfigValidationError, 'must be a ConfigValidationError');
    assert.strictEqual(err.code, 'validation_error', 'stable machine-readable code from the taxonomy');

    const issue = err.issues.find((i: ConfigIssue) => i.path === 'diagnostics_mode');
    assert.ok(issue, `expected an issue at path 'diagnostics_mode', got: ${JSON.stringify(err.issues)}`);
    assert.ok(issue!.rule.length > 0, 'the violated schema rule is named');

    // The human-readable message must locate the failure, not just assert one.
    assert.match(err.message, /diagnostics_mode/);
  }
});

// E1.1 clause 3: "a missing required field never silently defaults".
test('Config rejects a missing required field rather than defaulting it', () => {
  const loader = new ConfigLoader();

  // An entirely empty config used to be accepted, silently inventing
  // schema_version: "1.0" — validating and hashing a config as though it were
  // a schema version it never declared.
  assert.throws(
    () => loader.loadEffectiveConfig({}, {}, {}, {}),
    (err: any) => err instanceof ConfigValidationError
      && err.issues.some((i: ConfigIssue) => i.path === 'schema_version'),
    'a config with no schema_version must fail, not default'
  );

  // Same rule one level down: a preset missing schema_version is rejected...
  assert.throws(
    () => loader.loadEffectiveConfig({}, {}, {}, {
      schema_version: "1.0",
      analysis_presets: {
        "p": { preset_id: "p", locked: false, entities: ["alcohol"], query_templates: { popularity: "q" } }
      }
    }),
    (err: any) => err instanceof ConfigValidationError
      && err.issues.some((i: ConfigIssue) => i.path === 'analysis_presets.p.schema_version'),
    'a preset with no schema_version must fail, not default'
  );

  // ...and so is a preset that does not declare whether it is locked, because
  // defaulting that to false fails open on a locked scientific preset.
  assert.throws(
    () => loader.loadEffectiveConfig({}, {}, {}, {
      schema_version: "1.0",
      analysis_presets: {
        "p": { schema_version: "1.0", preset_id: "p", entities: ["alcohol"], query_templates: { popularity: "q" } }
      }
    }),
    (err: any) => err instanceof ConfigValidationError
      && err.issues.some((i: ConfigIssue) => i.path === 'analysis_presets.p.locked'),
    'a preset that does not declare `locked` must fail, not default to unlocked'
  );

  // A genuinely optional field still defaults: absence is unambiguous here.
  const ok = loader.loadEffectiveConfig({}, {}, {}, { schema_version: "1.0" });
  assert.strictEqual(ok.config.diagnostics_mode, 'NORMAL');
  assert.deepStrictEqual(ok.config.sources, {});
});
