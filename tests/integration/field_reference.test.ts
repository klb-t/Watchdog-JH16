import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import express from 'express';
import { runMigrations } from '../../backend/watchdog_api/db/migrations';
import { LocalFileSystemStore } from '../../backend/watchdog_api/storage/object_store';
import { FieldReferenceRepository } from '../../backend/watchdog_api/db/repositories/field_reference';
import { FieldService } from '../../backend/watchdog_api/field/service';
import { loadFieldProfile, loadFieldCatalog } from '../../backend/watchdog_api/config/field';
import { buildFieldRouter } from '../../backend/watchdog_api/api/field_routes';
import { traceMiddleware, errorHandler } from '../../backend/watchdog_api/api/middleware';
import { tracer } from '../../backend/watchdog_api/utils/tracer';
import { approve } from '../../backend/watchdog_api/domain/approval';
import { canonicalHash } from '../../backend/watchdog_api/domain/canonical';
import { validateReferenceDocument, validateFieldQuery } from '../../shared/field_validation';
import { verifySnapshot } from '../../shared/field_snapshot';
import { lookupField } from '../../shared/field_lookup';
import { CONTENT_CATEGORIES, type ReferenceDocument, type SampleDocument } from '../../shared/field';
import { testSample, testAssertion, testQuery } from '../helpers/field';

