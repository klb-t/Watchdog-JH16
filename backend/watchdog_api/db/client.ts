import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), 'data', 'watchdog.sqlite');

function initDb() {
  const dbDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
  
  const sqlite = new Database(DB_PATH);
  const db = drizzle(sqlite);
  
  // Minimal manual migration for runtime
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      config TEXT NOT NULL,
      error_code TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS raw_blobs (
      id TEXT PRIMARY KEY,
      sha256 TEXT NOT NULL UNIQUE,
      object_uri TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS fetch_events (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(id),
      source_id TEXT NOT NULL,
      source_adapter_version TEXT,
      provenance_metadata TEXT,
      raw_blob_id TEXT REFERENCES raw_blobs(id),
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS manifests (
      run_id TEXT PRIMARY KEY REFERENCES runs(id),
      object_uri TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      finalized_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS observations (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(id),
      entity_id TEXT NOT NULL,
      dimension TEXT NOT NULL,
      query_text TEXT NOT NULL,
      result_count INTEGER,
      retrieved_at TEXT NOT NULL,
      source_id TEXT NOT NULL,
      raw_artifact_id TEXT
    );
    CREATE TABLE IF NOT EXISTS analysis_results (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(id),
      entity_id TEXT,
      metric_key TEXT NOT NULL,
      value_numeric REAL,
      value_text TEXT,
      unit TEXT
    );
  `);
  
  return db;
}

export const db = initDb();
