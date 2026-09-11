import type { Database } from 'better-sqlite3';
import { MIGRATION_001_INITIAL_SCHEMA } from './001_initial_schema';
import { MIGRATION_002_ASSERTIONS } from './002_assertions';
import { MIGRATION_003_QUERY_PLAN_IDENTITY } from './003_query_plan_identity';
import { MIGRATION_004_PRINCIPALS } from './004_principals';
import { MIGRATION_005_ROLE_PROFILES } from './005_role_profiles';
import { MIGRATION_009_GEOMETRY_LAYERS } from './009_geometry_layers';
import { MIGRATION_008_WORKBENCH_PROFILES } from './008_workbench_profiles';
import { MIGRATION_007_WORKBENCH } from './007_workbench';
import { MIGRATION_006_FIELD_REFERENCE } from './006_field_reference';
import { MIGRATION_010_AUTOMATION } from './010_automation';
import { MIGRATION_011_PERSONAL_SETTINGS } from './011_personal_settings';
import { MIGRATION_012_ASSISTANT_PROFILES } from './012_assistant_profiles';

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
  { id: '001_initial_schema', sql: MIGRATION_001_INITIAL_SCHEMA },
  { id: '002_assertions', sql: MIGRATION_002_ASSERTIONS },
  { id: '003_query_plan_identity', sql: MIGRATION_003_QUERY_PLAN_IDENTITY },
  { id: '004_principals', sql: MIGRATION_004_PRINCIPALS },
  { id: '005_role_profiles', sql: MIGRATION_005_ROLE_PROFILES },
  { id: '006_field_reference', sql: MIGRATION_006_FIELD_REFERENCE },
  { id: '007_workbench', sql: MIGRATION_007_WORKBENCH },
  { id: '008_workbench_profiles', sql: MIGRATION_008_WORKBENCH_PROFILES },
  { id: '009_geometry_layers', sql: MIGRATION_009_GEOMETRY_LAYERS },
  { id: '010_automation', sql: MIGRATION_010_AUTOMATION },
  { id: '011_personal_settings', sql: MIGRATION_011_PERSONAL_SETTINGS },
  { id: '012_assistant_profiles', sql: MIGRATION_012_ASSISTANT_PROFILES }
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
