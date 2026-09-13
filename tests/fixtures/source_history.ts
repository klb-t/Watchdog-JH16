import type { Database } from 'better-sqlite3';
import type { AutomationRepository } from '../../backend/watchdog_api/db/repositories/automation';
import { loadAutomationProfile } from '../../backend/watchdog_api/config/automation';

/** Isolated fictional records. Jobs are closed in the enqueue transaction so a live test worker cannot fetch them. */
export async function sourceSnapshot(db: Database, repo: AutomationRepository, value: unknown, options: {
  cid?: number; name?: string; provider?: string; kind?: string; url?: string; at?: string; profileHash?: string; adapterVersion?: string;
} = {}) {
  const profile = loadAutomationProfile(); repo.archiveProfile(profile);
  const cid = options.cid ?? 999999991, id = `pubchem:${cid}`, provider = options.provider ?? 'pubchem', kind = options.kind ?? 'properties';
  const job = db.transaction(() => {
    const job = repo.enqueue('local-user',profile.defaults.substanceJob,options.profileHash ?? profile.contentHash);
    repo.cancel(job.id,'local-user'); return job;
  })();
  let receipt = await repo.receipt(job.id,provider,options.url ?? 'https://pubchem.ncbi.nlm.nih.gov/fictional-source-history-fixture',200,
    Buffer.from(JSON.stringify({fixture:'FICTIONAL TEST DATA',value})),'Fictional test fixture; not a scientific measurement');
  // Set the fixture clock before its first association becomes immutable.
  if (options.at) db.prepare('UPDATE public_fetch_receipts SET fetched_at=? WHERE id=?').run(options.at,receipt.id);
  if (options.adapterVersion) db.prepare('UPDATE public_fetch_receipts SET adapter_version=? WHERE id=?').run(options.adapterVersion,receipt.id);
  receipt = repo.getReceipt(receipt.id);
  if (provider === 'pubchem' && kind === 'properties') repo.putCompound(cid,options.name ?? 'Fictional source-history compound',value,receipt);
  else repo.record(id,provider,kind,value,receipt);
  const row = db.prepare('SELECT sequence,record_id FROM substance_reference_observations WHERE receipt_id=? ORDER BY sequence DESC LIMIT 1').get(receipt.id) as any;
  return {id,receipt,sequence:row.sequence as number,recordId:row.record_id as string,jobId:job.id};
}
