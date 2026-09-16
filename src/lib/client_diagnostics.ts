export interface RequestDiagnostic { at: string; path: string; method: string; status: number | null; durationMs: number; traceId: string | null; error?: string }
let events: RequestDiagnostic[] = [];
const listeners = new Set<() => void>();
export const subscribeDiagnostics = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const requestDiagnostics = () => events;
function record(event: RequestDiagnostic) { events = [event, ...events].slice(0, 60); listeners.forEach(fn => fn()); }
/** Metadata only: never record request bodies, URL queries, credentials or response payloads. */
export function installClientDiagnostics() {
  const original = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const started = performance.now(), at = new Date().toISOString();
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.origin);
    const track = url.origin === location.origin && url.pathname.startsWith('/api/');
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    try {
      const response = await original(input, init);
      if (track) record({ at, path: url.pathname, method, status: response.status, durationMs: Math.round(performance.now() - started), traceId: response.headers.get('x-trace-id') });
      return response;
    } catch (e) {
      if (track) record({ at, path: url.pathname, method, status: null, durationMs: Math.round(performance.now() - started), traceId: null, error: 'Network request failed' });
      throw e;
    }
  };
  window.addEventListener('watchdog-session-changed', () => { events = []; listeners.forEach(fn => fn()); });
}
