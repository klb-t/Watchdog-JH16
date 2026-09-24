import { useCallback, useState } from 'react';
import ui from '../../config/access/ui.json';

/**
 * Labels for the access screens, from `config/access/ui.json` (rule 3: labels
 * are configuration). The language follows the reader's choice, then their
 * browser, then the configured default — so a Polish professor opening an
 * invitation link sees Polish without being asked.
 */
export type AccessLanguage = keyof typeof ui.languages;
export type AccessKey = keyof typeof ui.languages.pl;

const STORAGE_KEY = 'watchdog-access-language';
export const ACCESS_LANGUAGES = Object.keys(ui.languages) as AccessLanguage[];

function isLanguage(v: unknown): v is AccessLanguage {
  return typeof v === 'string' && (ACCESS_LANGUAGES as string[]).includes(v);
}

export function pickLanguage(): AccessLanguage {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLanguage(stored)) return stored;
  } catch { /* storage can be unavailable; fall through */ }
  const browser = typeof navigator !== 'undefined' ? navigator.language.slice(0, 2).toLowerCase() : '';
  return isLanguage(browser) ? browser : (ui.default_language as AccessLanguage);
}

export function translate(lang: AccessLanguage, key: AccessKey, vars: Record<string, string | number> = {}): string {
  const template = ui.languages[lang][key] ?? ui.languages.en[key] ?? key;
  return template.replace(/\{([a-z_]+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}

export function useAccessText() {
  const [lang, setLangState] = useState<AccessLanguage>(pickLanguage);
  const setLang = useCallback((next: AccessLanguage) => {
    try { localStorage.setItem(STORAGE_KEY, next); } catch { /* not persisted; still switches */ }
    setLangState(next);
  }, []);
  const t = useCallback((key: AccessKey, vars?: Record<string, string | number>) => translate(lang, key, vars), [lang]);
  const role = useCallback((r: string) => translate(lang, `role_${r}` as AccessKey), [lang]);
  const date = useCallback((iso: string | null | undefined) => iso
    ? new Date(iso).toLocaleString(lang === 'pl' ? 'pl-PL' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—', [lang]);
  return { lang, setLang, t, role, date, languageName: (l: AccessLanguage) => ui.languages[l].language_name };
}
