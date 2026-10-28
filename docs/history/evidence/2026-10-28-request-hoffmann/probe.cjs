// The owner's path for the Hoffmann quote: paste → recognise → consent → send → literal part → accept Trends → results.
const { chromium } = require(process.env.PW_PATH); const fs = require('fs'); const path = require('path');
const BASE = process.argv[2], OUT = process.argv[3];
const QUOTE = fs.readFileSync(process.argv[4], 'utf8');
(async () => { fs.mkdirSync(OUT, { recursive: true }); const log = []; const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 1000 } })).newPage();
  page.on('pageerror', e => log.push('pageerror: ' + e.message)); page.on('console', m => { if (m.type() === 'error') log.push('console: ' + m.text()); });
  await page.goto(BASE + '/requests'); await page.fill('[data-testid=request-text]', QUOTE); await page.click('[data-testid=request-preview]');
  await page.locator('[data-testid=request-plan]').waitFor({ timeout: 60000 });
  for (const id of ['request-work', 'request-intents', 'request-plan']) log.push(`${id}: ` + (await page.locator(`[data-testid=${id}]`).innerText()).replace(/\n/g, ' | '));
  await page.screenshot({ path: path.join(OUT, 'preview.png'), fullPage: true });
  await page.check('[data-testid=request-consent]'); await page.click('[data-testid=request-submit]');
  await page.locator('[data-testid=text-request-page]').waitFor({ timeout: 60000 });
  const reqId = page.url().split('/requests/')[1]; log.push('request ' + reqId);
  const api = u => page.evaluate(async x => (await fetch(x)).json(), u);
  for (let i = 0; i < 240; i++) { const r = (await api(`/api/text-requests/${reqId}`)).request; const st = r.runs.map(x => x.status);
    if (st.length >= 2 && st.every(s => ['COMPLETED', 'FAILED'].includes(s))) { log.push('literal runs: ' + JSON.stringify(r.runs)); break; } await page.waitForTimeout(2000); }
  await page.click('[data-testid=accept-jh16_trends]');
  for (let i = 0; i < 240; i++) { const r = (await api(`/api/text-requests/${reqId}`)).request; const st = r.runs.map(x => x.status);
    if (st.length >= 6 && st.every(s => ['COMPLETED', 'FAILED'].includes(s))) { log.push('all runs: ' + JSON.stringify(r.runs)); break; } await page.waitForTimeout(2000); }
  await page.reload(); await page.locator('[data-testid=request-actions]').waitFor();
  for (const id of ['request-actions', 'request-proposals', 'request-questions']) log.push(`${id}: ` + (await page.locator(`[data-testid=${id}]`).innerText()).replace(/\n/g, ' | '));
  await page.screenshot({ path: path.join(OUT, 'request.png'), fullPage: true });
  fs.writeFileSync(path.join(OUT, 'request.json'), JSON.stringify((await api(`/api/text-requests/${reqId}`)).request, null, 2));
  const rep = await api('/api/replications/jh2016'); fs.writeFileSync(path.join(OUT, 'replication.json'), JSON.stringify({ primary_run_ids: rep.primary_run_ids, runs: rep.runs.slice(0, 8) }, null, 2));
  fs.writeFileSync(path.join(OUT, 'manuscript.md'), await page.evaluate(async () => (await fetch('/api/replications/jh2016/manuscript?format=md')).text()));
  const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  for (const u of ['/requests', `/requests/${reqId}`]) { await phone.goto(BASE + u); await phone.waitForTimeout(1500); log.push(`phone ${u} overflow px: ` + await phone.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)); }
  await phone.screenshot({ path: path.join(OUT, 'request_phone.png'), fullPage: true });
  fs.writeFileSync(path.join(OUT, 'probe_log.txt'), log.join('\n') + '\n'); await browser.close(); })().catch(e => { console.error(e); process.exit(1); });
