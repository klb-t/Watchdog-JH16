import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { automationApi, formClass, buttonClass } from '../lib/automation_client';
import { ExtractionDatasetSchema, type ExtractionDatasetInput, type ExtractionMappingTemplateRecord } from '../../shared/research_dataset';
import type { CopyPlan } from '../../shared/research';
import type { ExtractionDatasetProfile } from '../../shared/extraction_dataset_profile';
import text from '../../config/ui/extraction-dataset.json';
import { useUiText } from '../lib/ui_text';
import { clientError } from '../lib/api_error';
import type { UiLanguage } from '../../shared/ui_text';

const texts = text.languages as Record<UiLanguage, Record<string, string>>;
const snake = (k: string) => k.replace(/[A-Z]/g, m => `_${m.toLowerCase()}`);
/**
 * A form label from the served profile in the reader's language: English only while the bundle's
 * Polish text equals the profile text exactly, the profile's own text otherwise. The initial
 * settings the form writes into a stored dataset are taken from the profile as they are.
 */
export function profileLabel(lang: UiLanguage, key: string, value: string): string {
  return lang === 'pl' || texts.pl[key] !== value ? value : texts[lang][key] ?? value;
}

type Settings = Omit<ExtractionDatasetInput, 'expectedTrialHash'>;
export function ExtractionDatasetForm({ trial, plan, profile }: { trial: any; plan: CopyPlan; profile: ExtractionDatasetProfile }) {
  const { labels: l, choices } = profile, { lang, errorText } = useUiText(text);
  const L = (k: keyof typeof l) => profileLabel(lang, `label_${snake(k)}`, l[k]);
  const C = (group: keyof typeof choices, id: string, value: string) => profileLabel(lang, `choice_${group}_${snake(id).toLowerCase()}`, value);
  const [settings, setSettings] = useState<Settings>(() => {
    const columns: Settings['columns'] = plan.fields.map((field, i) => ({ key: `field_${i + 1}`, label: field.name,
      type: 'text', unit: null, semanticType: 'dimension', description: `${l.sourceField} ${field.name}`,
      sourceField: field.name, emptyAsMissing: false }));
    if (columns.length === 1) columns.unshift({ key: 'source_row', label: l.rowLabel, type: 'text', unit: null,
      semanticType: 'dimension', description: l.rowDescription, sourceField: null, emptyAsMissing: false });
    return { name: `${plan.name}${l.nameSuffix}`, description: l.description,
      source: { url: '', title: l.sourceTitle, publisher: l.sourcePublisher, license: l.sourceLicense, sourceRecordId: trial.id },
      measure: l.measureDefault, normalization: 'unknown', comparisonScope: l.scopeDefault,
      languageMeaning: 'unknown', evidenceTier: 'UNKNOWN', columns };
  });
  const [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null), [created, setCreated] = useState<any>(null);
  const [templates,setTemplates]=useState<ExtractionMappingTemplateRecord[]>([]),[templateId,setTemplateId]=useState(''),[templateName,setTemplateName]=useState(plan.name.slice(0,100)),[notice,setNotice]=useState<'templateApplied'|'templateSaved'|''>('');
  useEffect(()=>{let active=true;automationApi(`/api/research/trials/${trial.id}/templates`).then(r=>{if(active){setTemplates(r.templates);setTemplateId(r.templates[0]?.id??'');}}).catch(e=>{if(active)setError(e);});return()=>{active=false;};},[trial.id]);
  function update(next: Settings) { setSettings(next); setCreated(null); setError(null); }
  function column(i: number, change: Partial<Settings['columns'][number]>) {
    update({ ...settings, columns: settings.columns.map((c, j) => j === i ? { ...c, ...change } : c) });
  }
  async function create() {
    setBusy(true); setError(null); setCreated(null);
    try {
      const result = ExtractionDatasetSchema.safeParse({ ...settings, expectedTrialHash: trial.hash });
      if (!result.success) { const detail = result.error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join('; '); throw clientError('dataset_settings_invalid', detail, { detail }); }
      const response = await automationApi(`/api/research/trials/${trial.id}/dataset`, result.data);
      setCreated(response.record);
    } catch (e) { setError(e); } finally { setBusy(false); }
  }
  async function applyTemplate() {
    const selected=templates.find(t=>t.id===templateId);if(!selected)return;
    setBusy(true);setError(null);setNotice('');
    try{const {template:t}=await automationApi(`/api/research/trials/${trial.id}/template`,{id:selected.id,expectedHash:selected.hash});
      update({...settings,...t.body.mapping,template:{id:t.id,expectedHash:t.hash}});setNotice('templateApplied');
    }catch(e){setError(e);}finally{setBusy(false);}
  }
  async function saveTemplate() {
    if(!created)return;setBusy(true);setError(null);setNotice('');
    try{const {template}=await automationApi('/api/research/mapping-templates',{datasetId:created.id,expectedHash:created.contentHash,name:templateName});
      const refreshed=await automationApi(`/api/research/trials/${trial.id}/templates`);setTemplates(refreshed.templates);setTemplateId(template.id);setNotice('templateSaved');
    }catch(e){setError(e);}finally{setBusy(false);}
  }
  return <details className="border-t pt-3 space-y-3" data-testid="extraction-dataset-form">
    <summary className="font-semibold cursor-pointer">{L('heading')}</summary>
    <fieldset disabled={busy} className="space-y-3 min-w-0">
    <p className="text-sm">{L('introduction')}</p>
    <div className="border rounded p-3 space-y-3" data-testid="mapping-templates"><h3 className="font-medium">{L('templates')}</h3><p className="text-sm">{L('templateExplanation')}</p>
      {templates.length>0 ? <><label className="block">{L('templateSelect')}<select aria-label={L('templateSelect')} className={formClass} value={templateId} onChange={e=>setTemplateId(e.target.value)}><option value="">{L('templateNone')}</option>{templates.map(t=><option key={t.id} value={t.id}>{t.body.name} · {t.hash.slice(0,8)}</option>)}</select></label>
        <button className={buttonClass} disabled={!templateId} onClick={()=>void applyTemplate()}>{L('templateApply')}</button>
        <details><summary>{L('templateOrigin')}</summary><pre className="text-xs whitespace-pre-wrap break-all max-h-64 overflow-auto">{JSON.stringify(templates.find(t=>t.id===templateId),null,2)}</pre></details>
      </> : <p className="text-xs">{L('templateSaveHint')}</p>}
    </div>
    <div className="grid sm:grid-cols-2 gap-3">
      <label>{L('name')}<input className={formClass} value={settings.name} onChange={e => update({ ...settings, name: e.target.value })}/></label>
      <label>{L('measure')}<input className={formClass} value={settings.measure} onChange={e => update({ ...settings, measure: e.target.value })}/></label>
      <label>{L('datasetDescription')}<input className={formClass} value={settings.description} onChange={e => update({ ...settings, description: e.target.value })}/></label>
      <label>{L('scope')}<input className={formClass} value={settings.comparisonScope} onChange={e => update({ ...settings, comparisonScope: e.target.value })}/></label>
    </div>
    <fieldset className="space-y-3"><legend className="font-medium">{L('mapping')}</legend>
      <p className="text-xs">{L('precision')}</p>
      {settings.columns.map((c, i) => <div key={i} className="border rounded p-3 space-y-2 min-w-0">
        <p className="text-sm break-all">{c.sourceField === null ? L('rowMetadata') : `${L('sourceField')} ${c.sourceField}`}</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <label>{L('label')}<input aria-label={`${L('labelAria')} ${i + 1}`} className={formClass} value={c.label} onChange={e => column(i, { label: e.target.value })}/></label>
          <label>{L('type')}<select aria-label={`${L('typeAria')} ${i + 1}`} className={formClass} value={c.type} disabled={c.sourceField === null} onChange={e => column(i, { type: e.target.value as typeof c.type, semanticType: e.target.value === 'number' ? 'score' : 'dimension', unit: null })}>{Object.entries(choices.types).map(([id, label]) => <option key={id} value={id}>{C('types', id, label)}</option>)}</select></label>
          <label>{L('unit')}<input aria-label={`${L('unitAria')} ${i + 1}`} className={formClass} value={c.unit ?? ''} disabled={c.sourceField === null} placeholder={L('unitPlaceholder')} onChange={e => column(i, { unit: e.target.value || null })}/></label>
          <label>{L('semantics')}<select aria-label={`${L('semanticsAria')} ${i + 1}`} className={formClass} value={c.semanticType} disabled={c.sourceField === null} onChange={e => column(i, { semanticType: e.target.value as typeof c.semanticType })}>{Object.entries(choices.semantics).map(([id, label]) => <option key={id} value={id}>{C('semantics', id, label)}</option>)}</select></label>
          <label>{L('key')}<input aria-label={`${L('keyAria')} ${i + 1}`} className={formClass} value={c.key} onChange={e => column(i, { key: e.target.value })}/></label>
          <label>{L('columnDescription')}<input aria-label={`${L('columnDescriptionAria')} ${i + 1}`} className={formClass} value={c.description} onChange={e => column(i, { description: e.target.value })}/></label>
        </div>
        {c.sourceField !== null && <label className="text-sm flex gap-2"><input type="checkbox" checked={c.emptyAsMissing} onChange={e => column(i, { emptyAsMissing: e.target.checked })}/>{L('emptyAsMissing')}</label>}
      </div>)}
    </fieldset>
    <fieldset className="grid sm:grid-cols-2 gap-3"><legend className="font-medium mb-2">{L('sourceContext')}</legend>
      {(['title', 'publisher', 'license', 'sourceRecordId', 'url'] as const).map(k => <label key={k}>{C('source', k, choices.source[k])}<input className={formClass} value={settings.source[k]} onChange={e => update({ ...settings, source: { ...settings.source, [k]: e.target.value } })}/></label>)}
      <label>{L('evidence')}<select aria-label={L('evidence')} className={formClass} value={settings.evidenceTier} onChange={e => update({ ...settings, evidenceTier: e.target.value as Settings['evidenceTier'] })}>{Object.entries(choices.evidence).map(([id, label]) => <option key={id} value={id}>{C('evidence', id, label)}</option>)}</select></label>
      <label>{L('normalization')}<select aria-label={L('normalization')} className={formClass} value={settings.normalization} onChange={e => update({ ...settings, normalization: e.target.value as Settings['normalization'] })}>{Object.entries(choices.normalization).map(([id, label]) => <option key={id} value={id}>{C('normalization', id, label)}</option>)}</select></label>
      <label>{L('language')}<select aria-label={L('language')} className={formClass} value={settings.languageMeaning} onChange={e => update({ ...settings, languageMeaning: e.target.value as Settings['languageMeaning'] })}>{Object.entries(choices.language).map(([id, label]) => <option key={id} value={id}>{C('language', id, label)}</option>)}</select></label>
    </fieldset>
    <p className="text-xs">{L('sharing')}</p>
    {error !== null && <p role="alert" className="bg-red-50 text-red-800 p-3 break-words">{errorText(error)}</p>}
    {notice && <p role="status" className="text-sm">{L(notice)}</p>}
    <button className={buttonClass} disabled={busy} onClick={() => void create()}>{L('create')}</button>
    {created && <p role="status" className="text-sm">{L('saved')} · {created.approvalState}. <Link className="underline font-medium" to={`/workbench?dataset=${encodeURIComponent(created.id)}`}>{L('open')}</Link></p>}
    {created && <div className="border-t pt-3 space-y-2"><label className="block">{L('templateName')}<input className={formClass} value={templateName} maxLength={100} onChange={e=>setTemplateName(e.target.value)}/></label><button className={buttonClass} disabled={!templateName.trim()} onClick={()=>void saveTemplate()}>{L('templateSave')}</button></div>}
    </fieldset>
  </details>;
}
