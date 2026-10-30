import { useEffect, useState } from 'react';
import { z } from 'zod';
import { CopyPlanSchema, SubstitutionSchema, type CopyPlan, type SubstitutionInput } from '../../shared/research';
import profile from '../../config/research-workbench.json';
import { formClass, buttonClass } from '../lib/automation_client';
import text from '../../config/ui/research-controls.json';
import { useUiText } from '../lib/ui_text';

/** Both interface languages for each variant label and meaning; the stored variant keeps only its kind id. */
const bilingual = z.object({ pl:z.string().min(1), en:z.string().min(1) }).strict();
const options = z.object({ version:z.literal('research-workbench-2'),substitutionKinds:z.array(z.object({
  id:SubstitutionSchema.shape.kind,label:bilingual,meaning:bilingual,
}).strict()) }).strict().parse(profile).substitutionKinds;

export function SubstitutionEditor({ value,onChange,requirements,busy,onSave }: {
  value:SubstitutionInput;onChange:(v:SubstitutionInput)=>void;requirements:{id:string;construct:string}[];busy:boolean;onSave:()=>void;
}) {
  const { t, lang } = useUiText(text);
  return <div className="space-y-3">
    <label className="block">{t('replaced_data')}<select aria-label={t('replaced_data')} className={formClass} value={value.requirementId} onChange={e=>onChange({...value,requirementId:e.target.value})}>
      {requirements.map(r=><option key={r.id} value={r.id}>{r.id} — {r.construct}</option>)}
    </select></label>
    <label className="block">{t('variant_kind')}<select aria-label={t('variant_kind')} className={formClass} value={value.kind} onChange={e=>onChange({...value,kind:e.target.value as SubstitutionInput['kind']})}>
      {options.map(o=><option key={o.id} value={o.id}>{o.label[lang]}</option>)}
    </select></label>
    <p className="text-sm bg-amber-50 p-3 rounded">{options.find(o=>o.id===value.kind)?.meaning[lang]}</p>
    <label className="block">{t('variant_source')}<input className={formClass} value={value.source} onChange={e=>onChange({...value,source:e.target.value})}/></label>
    <label className="block">{t('construct_difference')}<textarea className={formClass} value={value.constructDifference} onChange={e=>onChange({...value,constructDifference:e.target.value})}/></label>
    <label className="block">{t('validation_needed')}<textarea className={formClass} value={value.validationNeeded} onChange={e=>onChange({...value,validationNeeded:e.target.value})}/></label>
    <details><summary>{t('source_hash_optional')}</summary><input aria-label={t('source_hash_aria')} className={formClass} value={value.sourceHash??''} onChange={e=>onChange({...value,sourceHash:e.target.value||null})}/></details>
    <button className={buttonClass} disabled={busy||!SubstitutionSchema.safeParse(value).success} onClick={onSave}>{t('save_variant')}</button>
  </div>;
}

