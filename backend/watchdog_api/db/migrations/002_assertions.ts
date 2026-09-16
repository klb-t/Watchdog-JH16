/**
 * Migration 002 — the D14 assertion mechanism.
 *
 * Replaces `substance_symptom_associations` (and the `substance_relations` /
 * `substance_receptor_bindings` that an earlier draft of `02_DATA_MODEL.md`
 * proposed but this repository never created) with one reified `assertions`
 * table over a controlled predicate vocabulary.
 *
 * Why one table rather than a growing pile of edge tables: bespoke edges were
 * naked, with no shared provenance shape, no contradiction handling and no
 * uniform regional or temporal context. The query that surfaced this — "what
 * interacts with whatever is commonly sold as X" — needs all three at once,
 * across a multi-hop traversal.
 *
 * `pill_type_composition` stays a typed table by deliberate exception per
 * `12_DRUG_DOMAIN_ONTOLOGY_AND_ASSERTIONS.md`: high-volume, stable-shaped lab
 * data is what typed columns serve better than a generic value field.
 *
 * Empty at E1. E6 populates it.
 */
export const MIGRATION_002_ASSERTIONS = `
-- Region hierarchy, replacing the loose geography_id string.
CREATE TABLE IF NOT EXISTS geographic_regions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  region_type TEXT,
  parent_region_id TEXT REFERENCES geographic_regions(id),
  iso_code TEXT,
  created_at TEXT NOT NULL,
  CHECK (region_type IS NULL OR region_type IN
    ('country', 'province', 'state', 'municipality', 'service_region', 'supranational'))
);

-- One node table for receptors, transporters, enzymes and pathways: a
-- substance's relationship to any of them is mechanistically the same kind of
-- fact, so four near-identical tables would be four ways to say one thing.
CREATE TABLE IF NOT EXISTS targets (
  id TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL,
  target_type TEXT NOT NULL,
  organism TEXT,
  external_identifiers_json TEXT,
  created_at TEXT NOT NULL,
  CHECK (target_type IN ('receptor', 'transporter', 'enzyme', 'pathway'))
);

-- What something is sold or represented as, which must be able to diverge from
-- what it actually is.
CREATE TABLE IF NOT EXISTS market_labels (
  id TEXT PRIMARY KEY,
  label_text TEXT NOT NULL,
  canonical_label_group TEXT,
  language TEXT,
  region_id TEXT REFERENCES geographic_regions(id),
  notes TEXT,
  created_at TEXT NOT NULL
);

-- The atomic fact. Subject and object are polymorphic references into the node
-- tables; predicate is a closed vocabulary.
CREATE TABLE IF NOT EXISTS assertions (
  id TEXT PRIMARY KEY,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  predicate TEXT NOT NULL,
  object_type TEXT,
  object_id TEXT,
  value_json TEXT,

  geography_id TEXT REFERENCES geographic_regions(id),
  language TEXT,
  observed_at TEXT,
  valid_from TEXT,
  valid_to TEXT,

  source_id TEXT,
  provider_id TEXT,
  artifact_id TEXT REFERENCES artifacts(id),
  citation_json TEXT,
  fetch_event_id TEXT REFERENCES fetch_events(id),

  evidence_tier TEXT,
  approval_state TEXT NOT NULL DEFAULT 'PROPOSED',
  approved_hash TEXT,
  approved_by TEXT,
  approved_at TEXT,
  quality_flags_json TEXT,

  -- Two conflicting assertions about the same fact are BOTH stored and linked.
  -- Nothing averages them, prefers the newer, or lets a model pick a winner.
  contradicts_json TEXT,
  corroborates_json TEXT,
  supersedes_assertion_id TEXT REFERENCES assertions(id),

  created_at TEXT NOT NULL,

  CHECK (subject_type IN
    ('substance', 'symptom', 'target', 'pill_type', 'tested_sample', 'market_label')),
  CHECK (object_type IS NULL OR object_type IN
    ('substance', 'symptom', 'target', 'pill_type', 'tested_sample', 'market_label')),
  CHECK (approval_state IN ('PROPOSED', 'APPROVED')),
  CHECK (evidence_tier IS NULL OR evidence_tier IN
    ('PRIMARY_EMPIRICAL', 'CURATED_SECONDARY', 'RAW_OBSERVATIONAL',
     'MODELED_PREDICTED', 'SPECULATIVE', 'UNKNOWN')),
  CHECK (predicate IN (
    'ALIAS_OF', 'IS_ISOMER_OF', 'SALT_OF', 'METABOLITE_OF', 'PRECURSOR_OF', 'ANALOG_OF',
    'STRUCTURALLY_SIMILAR_TO',
    'BINDS_TO', 'AGONIST_AT', 'ANTAGONIST_AT', 'MODULATES', 'INHIBITS', 'INDUCES',
    'METABOLIZED_BY',
    'ASSOCIATED_WITH_EFFECT', 'ASSOCIATED_WITH_SYMPTOM', 'ASSOCIATED_WITH_TOXICITY',
    'AFFECTS_ORGAN_SYSTEM', 'INTERACTS_WITH',
    'CLAIMED_AS', 'TESTED_AS', 'CONTAINS', 'ADULTERATED_WITH', 'VISUALLY_RESEMBLES',
    'OBSERVED_IN_REGION', 'HAS_LEGAL_STATUS', 'SUBJECT_TO_ALERT'
  ))
);

CREATE INDEX IF NOT EXISTS idx_assertions_subject ON assertions(subject_type, subject_id);
CREATE INDEX IF NOT EXISTS idx_assertions_object ON assertions(object_type, object_id);
CREATE INDEX IF NOT EXISTS idx_assertions_predicate ON assertions(predicate);
CREATE INDEX IF NOT EXISTS idx_market_labels_text ON market_labels(label_text);

-- What a specimen was sold as, independent of what composition later showed.
-- This is the column the misrepresentation query joins on.
ALTER TABLE tested_samples ADD COLUMN claimed_label_id TEXT REFERENCES market_labels(id);

-- Superseded by the assertion mechanism (D14). Dropped rather than left
-- alongside it: two places to record the same edge is exactly the drift D14
-- exists to prevent, and the table is empty at E1 so nothing is lost.
DROP TABLE IF EXISTS substance_symptom_associations;
`;
