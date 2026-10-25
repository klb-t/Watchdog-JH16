import * as fs from 'node:fs';
import * as path from 'node:path';
import { canonicalHash } from '../domain/canonical';
import { RunRepository } from '../db/repositories/runs';
import { AnalysisResultRepository } from '../db/repositories/data';
import { ArtifactRepository } from '../db/repositories/artifacts';
import { AcquisitionRepository } from '../db/repositories/acquisition';
import type { ObjectStore } from '../storage/object_store';
import { JH16_EVALUATION_ROLE } from './run_orchestrator';

/**
 * Replication targets as an in-app object (any study registered in
 * config/replication/): the target and its pre-registered claims, a dossier
 * with hypotheses, method, deviations and diagnosis, every matching stored run
 * with the provenance of its numbers, and a manuscript assembled from those
 * stored results. Nothing here computes a scientific value: statistics are read
 * from the runs' immutable evaluation artifacts and analysis results.
 */

type Db = ConstructorParameters<typeof RunRepository>[0];
const DIR = (root: string) => path.join(root, 'config', 'replication');
const read = (p: string) => JSON.parse(fs.readFileSync(p, 'utf-8'));

export interface ReplicationTarget { target: any; interpretation: any | null; dossier: any | null; hashes: Record<string, string> }

export function listReplicationTargets(root = process.cwd()): ReplicationTarget[] {
  const files = fs.readdirSync(DIR(root)).filter(f => f.endsWith('.json')).sort();
  return files.map(f => read(path.join(DIR(root), f))).filter(j => typeof j.target_id === 'string' && Array.isArray(j.claims)).map(target => {
    const opt = (suffix: string) => { const p = path.join(DIR(root), `${target.target_id}-${suffix}.json`); return fs.existsSync(p) ? read(p) : null; };
    const interpretation = opt('interpretation'), dossier = opt('dossier');
    return { target, interpretation, dossier, hashes: { claims: canonicalHash(target), ...(interpretation ? { interpretation: canonicalHash(interpretation) } : {}), ...(dossier ? { dossier: canonicalHash(dossier) } : {}) } };
  });
}

export type Provenance = 'recomputation_of_published_data' | 'new_fetch' | 'enhanced_variant' | 'recomputation_of_stored_data' | 'exploratory_calibration';

export interface RunSummary {
  run_id: string; created_at: string; status: string; git_commit: string | null; provenance: Provenance; provenance_label: string;
  variant: string | null; source_run_id: string | null; acquired_utc: [string, string] | null; fetches: number;
  manifest_sha256: string | null; effective_config_hash: string | null; preset: string | null;
  evaluation: any | null; calibration: Record<string, { spearman: number | null; pearson_log10: number | null; n: number | null; excluded: string[] }> | null;
}

function matches(config: any, rule: any): boolean {
  return (rule.preset_ids ?? []).includes(config.preset_id) || (rule.method_ids ?? []).includes(config.method_id) || (rule.method_spec_ids ?? []).includes(config.method_spec_id);
}

function classify(config: any, source: any): Provenance {
  if (config.source_run_id) return 'recomputation_of_stored_data';
  if (config.method_id === 'jh16_trends_calibration') return 'exploratory_calibration';
  if (config.source_id === 'fixture_jh2016' || source?.source_id === 'fixture_jh2016') return 'recomputation_of_published_data';
  if (config.variant_id) return 'enhanced_variant';
  return 'new_fetch';
}

