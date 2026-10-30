import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { automationApi as api, buttonClass, formClass, sectionClass } from '../lib/automation_client';
import { useAccess } from '../lib/access';
import { PaperOperationInputSchema, type PaperOperationInput } from '../../shared/paper_operation';
import text from '../../config/ui/paper-operations.json';
import { useUiText } from '../lib/ui_text';
import { clientError, responseError } from '../lib/api_error';
import type { UiLanguage } from '../../shared/ui_text';

type Key = keyof typeof text.languages.en;
type Notice = { key: Key; vars?: Record<string, string | number> } | null;
const texts = text.languages as Record<UiLanguage, Record<string, string>>;
/**
 * A label of `config/paper-operation-ui.json`, or of the profile stored inside a saved plan, in the
 * reader's language. That profile is hashed into every plan, so it is not edited for display: the
 * English text is used only while the bundle's Polish text equals the shown text exactly; any other
 * text (a changed config, an older stored profile) is shown as stored.
 */
export function profileText(lang: UiLanguage, key: string, value: string | undefined): string | undefined {
  if (value === undefined || lang === 'pl' || texts.pl[key] !== value) return value;
  return texts[lang][key] ?? value;
}
const snake = (k: string) => k.replace(/[A-Z]/g, m => `_${m.toLowerCase()}`);
const statKey = (id: string) => `stat_${id.replace(/\./g, '_')}`;

