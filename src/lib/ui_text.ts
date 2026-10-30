import { createContext, createElement, useCallback, useContext, useMemo, type ReactNode } from 'react';
import common from '../../config/ui/common.json';
import { fillText, type UiBundle, type UiLanguage } from '../../shared/ui_text';
import { localeOf } from '../../shared/languages';
import { useWorkspace } from './workspace_preferences';

/**
 * Page texts in the interface language — the one choice the menu, the access screens
 * and every page follow (`watchdog-language-changed`). Texts come from a
 * `config/ui/*.json` bundle; keys are typed from the bundle, so a typo fails `tsc`.
 *
 * Only interface wording is translated. Stored data (paper quotes, run configs,
 * method specs, data-derived manuscript text), numbers and units are shown as stored.
 */
type Keys<B extends UiBundle> = Extract<keyof B['languages']['en'], string>;
type Vars = Record<string, string | number>;
export type CommonKey = Keys<typeof common>;

const Override = createContext<UiLanguage | null>(null);
/** Fixes the language for a subtree: server-side rendering in tests, previews of the other language. */
export function UiLanguageProvider({ lang, children }: { lang: UiLanguage; children?: ReactNode }) {
  return createElement(Override.Provider, { value: lang }, children);
}

export function useLanguage(): UiLanguage {
  const forced = useContext(Override), workspace = useWorkspace().language;
  return forced ?? workspace;
}

export function useUiText<B extends UiBundle>(bundle: B) {
  const lang = useLanguage();
  const t = useCallback((key: Keys<B>, vars?: Vars) => fillText(bundle, lang, key, vars), [bundle, lang]);
  /** For keys built at run time from a stable code (a status, a kind): the code itself when no label exists. */
  const tCode = useCallback((prefix: string, code: string, vars?: Vars) => {
    const key = `${prefix}${code}`;
    if (key in bundle.languages[lang]) return fillText(bundle, lang, key, vars);
    if (key in common.languages[lang]) return fillText(common, lang, key, vars);
    return code;
  }, [bundle, lang]);
  const c = useCallback((key: CommonKey, vars?: Vars) => fillText(common, lang, key, vars), [lang]);
  const locale = localeOf(lang);
  /** Date and time in the reader's language; a missing timestamp shows a dash, never a made-up date. */
  const date = useCallback((iso: string | number | null | undefined, style: 'datetime' | 'date' = 'datetime') => {
    if (iso === null || iso === undefined || iso === '') return '—';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? String(iso)
      : d.toLocaleString(locale, style === 'date' ? { dateStyle: 'medium' } : { dateStyle: 'medium', timeStyle: 'short' });
  }, [locale]);
  /**
   * A server refusal in the reader's language when its stable code has a label
   * (`error_<code>` in the page bundle, then in common); the server's own text otherwise.
   * The server keeps its English messages for logs and the API.
   */
  const errorText = useCallback((e: unknown) => {
    const code = (e as { code?: unknown })?.code, vars = (e as { vars?: Vars })?.vars;
    if (typeof code === 'string') {
      const key = `error_${code}`;
      if (key in bundle.languages[lang]) return fillText(bundle, lang, key, vars);
      if (key in common.languages[lang]) return fillText(common, lang, key, vars);
    }
    return e instanceof Error ? e.message : String(e);
  }, [bundle, lang]);
  return useMemo(() => ({ lang, locale, t, tCode, c, date, errorText }), [lang, locale, t, tCode, c, date, errorText]);
}

/** The shared texts (statuses, loading, common refusals) for components that need nothing else. */
export function useCommonText() { return useUiText(common); }
