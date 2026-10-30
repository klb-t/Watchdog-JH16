import { useEffect, useState } from 'react';

/**
 * Whether the signed-in user's language model can run: enabled in settings and
 * with a stored key for the chosen provider. Buttons that need it are disabled
 * with this reason instead of failing after a click.
 * `code` (with `params`) names the reason so a page can say it in the reader's
 * language: `checking`, `disabled`, `key_missing` ({provider}), `settings_unreadable`.
 */
export type LlmReadinessCode = 'checking' | 'disabled' | 'key_missing' | 'settings_unreadable' | null;
export function useLlmReadiness() {
  const [state, setState] = useState<{ ready: boolean; reason: string; code: LlmReadinessCode; params?: Record<string, string> }>({ ready: false, reason: 'Sprawdzanie ustawień modelu…', code: 'checking' });
  useEffect(() => {
    let active = true;
    fetch('/api/settings', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(d => {
      if (!active) return;
      const value = d?.settings?.value, provider = value?.assistant?.provider;
      const key = (d?.credentials ?? []).some((c: any) => c.provider === provider && c.status === 'present');
      if (!value?.assistant?.enabled) setState({ ready: false, reason: 'Model językowy jest wyłączony (Ustawienia → krok 1).', code: 'disabled' });
      else if (!key) setState({ ready: false, reason: `Brak zapisanego klucza dostawcy ${provider ?? 'LLM'} (Ustawienia → krok 1).`, code: 'key_missing', params: { provider: provider ?? 'LLM' } });
      else setState({ ready: true, reason: '', code: null });
    }).catch(() => active && setState({ ready: false, reason: 'Nie udało się odczytać ustawień modelu.', code: 'settings_unreadable' }));
    return () => { active = false; };
  }, []);
  return state;
}
