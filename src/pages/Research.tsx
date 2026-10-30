import { PaperOperations } from '../components/PaperOperations';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { automationApi as api, formClass, buttonClass, sectionClass } from '../lib/automation_client';
import { useAccess } from '../lib/access';
import { useLlmReadiness } from '../lib/llm_readiness';
import type { PaperInput, SubstitutionInput } from '../../shared/research';
import { CopyPlanBuilder, SubstitutionEditor, ExpectedRecordsForm, ExtractionResult } from '../components/ResearchControls';
import { ExtractionDatasetForm } from '../components/ExtractionDatasetForm';
import text from '../../config/ui/research.json';
import { useUiText } from '../lib/ui_text';
import { clientError, responseError } from '../lib/api_error';

type NoticeKey = keyof typeof text.languages.en;
/** A typed-in JSON value; a syntax error becomes a coded error so its label follows the interface language. */
const parseJson = (value: string) => { try { return JSON.parse(value); } catch (e) { throw clientError('invalid_json_input', (e as Error).message, { detail: (e as Error).message }); } };

export function Research() {
  const access = useAccess();
  return <ResearchContent key={access.principalId ?? 'pending'} />;
}

function ResearchContent() {
  const access = useAccess(), [params] = useSearchParams(), llm = useLlmReadiness(), { t, errorText, date } = useUiText(text);
  const requestedDocument = params.get('document');
  const [data,setData] = useState<any>(null), [tab,setTab] = useState('papers'), [error,setError] = useState<unknown>(null), [notice,setNotice] = useState<NoticeKey|''>(''), [busy,setBusy] = useState(false);
  const [paper,setPaper] = useState<PaperInput>({ title:'', source:'', text:'', coverage:'excerpt', language:null, geography:[] });
  const [raw,setRaw] = useState(''), [format,setFormat] = useState<'json'|'csv'|'html'|'pdf'>('json'), [pdfLines,setPdfLines] = useState<any>(null), [lineQuery,setLineQuery] = useState({page:1,top:800,bottom:0,tolerance:2,raisedWindow:0}), [converted,setConverted] = useState<any>(null), [htmlTables,setHtmlTables] = useState<any[]|null>(null), [goal,setGoal] = useState(''), [plan,setPlan] = useState(''), [expected,setExpected] = useState('');
  const [selected,setSelected] = useState<any>(null), [trial,setTrial] = useState<any>(null), [substitution,setSubstitution] = useState<SubstitutionInput|null>(null), [openedSource,setOpenedSource]=useState<any>(null);
  const [trials,setTrials]=useState<any[]>([]);
  const [operationDocument,setOperationDocument]=useState<string|undefined>();
  useEffect(()=>{setExpected('');},[selected?.id]);
  const refresh = async () => setData(await api('/api/research'));
  useEffect(() => { let active=true; setData(null); setSelected(null); setTrial(null);
    api('/api/research').then(r => active && setData(r)).catch(e => active && setError(e)); return () => { active=false; };
  },[access.principalId]);
  useEffect(() => { let active=true; setOpenedSource(null);
    if (requestedDocument) api(`/api/research/papers/${encodeURIComponent(requestedDocument)}`).then(result => {
      if (active) { setOpenedSource(result.document); setTab('papers'); }
    }).catch(e => { if (active) setError(e); });
    return () => { active=false; };
  }, [requestedDocument, access.principalId]);
  useEffect(()=>{let active=true;setTrials([]);if(!selected)return;
    api(`/api/research/extractors/${selected.id}/trials`).then(r=>{if(active)setTrials(r.trials);}).catch(e=>{if(active)setError(e);});
    return ()=>{active=false;};
  },[selected?.id,trial?.id]);
  const activeJobs = !!data?.jobs?.some((j:any)=>['QUEUED','RUNNING'].includes(j.status));
  useEffect(()=>{ if(!activeJobs)return;let active=true;
    const timer=setInterval(()=>{api('/api/research').then(r=>{if(active)setData(r);}).catch(e=>{if(active)setError(e);});},3000);
    return ()=>{active=false;clearInterval(timer);};
  },[activeJobs]);
  const act = async (fn:()=>Promise<unknown>,message:NoticeKey='notice_saved') => { setBusy(true);setError(null);setNotice('');try{await fn();await refresh();setNotice(message);}catch(e){setError(e);}finally{setBusy(false);} };
  const fileText = async (file:File|null, callback:(t:string)=>void) => { if(!file)return; if(file.size>2000000){setError(clientError('file_too_large','The file exceeds 2 MB.'));return;}try{callback(await file.text());}catch{setError(clientError('file_unreadable','The file could not be read.'));} };
  const saveResult = () => { const blob=new Blob([JSON.stringify(trial,null,2)],{type:'application/json'}), url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='watchdog-extraction.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),0); };
  return <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-5" data-testid="research-page">
    <header><h1 className="text-2xl font-semibold">{t('title')}</h1><p className="text-slate-600 mt-2">{t('intro')}</p></header>
    {requestedDocument && openedSource && <section className={sectionClass} data-testid="research-linked-paper"><h2 className="font-semibold">{openedSource.body.title}</h2>
      <p className="text-sm break-words">{openedSource.body.source} · {openedSource.body.coverage}</p><p className="text-xs break-all">{t('version_hash',{hash:openedSource.hash})}</p>
      <pre className="text-sm whitespace-pre-wrap break-words max-h-80 overflow-auto">{openedSource.body.text || t('identifier_only_saved')}</pre>
      {openedSource.origins?.map((origin:any) => <p key={origin.hash} className="text-xs break-all"><a className="underline" href={`/api/memory/receipts/${origin.receiptId}/raw`}>{t('download_original')}</a> · {t('discovery_version',{hash:origin.discoveryHash})}</p>)}
    </section>}
    <div className="flex flex-wrap gap-3"><button className={buttonClass} onClick={()=>setTab('papers')}>{t('tab_papers')}</button><button className={buttonClass} onClick={()=>setTab('extractors')}>{t('tab_extractors')}</button><button className={buttonClass} onClick={()=>setTab('operations')}>{t('tab_operations')}</button><button className="underline" onClick={()=>act(async()=>{},'notice_refreshed')}>{t('refresh_queue')}</button></div>
    {error!==null && <p role="alert" className="bg-red-50 text-red-800 p-3 break-words">{errorText(error)}</p>}{notice && <p role="status">{t(notice)}</p>}
    {activeJobs && <p className="text-sm" role="status">{t('jobs_active')} <Link to="/automation" className="underline">{t('jobs_open_queue')}</Link>.</p>}
    {tab==='operations' ? <PaperOperations key={operationDocument??'catalog'} documents={data?.documents??[]} assessments={data?.assessments??[]} substitutions={data?.substitutions??[]} initialDocumentId={operationDocument}/> : tab==='papers' ? <>
      {params.get('discovery') && <div className={sectionClass}><p>{t('discovery_selected')}</p><button className={buttonClass} disabled={busy} onClick={()=>act(()=>api('/api/research/papers/discovery',{id:params.get('discovery')}))}>{t('discovery_add')}</button></div>}
      <section className={sectionClass}><h2 className="font-semibold">{t('add_paper')}</h2>
        <div className="grid sm:grid-cols-2 gap-3"><label>{t('paper_title')}<input className={formClass} value={paper.title} onChange={e=>setPaper({...paper,title:e.target.value})}/></label><label>{t('paper_source')}<input className={formClass} value={paper.source} onChange={e=>setPaper({...paper,source:e.target.value})}/></label></div>
        <label className="block">{t('coverage')}<select aria-label={t('coverage')} className={formClass} value={paper.coverage} onChange={e=>setPaper({...paper,coverage:e.target.value as PaperInput['coverage']})}><option value="full_text">{t('coverage_full_text')}</option><option value="excerpt">{t('coverage_excerpt')}</option><option value="abstract">{t('coverage_abstract')}</option><option value="identifier_only">{t('coverage_identifier_only')}</option></select></label>
        <label className="block">{t('source_text')}<textarea className={formClass} rows={6} value={paper.text} onChange={e=>{ const { conversion, ...rest } = paper as any; setPaper({...rest,text:e.target.value}); if (conversion) setConverted({ ...converted, edited: true }); }}/></label>
        <label className="block text-sm">{t('convert_file')}<input type="file" accept=".html,.htm,.pdf,text/html,application/pdf" className="block max-w-full" data-testid="paper-convert-file"
          onChange={e=>{ const f=e.target.files?.[0]; if (!f) return; void act(async()=>{ const fmt=/\.pdf$/i.test(f.name)||f.type==='application/pdf'?'pdf':'html';
            const r=await fetch(`/api/research/convert?format=${fmt}`,{method:'POST',headers:{'Content-Type':fmt==='pdf'?'application/pdf':'text/html'},body:f}); const d=await r.json(); if(!r.ok) throw responseError(r,d);
            setPaper({...paper,text:d.text,title:paper.title||d.title||'',conversion:d.conversion} as any); setConverted({ ...d, file: f.name, edited: false }); },'notice_converted'); }}/></label>
        {converted && <p className="text-xs" data-testid="conversion-note">{t('conversion_note',{file:converted.file,format:converted.conversion.format.toUpperCase(),parser:converted.conversion.parser,parser_version:converted.conversion.parserVersion,sha:converted.conversion.rawSha256.slice(0,16),pages:converted.conversion.pages?t('conversion_pages',{count:converted.conversion.pages.length}):''})}
          {converted.warning && <b className="block text-amber-900">{converted.warning}</b>}{converted.edited && <b className="block">{t('conversion_edited')}</b>}</p>}
        <div className="grid sm:grid-cols-2 gap-3"><label>{t('paper_language')}<input className={formClass} value={paper.language??''} onChange={e=>setPaper({...paper,language:e.target.value||null})} placeholder={t('paper_language_placeholder')}/></label>
          <label>{t('paper_geography')}<input className={formClass} value={paper.geography.join(',')} onChange={e=>setPaper({...paper,geography:e.target.value?e.target.value.split(','):[]})} placeholder={t('paper_geography_placeholder')}/></label></div>
        <label className="block text-sm">{t('load_text_file')}<input type="file" accept=".txt,.md,text/plain,text/markdown" className="block max-w-full" onChange={e=>void fileText(e.target.files?.[0]??null,text=>setPaper({...paper,text}))}/></label>
        <p className="text-xs">{t('intake_note')}</p>
        <button className={buttonClass} disabled={busy||!paper.title||!paper.source} data-testid="paper-intake-save" onClick={()=>act(()=>api('/api/research/papers',paper))}>{t('save_paper')}</button>
      </section>
      <section className={sectionClass}><h2 className="font-semibold">{t('saved_papers')}</h2>
        {!data?.documents.length && <p>{t('no_papers')}</p>}
        {data?.documents.map((d:any)=><article key={d.id} className="border-t pt-3 space-y-2"><b>{d.body.title}</b><p className="text-xs break-words">{d.body.coverage} · {d.body.source}</p>
          <button className="underline text-sm block" onClick={()=>act(async()=>setOpenedSource((await api(`/api/research/papers/${d.id}`)).document),'notice_opened_source')}>{t('show_saved_text')}</button>
          {!requestedDocument && openedSource?.id===d.id && <details open><summary>{t('source_text_chars',{count:d.characterCount})}</summary><p className="text-xs break-all">{t('version_hash',{hash:openedSource.hash})}</p><pre className="text-sm whitespace-pre-wrap break-words max-h-80 overflow-auto">{openedSource.body.text}</pre>
            {openedSource.origins?.map((o:any)=><p key={o.hash} className="text-xs break-all"><a className="underline" href={`/api/memory/receipts/${o.receiptId}/raw`}>{t('download_original')}</a> · {t('discovery_version',{hash:o.discoveryHash})}</p>)}
          </details>}
          {d.body.coverage!=='identifier_only' && <button className={buttonClass} onClick={()=>{setOperationDocument(d.id);setTab('operations');}}>{t('bind_operation')}</button>}
          <button className={buttonClass} title={llm.ready?undefined:llm.reason} disabled={busy||!llm.ready||d.body.coverage==='identifier_only'||!access.capabilities.includes('run.create')||data.assessments.some((a:any)=>a.documentId===d.id&&a.status!=='FAILED')||data.jobs.some((j:any)=>j.request.documentId===d.id&&['QUEUED','RUNNING'].includes(j.status))} onClick={()=>act(()=>api(`/api/research/papers/${d.id}/assess`,{consent:true,retryFailed:data.assessments.some((a:any)=>a.documentId===d.id&&a.status==='FAILED')}),'notice_assess_queued')}>{t('assess')}</button>
          {data.assessments.filter((a:any)=>a.documentId===d.id).map((a:any)=><div key={a.id} className="bg-slate-50 p-3 rounded space-y-2 text-sm"><p className="font-semibold">{a.status} · {a.body?.replicability??t('assessment_pending')}</p>
            {a.body?.error && <p>{t('assessment_failed_before')} <Link to="/setup" className="underline">{t('assessment_failed_link')}</Link>{t('assessment_failed_after')}</p>}
            {a.body?.assessment && <><p>{t('assessment_proposal')}</p>
              {a.body.assessment.methodology.map((m:any,i:number)=><div key={i}><p className="font-medium">{m.statement}</p><blockquote className="border-l-2 border-slate-400 pl-3 whitespace-pre-wrap">{m.quote}</blockquote></div>)}
              {a.body.assessment.dataRequirements.map((r:any)=><details key={r.id}><summary><b>{r.id}</b>: {r.construct} · {t('availability_unverified')}</summary><p>{r.statement}</p><blockquote className="border-l-2 pl-3">{r.quote}</blockquote><p>{r.acquisition} · {r.sourceLocator??t('source_to_establish')}</p></details>)}
              {a.body.assessment.dataRequirements.length>0 && <button className="underline" onClick={()=>setSubstitution({assessmentId:a.id,assessmentHash:a.hash,requirementId:a.body.assessment.dataRequirements[0].id,kind:'prior_dataset',source:'',sourceHash:null,constructDifference:'',validationNeeded:''})}>{t('prepare_variant')}</button>}</>}
            <details><summary>{t('assessment_details')}</summary><pre className="text-xs whitespace-pre-wrap break-all max-h-96 overflow-auto">{JSON.stringify(a,null,2)}</pre></details>
          </div>)}
        </article>)}
      </section>
      <details className={sectionClass} open={!!substitution}><summary>{t('variants')}</summary><p className="text-sm">{t('variants_note')}</p>
        {substitution ? <SubstitutionEditor value={substitution} onChange={setSubstitution} requirements={data?.assessments.find((a:any)=>a.id===substitution.assessmentId)?.body?.assessment.dataRequirements??[]} busy={busy} onSave={()=>act(()=>api('/api/research/substitutions',substitution))}/> : <p className="text-sm">{t('variants_hint')}</p>}
        {data?.substitutions.map((s:any)=><details key={s.id}><summary>{s.body.kind} · {s.body.meaning}</summary><pre className="text-xs whitespace-pre-wrap break-all">{JSON.stringify(s,null,2)}</pre></details>)}
      </details>
    </> : <>
      <section className={sectionClass}><h2 className="font-semibold">{t('extractor_heading')}</h2>
        {!llm.ready && <p className="text-xs text-amber-900" data-testid="llm-unavailable">{t('llm_disabled',{reason:llm.reason??''})}</p>}
        <p className="text-sm">{t('extractor_note')}</p>
        <label className="block">{t('source_format')}<select aria-label={t('source_format')} className={formClass} value={format} onChange={e=>setFormat(e.target.value as 'json'|'csv'|'html'|'pdf')}><option value="json">{t('format_json')}</option><option value="csv">{t('format_csv')}</option><option value="html">{t('format_html')}</option><option value="pdf">{t('format_pdf')}</option></select></label>
        <label className="block">{t('extractor_source')}<textarea className={formClass} rows={5} value={raw} onChange={e=>setRaw(e.target.value)}/></label>
        <input aria-label={t('extractor_file')} className="max-w-full" type="file" accept=".json,.csv,.html,.htm,text/csv,application/json,text/html" onChange={e=>void fileText(e.target.files?.[0]??null,setRaw)}/>
        {format==='pdf' && <div className="space-y-2 text-sm" data-testid="pdf-source"><label className="block">{t('pdf_file')}<input type="file" accept=".pdf,application/pdf" data-testid="pdf-layout-file" className="block max-w-full"
            onChange={e=>{ const f=e.target.files?.[0]; if(!f) return; void act(async()=>{ const r=await fetch('/api/research/convert?format=pdf&layout=1',{method:'POST',headers:{'Content-Type':'application/pdf'},body:f}); const d=await r.json(); if(!r.ok) throw responseError(r,d); setRaw(d.layout); setPdfLines(null); },'notice_pdf_layout'); }}/></label>
          {raw && <><div className="grid sm:grid-cols-5 gap-2">{(['page','top','bottom','tolerance','raisedWindow'] as const).map(k=><label key={k}>{t(({page:'pdf_page',top:'pdf_top',bottom:'pdf_bottom',tolerance:'pdf_tolerance',raisedWindow:'pdf_raised_window'} as const)[k])}<input type="number" step="any" className={formClass} value={(lineQuery as any)[k]} onChange={e=>setLineQuery({...lineQuery,[k]:Number(e.target.value)})}/></label>)}</div>
            <button className="underline" data-testid="pdf-lines" onClick={()=>act(async()=>setPdfLines(await api('/api/research/pdf-lines',{raw,...lineQuery})))}>{t('pdf_show_lines')}</button></>}
          {pdfLines && <div data-testid="pdf-lines-result"><p>{t('pdf_boundaries')} <b>{pdfLines.proposedBoundaries.join(', ')||t('pdf_boundaries_none')}</b> · {t('pdf_page_size',{width:pdfLines.width,height:pdfLines.height})}</p>
            <ul className="text-xs font-mono max-h-64 overflow-auto">{pdfLines.lines.map((l:any,i:number)=><li key={i}>y={l.y}: {l.items.map((it:any)=>`${it.str}@${it.x}`).join('  ')}</li>)}</ul></div>}</div>}
        {format==='html' && raw && <button className="underline text-sm" onClick={()=>act(async()=>{ const r=await fetch('/api/research/convert?format=html',{method:'POST',headers:{'Content-Type':'text/html'},body:raw}); const d=await r.json(); if(!r.ok) throw responseError(r,d); setHtmlTables(d.tables); })} data-testid="list-html-tables">{t('html_list_tables')}</button>}
        {format==='html' && htmlTables && <ul className="text-xs" data-testid="html-tables">{htmlTables.length===0?<li>{t('html_no_tables')}</li>:htmlTables.map((tb:any)=><li key={tb.index}>{t('html_table',{index:tb.index,caption:tb.caption?t('html_table_caption',{caption:tb.caption}):'',rows:tb.rows,columns:tb.columns,first_row:tb.firstRow.join(' | ')})}</li>)}</ul>}
        <label className="block">{t('goal')}<input className={formClass} value={goal} onChange={e=>setGoal(e.target.value)}/></label>
        <button className={buttonClass} title={llm.ready?undefined:llm.reason} disabled={busy||!llm.ready||!raw||!goal} onClick={()=>act(async()=>{const r=await api('/api/research/extractors/propose',{raw,format,goal,consent:true});setSelected(r.extractor);setPlan(JSON.stringify(r.extractor.body.plan,null,2));},'notice_proposed')}>{t('propose_parser')}</button>
        <CopyPlanBuilder key={format} format={format} busy={busy} pdfDefaults={pdfLines?{page:lineQuery.page,top:lineQuery.top,bottom:lineQuery.bottom,boundaries:pdfLines.proposedBoundaries}:undefined} onSave={value=>act(async()=>{const c=(await api('/api/research/extractors',value)).extractor;setSelected(c);setTrial(null);setPlan(JSON.stringify(c.body.plan,null,2));},'notice_mapping_saved')}/>
        <details><summary>{t('plan_json')}</summary><p className="text-xs">{t('plan_json_note')}</p>
          <textarea aria-label={t('plan_json_label')} className={formClass} rows={8} value={plan} onChange={e=>setPlan(e.target.value)}/>
          <button className={buttonClass} disabled={busy||!plan} onClick={()=>act(async()=>{setSelected((await api('/api/research/extractors',parseJson(plan))).extractor);})}>{t('save_parser_version')}</button></details>
      </section>
      <section className={sectionClass}><h2 className="font-semibold">{t('test_heading')}</h2>
        <label className="block">{t('choose_parser')}<select aria-label={t('choose_parser')} className={formClass} value={selected?.id??''} onChange={e=>{setSelected(data.extractors.find((c:any)=>c.id===e.target.value));setTrial(null);}}><option value="">{t('choose')}</option>{data?.extractors.map((c:any)=><option key={c.id} value={c.id}>{c.body.plan.name} · {c.approvalState}</option>)}</select></label>
        {selected && <ExpectedRecordsForm key={selected.id} fields={selected.body.plan.fields} busy={busy} onInvalidate={()=>{setExpected('');setNotice('notice_form_changed');}} onApply={value=>{setExpected(JSON.stringify(value,null,2));setNotice('notice_expected_applied');}}/>}
        <details><summary>{t('expected_advanced')}</summary><label className="block">{t('expected_json')}<textarea className={formClass} rows={4} value={expected} onChange={e=>setExpected(e.target.value)}/></label></details>
        <div className="flex flex-wrap gap-3"><button className={buttonClass} disabled={busy||!selected||!raw||!expected} onClick={()=>act(async()=>setTrial((await api(`/api/research/extractors/${selected.id}/test`,{raw,expected:parseJson(expected)})).trial),'notice_test_saved')}>{t('test_copy')}</button>
          {access.capabilities.includes('dataset.approve') && <button className={buttonClass} disabled={busy||!selected||trial?.body.passed!==true||trial?.body.candidateHash!==selected.hash} onClick={()=>act(async()=>setSelected((await api(`/api/research/extractors/${selected.id}/approve`,{expectedHash:selected.hash})).extractor),'notice_activated')}>{t('activate')}</button>}
          {access.capabilities.includes('dataset.import') && <button className={buttonClass} disabled={busy||!raw||selected?.approvalState!=='APPROVED'} onClick={()=>act(async()=>setTrial((await api(`/api/research/extractors/${selected.id}/run`,{raw})).trial),'notice_run')}>{t('run_parser')}</button>}</div>
        {trial && <div className="space-y-3"><ExtractionResult key={trial.id} trial={trial}/><button className="underline text-sm" onClick={saveResult}>{t('download_result')}</button>
          {trial.body.kind==='EXECUTION' && selected?.hash===trial.body.candidateHash && selected.approvalState==='APPROVED' && data?.datasetProfile && access.capabilities.includes('dataset.import') && <ExtractionDatasetForm key={`${trial.id}:${data.datasetProfile.contentHash}`} trial={trial} plan={selected.body.plan} profile={data.datasetProfile}/>}
        </div>}
        {trials.length>0 && <details><summary>{t('trial_history',{count:trials.length})}</summary><ul className="space-y-2 mt-2">{trials.map(tr=><li key={tr.id}><button className="underline text-sm" onClick={()=>act(async()=>setTrial((await api(`/api/research/trials/${tr.id}`)).trial),'notice_trial_restored')}>{tr.kind==='EXECUTION'?t('trial_execution'):tr.passed?t('trial_passed'):t('trial_failed')} · {date(tr.createdAt)}</button></li>)}</ul></details>}
      </section>
    </>}
    <p className="text-sm"><Link to="/automation" className="underline">{t('link_automation')}</Link> · <Link to="/workbench" className="underline">{t('link_workbench')}</Link> · <Link to="/setup" className="underline">{t('link_setup')}</Link></p>
  </div>;
}
