import { createHash } from 'node:crypto';

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

export function hashConfig(obj: any): string {
  const canonical = canonicalizeJson(obj);
  return createHash('sha256').update(canonical).digest('hex');
}
