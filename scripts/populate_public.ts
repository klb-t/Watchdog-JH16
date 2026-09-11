/** Same durable worker as the UI. No API keys; no fabricated fallback data. */
import { sqlite } from '../backend/watchdog_api/db/client';
import { store } from '../backend/watchdog_api/storage/client';
import { AutomationRepository } from '../backend/watchdog_api/db/repositories/automation';
import { AutomationService } from '../backend/watchdog_api/services/automation';
import { loadAutomationProfile } from '../backend/watchdog_api/config/automation';
import { JobRequestSchema } from '../shared/automation';

const args = process.argv.slice(2);
if (!args.includes('--allow-public-network')) throw new Error('Use --allow-public-network to authorize bounded calls to configured public APIs.');
const names = args.filter(a => !a.startsWith('--'));
const profile = loadAutomationProfile(), repo = new AutomationRepository(sqlite, store), service = new AutomationService(repo, profile);
const request = JobRequestSchema.parse({ ...profile.defaults.substanceJob, ...(names.length ? { names } : {}) });
const job = repo.enqueue('local-user', request, profile.contentHash);
// Process until this newly enqueued job has a terminal state, including older queued jobs.
while (['QUEUED', 'RUNNING'].includes(repo.job(job.id, 'local-user')!.status)) await service.tick();
const result = repo.job(job.id, 'local-user')!;
console.log(JSON.stringify({ job: result, substances: repo.substanceList(), receipts: repo.receipts(job.id, 'local-user') }, null, 2));
sqlite.close();
if (result.status === 'FAILED' || result.status === 'CANCELED') process.exitCode = 1;
