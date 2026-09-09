export class WorkbenchHttpError extends Error { constructor(readonly status: number, message: string) { super(message); } }
export async function workbenchApi(path: string, body?: unknown, raw: boolean | 'blob' = false) {
  const response = await fetch(`/api/workbench/${path}`, { cache: 'no-store', ...(body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  if (!response.ok) { const error = await response.json().catch(() => ({})); throw new WorkbenchHttpError(response.status, error.message ?? error.error ?? `Request failed (${response.status})`); }
  return raw === 'blob' ? { blob: await response.blob(), manifestHash: response.headers.get('X-Package-Manifest-SHA256'), sha256: response.headers.get('X-Package-SHA256') } : raw ? response.text() : response.json();
}
export function downloadText(name: string, content: string, type: string) {
  downloadBlob(name, new Blob([content], { type }));
}
export function downloadBlob(name: string, blob: Blob) {
  const href = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = href; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(href), 1000);
}
