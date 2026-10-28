// Visits every page; records page errors, failed API calls, suspicious visible words and every button with its state.
const { chromium } = require(process.env.PW_PATH);
const fs = require('fs'); const path = require('path');
const BASE = process.argv[2], OUT = process.argv[3];
const WORDS = /\b(mock\w*|fixture\w*|fikcyjn\w*|fictional|dummy|lorem|placeholder|syntetyczn\w*|synthetic|sample|demo|todo|not implemented|niezaimplementowan\w*|planned|test_\w+|jh16_test|example\.(?:org|com))\b/gi;
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await ctx.newPage(); const report = [];
  const runs = await (await fetch(BASE + '/api/runs')).json();
  const runId = runs.runs.find(r => r.status === 'COMPLETED')?.id;
  const routes = ['/', '/data', '/analysis', '/collection', '/papers', '/knowledge', '/sources', '/source-access', '/runs', `/runs/${runId}`, `/runs/${runId}/results`, '/analyzers', '/study', '/method',
    '/replications', '/replications/jh2016', '/diagnostics', '/workbench', '/responder', '/evidence', '/setup', '/access', '/settings/access', '/automation', '/memory', '/research', '/projects', '/search'];
  for (const r of routes) {
    const entry = { route: r, pageErrors: [], consoleErrors: [], failed: [], words: [], buttons: [] };
    const onErr = e => entry.pageErrors.push(e.message), onCon = m => { if (m.type() === 'error') entry.consoleErrors.push(m.text().slice(0, 200)); };
    const onResp = resp => { const u = resp.url(); if (u.includes('/api/') && resp.status() >= 400) entry.failed.push(`${resp.status()} ${resp.request().method()} ${u.replace(BASE, '')}`); };
    page.on('pageerror', onErr); page.on('console', onCon); page.on('response', onResp);
    await page.goto(BASE + r); await page.waitForTimeout(2500);
    const text = await page.locator('main').innerText().catch(() => '');
    const found = new Map(); for (const m of text.matchAll(WORDS)) { const s = text.slice(Math.max(0, m.index - 60), m.index + 60).replace(/\s+/g, ' '); found.set(m[0].toLowerCase() + ': ' + s, 1); }
    entry.words = [...found.keys()].slice(0, 25);
    entry.buttons = await page.locator('main button').evaluateAll(bs => bs.map(x => `${x.disabled ? '[disabled] ' : ''}${(x.innerText || x.getAttribute('aria-label') || '').trim().slice(0, 60)}`)).catch(() => []);
    entry.empty = text.trim().length < 40;
    await page.screenshot({ path: path.join(OUT, r.replace(/[^a-z0-9]+/gi, '_') + '.png'), fullPage: true });
    page.off('pageerror', onErr); page.off('console', onCon); page.off('response', onResp);
    report.push(entry);
  }
  fs.writeFileSync(path.join(OUT, 'audit.json'), JSON.stringify(report, null, 1)); await b.close();
  for (const e of report) console.log(`${e.route}: errors=${e.pageErrors.length} console=${e.consoleErrors.length} failed=${e.failed.length} words=${e.words.length} buttons=${e.buttons.length}${e.empty ? ' EMPTY' : ''}`);
})().catch(e => { console.error(e); process.exit(1); });
