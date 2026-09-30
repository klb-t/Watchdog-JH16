import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FieldSafety, RecordEvidence, EvidenceBadge, defaultFieldProfile } from '../../src/components/FieldEvidence';
import { testSample } from '../helpers/field';
import { canonicalHash } from '../../backend/watchdog_api/domain/canonical';
import { lookupField } from '../../shared/field_lookup';
import { readFieldCache, offlineFieldLookup, pendingFieldAudit, flushFieldAudit, fieldApi, HttpFailure } from '../../src/lib/field_client';
import { testQuery } from '../helpers/field';
import type { FieldSnapshot, ReferenceRecord } from '../../shared/field';

test('E6: trust labels and approval survive removal of every color; safety is never collapsible', () => {
  for (const tier of Object.keys(defaultFieldProfile.tiers)) {
    const html = renderToStaticMarkup(createElement(EvidenceBadge, { tier: tier as any })).replace(/style="[^"]*"/g, '');
    assert.ok(html.includes(defaultFieldProfile.tiers[tier].label)); assert.ok(html.includes(defaultFieldProfile.tiers[tier].icon));
  }
  const doc = testSample({ evidenceTier: 'MODELED_PREDICTED' });
  const html = renderToStaticMarkup(createElement(RecordEvidence, { record: { id: 'test', document: doc, contentHash: canonicalHash(doc), approvedHash: canonicalHash(doc), approvedBy: 'tester', approvedAt: new Date().toISOString(), approvalState: 'APPROVED', importedAt: new Date().toISOString(), rawSha256: 'a'.repeat(64) } }));
  assert.match(html, /Modeled/); assert.match(html, /Approved mapping/); assert.match(html, /FICTIONAL_TEST_DATA/);
  const safety = renderToStaticMarkup(createElement(FieldSafety));
  assert.match(safety, /112/); assert.match(safety, /31887558000/); assert.ok(!safety.includes('<details'));
});

test('E6: offline queue persists before results, synchronizes once, and HTTP denial erases cached access', async () => {
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), oldFetch = globalThis.fetch;
  const values = new Map<string, string>(); let blocked = false;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => { if (blocked) throw new Error('Quota exceeded'); values.set(k, v); }, removeItem: (k: string) => values.delete(k) } });
  try {
    const at = new Date().toISOString(), doc = testSample(), hash = canonicalHash(doc);
    const record: ReferenceRecord = { id: 'test', document: doc, contentHash: hash, approvedHash: hash, approvedBy: 'tester', approvedAt: at, approvalState: 'APPROVED', importedAt: at, rawSha256: hash };
    const snapshot: FieldSnapshot = { version: 'field-snapshot-1', generatedAt: at, expiresAt: new Date(Date.now()+3_600_000).toISOString(), principalId: 'tester', profile: defaultFieldProfile, records: [record] };
    localStorage.setItem('watchdog-field-snapshot-1', JSON.stringify({ snapshot, hash: canonicalHash(snapshot) }));
    const offline = await offlineFieldLookup('tester', testQuery());
    assert.deepEqual(offline.result, lookupField(snapshot, testQuery())); assert.equal(pendingFieldAudit('tester'), 1);
    blocked = true; await assert.rejects(offlineFieldLookup('tester', testQuery()), /Quota/); blocked = false;
    globalThis.fetch = async (_url, options) => new Response(JSON.stringify({ acceptedIds: JSON.parse(options!.body as string).events.map(e => e.id) }));
    await flushFieldAudit('tester'); assert.equal(pendingFieldAudit('tester'), 0);
    globalThis.fetch = async () => new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 });
    await assert.rejects(fieldApi('snapshot'), e => e instanceof HttpFailure && e.status === 403);
    await assert.rejects(readFieldCache(), /No offline/);
  } finally { globalThis.fetch = oldFetch; if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage); else delete (globalThis as any).localStorage; }
});

