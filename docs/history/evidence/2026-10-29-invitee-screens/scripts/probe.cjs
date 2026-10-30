// Walks every screen an invited person meets, on the copy of the owner's data.
// usage: NODE_PATH=<repo>/node_modules node probe.cjs <base> <outdir> [langs] [widths]
const { chromium } = require('playwright');
const { spawnSync } = require('child_process');
const fs = require('fs'); const path = require('path');
const BASE = process.argv[2] || 'http://127.0.0.1:8195';
const OUT = process.argv[3] || path.join(__dirname, 'out');
const LANGS = (process.argv[4] || 'en,pl').split(',');
const WIDTHS = (process.argv[5] || '390,1280').split(',').map(Number);
const ADMIN = process.env.WD_ADMIN || 'host'; // 'host' or 'docker'
fs.mkdirSync(OUT, { recursive: true });
const log = []; const say = s => { log.push(s); console.log(s); };

function signinLink(email) {
  const r = ADMIN === 'docker'
    ? spawnSync('sudo', ['-n', 'docker', 'exec', 'wd-invitee-test', 'node', 'dist/watchdog-admin.cjs', 'signin-link', email], { encoding: 'utf8' })
    : spawnSync('node', [path.join(__dirname, 'wd.cjs'), 'admin', 'signin-link', email], { encoding: 'utf8' });
  const m = /#signin=([A-Za-z0-9_\-.~%]+)/.exec(r.stdout + r.stderr);
  if (!m) throw new Error('no signin link: ' + r.stdout + r.stderr);
  return m[1];
}

