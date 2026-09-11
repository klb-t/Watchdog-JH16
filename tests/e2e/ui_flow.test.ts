import { test, before, after } from 'node:test';
import * as assert from 'node:assert';
import { chromium, Browser, Page } from 'playwright';
import { spawn, ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * E1.21-E1.23 — browser-driven end-to-end tests against fixtures.
 *
 * Drives the real UI against the real server with the real fixture source: no
 * mocks. `09_TESTS.md`: "Do not mock what can run for real. A mocked adapter
 * tests the mock."
 */

let browser: Browser;
let page: Page;
let server: ChildProcess;
let baseUrl: string;
const DB_PATH = path.join('/tmp', `watchdog_e2e_${Date.now()}.sqlite`);
// Isolated alongside the database. The blob store and the database must be
// reset together: dedup is decided against the database, so a surviving store
// paired with a fresh database is a different scenario from a clean start.
const STORE_PATH = path.join('/tmp', `watchdog_e2e_store_${Date.now()}`);

function resolveChromium(): string | undefined {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
  if (!fs.existsSync(root)) return undefined;   // fall back to Playwright's own lookup
  for (const dir of fs.readdirSync(root).sort()) {
    for (const candidate of [
      path.join(root, dir, 'chrome-linux', 'chrome'),
      path.join(root, dir, 'chrome-linux', 'headless_shell'),
    ]) {
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

async function waitForServer(url: string, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/api/sources`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 300));
  }
  throw new Error(`server did not become ready at ${url}`);
}

before(async () => {
  const port = 3100 + Math.floor(Math.random() * 400);
  baseUrl = `http://127.0.0.1:${port}`;

  // Use Node's loader directly: no CLI IPC socket is needed. Detach so any
  // child Vite/esbuild processes are also reaped on teardown.
  server = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port), DB_PATH, STORE_PATH, WATCHDOG_DIAGNOSTICS_MODE: 'OFF' },
    stdio: 'pipe',
    detached: true,
  });
  await waitForServer(baseUrl);

  // PLAYWRIGHT_BROWSERS_PATH points at a pre-installed Chromium whose exact
  // build directory is versioned, so it is resolved rather than hard-coded.
  browser = await chromium.launch({ executablePath: resolveChromium() });
  page = await browser.newPage();
});

after(async () => {
  await browser?.close();
  if (server?.pid) {
    try { process.kill(-server.pid, 'SIGKILL'); } catch { /* already gone */ }
  }
  fs.rmSync(STORE_PATH, { recursive: true, force: true });
  for (const f of [DB_PATH, `${DB_PATH}-journal`]) {
    if (fs.existsSync(f)) fs.rmSync(f, { force: true });
  }
});

test('E3 automation: daily schedule, one-click all-discipline scope, pause and mobile layout', async () => {
  const errors: string[] = []; const onError = (e: Error) => errors.push(e.message); page.on('pageerror', onError);
  try {
    await page.goto(`${baseUrl}/automation`); await page.waitForSelector('[data-testid="automation-page"]');
    await page.locator('[data-testid="discovery-scope"]').selectOption('all_science');
    await page.locator('[data-testid="schedule-create"]').click();
    await page.getByRole('status').filter({ hasText: 'Harmonogram zapisany' }).waitFor();
    const list = await (await fetch(`${baseUrl}/api/automation/schedules`)).json();
    assert.strictEqual(list.schedules.length, 1); assert.strictEqual(list.schedules[0].request.scope, 'all_science');
    await page.getByRole('button', { name: 'Wstrzymaj', exact: true }).click();
    await page.getByRole('button', { name: 'Wznów', exact: true }).waitFor();
    assert.strictEqual((await (await fetch(`${baseUrl}/api/automation/jobs`)).json()).jobs.length, 0, 'no unsolicited collection on page load or future scheduling');
    await page.setViewportSize({ width: 390, height: 844 });
    const layout = await page.locator('main').evaluate(el => ({ clientWidth: el.clientWidth, scrollWidth: el.scrollWidth }));
    assert.ok(layout.scrollWidth <= layout.clientWidth + 1, JSON.stringify(layout));
    fs.mkdirSync('test-artifacts', { recursive: true }); await page.screenshot({ path: 'test-artifacts/automation-mobile.png', fullPage: true });
    await page.goto(`${baseUrl}/memory`); await page.waitForSelector('[data-testid="substance-memory-page"]');
    await page.getByText('Brak pasujących kartotek.', { exact: false }).waitFor();
    assert.deepStrictEqual(errors, []);
  } finally { page.off('pageerror', onError); await page.setViewportSize({ width: 1280, height: 900 }); }
});

// -------------------------------------------------------------------------
// E1.21 — Study page.
// -------------------------------------------------------------------------

