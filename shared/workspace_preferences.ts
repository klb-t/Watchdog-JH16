import { z } from 'zod';
import baseData from '../config/workspace-navigation.json';
import preferenceData from '../config/workspace-preferences.json';
import { WorkspaceNavigationSchema, type WorkspaceNavigation } from './workspace_navigation';

export const workspaceBase = WorkspaceNavigationSchema.parse(baseData);
const label = z.object({pl:z.string().min(1),en:z.string().min(1)}).strict();
const path = z.string().regex(/^\/(?:[a-z]+(?:-[a-z]+)*)?$/);
export const WorkspacePreferencesSchema = z.object({
  version:z.literal('workspace-preferences-1'), default_preset:z.string(), default_language:z.enum(['pl','en']),
  views:z.record(path,z.object({en:z.string().min(1),advanced:z.boolean()}).strict()),
  presets:z.record(z.string(),z.object({label,groups:z.record(z.string(),z.object({label,routes:z.array(path).min(1)}).strict())}).strict()),
  landings:z.record(path,z.string()), utility_en:z.object({settings:z.string(),diagnostics:z.string(),access:z.string()}).strict(),
  strings:z.object({pl:z.record(z.string(),z.string()),en:z.record(z.string(),z.string())}).strict(),
}).strict().superRefine((v,c)=>{
  const routes=workspaceBase.groups.flatMap(g=>g.views.map(x=>x.href)).sort();
  const ids=workspaceBase.groups.map(g=>g.id).sort();
  if (!v.presets[v.default_preset]) c.addIssue({code:'custom',message:'Unknown default preset'});
  if (JSON.stringify(Object.keys(v.views).sort())!==JSON.stringify(routes)) c.addIssue({code:'custom',message:'Translations must cover every view exactly'});
  for (const preset of Object.values(v.presets)) {
    if (JSON.stringify(Object.keys(preset.groups).sort())!==JSON.stringify(ids)) c.addIssue({code:'custom',message:'Preserve seven workspace groups'});
    if (JSON.stringify(Object.values(preset.groups).flatMap(g=>g.routes).sort())!==JSON.stringify(routes)) c.addIssue({code:'custom',message:'Every preset must preserve all views exactly once'});
  }
  for (const [url,id] of Object.entries(v.landings)) if (routes.includes(url)||!ids.includes(id as any)) c.addIssue({code:'custom',message:'Landing collides with an existing view or unknown group'});
  if (Object.keys(v.strings.pl).sort().join()!==Object.keys(v.strings.en).sort().join()) c.addIssue({code:'custom',message:'Both languages need identical keys'});
});
export const workspacePreferences=WorkspacePreferencesSchema.parse(preferenceData);
export type WorkspaceLanguage='pl'|'en';

/** One route/capability registry; presets only regroup and translate it. */
export function resolveWorkspace(preset:string,lang:WorkspaceLanguage):WorkspaceNavigation {
  const selected=workspacePreferences.presets[preset];
  if (!selected) throw new Error('Unknown workspace preset');
  const views=new Map(workspaceBase.groups.flatMap(g=>g.views.map(v=>[v.href,v] as const)));
  return {...workspaceBase,labels:{...workspaceBase.labels,...(lang==='en'?workspacePreferences.utility_en:{})},
    groups:workspaceBase.groups.map(g=>({...g,label:selected.groups[g.id].label[lang],
      views:selected.groups[g.id].routes.map(href=>({...views.get(href)!,label:lang==='pl'?views.get(href)!.label:workspacePreferences.views[href].en}))}))};
}
