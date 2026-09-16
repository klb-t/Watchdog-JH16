import type { EvidenceTier } from '../backend/watchdog_api/domain/evidence_tier';

export interface Entity { id: string; name: string; type: 'substance' | 'symptom' | 'target'; targetType?: 'receptor' | 'transporter' | 'enzyme' | 'pathway' }
export interface Region { id: string; name: string; parentId: string | null }
export interface Citation {
  url: string; title: string; publisher: string; retrievedAt: string;
  locator: string; sourceRecordId: string;
}
export interface EvidenceBase {
  key: string; citation: Citation; evidenceTier: EvidenceTier; qualityFlags: string[];
}
export interface SampleDocument extends EvidenceBase {
  kind: 'sample'; name: string;
  origin: 'lab_sample' | 'published_alert' | 'visual_report';
  region: Region; observedOn: string | null;
  timeBasis: 'tested' | 'published' | 'reported' | 'unknown';
  testMethod: string | null;
  appearance: { colors: string[]; shape: string | null; logo: string | null; scoreLine: string | null };
  market: { label: string; group: string; language: string } | null;
  components: { substance: Entity; amount: number | null; unit: string | null; note: string | null }[];
  unknownComponents: string[];
}
export const CONTENT_CATEGORIES = [
  'identity', 'chemistry', 'pharmacokinetics', 'pharmacodynamics', 'acute_toxicity',
  'chronic_effects', 'interactions', 'preparations', 'regional_signals', 'citations', 'legal_status', 'alerts',
] as const;
export type ContentCategory = typeof CONTENT_CATEGORIES[number];
export interface AssertionDocument extends EvidenceBase {
  kind: 'assertion'; subject: Entity; predicate: string; object: Entity | null;
  category: ContentCategory;
  statement: { text: string; language: string; kind: 'source_excerpt' | 'curator_summary';
    mechanism: string | null; severity: string | null; population: string | null };
  region: Region | null; validFrom: string | null; validTo: string | null;
  contradicts: string[]; supersedes: string | null;
}
export type ReferenceDocument = SampleDocument | AssertionDocument;
export interface ReferenceRecord<T extends ReferenceDocument = ReferenceDocument> {
  id: string; document: T; contentHash: string;
  approvedHash: string | null; approvedBy: string | null; approvedAt: string | null;
  approvalState: 'PROPOSED' | 'APPROVED'; importedAt: string; rawSha256: string;
}
export interface FieldProfile {
  version: string; staleAfterHours: number; offlineMaxHours: number;
  regions: Region[];
  categories: { id: ContentCategory; label: string }[];
  tiers: Record<EvidenceTier, { label: string; bucket: string; icon: string; color: string }>;
  colors: { id: string; label: string; aliases: string[] }[];
  disclaimer: string;
  contacts: { regionId: string; name: string; phone: string | null; url: string;
    audience: string; verifiedOn: string; citationUrl: string }[];
}
export interface FieldSnapshot {
  version: string; generatedAt: string; expiresAt: string; principalId: string;
  profile: FieldProfile; records: ReferenceRecord[];
}
export interface FieldQuery {
  mode: 'pill' | 'market' | 'symptoms'; term: string; color: string; shape: string; scoreLine: string;
  symptomIds: string[]; regionId: string; from: string | null; to: string | null;
  includeBroaderContext: boolean; language: string;
  expansionMode: 'STRICT_CANONICAL' | 'SCIENTIFIC_SYNONYMS' | 'LOCALIZED_SYNONYMS' | 'EXPERIMENTAL_SLANG_EXPANSION';
}
export interface FactView { record: ReferenceRecord<AssertionDocument>; contradicted: boolean }
export interface SubstanceCard {
  substance: Entity;
  sections: { id: ContentCategory; label: string; facts: FactView[] }[];
  missingInteractions: boolean;
}
export interface SampleCandidate {
  record: ReferenceRecord<SampleDocument>;
  matchTier: EvidenceTier;
  regionScope: 'selected_region' | 'broader_context';
  substances: SubstanceCard[];
  path: string[];
}
export interface FieldResult {
  query: FieldQuery; candidates: SampleCandidate[];
  symptomCandidates: { card: SubstanceCard; supportingAssertions: FactView[]; matchedSymptomIds: string[] }[];
  labSampleCount: number; publishedAlertCount: number; visualReportCount: number;
  distribution: { substance: Entity; labSampleCount: number }[];
  excludedUndated: number; flags: string[];
}

export interface OfflineLookupEvent {
  id: string; clientOccurredAt: string; snapshotHash: string;
  query: FieldQuery; resultIds: string[];
}
