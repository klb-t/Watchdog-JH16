import { z } from 'zod';
import { LANGUAGE_CODES, type Language } from './languages';

/**
 * Interface texts as configuration (hard rule 3). Every page keeps its texts in
 * `config/ui/<page>.json` with the same shape as `config/access/ui.json`:
 * `{ version, languages: { pl: {key: text}, en: {key: text} } }`. Both languages
 * carry exactly the same keys and the same `{placeholders}`, so a switch can never
 * reveal a missing text or drop a value.
 */
export const UI_LANGUAGES = LANGUAGE_CODES;
export type UiLanguage = Language;

export const textPlaceholders = (s: string) => [...s.matchAll(/\{([a-z0-9_]+)\}/g)].map(m => m[1]).sort();
// A key is lower case; a key built from a stored code (`status_COMPLETED`, see `tCode`) keeps the code's case after its prefix.
const texts = z.record(z.string().regex(/^[a-z][a-z0-9_]*[A-Za-z0-9_]*$/), z.string().min(1));

export const UiBundleSchema = z.object({
  version: z.string().regex(/^ui-[a-z0-9-]+-\d+$/),
  _note: z.string().optional(),
  languages: z.object({ pl: texts, en: texts, nl: texts }).strict(),
}).strict().superRefine((b, ctx) => {
  // Polish is the reference: every other language has exactly its keys and, per key, its placeholders.
  const ref = b.languages.pl;
  for (const lang of LANGUAGE_CODES.filter(l => l !== 'pl')) {
    const other = b.languages[lang];
    for (const k of Object.keys(ref)) if (!(k in other)) ctx.addIssue({ code: 'custom', message: `key '${k}' missing in ${lang}` });
    for (const k of Object.keys(other)) if (!(k in ref)) ctx.addIssue({ code: 'custom', message: `key '${k}' missing in pl` });
    for (const k of Object.keys(ref)) if (k in other && textPlaceholders(ref[k]).join() !== textPlaceholders(other[k]).join())
      ctx.addIssue({ code: 'custom', message: `key '${k}' has different placeholders in pl and ${lang}` });
  }
});
export type UiBundle = { version: string; languages: Record<Language, Record<string, string>> };

/** Fills `{name}` placeholders; an unknown key shows the key itself so a gap is visible, never blank. */
export function fillText(bundle: UiBundle, lang: UiLanguage, key: string, vars: Record<string, string | number> = {}): string {
  const template = bundle.languages[lang][key] ?? bundle.languages.en[key] ?? key;
  return template.replace(/\{([a-z0-9_]+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}
