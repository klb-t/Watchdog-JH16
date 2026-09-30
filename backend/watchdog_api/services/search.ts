import type { Principal } from '../domain/principal';
import type { SearchRepository } from '../db/repositories/search';
import { compareSearchHits, normalizeSearchText, type SearchProfile, type SearchQuery, type SearchResponse } from '../../../shared/search';
export class SearchService {
  constructor(private readonly repository: SearchRepository, readonly profile: SearchProfile) {}
  async search(principal: Principal, query: SearchQuery): Promise<SearchResponse> {
    const term = normalizeSearchText(query.q);
    const matches = (await this.repository.entries(principal, query.kind)).filter(entry => entry.terms.some(text => normalizeSearchText(text).includes(term))).map(entry => entry.hit).sort(compareSearchHits);
    const results = matches.slice(query.offset, query.offset + query.limit), next = query.offset + results.length;
    return { query, profile: this.profile, availableKinds: this.repository.availableKinds(principal), total: matches.length, results,
      nextOffset: next < matches.length && next <= this.profile.limits.maximumOffset ? next : null,
      paginationBoundaryReached: next < matches.length && next > this.profile.limits.maximumOffset };
  }
}
