import { responseError } from './api_error';
export async function projectsApi<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/projects${path}`, { cache: 'no-store', ...(body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }) });
  const data = await response.json();
  if (!response.ok) throw responseError(response, data);
  return data;
}
