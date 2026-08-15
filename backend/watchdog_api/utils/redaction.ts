export const SENSITIVE_KEYS = new Set([
  'password', 'token', 'secret', 'api_key', 'apikey', 'authorization', 'client_secret'
]);

export function redact(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) {
    return obj.map(redact);
  }

  const redactedObj: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase()) || key.toLowerCase().includes('secret') || key.toLowerCase().includes('password')) {
      redactedObj[key] = '[REDACTED]';
    } else {
      redactedObj[key] = redact(value);
    }
  }
  return redactedObj;
}
