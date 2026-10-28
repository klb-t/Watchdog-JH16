// Walks the Replications UI like the owner: every tab, a comparison, a drill-down, the manuscript; desktop and phone.
const { chromium } = require(process.env.PW_PATH);
const fs = require('fs'); const path = require('path');
const BASE = process.argv[2], OUT = process.argv[3];
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch(); const log = [];
  for (const [name, vp] of [['desktop', { width: 1280, height: 1000 }], ['phone', { width: 390, height: 844 }]]) {
    const page = await (await browser.newContext({ viewport: vp })).newPage();
    page.on('pageerror', e => log.push(`${name} pageerror: ${e.message}`)); page.on('console', m => { if (m.type() === 'error') log.push(`${name} console: ${m.text()}`); });
    await page.goto(BASE + '/'); await page.waitForTimeout(800);
    await page.goto(BASE + '/replications'); await page.waitForSelector('[data-testid=replication-jh2016]');
    log.push(`${name} list: ` + (await page.locator('[data-testid=replication-jh2016]').innerText()).replace(/\n/g, ' | '));
    await page.screenshot({ path: path.join(OUT, `${name}_00_list.png`), fullPage: true });
    await page.click('[data-testid=replication-jh2016]'); await page.waitForSelector('[data-testid=overview-verdicts]');
    for (const tab of ['overview', 'runs', 'discrepancies', 'calibration', 'registry', 'manuscript']) {
      await page.click(`[data-testid=tab-${tab}]`); await page.waitForTimeout(tab === 'manuscript' ? 2500 : 600);
      if (tab === 'runs') {
        const boxes = page.locator('[data-testid=runs-table] input[type=checkbox]'); const n = await boxes.count(); log.push(`${name} runs rows with compare box: ${n}`);
        for (let i = 0; i < Math.min(n, 4); i++) await boxes.nth(i).check();
        await page.waitForSelector('[data-testid=compare]'); await page.locator('[data-testid=compare-heroin]').click(); await page.waitForSelector('[data-testid=drill] td');
        log.push(`${name} drill rows: ` + await page.locator('[data-testid=drill] tbody tr').count());
      }
      await page.screenshot({ path: path.join(OUT, `${name}_${tab}.png`), fullPage: true });
      const w = await page.evaluate(() => ({ cw: document.querySelector('main').clientWidth, sw: document.querySelector('main').scrollWidth }));
      if (w.sw > w.cw + 1) log.push(`${name} ${tab} OVERFLOW ${JSON.stringify(w)}`);
    }
    if (name === 'desktop') fs.writeFileSync(path.join(OUT, 'manuscript.txt'), await page.locator('[data-testid=manuscript]').innerText());
  }
  const ctx = await browser.newContext(); const p = await ctx.newPage(); await p.goto(BASE + '/');
  for (const f of ['md', 'html']) fs.writeFileSync(path.join(OUT, `manuscript.${f}`), await p.evaluate(async u => (await fetch(u)).text(), `/api/replications/jh2016/manuscript?format=${f}`));
  fs.writeFileSync(path.join(OUT, 'probe_log.txt'), log.join('\n') + '\n'); await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
