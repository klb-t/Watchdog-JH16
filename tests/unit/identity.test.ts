import { test } from 'node:test';
import * as assert from 'node:assert';
import Database from 'better-sqlite3';
import { generateKeyPairSync, createSign, randomBytes } from 'node:crypto';
import {
  ROLES, RBAC, CAPABILITIES, can, capabilitiesFor,
  ForbiddenError, UnauthenticatedError,
} from '../../backend/watchdog_api/identity/roles';
import {
  GoogleOidcVerifier, JwksCache, SessionCodec, TokenRejectedError, JwksTransport,
  OidcIdentityProvider, sessionCookieHeader,
} from '../../backend/watchdog_api/identity/oidc';
import {
  parseGrants, readAuthConfig, assertAuthSafeForEnvironment, AuthConfigError, buildIdentity, authorize,
} from '../../backend/watchdog_api/identity';
import { PrincipalRepository, ownedTables } from '../../backend/watchdog_api/db/repositories/principals';
import { runMigrations } from '../../backend/watchdog_api/db/migrations';
import { SecretStore, EnvSecretProvider } from '../../backend/watchdog_api/secrets';
import { clearRegisteredSecrets } from '../../backend/watchdog_api/utils/redaction';

// -------------------------------------------------------------------------
// The RBAC matrix.
// -------------------------------------------------------------------------

test('E4.2: every role has an explicit capability bundle; researcher and responder are peers', () => {
  for (const role of ROLES) {
    for (const capability of RBAC[role]) assert.ok(CAPABILITIES.includes(capability));
  }
  assert.ok(can(['researcher'], 'method.approve'));
  assert.ok(!can(['researcher'], 'responder.lookup'));
  assert.ok(can(['responder'], 'responder.lookup'));
  assert.ok(!can(['responder'], 'method.approve'));
  for (const role of ['institutional', 'law_enforcement']) {
    assert.ok(can([role], 'responder.lookup'));
    for (const forbidden of ['run.view', 'evidence.approve', 'diagnostics.view', 'principal.manage'] as const)
      assert.ok(!can([role], forbidden));
  }
  assert.ok(!can(['admin'], 'principal.manage'));
  assert.ok(can(['admin'], 'principal.view'));
  assert.deepStrictEqual(capabilitiesFor(['developer']), [...CAPABILITIES]);
  assert.deepStrictEqual(capabilitiesFor(['dev']), capabilitiesFor(['developer']));
  const union = capabilitiesFor(['researcher', 'responder']);
  assert.ok(union.includes('responder.lookup') && union.includes('method.approve'));
  assert.deepStrictEqual(union, capabilitiesFor(['responder', 'researcher', 'researcher']));
});

test('E4.1: the specific separations the ladder exists for', () => {
  assert.ok(!can(['viewer'], 'run.create'), 'a viewer must not start runs');
  assert.ok(!can(['viewer'], 'method.approve'));
  assert.ok(!can(['researcher'], 'provider.approve'),
    'adopting a vendor changes the measuring instrument for the whole installation');
  assert.ok(!can(['admin'], 'diagnostics.view'),
    'the diagnostics surface can expose payloads and configuration');
  assert.ok(can(['dev'], 'diagnostics.bundle'));
  assert.ok(can(['researcher'], 'method.approve'));
});

test('E4.1: authorisation fails closed on unknown or absent roles', () => {
  assert.ok(!can([], 'run.view'));
  assert.ok(!can(['reseacher'], 'run.view'), 'a typo must remove access, never grant a default');
  assert.ok(!can(['admin '], 'run.view'));
  assert.deepStrictEqual(capabilitiesFor(['nonsense', '__proto__', 'constructor']), []);

  assert.throws(() => authorize(null, 'run.view'), UnauthenticatedError);
  assert.throws(() => authorize(
    { id: 'x', email: null, roles: ['viewer'], identityProvenance: 't' }, 'run.create'), ForbiddenError);
});

// -------------------------------------------------------------------------
// Token verification, against a real RSA signature.
// -------------------------------------------------------------------------

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const JWK = { ...publicKey.export({ format: 'jwk' }) as any, kid: 'test-kid', alg: 'RS256', use: 'sig' };
const AUD = '1234.apps.googleusercontent.com';
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o), 'utf-8').toString('base64url');

