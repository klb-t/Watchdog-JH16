// Read-only smoke test of the new screens on the owner's instance: nothing is frozen, launched or saved.
const { chromium } = require(process.env.PW_PATH); const fs = require('fs'); const path = require('path');
const BASE = process.argv[2], OUT = process.argv[3];
(async () => { fs.mkdirSync(OUT, { recursive: true }); const log = []; const browser = await chromium.launch();
  for (const [w, h, tag] of [[1280, 1000, 'desktop'], [390, 844, 'phone']]) {
    const page = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage();
    page.on('pageerror', e => log.push(`${tag} pageerror: ${e.message}`)); page.on('console', m => { if (m.type() === 'error') log.push(`${tag} console: ${m.text()}`); });
    const overflow = async (k) => log.push(`${tag} ${k} overflow px: ` + await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth));
    await page.goto(BASE + '/replications'); await page.locator('[data-testid=replication-cr2014]').waitFor(); log.push(`${tag} list: ` + (await page.locator('[data-testid=replication-cr2014]').innerText()).replace(/\n/g, ' | '));
    for (const t of ['overview', 'measure', 'runs', 'protocol', 'discrepancies', 'registry', 'evidence', 'manuscript']) {
      await page.goto(BASE + '/replications/cr2014'); await page.click(`[data-testid=tab-${t}]`); await page.waitForTimeout(700); await overflow(`cr2014/${t}`);
      if (tag === 'desktop' && t === 'measure') { await page.locator('[data-testid=measurement]').waitFor();
        log.push('measure cost: ' + await page.locator('[data-testid=measurement-cost]').innerText());
        log.push('measure blocked: ' + (await page.locator('[data-testid=measurement-blocked]').count() ? await page.locator('[data-testid=measurement-blocked]').innerText() : 'none'));
        log.push('launch disabled before approval: ' + await page.locator('[data-testid=launch-measurement]').isDisabled()); await page.screenshot({ path: path.join(OUT, 'cr2014_measure.png'), fullPage: true }); }
      if (tag === 'desktop' && t === 'evidence') { await page.locator('[data-testid=evidence-gaps]').waitFor(); log.push('cr2014 gaps: ' + (await page.locator('[data-testid=evidence-gaps]').innerText()).replace(/\n/g, ' | ')); }
    }
    for (const t of ['evidence', 'protocol']) { await page.goto(BASE + '/replications/jh2016'); await page.click(`[data-testid=tab-${t}]`); await page.waitForTimeout(900); await overflow(`jh2016/${t}`);
      if (tag === 'desktop' && t === 'evidence') { log.push('jh2016 gaps: ' + (await page.locator('[data-testid=evidence-gaps]').innerText()).replace(/\n/g, ' | ')); await page.screenshot({ path: path.join(OUT, 'jh2016_evidence.png'), fullPage: true }); }
      if (tag === 'desktop' && t === 'protocol') { await page.selectOption('[data-testid="family-popularity_ranking_stability"]', '2');
        log.push('jh2016 protocol preview (not frozen): ' + await page.locator('[data-testid=protocol-preview]').innerText()); }
    }
  }
  fs.writeFileSync(path.join(OUT, 'smoke_log.txt'), log.join('\n') + '\n'); await browser.close(); })().catch(e => { console.error(e); process.exit(1); });
