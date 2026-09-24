import { test } from 'node:test';
import * as assert from 'node:assert';
import Database from 'better-sqlite3';
import { runMigrations } from '../../backend/watchdog_api/db/migrations';
import { AdmissionRepository } from '../../backend/watchdog_api/db/repositories/admission';
import {
  AdmissionService, AdmissionActor, OPERATOR_ACTOR, maskEmail, normalizeEmail, hashSecret,
} from '../../backend/watchdog_api/identity/admission';
import { SignInService, normalizeCode, newCode, CODE_ALPHABET, SIGN_IN_LIMITS } from '../../backend/watchdog_api/identity/sign_in';
import { MailService, loadAccessMessages, fill, MailTransport } from '../../backend/watchdog_api/mail';
import { SecretStore, EnvSecretProvider } from '../../backend/watchdog_api/secrets';
import { clearRegisteredSecrets } from '../../backend/watchdog_api/utils/redaction';
import { RateLimiter } from '../../backend/watchdog_api/api/rate_limit';
import { OPEN_ENDPOINTS } from '../../backend/watchdog_api/api/admission_gate';
import {
  ROLES, RBAC, grantableRoles, openLinkAllowsRole, can, OPEN_LINK_FORBIDDEN_CAPABILITIES,
} from '../../shared/authorization';
import ui from '../../config/access/ui.json';

function harness(start = '2026-09-24T10:00:00.000Z') {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  runMigrations(db);
  let now = new Date(start);
  const events: string[] = [];
  const repo = new AdmissionRepository(db);
  const service = new AdmissionService(repo, { 'owner@lab.example': 'developer' },
    (_actor, action) => { events.push(action); }, () => now);
  const person = (email: string): AdmissionActor => {
    const r = service.signIn({ provider: 'email', subject: email, email, displayName: null })!;
    return { principalId: r.principalId, email, roles: service.effective(email).roles, requestId: 't' };
  };
  return { db, repo, service, events, person, advance: (ms: number) => { now = new Date(now.getTime() + ms); } };
}

const DAY = 86_400_000;

// -------------------------------------------------------------------------
// The authorization profile.
// -------------------------------------------------------------------------

test('E4.5: grantable roles never exceed the granter\'s own capabilities', () => {
  for (const granter of ROLES) {
    const held = new Set(RBAC[granter]);
    for (const r of grantableRoles([granter])) {
      assert.ok(RBAC[r].every(c => held.has(c)), `${granter} could grant ${r}, which exceeds it`);
    }
  }
  assert.deepStrictEqual(grantableRoles(['researcher']), [], 'no access.admit, nothing to grant');
  assert.ok(!grantableRoles(['admin']).includes('developer'));
  assert.ok(grantableRoles(['developer']).includes('developer'));
});

test('E4.5: no open link can confer admitting, principal management or diagnostics', () => {
  for (const r of ROLES.filter(openLinkAllowsRole)) {
    for (const c of OPEN_LINK_FORBIDDEN_CAPABILITIES) assert.ok(!can([r], c), `${r} via open link would carry ${c}`);
  }
  assert.ok(!openLinkAllowsRole('admin'));
  assert.ok(!openLinkAllowsRole('developer'));
  assert.ok(openLinkAllowsRole('researcher'));
  assert.ok(!openLinkAllowsRole('__proto__'));
});

// -------------------------------------------------------------------------
// Expiry, with a controlled clock.
// -------------------------------------------------------------------------

test('E4.5: an invitation stops working when it expires, without anyone touching it', () => {
  const h = harness();
  const { token } = h.service.createInvitation(OPERATOR_ACTOR, { kind: 'open_link', roles: ['viewer'], expiresInDays: 2 });
  assert.strictEqual(h.service.preview(token).status, 'valid');
  h.advance(2 * DAY + 1);
  assert.strictEqual(h.service.preview(token).status, 'expired');
  assert.throws(() => h.service.redeem(h.person('late@x.example'), token), (e: any) => e.code === 'invitation_expired');
});

test('E4.5: access granted with an end date ends on that date', () => {
  const h = harness();
  const accessEnd = new Date(Date.parse('2026-09-24T10:00:00.000Z') + 3 * DAY).toISOString();
  const { token } = h.service.createInvitation(OPERATOR_ACTOR, {
    kind: 'email', email: 'visitor@x.example', roles: ['viewer'], accessExpiresAt: accessEnd });
  h.service.redeem(h.person('visitor@x.example'), token);
  assert.deepStrictEqual(h.service.effective('visitor@x.example').roles, ['viewer']);
  h.advance(3 * DAY + 1);
  assert.deepStrictEqual(h.service.effective('visitor@x.example').roles, [], 'expired access is no access');
});

