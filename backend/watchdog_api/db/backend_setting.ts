import { NotImplementedError } from '../utils/errors';

/**
 * E3.5: which database backend the server uses (WATCHDOG_DB_BACKEND).
 * `sqlite` is the only working backend. `postgres` is planned: the schema
 * ports (scripts/pg_portability_probe.ts) but the repositories are synchronous
 * SQLite code, so selecting it stops startup instead of silently using SQLite.
 */
export type DbBackend = 'sqlite';

export function resolveDbBackend(env: NodeJS.ProcessEnv = process.env): DbBackend {
  const value = (env.WATCHDOG_DB_BACKEND ?? 'sqlite').trim().toLowerCase();
  if (value === 'sqlite') return 'sqlite';
  if (value === 'postgres') throw new NotImplementedError('db_backend_postgres', 'planned (E3.5, see docs/architecture/E3_5_POSTGRES_DESIGN.md)');
  throw new Error(`WATCHDOG_DB_BACKEND must be 'sqlite' or 'postgres', got '${env.WATCHDOG_DB_BACKEND}'`);
}
