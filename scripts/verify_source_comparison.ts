import { readFileSync, statSync } from 'node:fs';
import { verifySourceComparison } from '../backend/watchdog_api/services/source_comparison';

const [file,expectedHash,...extra] = process.argv.slice(2);
if (!file || !expectedHash || extra.length) throw new Error('Usage: node --import tsx scripts/verify_source_comparison.ts comparison.json EXPECTED_SHA256');
if (statSync(file).size > 64 * 1024 * 1024) throw new Error('Comparison file exceeds the verifier input limit');
const result = verifySourceComparison(JSON.parse(readFileSync(file,'utf8')),expectedHash);
process.stdout.write(JSON.stringify({verified:true,comparisonHash:result.contentHash,algorithm:result.body.difference.algorithm,
  equal:result.body.equal,changes:result.body.difference.changes.length,truncated:result.body.difference.truncated,
  rawResponsesIncluded:false,meaning:'Saved-record structural comparison; not scientific or clinical validation.'},null,2)+'\n');
