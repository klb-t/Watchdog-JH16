// CR2014 owner path in the product: freeze protocol → confirmation measurement → results → manuscript.
const { chromium } = require(process.env.PW_PATH); const fs = require('fs'); const path = require('path');
const BASE = process.argv[2], OUT = process.argv[3];
(async () => {
  fs.mkdirSync(OUT, { recursive: true }); const log = [];
  const browser = await chromium.launch(); const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  page.on('pageerror', e => log.push('pageerror: ' + e.message)); page.on('console', m => { if (m.type() === 'error') log.push('console: ' + m.text()); });
  await page.goto(BASE + '/replications/cr2014'); await page.click('[data-testid=tab-protocol]');
  await page.fill('[data-testid=protocol-rationale]', 'Jedno wcześniej zarejestrowane porównanie (H-cigar-youth), Holm w rodzinie jednoelementowej, alfa 0,05 jak w pracy. Zamrożone przed pomiarem.');
  await page.fill('input[type=number][step="0.001"]', '0.05');
  await page.click('[data-testid=freeze-protocol]'); await page.getByRole('status').filter({ hasText: 'Zamrożono' }).waitFor();
  log.push('freeze: ' + await page.getByRole('status').innerText());
  await page.click('[data-testid=tab-measure]'); await page.locator('[data-testid=measurement]').waitFor();
  log.push('cost: ' + await page.locator('[data-testid=measurement-cost]').innerText());
  const opts = await page.locator('[data-testid=measurement-role] option').allInnerTexts(); log.push('roles: ' + JSON.stringify(opts));
  await page.selectOption('[data-testid=measurement-role]', { index: opts.length - 1 });
  await page.check('[data-testid=approve-preset]'); await page.click('[data-testid=launch-measurement]');
  await page.locator('[data-testid=measurement-status]').filter({ hasText: /COMPLETED|FAILED/ }).waitFor({ timeout: 120000 });
  log.push('status: ' + await page.locator('[data-testid=measurement-status]').innerText());
  await page.screenshot({ path: path.join(OUT, 'measure_tab.png'), fullPage: true });
  const rep = await page.evaluate(async () => (await fetch('/api/replications/cr2014')).json());
  fs.writeFileSync(path.join(OUT, 'replication.json'), JSON.stringify({ runs: rep.runs, protocols: rep.protocols }, null, 2));
  const run = rep.runs[0]; log.push(`run ${run.run_id} ${run.status} ${run.git_commit} role=${run.data_role?.role}`);
  fs.writeFileSync(path.join(OUT, 'run_export.json'), await page.evaluate(async u => (await fetch(u)).text(), `/api/runs/${run.run_id}/export?format=json`));
  await page.click('[data-testid=tab-overview]'); await page.locator('[data-testid=overview-verdicts]').waitFor();
  log.push('overview: ' + (await page.locator('[data-testid=overview-verdicts]').innerText()).replace(/\n/g, ' | '));
  await page.screenshot({ path: path.join(OUT, 'overview.png'), fullPage: true });
  await page.click('[data-testid=tab-runs]'); await page.locator(`[aria-label="pokaż ${run.run_id.slice(0, 8)}"]`).check();
  await page.locator('[data-testid=scatter-cigar_youth]').waitFor(); log.push('scatter: ' + (await page.locator('[data-testid=scatter-cigar_youth] p').first().innerText()));
  await page.locator('[data-testid=scatter-cigar_youth]').screenshot({ path: path.join(OUT, 'scatter.png') });
  await page.click('[data-testid=tab-protocol]'); await page.locator('[data-testid=protocol-results]').waitFor();
  log.push('protocol: ' + (await page.locator('[data-testid=protocol-results]').innerText()).replace(/\n/g, ' | '));
  fs.writeFileSync(path.join(OUT, 'manuscript.md'), await page.evaluate(async () => (await fetch('/api/replications/cr2014/manuscript?format=md')).text()));
  const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  for (const t of ['overview', 'measure', 'runs', 'manuscript']) { await phone.goto(BASE + '/replications/cr2014'); await phone.click(`[data-testid=tab-${t}]`); await phone.waitForTimeout(800);
    log.push(`phone ${t} overflow px: ` + await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)); }
  fs.writeFileSync(path.join(OUT, 'probe_log.txt'), log.join('\n') + '\n'); await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
