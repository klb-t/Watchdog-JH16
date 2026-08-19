import type { Database } from 'better-sqlite3';
import { MIGRATION_001_INITIAL_SCHEMA } from './001_initial_schema';

export interface Migration {
  readonly id: string;
  readonly sql: string;
}

/**
 * Ordered. Never renumber, never edit an applied migration — add a new one.
 * The list is explicit rather than directory-scanned so the order is a fact of
 * the source, not of a filesystem listing.
 */
export const MIGRATIONS: readonly Migration[] = [
  { id: '001_initial_schema', sql: MIGRATION_001_INITIAL_SCHEMA }
];

const MIGRATIONS_TABLE = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);
`;

export interface MigrationResult {
  readonly applied: string[];
  readonly alreadyPresent: string[];
}

/**
 * Applies every migration not yet recorded, in order, each in its own
 * transaction so a failure leaves the database at the last complete migration
 * rather than half-way through one.
 *
 * Idempotent: running it twice applies nothing the second time.
 */
export function runMigrations(sqlite: Database): MigrationResult {
  sqlite.exec(MIGRATIONS_TABLE);

  const applied: string[] = [];
  const alreadyPresent: string[] = [];

  const isApplied = sqlite.prepare('SELECT 1 FROM schema_migrations WHERE id = ?');
  const record = sqlite.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)');

  for (const migration of MIGRATIONS) {
    if (isApplied.get(migration.id)) {
      alreadyPresent.push(migration.id);
      continue;
    }
    const apply = sqlite.transaction(() => {
      sqlite.exec(migration.sql);
      record.run(migration.id, new Date().toISOString());
    });
    apply();
    applied.push(migration.id);
  }

  return { applied, alreadyPresent };
}

/** Table names the schema is expected to contain, for the E1.3 migration test. */
export function listTables(sqlite: Database): string[] {
  const rows = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as { name: string }[];
  return rows.map(r => r.name);
}
