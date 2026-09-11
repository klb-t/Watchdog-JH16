import type { Database } from 'better-sqlite3';
import { randomUUID, createHash } from 'node:crypto';
import { canonicalHash } from '../../domain/canonical';
import { SettingsSchema, type PersonalSettings, type SettingsRecord, type ModelCatalog, type ModelRoute } from '../../../../shared/settings';
import { AutomationError } from './automation';
import { AuditRepository } from './audit';
import type { ObjectStore } from '../../storage/object_store';
export class SettingsRepository {
  constructor(private readonly db: Database, private readonly store: ObjectStore) {}
  archiveAssistantProfile(profile: unknown) {
    this.db.prepare('INSERT OR IGNORE INTO assistant_profiles VALUES (?,?)').run((profile as any).contentHash, JSON.stringify(profile));
  }
  get(owner: string, defaults: PersonalSettings): SettingsRecord {
    const row = this.db.prepare('SELECT * FROM personal_settings WHERE owner_principal_id=?').get(owner) as any;
    const value = row ? SettingsSchema.parse(JSON.parse(row.body_json)) : structuredClone(defaults), hash = canonicalHash(value);
    if (row && row.content_hash !== hash) throw new AutomationError('Settings integrity mismatch');
    return { value, hash, updatedAt: row?.updated_at ?? null };
  }
  save(owner: string, input: unknown, expectedHash: string, defaults: PersonalSettings) {
    const value = SettingsSchema.parse(input), hash = canonicalHash(value);
    return this.db.transaction(() => {
      if (this.get(owner, defaults).hash !== expectedHash) throw new AutomationError('Settings changed; reload before saving');
      this.db.prepare('INSERT OR IGNORE INTO personal_settings_snapshots VALUES (?,?)').run(hash, JSON.stringify(value));
      this.db.prepare('INSERT INTO personal_settings VALUES (?,?,?,?) ON CONFLICT(owner_principal_id) DO UPDATE SET body_json=excluded.body_json,content_hash=excluded.content_hash,updated_at=excluded.updated_at')
        .run(owner, JSON.stringify(value), hash, new Date().toISOString());
      this.audit(owner, 'settings.save', hash, { previousHash: expectedHash, hash }); return this.get(owner, defaults);
    }).immediate();
  }
  audit(owner: string, action: string, id: string, detail: unknown) { new AuditRepository(this.db).append(owner, action, 'settings', id, 'settings', detail); }
  envelope(owner: string, provider: string): { id: string; envelope: string; updatedAt: string } | null {
    const row = this.db.prepare('SELECT * FROM user_secret_envelopes WHERE owner_principal_id=? AND provider_key=?').get(owner, provider) as any;
    return row ? { id: row.id, envelope: row.envelope_json, updatedAt: row.updated_at } : null;
  }
  writeEnvelope(owner: string, provider: string, id: string, envelope: string) {
    this.db.prepare('INSERT INTO user_secret_envelopes VALUES (?,?,?,?,?) ON CONFLICT(owner_principal_id,provider_key) DO UPDATE SET id=excluded.id,envelope_json=excluded.envelope_json,updated_at=excluded.updated_at')
      .run(id, owner, provider, envelope, new Date().toISOString()); this.audit(owner, 'credential.save', id, { provider });
  }
  deleteEnvelope(owner: string, provider: string) {
    this.db.prepare('DELETE FROM user_secret_envelopes WHERE owner_principal_id=? AND provider_key=?').run(owner, provider);
    this.audit(owner, 'credential.delete', provider, {});
  }
  async saveCatalog(catalog: ModelCatalog, raw: Buffer) {
    const sha = createHash('sha256').update(raw).digest('hex');
    if (catalog.rawHash !== sha) throw new AutomationError('Catalog raw hash mismatch');
    const uri = await this.store.put(`raw/${sha}`, raw);
    this.db.transaction(() => {
      this.db.prepare('INSERT OR IGNORE INTO raw_blobs VALUES (?,?,?,?,?,?,?)').run(`catalog-${sha}`, sha, uri, raw.length, 'application/json', 'model-catalog', catalog.fetchedAt);
      const blob = this.db.prepare('SELECT id FROM raw_blobs WHERE sha256=?').get(sha) as any;
      this.db.prepare('INSERT OR IGNORE INTO assistant_catalogs VALUES (?,?,?,?)').run(catalog.hash, JSON.stringify(catalog), catalog.fetchedAt, blob.id);
    })();
  }
  catalog(): ModelCatalog | null {
    const row = this.db.prepare('SELECT * FROM assistant_catalogs ORDER BY fetched_at DESC,hash DESC LIMIT 1').get() as any;
    if (!row) return null;
    const c = JSON.parse(row.body_json), { hash, ...body } = c;
    if (row.hash !== hash || canonicalHash(body) !== hash) throw new AutomationError('Model catalog integrity mismatch');
    return c;
  }
  budget(owner: string, day = new Date().toISOString().slice(0, 10)) {
    const r = this.db.prepare('SELECT COALESCE(SUM(charged_micro_usd),0) AS used,COUNT(*) AS calls FROM assistant_reservations WHERE owner_principal_id=? AND day_utc=?').get(owner, day) as any;
    return { dayUtc: day, reservedOrEstimatedUsd: r.used / 1000000, calls: r.calls };
  }
  reserveSearch(owner: string, limit: number) {
    this.db.transaction(() => {
      const day = new Date().toISOString().slice(0, 10);
      const count = (this.db.prepare('SELECT COUNT(*) n FROM personal_search_requests WHERE owner_principal_id=? AND day_utc=?').get(owner, day) as any).n;
      if (count >= limit) throw new AutomationError('Daily SERP request limit exhausted');
      this.db.prepare('INSERT INTO personal_search_requests VALUES (?,?,?,?)').run(randomUUID(), owner, day, new Date().toISOString());
    }).immediate();
  }
  reserve(owner: string, route: ModelRoute, dailyBudgetUsd: number): string {
    return this.db.transaction(() => {
      const day = new Date().toISOString().slice(0, 10), used = this.budget(owner, day).reservedOrEstimatedUsd;
      if (Math.round(used * 1000000) + route.reserveMicroUsd > Math.floor(dailyBudgetUsd * 1000000)) throw new AutomationError('Daily assistant budget exhausted');
      const id = randomUUID();
      this.db.prepare('INSERT INTO assistant_reservations VALUES (?,?,?,?,?,?,?,?,?,?)').run(id, owner, day, route.reserveMicroUsd,
        route.reserveMicroUsd, 'RESERVED', JSON.stringify(route), null, new Date().toISOString(), null);
      return id;
    }).immediate();
  }
  settle(owner: string, id: string, result: unknown, estimatedMicroUsd: number | null, failed = false) {
    const row = this.db.prepare('SELECT * FROM assistant_reservations WHERE id=? AND owner_principal_id=?').get(id, owner) as any;
    if (!row || row.status !== 'RESERVED') throw new AutomationError('Usage reservation not found or already settled');
    const charged = estimatedMicroUsd === null ? row.reserved_micro_usd : Math.max(0, estimatedMicroUsd);
    this.db.prepare('UPDATE assistant_reservations SET charged_micro_usd=?,status=?,result_json=?,finished_at=? WHERE id=? AND owner_principal_id=?')
      .run(charged, failed ? 'FAILED_RESERVED' : estimatedMicroUsd === null ? 'USAGE_UNKNOWN_RESERVED' : 'ESTIMATED', JSON.stringify(result), new Date().toISOString(), id, owner);
    this.audit(owner, 'assistant.complete', id, { status: failed ? 'FAILED' : 'PROPOSED', chargedMicroUsd: charged });
  }
  generations(owner: string) {
    return (this.db.prepare('SELECT id,status,route_json,result_json,created_at,charged_micro_usd FROM assistant_reservations WHERE owner_principal_id=? ORDER BY created_at DESC,id LIMIT 50').all(owner) as any[])
      .map(r => ({ id: r.id, status: r.status, route: JSON.parse(r.route_json), result: r.result_json ? JSON.parse(r.result_json) : null, createdAt: r.created_at, reservedOrEstimatedUsd: r.charged_micro_usd / 1000000 }));
  }
  savePlan(owner: string, body: unknown) {
    const hash = canonicalHash(body), id = canonicalHash({ owner, hash });
    this.db.prepare('INSERT OR IGNORE INTO research_plans VALUES (?,?,?,?,?,NULL)').run(id, owner, hash, JSON.stringify(body), new Date().toISOString());
    return this.plan(owner, id)!;
  }
  plan(owner: string, id: string) {
    const row = this.db.prepare('SELECT * FROM research_plans WHERE id=? AND owner_principal_id=?').get(id, owner) as any;
    if (!row) return null; const body = JSON.parse(row.body_json);
    if (canonicalHash(body) !== row.content_hash) throw new AutomationError('Research plan integrity mismatch');
    return { id: row.id, hash: row.content_hash, body, createdAt: row.created_at, launch: row.launch_json ? JSON.parse(row.launch_json) : null };
  }
  plans(owner: string) { return (this.db.prepare('SELECT id FROM research_plans WHERE owner_principal_id=? ORDER BY created_at DESC,id LIMIT 30').all(owner) as any[]).map(r => this.plan(owner, r.id)!); }
  launchPlan<T>(owner: string, id: string, hash: string, fn: () => T): T {
    return this.db.transaction(() => {
      const plan = this.plan(owner, id); if (!plan || plan.hash !== hash) throw new AutomationError('Plan not found or review hash changed');
      if (plan.launch) return plan.launch;
      const result = fn(); this.db.prepare('UPDATE research_plans SET launch_json=? WHERE id=? AND owner_principal_id=?').run(JSON.stringify(result), id, owner);
      this.audit(owner, 'research.plan.launch', id, { hash }); return result;
    }).immediate();
  }
}
