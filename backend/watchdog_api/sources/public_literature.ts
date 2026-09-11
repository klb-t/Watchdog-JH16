import type { JobRequest, PaperRecord } from '../../../shared/automation';
import { PublicHttp } from './public_http';
import { parseArxivAtom } from './atom';
import { AutomationError } from '../db/repositories/automation';

export function screenPaper(title: string, abstract: string | null, http: Pick<PublicHttp, 'profile'>): PaperRecord['screening'] {
  const text = `${title} ${abstract ?? ''}`.toLowerCase(), config = http.profile.discovery;
  return { version: config.screeningVersion, state: 'DISCOVERED', clinicalUse: false,
    hints: config.methodHints.filter(h => text.includes(h.toLowerCase())), blockers: [...config.blockers] };
}
export async function scanLiterature(http: PublicHttp, owner: string, request: Extract<JobRequest, {kind: 'paper_scan'}>, provider: 'arxiv' | 'europe_pmc', now = new Date()) {
  const from = new Date(now.getTime() - request.lookbackDays * 86400000), to = new Date(now);
  let fetched = 0, total = 0, cursor = '*'; const ids = new Set<string>(), seenCursors = new Set<string>();
  const isoDay = (d: Date) => d.toISOString().slice(0, 10), arxivDate = (d: Date) => d.toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const query = provider === 'arxiv'
    ? `${request.scope === 'substances' ? `${http.profile.discovery.arxivSubstanceQuery} AND ` : ''}lastUpdatedDate:[${arxivDate(from)} TO ${arxivDate(to)}]`
    : `${request.scope === 'substances' ? `${http.profile.discovery.europePmcSubstanceQuery} AND ` : ''}FIRST_IDATE:[${isoDay(from)} TO ${isoDay(to)}]`;
  for (let page = 0; page < request.pageLimit; page++) {
    let rows: Omit<PaperRecord, 'id' | 'receiptId' | 'screening'>[], receipt;
    if (provider === 'arxiv') {
      const response = await http.get('arxiv', '/api/query', { search_query: query, start: fetched, max_results: 50,
        sortBy: 'lastUpdatedDate', sortOrder: 'ascending' });
      const feed = parseArxivAtom(response.bytes.toString('utf8')); total = feed.total; receipt = response.receipt;
      rows = feed.entries.map(r => ({ ...r, provider, sourceLanguage: null, geography: null }));
    } else {
      if (seenCursors.has(cursor)) throw new AutomationError('Europe PMC repeated a pagination cursor'); seenCursors.add(cursor);
      const response = await http.json('europe_pmc', '/europepmc/webservices/rest/search', { query, cursorMark: cursor,
        pageSize: 50, format: 'json', resultType: 'lite' });
      const data = response.data; receipt = response.receipt;
      if (!Number.isSafeInteger(data.hitCount) || data.hitCount < 0 || !Array.isArray(data.resultList?.result)) throw new AutomationError('Malformed Europe PMC search page');
      total = data.hitCount;
      rows = data.resultList.result.map((r: any) => {
        if (typeof r.id !== 'string' || !/^[A-Z_]+$/.test(r.source ?? '') || typeof r.title !== 'string') throw new AutomationError('Malformed Europe PMC paper identity');
        return { provider, sourceId: `${r.source}:${r.id}`, title: r.title, abstract: null, authors: r.authorString ? [r.authorString] : [],
          doi: typeof r.doi === 'string' ? r.doi : null, url: `https://europepmc.org/article/${r.source}/${encodeURIComponent(r.id)}`,
          publishedAt: r.firstPublicationDate ?? null, updatedAt: null, categories: r.pubType ? [r.pubType] : [], sourceLanguage: null, geography: null };
      });
      cursor = data.nextCursorMark ?? '';
    }
    for (const row of rows) ids.add(http.repo.paper(owner, { ...row, receiptId: receipt.id, screening: screenPaper(row.title, row.abstract, http) }));
    fetched += rows.length;
    if (fetched >= total) break;
    if (!rows.length || provider === 'europe_pmc' && !cursor) throw new AutomationError(`${provider}: pagination ended before the reported total`);
  }
  return { provider, query, from: from.toISOString(), to: to.toISOString(), fetched, totalReported: total,
    uniqueVersions: ids.size, complete: fetched >= total, next: fetched >= total ? null : provider === 'arxiv' ? { start: fetched } : { cursorMark: cursor },
    scopeMeaning: request.scope === 'all_science' ? 'All disciplines covered by the selected repositories; not all scientific publications worldwide' : 'Configured substance terms',
    automaticVerdicts: 0 };
}