export async function collectRuns(db: Db, store: ObjectStore, owner: string, dossier: any): Promise<RunSummary[]> {
  const runs = new RunRepository(db), artifacts = new ArtifactRepository(db), results = new AnalysisResultRepository(db), acq = new AcquisitionRepository(db, store);
  const all = runs.getRuns(1000, owner), byId = new Map(all.map(r => [r.id, r]));
  const cfg = (r: any) => JSON.parse(r.effective_config ?? '{}');
  const out: RunSummary[] = [];
  for (const run of all) {
    const config = cfg(run), source = config.source_run_id ? byId.get(config.source_run_id) : null, sourceCfg = source ? cfg(source) : null;
    if (!matches(config, dossier.runs_match) && !(sourceCfg && matches(sourceCfg, dossier.runs_match))) continue;
    const provenance = classify(config, sourceCfg);
    const events = acq.getFetchEvents(source ? source.id : run.id), times = events.map(e => e.requested_at).filter(Boolean).sort() as string[];
    const evalArtifact = artifacts.getArtifacts(run.id).find(a => a.kind === 'analysis' && JSON.parse(a.metadata_json ?? '{}').role === JH16_EVALUATION_ROLE);
    const evaluation = evalArtifact ? JSON.parse((await store.get(evalArtifact.object_uri)).toString('utf-8')) : null;
    let calibration: RunSummary['calibration'] = null;
    if ((config.method_id ?? sourceCfg?.method_id) === 'jh16_trends_calibration') {
      calibration = {};
      const rows = results.getByRunId(run.id).filter(r => !r.entityId);
      for (const a of (config.method_params ?? sourceCfg?.method_params).calibration.analyses) {
        const get = (k: string) => rows.find(r => r.metricKey === `${a.id}_${k}`);
        calibration[a.id] = { spearman: get('spearman')?.valueNumeric ?? null, pearson_log10: get('pearson_log10')?.valueNumeric ?? null,
          n: get('n')?.valueNumeric ?? null, excluded: ((get('spearman')?.statisticMetadata as any)?.excluded ?? []) as string[] };
      }
    }
    out.push({ run_id: run.id, created_at: run.created_at, status: run.status, git_commit: run.git_commit ?? null, provenance,
      provenance_label: dossier.provenance_labels?.[provenance] ?? provenance,
      variant: config.variant_id ?? config.region_id ?? sourceCfg?.variant_id ?? sourceCfg?.region_id ?? null, source_run_id: config.source_run_id ?? null,
      acquired_utc: times.length ? [times[0], times[times.length - 1]] : null, fetches: events.length,
      manifest_sha256: artifacts.getManifest(run.id)?.sha256 ?? null, effective_config_hash: run.effective_config_hash ?? null,
      preset: config.preset_id ?? sourceCfg?.preset_id ?? null, evaluation, calibration });
  }
  return out.sort((a, b) => b.created_at.localeCompare(a.created_at) || a.run_id.localeCompare(b.run_id));
}

// --------------------------------------------------------------------------
// Manuscript: a structured document assembled from stored results. Every
// numeric block names the run (or repository file) it comes from.
// --------------------------------------------------------------------------

export type Source = { run_id: string } | { path: string } | { config: string };
export type Block = { type: 'p'; text: string; sources?: Source[] } | { type: 'list'; items: string[]; sources?: Source[] }
  | { type: 'table'; columns: string[]; rows: (string | number | null)[][]; sources?: Source[] };
export interface Manuscript { title: string; target_id: string; dossier_version: string | null; input_hash: string; generated_at: string;
  code_version: string | null; sections: { id: string; title: string; blocks: Block[] }[] }

const n3 = (v: number | null | undefined) => v === null || v === undefined ? '—' : v.toFixed(3).replace('.', ',');
const p3 = (v: number | null | undefined) => v === null || v === undefined ? '—' : v < 0.001 ? v.toExponential(2).replace('.', ',') : v.toFixed(4).replace('.', ',');
const READING: Record<string, string> = { supports: 'dane wspierają hipotezę', contradicts: 'dane przeczą hipotezie', undecided: 'dane nie rozstrzygają', not_computable: 'nie da się ocenić (niekompletne dane)' };
const STATUS: Record<string, string> = { shown: 'wykazana', probable: 'prawdopodobna', unresolved: 'nierozstrzygnięta', excluded: 'wykluczona' };
const short = (id: string) => id.slice(0, 8);

