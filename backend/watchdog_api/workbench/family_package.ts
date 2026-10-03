import { createHash } from 'node:crypto';
import { canonicalHash } from '../domain/canonical';
import { createZip, readZip, type ZipEntry } from '../utils/zip';
import { loadFamilyVerifier } from '../config/workbench';

/**
 * E5.7b.1a — a portable package for one frozen comparison family. It holds the
 * family record, every family event, the summary, and the verifiable E5.7d
 * package of each member's latest family attempt (unpacked under members/N/).
 * A member without a package keeps an explicit reason. The bundled
 * verify-family.mjs recomputes the summary from these files alone.
 * New format; research packages v1/v2 and their verifier are unchanged.
 */
export interface FamilyPackageMember { position: number; comparisonId: string; bundle: { bytes: Buffer; manifestHash: string } | null; reason: string | null }

export function familyPackage(family: { id: string; hash: string; body: any; summary: any; events: any[] }, members: FamilyPackageMember[]) {
  const entries: ZipEntry[] = [];
  const add = (name: string, content: string | Buffer) => entries.push({ name, content: Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8') });
  const json = (name: string, value: unknown) => add(name, `${JSON.stringify(value, null, 2)}\n`);
  json('family.json', { id: family.id, hash: family.hash, body: family.body });
  json('events.json', family.events);
  json('summary.json', family.summary);
  for (const m of [...members].sort((a, b) => a.position - b.position)) {
    if (m.bundle) for (const e of readZip(m.bundle.bytes)) add(`members/${m.position}/${e.name}`, e.content);
  }
  add('verify-family.mjs', loadFamilyVerifier());
  add('FAMILY.md', `# Frozen comparison family\n\nfamily.json is the frozen membership: reviewed comparisons of one paper version, fixed before any family attempt ran, with the attempts already seen at that moment (priorExposure). events.json records every attempt and refusal made through the family. summary.json reports every member against the frozen denominator.\n\nmembers/N/ holds the complete verifiable research package of member N's latest family attempt, when one completed. A member without a package has its reason in family-manifest.json.\n\nVerify with Node.js only, offline:\n\n    node verify-family.mjs . [independently-recorded-family-manifest-sha256]\n\nThe verifier checks every byte, runs each member's own verifier pinned to its manifest hash, and recomputes the summary from the events and member packages. There is no family verdict, significance test or multiplicity correction: how many agreements matter is a human judgement. Freezing is not preregistration; exposure outside Watchdog is unknown. Member statistics are not rerun. The packages include full paper texts and source data; review before sharing.\n`);
  const manifest = {
    version: 'watchdog-comparison-family-package-1',
    identity: { familyId: family.id, familyHash: family.hash, summaryHash: canonicalHash(family.summary) },
    members: [...members].sort((a, b) => a.position - b.position).map(m => ({ position: m.position, comparisonId: m.comparisonId,
      packageManifestHash: m.bundle?.manifestHash ?? null, reason: m.bundle ? null : m.reason ?? 'No completed family attempt.' })),
    files: entries.map(e => ({ path: e.name, bytes: e.content.length, sha256: createHash('sha256').update(e.content).digest('hex') }))
      .sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
  };
  const manifestHash = canonicalHash(manifest);
  json('family-manifest.json', manifest);
  const bytes = createZip(entries);
  return { bytes, manifestHash, sha256: createHash('sha256').update(bytes).digest('hex'), manifest };
}
