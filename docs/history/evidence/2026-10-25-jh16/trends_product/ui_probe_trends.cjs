// Owner path for the Trends calibration: wizard -> plan -> launch -> results/export.
const { chromium } = require(process.env.PW_PATH);
const fs = require('fs'); const path = require('path');
const BASE = process.argv[2], OUT = process.argv[3], REGIONS = (process.env.REGIONS || 'WORLD,US,GB,PL').split(',');
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch(); const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage(); const log = [];
  page.on('pageerror', e => log.push('pageerror: ' + e.message));
  const api = async (p) => page.evaluate(async (u) => (await fetch(u)).json(), p), text = async (p) => page.evaluate(async (u) => (await fetch(u)).text(), p);
  await page.goto(BASE + '/setup'); await page.waitForSelector('[data-testid=configuration-wizard]');
  await page.getByRole('button', { name: '2 · Zakres badań' }).click();
  await page.locator('select').filter({ has: page.locator('option[value=live_serp]') }).selectOption('none');
  for (const label of ['Przejrzyj arXiv i Europe PMC', 'Zasil kartoteki']) { const c = page.getByLabel(new RegExp(label)); if (await c.count() && await c.isChecked()) await c.uncheck(); }
  for (const r of REGIONS) await page.check(`[data-testid=trends-region-${r}]`);
  await page.click('[data-testid=prepare-research-plan]'); await page.waitForSelector('[data-testid=trends-plan]');
  log.push('plan: ' + await page.locator('[data-testid=trends-plan]').innerText());
  log.push('budget: ' + await page.locator('[data-testid=serp-budget]').innerText().catch(() => 'none'));
  await page.screenshot({ path: path.join(OUT, 'wizard_plan.png'), fullPage: true });
  await page.click('[data-testid=launch-research-plan]');
  await page.getByRole('link', { name: /Kalibracja Trends/ }).first().waitFor({ timeout: 30000 });
  const plan = (await api('/api/settings/plans')).plans.filter(p => p.launch?.trendsRunIds?.length).sort((a, b) => b.launch.launchedAt.localeCompare(a.launch.launchedAt))[0];
  fs.writeFileSync(path.join(OUT, 'plan.json'), JSON.stringify(plan, null, 2));
  for (const [i, id] of plan.launch.trendsRunIds.entries()) {
    const region = plan.body.trendsCalibration.regions[i]; let run;
    for (let k = 0; k < 300; k++) { run = (await api('/api/runs/' + id)).run; if (['COMPLETED', 'FAILED'].includes(run.status)) break; await page.waitForTimeout(1000); }
    log.push(`${region} ${id} ${run.status} commit=${run.git_commit} ${run.error_code ?? ''}`);
    for (const [n, u] of [['run', ''], ['results', '/results'], ['manifest', '/manifest'], ['fetch_events', '/fetch-events']]) fs.writeFileSync(path.join(OUT, `${region}_${n}.json`), JSON.stringify(await api('/api/runs/' + id + u), null, 2));
    fs.writeFileSync(path.join(OUT, `${region}_export.json`), await text(`/api/runs/${id}/export?format=json`));
    await page.goto(`${BASE}/runs/${id}/results`); await page.waitForSelector('[data-testid=trends-calibration]', { timeout: 20000 }).catch(() => log.push(region + ': no panel'));
    await page.waitForTimeout(500); await page.screenshot({ path: path.join(OUT, `${region}_results.png`), fullPage: true });
  }
  fs.writeFileSync(path.join(OUT, 'probe_log.txt'), log.join('\n') + '\n'); await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
