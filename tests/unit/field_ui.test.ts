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