test('E6 evidence profiles: compact colors retain every source kind, approval and fixed category order', async () => {
  const { evidencePresentation, SubstanceReference } = await import('../../src/components/FieldEvidence');
  const fullColors = new Set<string>(), compactColors = new Set<string>();
  for (const tier of Object.keys(defaultFieldProfile.tiers)) {
    const type = tier as any;
    fullColors.add(evidencePresentation(defaultFieldProfile, type, 'full').color);
    compactColors.add(evidencePresentation(defaultFieldProfile, type, 'compact').color);
    const html = renderToStaticMarkup(createElement(EvidenceBadge, { tier: type, display: 'compact' })).replace(/style="[^"]*"/g, '');
    assert.ok(html.includes(defaultFieldProfile.tiers[type].label));
    assert.ok(html.includes(defaultFieldProfile.tiers[type].icon));
    assert.match(html, new RegExp(`data-evidence-tier="${tier}"`));
  }
  assert.equal(fullColors.size, 6); assert.equal(compactColors.size, 3);
  const doc = testSample({ evidenceTier: 'MODELED_PREDICTED' }), hash = canonicalHash(doc);
  const record: ReferenceRecord = { id: 'test', document: doc, contentHash: hash, approvedHash: hash, approvedBy: 'tester', approvedAt: new Date().toISOString(), approvalState: 'APPROVED', importedAt: new Date().toISOString(), rawSha256: hash };
  const html = renderToStaticMarkup(createElement(RecordEvidence, { record, display: 'compact' }));
  assert.match(html, /Modeled \/ inferred/); assert.match(html, /Approved mapping/);
  const snapshot: FieldSnapshot = { version: 'field-snapshot-1', generatedAt: new Date().toISOString(), expiresAt: new Date(Date.now()+3_600_000).toISOString(), principalId: 'tester', profile: defaultFieldProfile, records: [record] };
  const card = lookupField(snapshot, testQuery()).candidates[0].substances[0];
  const fullCard = renderToStaticMarkup(createElement(SubstanceReference, { card, profile: defaultFieldProfile, display: 'full' }));
  const compactCard = renderToStaticMarkup(createElement(SubstanceReference, { card, profile: defaultFieldProfile, display: 'compact' }));
  assert.deepEqual([...fullCard.matchAll(/data-category="([^"]+)"/g)].map(m => m[1]), [...compactCard.matchAll(/data-category="([^"]+)"/g)].map(m => m[1]));
  assert.equal(record.document.evidenceTier, 'MODELED_PREDICTED');
});

test('E6 global context rendering: additional sample provenance and local/archive denominators remain distinct', async () => {
  const { FieldLookupResults } = await import('../../src/components/FieldResults');
  const local = testSample(), foreign = testSample({ key: 'other', name: 'Fictional Other Green X', region: { id: 'TEST-OTHER', name: 'Fictional other region', parentId: null }, citation: { ...local.citation, sourceRecordId: 'other' } });
  const at = new Date().toISOString();
  const records: ReferenceRecord[] = [local, foreign].map(document => { const hash = canonicalHash(document); return { id: document.key, document, contentHash: hash, approvedHash: hash, approvedBy: 'tester', approvedAt: at, approvalState: 'APPROVED', importedAt: at, rawSha256: hash }; });
  const profile = { ...defaultFieldProfile, regions: [...defaultFieldProfile.regions, foreign.region] };
  const snapshot: FieldSnapshot = { version: 'field-snapshot-1', generatedAt: at, expiresAt: new Date(Date.now()+3_600_000).toISOString(), principalId: 'tester', profile, records };
  const result = lookupField(snapshot, testQuery());
  const html = renderToStaticMarkup(createElement(FieldLookupResults, { result, profile, display: 'full', linkedReferenceId: foreign.key }));
  assert.match(html, /Local denominator: 1/); assert.match(html, /Archive denominator: 2/);
  assert.match(html, /Fictional Other Green X/); assert.match(html, /Other region — not local sample evidence/);
  assert.match(html, /Fictional software fixture/); assert.match(html, /data-linked-reference="true"/);
  assert.match(html, /does not estimate worldwide occurrence/);
});

test('E6 search deep links prefill a supported query without treating reference IDs as descriptors', async () => {
  const { responderQueryFromSearch } = await import('../../src/pages/Responder');
  const query = responderQueryFromSearch(new URLSearchParams('mode=market&term=test+label&reference=field-123'));
  assert.equal(query.mode, 'market'); assert.equal(query.term, 'test label'); assert.equal(query.regionId, 'NL');
  assert.equal(responderQueryFromSearch(new URLSearchParams('mode=unsupported&term=X')).mode, 'pill');
  assert.equal(responderQueryFromSearch(new URLSearchParams({ term: 'x'.repeat(200) })).term.length, 100);
});

test('E6 exact search reference inspection: approved assertion links expose citations while clinical exclusions remain intact', async () => {
  const { FieldLinkedReference } = await import('../../src/components/FieldLinkedReference');
  const { testAssertion } = await import('../helpers/field');
  const at = new Date().toISOString(), snapshot = { generatedAt: at, expiresAt: new Date(Date.now()+3_600_000).toISOString() };
  const envelope = (document: any): ReferenceRecord => { const hash = canonicalHash(document); return { id: 'exact-assertion', document, contentHash: hash, approvedHash: hash, approvedBy: 'tester', approvedAt: at, approvalState: 'APPROVED', importedAt: at, rawSha256: hash }; };
  const html = renderToStaticMarkup(createElement(FieldLinkedReference, { record: envelope(testAssertion()), snapshot, profile: defaultFieldProfile, display: 'full' }));
  assert.match(html, /Fictional A → Fictional B/); assert.match(html, /Fictional interaction used only to verify software behavior/);
  assert.match(html, /Fictional software fixture/); assert.match(html, /exact-assertion/);
  const withheld = renderToStaticMarkup(createElement(FieldLinkedReference, { record: envelope(testAssertion({ evidenceTier: 'MODELED_PREDICTED' })), snapshot, profile: defaultFieldProfile, display: 'compact' }));
  assert.ok(!withheld.includes('Fictional interaction used only to verify software behavior'));
  assert.match(withheld, /does not display modeled, raw or speculative clinical statements/);
  assert.match(withheld, /Modeled \/ inferred/); assert.match(withheld, /Approved mapping/);
});

