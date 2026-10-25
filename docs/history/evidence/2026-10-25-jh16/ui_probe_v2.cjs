// Owner-path probe for the fixed build: Study page (historical counts) and
// the wizard with the chosen baseline, saving every run's stored outputs.
const { chromium } = require(process.env.PW_PATH);
const fs = require('fs'); const path = require('path');
const BASE = process.argv[2], OUT = process.argv[3], BASELINE = process.env.BASELINE || 'fixture';
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch(); const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await ctx.newPage(); const log = [];
  page.on('pageerror', e => log.push('pageerror: ' + e.message));
  const api = async (p) => page.evaluate(async (u) => (await fetch(u)).json(), p);
  const text = async (p) => page.evaluate(async (u) => (await fetch(u)).text(), p);
  const wait = async (id) => { for (let i = 0; i < 900; i++) { const r = await api('/api/runs/' + id); if (['COMPLETED', 'FAILED'].includes(r.run.status)) return r.run; await page.waitForTimeout(1000); } throw new Error('timeout ' + id); };
  const save = async (tag, id) => {
    const run = await wait(id); log.push(`${tag} ${id} ${run.status} commit=${run.git_commit} ${run.error_code ?? ''}`);
    for (const [n, u] of [['run', ''], ['results', '/results'], ['evaluation', '/evaluation'], ['manifest', '/manifest'], ['fetch_events', '/fetch-events']])
      fs.writeFileSync(path.join(OUT, `${tag}_${n}.json`), JSON.stringify(await api('/api/runs/' + id + u), null, 2));
    fs.writeFileSync(path.join(OUT, `${tag}_export.csv`), await text(`/api/runs/${id}/export?format=csv`));
    fs.writeFileSync(path.join(OUT, `${tag}_export.json`), await text(`/api/runs/${id}/export?format=json`));
    await page.goto(`${BASE}/runs/${id}/results`); await page.waitForSelector('[data-testid=jh16-evaluation]', { timeout: 20000 }).catch(() => log.push(tag + ': no evaluation panel'));
    await page.waitForTimeout(800); await page.screenshot({ path: path.join(OUT, `${tag}_results.png`), fullPage: true });
  };
  if (!process.env.SKIP_STUDY) {
    await page.goto(BASE + '/study'); await page.waitForSelector('[data-testid=source-list] label');
    log.push('serp_generic available: ' + await page.locator('[data-testid=source-serp_generic]').getAttribute('data-available'));
    await page.screenshot({ path: path.join(OUT, 'study.png'), fullPage: true });
    await page.locator('[data-testid=source-fixture_jh2016] input').check(); await page.click('[data-testid=start-run]'); await page.waitForURL(/\/runs\//);
    await save('study_fixture', page.url().split('/runs/')[1].split('/')[0]);
  }
  await page.goto(BASE + '/setup'); await page.waitForSelector('[data-testid=configuration-wizard]');
  if (process.env.RAISE_LIMIT) { await page.getByLabel('Tryb interfejsu').selectOption('standard');
    await page.getByLabel('Dzienny limit zapytań SerpApi').fill(process.env.RAISE_LIMIT); await page.click('[data-testid=settings-save]');
    await page.getByRole('status').filter({ hasText: 'Ustawienia zapisane.' }).waitFor(); log.push('daily SERP limit set to ' + process.env.RAISE_LIMIT); }
  await page.getByRole('button', { name: '2 · Zakres badań' }).click();
  await page.locator('select').filter({ has: page.locator('option[value=live_serp]') }).selectOption(BASELINE);
  for (const label of ['Przejrzyj arXiv i Europe PMC', 'Zasil kartoteki']) { const c = page.getByLabel(new RegExp(label)); if (await c.count() && await c.isChecked()) await c.uncheck(); }
  await page.click('[data-testid=prepare-research-plan]'); await page.waitForSelector('[data-testid=approve-wizard-method]');
  await page.screenshot({ path: path.join(OUT, 'wizard_plan.png'), fullPage: true });
  log.push('budget notice: ' + await page.locator('[data-testid=serp-budget]').innerText().catch(() => 'none'));
  await page.check('[data-testid=approve-wizard-method]'); await page.click('[data-testid=launch-research-plan]');
  if (process.env.EXPECT_REFUSAL) { await page.waitForTimeout(4000); await page.screenshot({ path: path.join(OUT, 'wizard_after_launch.png'), fullPage: true }); log.push('body: ' + (await page.locator('[data-testid=configuration-wizard]').innerText()).slice(0, 600)); log.push('refused: ' + JSON.stringify(await page.locator('[role=alert]').allInnerTexts()));
    await page.screenshot({ path: path.join(OUT, 'wizard_refusal.png'), fullPage: true }); fs.writeFileSync(path.join(OUT, 'probe_log.txt'), log.join('\n') + '\n'); await browser.close(); return; }
  await page.getByRole('link', { name: 'Wyniki JH16' }).waitFor({ timeout: 30000 });
  const plans = (await api('/api/settings/plans')).plans; const plan = plans.filter(p => p.launch?.runId).sort((a, b) => b.launch.launchedAt.localeCompare(a.launch.launchedAt))[0];
  fs.writeFileSync(path.join(OUT, 'plan.json'), JSON.stringify(plan, null, 2));
  await save('wizard_faithful', plan.launch.runId);
  for (const [i, id] of (plan.launch.extensionRunIds ?? []).entries()) await save(`wizard_ext${i + 1}`, id);
  await page.goto(`${BASE}/runs/${plan.launch.runId}/results`); await page.waitForSelector('[data-testid=plan-runs]', { timeout: 20000 }).catch(() => log.push('no plan-runs table'));
  await page.screenshot({ path: path.join(OUT, 'wizard_faithful_results_final.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 }); await page.reload(); await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, 'wizard_faithful_results_mobile.png'), fullPage: true });
  const layout = await page.locator('main').evaluate(el => ({ clientWidth: el.clientWidth, scrollWidth: el.scrollWidth })).catch(() => null);
  log.push('mobile layout ' + JSON.stringify(layout));
  fs.writeFileSync(path.join(OUT, 'probe_log.txt'), log.join('\n') + '\n'); await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
