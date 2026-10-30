import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AccessShell } from '../components/AccessShell';
import { useAccessText } from '../lib/access_i18n';

/**
 * Public privacy policy and terms (`/privacy`, `/terms`), readable without
 * signing in. Text from config/access/legal.json; contact, storage location and
 * address from the installation's settings.
 */
export function Legal({ page }: { page: 'privacy' | 'terms' }) {
  const { lang, t } = useAccessText();
  const [d, setD] = useState<any>(null), [error, setError] = useState('');
  useEffect(() => { fetch('/api/public/legal').then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))).then(setD).catch(e => setError(e.message)); }, []);
  // The status code stays in the console; the reader gets a sentence in their language.
  if (error) return <AccessShell title="WatchDog"><p role="alert" data-testid="legal-error" title={error}>{t('legal_unavailable')}</p></AccessShell>;
  if (!d) return <AccessShell title="WatchDog"><p role="status">{t('legal_loading')}</p></AccessShell>;
  // Legal text is never machine-translated: a language without a reviewed version reads the English one, and is told so.
  const text = d.languages[lang] ?? d.languages.en, st = d.settings, untranslated = !d.languages[lang];
  const fill = (s: string) => s.replace(/\{instance\}/g, st.instance).replace(/\{contact\}/g, st.contact ?? text.contact_missing)
    .replace(/\{location\}/g, st.location ?? text.location_missing).replace(/\{url\}/g, st.url ?? window.location.origin).replace(/\{version\}/g, d.version);
  return <AccessShell title={text[`${page}_title`]}>
    {untranslated && <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded p-2" data-testid="legal-not-translated">{t('legal_not_translated')}</p>}
    <div className="space-y-4 text-sm" lang={untranslated ? 'en' : undefined} data-testid={`legal-${page}`}>{text[page].map(([h, p]: [string, string]) => <section key={h}><h2 className="font-semibold">{fill(h)}</h2><p className="mt-1">{fill(p)}</p></section>)}
      <p className="text-xs text-slate-500">{fill(text.updated)} · <Link className="underline" to={page === 'privacy' ? '/terms' : '/privacy'}>{text[page === 'privacy' ? 'terms_title' : 'privacy_title']}</Link> · <Link className="underline" to="/">WatchDog</Link></p></div>
  </AccessShell>;
}
