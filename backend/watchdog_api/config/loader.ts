import { ZodError } from 'zod';
import { AppConfigSchema } from './schemas';
import { hashConfig } from './canonicalize';
import { ConfigValidationError, ConfigIssue } from '../utils/errors';

function isObject(item: any) {
  return (item && typeof item === 'object' && !Array.isArray(item));
}

function mergeDeep(target: any, ...sources: any[]): any {
  if (!sources.length) return target;
  const source = sources.shift();

  if (isObject(target) && isObject(source)) {
    for (const key in source) {
      if (isObject(source[key])) {
        if (!target[key]) Object.assign(target, { [key]: {} });
        mergeDeep(target[key], source[key]);
      } else {
        Object.assign(target, { [key]: source[key] });
      }
    }
  }
  return mergeDeep(target, ...sources);
}

/**
 * Validates an effective configuration, translating Zod's issue list into the
 * failing path and schema rule that 01_ARCHITECTURE.md §Configuration requires.
 */
export function validateConfig(candidate: unknown) {
  try {
    return AppConfigSchema.parse(candidate);
  } catch (err) {
    if (err instanceof ZodError) {
      const issues: ConfigIssue[] = err.issues.map(issue => ({
        path: issue.path.length > 0 ? issue.path.join('.') : '<root>',
        rule: issue.code,
        message: issue.message
      }));
      throw new ConfigValidationError(issues);
    }
    throw err;
  }
}

export class ConfigLoader {
  private baseConfig: any = {};
  
  constructor(builtInDefaults: any = {}) {
    this.baseConfig = builtInDefaults;
  }

  public loadEffectiveConfig(deploymentOverrides: any = {}, orgOverrides: any = {}, userOverrides: any = {}, runOverrides: any = {}) {
    const upToUser = mergeDeep({}, this.baseConfig, deploymentOverrides, orgOverrides, userOverrides);
    
    const finalConfig = mergeDeep({}, upToUser, runOverrides);
    
    if (upToUser.analysis_presets) {
      for (const [presetId, preset] of Object.entries(upToUser.analysis_presets)) {
        if ((preset as any).locked && runOverrides?.analysis_presets?.[presetId]) {
           throw new Error(`Cannot override locked preset: ${presetId}`);
        }
      }
    }

    const validated = validateConfig(finalConfig);
    const hash = hashConfig(validated);

    return {
      config: validated,
      hash
    };
  }
}
