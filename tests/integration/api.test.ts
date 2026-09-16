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

// ---------------------------------------------------------------------------
// D17 flow: readiness, and refusing to pretend an unconfigured provider works.
// ---------------------------------------------------------------------------

test('Readiness reports every provider with the one thing that would fix it', async () => {
  const res = await fetch(`${baseUrl}/api/providers/readiness`);
  assert.strictEqual(res.status, 200);
  const data: any = await res.json();

  const text = data.capabilities['text.generate'];
  const search = data.capabilities['search.result_count'];
  assert.ok(Array.isArray(text) && text.length > 0);
  assert.ok(Array.isArray(search) && search.length > 0);

  const openrouter = text.find((p: any) => p.provider_key === 'openrouter');
  assert.ok(openrouter, 'OpenRouter must be listed');
  // No key is set in the test environment, so this is the honest state.
  assert.strictEqual(openrouter.status, 'blocked');
  assert.match(openrouter.remediation, /OPENROUTER_API_KEY/,
    'a settings page that says only "unavailable" leaves four different actions indistinguishable');

  const serpapi = search.find((p: any) => p.provider_key === 'serpapi');
  assert.strictEqual(serpapi.status, 'blocked');
  assert.match(serpapi.remediation, /SERPAPI_API_KEY/);

  assert.strictEqual(data.ready.text_generate, false);
  assert.strictEqual(data.ready.live_acquisition, false);

  // The offline slice keeps working regardless of any of this.
  const fixture = data.sources.find((s: any) => s.source_id === 'fixture_jh2016');
  assert.strictEqual(fixture.status, 'fixture');
});

test('The live SERP source is blocked rather than planned, and says why', async () => {
  const res = await fetch(`${baseUrl}/api/providers/readiness`);
  const data: any = await res.json();
  const serp = data.sources.find((s: any) => s.source_id === 'serp_result_count');

  assert.ok(serp, 'the live source must be registered even with no credential');
  assert.strictEqual(serp.status, 'blocked',
    "'planned' would say there is no adapter; 'blocked' says one environment variable is missing");
  assert.match(serp.remediation, /SERPAPI_API_KEY/);
});

test('Generating a narrative with an unconfigured provider is a 409, not a 500', async () => {
  const res = await fetch(`${baseUrl}/api/runs/any-run-id/narrative/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'openrouter' }),
  });

  // 404 for the unknown run, or 409 for the unconfigured provider — never 500,
  // and never a narrative invented by an error handler.
  assert.ok([404, 409].includes(res.status), `expected 404 or 409, got ${res.status}`);
  const body: any = await res.json();
  assert.ok(!JSON.stringify(body).includes('Methodological reproduction'),
    'a provider failure must not quietly return template prose');
});

test('A run against the live source fails closed when no credential is configured', async () => {
  const submit = await fetch(`${baseUrl}/api/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'ACQUISITION',
      config: {
        source_id: 'serp_result_count', method_id: 'jh16_faithful',
        language: 'en', query_expansion_mode: 'STRICT_CANONICAL',
        entities: ['alcohol'], query_templates: { popularity: '"{entity}"' },
      },
    }),
  });
  assert.strictEqual(submit.status, 202, 'the run is accepted; it fails at acquisition, with a record');
  const { run_id } = await submit.json();

  let run: any;
  for (let i = 0; i < 40; i++) {
    run = (await (await fetch(`${baseUrl}/api/runs/${run_id}`)).json()).run;
    if (['COMPLETED', 'FAILED'].includes(run.status)) break;
    await new Promise(r => setTimeout(r, 100));
  }

  assert.strictEqual(run.status, 'FAILED', 'an uncredentialled live run must not report success');
  assert.match(JSON.stringify(run), /SERPAPI_API_KEY/,
    'and the failure must name the variable that would fix it');
});