export function PaperOperations({ documents, assessments, substitutions, initialDocumentId }: {
  documents: any[]; assessments: any[]; substitutions: any[]; initialDocumentId?: string;
}) {
  const access = useAccess(), { t, lang, errorText, date } = useUiText(text);
  const pt = (key: string, value: string | undefined) => profileText(lang, key, value);
  const [catalog, setCatalog] = useState<any>(null), [datasets, setDatasets] = useState<any[]>([]);
  const [sourceKey, setSourceKey] = useState(initialDocumentId ? `paper:${initialDocumentId}` : ''), [sourceDoc, setSourceDoc] = useState<any>(null);
  const [datasetId, setDatasetId] = useState(''), [method, setMethod] = useState<PaperOperationInput['method']>('describe'), [quote, setQuote] = useState('');
  const empty = (role: 'a'|'b'): PaperOperationInput['bindings'][number] => ({ role, column:'', rationale:'', origin:'unspecified', requirementId:null, substitution:null });
  const [bindings, setBindings] = useState([empty('a'), empty('b')]);
  const [missingPolicy, setMissingPolicy] = useState<PaperOperationInput['missingPolicy']>('propagate'), [scopeNote, setScopeNote] = useState('');
  const [useCohort, setUseCohort] = useState(false), [cohortIds, setCohortIds] = useState<string[]>([]);
  const [cohortQuote, setCohortQuote] = useState(''), [cohortRationale, setCohortRationale] = useState(''), [cohortSearch, setCohortSearch] = useState('');
  const [selected, setSelected] = useState<any>(null), [result, setResult] = useState<any>(null), [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null), [notice, setNotice] = useState<Notice>(null);
  useEffect(() => { let live = true;
    Promise.all([api('/api/research/operations'), api('/api/workbench/datasets')]).then(([c,d])=>{if(live){setCatalog(c);setDatasets(d.records.filter((r:any)=>r.approvalState==='APPROVED'));}}).catch(e=>{if(live)setError(e);});
    return ()=>{live=false;};
  }, []);
  useEffect(()=>{let live=true;setSourceDoc(null);setQuote('');setBindings([empty('a'),empty('b')]);setCohortQuote('');setCohortRationale('');setCohortIds([]);setUseCohort(false);setCohortSearch('');
    const [kind,id,index] = sourceKey.split(':'), a=assessments.find(a=>a.id===id), documentId=kind==='paper'?id:a?.documentId;
    if(kind==='assessment' && ['describe','pearson','spearman'].includes(a?.body?.assessment?.operations[Number(index)]?.name))setMethod(a.body.assessment.operations[Number(index)].name);
    if(documentId)api(`/api/research/papers/${documentId}`).then(r=>{if(live)setSourceDoc(r.document);}).catch(e=>{if(live)setError(e);});
    return ()=>{live=false;};
  }, [sourceKey]);
  const [kind,assessmentId,operationIndex]=sourceKey.split(':'), assessment=kind==='assessment'?assessments.find(a=>a.id===assessmentId):null;
  const dataset=datasets.find(d=>d.id===datasetId), columns=dataset?.document.columns.filter((c:any)=>c.type==='number'&&c.unit&&c.semanticType!=='dimension')??[];
  const activeBindings=bindings.slice(0,method==='describe'?1:2), requirements=assessment?.body?.assessment?.dataRequirements??[];
  const source=kind==='assessment'?{kind:'assessment_operation',assessmentId,assessmentHash:assessment?.hash,operationIndex:Number(operationIndex)}
    :{kind:'manual_quote',documentId:sourceDoc?.id,documentHash:sourceDoc?.hash,quote};
  const input={source,method,datasetId,datasetHash:dataset?.contentHash,bindings:activeBindings,missingPolicy,scopeNote,
    ...(useCohort?{cohort:{rowIds:cohortIds,quote:cohortQuote,rationale:cohortRationale}}:{})};
  const matchingRows=(dataset?.document.rows??[]).filter((r:any)=>[r.id,...Object.values(r.values)].join(' ').normalize('NFKC').toLowerCase().includes(cohortSearch.normalize('NFKC').toLowerCase()));
  const patch=(i:number,value:Partial<PaperOperationInput['bindings'][number]>)=>setBindings(bindings.map((b,n)=>n===i?{...b,...value}:b));
  const open=async(id:string)=>{setSelected((await api(`/api/research/operations/${id}`)).operation);setReviewed(false);setResult(null);};
  const act=async(fn:()=>Promise<void>)=>{setBusy(true);setError(null);setNotice(null);try{await fn();setCatalog(await api('/api/research/operations'));}catch(e){setError(e);}finally{setBusy(false);}};
  const download=async(runId:string)=>{const response=await fetch(`/api/research/operations/${selected.id}/runs/${runId}/export`,{cache:'no-store'});
    if(!response.ok){const e=await response.json();throw e.message?responseError(response,e):clientError('export_failed','The export failed.');}
    const url=URL.createObjectURL(await response.blob()),a=document.createElement('a');a.href=url;a.download='watchdog-paper-analysis.zip';a.click();setTimeout(()=>URL.revokeObjectURL(url),0);
    setNotice({key:'notice_downloaded',vars:{sha:response.headers.get('X-Package-Manifest-SHA256')??'—'}});
  };
  const profile=catalog?.profile;
  const allowedPolicies: string[] = profile?.methods.find((m:any)=>m.id===method)?.missingPolicies??[];
  useEffect(()=>{if(allowedPolicies.length&&!allowedPolicies.includes(missingPolicy))setMissingPolicy(allowedPolicies[0] as typeof missingPolicy);},[method,profile?.contentHash]);
  return <div className="space-y-5" data-testid="paper-operations">
    {error!==null&&<p role="alert" className="bg-red-50 p-3 text-red-800 break-words">{errorText(error)}</p>}
    {notice&&<p role="status" className="text-sm break-all">{t(notice.key,notice.vars)}</p>}
    <section className={sectionClass}><h2 className="font-semibold">{profile?pt('profile_title',profile.title):t('profile_title')}</h2><p className="text-sm">{pt('profile_introduction',profile?.introduction)}</p>
      <fieldset disabled={busy} className="space-y-3 min-w-0">
        <label className="block">{t('source_select')}<select aria-label={t('source_select')} className={formClass} value={sourceKey} onChange={e=>setSourceKey(e.target.value)}><option value="">{t('choose')}</option>
          {documents.filter(d=>d.body.coverage!=='identifier_only').map(d=><option key={d.id} value={`paper:${d.id}`}>{t('manual_quote_option',{title:d.body.title})}</option>)}
          {assessments.filter(a=>a.status==='PROPOSED').flatMap(a=>(a.body?.assessment?.operations??[]).map((o:any,i:number)=><option key={`${a.id}:${i}`} value={`assessment:${a.id}:${i}`} disabled={!['describe','pearson','spearman'].includes(o.name)}>{o.name} · {documents.find(d=>d.id===a.documentId)?.body.title} {!['describe','pearson','spearman'].includes(o.name)?t('no_executor'):''}</option>))}
        </select></label>
        {sourceDoc&&<details><summary>{t('saved_text_summary',{coverage:sourceDoc.body.coverage})}</summary><pre className="whitespace-pre-wrap break-words text-sm max-h-64 overflow-auto">{sourceDoc.body.text}</pre></details>}
        {kind==='assessment'?<blockquote className="border-l-2 pl-3 whitespace-pre-wrap break-words">{assessment?.body.assessment.operations[Number(operationIndex)]?.quote}</blockquote>
          :<label className="block">{t('quote_label')}<textarea aria-label={t('quote_label')} className={formClass} rows={3} value={quote} onChange={e=>setQuote(e.target.value)}/></label>}
        <label className="block">{t('operation_label')}<select aria-label={t('operation_label')} className={formClass} value={method} disabled={kind==='assessment'} onChange={e=>setMethod(e.target.value as typeof method)}>{profile?.methods.map((m:any)=><option key={m.id} value={m.id}>{pt(`method_${m.id}`,m.label)}</option>)}</select></label>
        <label className="block">{t('dataset_label')}<select aria-label={t('dataset_label')} className={formClass} value={datasetId} onChange={e=>{setDatasetId(e.target.value);setBindings([empty('a'),empty('b')]);setCohortIds([]);setCohortSearch('');setCohortRationale('');}}><option value="">{t('choose')}</option>{datasets.map(d=><option key={d.id} value={d.id}>{d.document.name}</option>)}</select></label>
        {!datasets.length&&<p className="text-sm">{t('no_datasets_before')} <Link to="/workbench" className="underline">{t('no_datasets_link')}</Link>{t('no_datasets_after')}</p>}
        {dataset&&<p className="text-xs break-words">{t('dataset_summary',{source:dataset.document.source.title,rows:dataset.document.rows.length,scope:dataset.document.comparisonScope,tiers:[...new Set(dataset.document.rows.map((r:any)=>r.evidenceTier))].join(', ')})}</p>}
        {activeBindings.map((b,i)=><fieldset key={b.role} className="border rounded p-3 space-y-3 min-w-0"><legend>{t('input_legend',{role:b.role.toUpperCase()})}</legend>
          <div className="grid sm:grid-cols-2 gap-3"><label>{t('column_label',{role:b.role.toUpperCase()})}<select aria-label={t('column_label',{role:b.role.toUpperCase()})} className={formClass} value={b.column} onChange={e=>patch(i,{column:e.target.value})}><option value="">{t('choose')}</option>{columns.map((c:any)=><option key={c.key} value={c.key}>{c.label} · {c.unit}</option>)}</select></label>
          <label>{t('origin_label',{role:b.role.toUpperCase()})}<select aria-label={t('origin_label',{role:b.role.toUpperCase()})} className={formClass} value={b.origin} onChange={e=>patch(i,{origin:e.target.value as typeof b.origin,substitution:null})}>{profile?.origins.map((o:any)=><option key={o.id} value={o.id}>{pt(`origin_${o.id}`,o.label)}</option>)}</select></label></div>
          {requirements.length>0&&<label className="block">{t('requirement_label',{role:b.role.toUpperCase()})}<select aria-label={t('requirement_label',{role:b.role.toUpperCase()})} className={formClass} value={b.requirementId??''} onChange={e=>patch(i,{requirementId:e.target.value||null,substitution:null})}><option value="">{t('requirement_none')}</option>{requirements.map((r:any)=><option key={r.id} value={r.id}>{r.id} · {r.construct}</option>)}</select></label>}
          {b.requirementId&&<label className="block">{t('variant_label',{role:b.role.toUpperCase()})}<select aria-label={t('variant_label',{role:b.role.toUpperCase()})} className={formClass} value={b.substitution?.id??''} onChange={e=>{const s=substitutions.find(s=>s.id===e.target.value);patch(i,{substitution:s?{id:s.id,hash:s.hash}:null,...(s?{origin:s.body.kind}:{})});}}><option value="">{t('variant_none')}</option>{substitutions.filter(s=>s.body.assessmentId===assessment?.id&&s.body.requirementId===b.requirementId).map(s=><option key={s.id} value={s.id}>{s.body.kind} · {s.body.source}</option>)}</select></label>}
          <label className="block">{t('rationale_label',{role:b.role.toUpperCase()})}<textarea aria-label={t('rationale_label',{role:b.role.toUpperCase()})} className={formClass} rows={2} value={b.rationale} onChange={e=>patch(i,{rationale:e.target.value})}/></label>
        </fieldset>)}
        {dataset&&profile?.cohort&&<fieldset className="border rounded p-3 space-y-3 min-w-0" data-testid="paper-cohort-editor"><legend>{pt('cohort_title',profile.cohort.title)}</legend>
          <label className="block">{pt('cohort_title',profile.cohort.title)}<select aria-label={pt('cohort_title',profile.cohort.title)} className={formClass} value={useCohort?'cohort':'all'} onChange={e=>setUseCohort(e.target.value==='cohort')}><option value="all">{pt('cohort_all_rows',profile.cohort.allRows)}</option><option value="cohort">{pt('cohort_selected_rows',profile.cohort.selectedRows)}</option></select></label>
          {useCohort&&<>
            <label className="block">{pt('cohort_quote_label',profile.cohort.quoteLabel)}<textarea aria-label={pt('cohort_quote_label',profile.cohort.quoteLabel)} className={formClass} rows={2} value={cohortQuote} onChange={e=>setCohortQuote(e.target.value)}/></label>
            <label className="block">{pt('cohort_rationale_label',profile.cohort.rationaleLabel)}<textarea aria-label={pt('cohort_rationale_label',profile.cohort.rationaleLabel)} className={formClass} rows={2} value={cohortRationale} onChange={e=>setCohortRationale(e.target.value)}/></label>
            <label className="block">{pt('cohort_search_label',profile.cohort.searchLabel)}<input aria-label={pt('cohort_search_label',profile.cohort.searchLabel)} className={formClass} value={cohortSearch} onChange={e=>setCohortSearch(e.target.value)}/></label>
            <p className="text-sm" data-testid="paper-cohort-count">{t('cohort_count',{selected:cohortIds.length,total:dataset.document.rows.length,visible:Math.min(100,matchingRows.length),matching:matchingRows.length})}</p>
            <div className="max-h-64 overflow-auto border rounded p-2 space-y-2">{matchingRows.slice(0,100).map((r:any)=><label key={r.id} className="flex items-start gap-2 text-sm break-words"><input type="checkbox" aria-label={t('row_aria',{id:r.id})} checked={cohortIds.includes(r.id)} onChange={e=>setCohortIds(e.target.checked?[...cohortIds,r.id]:cohortIds.filter(id=>id!==r.id))}/><span className="min-w-0"><b>{r.id}</b>{activeBindings.filter(b=>b.column).map(b=><span key={b.role}> · {b.role.toUpperCase()}: {r.values[b.column]??t('value_missing')}</span>)}</span></label>)}</div>
            {!!cohortIds.length&&<button type="button" className="underline text-sm" onClick={()=>setCohortIds([])}>{t('clear_rows')}</button>}
            <p className="text-sm bg-amber-50 p-3">{pt('cohort_notice',profile.cohort.notice)}</p>
          </>}
        </fieldset>}
        <label className="block">{t('missing_policy_label')}<select aria-label={t('missing_policy_label')} className={formClass} value={missingPolicy} onChange={e=>setMissingPolicy(e.target.value as typeof missingPolicy)}>{profile?.missingPolicies.filter((m:any)=>allowedPolicies.includes(m.id)).map((m:any)=><option key={m.id} value={m.id}>{pt(`missing_${m.id}`,m.label)}</option>)}</select></label>
        <label className="block">{t('scope_note_label')}<textarea aria-label={t('scope_note_label')} className={formClass} rows={3} value={scopeNote} onChange={e=>setScopeNote(e.target.value)}/></label>
        <p className="text-sm bg-amber-50 p-3">{pt('profile_scope_label',profile?.scopeLabel)} {t('scope_disclaimer')}</p>
        <button className={buttonClass} disabled={!PaperOperationInputSchema.safeParse(input).success||!access.capabilities.includes('workbench.analyze')} onClick={()=>act(async()=>{const r=await api('/api/research/operations',input);setSelected(r.operation);setResult(null);setReviewed(false);setNotice({key:'notice_plan_saved'});})}>{t('prepare_plan')}</button>
      </fieldset>
    </section>
    <section className={sectionClass}><h2 className="font-semibold">{t('saved_plans')}</h2>
      <label className="block">{t('saved_plan')}<select aria-label={t('saved_plan')} className={formClass} disabled={busy} value={selected?.id??''} onChange={e=>e.target.value&&void act(()=>open(e.target.value))}><option value="">{t('choose')}</option>{catalog?.operations.map((o:any)=><option key={o.id} value={o.id}>{o.title} · {o.method} · {o.approvalState}</option>)}</select></label>
      {selected&&<div className="space-y-3" data-testid="paper-operation-review"><h3 className="font-semibold">{selected.body.document.body.title}</h3><blockquote className="border-l-2 pl-3 whitespace-pre-wrap break-words">{selected.body.anchor.quote}</blockquote>
        <p className="text-sm">{pt('profile_scope_label',selected.body.profile.scopeLabel)} <strong>{selected.body.meaning}</strong></p><p className="text-sm whitespace-pre-wrap">{selected.body.scopeNote}</p>
        {selected.body.cohort&&<div className="border rounded p-3 space-y-2 text-sm" data-testid="paper-cohort-review"><h4 className="font-semibold">{t('cohort_review_count',{label:pt('cohort_review_label',selected.body.profile.cohort.reviewLabel)??'',selected:selected.body.cohort.rowIds.length,total:selected.body.cohort.sourceRowCount})}</h4><blockquote className="border-l-2 pl-3 whitespace-pre-wrap break-words">{selected.body.cohort.anchor.quote}</blockquote><p className="whitespace-pre-wrap">{selected.body.cohort.rationale}</p><p className="break-words">{selected.body.cohort.rowIds.join(', ')}</p><p>{pt('cohort_notice',selected.body.profile.cohort.notice)}</p></div>}
        <ul className="text-sm space-y-2">{selected.body.bindings.map((b:any)=><li key={b.role}><b>{b.role}: {b.column}</b> [{b.columnDefinition.unit}] · {b.origin}<p>{b.rationale}</p>{b.substitution&&<p>{t('variant_detail',{difference:b.substitution.body.constructDifference,validation:b.substitution.body.validationNeeded})}</p>}</li>)}</ul>
        <p className="text-sm">{t('plan_counts',{unbound:selected.body.unboundRequirements.length,other:selected.body.otherOperations.length,ambiguities:selected.body.ambiguities.length,missing:selected.body.missingPolicy})}</p>
        <details open><summary>{t('exact_spec')}</summary><pre className="text-xs whitespace-pre-wrap break-all max-h-64 overflow-auto">{JSON.stringify(selected.method.spec,null,2)}</pre></details>
        <details><summary>{t('debug')}</summary><pre className="text-xs whitespace-pre-wrap break-all max-h-96 overflow-auto">{JSON.stringify(selected,null,2)}</pre></details>
        {selected.method.approvalState!=='APPROVED'?<><label className="block text-sm"><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)} disabled={busy}/> {t('reviewed_check')}</label><button className={buttonClass} disabled={busy||!reviewed||!access.capabilities.includes('method.approve')} onClick={()=>act(async()=>{setSelected((await api(`/api/research/operations/${selected.id}/approve`,{expectedHash:selected.hash,methodHash:selected.method.hash})).operation);setReviewed(false);})}>{t('approve_method')}</button></>
          :<button className={buttonClass} disabled={busy||!access.capabilities.includes('workbench.analyze')} onClick={()=>act(async()=>{try{const r=await api(`/api/research/operations/${selected.id}/execute`,{expectedHash:selected.hash});setResult(r.result);}finally{setSelected((await api(`/api/research/operations/${selected.id}`)).operation);}})}>{t('execute')}</button>}
        {profile?.comparison && <PaperComparison key={selected.hash} operation={selected} profile={profile.comparison} parentBusy={busy}/>}
        {selected.runs.map((r:any)=><div key={r.id} className="text-sm border-t pt-2 flex flex-wrap gap-3"><span>{r.status} · {date(r.createdAt)}</span>{r.status==='COMPLETED'&&<><button className="underline" disabled={busy} onClick={()=>act(async()=>setResult((await api(`/api/research/operations/${selected.id}/runs/${r.id}`)).result))}>{t('show_result')}</button><button className="underline" disabled={busy} onClick={()=>act(()=>download(r.id))}>{t('download_package')}</button></>}</div>)}
        {!!selected.runs.length&&<p className="text-xs">{t('package_note')}</p>}
        {result&&<div data-testid="paper-operation-result" className="space-y-2"><p className="font-semibold">{t('result_heading',{meaning:result.paperBinding?.body.meaning??'—'})}</p><div className="overflow-x-auto"><table className="w-full text-sm text-left"><caption className="sr-only">{t('result_caption')}</caption><thead><tr><th>{t('col_statistic')}</th><th>{t('col_value')}</th><th>{t('col_unit')}</th></tr></thead><tbody>{result.artifact.results.map((r:any,i:number)=><tr key={i}><td className="p-2">{r.metricKey}</td><td>{r.isMissing?t('value_undetermined'):r.valueNumeric??r.valueText??t('value_missing')}</td><td>{r.unit}</td></tr>)}</tbody></table></div><details><summary>{t('result_trace')}</summary><pre className="text-xs whitespace-pre-wrap break-all max-h-64 overflow-auto">{JSON.stringify({runId:result.runId,hash:result.hash,traceId:result.traceId,artifact:result.artifact},null,2)}</pre></details></div>}
      </div>}
    </section>
  </div>;
}