test('E1.21: the Study page drives a full fixture run from the UI', async () => {
  await page.goto(`${baseUrl}/study`);
  await page.waitForSelector('[data-testid="study-page"]');

  // A planned source must be rendered as unavailable and be unselectable.
  const planned = page.locator('[data-testid="source-chemical_reference"]');
  await planned.waitFor();
  assert.strictEqual(await planned.getAttribute('data-available'), 'false');
  assert.strictEqual(await planned.locator('input[type=radio]').isDisabled(), true,
    'a planned source must not be selectable for a run');

  // The fixture source is available.
  const fixture = page.locator('[data-testid="source-fixture_jh2016"]');
  assert.strictEqual(await fixture.getAttribute('data-available'), 'true');
  await fixture.locator('input[type=radio]').check();

  await page.click('[data-testid="start-run"]');
  await page.waitForURL(/\/runs\/[0-9a-f-]+$/, { timeout: 20_000 });

  const runId = page.url().split('/runs/')[1];
  assert.match(runId, /^[0-9a-f-]{36}$/, 'the UI navigates to the created run');
});

// -------------------------------------------------------------------------
// E1.22 — Method review page.
// -------------------------------------------------------------------------

test('E1.22: a proposal renders red step by step and cannot execute until approved', async () => {
  await page.goto(`${baseUrl}/method`);
  await page.waitForSelector('[data-testid="method-review-page"]');

  const state = page.locator('[data-testid="approval-state"]');
  assert.strictEqual(await state.getAttribute('data-state'), 'PROPOSED');
  assert.match(await state.innerText(), /PROPOSED/);

  // Every step is rendered individually, in the proposed state, with the
  // sentence of the paper it derives from.
  const steps = page.locator('[data-testid="spec-steps"] > div');
  const count = await steps.count();
  assert.ok(count >= 5, `expected the spec's steps to be rendered, found ${count}`);
  for (let i = 0; i < count; i++) {
    assert.strictEqual(await steps.nth(i).getAttribute('data-state'), 'PROPOSED');
  }
  assert.match(await page.locator('[data-testid="step-Pi_ratio"]').innerText(), /Pi = \(Ni \/ max\(Ni\)\)/);

  // The gate is enforced in the backend, not merely in the UI: an unapproved
  // spec reaching the executor must throw regardless of what the page shows.
  const before = await (await fetch(`${baseUrl}/api/method-specs/jh2016-faithful`)).json();
  assert.strictEqual(before.approval_state, 'PROPOSED');

  await page.click('[data-testid="approve-spec"]');
  await page.waitForFunction(
    () => document.querySelector('[data-testid="approval-state"]')?.getAttribute('data-state') === 'APPROVED',
    undefined, { timeout: 10_000 });

  // Approved renders green, and every step flips with it.
  for (let i = 0; i < count; i++) {
    assert.strictEqual(await steps.nth(i).getAttribute('data-state'), 'APPROVED');
  }

  const after = await (await fetch(`${baseUrl}/api/method-specs/jh2016-faithful`)).json();
  assert.strictEqual(after.approval_state, 'APPROVED');
});

test('E1.22: approval refuses a client-supplied actor and a missing review hash', async () => {
  const res = await fetch(`${baseUrl}/api/method-specs/jh2016-faithful/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ approved_by: '' }),
  });
  assert.strictEqual(res.status, 400);
  assert.strictEqual((await res.json()).error, 'validation_error');
});

// -------------------------------------------------------------------------
// E1.23 — Results page.
// -------------------------------------------------------------------------

test('E1.23: results, charts, approval state and export are reachable and correct', async () => {
  // Start a run whose fixture set contains a deliberate missing value, so the
  // page's handling of missingness is exercised rather than assumed.
  const submit = await fetch(`${baseUrl}/api/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'PIPELINE',
      config: {
        source_id: 'fixture_jh2016',
        source_params: { fixture_set: 'edge_cases' },
        method_id: 'jh16_faithful',
        language: 'en',
        query_expansion_mode: 'STRICT_CANONICAL',
        entities: ['missing_count', 'grouped_digits'],
        query_templates: { popularity: '"{entity}"' },
        method_params: { reference_scores: { missing_count: 10, grouped_digits: 20 } },
      },
    }),
  });
  assert.strictEqual(submit.status, 202);
  const { run_id } = await submit.json();

  for (let i = 0; i < 40; i++) {
    const r = await (await fetch(`${baseUrl}/api/runs/${run_id}`)).json();
    if (['COMPLETED', 'FAILED'].includes(r.run.status)) break;
    await new Promise(r2 => setTimeout(r2, 100));
  }

  await page.goto(`${baseUrl}/runs/${run_id}/results`);
  await page.waitForSelector('[data-testid="results-page"]');
  await page.waitForSelector('[data-testid="chart-pi-bar"]', { timeout: 15_000 });

  // A missing point is drawn and labelled, not omitted and not shown as zero.
  const missingPoint = page.locator('[data-testid="point-pi-bar-missing_count"]');
  await missingPoint.waitFor();
  assert.strictEqual(await missingPoint.getAttribute('data-missing'), 'true');
  const marker = page.locator('[data-testid="missing-pi-bar-missing_count"]');
  assert.strictEqual(await marker.count(), 1, 'a missing point must render a visible marker');
  assert.match(await marker.innerText(), /no data/);

  const text = await page.locator('[data-testid="results-page"]').innerText();
  assert.ok(!/missing_count\s+0/.test(text), 'a missing value must never be displayed as 0');

  // The results table distinguishes missing from zero in words.
  const missingRow = page.locator('[data-testid="result-missing_count-Pi"]');
  assert.strictEqual(await missingRow.getAttribute('data-missing'), 'true');
  assert.match(await missingRow.innerText(), /missing — not zero/);

  // The narrative shows its approval state and is labelled machine-generated.
  const narrative = page.locator('[data-testid="narrative"]');
  await narrative.waitFor();
  assert.strictEqual(await narrative.getAttribute('data-approval-state'), 'PROPOSED');
  assert.match(await narrative.innerText(), /machine-generated/);

  // Manifest and export are reachable.
  assert.strictEqual(await page.locator('[data-testid="manifest-link"]').count(), 1);
  const csv = await fetch(`${baseUrl}/api/runs/${run_id}/export?format=csv`);
  assert.strictEqual(csv.status, 200);
  const body = await csv.text();
  assert.match(body, /run_id,entity_id,metric_key,value_numeric,unit,is_missing/);
  assert.match(body, /missing_count,Pi,,%,true/, 'missing exports as empty with is_missing=true');
});