function mintToken(claims: Record<string, unknown>, header: Record<string, unknown> = {}): string {
  const h = b64({ alg: 'RS256', kid: 'test-kid', typ: 'JWT', ...header });
  const p = b64({
    iss: 'https://accounts.google.com', aud: AUD, sub: 'google-subject-1',
    email: 'researcher@lab.example', email_verified: true, name: 'A Researcher',
    iat: Math.floor(Date.now() / 1000) - 10, exp: Math.floor(Date.now() / 1000) + 3600,
    ...claims,
  });
  const sig = createSign('RSA-SHA256').update(`${h}.${p}`).sign(privateKey).toString('base64url');
  return `${h}.${p}.${sig}`;
}

const jwksTransport = (keys: unknown[] = [JWK]): JwksTransport =>
  async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ keys }) });

const verifier = (grants: Record<string, any> = { 'researcher@lab.example': 'researcher' },
                  transport: JwksTransport = jwksTransport()) =>
  new GoogleOidcVerifier({ audience: AUD, grants }, new JwksCache(transport, 'https://jwks.test'));

test('E4.1: a well-formed Google token verifies and lands on its granted role', async () => {
  const v = await verifier().verify(mintToken({}));
  assert.strictEqual(v.subject, 'google-subject-1');
  assert.strictEqual(v.email, 'researcher@lab.example');
  assert.strictEqual(v.role, 'researcher');
});

test('E4.1: the classic JWT bypasses are refused', async () => {
  // alg:none — the signature is simply absent.
  const [h, p] = mintToken({}).split('.');
  const none = `${b64({ alg: 'none', kid: 'test-kid' })}.${p}.`;
  await assert.rejects(() => verifier().verify(none), TokenRejectedError);

  // HMAC confusion — an attacker-chosen alg must not select the algorithm.
  await assert.rejects(() => verifier().verify(mintToken({}, { alg: 'HS256' })),
    (e: any) => /unsupported alg/.test(e.message));

  // A tampered payload under a valid signature.
  const parts = mintToken({}).split('.');
  const tampered = `${parts[0]}.${b64({ ...JSON.parse(Buffer.from(parts[1], 'base64url').toString()), email: 'attacker@evil.example' })}.${parts[2]}`;
  await assert.rejects(() => verifier().verify(tampered), (e: any) => /signature does not verify/.test(e.message));

  await assert.rejects(() => verifier().verify('not.a.jwt'), TokenRejectedError);
  await assert.rejects(() => verifier().verify('onlyonepart'), TokenRejectedError);
});

test('E4.1: claims that would widen access are each checked', async () => {
  const cases: Array<[string, Record<string, unknown>, RegExp]> = [
    ['another application\'s token', { aud: 'someone-else.apps.googleusercontent.com' }, /audience/],
    ['a non-Google issuer', { iss: 'https://evil.example' }, /issuer/],
    ['an expired token', { exp: Math.floor(Date.now() / 1000) - 3600 }, /expired/],
    ['an unverified address', { email_verified: false }, /not verified/],
    ['no address at all', { email: undefined }, /no email|carries no email/],
    ['an ungranted address', { email: 'stranger@elsewhere.example' }, /no grant exists/],
  ];
  for (const [label, claims, pattern] of cases) {
    await assert.rejects(() => verifier().verify(mintToken(claims)), pattern, label);
  }
});

test('E4.1: a domain grant applies, and an exact grant wins over it', async () => {
  const v = verifier({ '@lab.example': 'viewer', 'researcher@lab.example': 'admin' });
  assert.strictEqual((await v.verify(mintToken({}))).role, 'admin');
  assert.strictEqual((await v.verify(mintToken({ email: 'other@lab.example' }))).role, 'viewer');
  await assert.rejects(() => v.verify(mintToken({ email: 'x@notlab.example' })), /no grant/);
});

test('E4.1: an unknown kid refreshes the key set once, then rejects', async () => {
  let calls = 0;
  const transport: JwksTransport = async () => {
    calls++;
    return { ok: true, status: 200, text: async () => JSON.stringify({ keys: [JWK] }) };
  };
  await assert.rejects(
    () => verifier({ 'researcher@lab.example': 'researcher' }, transport)
      .verify(mintToken({}, { kid: 'rotated-away' })),
    /no signing key matches/);
  assert.strictEqual(calls, 2, 'exactly one refresh — an attacker-chosen kid must not become a request amplifier');
});

// -------------------------------------------------------------------------
// Sessions.
// -------------------------------------------------------------------------

const KEY = randomBytes(32).toString('hex');