async function harness() {
  const dir = mkdtempSync(path.join(tmpdir(), 'watchdog-field-test-'));
  const db = new Database(':memory:'); db.pragma('foreign_keys = ON'); runMigrations(db);
  const repo = new FieldReferenceRepository(db, new LocalFileSystemStore(dir));
  const service = new FieldService(repo, loadFieldProfile());
  let roles = ['researcher', 'responder'];
  const app = express(); app.use(express.json()); app.use(traceMiddleware);
  app.use((req, _res, next) => { req.principal = { id: 'fictional-reviewer', email: null, roles, identityProvenance: 'test' }; next(); });
  app.use('/field', buildFieldRouter(repo, service)); app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as any).port}/field`;
  const call = (route: string, body?: unknown, headers?: Record<string,string>) => fetch(base + route, body === undefined ? { headers } :
    { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const add = async (doc: ReferenceDocument, accepted = true) => {
    const record = await repo.importDocument(doc, 'fixture-author', randomUUID());
    return accepted ? repo.saveApproval(approve({ id: record.id, kind: 'reference_mapping', content: record.document }, 'fictional-reviewer', new Date().toISOString()), record.contentHash, randomUUID()) : record;
  };
  return { dir, db, repo, service, call, add, roles: (value: string[]) => { roles = value; },
    close: async () => { await new Promise<void>(r => server.close(() => r())); db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('E6: real HTTP import → individual exact-hash approval → scoped responder lookup → revoke', async () => {
  const h = await harness();
  try {
    const imported = await h.call('/references', testSample()); assert.equal(imported.status, 201);
    const { record } = await imported.json(); assert.equal(record.approvalState, 'PROPOSED');
    assert.equal((await (await h.call('/lookup', testQuery())).json()).result.candidates.length, 0);
    assert.equal((await h.call(`/references/${record.id}/approve`, { expectedHash: '0'.repeat(64) })).status, 409);
    assert.equal((await h.call(`/references/${record.id}/approve`, { expectedHash: record.contentHash, approvedBy: 'spoofed' })).status, 400);
    const accepted = await (await h.call(`/references/${record.id}/approve`, { expectedHash: record.contentHash })).json();
    assert.equal(accepted.record.approvedBy, 'fictional-reviewer');
    h.roles(['responder']); assert.equal((await h.call('/references')).status, 403);
    const response = await h.call('/lookup', testQuery()); const data = await response.json();
    assert.equal(data.traceId, response.headers.get('x-trace-id'));
    assert.equal(data.result.candidates[0].matchTier, 'MODELED_PREDICTED');
    assert.equal(data.result.candidates[0].record.document.evidenceTier, 'PRIMARY_EMPIRICAL');
    assert.equal((await h.call(`/references/${record.id}/approve`, { expectedHash: record.contentHash })).status, 403);
    h.roles(['researcher']); assert.equal((await h.call('/lookup', testQuery())).status, 403);
    assert.equal((await h.call(`/references/${record.id}/revoke`, {})).status, 200);
    assert.equal(h.service.snapshot('test').records.length, 0);
  } finally { await h.close(); }
});

test('E6: canonical graph roundtrip sorts unordered components, repeated imports retain every acquisition event', async () => {
  const h = await harness();
  try {
    const doc = testSample(); doc.components.unshift({ substance: { id: 'test-z', name: 'Fictional Z', type: 'substance' }, amount: 4, unit: 'mg', note: null });
    const first = await h.add(doc, false), second = await h.add(doc, false);
    assert.equal(first.id, second.id); assert.equal(first.contentHash, canonicalHash(validateReferenceDocument(doc)));
    assert.equal((h.db.prepare('SELECT count(*) n FROM raw_blobs').get() as any).n, 1);
    assert.equal((h.db.prepare('SELECT count(*) n FROM field_import_events').get() as any).n, 2);
    const approved = await h.add(doc); assert.equal(approved.approvalState, 'APPROVED');
    h.db.prepare('UPDATE pill_type_composition SET concentration_value=5 WHERE tested_sample_id=? AND substance_id=?').run(approved.id, 'test-z');
    assert.equal(h.repo.get(approved.id)!.approvalState, 'PROPOSED');
    assert.equal(h.service.snapshot('test').records.length, 0);
  } finally { await h.close(); }
});

test('E6: missing values, explicit target type and evidence ceilings fail closed', () => {
  assert.throws(() => validateReferenceDocument(testSample({ origin: 'visual_report' })));
  assert.throws(() => validateReferenceDocument(testSample({ origin: 'published_alert' })));
  assert.throws(() => validateReferenceDocument(testSample({ testMethod: null })));
  assert.throws(() => validateReferenceDocument(testAssertion({ predicate: 'BINDS_TO', object: { id: 'target', name: 'Target', type: 'target' } })));
  assert.throws(() => validateReferenceDocument({ ...testSample(), patientId: 'not-allowed' }));
  assert.throws(() => validateFieldQuery({ ...testQuery(), dateOfBirth: 'not-allowed' }));
  assert.throws(() => validateFieldQuery(testQuery({ from: '2026-09-09', to: '2026-09-01' })));
  assert.equal(testSample().components[0].amount, null);
});

test('E6: identical appearance retains different specimens, regions, missing composition and denominators', async () => {
  const h = await harness();
  try {
    await h.add(testSample());
    await h.add(testSample({ key: 'b', citation: { ...testSample().citation, sourceRecordId: 'b' }, components: [
      { substance: { id: 'test-b', name: 'Fictional B', type: 'substance' }, amount: 10, unit: 'mg', note: null }], unknownComponents: ['unresolved peak'] }));
    await h.add(testSample({ key: 'national', region: { id: 'NL', name: 'Netherlands', parentId: null }, origin: 'published_alert', evidenceTier: 'CURATED_SECONDARY', testMethod: null, timeBasis: 'published' }));
    await h.add(testSample({ key: 'undated', origin: 'visual_report', evidenceTier: 'UNKNOWN', observedOn: null, timeBasis: 'unknown', testMethod: null }));
    const snapshot = h.service.snapshot('test');
    const result = lookupField(snapshot, testQuery({ from: '2026-09-01', includeBroaderContext: true, color: 'zielone' }));
    assert.equal(result.candidates.length, 3); assert.equal(result.labSampleCount, 2); assert.equal(result.publishedAlertCount, 1); assert.equal(result.excludedUndated, 1);
    assert.deepEqual(result.distribution.map(d => d.labSampleCount), [1, 1]);
    assert.equal(result.candidates.at(-1)!.regionScope, 'broader_context');
    assert.equal(lookupField(snapshot, testQuery({ from: '2026-09-02' })).candidates.length, 0);
    assert.equal(lookupField(snapshot, testQuery({ scoreLine: 'absent inscription' })).candidates.length, 0);
  } finally { await h.close(); }
});

test('E6: localized market groups stay distinct from substance synonyms; ambiguous labels disclose all groups', async () => {
  const h = await harness();
  try {
    await h.add(testSample());
    await h.add(testSample({ key: 'alias', market: { label: 'another label', group: 'test-market', language: 'nl' } }));
    await h.add(testSample({ key: 'ambiguous', market: { label: 'test label', group: 'other-market', language: 'nl' } }));
    const snapshot = h.service.snapshot('test');
    assert.equal(lookupField(snapshot, testQuery({ mode: 'market', term: 'test label' })).candidates.length, 0);
    const result = lookupField(snapshot, testQuery({ mode: 'market', term: 'test label', expansionMode: 'LOCALIZED_SYNONYMS' }));
    assert.equal(result.candidates.length, 3); assert.ok(result.flags.includes('AMBIGUOUS_MARKET_LABEL'));
    assert.equal(lookupField(snapshot, testQuery({ mode: 'market', term: 'Fictional A', expansionMode: 'LOCALIZED_SYNONYMS' })).candidates.length, 0);
  } finally { await h.close(); }
});

test('E6: assertions retain contradictions, fixed category order, source validity and clinical evidence constraints', async () => {
  const h = await harness();
  try {
    await h.add(testSample()); const a = await h.add(testAssertion());
    await h.add(testAssertion({ key: 'contradiction', contradicts: [a.id], statement: { ...testAssertion().statement, text: 'Fictional contradicting source.' } }));
    await h.add(testAssertion({ key: 'unconfirmed', evidenceTier: 'RAW_OBSERVATIONAL' }));
    await h.add(testAssertion({ key: 'expired', validTo: '2025-01-01' }));
    const card = lookupField(h.service.snapshot('test'), testQuery()).candidates[0].substances[0];
    assert.deepEqual(card.sections.map(s => s.id), [...CONTENT_CATEGORIES]);
    const interactions = card.sections.find(s => s.id === 'interactions')!.facts;
    assert.equal(interactions.length, 2); assert.ok(interactions.every(f => f.contradicted));
    assert.equal(card.missingInteractions, false);
  } finally { await h.close(); }
});

test('E6: symptom search uses cited curated associations and never promotes a raw report from another category', async () => {
  const h = await harness();
  try {
    const symptom = { id: 'test-symptom', name: 'Fictional symptom', type: 'symptom' as const };
    await h.add(testAssertion({ predicate: 'ASSOCIATED_WITH_SYMPTOM', category: 'acute_toxicity', object: symptom }));
    await h.add(testAssertion({ key: 'raw', subject: { id: 'test-c', name: 'Fictional C', type: 'substance' }, predicate: 'ASSOCIATED_WITH_SYMPTOM', category: 'regional_signals', object: symptom, evidenceTier: 'RAW_OBSERVATIONAL' }));
    const result = lookupField(h.service.snapshot('test'), testQuery({ mode: 'symptoms', symptomIds: [symptom.id] }));
    assert.equal(result.symptomCandidates.length, 1); assert.equal(result.symptomCandidates[0].card.substance.id, 'test-a');
  } finally { await h.close(); }
});

test('E6: snapshots bind principal, expiry, current content hashes and source retrieval dates', async () => {
  const h = await harness();
  try {
    await h.add(testSample()); const now = new Date('2026-09-08T10:00:00Z');
    const snapshot = h.service.snapshot('test', now), hash = canonicalHash(snapshot);
    await verifySnapshot(snapshot, hash, 'test', now.getTime());
    await assert.rejects(verifySnapshot(snapshot, hash, 'other', now.getTime()));
    await assert.rejects(verifySnapshot(snapshot, hash, 'test', now.getTime() + 9 * 3_600_000));
    const tampered = structuredClone(snapshot); (tampered.records[0].document as SampleDocument).components[0].amount = 999;
    await assert.rejects(verifySnapshot(tampered, canonicalHash(tampered), 'test', now.getTime()));
    const refreshed = h.service.snapshot('test', new Date(now.getTime() + 1_000));
    assert.equal(refreshed.records[0].document.citation.retrievedAt, snapshot.records[0].document.citation.retrievedAt);
    assert.deepEqual(lookupField(snapshot, testQuery()), lookupField(refreshed, testQuery()));
  } finally { await h.close(); }
});

test('E6: offline audit upload is idempotent, rejects ID conflicts and records client claims explicitly', async () => {
  const h = await harness();
  try {
    const event = { id: randomUUID(), clientOccurredAt: new Date().toISOString(), snapshotHash: 'a'.repeat(64), query: testQuery(), resultIds: [] };
    assert.equal((await h.call('/offline-events', { events: [event] })).status, 200);
    assert.equal((await h.call('/offline-events', { events: [event] })).status, 200);
    assert.equal((await h.call('/offline-events', { events: [{ ...event, resultIds: ['changed'] }] })).status, 409);
    const rows = h.db.prepare("SELECT * FROM audit_events WHERE action='responder.lookup.offline'").all() as any[];
    assert.equal(rows.length, 1); assert.equal(JSON.parse(rows[0].metadata_json).resultsRecomputedByServer, false);
  } finally { await h.close(); }
});

test('E6: failure recorder has the public trace ID and does not log query values', async () => {
  const h = await harness(); const oldDir = tracer.getLogDir(), oldMode = tracer.getMode();
  try {
    tracer.setLogDir(path.join(h.dir, 'trace')); tracer.setMode('TRACE');
    const traceId = randomUUID();
    const response = await h.call('/lookup', { ...testQuery(), term: 'private-query-value', unknownField: true }, { 'x-trace-id': traceId });
    assert.equal(response.status, 400); assert.equal(response.headers.get('x-trace-id'), traceId);
    const tracePath = tracer.traceDir(traceId);
    const events = readFileSync(path.join(tracePath, 'events.jsonl'), 'utf8');
    assert.match(events, /STATE_AT_FAILURE/); assert.ok(!events.includes('private-query-value'));
    assert.ok(readdirSync(tracePath).includes('errors.jsonl'));
    const unsafe = await h.call('/profile', undefined, { 'x-trace-id': '../../escape' });
    assert.match(unsafe.headers.get('x-trace-id')!, /^[a-f0-9-]{36}$/);
  } finally { tracer.setLogDir(oldDir); tracer.setMode(oldMode); await h.close(); }
});

test('E6: versioned real catalog validates as source-derived proposals, with no invented specimen measurements', () => {
  for (const doc of loadFieldCatalog()) if (doc.kind === 'sample') {
    assert.equal(doc.origin, 'published_alert'); assert.equal(doc.evidenceTier, 'CURATED_SECONDARY');
    assert.equal(doc.testMethod, null); assert.ok(doc.components.every(c => c.amount === null));
  }
  const profile = loadFieldProfile();
  assert.equal(Object.keys(profile.tiers).length, 6);
  assert.ok(Object.values(profile.tiers).every(t => t.label && t.icon && t.color));
});