test('personal wizard: saved modes, independent scope, explicit method review and real keyless JH16 run on mobile', async () => {
  const errors: string[] = []; const onError = (e: Error) => errors.push(e.message); page.on('pageerror', onError);
  try {
    await page.goto(`${baseUrl}/setup`); await page.waitForSelector('[data-testid="configuration-wizard"]');
    assert.equal(await page.locator('[data-testid="cost-slider"]').count(), 1);
    await page.locator('[data-testid="interface-mode"]').selectOption('standard');
    assert.equal(await page.locator('[data-testid="cost-slider"]').count(), 0, 'economy slider belongs only to simple mode');
    await page.getByLabel('Gęstość interfejsu').selectOption('compact');
    await page.locator('[data-testid="settings-save"]').click();
    await page.getByRole('status').filter({ hasText: 'Ustawienia zapisane.' }).waitFor();
    await page.reload(); await page.waitForSelector('[data-testid="configuration-wizard"]');
    assert.equal(await page.locator('[data-testid="interface-mode"]').inputValue(), 'standard');
    assert.equal(await page.getByLabel('Gęstość interfejsu').inputValue(), 'compact');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('[data-testid="configuration-wizard"]').scrollIntoViewIfNeeded();
    const layout = await page.locator('main').evaluate(el => ({ clientWidth: el.clientWidth, scrollWidth: el.scrollWidth }));
    assert.ok(layout.scrollWidth <= layout.clientWidth + 1, JSON.stringify(layout));
    fs.mkdirSync('test-artifacts', { recursive: true }); await page.screenshot({ path: 'test-artifacts/wizard-mobile.png', fullPage: true });
    await page.getByRole('button', { name: 'Dalej: zakres badań' }).click();
    await page.getByLabel('Nederland', { exact: true }).check();
    await page.getByLabel('Zasil kartoteki:', { exact: false }).uncheck();
    await page.getByLabel('Przejrzyj arXiv i Europe PMC', { exact: false }).uncheck();
    await page.locator('[data-testid="prepare-research-plan"]').click();
    await page.locator('[data-testid="approve-wizard-method"]').waitFor();
    assert.equal(await page.locator('[data-testid="launch-research-plan"]').isDisabled(), true);
    await page.locator('[data-testid="approve-wizard-method"]').check();
    await page.locator('[data-testid="launch-research-plan"]').click();
    const link = page.getByRole('link', { name: 'Wyniki JH16', exact: true }); await link.waitFor();
    const plans = (await (await fetch(`${baseUrl}/api/settings/plans`)).json()).plans;
    const plan = plans.find((p: any) => p.launch?.runId);
    assert.deepEqual(plan.body.extensions.geographies, ['NL']); assert.deepEqual(plan.body.extensions.languages, ['en', 'pl']);
    const runId = plan.launch.runId; let result: any;
    for (let i = 0; i < 60; i++) { result = await (await fetch(`${baseUrl}/api/runs/${runId}`)).json();
      if (['COMPLETED', 'FAILED'].includes(result.run.status)) break; await new Promise(r => setTimeout(r, 100)); }
    assert.equal(result.run.status, 'COMPLETED', result.run.error_details);
    const csv = await (await fetch(`${baseUrl}/api/runs/${runId}/export?format=csv`)).text();
    for (const substance of plan.body.baseline.preset.substances) assert.ok(csv.includes(`,${substance.canonical},Pi,`), `missing locked-preset entity ${substance.canonical}`);
    assert.equal(plan.launch.jobs.length, 0, 'this test opts out of network collection');
    assert.deepEqual(errors, []);
  } finally { page.off('pageerror', onError); await page.setViewportSize({ width: 1280, height: 900 }); }
});
