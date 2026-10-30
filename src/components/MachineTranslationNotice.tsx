import { useAccessText } from '../lib/access_i18n';
import { isMachineTranslated } from '../../shared/languages';

/** Says so while the interface shows a language whose wording nobody has read yet (config/languages.json, review: machine). */
export function MachineTranslationNotice({ className = '' }: { className?: string }) {
  const { lang, t } = useAccessText();
  if (!isMachineTranslated(lang)) return null;
  return <p role="note" className={`rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 ${className}`} data-testid="machine-translation-notice">{t('machine_translation_notice')}</p>;
}
