import { z } from 'zod';
import { LANGUAGE_CODES, type Language } from './languages';
import baseData from '../config/workspace-navigation.json';
import preferenceData from '../config/workspace-preferences.json';
import { WorkspaceNavigationSchema, type WorkspaceNavigation } from './workspace_navigation';

export const workspaceBase = WorkspaceNavigationSchema.parse(baseData);
const label = z.object({pl:z.string().min(1),en:z.string().min(1),nl:z.string().min(1)}).strict();
// Polish view labels live in workspace-navigation.json; the other languages are here.
const viewLabels = z.object({en:z.string().min(1),nl:z.string().min(1)}).strict();
const utility = z.object({settings:z.string(),diagnostics:z.string(),access:z.string()}).strict();
const path = z.string().regex(/^\/(?:[a-z]+(?:-[a-z]+)*)?$/);
export const WorkspacePreferencesSchema = z.object({
  version:z.literal('workspace-preferences-2'), default_preset:z.string(), default_language:z.enum(LANGUAGE_CODES),
  views:z.record(path,z.object({label:viewLabels,advanced:z.boolean()}).strict()),
  presets:z.record(z.string(),z.object({label,groups:z.record(z.string(),z.object({label,routes:z.array(path).min(1)}).strict())}).strict()),
  landings:z.record(path,z.string()), utility:z.object({en:utility,nl:utility}).strict(),
  strings:z.object({pl:z.record(z.string(),z.string()),en:z.record(z.string(),z.string()),nl:z.record(z.string(),z.string())}).strict(),
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
  for (const lang of LANGUAGE_CODES) if (Object.keys(v.strings.pl).sort().join()!==Object.keys(v.strings[lang]).sort().join()) c.addIssue({code:'custom',message:`Every language needs the same keys (${lang})`});
});
export const workspacePreferences=WorkspacePreferencesSchema.parse(preferenceData);
export type WorkspaceLanguage=Language;

/** One route/capability registry; presets only regroup and translate it. */
export function resolveWorkspace(preset:string,lang:WorkspaceLanguage):WorkspaceNavigation {
  const selected=workspacePreferences.presets[preset];
  if (!selected) throw new Error('Unknown workspace preset');
  const views=new Map(workspaceBase.groups.flatMap(g=>g.views.map(v=>[v.href,v] as const)));
  return {...workspaceBase,labels:{...workspaceBase.labels,...(lang==='pl'?{}:workspacePreferences.utility[lang])},
    groups:workspaceBase.groups.map(g=>({...g,label:selected.groups[g.id].label[lang],
      views:selected.groups[g.id].routes.map(href=>({...views.get(href)!,label:lang==='pl'?views.get(href)!.label:workspacePreferences.views[href].label[lang]}))}))};
}
