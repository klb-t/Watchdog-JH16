// "Before" screenshots on the base image: English phone guest via a bearer link.
const { chromium } = require('playwright');
const { spawnSync } = require('child_process');
const fs = require('fs'); const path = require('path');
const BASE = 'http://127.0.0.1:8195', OUT = process.argv[2];
fs.mkdirSync(OUT, { recursive: true });
const link = e => /#signin=([^\s]+)/.exec(spawnSync('sudo', ['-n', 'docker', 'exec', 'wd-invitee-test', 'node', 'dist/watchdog-admin.cjs', 'signin-link', e], { encoding: 'utf8' }).stdout)[1];
(async () => {
  const b = await chromium.launch(), log = [];
  const api = (p, u, body) => p.evaluate(async ([x, bd]) => { const r = await fetch(x, bd === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bd) }); return r.json(); }, [u, body]);
  const o = await (await b.newContext()).newPage();
  await o.goto(`${BASE}/login#signin=${link('owner@lab.example')}`); await o.waitForURL(u => !u.pathname.startsWith('/login'));
  const runs = (await api(o, '/api/runs?limit=200')).runs;
  const share = await api(o, '/api/run-shares', { run_ids: runs.map(r => r.id), kind: 'link' });
  const inv = await api(o, '/api/access/invitations', { kind: 'open_link', roles: ['viewer', 'researcher'], signs_in: true, max_uses: 2, expires_in_days: 7 });
  const g = await (await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-GB' })).newPage();
  const shot = async n => { await g.waitForLoadState('networkidle').catch(() => {}); await g.waitForTimeout(800); await g.screenshot({ path: path.join(OUT, n + '.png'), fullPage: true }); log.push(n + ': ' + (await g.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 400)); };
  await g.goto(`${BASE}/join#t=${inv.token}`); await g.locator('[data-testid=join-bearer]').waitFor(); await shot('before_en_phone_join_bearer');
  await g.click('[data-testid=join-bearer-enter]'); await g.locator('[data-testid=join-accepted]').waitFor();
  await g.goto(`${BASE}/`); await shot('before_en_phone_home_banner');
  await g.goto(`${BASE}${share.link_path}`); await g.locator('[data-testid=share-redeemed]').waitFor(); await shot('before_en_phone_share');
  await g.goto(`${BASE}/replications`); await shot('before_en_phone_replications_list');
  await g.goto(`${BASE}/replications/jh2016`); await g.click('[data-testid=tab-protocol]'); await shot('before_en_phone_protocol_tab');
  await g.goto(`${BASE}/privacy`); await g.selectOption('[data-testid=language-select]', 'pl'); await shot('before_en_phone_privacy_after_switch_to_pl');
  const bad = await g.evaluate(async () => { const r = await fetch('/api/replications'); return { status: r.status, body: await r.text() }; });
  log.push('api/replications as guest: ' + bad.status + ' ' + bad.body.slice(0, 300));
  fs.writeFileSync(path.join(OUT, 'before_log.txt'), log.join('\n') + '\n'); await b.close();
})().catch(e => { console.error(e); process.exit(1); });
