export interface RequestDiagnostic { at: string; path: string; method: string; status: number | null; durationMs: number; traceId: string | null; error?: string }
let events: RequestDiagnostic[] = [];
const listeners = new Set<() => void>();
export const subscribeDiagnostics = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const requestDiagnostics = () => events;
function record(event: RequestDiagnostic) { events = [event, ...events].slice(0, 60); listeners.forEach(fn => fn()); }
const REPORT_PATH = '/api/client-errors';
const MAX_REPORTS_PER_PAGE = 20;
let reports = 0;
const recent = new Map<string, number>();

/**
 * Sends one failure to the server's diagnostics log (POST /api/client-errors),
 * so a problem seen in someone's browser leaves a record next to the server
 * trace. Metadata only, capped per page load, duplicates within 10 s dropped,
 * and never allowed to throw into the page.
 */
function report(original: typeof fetch, r: { kind: 'error' | 'unhandledrejection' | 'http' | 'network'; message: string; stack?: string | null;
  apiPath?: string | null; method?: string | null; status?: number | null; traceId?: string | null }) {
  try {
    const key = `${r.kind}|${r.message}|${r.apiPath ?? ''}|${r.status ?? ''}`, now = Date.now();
    if ((recent.get(key) ?? 0) > now - 10_000 || reports >= MAX_REPORTS_PER_PAGE) return;
    recent.set(key, now); reports += 1;
    const body = { ...r, message: r.message.slice(0, 2000), stack: r.stack?.slice(0, 8000) ?? null, path: location.pathname,
      at: new Date().toISOString(), userAgent: navigator.userAgent.slice(0, 400) };
    void original(REPORT_PATH, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive: true }).catch(() => {});
  } catch { /* diagnostics must never break the page */ }
}

/** Metadata only: never record request bodies, URL queries, credentials or response payloads. */
export function installClientDiagnostics() {
  const original = window.fetch.bind(window);
  window.addEventListener('error', e => report(original, { kind: 'error', message: e.message || String(e.error ?? 'Script error'), stack: e.error?.stack ?? `${e.filename}:${e.lineno}:${e.colno}` }));
  window.addEventListener('unhandledrejection', e => {
    const reason = e.reason as { message?: string; stack?: string } | undefined;
    report(original, { kind: 'unhandledrejection', message: reason?.message ?? String(e.reason), stack: reason?.stack ?? null });
  });
  window.fetch = async (input, init) => {
    const started = performance.now(), at = new Date().toISOString();
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.origin);
    const track = url.origin === location.origin && url.pathname.startsWith('/api/');
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    try {
      const response = await original(input, init);
      if (track) record({ at, path: url.pathname, method, status: response.status, durationMs: Math.round(performance.now() - started), traceId: response.headers.get('x-trace-id') });
      if (track && response.status >= 500 && url.pathname !== REPORT_PATH)
        report(original, { kind: 'http', message: `HTTP ${response.status}`, apiPath: url.pathname, method, status: response.status, traceId: response.headers.get('x-trace-id') });
      return response;
    } catch (e) {
      if (track) record({ at, path: url.pathname, method, status: null, durationMs: Math.round(performance.now() - started), traceId: null, error: 'Network request failed' });
      if (track && url.pathname !== REPORT_PATH)
        report(original, { kind: 'network', message: (e as Error).message || 'Network request failed', apiPath: url.pathname, method });
      throw e;
    }
  };
  window.addEventListener('watchdog-session-changed', () => { events = []; listeners.forEach(fn => fn()); });
}
