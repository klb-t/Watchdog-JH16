import type { PublicReceipt } from '../../../shared/automation';
import { PublicHttp } from './public_http';
import { AutomationError } from '../db/repositories/automation';

const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null;
const numericText = (value: unknown): string | null => {
  const s = typeof value === 'number' ? String(value) : text(value);
  return s && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(s) && Number.isFinite(Number(s)) ? s : null;
};
export function normalizeActivity(raw: any) {
  if (!Number.isSafeInteger(raw.activity_id) || !/^CHEMBL\d+$/.test(raw.target_chembl_id ?? '') || !['Ki', 'Kd', 'IC50', 'EC50'].includes(raw.standard_type)) return null;
  const value = numericText(raw.standard_value), flags: string[] = ['ASSAY_ACTIVITY_NOT_CLINICAL_GUIDANCE'];
  if (value === null) flags.push('MISSING_OR_INVALID_VALUE');
  if (raw.standard_relation !== '=') flags.push('CENSORED_OR_UNKNOWN_RELATION');
  if (!text(raw.standard_units)) flags.push('MISSING_UNIT');
  if (raw.data_validity_comment) flags.push('SOURCE_VALIDITY_WARNING');
  if (raw.potential_duplicate) flags.push('SOURCE_POTENTIAL_DUPLICATE');
  if (raw.target_organism !== 'Homo sapiens') flags.push('NONHUMAN_OR_UNSPECIFIED_ORGANISM');
  return { activityId: raw.activity_id, moleculeId: raw.molecule_chembl_id, targetId: raw.target_chembl_id,
    targetName: text(raw.target_pref_name), organism: text(raw.target_organism), targetTaxId: raw.target_tax_id ?? null,
    measure: raw.standard_type, value, relation: text(raw.standard_relation), unit: text(raw.standard_units),
    original: { type: text(raw.type), value: text(raw.value), relation: text(raw.relation), unit: text(raw.units), upperValue: text(raw.upper_value) },
    standardUpperValue: numericText(raw.standard_upper_value), pChEMBL: numericText(raw.pchembl_value),
    assayId: text(raw.assay_chembl_id), assayType: text(raw.assay_type), assayDescription: text(raw.assay_description),
    assayVariantAccession: text(raw.assay_variant_accession), assayVariantMutation: text(raw.assay_variant_mutation),
    assayFormat: text(raw.bao_label), documentId: text(raw.document_chembl_id), journal: text(raw.document_journal),
    year: raw.document_year ?? null, validityComment: text(raw.data_validity_comment), activityComment: text(raw.activity_comment),
    actionType: raw.action_type ?? null, flags };
}

export async function pubchem(http: PublicHttp, query: string) {
  const { data, receipt } = await http.json('pubchem', `/rest/pug/compound/name/${encodeURIComponent(query)}/property/MolecularFormula,MolecularWeight,InChIKey,IUPACName,CanonicalSMILES/JSON`);
  const properties = data?.PropertyTable?.Properties;
  if (!Array.isArray(properties) || properties.length !== 1) throw new AutomationError('PubChem identity is ambiguous or absent; use an exact chemical name');
  const p = properties[0];
  if (!Number.isSafeInteger(p.CID) || p.CID < 1 || !/^[A-Z]{14}-[A-Z]{10}-[A-Z]$/.test(p.InChIKey ?? '')) throw new AutomationError('PubChem returned an invalid compound identity');
  const id = http.repo.putCompound(p.CID, text(p.IUPACName) ?? `CID ${p.CID}`, p, receipt);
  // Query labels are preserved as acquisition context, not automatically promoted to aliases.
  http.repo.record(id, 'pubchem', 'identity_resolution', { requestedName: query, cid: p.CID, inchiKey: p.InChIKey }, receipt);
  const synonyms = await http.json('pubchem', `/rest/pug/compound/cid/${p.CID}/synonyms/JSON`);
  const info = synonyms.data?.InformationList?.Information;
  if (!Array.isArray(info) || info[0]?.CID !== p.CID || !Array.isArray(info[0]?.Synonym)) throw new AutomationError('PubChem synonym identity mismatch');
  for (const name of info[0].Synonym.slice(0, 300)) if (typeof name === 'string') http.repo.alias(id, name, null, synonyms.receipt.id);
  http.repo.record(id, 'pubchem', 'synonyms', info[0].Synonym.slice(0, 300), synonyms.receipt);
  return { id, cid: p.CID as number, inchiKey: p.InChIKey as string };
}

