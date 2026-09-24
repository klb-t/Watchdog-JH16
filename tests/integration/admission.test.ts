import { test, before, after } from 'node:test';
import * as assert from 'node:assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Server } from 'node:http';
import { startFakeSmtp, mailText, mailSubject } from '../helpers/smtp';

/**
 * E4.5 end to end, over real HTTP, with mail delivered to a real (local) SMTP
 * socket. Covers the acceptance list recorded for this task: anonymous,
 * applicant, address matching, forwarded links, replay, immediate revocation,
 * bootstrap and role separation — plus the hole the global gate closes.
 *
 * The server runs in its own test process (node:test isolates files), in
 * accounts mode, against a throwaway database.
 */

let base = '';
let server: Server;
let smtp: Awaited<ReturnType<typeof startFakeSmtp>>;
let dir = '';

const OWNER = 'owner@lab.example';

before(async () => {
  smtp = await startFakeSmtp();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-admission-'));
  Object.assign(process.env, {
    DB_PATH: path.join(dir, 'w.sqlite'),
    STORE_PATH: path.join(dir, 'store'),
    WATCHDOG_AUTH: 'accounts',
    SESSION_SIGNING_KEY: randomBytes(32).toString('hex'),
    WATCHDOG_GRANTS: JSON.stringify({ [OWNER]: 'developer' }),
    SMTP_URL: `smtp://127.0.0.1:${smtp.port}`,
    MAIL_FROM: 'WatchDog <noreply@lab.example>',
    // Rendered into links only; nothing here follows them.
    WATCHDOG_PUBLIC_URL: 'http://localhost:4999',
    WATCHDOG_DIAGNOSTICS_MODE: 'OFF',
  });
  delete process.env.GOOGLE_OAUTH_CLIENT_ID;
  const mod = await import('../../server');
  await mod.configureApp();
  server = mod.app.listen(0, '127.0.0.1');
  await new Promise(r => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
});

after(async () => {
  server?.close();
  await smtp?.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

class Client {
  cookie = '';
  async req(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
    const response = await fetch(base + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(this.cookie ? { Cookie: this.cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = response.headers.get('set-cookie');
    if (set) {
      const pair = set.split(';')[0];
      this.cookie = pair.endsWith('=') ? '' : pair;
    }
    return { status: response.status, body: await response.json().catch(() => null) as any };
  }
  get(url: string) { return this.req('GET', url); }
  post(url: string, body: unknown = {}, headers?: Record<string, string>) { return this.req('POST', url, body, headers); }
}

function lastCodeFor(email: string): string {
  const address = email.toLowerCase();
  const mail = [...smtp.mails].reverse().find(m => m.to.includes(address));
  assert.ok(mail, `a sign-in code was mailed to ${email}`);
  const code = /\b([A-Z2-9]{4}-[A-Z2-9]{4})\b/.exec(mailText(mail))?.[1];
  assert.ok(code, 'the message carries a code');
  return code;
}

async function signIn(c: Client, email: string) {
  const start = await c.post('/api/auth/email/start', { email, language: 'en' });
  assert.strictEqual(start.status, 202, JSON.stringify(start.body));
  const verify = await c.post('/api/auth/email/verify', { email, code: lastCodeFor(email) });
  assert.strictEqual(verify.status, 200, JSON.stringify(verify.body));
  return verify.body;
}

const owner = new Client();
const alice = new Client();

// -------------------------------------------------------------------------
// Anonymous: the sign-in endpoints and nothing else.
// -------------------------------------------------------------------------

test('E4.5: an anonymous caller reaches only the sign-in surface', async () => {
  const anon = new Client();
  const config = await anon.get('/api/auth/config');
  assert.strictEqual(config.status, 200);
  assert.strictEqual(config.body.mode, 'accounts');
  assert.strictEqual(config.body.methods.email_code, true);
  assert.strictEqual(config.body.methods.google, null);
  assert.ok(!JSON.stringify(config.body).includes(OWNER), 'who may sign in is never served');

  for (const url of ['/api/runs', '/api/settings', '/api/access/overview', '/api/sources', '/api/diagnostics/state',
    '/api/workbench/datasets', '/api/memory/substances']) {
    const r = await anon.get(url);
    assert.strictEqual(r.status, 401, `${url} must refuse an anonymous caller`);
  }
  assert.strictEqual((await anon.get('/api/auth/me')).status, 401);
});

// -------------------------------------------------------------------------
// Applicant: a verified stranger can apply and do nothing else.
// -------------------------------------------------------------------------

test('E4.5: a verified stranger becomes an applicant, not a member', async () => {
  const signedIn = await signIn(alice, 'Alice@Uni.Example');
  assert.strictEqual(signedIn.admission, 'applicant');
  assert.deepStrictEqual(signedIn.principal.roles, []);

  const me = await alice.get('/api/auth/me');
  assert.strictEqual(me.body.admission, 'applicant');
  assert.strictEqual(me.body.principal.email, 'alice@uni.example', 'addresses are compared lower-cased');
  assert.deepStrictEqual(me.body.capabilities, []);
});

test('E4.5: the gate closes routers that only checked "someone is signed in"', async () => {
  // /api/settings holds personal provider keys and launches research plans.
  // Before E4.5 it checked only for a principal, which was safe while signing
  // in required a grant — and would have been open to every applicant now.
  const settings = await alice.get('/api/settings');
  assert.strictEqual(settings.status, 403);
  assert.strictEqual(settings.body.error.code, 'not_admitted');

  for (const url of ['/api/runs', '/api/access/overview', '/api/memory/substances', '/api/auth/principals']) {
    const r = await alice.get(url);
    assert.strictEqual(r.status, 403, `${url} must refuse an applicant`);
  }
  const mutate = await alice.post('/api/runs', { type: 'PIPELINE', config: {} });
  assert.strictEqual(mutate.status, 403);
});

test('E4.5: an applicant can apply once, see the status, and nothing more', async () => {
  const short = await alice.post('/api/auth/application', { reason: 'too short' });
  assert.strictEqual(short.status, 400);

  const submitted = await alice.post('/api/auth/application', {
    reason: 'Co-author of the JMIR 2016 paper; I want to check the replication pipeline.',
    affiliation: 'University', display_name: 'Alice', requested_roles: ['researcher', 'developer'],
  });
  assert.strictEqual(submitted.status, 201, JSON.stringify(submitted.body));
  assert.strictEqual(submitted.body.application.status, 'pending');

  const again = await alice.post('/api/auth/application', { reason: 'A second request with a long enough reason.' });
  assert.strictEqual(again.status, 409, 'one pending application per person');

  const mine = await alice.get('/api/auth/application');
  assert.strictEqual(mine.body.applications.length, 1);
});

// -------------------------------------------------------------------------
// Bootstrap and approval — with immediate effect on an existing session.
// -------------------------------------------------------------------------

test('E4.5: the operator grant from the environment admits the owner as developer', async () => {
  const r = await signIn(owner, OWNER);
  assert.strictEqual(r.admission, 'member');
  const me = await owner.get('/api/auth/me');
  assert.ok(me.body.capabilities.includes('principal.manage'));
  assert.ok(me.body.grantable_roles.includes('developer'));

  const overview = await owner.get('/api/access/overview');
  assert.strictEqual(overview.status, 200);
  const self = overview.body.members.find((m: any) => m.email === OWNER);
  assert.strictEqual(self.sources[0].kind, 'environment');
  assert.strictEqual(self.modifiable, false, 'nobody, including the owner, changes their own access from the UI');
});

test('E4.5: approving an application takes effect on the applicant\'s very next request', async () => {
  const overview = await owner.get('/api/access/overview');
  const pending = overview.body.applications.find((a: any) => a.email === 'alice@uni.example' && a.status === 'pending');
  assert.ok(pending);
  assert.deepStrictEqual(pending.requested_roles, ['researcher', 'developer'], 'requested roles are only a request');

  const approved = await owner.post(`/api/access/applications/${pending.id}/approve`, { roles: ['researcher'], note: 'Welcome.' });
  assert.strictEqual(approved.status, 200, JSON.stringify(approved.body));

  // Same cookie as before — no new sign-in.
  const runs = await alice.get('/api/runs');
  assert.strictEqual(runs.status, 200);
  const me = await alice.get('/api/auth/me');
  assert.strictEqual(me.body.admission, 'member');
  assert.deepStrictEqual(me.body.principal.roles, ['researcher']);
  assert.ok(!me.body.capabilities.includes('principal.view'));
});

// -------------------------------------------------------------------------
// Email-bound invitations: exact address, not transferable, single use.
// -------------------------------------------------------------------------

test('E4.5: an email invitation works only for the invited address, and a forwarded link does not burn it', async () => {
  const created = await owner.post('/api/access/invitations', {
    kind: 'email', email: 'Bob@Uni.Example', roles: ['researcher', 'responder'], note: 'Please test the responder view.',
    link_base: 'http://ignored.example', language: 'en',
  });
  assert.strictEqual(created.status, 201, JSON.stringify(created.body));
  const token: string = created.body.token;
  assert.match(created.body.link, /^http:\/\/localhost:4999\/join#t=/, 'the configured public URL wins over the browser origin');
  assert.match(created.body.draft.body, /bob@uni\.example/);
  assert.strictEqual(created.body.invitation.deliveryStatus, 'draft', 'nothing claims to be sent yet');

  // The token is not in the database in any form an attacker could replay.
  const dbBytes = fs.readFileSync(process.env.DB_PATH!);
  assert.ok(!dbBytes.includes(Buffer.from(token)), 'only a hash of the token is stored');

  const anonPreview = await new Client().post('/api/auth/invitations/preview', { token });
  assert.strictEqual(anonPreview.body.invitation.status, 'valid');
  assert.strictEqual(anonPreview.body.invitation.emailHint.startsWith('b'), true);
  assert.ok(!JSON.stringify(anonPreview.body).includes('bob@uni.example'), 'the preview masks the address');

  // Carol got the link forwarded.
  const carol = new Client();
  await signIn(carol, 'carol@elsewhere.example');
  const stolen = await carol.post('/api/auth/invitations/redeem', { token });
  assert.strictEqual(stolen.status, 403);
  assert.strictEqual(stolen.body.error.code, 'invitation_address_mismatch');
  assert.strictEqual((await carol.get('/api/runs')).status, 403, 'carol gained nothing');

  // …and the invitation is still intact for Bob.
  const bob = new Client();
  await signIn(bob, 'bob@uni.example');
  const accepted = await bob.post('/api/auth/invitations/redeem', { token });
  assert.strictEqual(accepted.status, 200, JSON.stringify(accepted.body));
  assert.deepStrictEqual(accepted.body.roles, ['researcher', 'responder']);
  assert.strictEqual((await bob.get('/api/runs')).status, 200);

  const replay = await bob.post('/api/auth/invitations/redeem', { token });
  assert.strictEqual(replay.body.already_redeemed, true, 'redeeming twice is harmless');
  const late = await carol.post('/api/auth/invitations/redeem', { token });
  assert.strictEqual(late.status, 410, 'a used single-use invitation is gone');
});

test('E4.5: sending an invitation goes through SMTP and only then says "sent"', async () => {
  const created = await owner.post('/api/access/invitations', {
    kind: 'email', email: 'dana@uni.example', roles: ['viewer'], language: 'pl',
  });
  const before = smtp.mails.length;
  const sent = await owner.post(`/api/access/invitations/${created.body.invitation.id}/send`,
    { token: created.body.token, language: 'pl' });
  assert.strictEqual(sent.status, 200, JSON.stringify(sent.body));
  assert.strictEqual(sent.body.invitation.deliveryStatus, 'sent');
  assert.match(sent.body.invitation.deliveryDetail, /Accepted by the mail server/);

  const mail = smtp.mails[before];
  assert.deepStrictEqual(mail.to, ['dana@uni.example']);
  const text = mailText(mail);
  assert.ok(text.includes(created.body.token), 'the link in the message carries the token');
  assert.match(text, /Link jest ważny/, 'the chosen language is used');
  assert.match(mailSubject(mail), /zaprasza Cię do WatchDog/);

  // A stale token (e.g. from before a rotation) cannot be used to send.
  const rotated = await owner.post(`/api/access/invitations/${created.body.invitation.id}/rotate`, {});
  const stale = await owner.post(`/api/access/invitations/${created.body.invitation.id}/send`, { token: created.body.token });
  assert.strictEqual(stale.status, 400);
  const oldPreview = await new Client().post('/api/auth/invitations/preview', { token: created.body.token });
  assert.strictEqual(oldPreview.body.invitation.status, 'unknown', 'a rotated link stops working at once');
  assert.ok(rotated.body.token && rotated.body.token !== created.body.token);
});

// -------------------------------------------------------------------------
// Open links: any address, bounded, never an administrator.
// -------------------------------------------------------------------------

test('E4.5: an open link admits any address up to its use limit, and never grants admin', async () => {
  const barred = await owner.post('/api/access/invitations', { kind: 'open_link', roles: ['admin'] });
  assert.strictEqual(barred.status, 403, 'a transferable link cannot create someone who admits others');

  const created = await owner.post('/api/access/invitations', { kind: 'open_link', roles: ['viewer'], max_uses: 2 });
  assert.strictEqual(created.status, 201);
  const token = created.body.token;

  const dave = new Client(); await signIn(dave, 'dave@anywhere.example');
  const erin = new Client(); await signIn(erin, 'erin@other.example');
  assert.strictEqual((await dave.post('/api/auth/invitations/redeem', { token })).status, 200);
  assert.strictEqual((await erin.post('/api/auth/invitations/redeem', { token })).status, 200);

  const frank = new Client(); await signIn(frank, 'frank@third.example');
  const third = await frank.post('/api/auth/invitations/redeem', { token });
  assert.strictEqual(third.status, 410);
  assert.strictEqual(third.body.error.code, 'invitation_used_up');

  const overview = await owner.get('/api/access/overview');
  const inv = overview.body.invitations.find((i: any) => i.id === created.body.invitation.id);
  assert.deepStrictEqual(inv.redeemedBy.map((r: any) => r.email).sort(), ['dave@anywhere.example', 'erin@other.example'],
    'who actually used a transferable link is recorded');
});

// -------------------------------------------------------------------------
// Delegation without escalation.
// -------------------------------------------------------------------------

test('E4.5: an admin can admit people but never create a developer or touch the owner', async () => {
  const promoted = await owner.post('/api/access/members/roles', { email: 'alice@uni.example', roles: ['admin'] });
  assert.strictEqual(promoted.status, 200, JSON.stringify(promoted.body));

  const me = await alice.get('/api/auth/me');
  assert.ok(me.body.capabilities.includes('access.admit'));
  assert.ok(!me.body.grantable_roles.includes('developer'));

  const escalate = await alice.post('/api/access/invitations', { kind: 'email', email: 'x@y.example', roles: ['developer'] });
  assert.strictEqual(escalate.status, 403);
  const selfPromote = await alice.post('/api/access/members/roles', { email: 'alice@uni.example', roles: ['developer'] });
  assert.strictEqual(selfPromote.status, 403);
  const demoteOwner = await alice.post('/api/access/members/revoke', { email: OWNER });
  assert.strictEqual(demoteOwner.status, 403, 'an admin cannot remove someone holding capabilities they lack');

  const legit = await alice.post('/api/access/invitations', { kind: 'email', email: 'grace@uni.example', roles: ['researcher'] });
  assert.strictEqual(legit.status, 201, 'admitting within one\'s own capabilities works');
  assert.strictEqual((await alice.get('/api/diagnostics/state')).status, 403, 'admin still has no diagnostics');
});

test('E4.5: when an inviter loses the right, their outstanding invitations stop working', async () => {
  const created = await alice.post('/api/access/invitations', { kind: 'open_link', roles: ['researcher'] });
  assert.strictEqual(created.status, 201);
  await owner.post('/api/access/members/roles', { email: 'alice@uni.example', roles: ['researcher'] });

  const preview = await new Client().post('/api/auth/invitations/preview', { token: created.body.token });
  assert.strictEqual(preview.body.invitation.status, 'inviter_no_longer_authorized');
  const heidi = new Client(); await signIn(heidi, 'heidi@lab.example');
  const r = await heidi.post('/api/auth/invitations/redeem', { token: created.body.token });
  assert.strictEqual(r.status, 410);
});

// -------------------------------------------------------------------------
// Immediate revocation, blocking and sign-out everywhere.
// -------------------------------------------------------------------------

test('E4.5: revoking access takes effect on the next request of an existing session', async () => {
  const dave = new Client(); await signIn(dave, 'dave@anywhere.example');
  assert.strictEqual((await dave.get('/api/runs')).status, 200);
  const revoked = await owner.post('/api/access/members/revoke', { email: 'dave@anywhere.example', reason: 'test' });
  assert.strictEqual(revoked.status, 200);
  const after = await dave.get('/api/runs');
  assert.strictEqual(after.status, 403, 'no waiting for a 12-hour cookie to expire');
  assert.strictEqual(after.body.error.code, 'not_admitted');
});

test('E4.5: a blocked person loses their session at once and cannot sign in again', async () => {
  const erin = new Client(); await signIn(erin, 'erin@other.example');
  await owner.post('/api/access/members/revoke', { email: 'erin@other.example', block: true });
  assert.strictEqual((await erin.get('/api/auth/me')).status, 401, 'the old session is dead');

  const start = await erin.post('/api/auth/email/start', { email: 'erin@other.example', language: 'en' });
  assert.strictEqual(start.status, 202);
  const again = await erin.post('/api/auth/email/verify', { email: 'erin@other.example', code: lastCodeFor('erin@other.example') });
  assert.strictEqual(again.status, 403);
  assert.strictEqual(again.body.error.code, 'blocked');
});

test('E4.5: signing out everywhere kills every copy of the session', async () => {
  const phone = new Client(); await signIn(phone, 'bob@uni.example');
  const laptop = new Client(); laptop.cookie = phone.cookie;
  assert.strictEqual((await laptop.get('/api/auth/me')).status, 200);
  await phone.post('/api/auth/signout-everywhere');
  assert.strictEqual((await laptop.get('/api/auth/me')).status, 401);
});

// -------------------------------------------------------------------------
// Codes and requests from other sites.
// -------------------------------------------------------------------------

test('E4.5: a sign-in code is single-use and dies after five wrong guesses', async () => {
  const mallory = new Client();
  await mallory.post('/api/auth/email/start', { email: 'mallory@x.example', language: 'en' });
  const code = lastCodeFor('mallory@x.example');
  for (let i = 0; i < 5; i++) {
    const wrong = await mallory.post('/api/auth/email/verify', { email: 'mallory@x.example', code: 'AAAA-AAAA' });
    assert.strictEqual(wrong.status, 401);
  }
  const late = await mallory.post('/api/auth/email/verify', { email: 'mallory@x.example', code });
  assert.strictEqual(late.status, 401, 'the right code no longer works once the attempts are spent');
  assert.strictEqual(late.body.error.message, 'That code is not correct or has expired. Ask for a new one.',
    'every failure reads the same, so nothing leaks about which part was wrong');

  const trent = new Client();
  await signIn(trent, 'trent@x.example');
  const reuse = await new Client().post('/api/auth/email/verify', { email: 'trent@x.example', code: lastCodeFor('trent@x.example') });
  assert.strictEqual(reuse.status, 401, 'a used code cannot be replayed');
});

test('E4.5: state-changing requests from another site are refused', async () => {
  const r = await owner.post('/api/access/invitations', { kind: 'open_link', roles: ['viewer'] },
    { Origin: 'https://evil.example' });
  assert.strictEqual(r.status, 403);
  assert.strictEqual(r.body.error.code, 'cross_site_request');
  const fetchSite = await owner.post('/api/access/invitations', { kind: 'open_link', roles: ['viewer'] },
    { 'Sec-Fetch-Site': 'cross-site' });
  assert.strictEqual(fetchSite.status, 403);
});

test('E4.5: every admission decision is in the hash-chained audit log', async () => {
  const Database = (await import('better-sqlite3')).default;
  const db = new Database(process.env.DB_PATH!, { readonly: true });
  const actions = new Set((db.prepare("SELECT action FROM audit_events WHERE action LIKE 'access.%'").all() as any[]).map(r => r.action));
  db.close();
  for (const a of ['access.application.submitted', 'access.application.approved', 'access.invitation.created',
    'access.invitation.redeemed', 'access.invitation.sent', 'access.invitation.rotated', 'access.member.roles_set',
    'access.member.revoked', 'access.member.blocked']) {
    assert.ok(actions.has(a), `${a} is audited`);
  }
});
