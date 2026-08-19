import { test, before, after } from 'node:test';
import * as assert from 'node:assert';
import { app, configureApp } from '../../server';
import { tracer } from '../../backend/watchdog_api/utils/tracer';

let server: any;
let baseUrl: string;

before(async () => {
  tracer.setMode('OFF'); // keep logs clean during test
  // The same wiring the real server uses. With no GOOGLE_OAUTH_CLIENT_ID set
  // this is local mode, so requests carry the `local-user` principal and the
  // capability gates pass — the E1 behaviour these tests were written against.
  await configureApp();
  return new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      resolve(null);
    });
  });
});

after(() => {
  if (server) {
    server.close();
  }
});

test('API GET /api/sources - Lists sources', async () => {
  const res = await fetch(`${baseUrl}/api/sources`);
  assert.strictEqual(res.status, 200);
  const data: any = await res.json();
  assert.ok(data.sources);
  const offlineFixture = data.sources.find((s: any) => s.source_id === 'offline_fixture');
  assert.ok(offlineFixture);
  assert.strictEqual(offlineFixture.status, 'fixture');
});

test('API GET /api/analyzers - Lists analyzers', async () => {
  const res = await fetch(`${baseUrl}/api/analyzers`);
  assert.strictEqual(res.status, 200);
  const data: any = await res.json();
  assert.ok(data.analyzers);
  assert.ok(Array.isArray(data.analyzers));
  const jh16 = data.analyzers.find((a: any) => a.analyzer_id === 'jh16_faithful');
  assert.ok(jh16);
});

test('API POST /api/runs - Schema Validation Failure', async () => {
  const res = await fetch(`${baseUrl}/api/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'INVALID_TYPE' })
  });
  
  assert.strictEqual(res.status, 400);
  const data: any = await res.json();
  assert.strictEqual(data.error, 'VALIDATION_ERROR');
});

test('API POST /api/runs - Submits PIPELINE job and retrieves results', async () => {
  const reqBody = {
    type: 'PIPELINE',
    config: {
      source_id: 'offline_fixture',
      source_params: { fixture_name: 'test_api' },
      method_id: 'jh16_faithful',
      language: 'en',
      query_expansion_mode: 'STRICT_CANONICAL',
      method_params: {
        reference_scores: { alcohol: 72 }
      }
    }
  };

  const submitRes = await fetch(`${baseUrl}/api/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(reqBody)
  });
  
  assert.strictEqual(submitRes.status, 202);
  const submitData: any = await submitRes.json();
  assert.ok(submitData.run_id);
  const runId = submitData.run_id;

  // Since runs execute asynchronously, we need to poll until COMPLETED
  let runStatus = 'QUEUED';
  for (let i = 0; i < 20; i++) {
    const statusRes = await fetch(`${baseUrl}/api/runs/${runId}`);
    const statusData: any = await statusRes.json();
    runStatus = statusData.run.status;
    if (runStatus === 'COMPLETED' || runStatus === 'FAILED') break;
    await new Promise(r => setTimeout(r, 50)); // wait 50ms
  }
  
  assert.strictEqual(runStatus, 'COMPLETED');

  // Fetch results
  const resultsRes = await fetch(`${baseUrl}/api/runs/${runId}/results`);
  assert.strictEqual(resultsRes.status, 200);
  const resultsData: any = await resultsRes.json();
  
  assert.ok(resultsData.observations.length > 0);
  assert.ok(resultsData.analysis_results.length > 0);
  
  const piAlc = resultsData.analysis_results.find((r: any) => r.entityId === 'alcohol' && r.metricKey === 'Pi');
  assert.strictEqual(piAlc.valueNumeric, 100);

  // Fetch events
  const fetchEventsRes = await fetch(`${baseUrl}/api/runs/${runId}/fetch-events`);
  assert.strictEqual(fetchEventsRes.status, 200);
  const fetchEventsData: any = await fetchEventsRes.json();
  assert.ok(fetchEventsData.events.length > 0);

  // Raw artifact
  const rawBlobId = fetchEventsData.events[0].raw_blob_id;
  if (rawBlobId) {
    const artifactRes = await fetch(`${baseUrl}/api/artifacts/${rawBlobId}`);
    assert.strictEqual(artifactRes.status, 200);
    const artifactData = await artifactRes.text();
    assert.ok(artifactData.length > 0);
  }
});
