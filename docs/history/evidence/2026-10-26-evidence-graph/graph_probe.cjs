const { chromium } = require(process.env.PW_PATH); const fs = require('fs'); const path = require('path');
const BASE = process.argv[2], OUT = process.argv[3];
(async () => { fs.mkdirSync(OUT, { recursive: true }); const log = []; const browser = await chromium.launch();
  for (const [t, node] of [['jh2016', 'claim:harm_index_vs_reference_pearson'], ['cr2014', 'claim:cigar_youth_pearson']]) {
    for (const [w, h, tag] of [[1280, 1000, 'desktop'], [390, 844, 'phone']]) {
      const page = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage();
      page.on('pageerror', e => log.push(`${t} ${tag} pageerror: ${e.message}`)); page.on('console', m => { if (m.type() === 'error') log.push(`${t} ${tag} console: ${m.text()}`); });
      await page.goto(`${BASE}/replications/${t}`); await page.click('[data-testid=tab-evidence]'); await page.locator('[data-testid=evidence-graph]').waitFor();
      await page.locator(`[data-testid="node-${node}"]`).click(); await page.locator('[data-testid=evidence-node]').waitFor();
      if (tag === 'desktop') { log.push(`${t} gaps: ` + (await page.locator('[data-testid=evidence-gaps]').innerText()).replace(/\n/g, ' | '));
        log.push(`${t} node: ` + (await page.locator('[data-testid=evidence-node]').innerText()).replace(/\n/g, ' | ')); }
      log.push(`${t} ${tag} page overflow px: ` + await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth));
      await page.screenshot({ path: path.join(OUT, `${t}_${tag}.png`), fullPage: true }); }
  }
  fs.writeFileSync(path.join(OUT, 'graph_probe_log.txt'), log.join('\n') + '\n'); await browser.close(); })().catch(e => { console.error(e); process.exit(1); });