test('E6 exact offline inspection: expiry, principal and persisted receipt gate every newly exposed mapping', async () => {
  const { offlineFieldReference } = await import('../../src/lib/field_client');
  const { fieldSnapshotWindowIsCurrent } = await import('../../shared/field_snapshot');
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map<string, string>(); let blocked = false;
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => { if (blocked) throw new Error('Quota exceeded'); values.set(k, v); }, removeItem: (k: string) => values.delete(k) } });
  try {
    const now = Date.now(), at = new Date(now).toISOString(), doc = testSample(), hash = canonicalHash(doc);
    const record: ReferenceRecord = { id: 'exact-test', document: doc, contentHash: hash, approvedHash: hash, approvedBy: 'tester', approvedAt: at, approvalState: 'APPROVED', importedAt: at, rawSha256: hash };
    const snapshot: FieldSnapshot = { version: 'field-snapshot-1', generatedAt: at, expiresAt: new Date(now+3_600_000).toISOString(), principalId: 'tester', profile: defaultFieldProfile, records: [record] };
    assert.equal(fieldSnapshotWindowIsCurrent(snapshot, 'tester', now), true);
    assert.equal(fieldSnapshotWindowIsCurrent(snapshot, 'another-account', now), false);
    assert.equal(fieldSnapshotWindowIsCurrent(snapshot, 'tester', now+3_600_000), false);
    localStorage.setItem('watchdog-field-snapshot-1', JSON.stringify({ snapshot, hash: canonicalHash(snapshot) }));
    blocked = true; await assert.rejects(offlineFieldReference('tester', record.id), /Quota/); blocked = false;
    assert.equal(pendingFieldAudit('tester'), 0);
    const inspection = await offlineFieldReference('tester', record.id);
    assert.equal(inspection.record.id, record.id); assert.equal(pendingFieldAudit('tester'), 1);
    const receipt = JSON.parse(values.get('watchdog-field-audit-1')!).events[0];
    assert.equal(receipt.kind, 'reference_inspection'); assert.equal(receipt.query, undefined); assert.deepEqual(receipt.resultIds, [record.id]);
    await assert.rejects(offlineFieldReference('another-account', record.id), /identity/);
    await assert.rejects(offlineFieldReference('tester', 'not-present'), /not present/);
    const expired = { ...snapshot, generatedAt: new Date(now-7_200_000).toISOString(), expiresAt: new Date(now-1).toISOString() };
    localStorage.setItem('watchdog-field-snapshot-1', JSON.stringify({ snapshot: expired, hash: canonicalHash(expired) }));
    await assert.rejects(offlineFieldReference('tester', record.id), /expired/);
    assert.equal(pendingFieldAudit('tester'), 1);
  } finally { if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage); else delete (globalThis as any).localStorage; }
});

test('E6 global audit synchronization: bounded requests retain complete IDs and unacknowledged receipts after failure', async () => {
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), oldFetch = globalThis.fetch;
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => values.set(k, v), removeItem: (k: string) => values.delete(k) } });
  try {
    const events = Array.from({ length: 6 }, (_, i) => ({ id: `event-${i}`, clientOccurredAt: new Date().toISOString(), snapshotHash: 'a'.repeat(64),
      query: testQuery(), resultIds: Array.from({ length: 3000 }, (_, j) => `field-${String(j).padStart(64, '0')}`) }));
    values.set('watchdog-field-audit-1', JSON.stringify({ principalId: 'tester', events }));
    let requests = 0; const transmitted = new Set<string>();
    globalThis.fetch = async (_url, options) => {
      const body = options!.body as string;
      assert.ok(new TextEncoder().encode(body).length <= 1_000_000);
      const batch = JSON.parse(body).events;
      assert.ok(batch.every((e: any) => e.resultIds.length === 3000));
      requests++;
      if (requests === 2) return new Response(JSON.stringify({ error: 'Temporary failure' }), { status: 500 });
      batch.forEach((e: any) => transmitted.add(e.id));
      return new Response(JSON.stringify({ acceptedIds: batch.map((e: any) => e.id) }));
    };
    await assert.rejects(flushFieldAudit('tester'), e => e instanceof HttpFailure && e.status === 500);
    assert.ok(pendingFieldAudit('tester') > 0); assert.ok(pendingFieldAudit('tester') < events.length);
    await flushFieldAudit('tester');
    assert.equal(pendingFieldAudit('tester'), 0); assert.equal(transmitted.size, events.length);
  } finally { globalThis.fetch = oldFetch; if (oldStorage) Object.defineProperty(globalThis, 'localStorage', oldStorage); else delete (globalThis as any).localStorage; }
});