(async () => {
  const b = await chromium.launch();
  const mk = async (w, lang) => {
    const c = await b.newContext({ viewport: { width: w, height: w < 600 ? 844 : 1000 }, locale: lang === 'pl' ? 'pl-PL' : 'en-GB' });
    const p = await c.newPage(); p._issues = [];
    p.on('pageerror', e => p._issues.push('pageerror: ' + e.message));
    p.on('console', m => { if (m.type() === 'error') p._issues.push('console: ' + m.text().slice(0, 200)); });
    p.on('response', r => { if (r.status() >= 400 && !r.url().includes('/assets/')) p._issues.push(`http ${r.status()} ${new URL(r.url()).pathname}`); });
    return p;
  };
  const api = (p, u, body) => p.evaluate(async ([x, bd]) => {
    const r = await fetch(x, bd === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bd) });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, [u, body]);
  const settle = async p => { await p.waitForLoadState('networkidle').catch(() => {}); await p.waitForTimeout(600); };
  const shot = async (p, name) => {
    await settle(p);
    const info = await p.evaluate(() => {
      const over = document.documentElement.scrollWidth - document.documentElement.clientWidth;
      const wide = [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); return r.right > window.innerWidth + 1 && r.width > 0 && getComputedStyle(e).position !== 'fixed'; })
        .filter(e => !e.closest('[class*=overflow-x-auto],[class*=overflow-auto]')).slice(0, 5).map(e => `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 40)}:${Math.round(e.getBoundingClientRect().right)}`);
      const buttons = [...document.querySelectorAll('button, a.field-button, input[type=submit]')].filter(e => e.offsetParent !== null)
        .map(e => `${e.disabled ? '[disabled] ' : ''}${(e.innerText || e.value || e.getAttribute('aria-label') || '').trim().slice(0, 50)}`);
      return { over, wide, buttons, text: document.body.innerText, path: location.pathname + location.hash };
    });
    await p.screenshot({ path: path.join(OUT, name + '.png'), fullPage: true });
    fs.writeFileSync(path.join(OUT, name + '.txt'), `${info.path}\noverflow=${info.over} ${info.wide.join(' ')}\nissues: ${p._issues.join(' | ')}\nbuttons: ${info.buttons.join(' | ')}\n---\n${info.text}\n`);
    say(`${name}: ${info.path} overflow=${info.over}${info.wide.length ? ' wide=' + info.wide.join(',') : ''}${p._issues.length ? ' ISSUES=' + p._issues.join(' | ') : ''}`);
    p._issues = [];
  };

  // Owner: sign in, invitations and share links.
  const owner = await mk(1280, 'en');
  await owner.goto(`${BASE}/login#signin=${signinLink('owner@lab.example')}`);
  await owner.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 20000 });
  const me = await api(owner, '/api/auth/me'); say(`owner: ${me.body.principal.id} ${me.body.principal.email} ${me.body.principal.roles}`);
  const runs = (await api(owner, '/api/runs?limit=200')).body.runs; say(`owner runs: ${runs.length}`);
  const reps = await api(owner, '/api/replications'); fs.writeFileSync(path.join(OUT, 'replications.json'), JSON.stringify(reps.body, null, 1));
  const targets = (reps.body.targets ?? reps.body.replications ?? (Array.isArray(reps.body) ? reps.body : [])).map(t => t.id ?? t.target_id); say('targets: ' + targets.join(','));
  const share = await api(owner, '/api/run-shares', { run_ids: runs.map(r => r.id ?? r.run_id), kind: 'link', note: 'audit' });
  say(`share link: ${share.status} ${share.body?.shares?.length ?? JSON.stringify(share.body)}`);
  const shareToken = /#t=(.*)$/.exec(share.body.link_path)[1];
  const inv = async body => { const r = await api(owner, '/api/access/invitations', { expires_in_days: 7, language: 'en', ...body }); if (r.status !== 201) throw new Error(JSON.stringify(r.body)); return r.body.token; };

  for (const lang of LANGS) for (const w of WIDTHS) {
    const tag = `${lang}_${w < 600 ? 'phone' : 'desktop'}`;
    // Anonymous: login, legal pages.
    const anon = await mk(w, lang);
    await anon.goto(`${BASE}/login`); await shot(anon, `${tag}_01_login`);
    await anon.goto(`${BASE}/privacy`); await shot(anon, `${tag}_02_privacy`);
    await anon.selectOption('[data-testid=language-select]', lang === 'pl' ? 'en' : 'pl'); await shot(anon, `${tag}_02b_privacy_switched`);
    await anon.selectOption('[data-testid=language-select]', lang);
    await anon.goto(`${BASE}/terms`); await shot(anon, `${tag}_03_terms`);
    await anon.goto(`${BASE}/share#t=${shareToken}`); await shot(anon, `${tag}_04_share_anonymous`);
    await anon.goto(`${BASE}/join#t=nonsense`); await shot(anon, `${tag}_05_join_bad_token`);
    await anon.context().close();

    // Email invitation, same address.
    const addr = `invitee-${tag.replace('_', '-')}${process.env.SUFFIX || ''}@example.org`;
    const tEmail = await inv({ kind: 'email', email: addr, roles: ['researcher'], note: 'Audit invitation' });
    const em = await mk(w, lang);
    await em.goto(`${BASE}/join#t=${tEmail}`); await shot(em, `${tag}_10_join_email_preview`);
    await em.goto(`${BASE}/login#signin=${signinLink(addr)}`);
    await em.waitForURL(u => u.pathname === '/join', { timeout: 20000 }).catch(() => {});
    await em.locator('[data-testid=join-accepted],[data-testid=join-error]').first().waitFor({ timeout: 15000 }).catch(() => {});
    await shot(em, `${tag}_11_join_email_accepted`);
    await em.context().close();

    // Open link (needs sign-in), a different address: viewer at once, researcher pending.
    const tOpen = await inv({ kind: 'open_link', roles: ['researcher'], max_uses: 5 });
    const op = await mk(w, lang);
    await op.goto(`${BASE}/join#t=${tOpen}`); await shot(op, `${tag}_20_join_open_preview`);
    await op.goto(`${BASE}/login#signin=${signinLink(`open-${tag.replace('_', '-')}${process.env.SUFFIX || ''}@example.org`)}`);
    await op.waitForURL(u => u.pathname === '/join', { timeout: 20000 }).catch(() => {});
    await op.locator('[data-testid=join-accepted],[data-testid=join-error]').first().waitFor({ timeout: 15000 }).catch(() => {});
    await shot(op, `${tag}_21_join_open_accepted`);
    await op.goto(`${BASE}/`); await shot(op, `${tag}_22_open_home_pending_banner`);
    await op.context().close();

    // Bearer link: no account, viewer at once.
    const tBearer = await inv({ kind: 'open_link', roles: ['viewer', 'researcher'], max_uses: 5, signs_in: true });
    const g = await mk(w, lang);
    await g.goto(`${BASE}/join#t=${tBearer}`); await shot(g, `${tag}_30_join_bearer_preview`);
    await g.click('[data-testid=join-bearer-enter]'); await g.locator('[data-testid=join-accepted],[data-testid=join-error]').first().waitFor({ timeout: 15000 }).catch(() => {});
    await shot(g, `${tag}_31_join_bearer_entered`);
    await g.goto(`${BASE}/`); await shot(g, `${tag}_32_guest_home`);
    await g.goto(`${BASE}/share#t=${shareToken}`); await g.locator('[data-testid=share-redeemed],[data-testid=share-error]').first().waitFor({ timeout: 15000 }).catch(() => {});
    await shot(g, `${tag}_33_share_redeemed`);
    await g.goto(`${BASE}/replications`); await shot(g, `${tag}_34_replications`);
    for (const t of targets) {
      await g.goto(`${BASE}/replications/${t}`); await shot(g, `${tag}_35_rep_${t}_overview`);
      const tabs = await g.locator('[role=tab]').evaluateAll(es => es.map(e => e.getAttribute('data-testid')));
      for (const tb of tabs.filter(x => x && x !== 'tab-overview')) { await g.click(`[data-testid=${tb}]`); await shot(g, `${tag}_36_rep_${t}_${tb}`); }
    }
    await g.goto(`${BASE}/runs`); await shot(g, `${tag}_40_runs`);
    const gr = (await api(g, '/api/runs?limit=200')).body?.runs ?? []; say(`guest sees runs: ${gr.length}`);
    const run = gr[0];
    if (run) {
      let shotDone = false;
      for (const r of gr) {
        const id = r.id ?? r.run_id;
        await g.goto(`${BASE}/runs/${id}`); await settle(g);
        const tabs = ['Data & Results', 'Provenance'];
        let raws = [];
        for (const tb of tabs) {
          const btn = g.getByRole('button', { name: tb, exact: true });
          if (await btn.count()) { await btn.first().click(); await settle(g);
            raws = raws.concat(await g.locator('a[href^="/api/artifacts/"]').evaluateAll(es => es.map(e => e.getAttribute('href')))); }
        }
        if (!raws.length && shotDone) continue;
        if (!shotDone || raws.length) {
          await g.goto(`${BASE}/runs/${id}`); await shot(g, `${tag}_41_run_detail_${id.slice(0, 8)}`);
          for (const tb of tabs) { const btn = g.getByRole('button', { name: tb, exact: true }); if (await btn.count()) { await btn.first().click(); await shot(g, `${tag}_41_run_detail_${id.slice(0, 8)}_${tb.replace(/\W+/g, '')}`); } }
          await g.goto(`${BASE}/runs/${id}/results`); await shot(g, `${tag}_42_run_results_${id.slice(0, 8)}`);
          shotDone = true;
        }
        say(`run ${id.slice(0, 8)} raw links: ${raws.length}`);
        if (raws.length) {
          const st = await g.evaluate(async u => { const x = await fetch(u); const b = await x.arrayBuffer(); return { status: x.status, bytes: b.byteLength, type: x.headers.get('content-type') }; }, raws[0]);
          say(`raw artifact ${raws[0].slice(0, 22)}…: ${JSON.stringify(st)}`);
          break;
        }
      }
    }
    await g.goto(`${BASE}/setup`); await shot(g, `${tag}_44_setup`);
    await g.goto(`${BASE}/study`); await shot(g, `${tag}_45_forbidden_view`);
    await g.context().close();

    // A stranger with no invitation: application form.
    const s = await mk(w, lang);
    await s.goto(`${BASE}/login#signin=${signinLink(`stranger-${tag.replace('_', '-')}${process.env.SUFFIX || ''}@example.org`)}`);
    await s.waitForURL(u => u.pathname === '/apply', { timeout: 20000 }).catch(() => {});
    await shot(s, `${tag}_50_apply`);
    await s.context().close();
  }
  fs.writeFileSync(path.join(OUT, 'probe_log.txt'), log.join('\n') + '\n');
  await b.close();
})().catch(e => { console.error(e); fs.writeFileSync(path.join(OUT, 'probe_log.txt'), log.join('\n') + '\nFAILED ' + e.stack + '\n'); process.exit(1); });