/** The latest complete run of each provenance kind and variant: the ones a reader is shown first. */
export function primaryRuns(runs: readonly RunSummary[]): RunSummary[] {
  const seen = new Set<string>(), out: RunSummary[] = [];
  for (const r of runs) {
    if (r.status !== 'COMPLETED' || (r.evaluation && !r.evaluation.complete) || (!r.evaluation && !r.calibration)) continue;
    const key = `${r.provenance}:${r.variant ?? ''}`;
    if (!seen.has(key)) { seen.add(key); out.push(r); }
  }
  return out;
}

export function buildManuscript(t: ReplicationTarget, runs: readonly RunSummary[], published: any, codeVersion: string | null, now = new Date().toISOString()): Manuscript {
  const { target, dossier } = t, cite = target.citation;
  const primary = primaryRuns(runs), jh = primary.filter(r => r.evaluation), cal = primary.filter(r => r.calibration);
  const hist = jh.find(r => r.provenance === 'recomputation_of_published_data'), fresh = jh.find(r => r.provenance === 'new_fetch');
  const variants = jh.filter(r => r.provenance === 'enhanced_variant');
  const reported = published?.reported_statistics;
  const stat = (r: RunSummary, s: 'pearson' | 'spearman') => r.evaluation.hi_vs_reference.find((x: any) => x.statistic === s);
  const verdict = (r: RunSummary, key: string) => r.evaluation.verdicts.find((v: any) => v.claim_key === key)?.verdict ?? '—';
  const sections: Manuscript['sections'] = [];
  const sec = (id: string, title: string, blocks: Block[]) => sections.push({ id, title, blocks });

  const summary: Block[] = [{ type: 'p', text: `Praca ${cite.authors.join(', ')} (${cite.journal} ${cite.year}, doi:${target.identifier}) podała korelację wskaźnika szkodliwości z oceną ekspercką ${reported ? `${String(reported.correlation_coefficient_percent).replace('.', ',')}% (n = ${reported.n})` : '—'}.`, sources: [{ config: target.identifier }] }];
  if (hist) summary.push({ type: 'p', text: `Przeliczenie danych z publikacji w WatchDogu daje Pearson ${n3(stat(hist, 'pearson')?.value)} (p ${p3(stat(hist, 'pearson')?.p_two_sided)}); werdykt: ${verdict(hist, 'harm_index_vs_reference_pearson')}. To sprawdzenie obliczeń, nie niezależna replikacja.`, sources: [{ run_id: hist.run_id }] });
  if (fresh) summary.push({ type: 'p', text: `Nowy pomiar (${fresh.acquired_utc?.[0].slice(0, 10) ?? '—'}) daje Pearson ${n3(stat(fresh, 'pearson')?.value)} (p ${p3(stat(fresh, 'pearson')?.p_two_sided)}), Spearman ${n3(stat(fresh, 'spearman')?.value)}; werdykt H-harm: ${verdict(fresh, 'harm_index_vs_reference_pearson')}; odczyt według reguły ustalonej przed danymi: ${READING[fresh.evaluation.hypothesis_harm.reading]}. Ranking popularności względem Tabeli 1: Spearman ${n3(fresh.evaluation.pi_vs_published.value)}, werdykt ${verdict(fresh, 'popularity_ranking_stability')}.`, sources: [{ run_id: fresh.run_id }] });
  else summary.push({ type: 'p', text: 'Nie ma jeszcze ukończonego, kompletnego nowego pomiaru; wyniki nowych danych nie są dostępne.' });
  const shown = (dossier?.diagnosis ?? []).filter((d: any) => d.status === 'shown').map((d: any) => d.cause);
  if (shown.length) summary.push({ type: 'p', text: `Wykazane przyczyny rozbieżności: ${shown.join('; ')}.` });
  sec('summary', 'Streszczenie', summary);

  sec('introduction', 'Wprowadzenie i hipotezy', [
    { type: 'p', text: `Replikowana praca: „${target.title}”, ${cite.authors.join(', ')}, ${cite.journal} ${cite.year};${cite.volume}(${cite.issue}):${cite.elocation}, doi:${target.identifier}.` },
    { type: 'list', items: (dossier?.hypotheses ?? []).map((h: any) => `${h.id} (${h.kind === 'primary' ? 'główna' : 'opisowa'}): ${h.statement}`), sources: [{ config: 'dossier' }] }]);
  sec('method_original', 'Metoda pracy oryginalnej', [{ type: 'list', items: dossier?.original_method ?? [] }]);
  sec('method_replication', 'Metoda replikacji i odstępstwa', [
    { type: 'list', items: dossier?.replication_method ?? [], sources: [{ path: dossier?.protocol?.document ?? '' }] },
    { type: 'table', columns: ['Element', 'Oryginał', 'Replikacja', 'Powód'], rows: (dossier?.deviations ?? []).map((d: any) => [d.item, d.original, d.replication, d.reason]) },
    { type: 'list', items: target.claims.map((c: any) => `Kryterium ${c.claim_key}: ${c.statistic}, ${c.tolerance_kind} ${c.tolerance_kind === 'interval' ? `[${c.tolerance_value}; ${c.interval_upper}]` : `≥ ${c.tolerance_value}`} — ustalone przed danymi (commit ${target._pre_registration?.bands_proposed_in_commit?.slice(0, 7) ?? '—'}).`), sources: [{ config: 'claims' }] }]);
  sec('data', 'Dane i ich pochodzenie', [{ type: 'table', columns: ['Przebieg', 'Pochodzenie', 'Wariant/region', 'Pobranie (UTC)', 'Kod', 'Stan'],
    rows: runs.map(r => [short(r.run_id), r.provenance_label, r.variant ?? '—', r.acquired_utc ? `${r.acquired_utc[0].slice(0, 16)}–${r.acquired_utc[1].slice(11, 16)}` : '—', r.git_commit?.slice(0, 7) ?? 'nie zapisano',
      r.evaluation ? (r.evaluation.complete ? 'kompletny' : `niekompletny (${r.evaluation.missing_entities.length} braków)`) : r.status]),
    sources: runs.map(r => ({ run_id: r.run_id })) }]);
  const resultRows = jh.map(r => [short(r.run_id), r.provenance_label + (r.variant ? ` · ${r.variant}` : ''), n3(stat(r, 'pearson')?.value), p3(stat(r, 'pearson')?.p_two_sided), n3(stat(r, 'spearman')?.value),
    n3(r.evaluation.pi_vs_published.value), verdict(r, 'harm_index_vs_reference_pearson'), verdict(r, 'popularity_ranking_stability'), READING[r.evaluation.hypothesis_harm.reading]]);
  const results: Block[] = [{ type: 'table', columns: ['Przebieg', 'Pochodzenie', 'Pearson Hi', 'p', 'Spearman Hi', 'Spearman Pi vs Tab. 1', 'Werdykt H-harm', 'Werdykt rankingu', 'Odczyt hipotezy'], rows: resultRows, sources: jh.map(r => ({ run_id: r.run_id })) }];
  if (fresh) results.push({ type: 'table', columns: ['Substancja', 'Ni (nowy)', 'Ni 2014', 'Hi % (nowy)', 'Hi % 2014', 'Nutt', 'Flagi'],
    rows: fresh.evaluation.entities.map((e: any) => [e.entity_id, e.Ni, published?.substances?.find((s: any) => s.canonical === e.entity_id)?.Ni ?? null, e.Hi === null ? null : Number(e.Hi.toFixed(2)), e.published_Hi, e.reference_score, e.flags.join(', ')]),
    sources: [{ run_id: fresh.run_id }, { path: 'fixtures/jh2016/paper_reported.json' }] });
  sec('results', 'Wyniki', results);
  sec('comparison', 'Porównanie z pracą oryginalną', [
    { type: 'p', text: `Publikacja: ${reported ? `${String(reported.correlation_coefficient_percent).replace('.', ',')}%, p = ${String(reported.p_value).replace('.', ',')}` : '—'}. ${hist ? `Przeliczenie: Pearson ${n3(stat(hist, 'pearson')?.value)}, p ${p3(stat(hist, 'pearson')?.p_two_sided)}.` : ''} ${fresh ? `Nowe dane: Pearson ${n3(stat(fresh, 'pearson')?.value)}.` : ''} ${variants.length ? `Warianty rozszerzenia: ${variants.map(v => `${v.variant} ${n3(stat(v, 'pearson')?.value)}`).join(', ')}.` : ''}`.trim(),
      sources: [...(hist ? [{ run_id: hist.run_id }] : []), ...(fresh ? [{ run_id: fresh.run_id }] : []), ...variants.map(v => ({ run_id: v.run_id }))] }]);
  if (cal.length) {
    const ids = Object.keys(cal[0].calibration!);
    sec('calibration', 'Kalibracja eksploracyjna (Google Trends)', [
      { type: 'p', text: 'Google Trends to względne zainteresowanie wyszukiwaniem, nie liczba wyników; porównywane są tylko rangi, bez werdyktów. Próbka Trends zmienia się między pobraniami.' },
      { type: 'table', columns: ['Region (przebieg)', ...ids], rows: cal.map(r => [`${r.variant ?? '—'} (${short(r.run_id)})`, ...ids.map(id => r.calibration![id].spearman === null ? 'nieobliczalne' : n3(r.calibration![id].spearman))]), sources: cal.map(r => ({ run_id: r.run_id })) }]);
  }
  sec('discrepancies', 'Rozbieżności i ich przyczyny', [{ type: 'table', columns: ['Możliwa przyczyna', 'Test', 'Status', 'Dowód'],
    rows: (dossier?.diagnosis ?? []).map((d: any) => [d.cause, d.test, STATUS[d.status] ?? d.status, (d.evidence ?? []).map((e: any) => e.path ?? e.label).join('; ') || '—']), sources: [{ config: 'dossier' }] }]);
  sec('limitations', 'Ograniczenia', [{ type: 'list', items: dossier?.limitations ?? [] }]);
  const conclusions: string[] = [];
  if (hist) conclusions.push(hist.evaluation.verdicts.every((v: any) => v.verdict === 'reproduced') ? 'Implementacja metody odtwarza wyniki publikacji na jej własnych danych.' : 'Implementacja nie odtwarza wyników publikacji na jej danych — wymaga sprawdzenia przed interpretacją nowych danych.');
  if (fresh) conclusions.push(`Na nowych danych ${READING[fresh.evaluation.hypothesis_harm.reading]} (reguła ustalona przed danymi).`);
  if (shown.length) conclusions.push('Wykazane przyczyny dotyczą narzędzia pomiaru; jakość danych nie pozwala traktować tego odczytu jako rozstrzygnięcia hipotezy merytorycznej.');
  conclusions.push('Wynik negatywny jest wynikiem: praca dokumentuje go w całości, z danymi i ich pochodzeniem.');
  sec('conclusions', 'Wnioski', [{ type: 'list', items: conclusions, sources: [...(hist ? [{ run_id: hist.run_id }] : []), ...(fresh ? [{ run_id: fresh.run_id }] : [])] }]);
  sec('appendix', 'Aneks: odtwarzalność', [
    { type: 'table', columns: ['Przebieg', 'Kod', 'Hash konfiguracji', 'Manifest sha256', 'Pobrania'], rows: runs.map(r => [r.run_id, r.git_commit ?? 'nie zapisano', r.effective_config_hash ?? '—', r.manifest_sha256 ?? '—', r.fetches]), sources: runs.map(r => ({ run_id: r.run_id })) },
    { type: 'list', items: [`Kryteria: ${t.hashes.claims}`, ...(t.hashes.interpretation ? [`Interpretacja: ${t.hashes.interpretation}`] : []), ...(t.hashes.dossier ? [`Dossier: ${t.hashes.dossier}`] : []),
      `Prerejestracja: ${dossier?.protocol?.document ?? '—'} (commit ${dossier?.protocol?.registered_in_commit ?? '—'})`, `Wersja kodu generującego: ${codeVersion ?? 'nie zapisano'}`] }]);
  const input_hash = canonicalHash({ hashes: t.hashes, runs: runs.map(r => ({ id: r.run_id, m: r.manifest_sha256, e: r.evaluation ? canonicalHash(r.evaluation) : null, c: r.calibration })) });
  return { title: `Replikacja: ${target.title}`, target_id: target.target_id, dossier_version: dossier?.dossier_version ?? null, input_hash, generated_at: now, code_version: codeVersion, sections };
}

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const srcText = (s: Source[] | undefined) => s?.length ? s.map(x => 'run_id' in x ? `przebieg ${short(x.run_id)}` : 'path' in x ? x.path : `konfiguracja ${x.config}`).join(', ') : '';

