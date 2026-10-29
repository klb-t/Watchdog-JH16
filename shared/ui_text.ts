import { z } from 'zod';

/**
 * Interface texts as configuration (hard rule 3). Every page keeps its texts in
 * `config/ui/<page>.json` with the same shape as `config/access/ui.json`:
 * `{ version, languages: { pl: {key: text}, en: {key: text} } }`. Both languages
 * carry exactly the same keys and the same `{placeholders}`, so a switch can never
 * reveal a missing text or drop a value.
 */
export const UI_LANGUAGES = ['pl', 'en'] as const;
export type UiLanguage = (typeof UI_LANGUAGES)[number];

export const textPlaceholders = (s: string) => [...s.matchAll(/\{([a-z0-9_]+)\}/g)].map(m => m[1]).sort();
const texts = z.record(z.string().regex(/^[a-z0-9_]+$/), z.string().min(1));

export const UiBundleSchema = z.object({
  version: z.string().regex(/^ui-[a-z0-9-]+-\d+$/),
  _note: z.string().optional(),
  languages: z.object({ pl: texts, en: texts }).strict(),
}).strict().superRefine((b, ctx) => {
  const pl = Object.keys(b.languages.pl), en = Object.keys(b.languages.en);
  for (const k of pl) if (!(k in b.languages.en)) ctx.addIssue({ code: 'custom', message: `key '${k}' missing in en` });
  for (const k of en) if (!(k in b.languages.pl)) ctx.addIssue({ code: 'custom', message: `key '${k}' missing in pl` });
  for (const k of pl) if (k in b.languages.en && textPlaceholders(b.languages.pl[k]).join() !== textPlaceholders(b.languages.en[k]).join())
    ctx.addIssue({ code: 'custom', message: `key '${k}' has different placeholders in pl and en` });
});
export type UiBundle = { version: string; languages: { pl: Record<string, string>; en: Record<string, string> } };

/** Fills `{name}` placeholders; an unknown key shows the key itself so a gap is visible, never blank. */
export function fillText(bundle: UiBundle, lang: UiLanguage, key: string, vars: Record<string, string | number> = {}): string {
  const template = bundle.languages[lang][key] ?? bundle.languages.en[key] ?? key;
  return template.replace(/\{([a-z0-9_]+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}
