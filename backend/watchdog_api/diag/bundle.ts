import * as fs from 'node:fs';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { createZip, ZipEntry } from '../utils/zip';
import { redact, redactText } from '../utils/redaction';
import { tracer } from '../utils/tracer';

/**
 * The diagnostic bundle (`06_DIAGNOSTICS.md` §Diagnostic bundle).
 *
 * One call produces a redacted archive containing the run's trace stream, the
 * effective configuration, the manifest if one exists, artifact hashes, an
 * environment and dependency fingerprint, and the error envelope.
 *
 * The point, in the maintainer's own framing: this is how someone working from
 * a phone hands a failure to an agent with no further explanation. So it has to
 * be self-contained and safe to attach to an issue — everything below goes
 * through the central redaction layer on the way in.
 */

export interface BundleInput {
  runId: string;
  traceId?: string;
  effectiveConfig?: unknown;
  manifest?: unknown;
  artifacts?: { kind: string; sha256: string; object_uri: string }[];
  errorEnvelope?: unknown;
  /** Overridable so tests need not depend on the real diagnostics directory. */
  traceDir?: string;
}

export interface BundleResult {
  zip: Buffer;
  sha256: string;
  entryNames: string[];
}

function dependencyFingerprint(): Record<string, unknown> {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8'));
    return {
      name: pkg.name,
      version: pkg.version,
      dependencies: pkg.dependencies ?? {},
      devDependencies: pkg.devDependencies ?? {},
    };
  } catch {
    return { error: 'package.json unreadable' };
  }
}

function environmentFingerprint(): Record<string, unknown> {
  // Deliberately not process.env: it is the single most likely place for a
  // credential to be sitting, and nothing here needs it.
  return {
    node_version: process.version,
    platform: process.platform,
    arch: process.arch,
    diagnostics_mode: tracer.getMode(),
  };
}

function readTraceFiles(dir: string | undefined): ZipEntry[] {
  if (!dir || !fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.jsonl'))
    .sort()
    .map(f => ({
      name: `trace/${f}`,
      // Trace files are already redacted on write; redacting again on read is
      // cheap and means a bundle stays safe even if a sink is ever added that
      // forgets. Defence in depth is warranted where the cost is one pass over
      // a few kilobytes.
      content: Buffer.from(redactText(fs.readFileSync(path.join(dir, f), 'utf-8')), 'utf-8'),
    }));
}

function jsonEntry(name: string, value: unknown): ZipEntry {
  return { name, content: Buffer.from(JSON.stringify(redact(value), null, 2) + '\n', 'utf-8') };
}

export function buildDiagnosticBundle(input: BundleInput): BundleResult {
  const traceDir = input.traceDir ?? (input.traceId ? tracer.traceDir(input.traceId) : undefined);

  const entries: ZipEntry[] = [
    jsonEntry('bundle.json', {
      schema_version: '1.0',
      run_id: input.runId,
      trace_id: input.traceId ?? null,
      contents: [
        'bundle.json', 'environment.json', 'dependencies.json',
        'effective_config.json', 'manifest.json', 'artifacts.json',
        'error_envelope.json', 'trace/*.jsonl',
      ],
      note: 'Redacted. Safe to attach to an issue or hand to an agent.',
    }),
    jsonEntry('environment.json', environmentFingerprint()),
    jsonEntry('dependencies.json', dependencyFingerprint()),
    jsonEntry('effective_config.json', input.effectiveConfig ?? null),
    jsonEntry('manifest.json', input.manifest ?? null),
    jsonEntry('artifacts.json', input.artifacts ?? []),
    jsonEntry('error_envelope.json', input.errorEnvelope ?? null),
    ...readTraceFiles(traceDir),
  ];

  const zip = createZip(entries);
  return {
    zip,
    sha256: createHash('sha256').update(zip).digest('hex'),
    entryNames: entries.map(e => e.name).sort(),
  };
}
