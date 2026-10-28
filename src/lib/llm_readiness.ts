import { useEffect, useState } from 'react';

/**
 * Whether the signed-in user's language model can run: enabled in settings and
 * with a stored key for the chosen provider. Buttons that need it are disabled
 * with this reason instead of failing after a click.
 */
export function useLlmReadiness() {
  const [state, setState] = useState<{ ready: boolean; reason: string }>({ ready: false, reason: 'Sprawdzanie ustawień modelu…' });
  useEffect(() => {
    let active = true;
    fetch('/api/settings', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(d => {
      if (!active) return;
      const value = d?.settings?.value, provider = value?.assistant?.provider;
      const key = (d?.credentials ?? []).some((c: any) => c.provider === provider && c.status === 'present');
      if (!value?.assistant?.enabled) setState({ ready: false, reason: 'Model językowy jest wyłączony (Ustawienia → krok 1).' });
      else if (!key) setState({ ready: false, reason: `Brak zapisanego klucza dostawcy ${provider ?? 'LLM'} (Ustawienia → krok 1).` });
      else setState({ ready: true, reason: '' });
    }).catch(() => active && setState({ ready: false, reason: 'Nie udało się odczytać ustawień modelu.' }));
    return () => { active = false; };
  }, []);
  return state;
}
