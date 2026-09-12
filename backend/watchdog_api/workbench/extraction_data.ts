import { validateDataset,WorkbenchInputError,type DatasetDocument } from '../../../shared/workbench';
import type { SourceCopy } from '../../../shared/source_copy';
import { copySource } from '../sources/copy_plan';
import { canonicalHash } from '../domain/canonical';

/** Decimal equality ignores lexical exponent/trailing zeros but never rounds a
 * source decimal into a different decimal before binary64 analysis. */
function decimalKey(text:string) {
  const m=/^([+-]?)(\d*\.?\d+)(?:[eE]([+-]?\d+))?$/.exec(text);
  if(!m)throw new WorkbenchInputError('Numeric conversion requires an explicit decimal value; locale/grouping symbols are not guessed.');
  let digits=m[2].replace('.','').replace(/^0+/,'');if(!digits)return '0';
  let exponent=BigInt(m[3]??'0')-BigInt(m[2].includes('.')?m[2].split('.')[1].length:0);
  const zeros=/0+$/.exec(digits)?.[0].length??0;digits=digits.slice(0,digits.length-zeros);exponent+=BigInt(zeros);
  return `${m[1]==='-'?'-':''}${digits}e${exponent}`;
}
export function sourceNumber(raw:string) {
  const text=raw.trim(),source=decimalKey(text),n=Number(text);
  if(!Number.isFinite(n)||Number.isInteger(n)&&!Number.isSafeInteger(n)||decimalKey(String(n))!==source)
    throw new WorkbenchInputError('Numeric conversion would change source precision or range; retain this field as text.');
  return n;
}
export function mappedSourceRows(copy:SourceCopy,columns:DatasetDocument['columns'],tier:DatasetDocument['rows'][number]['evidenceTier']) {
  const copied=copySource(copy.raw,copy.plan);
  if(copied.rawHash!==copy.rawHash)throw new WorkbenchInputError('Copied source hash mismatch.');
  if(copy.mappings.length!==columns.length||new Set(copy.mappings.map(m=>m.key)).size!==columns.length)throw new WorkbenchInputError('Source mapping columns disagree.');
  const fields=new Set(copy.plan.fields.map(f=>f.name));
  for(const mapping of copy.mappings){const column=columns.find(c=>c.key===mapping.key);
    if(!column || mapping.sourceField!==null&&!fields.has(mapping.sourceField))throw new WorkbenchInputError('Unknown copied source field.');
    if(mapping.sourceField===null&&(column.type!=='text'||column.semanticType!=='dimension'||column.unit!==null||mapping.emptyAsMissing))throw new WorkbenchInputError('Row identity is text metadata, not a numeric observation.');
  }
  const rows=copied.records.map((record,i)=>{
    const values:Record<string,string|number|null>=Object.create(null),missingReasons:Record<string,string>=Object.create(null);
    for(const column of columns){const mapping=copy.mappings.find(m=>m.key===column.key)!;
      const v=mapping.sourceField===null?`source-row-${i+1}`:record[mapping.sourceField];
      if(v===null){values[column.key]=null;missingReasons[column.key]=copied.provenance[i][mapping.sourceField!].missing?'Source field is absent':'Explicit source null';}
      else if(v===''&&mapping.emptyAsMissing){values[column.key]=null;missingReasons[column.key]='Empty source text mapped to missing by declared policy';}
      else if(column.type==='number') {
        try { values[column.key]=sourceNumber(v); }
        catch(e) { throw new WorkbenchInputError(`Column ${column.key}, source row ${i+1}: ${(e as Error).message}`); }
      } else values[column.key]=v;
    }
    return {id:`source-row-${i+1}`,values,evidenceTier:tier,qualityFlags:['source_copy',...(columns.some(c=>c.type==='number')?['numeric_binary64']:[])],missingReasons};
  });
  return {rows,copied};
}
export function verifyDatasetExtraction(input:unknown) {
  const doc=validateDataset(input);if(!doc.sourceCopy)return;
  const tiers=new Set(doc.rows.map(r=>r.evidenceTier));if(tiers.size!==1)throw new WorkbenchInputError('Source-copy import retains one declared evidence classification.');
  const {rows,copied}=mappedSourceRows(doc.sourceCopy,doc.columns,doc.rows[0].evidenceTier);
  if(canonicalHash(rows)!==canonicalHash(doc.rows))throw new WorkbenchInputError('Dataset values or missingness do not reproduce from the pinned extraction.');
  return copied;
}
