import { z } from 'zod';
import data from '../config/languages.json';

/**
 * The interface languages (config/languages.json). The code list is also a TypeScript type so a
 * bundle missing a language fails `tsc`; `tests/unit/ui_text.test.ts` checks the two agree.
 */
export const LANGUAGE_CODES = ['pl', 'en', 'nl'] as const;
export type Language = (typeof LANGUAGE_CODES)[number];

const LanguagesSchema = z.object({
  version: z.literal('languages-1'), _note: z.string().optional(),
  default: z.enum(LANGUAGE_CODES),
  languages: z.array(z.object({ code: z.enum(LANGUAGE_CODES), locale: z.string().min(2), review: z.enum(['human', 'machine']) }).strict()).min(1),
}).strict();
export const languages = LanguagesSchema.parse(data);

export const isLanguage = (v: unknown): v is Language => typeof v === 'string' && (LANGUAGE_CODES as readonly string[]).includes(v);
export const localeOf = (lang: Language) => languages.languages.find(l => l.code === lang)?.locale ?? lang;
export const isMachineTranslated = (lang: Language) => languages.languages.find(l => l.code === lang)?.review === 'machine';

/**
 * The reader's language from the browser: the first entry of the browser's ordered list
 * (`navigator.languages`, a phone's language settings) that the interface has, by its primary
 * subtag; the configured default when none matches.
 */
export function languageFromBrowser(preferred: readonly string[]): Language {
  for (const tag of preferred) { const code = tag.slice(0, 2).toLowerCase(); if (isLanguage(code)) return code; }
  return languages.default;
}