export function manuscriptMarkdown(m: Manuscript): string {
  const out = [`# ${m.title}`, '', `_Wygenerowano ${m.generated_at} z zapisanych wyników WatchDoga (kod ${m.code_version ?? '—'}, dane wejściowe ${m.input_hash.slice(0, 16)}). Liczby pochodzą z wymienionych przebiegów; tekst nie był redagowany przez model językowy._`, ''];
  for (const s of m.sections) {
    out.push(`## ${s.title}`, '');
    for (const b of s.blocks) {
      if (b.type === 'p') out.push(b.text);
      else if (b.type === 'list') out.push(...b.items.map(i => `- ${i}`));
      else { out.push(`| ${b.columns.join(' | ')} |`, `|${b.columns.map(() => '---').join('|')}|`, ...b.rows.map(r => `| ${r.map(c => c === null ? '—' : String(c).replace(/\|/g, '/')).join(' | ')} |`)); }
      if (b.sources?.length) out.push('', `_Źródło: ${srcText(b.sources)}_`);
      out.push('');
    }
  }
  return out.join('\n');
}

export function manuscriptHtml(m: Manuscript): string {
  const body = m.sections.map(s => `<section><h2>${esc(s.title)}</h2>${s.blocks.map(b => {
    const src = b.sources?.length ? `<p class="src">Źródło: ${esc(srcText(b.sources))}</p>` : '';
    if (b.type === 'p') return `<p>${esc(b.text)}</p>${src}`;
    if (b.type === 'list') return `<ul>${b.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>${src}`;
    return `<table><thead><tr>${b.columns.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${b.rows.map(r => `<tr>${r.map(c => `<td>${esc(c ?? '—')}</td>`).join('')}</tr>`).join('')}</tbody></table>${src}`;
  }).join('')}</section>`).join('');
  return `<!doctype html><html lang="pl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(m.title)}</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:60rem;margin:2rem auto;padding:0 1rem;color:#1e293b}table{border-collapse:collapse;width:100%;font-size:13px;display:block;overflow-x:auto}td,th{border:1px solid #cbd5e1;padding:4px 6px;text-align:left}.src,.meta{color:#64748b;font-size:12px}</style></head>
<body><h1>${esc(m.title)}</h1><p class="meta">Wygenerowano ${esc(m.generated_at)} z zapisanych wyników WatchDoga (kod ${esc(m.code_version ?? '—')}, dane wejściowe ${esc(m.input_hash.slice(0, 16))}). Tekst nie był redagowany przez model językowy.</p>${body}</body></html>`;
}