test('E4.5: invitation limits are enforced', () => {
  const h = harness();
  assert.throws(() => h.service.createInvitation(OPERATOR_ACTOR, { kind: 'open_link', roles: ['viewer'], expiresInDays: 31 }), /1–30 days/);
  assert.throws(() => h.service.createInvitation(OPERATOR_ACTOR, { kind: 'open_link', roles: ['viewer'], maxUses: 51 }), /1–50 times/);
  assert.throws(() => h.service.createInvitation(OPERATOR_ACTOR, { kind: 'email', email: 'nope', roles: ['viewer'] }), /valid email/);
  assert.throws(() => h.service.createInvitation(OPERATOR_ACTOR, { kind: 'email', email: 'a@b.example', roles: [] }), /at least one role/);
  assert.throws(() => h.service.createInvitation(OPERATOR_ACTOR, { kind: 'email', email: 'owner@lab.example', roles: ['viewer'] }),
    /already has access/, 'inviting someone who already has access is a mistake worth catching');
});

// -------------------------------------------------------------------------
// Decisions are atomic.
// -------------------------------------------------------------------------

test('E4.5: approving twice leaves exactly one grant, not a dangling second one', () => {
  const h = harness();
  const applicant = h.person('applicant@x.example');
  const app = h.service.submitApplication(applicant, { reason: 'I would like to review the replication, please.' });
  const owner = h.person('owner@lab.example');
  h.service.approveApplication(owner, app.id, { roles: ['viewer'] });
  assert.throws(() => h.service.approveApplication(owner, app.id, { roles: ['researcher'] }), (e: any) => e.status === 409);
  assert.strictEqual(h.repo.grantHistory('applicant@x.example').length, 1, 'the rolled-back grant did not survive');
  assert.deepStrictEqual(h.service.effective('applicant@x.example').roles, ['viewer']);
});

test('E4.5: accepting an invitation withdraws a pending application instead of leaving it to be approved twice', () => {
  const h = harness();
  const p = h.person('both@x.example');
  const app = h.service.submitApplication(p, { reason: 'Applied first, then got an invitation link.' });
  const { token } = h.service.createInvitation(OPERATOR_ACTOR, { kind: 'email', email: 'both@x.example', roles: ['viewer'] });
  h.service.redeem(p, token);
  assert.strictEqual(h.repo.application(app.id)!.status, 'withdrawn');
});

test('E4.5: the operator actor cannot be forged by a lookalike object', () => {
  const h = harness();
  const lookalike: AdmissionActor = { principalId: 'operator', email: null, roles: ['developer'], requestId: 'cli' };
  assert.throws(() => h.service.createInvitation(lookalike, { kind: 'open_link', roles: ['viewer'] }), (e: any) => e.status === 403,
    'only the frozen OPERATOR_ACTOR object carries operator rights');
});

test('E4.5: every change is audited', () => {
  const h = harness();
  const { invitation } = h.service.createInvitation(OPERATOR_ACTOR, { kind: 'open_link', roles: ['viewer'] });
  h.service.revokeInvitation(OPERATOR_ACTOR, invitation.id);
  h.service.operatorGrant('x@y.example', ['viewer'], null);
  assert.deepStrictEqual(h.events, ['access.invitation.created', 'access.invitation.revoked', 'access.member.operator_grant']);
});

test('E4.5: addresses are normalised and masked consistently', () => {
  assert.strictEqual(normalizeEmail('  Jan.Kowalski@UNI.Lodz.PL '), 'jan.kowalski@uni.lodz.pl');
  assert.throws(() => normalizeEmail('no-at-sign'));
  assert.throws(() => normalizeEmail('a@b'));
  assert.strictEqual(maskEmail('jan@uni.lodz.pl'), 'j••@uni.lodz.pl');
  assert.ok(!maskEmail('jan.kowalski@x.example').includes('kowalski'));
  assert.match(hashSecret('t'), /^[0-9a-f]{64}$/);
});

// -------------------------------------------------------------------------
// Sign-in codes.
// -------------------------------------------------------------------------

test('E4.5: codes avoid confusable characters and normalise however they are typed', () => {
  for (const c of 'IL01O') assert.ok(!CODE_ALPHABET.includes(c));
  const code = newCode();
  assert.strictEqual(code.length, SIGN_IN_LIMITS.codeLength);
  assert.strictEqual(normalizeCode(`${code.slice(0, 4).toLowerCase()} - ${code.slice(4)}`), code);
  assert.strictEqual(normalizeCode('ABCD-EFG'), null, 'too short');
  assert.strictEqual(normalizeCode('ABCD-EFG1'), null, 'contains a character that is never issued');
});

