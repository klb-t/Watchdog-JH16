import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { canonicalHash } from '../domain/canonical';

const Identity = z.object({ id: z.string().min(1), version: z.string().min(1) }).strict();
const Recipe = Identity.extend({
  locale: z.string().min(1),
  metrics: z.object({ primary: z.string().min(1), secondary: z.string().min(1) }).strict(),
  ranking: z.object({ metricKey: z.string().min(1), direction: z.enum(['ascending', 'descending']),
    topK: z.number().int().nonnegative().nullable(), tieBreak: z.enum(['input_order', 'entity_id']) }).strict(),
  text: z.object({ completed: z.string(), preset: z.string(), counts: z.string(), missing: z.string(),
    noMissing: z.string(), ranking: z.string(), qualityFlags: z.string(), equivalence: z.string() }).strict(),
  formatting: z.object({ lineSeparator: z.string(), listSeparator: z.string() }).strict(),
  provider: z.object({ system: z.string().min(1), prompt: z.string().min(1) }).strict(),
}).strict();
const Catalog = z.object({ schemaVersion: z.literal('watchdog.narrative_catalog/1'),
  defaultTemplate: Identity, templates: z.array(Recipe).min(1) }).strict();
export type NarrativeRecipe = z.infer<typeof Recipe>;
export type NarrativeCatalog = ReturnType<typeof validateNarrativeCatalog>;
export class NarrativeTemplateError extends Error {
  readonly code = 'validation_error';
  constructor(message: string) { super(message); this.name = 'NarrativeTemplateError'; }
}
const allowedBindings = {
  completed: ['preset'], preset: ['presetId'], counts: ['primaryCount', 'secondaryCount'],
  missing: ['missingCount'], noMissing: [], ranking: ['entities'], qualityFlags: ['qualityFlags'], equivalence: [],
};
function bindings(value: string): string[] {
  const names = [...value.matchAll(/\{\{([A-Za-z][A-Za-z0-9]*)\}\}/g)].map(match => match[1]);
  if (value.replace(/\{\{([A-Za-z][A-Za-z0-9]*)\}\}/g, '').includes('{{'))
    throw new NarrativeTemplateError('Malformed narrative template binding');
  return names;
}
export function validateNarrativeCatalog(input: unknown) {
  const catalog = Catalog.parse(input);
  const identities = new Set<string>();
  for (const recipe of catalog.templates) {
    const identity = JSON.stringify([recipe.id, recipe.version]);
    if (identities.has(identity)) throw new NarrativeTemplateError('Duplicate narrative template identity');
    identities.add(identity);
    for (const [key, value] of Object.entries(recipe.text))
      if (bindings(value).some(name => !allowedBindings[key].includes(name)))
        throw new NarrativeTemplateError(`Unsupported narrative binding in text.${key}`);
    if (bindings(recipe.provider.system).length || bindings(recipe.provider.prompt).some(name => name !== 'summary')
      || !bindings(recipe.provider.prompt).includes('summary'))
      throw new NarrativeTemplateError('Provider narrative prompt requires only the summary binding');
  }
  if (!identities.has(JSON.stringify([catalog.defaultTemplate.id, catalog.defaultTemplate.version])))
    throw new NarrativeTemplateError('Default narrative template does not exist');
  return { ...catalog, contentHash: canonicalHash(catalog) };
}
export function loadNarrativeCatalog(filename = path.join(process.cwd(), 'config/narratives.json')) {
  return validateNarrativeCatalog(JSON.parse(readFileSync(filename, 'utf8')));
}
export function selectNarrativeRecipe(catalog: NarrativeCatalog, selection: { templateId?: unknown; templateVersion?: unknown }) {
  const identity = selection.templateId === undefined && selection.templateVersion === undefined
    ? catalog.defaultTemplate : Identity.parse({ id: selection.templateId, version: selection.templateVersion });
  const recipe = catalog.templates.find(row => row.id === identity.id && row.version === identity.version);
  if (!recipe) throw new NarrativeTemplateError(`Unknown narrative template ${identity.id}@${identity.version}`);
  return recipe;
}
/** Inert one-pass interpolation; source values are never reparsed as templates. */
export function renderNarrativeText(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{\{([A-Za-z][A-Za-z0-9]*)\}\}/g, (_whole, name: string) => {
    if (!Object.hasOwn(values, name)) throw new NarrativeTemplateError(`Missing narrative binding ${name}`);
    return String(values[name]);
  });
}