test('E4.1: a session cookie round-trips and rejects every tampering', () => {
  const codec = new SessionCodec(KEY);
  const payload = { sub: 's1', email: 'a@b.example', role: 'researcher' as const, exp: Date.now() + 60_000 };
  const cookie = codec.sign(payload);

  assert.deepStrictEqual(codec.verify(cookie), payload);
  assert.strictEqual(codec.verify(undefined), null);
  assert.strictEqual(codec.verify('garbage'), null);
  assert.strictEqual(codec.verify(`${cookie}x`), null, 'a mutated signature must not verify');

  // Re-signed with a different key: the classic "I made my own cookie" attempt.
  assert.strictEqual(codec.verify(new SessionCodec(randomBytes(32).toString('hex')).sign(
    { ...payload, role: 'dev' })), null);

  // Payload edited to escalate, signature left alone.
  const body = Buffer.from(JSON.stringify({ ...payload, role: 'dev' }), 'utf-8').toString('base64url');
  assert.strictEqual(codec.verify(`${body}.${cookie.split('.')[1]}`), null);

  // Expiry is enforced on read, not merely set on the cookie.
  assert.strictEqual(codec.verify(codec.sign({ ...payload, exp: Date.now() - 1 })), null);
});

test('E4.1: a short signing key is refused outright', () => {
  assert.throws(() => new SessionCodec('too-short'), /at least 32/);
});

test('E4.1: the cookie is HttpOnly and SameSite, and Secure in production', () => {
  const prod = sessionCookieHeader('v', 3600, true);
  assert.match(prod, /HttpOnly/);
  assert.match(prod, /SameSite=Lax/);
  assert.match(prod, /Secure/);
  assert.ok(!sessionCookieHeader('v', 3600, false).includes('Secure'), 'local http development must still work');
});

test('E4.1: an unauthenticated request resolves to null, never to a guest principal', async () => {
  const provider = new OidcIdentityProvider(new SessionCodec(KEY));
  assert.strictEqual(await provider.resolveOrNull({ headers: {} }), null);
  assert.strictEqual(await provider.resolveOrNull({ headers: { cookie: 'watchdog_session=forged' } }), null);

  const cookie = new SessionCodec(KEY).sign(
    { sub: 's1', email: 'a@b.example', role: 'admin', exp: Date.now() + 60_000 });
  const p = await provider.resolveOrNull({ headers: { cookie: `other=1; watchdog_session=${cookie}` } });
  assert.strictEqual(p!.id, 'google:s1');
  assert.deepStrictEqual(p!.roles, ['admin']);
});

// -------------------------------------------------------------------------
// Configuration, and the startup gate.
// -------------------------------------------------------------------------

test('E4.1: grants are validated, and there is no wildcard', () => {
  assert.deepStrictEqual(parseGrants('{"A@B.example":"admin"}'), { 'a@b.example': 'admin' });
  assert.deepStrictEqual(parseGrants(undefined), {});

  assert.throws(() => parseGrants('not json'), AuthConfigError);
  assert.throws(() => parseGrants('{"a@b.example":"superuser"}'), /not a role/);
  assert.throws(() => parseGrants('{"*":"admin"}'), /everyone/);
  assert.throws(() => parseGrants('{"admin":"admin"}'), /neither an email address nor an @domain/);
});

test('E4.1: an OAuth client with no grants is refused rather than defaulted', () => {
  assert.throws(() => readAuthConfig({ GOOGLE_OAUTH_CLIENT_ID: AUD } as any), /nobody could sign in/);
  assert.strictEqual(readAuthConfig({} as any).mode, 'local');
  assert.strictEqual(readAuthConfig({
    GOOGLE_OAUTH_CLIENT_ID: AUD, WATCHDOG_GRANTS: '{"a@b.example":"admin"}',
  } as any).mode, 'oidc');
});

test('E4.1: production refuses to start without authentication unless it is stated on purpose', () => {
  const local = readAuthConfig({} as any);

  assert.doesNotThrow(() => assertAuthSafeForEnvironment(local, {} as any),
    'local development must not require an OAuth client');

  assert.throws(() => assertAuthSafeForEnvironment(local, { NODE_ENV: 'production' } as any),
    /Refusing to start/,
    'an open instance must not be reachable by forgetting a variable');

  assert.doesNotThrow(() => assertAuthSafeForEnvironment(local, {
    NODE_ENV: 'production', WATCHDOG_ALLOW_OPEN_INSTANCE: 'true',
  } as any), 'a deliberately public demo stays possible, but has to be typed out');

  const oidc = readAuthConfig({ GOOGLE_OAUTH_CLIENT_ID: AUD, WATCHDOG_GRANTS: '{"a@b.example":"admin"}' } as any);
  assert.doesNotThrow(() => assertAuthSafeForEnvironment(oidc, { NODE_ENV: 'production' } as any));
});