export async function chembl(http: PublicHttp, compound: { id: string; inchiKey: string }, pageLimit: number) {
  const molecules = await http.json('chembl', '/chembl/api/data/molecule.json', { molecule_structures__standard_inchi_key: compound.inchiKey, limit: 2 });
  const rows = molecules.data?.molecules;
  if (!Array.isArray(rows)) throw new AutomationError('ChEMBL molecule response has no collection');
  const exact = rows.filter((m: any) => m.molecule_structures?.standard_inchi_key === compound.inchiKey);
  if (exact.length !== 1) {
    http.repo.record(compound.id, 'chembl', 'coverage', { status: exact.length ? 'ambiguous_identity' : 'no_exact_identity', complete: false }, molecules.receipt);
    return { activities: 0, complete: false, reason: 'NO_UNIQUE_EXACT_IDENTITY' };
  }
  const molecule = exact[0].molecule_chembl_id;
  if (!/^CHEMBL\d+$/.test(molecule)) throw new AutomationError('Invalid ChEMBL molecule identifier');
  http.repo.identifier(compound.id, 'chembl', molecule, molecules.receipt.id);
  http.repo.record(compound.id, 'chembl', 'molecule', exact[0], molecules.receipt);
  let offset = 0, total = 0, activities = 0, lastReceipt = molecules.receipt;
  for (let page = 0; page < pageLimit; page++) {
    const response = await http.json('chembl', '/chembl/api/data/activity.json', { molecule_chembl_id: molecule,
      standard_type__in: 'Ki,Kd,IC50,EC50', limit: 100, offset, order_by: 'activity_id' });
    const raw = response.data?.activities, meta = response.data?.page_meta;
    if (!Array.isArray(raw) || !Number.isSafeInteger(meta?.total_count) || meta.total_count < 0) throw new AutomationError('Malformed ChEMBL activity page');
    total = meta.total_count; lastReceipt = response.receipt;
    for (const r of raw) {
      if (r.molecule_chembl_id !== molecule) throw new AutomationError('ChEMBL activity compound identity mismatch');
      const value = normalizeActivity(r); if (value) { http.repo.activity(compound.id, value, response.receipt); activities++; }
    }
    offset += raw.length;
    if (offset >= total) break;
    if (raw.length === 0) throw new AutomationError('ChEMBL returned an empty page before the reported end');
  }
  const coverage = { activities, recordsFetched: offset, totalReported: total, complete: offset >= total, nextOffset: offset >= total ? null : offset,
    note: 'Provider coverage is not a claim that all receptors or all measurements are known.' };
  http.repo.record(compound.id, 'chembl', 'coverage', coverage, lastReceipt); return coverage;
}

/** Candidate labels cannot establish identity: every accepted entity must assert the full InChIKey. */
export async function wikidata(http: PublicHttp, compound: { id: string; inchiKey: string }, query: string) {
  const search = await http.json('wikidata', '/w/api.php', { action: 'wbsearchentities', search: query, language: 'en', format: 'json', limit: 5 });
  if (!Array.isArray(search.data?.search)) throw new AutomationError('Invalid Wikidata search response');
  const ids = search.data.search.map((r: any) => r.id).filter((id: any) => typeof id === 'string' && /^Q[1-9]\d*$/.test(id));
  if (!ids.length) return { matched: false };
  const response = await http.json('wikidata', '/w/api.php', { action: 'wbgetentities', ids: ids.join('|'), props: 'labels|aliases|claims|sitelinks', format: 'json' });
  const records = Object.values(response.data?.entities ?? {}).filter((e: any) => e.claims?.P235?.some((s: any) =>
    s.rank !== 'deprecated' && s.mainsnak?.datavalue?.value === compound.inchiKey)) as any[];
  if (records.length !== 1) return { matched: false, reason: 'NO_UNIQUE_EXACT_IDENTITY' };
  const entity = records[0];
  http.repo.identifier(compound.id, 'wikidata', entity.id, response.receipt.id);
  for (const label of Object.values(entity.labels ?? {}) as any[]) if (text(label.value) && text(label.language)) http.repo.alias(compound.id, label.value, label.language, response.receipt.id);
  // Claims remain source records. They are not converted to approved clinical assertions.
  http.repo.record(compound.id, 'wikidata', 'entity', { id: entity.id, revision: entity.lastrevid ?? null,
    labels: entity.labels ?? {}, aliases: entity.aliases ?? {}, claims: entity.claims ?? {}, sitelinks: entity.sitelinks ?? {},
    languageMeaning: 'Language of a label or Wikipedia edition; no geographic inference', geography: null }, response.receipt);
  return { matched: true, id: entity.id };
}

export async function substanceLiterature(http: PublicHttp, id: string, name: string) {
  const query = `"${name.replace(/["\\]/g, ' ')}"`;
  const { data, receipt } = await http.json('europe_pmc', '/europepmc/webservices/rest/search', { query, format: 'json', pageSize: 25, resultType: 'lite', cursorMark: '*' });
  if (!Number.isSafeInteger(data.hitCount) || !Array.isArray(data.resultList?.result)) throw new AutomationError('Invalid Europe PMC bibliography response');
  http.repo.record(id, 'europe_pmc', 'bibliography', { query, hitCount: data.hitCount, records: data.resultList.result,
    complete: data.hitCount <= data.resultList.result.length, geography: null, measurement: 'bibliographic_record_count', notEquivalentTo: 'SERP Ni or harm' }, receipt);
  return { records: data.resultList.result.length, totalReported: data.hitCount };
}
