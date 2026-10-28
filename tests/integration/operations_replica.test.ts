/**
 * E3.5 option B': periodic SQLite snapshots and object-store copies (scripts/watchdog_replica.py),
 * exercised against a file:// destination. Fixture data are fictional.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { runMigrations } from '../../backend/watchdog_api/db/migrations';
import { LocalFileSystemStore } from '../../backend/watchdog_api/storage/object_store';

const helper = path.resolve('scripts/watchdog_replica.py');
const run = (...args: string[]) => spawnSync('python3', [helper, ...args], { encoding: 'utf8', timeout: 30000 });
function ok(...args: string[]) {
  const r = run(...args); assert.equal(r.status, 0, `${args[0]} failed: ${r.stderr}`); return JSON.parse(r.stdout);
}

async function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'watchdog-replica-')), data = path.join(dir, 'data');
  mkdirSync(path.join(data, 'secrets'), { recursive: true });
  writeFileSync(path.join(data, 'secrets/master.key'), 'fictional-vault-key-never-replicated');
  const db = new Database(path.join(data, 'watchdog.sqlite')); runMigrations(db);
  const store = new LocalFileSystemStore(path.join(data, 'object_store'));
  const addBlob = async (text: string) => {
    const bytes = Buffer.from(text), sha = createHash('sha256').update(bytes).digest('hex');
    await store.put(`raw/${sha}`, bytes);
    db.prepare('INSERT INTO raw_blobs VALUES (?,?,?,?,?,?,?)').run(`blob-${sha.slice(0, 8)}`, sha, `file:///mnt/watchdog/object_store/raw/${sha}`, bytes.length, 'text/plain', 'fixture', '2026-10-26T00:00:00Z');
    return sha;
  };
  await addBlob('Fictional receipt one\n');
  const args = (dest: string) => ['--db', path.join(data, 'watchdog.sqlite'), '--store', path.join(data, 'object_store'), '--dest', dest, '--state', path.join(dir, 'state.json')];
  return { dir, data, db, addBlob, args, dest: `file://${path.join(dir, 'bucket')}` };
}

test('push uploads a snapshot and the object store, never the vault key, and skips an unchanged database', async () => {
  const f = await fixture();
  const first = ok('push', ...f.args(f.dest));
  assert.equal(first.pushed, true); assert.equal(first.raw_blobs, 1);
  const bucket = path.join(f.dir, 'bucket');
  assert.ok(existsSync(path.join(bucket, 'LATEST.json')) && existsSync(path.join(bucket, first.snapshot)));
  assert.ok(!JSON.stringify(readdirSync(bucket, { recursive: true })).includes('master.key'));
  assert.ok(!readFileSync(path.join(bucket, first.snapshot)).includes('fictional-vault-key'));
  assert.equal(ok('push', ...f.args(f.dest)).pushed, false, 'unchanged content is not uploaded again');
  await f.addBlob('Fictional receipt two\n');
  const second = ok('push', ...f.args(f.dest));
  assert.equal(second.pushed, true); assert.notEqual(second.logical_sha256, first.logical_sha256); assert.equal(second.raw_blobs, 2);
  assert.equal(ok('push', ...f.args(f.dest), '--refresh-days', '0').pushed, true, 'an old snapshot is refreshed so retention never removes the newest');
  f.db.close(); rmSync(f.dir, { recursive: true, force: true });
});

test('restore verifies hashes, integrity and referenced blobs into a new directory only', async () => {
  const f = await fixture(); await f.addBlob('Fictional receipt two\n');
  ok('push', ...f.args(f.dest));
  const out = path.join(f.dir, 'restored'), r = ok('restore', '--src', f.dest, '--out', out);
  assert.equal(r.raw_blobs_verified, 2); assert.equal(r.vault_key, 'not in replica');
  assert.equal(ok('compare', '--db', path.join(f.data, 'watchdog.sqlite'), '--db', path.join(out, 'watchdog.sqlite')).equal, true);
  assert.ok(!existsSync(path.join(out, 'secrets')));
  assert.match(run('restore', '--src', f.dest, '--out', out).stderr, /existing path/);
  assert.match(run('restore', '--src', f.dest, '--out', '/var/lib/watchdog/restore-here').stderr, /live data directory/);

  const bucket = path.join(f.dir, 'bucket'), latest = JSON.parse(readFileSync(path.join(bucket, 'LATEST.json'), 'utf8'));
  const blobs = path.join(bucket, 'object_store/raw'), victim = readdirSync(blobs)[0];
  rmSync(path.join(blobs, victim));
  const broken = path.join(f.dir, 'broken');
  assert.match(run('restore', '--src', f.dest, '--out', broken).stderr, /missing 1/);
  assert.ok(!existsSync(broken), 'a failed restore leaves nothing behind');
  writeFileSync(path.join(bucket, latest.snapshot), Buffer.concat([readFileSync(path.join(bucket, latest.snapshot)), Buffer.from('x')]));
  assert.match(run('restore', '--src', f.dest, '--out', broken).stderr, /file hash does not match/);
  f.db.close(); rmSync(f.dir, { recursive: true, force: true });
});

test('the snapshot is taken from a read-only connection: a database in rollback-journal mode stays in it', async () => {
  const f = await fixture();
  ok('push', ...f.args(f.dest));
  assert.equal(f.db.pragma('journal_mode', { simple: true }), 'delete');
  assert.ok(!existsSync(path.join(f.data, 'watchdog.sqlite-wal')));
  f.db.close(); rmSync(f.dir, { recursive: true, force: true });
});
