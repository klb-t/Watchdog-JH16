import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { MIGRATIONS, runMigrations } from '../../backend/watchdog_api/db/migrations';
import { PrincipalRepository } from '../../backend/watchdog_api/db/repositories/principals';
import { AdmissionRepository } from '../../backend/watchdog_api/db/repositories/admission';
import { AdmissionService, OPERATOR_ACTOR } from '../../backend/watchdog_api/identity/admission';
import { sessionLookup } from '../../backend/watchdog_api/identity/accounts_identity';
import { can, grantableRoles } from '../../shared/authorization';

test('E4.7: populated 022 upgrade retains ownership, request-only tokens and live grant overrides', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys=ON');
  const at = '2026-10-01T00:00:00.000Z';
  db.exec('CREATE TABLE schema_migrations(id TEXT PRIMARY KEY,applied_at TEXT NOT NULL)');
  for (const m of MIGRATIONS.filter(m=>m.id<'023')) {
    db.exec(m.sql); db.prepare('INSERT INTO schema_migrations VALUES (?,?)').run(m.id,at);
  }
  const old = new PrincipalRepository(db);
  old.recordIdentity({id:'google:existing',email:'existing@lab.example',displayName:'Existing',at});
  old.recordIdentity({id:'google:revoked',email:'revoked@lab.example',displayName:null,at});
  old.setGrant('existing@lab.example',['researcher'],true,'local-user',at);
  old.setGrant('revoked@lab.example',[],false,'local-user',at);
  old.submitRequest('google:existing','existing@lab.example','Historical request remains evidence',at);
  const invite = old.createInvitation('existing@lab.example','Original request only','local-user',at,'2026-10-07T00:00:00.000Z');
  db.prepare('INSERT INTO research_projects VALUES (?,?,?,?,?,?)').run('project','google:existing',at,'revision','hash',at);
  db.prepare('INSERT INTO research_project_revisions VALUES (?,?,?,?,?,?,?)').run('revision','project','google:existing',1,'hash','{"title":"retained"}',at);
  const tables = ['installation_grants','admission_requests','admission_invitations','admission_events','research_projects','research_project_revisions'];
  const before = tables.map(t=>db.prepare(`SELECT * FROM ${t}`).all());
  // 023 and every later migration apply on top of a populated 022 database, each exactly once.
  assert.deepEqual(runMigrations(db).applied,MIGRATIONS.filter(m=>m.id>='023').map(m=>m.id));
  assert.deepEqual(runMigrations(db).applied,[]);
  assert.deepEqual(tables.map(t=>db.prepare(`SELECT * FROM ${t}`).all()),before);
  const repo = new AdmissionRepository(db);
  const service = new AdmissionService(repo,{'existing@lab.example':'developer','revoked@lab.example':'developer'},()=>{},()=>new Date(at));
  assert.deepEqual(service.effective('existing@lab.example').roles,['researcher'],'legacy override does not expand to environment developer');
  assert.deepEqual(service.effective('revoked@lab.example').roles,[],'legacy revocation still overrides bootstrap');
  const linked = service.signIn({provider:'email',subject:'existing@lab.example',email:'existing@lab.example',displayName:null})!;
  assert.equal(linked.principalId,'google:existing');
  assert.equal(repo.identity('google','existing')?.principal_id,linked.principalId);
  const lookup = sessionLookup({repository:repo,service});
  assert.deepEqual(lookup(linked.principalId,linked.sessionVersion)?.roles,['researcher']);
  old.acceptInvitation(invite.token,linked.principalId,'existing@lab.example',at);
  assert.equal(old.requestFor(linked.principalId)?.status,'pending');
  assert.equal(repo.activeGrants('existing@lab.example',at).length,0,'legacy token never creates a role grant');
  assert.throws(()=>old.acceptInvitation(invite.token,linked.principalId,'existing@lab.example',at));
  old.setGrant('existing@lab.example',[],false,'local-user',at);
  assert.equal(lookup(linked.principalId,linked.sessionVersion),null,'revocation invalidates the existing accounts session');
  assert.equal(old.countOwnedBy(linked.principalId),2);
  assert.throws(()=>service.setRoles(OPERATOR_ACTOR,'existing@lab.example',{roles:['developer']}),/legacy/i);
  assert.throws(()=>service.operatorGrant('existing@lab.example',['developer'],null),/legacy installation override/);
  assert.equal(repo.activeGrants('existing@lab.example',at).length,0,'CLI must not report success for a grant suppressed by a legacy revocation');
  db.close();
});

test('E4.7: existing admin does not silently acquire bounded delegation', () => {
  assert.equal(can(['admin'],'access.admit'),false);
  assert.equal(can(['admin'],'principal.invite'),true);
  assert.deepEqual(grantableRoles(['admin']),[]);
  assert.equal(can(['access_admin'],'access.admit'),true);
  assert.equal(grantableRoles(['access_admin']).includes('developer'),false);
});

