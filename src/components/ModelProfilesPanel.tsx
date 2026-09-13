import { useState } from 'react';
import type { PersonalSettings } from '../../shared/settings';
import { automationApi as api, formClass, sectionClass, buttonClass } from '../lib/automation_client';

export function ModelProfilesPanel({ data, value, onPatch, onSaved }: { data: any; value: PersonalSettings; onPatch: (v: any) => void; onSaved: () => Promise<void> }) {
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const [model, setModel] = useState(''), [context, setContext] = useState(''), [output, setOutput] = useState('');
  const [inputPrice, setInputPrice] = useState(''), [outputPrice, setOutputPrice] = useState(''), [fee, setFee] = useState('0'), [source, setSource] = useState('');
  const [benchmark, setBenchmark] = useState('');
  const act = async (fn: () => Promise<unknown>) => { setError(''); setNotice(''); setBusy(true); try { await fn(); await onSaved(); setNotice('Profil zapisany z pochodzeniem.'); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  const p = data.providers.providers.find((p: any) => p.id === value.assistant.provider);
  return <details className={sectionClass} data-testid="model-profiles-panel"><summary>Dostawcy, modele dla zadań i wyniki testów</summary>
    {error && <p role="alert" className="text-red-800 break-words">{error}</p>}{notice && <p role="status">{notice}</p>}
    <p className="text-sm">Możesz rozdzielić zadania między posiadane klucze. Zmiany przypisań zapisuje przycisk „Zapisz ustawienia” powyżej.</p>
    {data.profile.tasks.map((t: any) => <div key={t.id} className="grid sm:grid-cols-2 gap-3 border-t pt-2">
      <label className="text-sm">{t.label}<select className={formClass} value={value.assistant.taskProviders?.[t.id] ?? ''} onChange={e => { const providers = { ...value.assistant.taskProviders }; if (e.target.value) providers[t.id as keyof typeof providers] = e.target.value; else delete providers[t.id as keyof typeof providers]; onPatch({ taskProviders: providers }); }}><option value="">Domyślny dostawca</option>{data.providers.providers.map((p: any) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
      <label className="text-sm">Identyfikator przypiętego modelu (opcjonalnie)<input className={formClass} value={value.assistant.modelPins[t.id as keyof typeof value.assistant.modelPins] ?? ''} onChange={e => onPatch({ modelPins: { ...value.assistant.modelPins, [t.id]: e.target.value || null } })} /></label>
    </div>)}
    {value.assistant.provider !== 'openrouter' && <div className="space-y-3 border-t pt-3">
      <h3 className="font-semibold">Ceny bezpośredniego dostawcy · {p.label}</h3>
      <p className="text-sm">Katalog API może nie zawierać cen ani limitów kontekstu. Dodaj wtedy profil z dokumentacji lub umowy tego dostawcy. Ceny OpenRoutera nie są przenoszone do innych usług.</p>
      <a className="underline text-sm" href={p.documentation} target="_blank" rel="noreferrer">Dokumentacja {p.label}</a>
      <p className="text-xs break-words">Modele z katalogu bez profilu cen: {data.catalog?.unpricedModels?.join(', ') || 'odśwież katalog, aby odczytać listę konta'}</p>
      <div className="grid sm:grid-cols-2 gap-3">
        <label>Dokładny identyfikator modelu<input className={formClass} value={model} onChange={e => setModel(e.target.value)} /></label>
        <label>Źródło cen i limitów (URL)<input className={formClass} type="url" value={source} onChange={e => setSource(e.target.value)} /></label>
        <label>Limit kontekstu (tokeny)<input type="number" className={formClass} value={context} onChange={e => setContext(e.target.value)} /></label>
        <label>Maks. odpowiedź (tokeny)<input type="number" className={formClass} value={output} onChange={e => setOutput(e.target.value)} /></label>
        <label>Maks. USD / milion tokenów wejścia<input type="number" min={0} step="any" className={formClass} value={inputPrice} onChange={e => setInputPrice(e.target.value)} /></label>
        <label>Maks. USD / milion tokenów wyjścia<input type="number" min={0} step="any" className={formClass} value={outputPrice} onChange={e => setOutputPrice(e.target.value)} /></label>
        <label>Dodatkowa opłata za wywołanie (USD)<input type="number" min={0} step="any" className={formClass} value={fee} onChange={e => setFee(e.target.value)} /></label>
      </div>
      <p className="text-xs">Uwzględnij najwyższy możliwy próg cen i dodatkowe opłaty. Profil będzie ważny dobę. Zapis jest Twoim potwierdzeniem tych danych; nie sprawdza cennika automatycznie.</p>
      <button className={buttonClass} disabled={busy || !model || !source || !context || !output || inputPrice === '' || outputPrice === ''} onClick={() => act(() => api('/api/settings/model-ceilings', { consent: true, profile: { provider: value.assistant.provider, id: model, contextTokens: Number(context), maxOutputTokens: Number(output), inputUsdPerMillion: Number(inputPrice), outputUsdPerMillion: Number(outputPrice), requestUsd: Number(fee), source, observedAt: new Date().toISOString(), validUntil: new Date(Date.now() + 86400000).toISOString() } }))}>Zapisz sprawdzony profil modelu na 24 godziny</button>
    </div>}
    <details><summary>Zaimportuj sprawdzone wyniki testów dla konkretnego zadania</summary>
      <p className="text-xs">JSON: provider, model, task, suiteHash (SHA-256 zestawu), passed, total, source (URL), observedAt (ISO UTC). Porównywane są tylko wyniki tej samej rodziny testów. Wpis jest Twoim przeglądem źródła, nie oceną wygenerowaną przez LLM.</p>
      <textarea aria-label="Wyniki benchmarku JSON" className={formClass} rows={5} value={benchmark} onChange={e => setBenchmark(e.target.value)} />
      <button className={buttonClass} disabled={busy || !benchmark} onClick={() => act(() => api('/api/settings/benchmarks', { reviewed: true, benchmark: JSON.parse(benchmark) }))}>Potwierdź źródło i zapisz wyniki testów</button>
    </details>
  </details>;
}