test('E4.1: oidc mode without a signing key fails with the command that fixes it', async () => {
  await assert.rejects(() => buildIdentity(
    { GOOGLE_OAUTH_CLIENT_ID: AUD, WATCHDOG_GRANTS: '{"a@b.example":"admin"}' } as any,
    new SecretStore([new EnvSecretProvider({})]), jwksTransport()),
    /SESSION_SIGNING_KEY.*randomBytes/s);
});

test('E4.1: local mode keeps E1 behaviour — one principal, full capability', async () => {
  const identity = await buildIdentity({} as any, new SecretStore([new EnvSecretProvider({})]), jwksTransport());
  assert.strictEqual(identity.mode, 'local');
  const p = await identity.resolve({ headers: {} });
  assert.strictEqual(p!.id, 'local-user');
  assert.ok(can(p!.roles, 'diagnostics.view'));
  clearRegisteredSecrets();
});

// -------------------------------------------------------------------------
// Migrating E1's local-user rows.
// -------------------------------------------------------------------------

function freshDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  runMigrations(sqlite);
  return sqlite;
}

test('E4.1: local-user exists as a principal so no E1 row is left dangling', () => {
  const repo = new PrincipalRepository(freshDb());
  const local = repo.get('local-user');
  assert.ok(local, 'every E1 row references local-user; it must have a referent');
  assert.strictEqual(local!.role, 'dev');
});

test('E4.1: local-user rows migrate to a real principal, atomically and idempotently', () => {
  const sqlite = freshDb();
  const repo = new PrincipalRepository(sqlite);
  const now = '2026-08-19T12:00:00.000Z';

  sqlite.prepare(`INSERT INTO runs (id, run_type, status, owner_principal_id, visibility, created_at)
                  VALUES ('r1', 'PIPELINE', 'COMPLETED', 'local-user', 'private', ?)`).run(now);
  sqlite.prepare(`INSERT INTO series (id, metric_key, owner_principal_id, visibility, created_at)
                  VALUES ('s1', 'Ni', 'local-user', 'private', ?)`).run(now);

  repo.upsertOnSignIn({ id: 'google:s1', email: 'me@lab.example', displayName: 'Me',
    role: 'admin', identityProvenance: 'google-oidc', at: now });

  assert.strictEqual(repo.countOwnedBy('local-user'), 2);
  const moved = repo.migrateLocalUserRows('google:s1');

  assert.strictEqual(moved.runs, 1);
  assert.strictEqual(moved.series, 1);
  assert.strictEqual(repo.countOwnedBy('google:s1'), 2, 'the rows resolve to the migrated owner');
  assert.strictEqual(repo.countOwnedBy('local-user'), 0);
  assert.deepStrictEqual(Object.keys(moved).sort(), ownedTables(sqlite).sort(),
    'every owning table is covered, or ownership ends up split');
  assert.ok(ownedTables(sqlite).includes('runs') && ownedTables(sqlite).includes('artifacts'));

  const second = repo.migrateLocalUserRows('google:s1');
  assert.ok(Object.values(second).every(n => n === 0), 'a second migration moves nothing');

  assert.ok(repo.get('local-user'), 'local-user is kept, so an old run still explains what it was');
});

test('E4.1: migration refuses an unknown target', () => {
  const repo = new PrincipalRepository(freshDb());
  assert.throws(() => repo.migrateLocalUserRows('google:nobody'), /unknown principal/);
  assert.throws(() => repo.migrateLocalUserRows('local-user'), /onto itself/);
});

test('E4.1: signing in again preserves created_at and refreshes the role', () => {
  const repo = new PrincipalRepository(freshDb());
  repo.upsertOnSignIn({ id: 'google:s1', email: 'me@lab.example', displayName: 'Me',
    role: 'viewer', identityProvenance: 'google-oidc', at: '2026-01-01T00:00:00.000Z' });
  repo.upsertOnSignIn({ id: 'google:s1', email: 'me@lab.example', displayName: 'Me',
    role: 'admin', identityProvenance: 'google-oidc', at: '2026-08-19T00:00:00.000Z' });

  const p = repo.get('google:s1')!;
  assert.strictEqual(p.created_at, '2026-01-01T00:00:00.000Z');
  assert.strictEqual(p.last_seen_at, '2026-08-19T00:00:00.000Z');
  assert.strictEqual(p.role, 'admin');
});
