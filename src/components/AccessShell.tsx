import type { ReactNode } from 'react';
import { Activity } from 'lucide-react';
import { useAccess } from '../lib/access';
import { ACCESS_LANGUAGES, useAccessText } from '../lib/access_i18n';

/** The frame for screens seen before admission: sign-in, invitation, application. */
export function AccessShell({ title, children }: { title: string; children: ReactNode }) {
  const access = useAccess();
  const { lang, setLang, t, languageName } = useAccessText();
  return (
    <div className="min-h-dvh bg-slate-50 text-slate-900 flex flex-col items-center px-4 py-8 sm:py-16">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <Activity className="w-7 h-7 text-indigo-600" aria-hidden />
            <span className="font-semibold text-xl tracking-tight">{access.instanceName}</span>
          </div>
          <label className="text-xs text-slate-500 flex items-center gap-1">
            <span className="sr-only">Language</span>
            <select value={lang} onChange={e => setLang(e.target.value as typeof lang)} className="field-input py-1"
              data-testid="language-select">
              {ACCESS_LANGUAGES.map(l => <option key={l} value={l}>{languageName(l)}</option>)}
            </select>
          </label>
        </div>
        <p className="text-sm text-slate-600 mb-6">{t('tagline')}</p>
        <main className="field-panel shadow-sm">
          <h1 className="text-xl font-semibold mb-4">{title}</h1>
          {children}
        </main>
      </div>
    </div>
  );
}
