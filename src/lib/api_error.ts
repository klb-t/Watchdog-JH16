/**
 * An error the interface can show in the reader's language. `message` stays the
 * server's (or client's) English text for logs and the console; `code` is the
 * stable identifier a page translates with `errorText` (see `src/lib/ui_text.ts`),
 * and `vars` fills the label's `{placeholders}` (from the response's `params`).
 */
export class UiError extends Error {
  constructor(message: string, readonly code?: string, readonly vars?: Record<string, string | number>, readonly status?: number) {
    super(message);
  }
}

/** Builds the error for a failed response: the body's code and message when present, `HTTP <status>` otherwise. */
export function responseError(response: { status: number }, data: any): UiError {
  const code = typeof data?.error === 'string' ? data.error : typeof data?.error?.code === 'string' ? data.error.code : undefined;
  const text = data?.message ?? data?.error?.message;
  const params = data?.params && typeof data.params === 'object' ? data.params : undefined;
  // Without a code, a server sentence is shown as sent; only a bare status gets the `http_status` label.
  return new UiError(String(text ?? code ?? `HTTP ${response.status}`), code ?? (text ? undefined : 'http_status'),
    { status: response.status, ...(params ?? {}) }, response.status);
}

/** A failure detected in the browser itself, with a stable code for its label. */
export function clientError(code: string, message: string, vars?: Record<string, string | number>): UiError {
  return new UiError(message, code, vars);
}
