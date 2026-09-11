import type { Database } from 'better-sqlite3';
import { randomUUID, createHash } from 'node:crypto';
import { canonicalHash } from '../../domain/canonical';
import { SettingsSchema, ModelCeilingSchema, BenchmarkSchema, type AssistantTask, type RoutingEvidence, type ModelCeiling, type PersonalSettings, type SettingsRecord, type ModelCatalog, type ModelRoute } from '../../../../shared/settings';
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
  async saveCatalog(catalog: ModelCatalog, raw: Buffer, owner?: string) {
    const sha = createHash('sha256').update(raw).digest('hex');
    if (catalog.rawHash !== sha) throw new AutomationError('Catalog raw hash mismatch');
    const uri = await this.store.put(`raw/${sha}`, raw);
    this.db.transaction(() => {
      this.db.prepare('INSERT OR IGNORE INTO raw_blobs VALUES (?,?,?,?,?,?,?)').run(`catalog-${sha}`, sha, uri, raw.length, 'application/json', 'model-catalog', catalog.fetchedAt);
      const blob = this.db.prepare('SELECT id FROM raw_blobs WHERE sha256=?').get(sha) as any;
      if (catalog.provider === 'openrouter' && !owner) this.db.prepare('INSERT OR IGNORE INTO assistant_catalogs VALUES (?,?,?,?)').run(catalog.hash, JSON.stringify(catalog), catalog.fetchedAt, blob.id);
      else {
        if (!owner) throw new AutomationError('A private model catalog requires an owner');
        this.db.prepare('INSERT OR IGNORE INTO personal_model_catalogs VALUES (?,?,?,?,?,?)').run(owner, catalog.provider, catalog.hash, JSON.stringify(catalog), catalog.fetchedAt, blob.id);
      }
    })();
  }
  catalog(provider = 'openrouter', owner?: string): ModelCatalog | null {
    const row = provider === 'openrouter' ? this.db.prepare('SELECT * FROM assistant_catalogs ORDER BY fetched_at DESC,hash DESC LIMIT 1').get() as any
      : this.db.prepare('SELECT * FROM personal_model_catalogs WHERE owner_principal_id=? AND provider_key=? ORDER BY fetched_at DESC,hash DESC LIMIT 1').get(owner ?? '', provider) as any;
    if (!row) return null;
    const c = JSON.parse(row.body_json), { hash, ...body } = c;
    if (row.hash !== hash || canonicalHash(body) !== hash) throw new AutomationError('Model catalog integrity mismatch');
    return c;
  }
  saveModelCeiling(owner: string, input: unknown) {
    const value = ModelCeilingSchema.parse(input), hash = canonicalHash(value), now = Date.now();
    if (Date.parse(value.observedAt) > now + 60000 || Date.parse(value.validUntil) <= now || Date.parse(value.validUntil) - Date.parse(value.observedAt) > 31 * 86400000) throw new AutomationError('A price profile needs current observation and at most 31-day validity');
    this.db.prepare('INSERT OR IGNORE INTO personal_model_ceilings VALUES (?,?,?,?,?,?)').run(owner, value.provider, value.id, hash, JSON.stringify(value), new Date().toISOString());
    this.audit(owner, 'model.ceiling.review', hash, { provider: value.provider, model: value.id }); return { value, hash };
  }
  ceilings(owner: string, provider: string): { value: ModelCeiling; hash: string }[] {
    const rows = this.db.prepare('SELECT body_json,hash FROM personal_model_ceilings WHERE owner_principal_id=? AND provider_key=? ORDER BY created_at DESC,rowid DESC').all(owner, provider) as any[];
    const seen = new Set<string>(); return rows.flatMap(r => { const value = ModelCeilingSchema.parse(JSON.parse(r.body_json));
      if (canonicalHash(value) !== r.hash) throw new AutomationError('Model ceiling integrity mismatch');
      if (seen.has(value.id)) return []; seen.add(value.id); return [{ value, hash: r.hash }]; });
  }
  saveBenchmark(owner: string, input: unknown) {
    const b = BenchmarkSchema.parse(input), hash = canonicalHash(b);
    if (Date.parse(b.observedAt) > Date.now() + 60000) throw new AutomationError('Benchmark cannot be dated in the future');
    this.db.prepare('INSERT OR IGNORE INTO assistant_benchmarks VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), owner, b.provider, b.model, b.task, b.suiteHash, b.passed, b.total, b.source, b.observedAt, new Date().toISOString(), hash);
    this.audit(owner, 'benchmark.review', hash, { source: b.source, task: b.task }); return { hash };
  }
  routingEvidence(owner: string, provider: string, task: AssistantTask, maxAgeDays: number): RoutingEvidence[] {
    const since = new Date(Date.now() - maxAgeDays * 86400000).toISOString(), byModel = new Map<string, RoutingEvidence>();
    const get = (model: string) => { if (!byModel.has(model)) byModel.set(model, { model, benchmark: null, operations: { calls: 0, successes: 0, averageLatencyMs: null } }); return byModel.get(model)!; };
    const benchmarks = this.db.prepare('SELECT * FROM assistant_benchmarks WHERE owner_principal_id=? AND provider_key=? AND task=? AND observed_at>=? ORDER BY observed_at DESC,rowid DESC').all(owner, provider, task, since) as any[];
    for (const b of benchmarks) { const row = get(b.model_id); if (!row.benchmark) row.benchmark = { suiteHash: b.suite_hash, passed: b.passed, total: b.total, source: b.source_url, observedAt: b.observed_at, hash: b.content_hash }; }
    const operations = this.db.prepare('SELECT route_json,result_json,status FROM assistant_reservations WHERE owner_principal_id=? AND created_at>=? AND status<>? ORDER BY created_at,id').all(owner, since, 'RESERVED') as any[];
    const latency = new Map<string, number[]>();
    for (const o of operations) { const route = JSON.parse(o.route_json); if ((route.provider ?? 'openrouter') !== provider || route.task !== task) continue;
      const row = get(route.model.id), result = JSON.parse(o.result_json ?? '{}'); row.operations.calls++; if (o.status !== 'FAILED_RESERVED') row.operations.successes++;
      if (typeof result.latencyMs === 'number' && Number.isFinite(result.latencyMs)) { const l = latency.get(row.model) ?? []; l.push(result.latencyMs); latency.set(row.model, l); } }
    for (const row of byModel.values()) { const l = latency.get(row.model); if (l?.length) row.operations.averageLatencyMs = l.reduce((a, b) => a + b, 0) / l.length; }
    return [...byModel.values()].sort((a,b) => a.model.localeCompare(b.model, 'en'));
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