/** A contextual comparison of one immutable paper operation, never a new primary screen. */
function PaperComparison({ operation, profile, parentBusy }: { operation: any; profile: any; parentBusy: boolean }) {
  const access = useAccess(), { t, lang, errorText } = useUiText(text);
  /** A comparison label from the hashed profile, in the reader's language while it matches the bundle. */
  const L = (name: string): string => profileText(lang, `cmp_${snake(name)}`, profile[name]) ?? '';
  const [versions, setVersions] = useState<any[]>([]), [selected, setSelected] = useState<any>(null);
  const [editing, setEditing] = useState(true), [reviewed, setReviewed] = useState(false);
  const [quote, setQuote] = useState(''), [expected, setExpected] = useState(''), [expectedMissing, setExpectedMissing] = useState(false);
  const [unit, setUnit] = useState(''), [unitMissing, setUnitMissing] = useState(false);
  const [statistic, setStatistic] = useState(operation.body.method === 'describe' ? 'describe.mean' : operation.body.method);
  const [rationale, setRationale] = useState(''), [toleranceKind, setToleranceKind] = useState('absolute');
  const [toleranceValue, setToleranceValue] = useState(''), [toleranceRationale, setToleranceRationale] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null), [notice, setNotice] = useState<{ label: string; sha?: string } | null>(null), [result, setResult] = useState<any>(null);
  const disabled = busy || parentBusy, canReview = access.capabilities.includes('method.approve'), canAnalyze = access.capabilities.includes('workbench.analyze');
  const loadVersions = async () => setVersions((await api(`/api/research/comparisons?operationId=${encodeURIComponent(operation.id)}`)).comparisons);
  useEffect(() => { let live = true; api(`/api/research/comparisons?operationId=${encodeURIComponent(operation.id)}`)
    .then(r => { if (live) setVersions(r.comparisons); }).catch(e => { if (live) setError(e); }); return () => { live = false; };
  }, [operation.id]);
  const act = async (fn: () => Promise<void>) => { setBusy(true); setError(null); setNotice(null); try { await fn(); } catch (e) { setError(e); } finally { try { await loadVersions(); } catch (e) { setError(e); } setBusy(false); } };
  const open = async (id: string) => { setSelected((await api(`/api/research/comparisons/${id}`)).comparison); setEditing(false); setReviewed(false); setResult(null); };
  const revise = () => { const c = selected.body.claim; setQuote(c.quote); setExpected(c.expectedValue === null ? '' : String(c.expectedValue)); setExpectedMissing(c.expectedValue === null);
    setUnit(c.unit ?? ''); setUnitMissing(c.unit === null); setStatistic(c.statistic); setRationale(c.rationale); setToleranceKind(c.tolerance.kind);
    setToleranceValue(String(c.tolerance.value)); setToleranceRationale(c.tolerance.rationale); setReviewed(false); setResult(null); setEditing(true); };
  const valid = quote.length > 0 && rationale.trim().length > 0 && toleranceRationale.trim().length > 0 &&
    (expectedMissing || expected.trim() !== '' && Number.isFinite(Number(expected))) && (unitMissing || unit.trim().length > 0) &&
    toleranceValue.trim() !== '' && Number.isFinite(Number(toleranceValue)) && Number(toleranceValue) >= 0;
  const save = async () => { const response = await api('/api/research/comparisons', { operationId: operation.id, operationHash: operation.hash,
    claim: { quote, expectedValue: expectedMissing ? null : Number(expected), unit: unitMissing ? null : unit.trim(), statistic, rationale,
      tolerance: { kind: toleranceKind, value: Number(toleranceValue), rationale: toleranceRationale } }, supersedes: selected ? { id: selected.id, hash: selected.hash } : null });
    setSelected(response.comparison); setEditing(false); setReviewed(false); setResult(null); setNotice({ label: 'saveNotice' }); };
  const download = async (runId: string) => { const response = await fetch(`/api/research/comparisons/${selected.id}/runs/${runId}/export`, { cache: 'no-store' });
    if (!response.ok) { const e = await response.json(); throw e.message ? responseError(response, e) : clientError('comparison_export_failed', 'The comparison export failed.'); }
    const url = URL.createObjectURL(await response.blob()), anchor = document.createElement('a'); anchor.href = url; anchor.download = 'watchdog-paper-comparison.zip'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
    setNotice({ label: 'downloadNotice', sha: response.headers.get('X-Package-Manifest-SHA256') ?? '—' }); };
  const selectedClaim = selected?.body.claim;
  const core = result?.paperComparison?.core ?? result?.result?.paperComparison?.core;
  return <section className="border rounded p-3 space-y-3 min-w-0" data-testid="paper-comparison">
    <h4 className="font-semibold">{L('title')}</h4><p className="text-sm bg-amber-50 p-3">{L('notice')}</p><p className="text-sm">{L('inheritedLabel')}</p>
    {error !== null && <p role="alert" className="text-red-800 break-words">{error instanceof Error && (error as { code?: string }).code === 'comparison_export_failed' ? L('downloadError') : errorText(error)}</p>}{notice && <p role="status" className="text-sm break-all">{notice.sha === undefined ? L(notice.label) : `${L(notice.label)} ${notice.sha}`}</p>}
    <details><summary>{L('sourceLabel')}</summary><pre className="text-sm whitespace-pre-wrap break-words max-h-64 overflow-auto">{operation.body.document.body.text}</pre></details>
    {editing && <fieldset disabled={disabled} className="space-y-3 min-w-0" data-testid="paper-comparison-editor">
      {selected && <p className="text-xs break-all">{L('versionLabel')}: {selected.id} → {L('saveLabel')}</p>}
      <label className="block">{L('quoteLabel')}<textarea aria-label={L('quoteLabel')} className={formClass} value={quote} onChange={e => setQuote(e.target.value)} rows={3}/></label>
      <div className="grid sm:grid-cols-2 gap-3"><div className="space-y-2"><label className="block">{L('expectedLabel')}<input type="number" step="any" aria-label={L('expectedLabel')} className={formClass} value={expected} disabled={expectedMissing} onChange={e => setExpected(e.target.value)}/></label>
        <label className="block text-sm"><input type="checkbox" checked={expectedMissing} onChange={e => setExpectedMissing(e.target.checked)}/> {L('expectedMissingLabel')}</label></div>
        <div className="space-y-2"><label className="block">{L('unitLabel')}<input aria-label={L('unitLabel')} className={formClass} value={unit} disabled={unitMissing} onChange={e => setUnit(e.target.value)}/></label>
          <label className="block text-sm"><input type="checkbox" checked={unitMissing} onChange={e => setUnitMissing(e.target.checked)}/> {L('unitMissingLabel')}</label></div></div>
      <label className="block">{L('statisticLabel')}<select aria-label={L('statisticLabel')} className={formClass} value={statistic} onChange={e => setStatistic(e.target.value)}>
        {profile.statistics.filter((s: any) => operation.body.method === 'describe' ? s.id.startsWith('describe.') : s.id === operation.body.method).map((s: any) => <option key={s.id} value={s.id}>{profileText(lang, statKey(s.id), s.label)}</option>)}
      </select></label>
      <label className="block">{L('rationaleLabel')}<textarea aria-label={L('rationaleLabel')} className={formClass} value={rationale} onChange={e => setRationale(e.target.value)} rows={2}/></label>
      <div className="grid sm:grid-cols-2 gap-3"><label>{L('toleranceKindLabel')}<select aria-label={L('toleranceKindLabel')} className={formClass} value={toleranceKind} onChange={e => setToleranceKind(e.target.value)}><option value="absolute">{L('absoluteLabel')}</option><option value="relative">{L('relativeLabel')}</option></select></label>
        <label>{L('toleranceValueLabel')}<input type="number" step="any" min="0" aria-label={L('toleranceValueLabel')} className={formClass} value={toleranceValue} onChange={e => setToleranceValue(e.target.value)}/></label></div>
      <label className="block">{L('toleranceRationaleLabel')}<textarea aria-label={L('toleranceRationaleLabel')} className={formClass} value={toleranceRationale} onChange={e => setToleranceRationale(e.target.value)} rows={2}/></label>
      <button className={buttonClass} disabled={!valid || !canAnalyze} onClick={() => act(save)}>{L('saveLabel')}</button>
    </fieldset>}
    {selected && !editing && <div className="space-y-3" data-testid="paper-comparison-review">
      <p className="text-xs break-all">{L('versionLabel')}: {selected.id} · {t('hash_label')} {selected.hash}</p>
      <blockquote className="border-l-2 pl-3 whitespace-pre-wrap break-words">{selectedClaim.quote}</blockquote>
      <dl className="text-sm space-y-1"><div><dt className="inline font-semibold">{L('expectedLabel')}: </dt><dd className="inline">{selectedClaim.expectedValue ?? L('missingLabel')}</dd></div>
        <div><dt className="inline font-semibold">{L('unitLabel')}: </dt><dd className="inline">{selectedClaim.unit ?? L('missingLabel')}</dd></div>
        <div><dt className="inline font-semibold">{L('statisticLabel')}: </dt><dd className="inline">{selectedClaim.statistic}</dd></div>
        <div><dt className="inline font-semibold">{L('rationaleLabel')}: </dt><dd className="inline whitespace-pre-wrap">{selectedClaim.rationale}</dd></div>
        <div><dt className="inline font-semibold">{L('toleranceKindLabel')}: </dt><dd className="inline">{selectedClaim.tolerance.kind === 'absolute' ? L('absoluteLabel') : L('relativeLabel')} · {selectedClaim.tolerance.value}</dd></div>
        <div><dt className="inline font-semibold">{L('toleranceRationaleLabel')}: </dt><dd className="inline whitespace-pre-wrap">{selectedClaim.tolerance.rationale}</dd></div></dl>
      <p className="text-sm" data-testid="paper-comparison-approval">{selected.review ? L('reviewedLabel') : L('unreviewedLabel')}</p>
      {!selected.review ? <><label className="block text-sm"><input type="checkbox" checked={reviewed} disabled={disabled} onChange={e => setReviewed(e.target.checked)}/> {L('reviewLabel')}</label>
        <button className={buttonClass} disabled={disabled || !reviewed || !canReview} onClick={() => act(async () => { setSelected((await api(`/api/research/comparisons/${selected.id}/approve`, { expectedHash: selected.hash })).comparison); setReviewed(false); })}>{L('approveLabel')}</button></>
        : <div className="flex flex-wrap gap-3"><button className={buttonClass} disabled={disabled || !canAnalyze || operation.method.approvalState !== 'APPROVED'} onClick={() => act(async () => {
          try { const r = await api(`/api/research/comparisons/${selected.id}/execute`, { expectedHash: selected.hash }); setResult(r.result); }
          finally { setSelected((await api(`/api/research/comparisons/${selected.id}`)).comparison); }
        })}>{L('executeLabel')}</button><button className="underline text-sm" disabled={disabled || !canReview} onClick={() => act(async () => { setSelected((await api(`/api/research/comparisons/${selected.id}/revoke`, { expectedHash: selected.hash })).comparison); setReviewed(false); setResult(null); })}>{L('revokeLabel')}</button></div>}
      {operation.method.approvalState !== 'APPROVED' && <p className="text-sm">{L('methodRequiredLabel')}</p>}
      <button className="underline text-sm" disabled={disabled || !canAnalyze} onClick={revise}>{L('reviseLabel')}</button>
      <details data-testid="paper-comparison-exposure"><summary>{L('priorExposureLabel')}</summary><p className="text-sm">{L('exposureNotice')}</p><pre className="text-xs whitespace-pre-wrap break-all max-h-64 overflow-auto">{JSON.stringify(selected.body.priorExposure, null, 2)}</pre></details>
      <h5 className="font-semibold text-sm">{L('attemptsLabel')}</h5>
      {!selected.attempts.length && <p className="text-sm">{L('noAttemptsLabel')}</p>}
      {selected.attempts.map((attempt: any) => <div key={attempt.id} className="border-t pt-2 text-sm space-y-2" data-testid="paper-comparison-attempt"><p className="break-all">{attempt.status} · {attempt.runId} · {attempt.id}</p>
        {attempt.resultHash && <div className="flex flex-wrap gap-3"><button className="underline" disabled={disabled} onClick={() => act(async () => setResult((await api(`/api/research/comparisons/${selected.id}/runs/${attempt.runId}`)).result))}>{L('showResultLabel')}</button>
          <button className="underline" disabled={disabled} onClick={() => act(() => download(attempt.runId))}>{L('exportLabel')}</button></div>}
      </div>)}
      <details><summary>{L('detailsLabel')}</summary><pre className="text-xs whitespace-pre-wrap break-all max-h-64 overflow-auto">{JSON.stringify(selected, null, 2)}</pre></details>
      {core && <div data-testid="paper-comparison-result" className="space-y-2"><h5 className="font-semibold">{L('resultLabel')}</h5>
        <p className="text-sm"><b>{L('verdictLabel')}: </b>{core.verdict}</p>
        <div className="overflow-x-auto"><table className="w-full text-sm text-left"><thead><tr><th>{L('expectedLabel')}</th><th>{L('observedLabel')}</th><th>{L('deviationLabel')}</th></tr></thead><tbody><tr><td>{core.expectedValue ?? L('missingLabel')} · {core.expectedUnit ?? L('missingLabel')}</td><td>{core.observedValue ?? L('missingLabel')} · {core.observedUnit ?? L('missingLabel')}</td><td>{core.deviation ?? L('missingLabel')}</td></tr></tbody></table></div>
        <p className="text-sm break-words"><b>{L('reasonLabel')}: </b>{core.reason} · {core.rationale}</p>
        <details><summary>{L('rawResultLabel')}</summary><pre className="text-xs whitespace-pre-wrap break-all max-h-96 overflow-auto">{JSON.stringify(core, null, 2)}</pre></details>
      </div>}
    </div>}
    <details open data-testid="paper-comparison-history"><summary>{L('historyLabel')} ({versions.length})</summary><div className="space-y-2 pt-2">{versions.map(v => <button key={v.id} disabled={disabled} className="block underline text-sm break-all text-left" onClick={() => act(() => open(v.id))}>{L('openLabel')} · {v.id} · {v.review ? L('reviewedLabel') : L('unreviewedLabel')} · {v.attempts.length}</button>)}</div></details>
  </section>;
}
