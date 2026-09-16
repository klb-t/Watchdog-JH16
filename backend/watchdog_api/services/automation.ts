import { AutomationRepository, AutomationError } from '../db/repositories/automation';
import type { AutomationProfile } from '../config/automation';
import { PublicHttp, AcquisitionStopped, type PublicTransport } from '../sources/public_http';
import { pubchem, chembl, wikidata, substanceLiterature } from '../sources/public_reference';
import { scanLiterature } from '../sources/public_literature';
import { tracer } from '../utils/tracer';
import type { AutomationJob } from '../../../shared/automation';

export class AutomationService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  /** Registered handlers allow new job types without vendor logic in the scheduler. */
  readonly handlers = new Map<string, (job: AutomationJob, checkpoint: () => void) => Promise<Record<string, unknown>>>();
  constructor(readonly repo: AutomationRepository, readonly profile: AutomationProfile,
    private readonly transport?: PublicTransport, private readonly delay?: (ms: number) => Promise<void>) { repo.archiveProfile(profile); }
  start() { if (!this.timer) { this.timer = setInterval(() => { void this.tick().catch(e => tracer.emitError(e, true)); }, this.profile.worker.pollMs); this.timer.unref(); } }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
  get state() { return { enabled: !!this.timer, running: this.running, tickMs: this.profile.worker.pollMs,
    persistence: 'sqlite', missedOccurrences: 'coalesce', processRequirement: 'The server and persistent volume must be running; a closed browser is sufficient.' }; }
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      this.repo.dispatchDue();
      const claim = this.repo.claim(new Date(), this.profile.worker.leaseMs,['substance_refresh','paper_scan',...this.handlers.keys()]); if (!claim) return;
      const { job, token, profile } = claim;
      let canceled = false;
      const checkpoint = () => {
        if (canceled || !this.repo.heartbeat(job.id, token, new Date(), profile.worker.leaseMs)) throw new AcquisitionStopped('CANCELED_OR_AUTHORIZATION_REVOKED');
      };
      const heartbeat = setInterval(() => { if (!this.repo.heartbeat(job.id, token, new Date(), profile.worker.leaseMs)) canceled = true; }, profile.worker.heartbeatMs); heartbeat.unref();
      const http = new PublicHttp(this.repo, job.id, profile, job.request.maxRequests, checkpoint, this.transport, this.delay);
      const outcomes: any[] = [], errors: { source: string; code: string }[] = [];
      const attempt = async (source: string, fn: () => Promise<unknown>) => {
        try { checkpoint(); outcomes.push({ source, result: await fn() }); }
        catch (error) { if (error instanceof AcquisitionStopped) throw error;
          tracer.emitError(error, true);
          errors.push({ source, code: error instanceof AutomationError ? error.message : 'INVALID_SOURCE_RESPONSE' }); }
      };
      try {
        await tracer.runWithSpan('automation', job.request.kind, async () => {
          if (job.request.kind === 'substance_refresh') {
            const request = job.request;
            for (const name of [...new Set(request.names)]) {
              let compound: Awaited<ReturnType<typeof pubchem>> | null = null;
              await attempt(`${name}:pubchem`, async () => { compound = await pubchem(http, name); return compound; });
              if (!compound) continue;
              for (const provider of [...new Set(request.providers)]) {
                if (provider === 'chembl') await attempt(`${name}:chembl`, () => chembl(http, compound!, request.pageLimit));
                if (provider === 'wikidata') await attempt(`${name}:wikidata`, () => wikidata(http, compound!, name));
                if (provider === 'europe_pmc') await attempt(`${name}:europe_pmc`, () => substanceLiterature(http, compound!.id, name));
              }
            }
          } else if (job.request.kind === 'paper_scan') {
            const request = job.request;
            for (const provider of [...new Set(request.providers)]) await attempt(provider, () => scanLiterature(http, job.ownerId, request, provider));
          } else {
            const handler = this.handlers.get(job.request.kind);
            if (!handler) throw new AutomationError('Job handler is not configured');
            outcomes.push({ source: job.request.kind, result: await handler(job, checkpoint) });
          }
        }, { actor_id: job.ownerId, request_id: job.id });
        const partial = errors.length > 0 || outcomes.some(o => o.result?.complete === false);
        this.repo.finish(job.id, token, !outcomes.length && errors.length ? 'FAILED' : partial ? 'PARTIAL' : 'SUCCEEDED', { requests: http.requests, outcomes, errors });
      } catch (error) {
        const reason = error instanceof AcquisitionStopped ? error.reason : 'JOB_EXECUTION_FAILED';
        this.repo.finish(job.id, token, reason === 'REQUEST_BUDGET_EXHAUSTED' ? 'PARTIAL' : error instanceof AcquisitionStopped ? 'CANCELED' : 'FAILED',
          { requests: http.requests, outcomes, errors, reason }, reason);
      } finally { clearInterval(heartbeat); }
    } finally { this.running = false; }
  }
}
