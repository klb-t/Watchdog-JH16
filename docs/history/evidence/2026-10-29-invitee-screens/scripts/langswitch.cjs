// Does the language selector on the access screens change the page body?
const { chromium } = require('playwright');
const BASE = process.argv[2] || 'http://127.0.0.1:8195';
(async () => {
  const b = await chromium.launch(); const c = await b.newContext({ locale: 'en-GB' }); const p = await c.newPage();
  for (const pg of ['/privacy', '/login', '/join#t=nonsense']) {
    await p.goto(BASE + pg); await p.waitForTimeout(1200);
    const before = await p.locator('h1').innerText();
    await p.selectOption('[data-testid=language-select]', 'pl'); await p.waitForTimeout(400);
    const after = await p.locator('h1').innerText(), tag = await p.locator('p.text-sm.text-slate-600').first().innerText();
    console.log(pg, JSON.stringify({ before, after, tagline: tag.slice(0, 40) }));
    await p.selectOption('[data-testid=language-select]', 'en');
  }
  await b.close();
})();
