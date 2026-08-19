/**
 * Central redaction, run before every diagnostic sink without exception
 * (`06_DIAGNOSTICS.md` §Redaction).
 *
 * Two mechanisms, because either alone leaks:
 *
 *  - **By key.** Credential-shaped field names are replaced wherever they
 *    appear in a structured payload.
 *  - **By value.** Registered secret values are replaced wherever they appear,
 *    including inside free text. This is the half a key-based redactor misses:
 *    an error message that interpolates a key ("auth failed for sk-live-abc")
 *    has no credential-shaped key to match on, and is exactly how secrets reach
 *    logs in practice.
 *
 * The canary test in `tests/unit/redaction.test.ts` injects a known value into
 * configuration and asserts it is absent from every sink.
 */

export const REDACTED = '[REDACTED]';

export const SENSITIVE_KEYS = new Set([
  'password', 'passwd', 'token', 'access_token', 'refresh_token', 'id_token',
  'secret', 'client_secret', 'api_key', 'apikey', 'apisecret', 'api_secret',
  'authorization', 'auth', 'cookie', 'set-cookie', 'session', 'session_id',
  'private_key', 'privatekey', 'secret_ref_value', 'credential', 'credentials',
  'bearer', 'signature', 'passphrase',
]);

/** Substrings that mark a key as credential-shaped even when not listed above. */
const SENSITIVE_KEY_FRAGMENTS = ['secret', 'password', 'passwd', 'token', 'apikey', 'api_key', 'credential', 'private_key'];

function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase();
  if (SENSITIVE_KEYS.has(k)) return true;
  return SENSITIVE_KEY_FRAGMENTS.some(f => k.includes(f));
}

/**
 * Values registered here are scrubbed from every sink by literal match.
 * Populated at startup from the secret store and from configured credential
 * values; the canary test registers a known string.
 */
const secretValues = new Set<string>();

export function registerSecretValue(value: string): void {
  // Very short values would match everywhere and destroy legibility for no
  // security gain; a real credential is not three characters.
  if (typeof value === 'string' && value.length >= 6) secretValues.add(value);
}

export function clearRegisteredSecrets(): void {
  secretValues.clear();
}

export function registeredSecretCount(): number {
  return secretValues.size;
}

function scrubString(s: string): string {
  let out = s;
  for (const secret of secretValues) {
    if (out.includes(secret)) out = out.split(secret).join(REDACTED);
  }
  return out;
}

export function redact(obj: any, seen: WeakSet<object> = new WeakSet()): any {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === 'string') return scrubString(obj);
  if (typeof obj !== 'object') return obj;

  // Cycles would otherwise hang the redactor before anything reaches a sink.
  if (seen.has(obj)) return '[CIRCULAR]';
  seen.add(obj);

  if (Array.isArray(obj)) return obj.map(v => redact(v, seen));

  if (Buffer.isBuffer(obj)) return `[BUFFER ${obj.length} bytes]`;

  if (obj instanceof Error) {
    return {
      name: obj.name,
      message: scrubString(obj.message),
      stack: obj.stack ? scrubString(obj.stack) : undefined,
    };
  }

  const out: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    out[key] = isSensitiveKey(key) ? REDACTED : redact(value, seen);
  }
  return out;
}

/** For sinks that write text rather than structured data. */
export function redactText(text: string): string {
  return scrubString(text);
}
