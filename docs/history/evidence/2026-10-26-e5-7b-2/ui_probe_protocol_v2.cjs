// E5.7b-2 owner path (two families, serial gating): freeze a protocol in Replications, launch a confirmation run from the wizard, read the protocol results.
const { chromium } = require(process.env.PW_PATH);
const fs = require('fs'); const path = require('path');
const BASE = process.argv[2], OUT = process.argv[3];
(async () => {
  fs.mkdirSync(OUT, { recursive: true }); const log = [];
  const browser = await chromium.launch(); const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  page.on('pageerror', e => log.push('pageerror: ' + e.message));
  const api = async p => page.evaluate(async u => (await fetch(u)).json(), p);
  await page.goto(BASE + '/replications/jh2016'); await page.click('[data-testid=tab-protocol]');
  await page.selectOption('[data-testid=family-popularity_ranking_stability]', '2');
  log.push('preview: ' + await page.locator('[data-testid=protocol-preview]').innerText());
  await page.fill('[data-testid=protocol-rationale]', 'H-harm najpierw (rodzina 1); H-pop testowane tylko, gdy H-harm odrzucona (bramkowanie szeregowe). Holm w każdej rodzinie, alfa 0,01. Zamrożone przed nowym pomiarem.');
  await page.click('[data-testid=freeze-protocol]'); await page.getByRole('status').filter({ hasText: 'Zamrożono' }).waitFor();
  log.push('freeze: ' + await page.getByRole('status').innerText());
  await page.goto(BASE + '/setup'); await page.waitForSelector('[data-testid=configuration-wizard]');
  await page.getByRole('button', { name: '2 · Zakres badań' }).click();
  await page.locator('select').filter({ has: page.locator('option[value=live_serp]') }).selectOption('live_serp');
  for (const label of ['Przejrzyj arXiv i Europe PMC', 'Zasil kartoteki']) { const c = page.getByLabel(new RegExp(label)); if (await c.count() && await c.isChecked()) await c.uncheck(); }
  const role = page.locator('[data-testid=data-role]'); const opts = await role.locator('option').allInnerTexts(); log.push('role options: ' + JSON.stringify(opts));
  await role.selectOption({ index: opts.length - 1 });
  await page.click('[data-testid=prepare-research-plan]'); await page.waitForSelector('[data-testid=plan-data-role]');
  log.push('plan role: ' + await page.locator('[data-testid=plan-data-role]').innerText());
  await page.check('[data-testid=approve-wizard-method]'); await page.click('[data-testid=launch-research-plan]');
  await page.getByRole('link', { name: 'Wyniki JH16' }).waitFor({ timeout: 30000 });
  const href = await page.getByRole('link', { name: 'Wyniki JH16' }).getAttribute('href'), id = href.split('/runs/')[1].split('/')[0];
  for (let i = 0; i < 300; i++) { const r = (await api('/api/runs/' + id)).run; if (['COMPLETED', 'FAILED'].includes(r.status)) { log.push(`run ${id} ${r.status} ${r.git_commit}`); break; } await page.waitForTimeout(1000); }
  fs.writeFileSync(path.join(OUT, 'run_export.json'), await page.evaluate(async u => (await fetch(u)).text(), `/api/runs/${id}/export?format=json`));
  const rep = await api('/api/replications/jh2016'); fs.writeFileSync(path.join(OUT, 'replication.json'), JSON.stringify({ protocols: rep.protocols, run: rep.runs.find(r => r.run_id === id) }, null, 2));
  await page.goto(BASE + '/replications/jh2016'); await page.click('[data-testid=tab-protocol]'); await page.waitForSelector('[data-testid=protocol-results]');
  log.push('protocol results: ' + (await page.locator('[data-testid=protocol-results]').last().innerText()).replace(/\n/g, ' | '));
  await page.screenshot({ path: path.join(OUT, 'protocol_tab.png'), fullPage: true });
  await page.click('[data-testid=tab-runs]'); await page.screenshot({ path: path.join(OUT, 'runs_tab.png'), fullPage: true });
  fs.writeFileSync(path.join(OUT, 'manuscript.md'), await page.evaluate(async u => (await fetch(u)).text(), '/api/replications/jh2016/manuscript?format=md'));
  const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await phone.goto(BASE + '/replications/jh2016'); await phone.click('[data-testid=tab-protocol]'); await phone.waitForSelector('[data-testid=protocol-form]');
  log.push('phone overflow px: ' + await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth));
  await phone.screenshot({ path: path.join(OUT, 'protocol_tab_phone.png'), fullPage: true });
  fs.writeFileSync(path.join(OUT, 'probe_log.txt'), log.join('\n') + '\n'); await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
