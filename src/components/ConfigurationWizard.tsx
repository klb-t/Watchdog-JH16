import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AssistantTask, PersonalSettings, ResearchPlanInput, SettingsRecord } from '../../shared/settings';
import { automationApi as api, formClass, buttonClass, sectionClass } from '../lib/automation_client';
import { useAccess } from '../lib/access';
import { useUiText } from '../lib/ui_text';
import { ModelProfilesPanel } from './ModelProfilesPanel';
import text from '../../config/ui/configuration-wizard.json';

type Lang = keyof typeof text.languages;
const KNOWN = Object.keys(text.languages.en).filter(k => k.startsWith('known_')) as (keyof typeof text.languages.en)[];
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A template with `{name}` slots as an anchored pattern, so a stored sentence can be recognised and its values kept. */
const pattern = (template: string) => new RegExp(`^${escape(template).replace(/\\\{([a-z0-9_]+)\\\}/g, '(?<$1>.+?)')}$`);
const PATTERNS = KNOWN.flatMap(key => (Object.keys(text.languages) as Lang[]).map(lang => ({ key, re: pattern(text.languages[lang][key]) })));

export function ConfigurationWizard() {
  const access = useAccess();
  const { t, tCode, c, errorText } = useUiText(text);
  /**
   * A fixed text stored in a plan/route record or sent by the server, in the reader's
   * language when it is one of the known sentences; anything else exactly as stored.
   */
  const known = useCallback((stored: unknown) => {
    if (typeof stored !== 'string') return stored === undefined || stored === null ? '' : String(stored);
    for (const { key, re } of PATTERNS) { const m = re.exec(stored); if (m) return t(key, { ...m.groups }); }
    return stored;
  }, [t]);
  const taskLabel = useCallback((task: { id: string; label: string }) => { const label = tCode('task_', task.id); return label === task.id ? task.label : label; }, [tCode]);
  const [data, setData] = useState<any>(null), [record, setRecord] = useState<SettingsRecord | null>(null), [value, setValue] = useState<PersonalSettings | null>(null);
  const [error, setError] = useState<unknown>(null), [busy, setBusy] = useState(false), [message, setMessage] = useState<keyof typeof text.languages.en | ''>(''), [key, setKey] = useState('');
  const [keyProvider, setKeyProvider] = useState('openrouter'), [step, setStep] = useState(1), [plan, setPlan] = useState<any>(null), [approved, setApproved] = useState(false);
  const [options, setOptions] = useState<Omit<ResearchPlanInput, 'settingsHash'>>(() => ({ name: t('default_plan_name'), baseline: 'fixture', refreshMemory: true, scanPapers: true, dailyScan: false, paperScope: 'substances' }));
  const [task, setTask] = useState<AssistantTask>('method_proposal'), [prompt, setPrompt] = useState(''), [proposal, setProposal] = useState<any>(null), [launch, setLaunch] = useState<any>(null);
  const load = async () => { const next = await api('/api/settings'); setData(next); setRecord(next.settings); setValue(next.settings.value); };
  useEffect(() => { let active = true; setData(null); setKey(''); setPlan(null); setProposal(null); setLaunch(null);
    if (!access.principalId) return () => { active = false; };
    api('/api/settings').then(next => { if (active) { setData(next); setRecord(next.settings); setValue(next.settings.value); } }).catch(e => active && setError(e));
    return () => { active = false; };
  }, [access.principalId]);
  const act = async (fn: () => Promise<any>, ok: keyof typeof text.languages.en | '' = '') => { setBusy(true); setError(null); setMessage(''); try { await fn(); setMessage(ok); } catch (e) { setError(e); } finally { setBusy(false); } };
  /** Server refusals: a labelled code first, then a known server sentence, then the server's own text. */
  const errorShown = (e: unknown) => { const shown = errorText(e); return e instanceof Error && shown === e.message ? known(shown) : shown; };
  const save = async (next = value!) => {
    const response = await api('/api/settings', { value: next, expectedHash: record!.hash }); setRecord(response.settings); setValue(response.settings.value);
    window.dispatchEvent(new Event('watchdog-settings-changed')); return response.settings as SettingsRecord;
  };
  if (!data || !value || !record) return <div className={sectionClass}>{error !== null ? <p role="alert" className="break-words">{errorShown(error)}</p> : <p>{t('loading')}</p>}</div>;
  const standard = value.mode !== 'simple', expert = ['expert', 'debug'].includes(value.mode);
  const patchAssistant = (update: any) => setValue({ ...value, assistant: { ...value.assistant, ...update } });
  const patchResearch = (update: any) => setValue({ ...value, research: { ...value.research, ...update } });
  const prepare = () => act(async () => { const saved = await save(); const r = await api('/api/settings/plans', { ...options, settingsHash: saved.hash }); setPlan(r.plan); setApproved(false); setLaunch(null); setStep(3); });
  const steps: [number, keyof typeof text.languages.en][] = [[1, 'step_1'], [2, 'step_2'], [3, 'step_3']];
  const credStatus = (status: string) => status === 'present' ? t('cred_present') : status === 'invalid' ? t('cred_invalid') : t('cred_absent');
  return <section className="space-y-4 min-w-0" data-testid="configuration-wizard">
    <div className={sectionClass}>
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold text-xl">{t('title')}</h2><label className="text-sm">{t('interface_mode')}<select className={formClass} value={value.mode} onChange={e => setValue({ ...value, mode: e.target.value as PersonalSettings['mode'] })} data-testid="interface-mode"><option value="simple">{t('mode_simple')}</option><option value="standard">{t('mode_standard')}</option><option value="expert">{t('mode_expert')}</option><option value="debug">{t('mode_debug')}</option></select></label></div>
      <p className="text-sm">{t('intro')}</p>
      <div className="flex flex-wrap gap-2" role="group" aria-label={t('steps_label')}>{steps.map(([n, label]) => <button key={n} className={`rounded px-3 py-2 text-sm ${step === n ? 'bg-indigo-100 text-indigo-900' : 'bg-slate-100'}`} onClick={() => setStep(n)}>{t(label)}</button>)}</div>
    </div>
    {error !== null && <p role="alert" className="p-3 bg-red-50 text-red-900 break-words">{errorShown(error)}</p>}
    {message && <p role="status" className="text-emerald-800">{t(message)}</p>}
    {step === 1 && <div className={sectionClass}>
      {access.capabilities.includes('provider.view') && <>
        <h3 className="font-semibold">{t('own_connections')}</h3>
        <div className="grid sm:grid-cols-2 gap-3"><label className="min-w-0">{t('key_provider')}<select className={formClass} value={keyProvider} onChange={e => { setKeyProvider(e.target.value); setKey(''); }}>{data.providers.providers.map((p: any) => <option key={p.id} value={p.id}>{t('provider_llm', { provider: p.label })}</option>)}<option value="serpapi">{t('serpapi_option')}</option></select></label>
          {access.capabilities.includes('credential.store') ? <label className="min-w-0">{t('api_key')}<input type="password" className={formClass} value={key} autoComplete="off" spellCheck={false} onChange={e => setKey(e.target.value)} data-testid="personal-api-key" /></label>
            : <p className="text-sm text-slate-600" data-testid="credential-store-needs-role">{t('credential_needs_role')}</p>}</div>
        <p className="text-xs text-slate-600">{t('vault_note')}</p>
        {access.capabilities.includes('credential.store') && <button className={buttonClass} disabled={busy || !key} onClick={() => { const submitted = key; setKey(''); void act(async () => {
          await api('/api/settings/credentials', { provider: keyProvider, apiKey: submitted, consent: true });
          if (keyProvider !== 'serpapi') await save({ ...value, assistant: { ...value.assistant, enabled: true, provider: keyProvider, modelPins: {} } });
          await load();
        }, 'key_saved'); }}>{keyProvider !== 'serpapi' ? t('save_key_llm') : t('save_key_serpapi')}</button>}
        <div className="flex flex-wrap gap-3 text-sm">{data.credentials.filter((cr: any) => cr.status !== 'absent' || cr.provider === keyProvider).map((cr: any) => <div key={cr.provider}><b>{cr.provider}</b>: {credStatus(cr.status)} {cr.status !== 'absent' && <button className="underline" disabled={busy} onClick={() => act(async () => { await api('/api/settings/credentials/remove', { provider: cr.provider }); await load(); }, 'key_removed')}>{t('remove')}</button>}</div>)}</div>
      </>}
      <h3 className="font-semibold pt-2">{t('cost_title')}</h3>
      <label className="block">{t('default_llm_provider')}<select className={formClass} value={value.assistant.provider} onChange={e => patchAssistant({ provider: e.target.value, modelPins: {} })}>{data.providers.providers.map((p: any) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
      <label className="flex gap-2 items-center text-sm"><input type="checkbox" checked={value.assistant.enabled} onChange={e => patchAssistant({ enabled: e.target.checked })} />{t('allow_llm')}</label>
      {!standard && <label className="block">{t('economy', { value: value.assistant.economy })}<input type="range" min={0} max={100} className="w-full" value={value.assistant.economy} onChange={e => patchAssistant({ economy: Number(e.target.value) })} data-testid="cost-slider" /></label>}
      <p className="text-xs">{t('routing_help')}</p>
      <label className="block">{t('daily_budget')}<input className={formClass} type="number" min={0} max={1000} step="0.1" value={value.assistant.dailyBudgetUsd} onChange={e => patchAssistant({ dailyBudgetUsd: Number(e.target.value) })} /></label>
      {standard && <div className="grid sm:grid-cols-2 gap-3"><label className="min-w-0">{t('request_budget')}<input className={formClass} type="number" min={0} max={50} step="0.01" value={value.assistant.requestBudgetUsd} onChange={e => patchAssistant({ requestBudgetUsd: Number(e.target.value) })} /></label>
        <label className="min-w-0">{t('serp_daily_limit')}<input className={formClass} type="number" min={0} max={10000} value={value.searchDailyRequestLimit} onChange={e => setValue({ ...value, searchDailyRequestLimit: Number(e.target.value) })} /></label>
        <label className="min-w-0">{t('density')}<select aria-label={t('density')} className={formClass} value={value.density} onChange={e => setValue({ ...value, density: e.target.value as any })}><option value="comfortable">{t('density_comfortable')}</option><option value="compact">{t('density_compact')}</option></select></label>
        <label className="flex items-center gap-2 min-w-0"><input type="checkbox" checked={value.assistant.allowFree} onChange={e => patchAssistant({ allowFree: e.target.checked })} />{t('allow_free')}</label></div>}
      <div className="flex flex-wrap gap-2"><button className={buttonClass} disabled={busy} data-testid="settings-save" onClick={() => act(async () => { await save(); await load(); }, 'settings_saved')}>{t('save_settings')}</button>
        {access.capabilities.includes('provider.view') && <button className="underline text-sm" disabled={busy} onClick={() => act(async () => { await api('/api/settings/catalog/refresh', { consent: true }); await load(); }, 'catalog_refreshed')}>{t('refresh_catalog')}</button>}
        <button className="underline text-sm" onClick={() => setStep(2)}>{t('next_scope')}</button></div>
      <p className="text-xs">{t('budget_today', { usd: data.budget.reservedOrEstimatedUsd.toFixed(6) })}</p>
      <details open={standard}><summary>{t('routes_summary')}</summary>
        {!data.catalog && <p className="text-sm">{t('catalog_missing')}</p>}
        {data.routes.map((r: any) => { const rule = data.profile.tasks.find((tk: any) => tk.id === r.task); return <div key={r.task} className="border-t pt-2 mt-2 text-xs break-words"><b>{rule ? taskLabel(rule) : r.task}</b>{r.route && <p>{r.route.provider} · {known(r.route.reason)}</p>}<p>{r.route ? t('route_line', { model: r.route.model.id, tokens: r.route.maxOutputTokens, usd: (r.route.reserveMicroUsd / 1000000).toFixed(6) }) : known(r.blocked)}</p></div>; })}
        {expert && data.catalog && data.profile.tasks.map((tk: any) => <label className="block mt-2 text-sm" key={tk.id}>{t('pin_model', { task: taskLabel(tk) })}<select className={formClass} value={value.assistant.modelPins[tk.id as AssistantTask] ?? ''} onChange={e => patchAssistant({ modelPins: { ...value.assistant.modelPins, [tk.id]: e.target.value || null } })}><option value="">{t('pin_auto')}</option>{data.catalog.models.map((m: any) => <option key={m.id} value={m.id}>{m.id}</option>)}</select></label>)}
      </details>
    </div>}
    {step === 1 && standard && access.capabilities.includes('provider.view') && <ModelProfilesPanel data={data} value={value} onPatch={patchAssistant} onSaved={load} taskLabel={taskLabel} />}
    {step === 2 && <div className={sectionClass}>
      <h3 className="font-semibold">{t('dims_title')}</h3><p className="text-sm">{t('dims_intro')}</p>
      <fieldset><legend className="font-medium">{t('languages')}</legend><div className="flex flex-wrap gap-3">{data.profile.languageProfiles.map((l: any) => <label className="flex gap-1 text-sm" key={l.id}><input type="checkbox" checked={value.research.languages.includes(l.id)} onChange={e => patchResearch({ languages: e.target.checked ? [...value.research.languages, l.id] : value.research.languages.filter(x => x !== l.id) })} />{l.label}</label>)}</div></fieldset>
      <fieldset><legend className="font-medium">{t('geography')}</legend><div className="flex flex-wrap gap-3">{data.profile.geographyProfiles.map((g: any) => <label className="flex gap-1 text-sm" key={g.id}><input type="checkbox" checked={value.research.geographies.includes(g.id)} onChange={e => patchResearch({ geographies: e.target.checked ? [...value.research.geographies, g.id] : value.research.geographies.filter(x => x !== g.id) })} />{g.label}</label>)}</div></fieldset>
      <p className="text-xs">{t('geography_help')}</p>
      <label className="block">{t('dialects')}<input className={formClass} value={value.research.dialects.join(',')} onChange={e => patchResearch({ dialects: e.target.value ? e.target.value.split(',') : [] })} /></label>
      <div className="flex flex-wrap gap-3"><label className="flex gap-1 text-sm"><input type="checkbox" checked={value.research.slang} onChange={e => patchResearch({ slang: e.target.checked })} />{t('slang')}</label><label className="flex gap-1 text-sm"><input type="checkbox" checked={value.research.sentiment} onChange={e => patchResearch({ sentiment: e.target.checked })} />{t('sentiment')}</label></div>
      <h3 className="font-semibold">{t('run_title')}</h3>
      <label className="block">{t('plan_name')}<input className={formClass} value={options.name} onChange={e => setOptions({ ...options, name: e.target.value })} /></label>
      <label className="block">{t('baseline')}<select className={formClass} value={options.baseline} onChange={e => setOptions({ ...options, baseline: e.target.value as any })}><option value="fixture">{t('baseline_fixture')}</option><option value="live_serp">{t('baseline_live_serp')}</option><option value="live_serp_extension">{t('baseline_live_serp_extension')}</option><option value="none">{t('baseline_none')}</option></select></label>
      {access.capabilities.includes('evidence.import') && <label className="flex gap-2 text-sm"><input type="checkbox" checked={options.refreshMemory} onChange={e => setOptions({ ...options, refreshMemory: e.target.checked })} />{t('refresh_memory')}</label>}
      {(options.baseline === 'live_serp' || options.baseline === 'live_serp_extension') && <label className="block text-sm">{t('data_role')}
        <select className={formClass} value={options.confirmationProtocolId ?? ''} data-testid="data-role" onChange={e => setOptions({ ...options, confirmationProtocolId: e.target.value || undefined })}>
          <option value="">{t('data_role_exploratory')}</option>{(data.protocols ?? []).map((p: any) => <option key={p.id} value={p.id}>{t('data_role_confirmation', { name: p.name, frozen: p.frozen_at.slice(0, 16).replace('T', ' ') })}</option>)}</select>
        <span className="text-xs block">{(data.protocols ?? []).length ? t('data_role_help') : t('no_protocols')}</span></label>}
      {data.trendsCalibration && <fieldset data-testid="trends-regions"><legend className="font-medium text-sm">{t('trends_legend', { requests: data.trendsCalibration.requestsPerRegion })}</legend>
        <p className="text-xs">{t('trends_help')}</p>
        <div className="flex flex-wrap gap-3">{data.trendsCalibration.regions.map((r: string) => <label key={r} className="flex gap-1 text-sm"><input type="checkbox" data-testid={`trends-region-${r}`} checked={(options.trendsRegions ?? []).includes(r)}
          onChange={e => setOptions({ ...options, trendsRegions: e.target.checked ? [...(options.trendsRegions ?? []), r] : (options.trendsRegions ?? []).filter(x => x !== r) })} />{r === 'WORLD' ? t('region_world') : r}</label>)}</div></fieldset>}
            <label className="flex gap-2 text-sm"><input type="checkbox" checked={options.scanPapers} onChange={e => setOptions({ ...options, scanPapers: e.target.checked })} />{t('scan_papers')}</label>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={options.dailyScan} onChange={e => setOptions({ ...options, dailyScan: e.target.checked })} />{t('daily_scan')}</label>
      <label className="block">{t('paper_scope')}<select className={formClass} value={options.paperScope} onChange={e => setOptions({ ...options, paperScope: e.target.value as any })}><option value="substances">{t('scope_substances')}</option><option value="all_science">{t('scope_all_science')}</option></select></label>
      <button className={buttonClass} disabled={busy || !access.capabilities.includes('run.create')} data-testid="prepare-research-plan" onClick={prepare}>{t('prepare')}</button>
    </div>}
    {step === 3 && <div className={sectionClass}>
      <h3 className="font-semibold">{t('plan_title')}</h3>
      {!plan ? <p>{t('plan_missing')}</p> : <>
        <p className="font-medium break-words">{plan.body.name}</p><p className="text-sm break-words">{t('plan_scope', { languages: plan.body.extensions.languages.join(', '), geographies: plan.body.extensions.geographies.join(', ') || t('areas_unspecified') })}</p>
        <p className="text-sm break-words">{t('plan_jobs', { jobs: plan.body.jobs.map((j: any) => t('job_item', { kind: j.kind, max: j.maxRequests })).join(', ') || c('none'), daily: plan.body.dailyScan ? c('yes') : c('no') })}</p>
        {plan.body.baseline && <details open><summary>{t('method_summary', { queries: plan.body.baseline.plannedQueries })}</summary>
          <p className="text-sm my-2">{known(plan.body.baseline.attemptMeaning)}</p>
          {plan.body.baseline.dataRole?.role === 'confirmation' && <p className="text-sm my-2 p-2 bg-emerald-50 break-words" data-testid="plan-data-role">{t('plan_confirmation', { name: plan.body.baseline.dataRole.protocolName, hash: plan.body.baseline.dataRole.protocolHash.slice(0, 12), scope: known(plan.body.baseline.dataRole.scope) })}</p>}

          {plan.body.baseline.mode !== 'fixture' && !data.credentials.some((cr: any) => cr.provider === 'serpapi' && cr.status === 'present') && <p role="alert" className="text-sm p-2 bg-amber-50 text-amber-900">{t('no_serpapi_key')}</p>}
          {plan.body.baseline.extension && <div className="text-sm my-2 break-words" data-testid="extension-variants"><b>{plan.body.baseline.extension.preset.label}</b><ul className="list-disc ml-5">{plan.body.baseline.extension.preset.variants.map((v: any) => <li key={v.variant_id}><code>{v.variant_id}</code>: {v.differences.join('; ')}</li>)}</ul><p className="text-xs">{t('unchanged_from_faithful', { list: plan.body.baseline.extension.preset.unchanged_from_faithful.join('; ') })}</p></div>}{plan.body.baseline.method.steps.map((s: any) => <p className="text-xs mb-2 break-words" key={s.id}><b>{s.id} · {s.primitive}</b> {s.rationale}</p>)}
          <label className="flex gap-2 items-start text-sm"><input type="checkbox" checked={approved} onChange={e => setApproved(e.target.checked)} data-testid="approve-wizard-method" />{t('approve_method')}</label>
        </details>}
        {plan.body.trendsCalibration && <div className="text-sm break-words" data-testid="trends-plan"><b>{t('trends_plan_title')}</b> {t('trends_plan', { id: plan.body.trendsCalibration.calibrationId, version: plan.body.trendsCalibration.calibrationVersion, regions: plan.body.trendsCalibration.regions.join(', '), requests: plan.body.trendsCalibration.plannedRequests, run: plan.body.trendsCalibration.comparedRunId ? plan.body.trendsCalibration.comparedRunId.slice(0, 8) : t('trends_no_run'), meaning: known(plan.body.trendsCalibration.meaning) })}</div>}
        {(() => { const need = (plan.body.baseline && plan.body.baseline.mode !== 'fixture' ? plan.body.baseline.plannedQueries : 0) + (plan.body.trendsCalibration?.plannedRequests ?? 0), left = value.searchDailyRequestLimit - (data.searchUsage?.usedToday ?? 0);
          return need > 0 && <p className="text-sm" data-testid="serp-budget">{t('serp_budget', { need, used: data.searchUsage?.usedToday ?? '?', limit: value.searchDailyRequestLimit })}
            {need > left && <b className="block text-amber-900"> {t('limit_insufficient')}</b>}</p>; })()}
        <p className="text-sm">{t('exploratory_note')}</p>
        <details><summary>{t('full_record')}</summary><pre className="text-xs whitespace-pre-wrap break-all max-h-80 overflow-auto">{JSON.stringify(plan, null, 2)}</pre></details>
        <button className={buttonClass} disabled={busy || !!launch || !!plan.body.baseline && !approved} data-testid="launch-research-plan" onClick={() => act(async () => {
          const result = await api(`/api/settings/plans/${plan.id}/launch`, { expectedHash: plan.hash, approvedMethodHash: plan.body.baseline?.methodHash ?? null, consent: true }); setLaunch(result.launch);
          await save({ ...value, onboardingComplete: true });
        }, 'launched')}>{t('launch')}</button>
        {launch && <p className="text-sm flex flex-wrap gap-y-1">{launch.runId && <Link className="underline mr-3" to={`/runs/${launch.runId}/results`}>{t('link_results')}</Link>}{(launch.extensionRunIds ?? []).map((r: string, i: number) => <Link key={r} className="underline mr-3" to={`/runs/${r}/results`}>{t('link_extension', { n: i + 1 })}</Link>)}{(launch.trendsRunIds ?? []).map((r: string, i: number) => <Link key={r} className="underline mr-3" to={`/runs/${r}/results`}>{t('link_trends', { region: plan.body.trendsCalibration?.regions[i] ?? i + 1 })}</Link>)}<Link className="underline mr-3" to="/automation">{t('link_queue')}</Link><Link className="underline" to="/memory">{t('link_memory')}</Link></p>}
      </>}
    </div>}
    {standard && access.capabilities.includes('method.propose') && <details className={sectionClass}><summary>{t('assistant_summary')}</summary>
      <label className="block">{t('task_profile')}<select className={formClass} value={task} onChange={e => setTask(e.target.value as AssistantTask)}>{data.profile.tasks.map((tk: any) => <option key={tk.id} value={tk.id}>{taskLabel(tk)}</option>)}</select></label>
      <label className="block">{t('instruction')}<textarea className={formClass} rows={4} value={prompt} onChange={e => setPrompt(e.target.value)} /></label>
      <button className="underline text-sm" onClick={() => setPrompt(t('scope_prompt', { languages: value.research.languages.join(', '), geographies: value.research.geographies.join(', ') || t('prompt_geography_unspecified'), dialects: value.research.dialects.join(', ') || t('prompt_dialects_unknown'), slang: String(value.research.slang), sentiment: String(value.research.sentiment) }))}>{t('insert_scope')}</button>
      <button className={buttonClass} disabled={busy || !prompt || !value.assistant.enabled} onClick={() => act(async () => { await save(); setProposal((await api('/api/settings/assistant', { task, prompt, consent: true })).proposal); await load(); })}>{t('generate')}</button>
      {proposal && <div className="text-sm whitespace-pre-wrap break-words"><p className="font-semibold">{t('proposed', { model: proposal.model })}</p>{proposal.text}<details><summary>{t('provenance_cost')}</summary><pre className="text-xs whitespace-pre-wrap break-all">{JSON.stringify({ route: proposal.route, usage: proposal.usage, reservationId: proposal.reservationId }, null, 2)}</pre></details></div>}
    </details>}
    {value.mode === 'debug' && <details className={sectionClass}><summary>{t('debug_summary')}</summary><pre className="text-xs whitespace-pre-wrap break-all max-h-80 overflow-auto">{JSON.stringify({ settingsHash: record.hash, routingHash: data.profile.contentHash, catalogHash: data.catalog?.hash, budget: data.budget, routes: data.routes }, null, 2)}</pre>
      {access.capabilities.includes('diagnostics.view') && <Link className="underline" to="/diagnostics">{t('open_recorder')}</Link>}<p className="text-xs">{t('mode_note')}</p></details>}
  </section>;
}