export function CopyPlanBuilder({ format,busy,onSave,pdfDefaults }: {format:'json'|'csv'|'html'|'pdf';busy:boolean;onSave:(plan:CopyPlan)=>void;pdfDefaults?:{page:number;top:number;bottom:number;boundaries:number[]}}) {
  const { t } = useUiText(text);
  const [name,setName]=useState(''),[rows,setRows]=useState(''),[fields,setFields]=useState([{name:'',selector:'',required:true}]),[table,setTable]=useState({index:0,headerRowIndex:0}),
    [pdf,setPdf]=useState({page:1,top:800,bottom:0,boundaries:'',names:'',rowTolerance:2,joinGap:1,raisedMarker:'^',raisedWindow:0});
  useEffect(()=>{ if(pdfDefaults) setPdf(p=>({...p,page:pdfDefaults.page,top:pdfDefaults.top,bottom:pdfDefaults.bottom,boundaries:pdfDefaults.boundaries.join(', ')})); },[pdfDefaults?.page,pdfDefaults?.top,pdfDefaults?.bottom,pdfDefaults?.boundaries.join(',')]);
  const pdfTable={page:pdf.page,top:pdf.top,bottom:pdf.bottom,columnBoundaries:pdf.boundaries.split(',').map(x=>x.trim()).filter(Boolean).map(Number),columnNames:pdf.names.split(',').map(x=>x.trim()).filter(Boolean),rowTolerance:pdf.rowTolerance,joinGap:pdf.joinGap,raisedMarker:pdf.raisedMarker===''?null:pdf.raisedMarker,raisedWindow:pdf.raisedWindow};
  const value={version:'copy-plan-1' as const,name,format,rowsPointer:format==='json'?rows:'',fields,...(format==='html'?{table}:{}),...(format==='pdf'?{pdfTable}:{})};
  const change=(index:number,patch:Partial<CopyPlan['fields'][number]>)=>setFields(fields.map((f,i)=>i===index?{...f,...patch}:f));
  return <div className="space-y-3" data-testid="copy-plan-builder">
    <h3 className="font-semibold">{t('builder_heading')}</h3>
    <label className="block">{t('parser_name')}<input className={formClass} value={name} onChange={e=>setName(e.target.value)}/></label>
    {format==='html' && <div className="grid sm:grid-cols-2 gap-3"><label>{t('html_table_index')}<input type="number" min={0} className={formClass} value={table.index} onChange={e=>setTable({...table,index:Number(e.target.value)})} data-testid="html-table-index"/></label>
      <label>{t('html_header_row')}<input type="number" min={0} className={formClass} value={table.headerRowIndex} onChange={e=>setTable({...table,headerRowIndex:Number(e.target.value)})}/></label></div>}
    {format==='pdf' && <fieldset className="rounded border p-3 space-y-2" data-testid="pdf-table-spec"><legend>{t('pdf_legend')}</legend>
      <div className="grid sm:grid-cols-3 gap-3">{([['page','pdf_page'],['top','pdf_top'],['bottom','pdf_bottom'],['rowTolerance','pdf_row_tolerance'],['joinGap','pdf_join_gap'],['raisedWindow','pdf_raised_window']] as const).map(([k,l])=>
        <label key={k}>{t(l)}<input type="number" step="any" className={formClass} value={(pdf as any)[k]} onChange={e=>setPdf({...pdf,[k]:Number(e.target.value)})}/></label>)}
        <label>{t('pdf_raised_marker')}<input className={formClass} value={pdf.raisedMarker} onChange={e=>setPdf({...pdf,raisedMarker:e.target.value})}/></label></div>
      <label className="block">{t('pdf_boundaries')}<input className={formClass} value={pdf.boundaries} onChange={e=>setPdf({...pdf,boundaries:e.target.value})} data-testid="pdf-boundaries"/></label>
      <label className="block">{t('pdf_names')}<input className={formClass} value={pdf.names} onChange={e=>setPdf({...pdf,names:e.target.value})} data-testid="pdf-names"/></label></fieldset>}
    {format==='json' && <label className="block">{t('rows_pointer')}<input className={formClass} value={rows} onChange={e=>setRows(e.target.value)} placeholder={t('rows_pointer_placeholder')}/></label>}
    <p className="text-xs">{t(format==='json'?'hint_json':format==='pdf'?'hint_pdf':format==='html'?'hint_html':'hint_csv')} {t('hint_common')}</p>
    {fields.map((f,i)=><fieldset key={i} className="rounded border p-3 space-y-2"><legend>{t('field_legend',{n:i+1})}</legend>
      <div className="grid sm:grid-cols-2 gap-3"><label>{t('field_name',{n:i+1})}<input className={formClass} value={f.name} onChange={e=>change(i,{name:e.target.value})} placeholder={t('field_name_placeholder')}/></label>
      <label>{t(format==='json'?'field_path':'field_header',{n:i+1})}<input className={formClass} value={f.selector} onChange={e=>change(i,{selector:e.target.value})}/></label></div>
      <div className="flex flex-wrap gap-3 text-sm"><label><input type="checkbox" checked={f.required} onChange={e=>change(i,{required:e.target.checked})}/> {t('field_required',{n:i+1})}</label>
      {fields.length>1 && <button className="underline" onClick={()=>setFields(fields.filter((_,j)=>i!==j))}>{t('field_remove',{n:i+1})}</button>}</div>
    </fieldset>)}
    <div className="flex flex-wrap gap-3"><button className="underline" disabled={fields.length>=30} onClick={()=>setFields([...fields,{name:'',selector:'',required:true}])}>{t('field_add')}</button>
    <button className={buttonClass} disabled={busy||!CopyPlanSchema.safeParse(value).success} onClick={()=>onSave(value)}>{t('save_mapping')}</button></div>
  </div>;
}

