import { clientError } from './api_error';
import type { SearchQuery, SearchResponse } from '../../shared/search';
export async function searchMetadata(query: Omit<SearchQuery, 'limit'> & { limit?: number }, signal?: AbortSignal): Promise<SearchResponse> {
  const params = new URLSearchParams({ q: query.q, kind: query.kind, offset: String(query.offset) });
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  const response = await fetch(`/api/search?${params}`, { cache: 'no-store', signal });
  // English for the console; the page shows the label for the code in the reader's language.
  if (!response.ok) throw clientError(response.status === 403 ? 'search_forbidden' : response.status === 401 ? 'search_unauthenticated' : 'search_failed',
    response.status === 403 ? 'Not allowed to see this kind of result.' : response.status === 401 ? 'Sign in to search the database.' : 'Saved data could not be searched.');
  return response.json();
}
