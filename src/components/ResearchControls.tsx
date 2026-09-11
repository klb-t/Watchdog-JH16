import { useState } from 'react';
import { z } from 'zod';
import { CopyPlanSchema, SubstitutionSchema, type CopyPlan, type SubstitutionInput } from '../../shared/research';
import profile from '../../config/research-workbench.json';
import { formClass, buttonClass } from '../lib/automation_client';

const options = z.object({ version:z.literal('research-workbench-1'),substitutionKinds:z.array(z.object({
  id:SubstitutionSchema.shape.kind,label:z.string(),meaning:z.string(),
}).strict()) }).strict().parse(profile).substitutionKinds;

export function SubstitutionEditor({ value,onChange,requirements,busy,onSave }: {
  value:SubstitutionInput;onChange:(v:SubstitutionInput)=>void;requirements:{id:string;construct:string}[];busy:boolean;onSave:()=>void;
}) {
  return <div className="space-y-3">
    <label className="block">Zastępowane dane<select aria-label="Zastępowane dane" className={formClass} value={value.requirementId} onChange={e=>onChange({...value,requirementId:e.target.value})}>
      {requirements.map(r=><option key={r.id} value={r.id}>{r.id} — {r.construct}</option>)}
    </select></label>
    <label className="block">Rodzaj wariantu<select aria-label="Rodzaj wariantu" className={formClass} value={value.kind} onChange={e=>onChange({...value,kind:e.target.value as SubstitutionInput['kind']})}>
      {options.map(o=><option key={o.id} value={o.id}>{o.label}</option>)}
    </select></label>
    <p className="text-sm bg-amber-50 p-3 rounded">{options.find(o=>o.id===value.kind)?.meaning}</p>
    <label className="block">Źródło zastępczych danych lub plan ich zebrania<input className={formClass} value={value.source} onChange={e=>onChange({...value,source:e.target.value})}/></label>
    <label className="block">Co zmienia się w badanym konstrukcie lub próbie?<textarea className={formClass} value={value.constructDifference} onChange={e=>onChange({...value,constructDifference:e.target.value})}/></label>
    <label className="block">Jak sprawdzisz przydatność zastępstwa?<textarea className={formClass} value={value.validationNeeded} onChange={e=>onChange({...value,validationNeeded:e.target.value})}/></label>
    <details><summary>Opcjonalny skrót SHA-256 pliku źródłowego</summary><input aria-label="Skrót źródła wariantu" className={formClass} value={value.sourceHash??''} onChange={e=>onChange({...value,sourceHash:e.target.value||null})}/></details>
    <button className={buttonClass} disabled={busy||!SubstitutionSchema.safeParse(value).success} onClick={onSave}>Zapisz wariant z uzasadnieniem</button>
  </div>;
}

export function CopyPlanBuilder({ format,busy,onSave }: {format:'json'|'csv';busy:boolean;onSave:(plan:CopyPlan)=>void}) {
  const [name,setName]=useState(''),[rows,setRows]=useState(''),[fields,setFields]=useState([{name:'',selector:'',required:true}]);
  const value={version:'copy-plan-1' as const,name,format,rowsPointer:format==='csv'?'':rows,fields};
  const change=(index:number,patch:Partial<CopyPlan['fields'][number]>)=>setFields(fields.map((f,i)=>i===index?{...f,...patch}:f));
  return <div className="space-y-3" data-testid="copy-plan-builder">
    <h3 className="font-semibold">Zdefiniuj kopiowanie bez klucza LLM</h3>
    <label className="block">Nazwa parsera<input className={formClass} value={name} onChange={e=>setName(e.target.value)}/></label>
    {format==='json' && <label className="block">Ścieżka do listy rekordów<input className={formClass} value={rows} onChange={e=>setRows(e.target.value)} placeholder="np. /rows; puste dla listy na poziomie głównym"/></label>}
    <p className="text-xs">{format==='json'?'Ścieżki JSON Pointer: /wartosc wskazuje pole rekordu, ~1 oznacza ukośnik w nazwie, ~0 tyldę.':'Wpisz dokładną nazwę nagłówka kolumny CSV.'} Każde pole wyniku kopiuje pojedynczą wartość. Wartości liczbowe zachowują zapis ze źródła.</p>
    {fields.map((f,i)=><fieldset key={i} className="rounded border p-3 space-y-2"><legend>Pole {i+1}</legend>
      <div className="grid sm:grid-cols-2 gap-3"><label>Nazwa pola wyniku {i+1}<input className={formClass} value={f.name} onChange={e=>change(i,{name:e.target.value})} placeholder="np. wartosc"/></label>
      <label>{format==='json'?'Ścieżka w rekordzie':'Nagłówek kolumny'} {i+1}<input className={formClass} value={f.selector} onChange={e=>change(i,{selector:e.target.value})}/></label></div>
      <div className="flex flex-wrap gap-3 text-sm"><label><input type="checkbox" checked={f.required} onChange={e=>change(i,{required:e.target.checked})}/> Wymagane pole {i+1}</label>
      {fields.length>1 && <button className="underline" onClick={()=>setFields(fields.filter((_,j)=>i!==j))}>Usuń pole {i+1}</button>}</div>
    </fieldset>)}
    <div className="flex flex-wrap gap-3"><button className="underline" disabled={fields.length>=30} onClick={()=>setFields([...fields,{name:'',selector:'',required:true}])}>Dodaj pole</button>
    <button className={buttonClass} disabled={busy||!CopyPlanSchema.safeParse(value).success} onClick={()=>onSave(value)}>Zapisz mapowanie pól</button></div>
  </div>;
}

