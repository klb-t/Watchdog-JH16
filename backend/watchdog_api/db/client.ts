import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { runMigrations } from './migrations';

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'data', 'watchdog.sqlite');

function initDb() {
  const dbDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

  const sqlite = new Database(DB_PATH);
  sqlite.pragma('foreign_keys = ON');
  runMigrations(sqlite);
  return { sqlite, orm: drizzle(sqlite) };
}

const initialised = initDb();

export const db = initialised.orm;

/**
 * The raw handle, for the few repositories that predate drizzle's coverage of
 * what they need. Exported from the client rather than reopened elsewhere:
 * two connections to one SQLite file is how a writer starves a reader.
 */
export const sqlite = initialised.sqlite;
