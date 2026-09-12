import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { automationApi, formClass, buttonClass } from '../lib/automation_client';
import { ExtractionDatasetSchema, type ExtractionDatasetInput, type ExtractionMappingTemplateRecord } from '../../shared/research_dataset';
import type { CopyPlan } from '../../shared/research';
import type { ExtractionDatasetProfile } from '../../shared/extraction_dataset_profile';

type Settings = Omit<ExtractionDatasetInput, 'expectedTrialHash'>;
export function ExtractionDatasetForm({ trial, plan, profile }: { trial: any; plan: CopyPlan; profile: ExtractionDatasetProfile }) {
  const { labels: l, choices } = profile;
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
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [created, setCreated] = useState<any>(null);
  const [templates,setTemplates]=useState<ExtractionMappingTemplateRecord[]>([]),[templateId,setTemplateId]=useState(''),[templateName,setTemplateName]=useState(plan.name.slice(0,100)),[notice,setNotice]=useState('');
  useEffect(()=>{let active=true;automationApi(`/api/research/trials/${trial.id}/templates`).then(r=>{if(active){setTemplates(r.templates);setTemplateId(r.templates[0]?.id??'');}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[trial.id]);
  function update(next: Settings) { setSettings(next); setCreated(null); setError(''); }
  function column(i: number, change: Partial<Settings['columns'][number]>) {
    update({ ...settings, columns: settings.columns.map((c, j) => j === i ? { ...c, ...change } : c) });
  }
  async function create() {
    setBusy(true); setError(''); setCreated(null);
    try {
      const result = ExtractionDatasetSchema.safeParse({ ...settings, expectedTrialHash: trial.hash });
      if (!result.success) throw new Error(result.error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join('; '));
      const response = await automationApi(`/api/research/trials/${trial.id}/dataset`, result.data);
      setCreated(response.record);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function applyTemplate() {
    const selected=templates.find(t=>t.id===templateId);if(!selected)return;
    setBusy(true);setError('');setNotice('');
    try{const {template:t}=await automationApi(`/api/research/trials/${trial.id}/template`,{id:selected.id,expectedHash:selected.hash});
      update({...settings,...t.body.mapping,template:{id:t.id,expectedHash:t.hash}});setNotice(l.templateApplied);
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  async function saveTemplate() {
    if(!created)return;setBusy(true);setError('');setNotice('');
    try{const {template}=await automationApi('/api/research/mapping-templates',{datasetId:created.id,expectedHash:created.contentHash,name:templateName});
      const refreshed=await automationApi(`/api/research/trials/${trial.id}/templates`);setTemplates(refreshed.templates);setTemplateId(template.id);setNotice(l.templateSaved);
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  return <details className="border-t pt-3 space-y-3" data-testid="extraction-dataset-form">
    <summary className="font-semibold cursor-pointer">{l.heading}</summary>
    <fieldset disabled={busy} className="space-y-3 min-w-0">
    <p className="text-sm">{l.introduction}</p>
    <div className="border rounded p-3 space-y-3" data-testid="mapping-templates"><h3 className="font-medium">{l.templates}</h3><p className="text-sm">{l.templateExplanation}</p>
      {templates.length>0 ? <><label className="block">{l.templateSelect}<select aria-label={l.templateSelect} className={formClass} value={templateId} onChange={e=>setTemplateId(e.target.value)}><option value="">{l.templateNone}</option>{templates.map(t=><option key={t.id} value={t.id}>{t.body.name} · {t.hash.slice(0,8)}</option>)}</select></label>
        <button className={buttonClass} disabled={!templateId} onClick={()=>void applyTemplate()}>{l.templateApply}</button>
        <details><summary>{l.templateOrigin}</summary><pre className="text-xs whitespace-pre-wrap break-all max-h-64 overflow-auto">{JSON.stringify(templates.find(t=>t.id===templateId),null,2)}</pre></details>
      </> : <p className="text-xs">{l.templateSaveHint}</p>}
    </div>
    <div className="grid sm:grid-cols-2 gap-3">
      <label>{l.name}<input className={formClass} value={settings.name} onChange={e => update({ ...settings, name: e.target.value })}/></label>
      <label>{l.measure}<input className={formClass} value={settings.measure} onChange={e => update({ ...settings, measure: e.target.value })}/></label>
      <label>{l.datasetDescription}<input className={formClass} value={settings.description} onChange={e => update({ ...settings, description: e.target.value })}/></label>
      <label>{l.scope}<input className={formClass} value={settings.comparisonScope} onChange={e => update({ ...settings, comparisonScope: e.target.value })}/></label>
    </div>
    <fieldset className="space-y-3"><legend className="font-medium">{l.mapping}</legend>
      <p className="text-xs">{l.precision}</p>
      {settings.columns.map((c, i) => <div key={i} className="border rounded p-3 space-y-2 min-w-0">
        <p className="text-sm break-all">{c.sourceField === null ? l.rowMetadata : `${l.sourceField} ${c.sourceField}`}</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <label>{l.label}<input aria-label={`${l.labelAria} ${i + 1}`} className={formClass} value={c.label} onChange={e => column(i, { label: e.target.value })}/></label>
          <label>{l.type}<select aria-label={`${l.typeAria} ${i + 1}`} className={formClass} value={c.type} disabled={c.sourceField === null} onChange={e => column(i, { type: e.target.value as typeof c.type, semanticType: e.target.value === 'number' ? 'score' : 'dimension', unit: null })}>{Object.entries(choices.types).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
          <label>{l.unit}<input aria-label={`${l.unitAria} ${i + 1}`} className={formClass} value={c.unit ?? ''} disabled={c.sourceField === null} placeholder={l.unitPlaceholder} onChange={e => column(i, { unit: e.target.value || null })}/></label>
          <label>{l.semantics}<select aria-label={`${l.semanticsAria} ${i + 1}`} className={formClass} value={c.semanticType} disabled={c.sourceField === null} onChange={e => column(i, { semanticType: e.target.value as typeof c.semanticType })}>{Object.entries(choices.semantics).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
          <label>{l.key}<input aria-label={`${l.keyAria} ${i + 1}`} className={formClass} value={c.key} onChange={e => column(i, { key: e.target.value })}/></label>
          <label>{l.columnDescription}<input aria-label={`${l.columnDescriptionAria} ${i + 1}`} className={formClass} value={c.description} onChange={e => column(i, { description: e.target.value })}/></label>
        </div>
        {c.sourceField !== null && <label className="text-sm flex gap-2"><input type="checkbox" checked={c.emptyAsMissing} onChange={e => column(i, { emptyAsMissing: e.target.checked })}/>{l.emptyAsMissing}</label>}
      </div>)}
    </fieldset>
    <fieldset className="grid sm:grid-cols-2 gap-3"><legend className="font-medium mb-2">{l.sourceContext}</legend>
      {(['title', 'publisher', 'license', 'sourceRecordId', 'url'] as const).map(k => <label key={k}>{choices.source[k]}<input className={formClass} value={settings.source[k]} onChange={e => update({ ...settings, source: { ...settings.source, [k]: e.target.value } })}/></label>)}
      <label>{l.evidence}<select aria-label={l.evidence} className={formClass} value={settings.evidenceTier} onChange={e => update({ ...settings, evidenceTier: e.target.value as Settings['evidenceTier'] })}>{Object.entries(choices.evidence).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label>{l.normalization}<select aria-label={l.normalization} className={formClass} value={settings.normalization} onChange={e => update({ ...settings, normalization: e.target.value as Settings['normalization'] })}>{Object.entries(choices.normalization).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
      <label>{l.language}<select aria-label={l.language} className={formClass} value={settings.languageMeaning} onChange={e => update({ ...settings, languageMeaning: e.target.value as Settings['languageMeaning'] })}>{Object.entries(choices.language).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
    </fieldset>
    <p className="text-xs">{l.sharing}</p>
    {error && <p role="alert" className="bg-red-50 text-red-800 p-3 break-words">{error}</p>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
    <button className={buttonClass} disabled={busy} onClick={() => void create()}>{l.create}</button>
    {created && <p role="status" className="text-sm">{l.saved} · {created.approvalState}. <Link className="underline font-medium" to={`/workbench?dataset=${encodeURIComponent(created.id)}`}>{l.open}</Link></p>}
    {created && <div className="border-t pt-3 space-y-2"><label className="block">{l.templateName}<input className={formClass} value={templateName} maxLength={100} onChange={e=>setTemplateName(e.target.value)}/></label><button className={buttonClass} disabled={!templateName.trim()} onClick={()=>void saveTemplate()}>{l.templateSave}</button></div>}
    </fieldset>
  </details>;
}