export function ExpectedRecordsForm({fields,busy,onApply,onInvalidate}:{fields:CopyPlan['fields'];busy:boolean;onApply:(value:Record<string,string|null>[])=>void;onInvalidate:()=>void}) {
  const empty=()=>Object.fromEntries(fields.map(f=>[f.name,''])) as Record<string,string|null>;
  const [rows,setRows]=useState<Record<string,string|null>[]>([empty()]);
  const update=(value:Record<string,string|null>[])=>{setRows(value);onInvalidate();};
  const change=(row:number,key:string,value:string|null)=>update(rows.map((r,i)=>i===row?{...r,[key]:value}:r));
  return <div className="space-y-3" data-testid="expected-records-form">
    <h3 className="font-semibold">Wpisz znane wartości kontrolne</h3>
    <p className="text-sm">Odczytaj je niezależnie ze źródła. Porównamy wszystkie rekordy i ich kolejność. Zapis liczby musi być dokładny; puste pole oznacza pusty tekst, a null brak wartości.</p>
    {rows.map((row,i)=><fieldset key={i} className="border rounded p-3 min-w-0 space-y-3"><legend>Rekord kontrolny {i+1}</legend>
      {fields.map(f=><div key={f.name} className="grid sm:grid-cols-[1fr_auto] gap-2 items-end"><label className="min-w-0">{f.name} · rekord {i+1}<input className={formClass} value={row[f.name]??''} disabled={row[f.name]===null} onChange={e=>change(i,f.name,e.target.value)}/></label>
        <label className="text-sm"><input type="checkbox" checked={row[f.name]===null} onChange={e=>change(i,f.name,e.target.checked?null:'')}/> null · {f.name} · rekord {i+1}</label>
      </div>)}
      {rows.length>1 && <button className="underline text-sm" onClick={()=>update(rows.filter((_,j)=>i!==j))}>Usuń rekord kontrolny {i+1}</button>}
    </fieldset>)}
    <div className="flex flex-wrap gap-3"><button className="underline text-sm" disabled={rows.length>=20} onClick={()=>update([...rows,empty()])}>Dodaj rekord kontrolny</button>
      <button className={buttonClass} disabled={busy} onClick={()=>onApply(rows)}>Użyj tych wartości kontrolnych</button></div>
    <p className="text-xs">Formularz mieści 20 rekordów. Większy zestaw można wkleić w opcjach JSON poniżej.</p>
  </div>;
}

export function ExtractionResult({trial}:{trial:any}) {
  const [cell,setCell]=useState<{row:number;field:string}|null>(null);
  const result=trial.body.result,records=result?.records??[],fields=Object.keys(records[0]??{}),source=cell?result?.provenance?.[cell.row]?.[cell.field]:null;
  return <div className="space-y-3" data-testid="extraction-result">
    <p className="font-semibold">{trial.body.kind==='EXECUTION'?'Wykonano':trial.body.passed?'TEST PASSED':'TEST FAILED'}</p>
    {trial.body.error && <p className="text-sm text-red-800">{trial.body.error}</p>}
    {result && <><p className="text-sm">Rekordy: {records.length}. Pokazano {Math.min(records.length,40)}. Kliknij wartość, aby sprawdzić miejsce w źródle. Liczby pozostają dokładnym tekstem źródłowym.</p>
      <div className="overflow-x-auto max-w-full"><table className="w-full text-sm text-left border-collapse"><caption className="sr-only">Skopiowane rekordy źródłowe</caption>
        <thead><tr>{fields.map(f=><th key={f} className="p-2 border-b font-semibold">{f}</th>)}</tr></thead>
        <tbody>{records.slice(0,40).map((r:Record<string,string|null>,i:number)=><tr key={i}>{fields.map(f=><td key={f} className="p-2 border-b align-top">
          <button className="text-left underline decoration-dotted break-all" aria-label={`Pochodzenie: ${f}, rekord ${i+1}`} onClick={()=>setCell({row:i,field:f})}>{r[f]===null?result.provenance[i][f].missing?'brak pola':'null':r[f]===''?'pusty tekst':r[f]}</button>
        </td>)}</tr>)}</tbody>
      </table></div>
      {source && <div className="rounded bg-slate-50 p-3 text-sm space-y-1" data-testid="copied-cell-origin"><p><b>{cell!.field}</b> · rekord {cell!.row+1}</p>
        <p className="break-all">{source.pointer!==undefined?`Ścieżka: ${source.pointer}`:`Kolumna: ${source.column}; rekord CSV: ${source.recordIndex+1}`}</p>
        <p>{source.missing?'Pole nie występuje w źródle.':source.explicitNull?'Źródło zawiera jawne null.':'Wartość skopiowana ze źródła.'}</p>
        {source.rawLiteral!==undefined&&source.rawLiteral!==null && <p className="break-all">Zapis źródłowy: <code>{source.rawLiteral}</code></p>}
        <p className="break-all text-xs">SHA-256 źródła: {result.rawHash}</p>
      </div>}
    </>}
    <details><summary>Ślad wykonania i surowe źródło</summary><pre className="text-xs whitespace-pre-wrap break-all max-h-96 overflow-auto">{JSON.stringify(trial,null,2)}</pre></details>
  </div>;
}
