import { test } from 'node:test';
import * as assert from 'node:assert';
import { ConfigLoader } from '../../backend/watchdog_api/config/loader';
import { hashConfig, canonicalizeJson } from '../../backend/watchdog_api/config/canonicalize';

test('Config canonicalization and stable hash', () => {
  const obj1 = { b: 2, a: 1, c: [3, 2, 1] };
  const obj2 = { a: 1, c: [3, 2, 1], b: 2 };
  
  assert.strictEqual(canonicalizeJson(obj1), canonicalizeJson(obj2), "Order of keys should not affect canonical json");
  assert.strictEqual(hashConfig(obj1), hashConfig(obj2), "Hashes should match");
});

test('Config precedence and lock enforcement', () => {
  const loader = new ConfigLoader({
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
