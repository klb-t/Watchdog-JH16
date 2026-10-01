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
  assert.deepEqual(runMigrations(db).applied,['023_accounts']);
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