function fakeMail(env: NodeJS.ProcessEnv) {
  const sent: { to: string; text: string }[] = [];
  const transport: MailTransport = { send: async m => { sent.push(m); return { messageId: 'id', accepted: [m.to], rejected: [] }; } };
  const service = new MailService(loadAccessMessages().messages, env, new SecretStore([new EnvSecretProvider(env)]), () => transport);
  return { service, sent };
}

test('E4.5: stored codes are keyed, so a database copy alone cannot check a guess', async () => {
  const h = harness();
  const { service, sent } = fakeMail({ SMTP_URL: 'smtp://127.0.0.1:1', MAIL_FROM: 'x@y.example' });
  const signIn = new SignInService(h.repo, service, 'k'.repeat(40));
  await signIn.startEmailCode('c@x.example', 'en');
  const code = /([A-Z2-9]{4})-([A-Z2-9]{4})/.exec(sent[0].text)!;
  const stored = (h.db.prepare("SELECT secret_hash FROM sign_in_challenges WHERE email = 'c@x.example'").get() as any).secret_hash;
  assert.notStrictEqual(stored, hashSecret(code[1] + code[2]), 'not a plain hash of the code');
  assert.strictEqual(signIn.verifyEmailCode('c@x.example', `${code[1]}${code[2]}`), 'c@x.example');
  clearRegisteredSecrets();
});

test('E4.5: without mail configured, emailed sign-in is unavailable rather than silently not sent', async () => {
  const h = harness();
  const { service } = fakeMail({});
  const a = await service.availability();
  assert.strictEqual(a.available, false);
  assert.match(a.remediation, /SMTP_URL/);
  const signIn = new SignInService(h.repo, service, 'k'.repeat(40));
  await assert.rejects(() => signIn.startEmailCode('c@x.example'), (e: any) => e.code === 'method_unavailable');
});

test('E4.5: emailed links come only from the configured public URL, and only https (or localhost)', () => {
  const m = (url?: string) => new MailService(loadAccessMessages().messages, { WATCHDOG_PUBLIC_URL: url } as any);
  assert.strictEqual(m('https://watchdog.example.org/').publicUrl(), 'https://watchdog.example.org');
  assert.strictEqual(m('http://watchdog.example.org').publicUrl(), null, 'plain http on a public host would expose the code');
  assert.strictEqual(m('http://localhost:8080').publicUrl(), 'http://localhost:8080');
  assert.strictEqual(m('not a url').publicUrl(), null);
  assert.strictEqual(m(undefined).publicUrl(), null);
});

test('E4.5: message templates fill every placeholder in both languages', () => {
  const { service } = fakeMail({});
  for (const language of ['pl', 'en']) {
    for (const kind of ['email', 'open_link'] as const) {
      const draft = service.invitationDraft({ kind, email: kind === 'email' ? 'a@b.example' : null, roles: ['researcher'],
        note: 'Hi', inviter: 'Owner', link: 'https://w.example/join#t=abc', expiresAt: '2026-10-01T10:00:00Z', maxUses: 3, language });
      assert.ok(!/\{\{/.test(draft.subject + draft.body), `${language}/${kind} left a placeholder: ${draft.body}`);
      assert.ok(draft.body.includes('https://w.example/join#t=abc'));
    }
    const code = service.signInCodeMessage({ to: 'a@b.example', code: 'ABCD-EFGH', minutes: 10, link: null, language });
    assert.ok(!/\{\{/.test(code.subject + code.text));
  }
  assert.strictEqual(fill('{{a}} {{missing}}', { a: 'x' }), 'x {{missing}}', 'an unknown placeholder stays visible');
});

test('E4.5: the UI label file has the same keys in every language', () => {
  const [first, ...rest] = Object.values(ui.languages).map(l => Object.keys(l).sort());
  for (const keys of rest) assert.deepStrictEqual(keys, first);
  for (const role of ROLES) assert.ok(`role_${role}` in ui.languages.en, `a label for ${role}`);
});

// -------------------------------------------------------------------------
// Gate and limiter.
// -------------------------------------------------------------------------

test('E4.5: the open endpoints are exactly the sign-in and application surface', () => {
  for (const e of OPEN_ENDPOINTS) {
    assert.match(e, /^(GET|POST) \/auth\//, `${e} is outside /auth and must not be open`);
    assert.ok(!/principals|access|settings|diagnostics/.test(e), `${e} must not be open`);
  }
});

test('E4.5: the rate limiter allows a burst up to its limit and then refuses until the window passes', () => {
  let t = 0;
  const limiter = new RateLimiter(3, 1000, () => t);
  assert.deepStrictEqual([1, 2, 3, 4].map(() => limiter.hit('ip')), [true, true, true, false]);
  assert.strictEqual(limiter.hit('other-ip'), true, 'limits are per key');
  t = 1001;
  assert.strictEqual(limiter.hit('ip'), true);
});
