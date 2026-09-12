import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { automationApi as api, buttonClass, formClass, sectionClass } from '../lib/automation_client';
import { useAccess } from '../lib/access';
import { PaperOperationInputSchema, type PaperOperationInput } from '../../shared/paper_operation';

export function PaperOperations({ documents, assessments, substitutions, initialDocumentId }: {
  documents: any[]; assessments: any[]; substitutions: any[]; initialDocumentId?: string;
}) {
  const access = useAccess();
  const [catalog, setCatalog] = useState<any>(null), [datasets, setDatasets] = useState<any[]>([]);
  const [sourceKey, setSourceKey] = useState(initialDocumentId ? `paper:${initialDocumentId}` : ''), [sourceDoc, setSourceDoc] = useState<any>(null);
  const [datasetId, setDatasetId] = useState(''), [method, setMethod] = useState<PaperOperationInput['method']>('describe'), [quote, setQuote] = useState('');
  const empty = (role: 'a'|'b'): PaperOperationInput['bindings'][number] => ({ role, column:'', rationale:'', origin:'unspecified', requirementId:null, substitution:null });
  const [bindings, setBindings] = useState([empty('a'), empty('b')]);
  const [missingPolicy, setMissingPolicy] = useState<PaperOperationInput['missingPolicy']>('propagate'), [scopeNote, setScopeNote] = useState('');
  const [selected, setSelected] = useState<any>(null), [result, setResult] = useState<any>(null), [reviewed, setReviewed] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  useEffect(() => { let live = true;
    Promise.all([api('/api/research/operations'), api('/api/workbench/datasets')]).then(([c,d])=>{if(live){setCatalog(c);setDatasets(d.records.filter((r:any)=>r.approvalState==='APPROVED'));}}).catch(e=>{if(live)setError(e.message);});
    return ()=>{live=false;};
  }, []);
  useEffect(()=>{let live=true;setSourceDoc(null);setQuote('');setBindings([empty('a'),empty('b')]);
    const [kind,id,index] = sourceKey.split(':'), a=assessments.find(a=>a.id===id), documentId=kind==='paper'?id:a?.documentId;
    if(kind==='assessment' && ['describe','pearson','spearman'].includes(a?.body?.assessment?.operations[Number(index)]?.name))setMethod(a.body.assessment.operations[Number(index)].name);
    if(documentId)api(`/api/research/papers/${documentId}`).then(r=>{if(live)setSourceDoc(r.document);}).catch(e=>{if(live)setError(e.message);});
    return ()=>{live=false;};
  }, [sourceKey]);
  const [kind,assessmentId,operationIndex]=sourceKey.split(':'), assessment=kind==='assessment'?assessments.find(a=>a.id===assessmentId):null;
  const dataset=datasets.find(d=>d.id===datasetId), columns=dataset?.document.columns.filter((c:any)=>c.type==='number'&&c.unit&&c.semanticType!=='dimension')??[];
  const activeBindings=bindings.slice(0,method==='describe'?1:2), requirements=assessment?.body?.assessment?.dataRequirements??[];
  const source=kind==='assessment'?{kind:'assessment_operation',assessmentId,assessmentHash:assessment?.hash,operationIndex:Number(operationIndex)}
    :{kind:'manual_quote',documentId:sourceDoc?.id,documentHash:sourceDoc?.hash,quote};
  const input={source,method,datasetId,datasetHash:dataset?.contentHash,bindings:activeBindings,missingPolicy,scopeNote};
  const patch=(i:number,value:Partial<PaperOperationInput['bindings'][number]>)=>setBindings(bindings.map((b,n)=>n===i?{...b,...value}:b));
  const open=async(id:string)=>{setSelected((await api(`/api/research/operations/${id}`)).operation);setReviewed(false);setResult(null);};
  const act=async(fn:()=>Promise<void>)=>{setBusy(true);setError('');setNotice('');try{await fn();setCatalog(await api('/api/research/operations'));}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  const download=async(runId:string)=>{const response=await fetch(`/api/research/operations/${selected.id}/runs/${runId}/export`,{cache:'no-store'});
    if(!response.ok){const e=await response.json();throw new Error(e.message??'Eksport nie powiódł się.');}
    const url=URL.createObjectURL(await response.blob()),a=document.createElement('a');a.href=url;a.download='watchdog-paper-analysis.zip';a.click();setTimeout(()=>URL.revokeObjectURL(url),0);
    setNotice(`Pobrano pakiet. Zachowaj osobno SHA-256 manifestu: ${response.headers.get('X-Package-Manifest-SHA256')}`);
  };
  const profile=catalog?.profile;
  const allowedPolicies: string[] = profile?.methods.find((m:any)=>m.id===method)?.missingPolicies??[];
  useEffect(()=>{if(allowedPolicies.length&&!allowedPolicies.includes(missingPolicy))setMissingPolicy(allowedPolicies[0] as typeof missingPolicy);},[method,profile?.contentHash]);
  return <div className="space-y-5" data-testid="paper-operations">
    {error&&<p role="alert" className="bg-red-50 p-3 text-red-800 break-words">{error}</p>}
    {notice&&<p role="status" className="text-sm break-all">{notice}</p>}
    <section className={sectionClass}><h2 className="font-semibold">{profile?.title??'Analizy prac'}</h2><p className="text-sm">{profile?.introduction}</p>
      <fieldset disabled={busy} className="space-y-3 min-w-0">
        <label className="block">Praca i sposób wskazania metody<select aria-label="Praca i sposób wskazania metody" className={formClass} value={sourceKey} onChange={e=>setSourceKey(e.target.value)}><option value="">Wybierz…</option>
          {documents.filter(d=>d.body.coverage!=='identifier_only').map(d=><option key={d.id} value={`paper:${d.id}`}>Cytat ręczny · {d.body.title}</option>)}
          {assessments.filter(a=>a.status==='PROPOSED').flatMap(a=>(a.body?.assessment?.operations??[]).map((o:any,i:number)=><option key={`${a.id}:${i}`} value={`assessment:${a.id}:${i}`} disabled={!['describe','pearson','spearman'].includes(o.name)}>{o.name} · {documents.find(d=>d.id===a.documentId)?.body.title} {!['describe','pearson','spearman'].includes(o.name)?'· brak wykonawcy':''}</option>))}
        </select></label>
        {sourceDoc&&<details><summary>Zapisany tekst pracy · {sourceDoc.body.coverage}</summary><pre className="whitespace-pre-wrap break-words text-sm max-h-64 overflow-auto">{sourceDoc.body.text}</pre></details>}
        {kind==='assessment'?<blockquote className="border-l-2 pl-3 whitespace-pre-wrap break-words">{assessment?.body.assessment.operations[Number(operationIndex)]?.quote}</blockquote>
          :<label className="block">Dokładny cytat opisujący operację<textarea className={formClass} rows={3} value={quote} onChange={e=>setQuote(e.target.value)}/></label>}
        <label className="block">Operacja statystyczna<select aria-label="Operacja statystyczna" className={formClass} value={method} disabled={kind==='assessment'} onChange={e=>setMethod(e.target.value as typeof method)}>{profile?.methods.map((m:any)=><option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
        <label className="block">Zatwierdzony zbiór danych<select aria-label="Zatwierdzony zbiór danych" className={formClass} value={datasetId} onChange={e=>{setDatasetId(e.target.value);setBindings([empty('a'),empty('b')]);}}><option value="">Wybierz…</option>{datasets.map(d=><option key={d.id} value={d.id}>{d.document.name}</option>)}</select></label>
        {!datasets.length&&<p className="text-sm">Przygotuj i zatwierdź dane w <Link to="/workbench" className="underline">warsztacie statystycznym</Link>. Możesz też użyć ekstraktora.</p>}
        {dataset&&<p className="text-xs break-words">Źródło: {dataset.document.source.title}. Wiersze: {dataset.document.rows.length}. Zakres: {dataset.document.comparisonScope}. Klasy dowodów: {[...new Set(dataset.document.rows.map((r:any)=>r.evidenceTier))].join(', ')}.</p>}
        {activeBindings.map((b,i)=><fieldset key={b.role} className="border rounded p-3 space-y-3 min-w-0"><legend>Wejście {b.role.toUpperCase()}</legend>
          <div className="grid sm:grid-cols-2 gap-3"><label>Kolumna {b.role.toUpperCase()}<select aria-label={`Kolumna ${b.role.toUpperCase()}`} className={formClass} value={b.column} onChange={e=>patch(i,{column:e.target.value})}><option value="">Wybierz…</option>{columns.map((c:any)=><option key={c.key} value={c.key}>{c.label} · {c.unit}</option>)}</select></label>
          <label>Pochodzenie danych {b.role.toUpperCase()}<select aria-label={`Pochodzenie danych ${b.role.toUpperCase()}`} className={formClass} value={b.origin} onChange={e=>patch(i,{origin:e.target.value as typeof b.origin,substitution:null})}>{profile?.origins.map((o:any)=><option key={o.id} value={o.id}>{o.label}</option>)}</select></label></div>
          {requirements.length>0&&<label className="block">Wymaganie z pracy {b.role.toUpperCase()}<select aria-label={`Wymaganie z pracy ${b.role.toUpperCase()}`} className={formClass} value={b.requirementId??''} onChange={e=>patch(i,{requirementId:e.target.value||null,substitution:null})}><option value="">Dodatkowe wejście / niepowiązane wymaganie</option>{requirements.map((r:any)=><option key={r.id} value={r.id}>{r.id} · {r.construct}</option>)}</select></label>}
          {b.requirementId&&<label className="block">Zapisany wariant {b.role.toUpperCase()}<select aria-label={`Zapisany wariant ${b.role.toUpperCase()}`} className={formClass} value={b.substitution?.id??''} onChange={e=>{const s=substitutions.find(s=>s.id===e.target.value);patch(i,{substitution:s?{id:s.id,hash:s.hash}:null,...(s?{origin:s.body.kind}:{})});}}><option value="">Bez zapisanego wariantu</option>{substitutions.filter(s=>s.body.assessmentId===assessment?.id&&s.body.requirementId===b.requirementId).map(s=><option key={s.id} value={s.id}>{s.body.kind} · {s.body.source}</option>)}</select></label>}
          <label className="block">Co reprezentuje kolumna {b.role.toUpperCase()} i jakie ma ograniczenia?<textarea className={formClass} rows={2} value={b.rationale} onChange={e=>patch(i,{rationale:e.target.value})}/></label>
        </fieldset>)}
        <label className="block">Postępowanie z brakami<select aria-label="Postępowanie z brakami" className={formClass} value={missingPolicy} onChange={e=>setMissingPolicy(e.target.value as typeof missingPolicy)}>{profile?.missingPolicies.filter((m:any)=>allowedPolicies.includes(m.id)).map((m:any)=><option key={m.id} value={m.id}>{m.label}</option>)}</select></label>
        <label className="block">Zakres analizy i odstępstwa od pracy<textarea className={formClass} rows={3} value={scopeNote} onChange={e=>setScopeNote(e.target.value)}/></label>
        <p className="text-sm bg-amber-50 p-3">{profile?.scopeLabel} Pochodzenie danych pozostaje deklaracją użytkownika. Zgodność cytatu nie potwierdza interpretacji. Braki metodologiczne pozostaną przy wyniku.</p>
        <button className={buttonClass} disabled={!PaperOperationInputSchema.safeParse(input).success||!access.capabilities.includes('workbench.analyze')} onClick={()=>act(async()=>{const r=await api('/api/research/operations',input);setSelected(r.operation);setResult(null);setReviewed(false);setNotice('Plan zapisany. Przejrzyj cytat, powiązania i dokładną specyfikację poniżej.');})}>Przygotuj plan analizy pracy</button>
      </fieldset>
    </section>
    <section className={sectionClass}><h2 className="font-semibold">Zapisane plany i wykonania</h2>
      <label className="block">Zapisany plan<select aria-label="Zapisany plan" className={formClass} disabled={busy} value={selected?.id??''} onChange={e=>e.target.value&&void act(()=>open(e.target.value))}><option value="">Wybierz…</option>{catalog?.operations.map((o:any)=><option key={o.id} value={o.id}>{o.title} · {o.method} · {o.approvalState}</option>)}</select></label>
      {selected&&<div className="space-y-3" data-testid="paper-operation-review"><h3 className="font-semibold">{selected.body.document.body.title}</h3><blockquote className="border-l-2 pl-3 whitespace-pre-wrap break-words">{selected.body.anchor.quote}</blockquote>
        <p className="text-sm">{selected.body.profile.scopeLabel} <strong>{selected.body.meaning}</strong></p><p className="text-sm whitespace-pre-wrap">{selected.body.scopeNote}</p>
        <ul className="text-sm space-y-2">{selected.body.bindings.map((b:any)=><li key={b.role}><b>{b.role}: {b.column}</b> [{b.columnDefinition.unit}] · {b.origin}<p>{b.rationale}</p>{b.substitution&&<p>Wariant: {b.substitution.body.constructDifference} · Walidacja: {b.substitution.body.validationNeeded}</p>}</li>)}</ul>
        <p className="text-sm">Niepowiązane wymagania: {selected.body.unboundRequirements.length}. Pozostałe operacje: {selected.body.otherOperations.length}. Niejasności: {selected.body.ambiguities.length}. Braki danych: {selected.body.missingPolicy}.</p>
        <details open><summary>Dokładna specyfikacja do przeglądu</summary><pre className="text-xs whitespace-pre-wrap break-all max-h-64 overflow-auto">{JSON.stringify(selected.method.spec,null,2)}</pre></details>
        <details><summary>Debug: źródło, wersje, braki i pełny plan</summary><pre className="text-xs whitespace-pre-wrap break-all max-h-96 overflow-auto">{JSON.stringify(selected,null,2)}</pre></details>
        {selected.method.approvalState!=='APPROVED'?<><label className="block text-sm"><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)} disabled={busy}/> Sprawdziłem cytat, interpretację, dane i tę specyfikację.</label><button className={buttonClass} disabled={busy||!reviewed||!access.capabilities.includes('method.approve')} onClick={()=>act(async()=>{setSelected((await api(`/api/research/operations/${selected.id}/approve`,{expectedHash:selected.hash,methodHash:selected.method.hash})).operation);setReviewed(false);})}>Zatwierdź metodę tej analizy</button></>
          :<button className={buttonClass} disabled={busy||!access.capabilities.includes('workbench.analyze')} onClick={()=>act(async()=>{try{const r=await api(`/api/research/operations/${selected.id}/execute`,{expectedHash:selected.hash});setResult(r.result);}finally{setSelected((await api(`/api/research/operations/${selected.id}`)).operation);}})}>Wykonaj analizę pracy bez LLM</button>}
        {selected.runs.map((r:any)=><div key={r.id} className="text-sm border-t pt-2 flex flex-wrap gap-3"><span>{r.status} · {new Date(r.createdAt).toLocaleString()}</span>{r.status==='COMPLETED'&&<><button className="underline" disabled={busy} onClick={()=>act(async()=>setResult((await api(`/api/research/operations/${selected.id}/runs/${r.id}`)).result))}>Pokaż zapisany wynik</button><button className="underline" disabled={busy} onClick={()=>act(()=>download(r.id))}>Pobierz pakiet z publikacją</button></>}</div>)}
        {!!selected.runs.length&&<p className="text-xs">Pakiet zawiera pełny dostarczony tekst pracy i dane źródłowe. Przejrzyj je przed udostępnieniem.</p>}
        {result&&<div data-testid="paper-operation-result" className="space-y-2"><p className="font-semibold">Wynik wybranej operacji · {result.paperBinding?.body.meaning}</p><div className="overflow-x-auto"><table className="w-full text-sm text-left"><caption className="sr-only">Wyniki analizy pracy</caption><thead><tr><th>Statystyka</th><th>Wartość</th><th>Jednostka</th></tr></thead><tbody>{result.artifact.results.map((r:any,i:number)=><tr key={i}><td className="p-2">{r.metricKey}</td><td>{r.isMissing?'nieokreślona':r.valueNumeric??r.valueText??'brak'}</td><td>{r.unit}</td></tr>)}</tbody></table></div><details><summary>Parametry, liczebność i ślad wykonania</summary><pre className="text-xs whitespace-pre-wrap break-all max-h-64 overflow-auto">{JSON.stringify({runId:result.runId,hash:result.hash,traceId:result.traceId,artifact:result.artifact},null,2)}</pre></details></div>}
      </div>}
    </section>
  </div>;
}
