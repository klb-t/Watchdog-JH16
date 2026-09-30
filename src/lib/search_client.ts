import type { SearchQuery, SearchResponse } from '../../shared/search';
export async function searchMetadata(query: Omit<SearchQuery, 'limit'> & { limit?: number }, signal?: AbortSignal): Promise<SearchResponse> {
  const params = new URLSearchParams({ q: query.q, kind: query.kind, offset: String(query.offset) });
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  const response = await fetch(`/api/search?${params}`, { cache: 'no-store', signal });
  if (!response.ok) throw new Error(response.status === 403 ? 'Brak uprawnień do tego rodzaju wyników.' : response.status === 401 ? 'Zaloguj się, aby przeszukiwać bazę.' : 'Nie udało się wyszukać zapisanych danych.');
  return response.json();
}
