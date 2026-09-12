import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { automationApi as api, formClass, buttonClass, sectionClass } from '../lib/automation_client';
import { useAccess } from '../lib/access';
import type { PaperInput, SubstitutionInput } from '../../shared/research';
import { CopyPlanBuilder, SubstitutionEditor, ExpectedRecordsForm, ExtractionResult } from '../components/ResearchControls';
import { ExtractionDatasetForm } from '../components/ExtractionDatasetForm';

export function Research() {
  const access = useAccess();
  return <ResearchContent key={access.principalId ?? 'pending'} />;
}

function ResearchContent() {
  const access = useAccess(), [params] = useSearchParams();
  const [data,setData] = useState<any>(null), [tab,setTab] = useState('papers'), [error,setError] = useState(''), [notice,setNotice] = useState(''), [busy,setBusy] = useState(false);
  const [paper,setPaper] = useState<PaperInput>({ title:'', source:'', text:'', coverage:'excerpt', language:null, geography:[] });
  const [raw,setRaw] = useState(''), [format,setFormat] = useState<'json'|'csv'>('json'), [goal,setGoal] = useState(''), [plan,setPlan] = useState(''), [expected,setExpected] = useState('');
  const [selected,setSelected] = useState<any>(null), [trial,setTrial] = useState<any>(null), [substitution,setSubstitution] = useState<SubstitutionInput|null>(null), [openedSource,setOpenedSource]=useState<any>(null);
  const [trials,setTrials]=useState<any[]>([]);
  useEffect(()=>{setExpected('');},[selected?.id]);
  const refresh = async () => setData(await api('/api/research'));
  useEffect(() => { let active=true; setData(null); setSelected(null); setTrial(null);
    api('/api/research').then(r => active && setData(r)).catch(e => active && setError(e.message)); return () => { active=false; };
  },[access.principalId]);
  useEffect(()=>{let active=true;setTrials([]);if(!selected)return;
    api(`/api/research/extractors/${selected.id}/trials`).then(r=>{if(active)setTrials(r.trials);}).catch(e=>{if(active)setError(e.message);});
    return ()=>{active=false;};
  },[selected?.id,trial?.id]);
  const activeJobs = !!data?.jobs?.some((j:any)=>['QUEUED','RUNNING'].includes(j.status));
  useEffect(()=>{ if(!activeJobs)return;let active=true;
    const timer=setInterval(()=>{api('/api/research').then(r=>{if(active)setData(r);}).catch(e=>{if(active)setError(e.message);});},3000);
    return ()=>{active=false;clearInterval(timer);};
  },[activeJobs]);
  const act = async (fn:()=>Promise<unknown>,message='Zapisano.') => { setBusy(true);setError('');setNotice('');try{await fn();await refresh();setNotice(message);}catch(e){setError((e as Error).message);}finally{setBusy(false);} };
  const fileText = async (file:File|null, callback:(t:string)=>void) => { if(!file)return; if(file.size>2000000){setError('Plik przekracza 2 MB.');return;}try{callback(await file.text());}catch{setError('Nie udało się odczytać pliku.');} };
  const saveResult = () => { const blob=new Blob([JSON.stringify(trial,null,2)],{type:'application/json'}), url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='watchdog-extraction.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),0); };
  return <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-5" data-testid="research-page">
    <header><h1 className="text-2xl font-semibold">Warsztat replikacji</h1><p className="text-slate-600 mt-2">Publikacja → metodologia i potrzebne dane → jawne warianty → sprawdzony ekstraktor.</p></header>
    <div className="flex flex-wrap gap-3"><button className={buttonClass} onClick={()=>setTab('papers')}>Prace i warianty</button><button className={buttonClass} onClick={()=>setTab('extractors')}>Ekstraktory danych</button><button className="underline" onClick={()=>act(async()=>{},'Odświeżono.')}>Odśwież kolejkę</button></div>
    {error && <p role="alert" className="bg-red-50 text-red-800 p-3 break-words">{error}</p>}{notice && <p role="status">{notice}</p>}
    {activeJobs && <p className="text-sm" role="status">Ocena oczekuje lub trwa. Stan odświeża się automatycznie. <Link to="/automation" className="underline">Otwórz kolejkę, aby wstrzymać zadanie</Link>.</p>}
    {tab==='papers' ? <>
      {params.get('discovery') && <div className={sectionClass}><p>Wybrana praca z przeglądu literatury. Jej abstrakt zachowa oznaczenie niepełnego tekstu.</p><button className={buttonClass} disabled={busy} onClick={()=>act(()=>api('/api/research/papers/discovery',{id:params.get('discovery')}))}>Dodaj odkrytą pracę do warsztatu</button></div>}
      <section className={sectionClass}><h2 className="font-semibold">Dodaj pracę z dowolnej dziedziny</h2>
        <div className="grid sm:grid-cols-2 gap-3"><label>Tytuł<input className={formClass} value={paper.title} onChange={e=>setPaper({...paper,title:e.target.value})}/></label><label>Źródło / DOI / identyfikator<input className={formClass} value={paper.source} onChange={e=>setPaper({...paper,source:e.target.value})}/></label></div>
        <label className="block">Zakres dostarczonego tekstu<select aria-label="Zakres dostarczonego tekstu" className={formClass} value={paper.coverage} onChange={e=>setPaper({...paper,coverage:e.target.value as PaperInput['coverage']})}><option value="full_text">Pełny tekst</option><option value="excerpt">Fragment / sekcja metody</option><option value="abstract">Abstrakt</option><option value="identifier_only">Na razie tylko identyfikator</option></select></label>
        <label className="block">Tekst źródłowy<textarea className={formClass} rows={6} value={paper.text} onChange={e=>setPaper({...paper,text:e.target.value})}/></label>
        <div className="grid sm:grid-cols-2 gap-3"><label>Język tekstu (opcjonalnie)<input className={formClass} value={paper.language??''} onChange={e=>setPaper({...paper,language:e.target.value||null})} placeholder="np. en"/></label>
          <label>Obszary badania (oddziel przecinkami)<input className={formClass} value={paper.geography.join(',')} onChange={e=>setPaper({...paper,geography:e.target.value?e.target.value.split(','):[]})} placeholder="opcjonalnie, niezależnie od języka"/></label></div>
        <label className="block text-sm">Wczytaj TXT lub Markdown<input type="file" accept=".txt,.md,text/plain,text/markdown" className="block max-w-full" onChange={e=>void fileText(e.target.files?.[0]??null,text=>setPaper({...paper,text}))}/></label>
        <p className="text-xs">Zapis zachowuje wersję i pochodzenie. LLM analizuje jawnie oznaczony fragment do 24 000 znaków; pozostały tekst pozostaje w zapisanym źródle. Sam identyfikator nie uruchamia pobierania pełnego tekstu.</p>
        <button className={buttonClass} disabled={busy||!paper.title||!paper.source} data-testid="paper-intake-save" onClick={()=>act(()=>api('/api/research/papers',paper))}>Zapisz tę wersję pracy</button>
      </section>
      <section className={sectionClass}><h2 className="font-semibold">Zapisane prace i próby oceny</h2>
        {!data?.documents.length && <p>Dodaj tekst lub przenieś pracę z przeglądu literatury.</p>}
        {data?.documents.map((d:any)=><article key={d.id} className="border-t pt-3 space-y-2"><b>{d.body.title}</b><p className="text-xs break-words">{d.body.coverage} · {d.body.source}</p>
          <button className="underline text-sm block" onClick={()=>act(async()=>setOpenedSource((await api(`/api/research/papers/${d.id}`)).document),'Otwarto zapisaną wersję źródła.')}>Pokaż zapisany tekst i jego wersję</button>
          {openedSource?.id===d.id && <details open><summary>Tekst źródłowy · {d.characterCount} znaków</summary><p className="text-xs break-all">SHA-256 wersji: {openedSource.hash}</p><pre className="text-sm whitespace-pre-wrap break-words max-h-80 overflow-auto">{openedSource.body.text}</pre>
            {openedSource.origins?.map((o:any)=><p key={o.hash} className="text-xs break-all"><a className="underline" href={`/api/memory/receipts/${o.receiptId}/raw`}>Pobierz oryginalną odpowiedź źródła literatury</a> · wersja odkrycia: {o.discoveryHash}</p>)}
          </details>}
          <button className={buttonClass} disabled={busy||d.body.coverage==='identifier_only'||!access.capabilities.includes('run.create')||data.assessments.some((a:any)=>a.documentId===d.id&&a.status!=='FAILED')||data.jobs.some((j:any)=>j.request.documentId===d.id&&['QUEUED','RUNNING'].includes(j.status))} onClick={()=>act(()=>api(`/api/research/papers/${d.id}/assess`,{consent:true,retryFailed:data.assessments.some((a:any)=>a.documentId===d.id&&a.status==='FAILED')}),'Ocena dodana do kolejki. Korzysta z Twojego LLM i jego limitu kosztów.')}>Oceń metodologię w ramach mojego budżetu</button>
          {data.assessments.filter((a:any)=>a.documentId===d.id).map((a:any)=><div key={a.id} className="bg-slate-50 p-3 rounded space-y-2 text-sm"><p className="font-semibold">{a.status} · {a.body?.replicability??'próba w toku lub przerwana'}</p>
            {a.body?.error && <p>Próba nie została ukończona. Możesz ponowić ją po sprawdzeniu <Link to="/setup" className="underline">konfiguracji i budżetu LLM</Link>. Poprzednia próba pozostaje w historii.</p>}
            {a.body?.assessment && <><p>Propozycja do sprawdzenia. Zgodność cytatu nie potwierdza interpretacji metody ani wykonalności replikacji.</p>
              {a.body.assessment.methodology.map((m:any,i:number)=><div key={i}><p className="font-medium">{m.statement}</p><blockquote className="border-l-2 border-slate-400 pl-3 whitespace-pre-wrap">{m.quote}</blockquote></div>)}
              {a.body.assessment.dataRequirements.map((r:any)=><details key={r.id}><summary><b>{r.id}</b>: {r.construct} · dostępność niezweryfikowana</summary><p>{r.statement}</p><blockquote className="border-l-2 pl-3">{r.quote}</blockquote><p>{r.acquisition} · {r.sourceLocator??'źródło do ustalenia'}</p></details>)}
              {a.body.assessment.dataRequirements.length>0 && <button className="underline" onClick={()=>setSubstitution({assessmentId:a.id,assessmentHash:a.hash,requirementId:a.body.assessment.dataRequirements[0].id,kind:'prior_dataset',source:'',sourceHash:null,constructDifference:'',validationNeeded:''})}>Przygotuj jawny wariant danych</button>}</>}
            <details><summary>Metodologia, cytaty, hipotezy i braki</summary><pre className="text-xs whitespace-pre-wrap break-all max-h-96 overflow-auto">{JSON.stringify(a,null,2)}</pre></details>
          </div>)}
        </article>)}
      </section>
      <details className={sectionClass} open={!!substitution}><summary>Warianty i zastępstwa danych</summary><p className="text-sm">Ponowne użycie oryginalnych danych jest reanalizą. Zastępczy konstrukt tworzy wariant eksploracyjny. Symulowane odpowiedzi ekspertów pozostają symulacją.</p>
        {substitution ? <SubstitutionEditor value={substitution} onChange={setSubstitution} requirements={data?.assessments.find((a:any)=>a.id===substitution.assessmentId)?.body?.assessment.dataRequirements??[]} busy={busy} onSave={()=>act(()=>api('/api/research/substitutions',substitution))}/> : <p className="text-sm">Wybierz „Przygotuj jawny wariant danych” przy ocenie pracy.</p>}
        {data?.substitutions.map((s:any)=><details key={s.id}><summary>{s.body.kind} · {s.body.meaning}</summary><pre className="text-xs whitespace-pre-wrap break-all">{JSON.stringify(s,null,2)}</pre></details>)}
      </details>
    </> : <>
      <section className={sectionClass}><h2 className="font-semibold">Ekstraktor, który kopiuje wartości ze źródła</h2>
        <p className="text-sm">JSON i CSV. Model proponuje ścieżki na podstawie struktury. Kopiowanie, test i późniejsze wykonanie odbywają się w kodzie, bez LLM.</p>
        <label className="block">Format źródła<select aria-label="Format źródła" className={formClass} value={format} onChange={e=>setFormat(e.target.value as 'json'|'csv')}><option value="json">JSON</option><option value="csv">CSV</option></select></label>
        <label className="block">Źródło do testu / wykonania<textarea className={formClass} rows={5} value={raw} onChange={e=>setRaw(e.target.value)}/></label>
        <input aria-label="Plik danych dla ekstraktora" className="max-w-full" type="file" accept=".json,.csv,text/csv,application/json" onChange={e=>void fileText(e.target.files?.[0]??null,setRaw)}/>
        <label className="block">Co chcesz skopiować?<input className={formClass} value={goal} onChange={e=>setGoal(e.target.value)}/></label>
        <button className={buttonClass} disabled={busy||!raw||!goal} onClick={()=>act(async()=>{const r=await api('/api/research/extractors/propose',{raw,format,goal,consent:true});setSelected(r.extractor);setPlan(JSON.stringify(r.extractor.body.plan,null,2));},'Propozycja zapisana. Wymaga testu; wartości źródła nie zostały wysłane do modelu.')}>Zaproponuj parser przez mój LLM</button>
        <CopyPlanBuilder key={format} format={format} busy={busy} onSave={value=>act(async()=>{const c=(await api('/api/research/extractors',value)).extractor;setSelected(c);setTrial(null);setPlan(JSON.stringify(c.body.plan,null,2));},'Mapowanie zapisane. Teraz porównaj wynik ze znanymi wartościami testowymi.')}/>
        <details><summary>Plan parsera JSON · także bez klucza LLM</summary><p className="text-xs">copy-plan-1: name, format, rowsPointer, fields [name, selector, required]. W JSON selektor jest ścieżką względem rekordu; w CSV nazwą kolumny. Plan nie dopuszcza stałych wartości ani kodu do wykonania.</p>
          <textarea aria-label="Plan parsera JSON" className={formClass} rows={8} value={plan} onChange={e=>setPlan(e.target.value)}/>
          <button className={buttonClass} disabled={busy||!plan} onClick={()=>act(async()=>{setSelected((await api('/api/research/extractors',JSON.parse(plan))).extractor);})}>Zapisz nową wersję parsera</button></details>
      </section>
      <section className={sectionClass}><h2 className="font-semibold">Test i aktywacja</h2>
        <label className="block">Wybierz parser<select aria-label="Wybierz parser" className={formClass} value={selected?.id??''} onChange={e=>{setSelected(data.extractors.find((c:any)=>c.id===e.target.value));setTrial(null);}}><option value="">Wybierz…</option>{data?.extractors.map((c:any)=><option key={c.id} value={c.id}>{c.body.plan.name} · {c.approvalState}</option>)}</select></label>
        {selected && <ExpectedRecordsForm key={selected.id} fields={selected.body.plan.fields} busy={busy} onInvalidate={()=>{setExpected('');setNotice('Zmieniono formularz. Zastosuj wartości kontrolne przed testem.');}} onApply={value=>{setExpected(JSON.stringify(value,null,2));setNotice('Zapisano wartości kontrolne do najbliższego testu.');}}/>}
        <details><summary>Oczekiwane rekordy JSON · opcje zaawansowane</summary><label className="block">Oczekiwane rekordy JSON (wartości tekstowe lub null)<textarea className={formClass} rows={4} value={expected} onChange={e=>setExpected(e.target.value)}/></label></details>
        <div className="flex flex-wrap gap-3"><button className={buttonClass} disabled={busy||!selected||!raw||!expected} onClick={()=>act(async()=>setTrial((await api(`/api/research/extractors/${selected.id}/test`,{raw,expected:JSON.parse(expected)})).trial),'Test zapisany; sprawdź wynik porównania.')}>Testuj dokładne kopiowanie</button>
          {access.capabilities.includes('dataset.approve') && <button className={buttonClass} disabled={busy||!selected||trial?.body.passed!==true||trial?.body.candidateHash!==selected.hash} onClick={()=>act(async()=>setSelected((await api(`/api/research/extractors/${selected.id}/approve`,{expectedHash:selected.hash})).extractor),'Ta wersja parsera została aktywowana.')}>Aktywuj sprawdzoną wersję</button>}
          {access.capabilities.includes('dataset.import') && <button className={buttonClass} disabled={busy||!raw||selected?.approvalState!=='APPROVED'} onClick={()=>act(async()=>setTrial((await api(`/api/research/extractors/${selected.id}/run`,{raw})).trial),'Wykonano bez wywołania LLM.')}>Wykonaj parser bez LLM</button>}</div>
        {trial && <div className="space-y-3"><ExtractionResult key={trial.id} trial={trial}/><button className="underline text-sm" onClick={saveResult}>Pobierz wynik, surowe źródło i pochodzenie</button>
          {trial.body.kind==='EXECUTION' && selected?.hash===trial.body.candidateHash && selected.approvalState==='APPROVED' && data?.datasetProfile && access.capabilities.includes('dataset.import') && <ExtractionDatasetForm key={`${trial.id}:${data.datasetProfile.contentHash}`} trial={trial} plan={selected.body.plan} profile={data.datasetProfile}/>}
        </div>}
        {trials.length>0 && <details><summary>Historia testów i wykonań ({trials.length})</summary><ul className="space-y-2 mt-2">{trials.map(t=><li key={t.id}><button className="underline text-sm" onClick={()=>act(async()=>setTrial((await api(`/api/research/trials/${t.id}`)).trial),'Odtworzono zapisany wynik.')}>{t.kind==='EXECUTION'?'Wykonanie':t.passed?'Test PASSED':'Test FAILED'} · {new Date(t.createdAt).toLocaleString()}</button></li>)}</ul></details>}
      </section>
    </>}
    <p className="text-sm"><Link to="/automation" className="underline">Harmonogram i kolejka</Link> · <Link to="/workbench" className="underline">Warsztat statystyczny</Link> · <Link to="/setup" className="underline">Klucze, modele i limity</Link></p>
  </div>;
}
