/**
 * Canonicalisation and hashing live in the domain layer, where they are pure
 * and reusable (approval binding in `domain/approval.ts` needs the same
 * stable-under-key-reordering hash the config hash needs). Re-exported here so
 * existing config-layer callers keep their import path.
 */
export { canonicalizeJson, canonicalHash } from '../domain/canonical';
export { canonicalHash as hashConfig } from '../domain/canonical';
