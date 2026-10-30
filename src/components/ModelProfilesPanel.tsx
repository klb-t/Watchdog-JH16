import { useState } from 'react';
import type { PersonalSettings } from '../../shared/settings';
import { automationApi as api, formClass, sectionClass, buttonClass } from '../lib/automation_client';
import { clientError } from '../lib/api_error';
import { useUiText } from '../lib/ui_text';
import text from '../../config/ui/model-profiles.json';

/** `taskLabel` shows a task from `config/assistant.json` in the reader's language (the wizard owns those labels). */
export function ModelProfilesPanel({ data, value, onPatch, onSaved, taskLabel }: { data: any; value: PersonalSettings; onPatch: (v: any) => void; onSaved: () => Promise<void>; taskLabel: (task: { id: string; label: string }) => string }) {
  const { t, errorText } = useUiText(text);
  const [error, setError] = useState<unknown>(null), [busy, setBusy] = useState(false), [notice, setNotice] = useState(false);
  const [model, setModel] = useState(''), [context, setContext] = useState(''), [output, setOutput] = useState('');
  const [inputPrice, setInputPrice] = useState(''), [outputPrice, setOutputPrice] = useState(''), [fee, setFee] = useState('0'), [source, setSource] = useState('');
  const [benchmark, setBenchmark] = useState('');
  const act = async (fn: () => Promise<unknown>) => { setError(null); setNotice(false); setBusy(true); try { await fn(); await onSaved(); setNotice(true); } catch (e) { setError(e); } finally { setBusy(false); } };
  const parseBenchmark = () => { try { return JSON.parse(benchmark); } catch (e) { throw clientError('benchmark_json_invalid', (e as Error).message); } };
  const p = data.providers.providers.find((p: any) => p.id === value.assistant.provider);
  return <details className={sectionClass} data-testid="model-profiles-panel"><summary>{t('summary')}</summary>
    {error !== null && <p role="alert" className="text-red-800 break-words">{errorText(error)}</p>}{notice && <p role="status">{t('saved')}</p>}
    <p className="text-sm">{t('intro')}</p>
    {data.profile.tasks.map((task: any) => <div key={task.id} className="grid sm:grid-cols-2 gap-3 border-t pt-2">
      <label className="text-sm min-w-0">{taskLabel(task)}<select className={formClass} value={value.assistant.taskProviders?.[task.id] ?? ''} onChange={e => { const providers = { ...value.assistant.taskProviders }; if (e.target.value) providers[task.id as keyof typeof providers] = e.target.value; else delete providers[task.id as keyof typeof providers]; onPatch({ taskProviders: providers }); }}><option value="">{t('default_provider')}</option>{data.providers.providers.map((p: any) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
      <label className="text-sm min-w-0">{t('pinned_model')}<input className={formClass} value={value.assistant.modelPins[task.id as keyof typeof value.assistant.modelPins] ?? ''} onChange={e => onPatch({ modelPins: { ...value.assistant.modelPins, [task.id]: e.target.value || null } })} /></label>
    </div>)}
    {value.assistant.provider !== 'openrouter' && <div className="space-y-3 border-t pt-3">
      <h3 className="font-semibold break-words">{t('direct_prices', { provider: p.label })}</h3>
      <p className="text-sm">{t('direct_prices_help')}</p>
      <a className="underline text-sm" href={p.documentation} target="_blank" rel="noreferrer">{t('documentation', { provider: p.label })}</a>
      <p className="text-xs break-words">{t('unpriced_models', { models: data.catalog?.unpricedModels?.join(', ') || t('unpriced_refresh') })}</p>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="min-w-0">{t('model_id')}<input className={formClass} value={model} onChange={e => setModel(e.target.value)} /></label>
        <label className="min-w-0">{t('price_source')}<input className={formClass} type="url" value={source} onChange={e => setSource(e.target.value)} /></label>
        <label className="min-w-0">{t('context_limit')}<input type="number" className={formClass} value={context} onChange={e => setContext(e.target.value)} /></label>
        <label className="min-w-0">{t('max_output')}<input type="number" className={formClass} value={output} onChange={e => setOutput(e.target.value)} /></label>
        <label className="min-w-0">{t('max_input_price')}<input type="number" min={0} step="any" className={formClass} value={inputPrice} onChange={e => setInputPrice(e.target.value)} /></label>
        <label className="min-w-0">{t('max_output_price')}<input type="number" min={0} step="any" className={formClass} value={outputPrice} onChange={e => setOutputPrice(e.target.value)} /></label>
        <label className="min-w-0">{t('request_fee')}<input type="number" min={0} step="any" className={formClass} value={fee} onChange={e => setFee(e.target.value)} /></label>
      </div>
      <p className="text-xs">{t('profile_help')}</p>
      <button className={buttonClass} disabled={busy || !model || !source || !context || !output || inputPrice === '' || outputPrice === ''} onClick={() => act(() => api('/api/settings/model-ceilings', { consent: true, profile: { provider: value.assistant.provider, id: model, contextTokens: Number(context), maxOutputTokens: Number(output), inputUsdPerMillion: Number(inputPrice), outputUsdPerMillion: Number(outputPrice), requestUsd: Number(fee), source, observedAt: new Date().toISOString(), validUntil: new Date(Date.now() + 86400000).toISOString() } }))}>{t('save_profile')}</button>
    </div>}
    <details><summary>{t('benchmarks_summary')}</summary>
      <p className="text-xs break-words">{t('benchmarks_help')}</p>
      <textarea aria-label={t('benchmarks_input')} className={formClass} rows={5} value={benchmark} onChange={e => setBenchmark(e.target.value)} />
      <button className={buttonClass} disabled={busy || !benchmark} onClick={() => act(async () => api('/api/settings/benchmarks', { reviewed: true, benchmark: parseBenchmark() }))}>{t('save_benchmarks')}</button>
    </details>
  </details>;
}
