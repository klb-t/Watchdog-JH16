import { AppConfigSchema, AnalysisPresetSchema } from './schemas';
import { hashConfig } from './canonicalize';

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

    const validated = AppConfigSchema.parse(finalConfig);
    const hash = hashConfig(validated);

    return {
      config: validated,
      hash
    };
  }
}
