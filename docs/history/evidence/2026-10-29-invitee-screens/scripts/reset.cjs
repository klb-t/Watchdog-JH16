// Return MY COPY of the owner's data to its pre-accounts state: remove what an
// earlier access test (2026-10-29, ~12:45-12:56 UTC) added on top of the backup.
// Runs only against the scratch copy next to this script.
const Database = require('/home/kielbowicz_marcin/Watchdog-JH16/node_modules/better-sqlite3');
const db = new Database(__dirname + '/data/watchdog/watchdog.sqlite');
const triggers = db.prepare("select name, sql from sqlite_master where type='trigger' and tbl_name in ('audit_events','run_shares','invitation_redemptions','access_applications','sign_in_challenges','admission_grants','invitations','principal_identities','principal_roles','principals')").all();
db.transaction(() => {
  for (const t of triggers) db.exec(`drop trigger "${t.name}"`);
  for (const t of ['run_shares', 'invitation_redemptions', 'access_applications', 'sign_in_challenges', 'admission_grants', 'invitations'])
    console.log(t, db.prepare(`delete from "${t}"`).run().changes);
  console.log('identities', db.prepare("delete from principal_identities").run().changes);
  console.log('principal_roles(non-local)', db.prepare("delete from principal_roles where principal_id <> 'local-user'").run().changes);
  console.log('principals', db.prepare("delete from principals where id <> 'local-user'").run().changes);
  console.log('local-user', db.prepare("update principals set email = null, last_seen_at = null where id = 'local-user'").run().changes);
  console.log('audit', db.prepare("delete from audit_events where timestamp >= '2026-10-29'").run().changes);
  for (const t of triggers) db.exec(t.sql);
})();
