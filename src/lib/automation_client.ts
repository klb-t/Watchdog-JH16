export async function automationApi<T = any>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, { cache: 'no-store', ...(body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message ?? data.error?.message ?? data.error ?? `HTTP ${response.status}`);
  return data;
}
export const formClass = 'rounded border border-slate-300 bg-white p-2 text-sm w-full min-w-0';
export const buttonClass = 'rounded bg-indigo-700 text-white px-3 py-2 text-sm disabled:opacity-50';
export const sectionClass = 'rounded-xl border border-slate-200 bg-white p-4 space-y-3 min-w-0';