export function ExpectedRecordsForm({fields,busy,onApply,onInvalidate}:{fields:CopyPlan['fields'];busy:boolean;onApply:(value:Record<string,string|null>[])=>void;onInvalidate:()=>void}) {
  const { t } = useUiText(text);
  const empty=()=>Object.fromEntries(fields.map(f=>[f.name,''])) as Record<string,string|null>;
  const [rows,setRows]=useState<Record<string,string|null>[]>([empty()]);
  const update=(value:Record<string,string|null>[])=>{setRows(value);onInvalidate();};
  const change=(row:number,key:string,value:string|null)=>update(rows.map((r,i)=>i===row?{...r,[key]:value}:r));
  return <div className="space-y-3" data-testid="expected-records-form">
    <h3 className="font-semibold">{t('expected_heading')}</h3>
    <p className="text-sm">{t('expected_intro')}</p>
    {rows.map((row,i)=><fieldset key={i} className="border rounded p-3 min-w-0 space-y-3"><legend>{t('control_record',{n:i+1})}</legend>
      {fields.map(f=><div key={f.name} className="grid sm:grid-cols-[1fr_auto] gap-2 items-end"><label className="min-w-0">{t('control_value',{field:f.name,n:i+1})}<input className={formClass} value={row[f.name]??''} disabled={row[f.name]===null} onChange={e=>change(i,f.name,e.target.value)}/></label>
        <label className="text-sm"><input type="checkbox" checked={row[f.name]===null} onChange={e=>change(i,f.name,e.target.checked?null:'')}/> {t('control_null',{field:f.name,n:i+1})}</label>
      </div>)}
      {rows.length>1 && <button className="underline text-sm" onClick={()=>update(rows.filter((_,j)=>i!==j))}>{t('control_remove',{n:i+1})}</button>}
    </fieldset>)}
    <div className="flex flex-wrap gap-3"><button className="underline text-sm" disabled={rows.length>=20} onClick={()=>update([...rows,empty()])}>{t('control_add')}</button>
      <button className={buttonClass} disabled={busy} onClick={()=>onApply(rows)}>{t('control_apply')}</button></div>
    <p className="text-xs">{t('control_limit')}</p>
  </div>;
}

export function ExtractionResult({trial}:{trial:any}) {
  const { t } = useUiText(text);
  const [cell,setCell]=useState<{row:number;field:string}|null>(null);
  const result=trial.body.result,records=result?.records??[],fields=Object.keys(records[0]??{}),source=cell?result?.provenance?.[cell.row]?.[cell.field]:null;
  return <div className="space-y-3" data-testid="extraction-result">
    <p className="font-semibold">{trial.body.kind==='EXECUTION'?t('result_executed'):trial.body.passed?t('result_passed'):t('result_failed')}</p>
    {trial.body.error && <p className="text-sm text-red-800">{trial.body.error}</p>}
    {result && <><p className="text-sm">{t('result_summary',{count:records.length,shown:Math.min(records.length,40)})}</p>
      <div className="overflow-x-auto max-w-full"><table className="w-full text-sm text-left border-collapse"><caption className="sr-only">{t('result_caption')}</caption>
        <thead><tr>{fields.map(f=><th key={f} className="p-2 border-b font-semibold">{f}</th>)}</tr></thead>
        <tbody>{records.slice(0,40).map((r:Record<string,string|null>,i:number)=><tr key={i}>{fields.map(f=><td key={f} className="p-2 border-b align-top">
          <button className="text-left underline decoration-dotted break-all" aria-label={t('cell_origin_aria',{field:f,n:i+1})} onClick={()=>setCell({row:i,field:f})}>{r[f]===null?result.provenance[i][f].missing?t('cell_missing_field'):t('cell_null'):r[f]===''?t('cell_empty_text'):r[f]}</button>
        </td>)}</tr>)}</tbody>
      </table></div>
      {source && <div className="rounded bg-slate-50 p-3 text-sm space-y-1" data-testid="copied-cell-origin"><p><b>{cell!.field}</b> · {t('origin_record',{n:cell!.row+1})}</p>
        <p className="break-all">{source.pointer!==undefined?t('origin_pointer',{pointer:source.pointer}):t('origin_column',{column:source.column,n:source.recordIndex+1})}</p>
        <p>{t(source.missing?'origin_missing':source.explicitNull?'origin_explicit_null':'origin_copied')}</p>
        {source.rawLiteral!==undefined&&source.rawLiteral!==null && <p className="break-all">{t('origin_raw_literal')} <code>{source.rawLiteral}</code></p>}
        <p className="break-all text-xs">{t('origin_source_hash',{hash:result.rawHash})}</p>
      </div>}
    </>}
    <details><summary>{t('trace')}</summary><pre className="text-xs whitespace-pre-wrap break-all max-h-96 overflow-auto">{JSON.stringify(trial,null,2)}</pre></details>
  </div>;
}
