export class WorkbenchHttpError extends Error { constructor(readonly status: number, message: string) { super(message); } }
export async function workbenchApi(path: string, body?: unknown, raw = false) {
  const response = await fetch(`/api/workbench/${path}`, { cache: 'no-store', ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  if (!response.ok) { const error = await response.json().catch(() => ({})); throw new WorkbenchHttpError(response.status, error.message ?? error.error ?? `Request failed (${response.status})`); }
  return raw ? response.text() : response.json();
}
export function downloadText(name: string, content: string, type: string) {
  const href = URL.createObjectURL(new Blob([content], { type })), link = document.createElement('a');
  link.href = href; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(href), 1000);
}
