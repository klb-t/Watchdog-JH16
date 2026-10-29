// D: the owner's access path on a copy of his data, in accounts mode, through the UI.
const { chromium } = require(process.env.PW_PATH); const fs = require('fs'); const path = require('path');
const BASE = process.argv[2], OUT = process.argv[3], L = JSON.parse(fs.readFileSync(process.argv[4], 'utf8'));
(async () => { fs.mkdirSync(OUT, { recursive: true }); const log = []; const b = await chromium.launch();
  const ctx = async (w, h) => { const c = await b.newContext({ viewport: { width: w, height: h } }); const p = await c.newPage();
    p.on('pageerror', e => log.push('pageerror: ' + e.message)); return p; };
  const api = (p, u) => p.evaluate(async x => { const r = await fetch(x); return { status: r.status, body: await r.json().catch(() => null) }; }, u);
  const overflow = async (p, k) => log.push(`${k} overflow px: ` + await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth));
  // 1. owner signs in (operator link: Google needs the production origin) and lands on local-user with his data
  const owner = await ctx(1280, 1000);
  await owner.goto(`${BASE}/login#signin=${L.owner}`); await owner.waitForURL(u => !u.pathname.startsWith('/login'), { timeout: 20000 }).catch(() => {});
  const me = await api(owner, '/api/auth/me'); log.push(`owner me: ${me.body.principal.id} ${me.body.principal.email} ${me.body.principal.roles}`);
  log.push(`owner runs: ${(await api(owner, '/api/runs?limit=200')).body.runs.length}`);
  // 2. bearer invitation from the UI
  await owner.goto(`${BASE}/access`); await owner.click('[data-testid=tab-invite]'); await owner.check('[data-testid=kind-bearer]');
  log.push('viewer rule: ' + await owner.locator('[data-testid=invite-viewer-rule]').innerText());
  await owner.check('[data-testid=invite-roles] input[data-role=researcher]');
  await owner.fill('[data-testid=invite-uses]', '3'); await owner.click('[data-testid=invite-create]');
  await owner.locator('[data-testid=fresh-invitation]').waitFor();
  const joinLink = await owner.locator('[data-testid=invite-link]').inputValue();
  log.push('bearer link created: ' + !!joinLink); await owner.screenshot({ path: path.join(OUT, 'owner_invite.png'), fullPage: true });
  // 3. owner shares his JH16 runs by link
  await owner.goto(`${BASE}/replications/jh2016`); await owner.click('[data-testid=tab-runs]'); await owner.locator('[data-testid=share-panel]').waitFor();
  await owner.selectOption('[data-testid=share-kind]', 'link'); await owner.click('[data-testid=share-create]');
  await owner.locator('[data-testid=share-link]').waitFor(); const shareLink = (await owner.locator('[data-testid=share-link] code').innerText()).trim();
  log.push('share link: ' + shareLink.replace(/#t=.*/, '#t=…')); await owner.locator('[data-testid=share-panel]').screenshot({ path: path.join(OUT, 'owner_share_panel.png') });
  // 4. a guest on a phone opens the bearer link: no sign-in, viewer, pending banner
  const guest = await ctx(390, 844);
  await guest.goto(joinLink); await guest.locator('[data-testid=join-bearer]').waitFor();
  log.push('join bearer: ' + (await guest.locator('[data-testid=join-bearer]').innerText()).replace(/\n/g, ' | ')); await overflow(guest, 'join');
  await guest.click('[data-testid=join-bearer-enter]'); await guest.locator('[data-testid=join-accepted]').waitFor();
  await guest.goto(`${BASE}/`); await guest.locator('[data-testid=pending-approval]').waitFor();
  log.push('guest banner: ' + await guest.locator('[data-testid=pending-approval]').innerText());
  const gme = await api(guest, '/api/auth/me'); log.push(`guest me: ${gme.body.principal.email} ${gme.body.principal.display_name} roles=${gme.body.principal.roles}`);
  log.push(`guest runs before share: ${(await api(guest, '/api/runs')).body.runs.length}`);
  // 5. the guest opens the share link and sees the owner's runs in Replications, read-only
  await guest.goto(shareLink); await guest.locator('[data-testid=share-redeemed]').waitFor();
  log.push('share redeemed: ' + (await guest.locator('[data-testid=share-redeemed] p').first().innerText())); await overflow(guest, 'share');
  await guest.goto(`${BASE}/replications/jh2016`); await guest.click('[data-testid=tab-runs]'); await guest.waitForTimeout(1500);
  log.push(`guest shared badges: ${await guest.locator('[data-testid^=shared-]').count()}; share panel shown: ${await guest.locator('[data-testid=share-panel]').count()}`);
  await overflow(guest, 'replications runs'); await guest.screenshot({ path: path.join(OUT, 'guest_replications_phone.png'), fullPage: true });
  // 6. the owner approves the guest's request for researcher
  await owner.goto(`${BASE}/access`); await owner.click('[data-testid=tab-applications]');
  const card = owner.locator(`[data-testid="application-${gme.body.principal.email}"]`); await card.waitFor();
  log.push('application card: ' + (await card.innerText()).replace(/\n/g, ' | ').slice(0, 300)); await card.screenshot({ path: path.join(OUT, 'owner_application.png') });
  await card.locator('[data-testid=approve]').click(); await owner.waitForTimeout(1000);
  await guest.goto(`${BASE}/`); await guest.waitForTimeout(1500);
  log.push(`after approval: banner=${await guest.locator('[data-testid=pending-approval]').count()} roles=${(await api(guest, '/api/auth/me')).body.principal.roles}`);
  // 7. an unknown person signs in and gets the request form at once
  const stranger = await ctx(390, 844);
  await stranger.goto(`${BASE}/login#signin=${L.stranger}`); await stranger.waitForURL(u => u.pathname === '/apply', { timeout: 20000 });
  await stranger.locator('[data-testid=application-form]').waitFor(); log.push('stranger landed on: ' + new URL(stranger.url()).pathname);
  log.push(`stranger /api/runs: ${(await api(stranger, '/api/runs')).status}`); await overflow(stranger, 'apply');
  // 8. public pages without sign-in; links on the sign-in screen
  const anon = await ctx(390, 844);
  for (const pg of ['privacy', 'terms']) { await anon.goto(`${BASE}/${pg}`); await anon.locator(`[data-testid=legal-${pg}]`).waitFor();
    const txt = await anon.locator(`[data-testid=legal-${pg}]`).innerText(); log.push(`${pg}: contact ${txt.includes('<owner-email>')}, location ${txt.includes('europe-west4')}, chars ${txt.length}`); await overflow(anon, pg);
    await anon.screenshot({ path: path.join(OUT, `${pg}_phone.png`), fullPage: true }); }
  await anon.goto(`${BASE}/login`); await anon.waitForTimeout(1500); log.push('login legal links: ' + await anon.locator('[data-testid=legal-links]').count());
  // 9. revoking the bearer link ends the guest's session
  const invs = (await api(owner, '/api/access/overview')).body.invitations.filter(i => i.signsIn && i.status === 'active');
  await owner.evaluate(async id => fetch(`/api/access/invitations/${id}/revoke`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }), invs[0].id);
  log.push(`guest after revoke: /api/runs ${(await api(guest, '/api/runs')).status}`);
  fs.writeFileSync(path.join(OUT, 'probe_log.txt'), log.join('\n') + '\n'); await b.close(); })().catch(e => { console.error(e); process.exit(1); });
