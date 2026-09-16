import { createHash } from 'node:crypto';

/**
 * Canonical JSON serialisation: key order is normalised so that two
 * semantically equal structures produce byte-identical output.
 *
 * `node:crypto` is pure computation, not I/O — importing it does not give the
 * domain layer a database, a network or a filesystem, and the E1.2 isolation
 * test allows it explicitly for that reason.
 */
export function canonicalizeJson(obj: any): string {
  if (obj === null || obj === undefined) return 'null';
  if (typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    const arrStr = obj.map(item => canonicalizeJson(item)).join(',');
    return `[${arrStr}]`;
  }

  const sortedKeys = Object.keys(obj).sort();
  const sortedObjStr = sortedKeys
    .map(key => `${JSON.stringify(key)}:${canonicalizeJson(obj[key])}`)
    .join(',');
  return `{${sortedObjStr}}`;
}

/** SHA-256 of the canonical serialisation. Stable under key reordering. */
export function canonicalHash(obj: any): string {
  return createHash('sha256').update(canonicalizeJson(obj)).digest('hex');
}