for (const active of [false, true]) {
  for (const operation of ['redeem', 'approve'] as const) {
  test(`E4.7: ${active ? 'active' : 'revoked'} legacy override refuses ${operation} without consuming evidence`, () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys=ON');
    runMigrations(db);
    try {
      const at = '2026-10-02T10:00:00.000Z';
      const email = 'legacy@lab.example';
      const old = new PrincipalRepository(db);
      const repo = new AdmissionRepository(db);
      const service = new AdmissionService(repo, {}, () => {}, () => new Date(at));
      // A legacy denial can predate the first sign-in. In that case the new
      // principal is active, but its effective installation access is denied.
      if (!active) old.setGrant(email, [], false, 'local-user', at);
      const signedIn = service.signIn({ provider: 'email', subject: email, email, displayName: null })!;
      assert.ok(signedIn);
      const actor = { principalId: signedIn.principalId, email, roles: [], requestId: 'legacy-regression' };
      const application = service.submitApplication(actor, { reason: 'Please review access to this synthetic installation.' });
      const { invitation, token } = service.createInvitation(OPERATOR_ACTOR,
        { kind: 'open_link', roles: ['researcher'], maxUses: 1 });
      // An administrator can establish an active legacy override while an
      // accounts application is already pending. It remains the authority.
      if (active) old.setGrant(email, ['viewer'], true, 'local-user', at);
      const snapshot = () => ({
        legacy: old.grant(email), invitation: repo.invitation(invitation.id),
        application: repo.application(application.id), grants: repo.grantHistory(email),
        redemption: repo.redemption(invitation.id, actor.principalId),
        roles: db.prepare('SELECT * FROM principal_roles WHERE principal_id=? ORDER BY role_id').all(actor.principalId),
      });
      const before = snapshot();
      const legacyConflict = (error: any) => error.code === 'legacy_override' && error.status === 409;
      if (operation === 'redeem') {
        assert.throws(() => service.redeem(actor, token), legacyConflict);
      } else {
        assert.throws(() => service.approveApplication(OPERATOR_ACTOR, application.id,
          { roles: ['researcher'] }), legacyConflict);
      }
      assert.deepEqual(snapshot(), before, 'refused decision must not consume a use, alter an application or add a grant');
      assert.equal(repo.application(application.id)?.status, 'pending');
      assert.equal(repo.invitation(invitation.id)?.uses, 0);
      assert.deepEqual(service.effective(email).roles, active ? ['viewer'] : []);
    } finally {
      db.close();
    }
  });
  }
}

for (const operation of ['redeem', 'approve', 'operatorGrant'] as const) {
  test(`E4.7: legacy override committed after preflight blocks ${operation} before grant mutations`, () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys=ON');
    runMigrations(db);
    try {
      const at = '2026-10-02T10:00:00.000Z';
      const email = 'concurrent@lab.example';
      const old = new PrincipalRepository(db);
      const repo = new AdmissionRepository(db);
      const service = new AdmissionService(repo, {}, () => {}, () => new Date(at));
      const signedIn = service.signIn({ provider: 'email', subject: email, email, displayName: null })!;
      const actor = { principalId: signedIn.principalId, email, roles: [], requestId: 'interleaving-regression' };
      const application = service.submitApplication(actor, { reason: 'Please review access for this synthetic interleaving.' });
      const { invitation, token } = service.createInvitation(OPERATOR_ACTOR,
        { kind: 'open_link', roles: ['researcher'], maxUses: 1 });
      if (operation === 'operatorGrant') service.operatorGrant(email, ['viewer'], 'Existing grant must not be revoked.');
      const snapshot = () => ({
        legacy: old.grant(email), invitation: repo.invitation(invitation.id),
        application: repo.application(application.id), grants: repo.grantHistory(email),
        redemption: repo.redemption(invitation.id, actor.principalId),
        roles: db.prepare('SELECT * FROM principal_roles WHERE principal_id=? ORDER BY role_id').all(actor.principalId),
      });
      const transact = repo.transaction.bind(repo);
      let interleavings = 0;
      let afterLegacy: ReturnType<typeof snapshot> | undefined;
      // Deterministically model another connection committing after preflight
      // but before this decision acquires its transaction snapshot.
      repo.transaction = <T>(fn: () => T): T => {
        interleavings++;
        old.setGrant(email, [], false, 'local-user', at);
        afterLegacy = snapshot();
        return transact(fn);
      };
      const decide = () => operation === 'redeem' ? service.redeem(actor, token)
        : operation === 'approve' ? service.approveApplication(OPERATOR_ACTOR, application.id, { roles: ['researcher'] })
        : service.operatorGrant(email, ['researcher'], null);
      assert.throws(decide, (error: any) => error.code === 'legacy_override' && error.status === 409);
      assert.equal(interleavings, 1, 'preflight passed before the competing legacy update');
      assert.deepEqual(snapshot(), afterLegacy, 'only the competing legacy update may survive');
      assert.equal(repo.invitation(invitation.id)?.uses, 0);
      assert.equal(repo.application(application.id)?.status, 'pending');
    } finally {
      db.close();
    }
  });
}
