/**
 * E3.5 portability probe: applies every WatchDog migration, translated by
 * backend/watchdog_api/db/postgres_dialect.ts, to a real PostgreSQL server and
 * checks that the WORM triggers still refuse updates. Prints a JSON report.
 *
 *   PGURL=postgres://user:pass@127.0.0.1:55432/db npx tsx scripts/pg_portability_probe.ts
 *
 * Use a disposable database: the probe creates the whole schema in it.
 */
import pg from 'pg';
const { Client } = pg;
import { MIGRATIONS } from '../backend/watchdog_api/db/migrations';
import { splitStatements, translateStatement } from '../backend/watchdog_api/db/postgres_dialect';

async function main() {
  const client = new Client({ connectionString: process.env.PGURL });
  await client.connect();
  const server = (await client.query('select version()')).rows[0].version as string;
  const report: any[] = [];
  await client.query('BEGIN');
  for (const m of MIGRATIONS) {
    const result = { id: m.id, statements: 0, applied: 0, failed: [] as { sql: string; error: string }[], manual: [] as string[], rules: new Set<string>() };
    for (const stmt of splitStatements(m.sql)) {
      const t = translateStatement(stmt); result.statements++;
      t.rules.forEach(r => result.rules.add(r.replace(/wd_trg_\w+/, 'wd_trg_*')));
      if (t.manual) { result.manual.push(t.manual); continue; }
      for (const sql of t.postgres) {
        try { await client.query('SAVEPOINT s'); await client.query(sql); await client.query('RELEASE SAVEPOINT s'); result.applied++; }
        catch (e) { await client.query('ROLLBACK TO SAVEPOINT s').catch(() => {}); result.failed.push({ sql: sql.slice(0, 240), error: (e as Error).message }); }
      }
    }
    report.push({ ...result, rules: [...result.rules].sort() });
  }
  // A ported WORM trigger must still refuse an update of a retained record.
  const worm = await (async () => {
    try {
      await client.query(`INSERT INTO study_protocols(id,owner_principal_id,target_id,body_json,content_hash,frozen_at) VALUES ('probe','p','t','{}','h','2026-10-26T00:00:00Z')`);
      await client.query('SAVEPOINT w');
      try { await client.query(`UPDATE study_protocols SET body_json='{"x":1}' WHERE id='probe'`); return { table: 'study_protocols', update_refused: false }; }
      catch (e) { await client.query('ROLLBACK TO SAVEPOINT w'); return { table: 'study_protocols', update_refused: true, error: (e as Error).message }; }
    } catch (e) { return { table: 'study_protocols', update_refused: null, error: (e as Error).message }; }
  })();
  const tables = Number((await client.query(`select count(*) from information_schema.tables where table_schema='public'`)).rows[0].count);
  const triggers = Number((await client.query(`select count(distinct trigger_name) from information_schema.triggers`)).rows[0].count);
  await client.query('ROLLBACK'); // the probe leaves the database empty
  await client.end();
  const total = report.reduce((a, r) => ({ s: a.s + r.statements, ok: a.ok + r.applied, f: a.f + r.failed.length, m: a.m + r.manual.length }), { s: 0, ok: 0, f: 0, m: 0 });
  console.log(JSON.stringify({ server, migrations: report.length, statements: total.s, applied_postgres_statements: total.ok, failed: total.f, manual: total.m,
    tables, triggers, worm, perMigration: report }, null, 1));
}
main().catch(e => { console.error(e); process.exit(1); });
