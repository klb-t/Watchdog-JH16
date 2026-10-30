import { useCallback, useEffect, useState } from 'react';
import ui from '../../config/access/ui.json';
import { languageFromBrowser, localeOf } from '../../shared/languages';

/**
 * Labels for the access screens, from `config/access/ui.json` (rule 3: labels
 * are configuration). The language follows the reader's choice, then their
 * browser, then the configured default — so a Polish professor opening an
 * invitation link sees Polish without being asked.
 */
export type AccessLanguage = keyof typeof ui.languages;
export type AccessKey = keyof typeof ui.languages.pl;

const STORAGE_KEY = 'watchdog-access-language';
/** Fired on window when the reader picks a language, so every screen part follows at once. */
export const LANGUAGE_EVENT = 'watchdog-language-changed';
export const ACCESS_LANGUAGES = Object.keys(ui.languages) as AccessLanguage[];

export function isLanguage(v: unknown): v is AccessLanguage {
  return typeof v === 'string' && (ACCESS_LANGUAGES as string[]).includes(v);
}

export function pickLanguage(): AccessLanguage {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLanguage(stored)) return stored;
  } catch { /* storage can be unavailable; fall through */ }
  // The phone's or browser's ordered list, not only its first entry: a phone set to a language the
  // interface lacks, then Polish (uk-UA, pl-PL), gets Polish rather than the configured default.
  const preferred = typeof navigator === 'undefined' ? [] : navigator.languages?.length ? navigator.languages : [navigator.language];
  const code = languageFromBrowser(preferred);
  return isLanguage(code) ? code : (ui.default_language as AccessLanguage);
}

export function translate(lang: AccessLanguage, key: AccessKey, vars: Record<string, string | number> = {}): string {
  const template = ui.languages[lang][key] ?? ui.languages.en[key] ?? key;
  return template.replace(/\{([a-z_]+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}

/** Records the reader's choice and tells every mounted screen part (the selector and the page are separate components). */
export function chooseLanguage(next: AccessLanguage) {
  try { localStorage.setItem(STORAGE_KEY, next); } catch { /* not persisted; still switches */ }
  window.dispatchEvent(new CustomEvent<AccessLanguage>(LANGUAGE_EVENT, { detail: next }));
}

export function useAccessText() {
  const [lang, setLangState] = useState<AccessLanguage>(pickLanguage);
  useEffect(() => {
    const follow = (e: Event) => { const next = (e as CustomEvent).detail; if (isLanguage(next)) setLangState(next); };
    window.addEventListener(LANGUAGE_EVENT, follow);
    return () => window.removeEventListener(LANGUAGE_EVENT, follow);
  }, []);
  const setLang = useCallback((next: AccessLanguage) => { setLangState(next); chooseLanguage(next); }, []);
  const t = useCallback((key: AccessKey, vars?: Record<string, string | number>) => translate(lang, key, vars), [lang]);
  const role = useCallback((r: string) => translate(lang, `role_${r}` as AccessKey), [lang]);
  const date = useCallback((iso: string | null | undefined) => iso
    ? new Date(iso).toLocaleString(localeOf(lang), { dateStyle: 'medium', timeStyle: 'short' }) : '—', [lang]);
  /** A server refusal in the reader's language when its code has a label; the server's own text otherwise. */
  const errorText = useCallback((e: unknown) => {
    const code = (e as { code?: unknown })?.code, key = `error_${String(code)}`;
    return typeof code === 'string' && key in ui.languages[lang] ? translate(lang, key as AccessKey) : (e as Error)?.message ?? String(e);
  }, [lang]);
  return { lang, setLang, t, role, date, errorText, languageName: (l: AccessLanguage) => ui.languages[l].language_name };
}
