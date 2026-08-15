import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

export const runs = sqliteTable('runs', {
  id: text('id').primaryKey(),
  type: text('type').notNull(), // 'ACQUISITION', 'ANALYSIS', 'PIPELINE'
  status: text('status').notNull(),
  config: text('config').notNull(),
  error_code: text('error_code'),
  created_at: text('created_at').notNull(),
  completed_at: text('completed_at'),
});

export const rawBlobs = sqliteTable('raw_blobs', {
  id: text('id').primaryKey(),
  sha256: text('sha256').notNull().unique(),
  object_uri: text('object_uri').notNull(),
  byte_size: integer('byte_size').notNull(),
  created_at: text('created_at').notNull(),
});

export const fetchEvents = sqliteTable('fetch_events', {
  id: text('id').primaryKey(),
  run_id: text('run_id').notNull().references(() => runs.id),
  source_id: text('source_id').notNull(),
  raw_blob_id: text('raw_blob_id').references(() => rawBlobs.id),
  status: text('status').notNull(),
  created_at: text('created_at').notNull(),
});

export const manifests = sqliteTable('manifests', {
  run_id: text('run_id').primaryKey().references(() => runs.id),
  object_uri: text('object_uri').notNull(),
  sha256: text('sha256').notNull(),
  finalized_at: text('finalized_at').notNull(),
});

export const observations = sqliteTable('observations', {
  id: text('id').primaryKey(),
  run_id: text('run_id').notNull().references(() => runs.id),
  entity_id: text('entity_id').notNull(),
  dimension: text('dimension').notNull(),
  query_text: text('query_text').notNull(),
  result_count: integer('result_count'),
  retrieved_at: text('retrieved_at').notNull(),
  source_id: text('source_id').notNull(),
  raw_artifact_id: text('raw_artifact_id'),
});

export const analysisResults = sqliteTable('analysis_results', {
  id: text('id').primaryKey(),
  run_id: text('run_id').notNull().references(() => runs.id),
  entity_id: text('entity_id'),
  metric_key: text('metric_key').notNull(),
  value_numeric: real('value_numeric'),
  value_text: text('value_text'),
  unit: text('unit'),
});
