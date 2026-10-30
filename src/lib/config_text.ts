import { fillText, type UiBundle, type UiLanguage } from '../../shared/ui_text';

/**
 * Display translation of a text that lives in a domain configuration whose bytes are
 * hashed, approved or served by the server (a field profile, a source-history profile,
 * the search profile). That configuration stays as stored; the page bundle carries the
 * other language under a stable key. The translation is shown only while the configured
 * text still equals the bundle's text in the configuration's own language, so a changed
 * profile is shown as stored instead of under a translation of different wording.
 */
export function configText(bundle: UiBundle, lang: UiLanguage, sourceLang: UiLanguage, key: string, source: string): string {
  return bundle.languages[sourceLang][key] === source && key in bundle.languages[lang] ? fillText(bundle, lang, key) : source;
}
