import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { runMigrations } from '../../backend/watchdog_api/db/migrations';
import { SettingsRepository } from '../../backend/watchdog_api/db/repositories/settings';
import { LocalFileSystemStore } from '../../backend/watchdog_api/storage/object_store';
import { UserVault } from '../../backend/watchdog_api/secrets/user_vault';

const helper = path.resolve('scripts/watchdog_backup.py');
const IMAGE = `sha256:${'3a'.repeat(32)}`, COMMIT = '12'.repeat(20);
const SECRET = 'fictional-restore-only-credential-2026';
const DB = 'var/lib/watchdog/watchdog.sqlite', KEY = 'var/lib/watchdog/secrets/master.key';
const BLOB = Buffer.from('Fictional immutable source receipt\nNo live user data.\n');
const blobHash = createHash('sha256').update(BLOB).digest('hex');
const blobPath = `var/lib/watchdog/object_store/raw/${blobHash}`;

function cli(...args: string[]) {
  return spawnSync('python3', [helper, ...args], { encoding: 'utf8', timeout: 20000 });
}
function success(...args: string[]) {
  const result = cli(...args);
  assert.equal(result.status, 0, `${args[0]} failed: ${result.stderr}\n${result.stdout}`);
  assert.ok(!result.stdout.includes(SECRET) && !result.stderr.includes(SECRET));
  return result;
}
function snapshot(root: string): Record<string, { mode: number; hash?: string }> {
  const result: Record<string, { mode: number; hash?: string }> = {};
  function visit(relative: string) {
    const full = path.join(root, relative), stat = lstatSync(full);
    result[relative] = { mode: stat.mode & 0o7777, ...(stat.isFile() ? { hash: createHash('sha256').update(readFileSync(full)).digest('hex') } : {}) };
    if (stat.isDirectory()) for (const item of readdirSync(full).sort()) visit(path.join(relative, item));
  }
  visit(''); return result;
}
async function fixture() {
  const dir = mkdtempSync(path.join(tmpdir(), 'watchdog-backup-')), root = path.join(dir, 'source');
  const write = (relative: string, bytes: string | Buffer, mode = 0o600) => {
    const full = path.join(root, relative); mkdirSync(path.dirname(full), { recursive: true, mode: 0o700 });
    writeFileSync(full, bytes, { mode }); return full;
  };
  write('etc/watchdog/app.env', 'DB_PATH=/mnt/watchdog/watchdog.sqlite\nSTORE_BACKEND=local\nSTORE_PATH=/mnt/watchdog/object_store\nWATCHDOG_VAULT_KEY_FILE=/mnt/watchdog/secrets/master.key\nSESSION_SIGNING_KEY=fictional-session-signing-key-only\n');
  write('etc/watchdog/release.env', `WATCHDOG_COMMIT=${COMMIT}\nWATCHDOG_IMAGE=watchdog:fixture\n`);
  write('etc/watchdog/installer-v1', '');
  write('etc/systemd/system/watchdog.service', '[Service]\nExecStart=/usr/bin/docker start -a watchdog\n', 0o644);
  write('usr/local/sbin/watchdogctl', '#!/bin/sh\necho fixture-control\n', 0o755);
  mkdirSync(path.join(root, 'var/lib/watchdog'), { recursive: true, mode: 0o700 });
  const db = new Database(path.join(root, DB));
  db.pragma('foreign_keys = ON'); runMigrations(db);
  const store = new LocalFileSystemStore(path.join(root, 'var/lib/watchdog/object_store'));
  await store.put(`raw/${blobHash}`, BLOB);
  db.prepare('INSERT INTO raw_blobs VALUES (?,?,?,?,?,?,?)').run('restore-fixture', blobHash,
    `file:///mnt/watchdog/object_store/raw/${blobHash}`, BLOB.length, 'text/plain', 'fixture', '2026-09-30T00:00:00Z');
  const vault = new UserVault(new SettingsRepository(db, store), path.join(root, KEY), {});
  vault.save('local-user', 'openrouter', SECRET);
  const migrations = db.prepare('SELECT id,applied_at FROM schema_migrations ORDER BY id').all();
  const schema = db.prepare("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
  db.close();
  chmodSync(path.join(root, DB), 0o400); // A cold, read-only source must survive backup unchanged.
  const archive = path.join(dir, 'fixture.tar.gz');
  return { dir, root, archive, migrations, schema, close: () => rmSync(dir, { recursive: true, force: true }) };
}
function create(f: Awaited<ReturnType<typeof fixture>>) {
  success('create', '--root', f.root, '--output', f.archive, '--image-id', IMAGE);
}
function readManifest(archive: string) {
  const result = spawnSync('python3', ['-c', 'import sys,tarfile; t=tarfile.open(sys.argv[1]); print(t.extractfile("manifest.json").read().decode())', archive], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout);
}
// Rewrite a genuine backup and re-sign its outer checksum. This ensures rejection
// exercises archive validation, rather than stopping at the transport checksum.
function mutateArchive(source: string, target: string, kind: string, targetPath = '') {
  const script = `import sys,tarfile,io,json,hashlib,copy,os
source,target,kind,target_path=sys.argv[1:]
with tarfile.open(source,'r:gz') as archive:
    rows=[(copy.copy(m),archive.extractfile(m).read() if m.isfile() else None) for m in archive.getmembers()]
manifest=json.loads(next(b for m,b in rows if m.name=='manifest.json'))
chosen=next(m.name for m,b in rows if m.name.startswith('var/lib/watchdog/object_store/raw/') and m.isfile())
if kind=='missing':
    rows=[(m,b) for m,b in rows if m.name!='var/lib/watchdog/watchdog.sqlite']
    manifest['entries']=[e for e in manifest['entries'] if e['path']!='var/lib/watchdog/watchdog.sqlite']
else:
    m,b=next((m,b) for m,b in rows if m.name==chosen)
    entry=next(e for e in manifest['entries'] if e['path']==chosen)
    if kind in ('traversal','absolute'):
        m.name=target_path; entry['path']=target_path
    elif kind=='symlink':
        m.type=tarfile.SYMTYPE; m.linkname=target_path; m.size=0; entry['type']='symlink'
    elif kind=='hardlink':
        m.type=tarfile.LNKTYPE; m.linkname=target_path; m.size=0; entry['type']='hardlink'
    elif kind=='mode':
        m.mode=0o4755; entry['mode']=0o4755; entry['source_mode']=0o4755
    elif kind=='duplicate': rows.append((copy.copy(m),b))
    elif kind=='payload':
        rows=[(i,b'X'+data[1:] if i.name==chosen else data) for i,data in rows]
with tarfile.open(target,'w:gz') as archive:
    for m,b in rows:
        if m.name=='manifest.json': b=json.dumps(manifest).encode(); m.size=len(b)
        archive.addfile(m,io.BytesIO(b) if m.isfile() else None)
os.chmod(target,0o600)
with open(target+'.sha256','w') as sidecar: sidecar.write(hashlib.sha256(open(target,'rb').read()).hexdigest()+'  '+os.path.basename(target)+'\\n')
os.chmod(target+'.sha256',0o600)
`;
  const result = spawnSync('python3', ['-c', script, source, target, kind, targetPath], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}

test('operations: cold backup restores real schema, record, object bytes and encrypted UserVault with image identity', async () => {
  const f = await fixture();
  try {
    const before = snapshot(f.root); create(f);
    assert.deepEqual(snapshot(f.root), before, 'backup must not chmod, rewrite or remove source data');
    assert.equal(statSync(f.archive).mode & 0o777, 0o600);
    assert.equal(statSync(`${f.archive}.sha256`).mode & 0o777, 0o600);
    success('verify', '--archive', f.archive);
    const manifest = readManifest(f.archive);
    assert.equal(manifest.schema_version, 1); assert.equal(manifest.image_id, IMAGE); assert.equal(manifest.commit, COMMIT);
    const destination = path.join(f.dir, 'restored');
    const recovered = JSON.parse(success('restore', '--archive', f.archive, '--destination', destination).stdout);
    assert.equal(recovered.image_id, IMAGE); assert.equal(recovered.commit, COMMIT);
    assert.deepEqual(recovered.database, manifest.database);
    assert.deepEqual(JSON.parse(readFileSync(path.join(destination, 'manifest.json'), 'utf8')), manifest);
    assert.equal(statSync(path.join(destination, 'manifest.json')).mode & 0o777, 0o600);
    const db = new Database(path.join(destination, DB), { readonly: true });
    try {
      assert.deepEqual(db.prepare('SELECT id,applied_at FROM schema_migrations ORDER BY id').all(), f.migrations);
      assert.deepEqual(db.prepare("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all(), f.schema);
      const blob = db.prepare('SELECT * FROM raw_blobs WHERE id=?').get('restore-fixture') as any;
      assert.equal(blob.sha256, blobHash); assert.equal(blob.object_uri, `file:///mnt/watchdog/object_store/raw/${blobHash}`);
      const store = new LocalFileSystemStore(path.join(destination, 'var/lib/watchdog/object_store'));
      // Isolated restore changes only the host root; container paths in DB are preserved.
      assert.deepEqual(await store.get(`file://${path.join(destination, blobPath)}`), BLOB);
      const vault = new UserVault(new SettingsRepository(db, store), path.join(destination, KEY), {});
      assert.equal(vault.resolve('local-user', 'openrouter').use(value => value), SECRET);
      assert.equal(vault.resolve('other-user', 'openrouter').status, 'absent');
      assert.ok(!readFileSync(path.join(destination, DB)).includes(Buffer.from(SECRET)));
      assert.equal(statSync(path.join(destination, KEY)).mode & 0o777, 0o600);
      assert.equal(readFileSync(path.join(destination, 'etc/watchdog/app.env'), 'utf8'), readFileSync(path.join(f.root, 'etc/watchdog/app.env'), 'utf8'));
      for (const file of ['etc/systemd/system/watchdog.service', 'usr/local/sbin/watchdogctl'])
        assert.deepEqual(readFileSync(path.join(destination, file)), readFileSync(path.join(f.root, file)));
    } finally { db.close(); }
    assert.deepEqual(snapshot(f.root), before, 'restore must leave source installation intact');
  } finally { f.close(); }
});

test('operations: truncated bytes and missing checksum fail without creating a destination', async () => {
  const f = await fixture();
  try {
    create(f);
    const noChecksum = path.join(f.dir, 'no-checksum.tar.gz'); writeFileSync(noChecksum, readFileSync(f.archive), { mode: 0o600 });
    for (const archive of [noChecksum, f.archive]) {
      if (archive === f.archive) writeFileSync(archive, readFileSync(archive).subarray(0, 120));
      const destination = path.join(f.dir, 'rejected');
      assert.notEqual(cli('verify', '--archive', archive).status, 0);
      assert.notEqual(cli('restore', '--archive', archive, '--destination', destination).status, 0);
      assert.equal(existsSync(destination), false);
    }
  } finally { f.close(); }
});

for (const kind of ['missing', 'payload', 'traversal', 'absolute', 'symlink', 'hardlink', 'duplicate', 'mode']) {
  test(`operations: reject ${kind} archive even with a matching outer checksum`, async () => {
    const f = await fixture();
    try {
      create(f); const before = snapshot(f.root);
      const target = path.join(f.dir, 'outside-canary'); writeFileSync(target, 'untouched');
      const bad = path.join(f.dir, `bad-${kind}.tar.gz`), destination = path.join(f.dir, 'rejected');
      mutateArchive(f.archive, bad, kind, kind === 'traversal' ? '../outside-canary' : target);
      assert.notEqual(cli('verify', '--archive', bad).status, 0, 'verify must reject malformed archive');
      assert.notEqual(cli('restore', '--archive', bad, '--destination', destination).status, 0);
      assert.equal(existsSync(destination), false, 'failed validation must not publish a destination');
      assert.equal(readFileSync(target, 'utf8'), 'untouched');
      assert.deepEqual(snapshot(f.root), before);
    } finally { f.close(); }
  });
}

test('operations: restore refuses existing directories, files and symlink destinations without altering them', async () => {
  const f = await fixture();
  try {
    create(f);
    const existing = path.join(f.dir, 'existing'); mkdirSync(existing); writeFileSync(path.join(existing, 'sentinel'), 'keep');
    const link = path.join(f.dir, 'link'); symlinkSync(existing, link);
    const dangling = path.join(f.dir, 'dangling'); symlinkSync(path.join(f.dir, 'absent-target'), dangling);
    const file = path.join(f.dir, 'existing-file'); writeFileSync(file, 'keep-file');
    const before = snapshot(existing);
    for (const destination of [existing, link, dangling, file])
      assert.notEqual(cli('restore', '--archive', f.archive, '--destination', destination).status, 0);
    assert.deepEqual(snapshot(existing), before); assert.equal(readFileSync(file, 'utf8'), 'keep-file');
    assert.ok(lstatSync(link).isSymbolicLink()); assert.ok(lstatSync(dangling).isSymbolicLink());
    assert.equal(existsSync(path.join(f.dir, 'absent-target')), false);
  } finally { f.close(); }
});

test('operations: incomplete source, mutable image tag and linked source data cannot produce a published backup', async () => {
  const f = await fixture();
  try {
    const before = snapshot(f.root);
    assert.notEqual(cli('create', '--root', f.root, '--output', f.archive, '--image-id', 'watchdog:latest').status, 0);
    assert.equal(existsSync(f.archive), false); assert.deepEqual(snapshot(f.root), before);
    rmSync(path.join(f.root, KEY));
    assert.notEqual(cli('create', '--root', f.root, '--output', f.archive, '--image-id', IMAGE).status, 0);
    assert.equal(existsSync(f.archive), false, 'encrypted credentials without their vault key are not recoverable');
    const externalKey = path.join(f.dir, 'external-key'); writeFileSync(externalKey, Buffer.alloc(32, 1), { mode: 0o600 });
    symlinkSync(externalKey, path.join(f.root, KEY));
    assert.notEqual(cli('create', '--root', f.root, '--output', f.archive, '--image-id', IMAGE).status, 0);
    assert.equal(existsSync(f.archive), false); assert.deepEqual(readFileSync(externalKey), Buffer.alloc(32, 1));
  } finally { f.close(); }
});

test('operations: committed WAL-only data survives backup without modifying the source SQLite files', async () => {
  const f = await fixture(); let writer: Database.Database | undefined;
  try {
    chmodSync(path.join(f.root, DB), 0o600);
    writer = new Database(path.join(f.root, DB));
    writer.pragma('journal_mode = WAL'); writer.pragma('wal_autocheckpoint = 0');
    writer.exec("CREATE TABLE operations_wal_fixture (id TEXT PRIMARY KEY, value TEXT NOT NULL); INSERT INTO operations_wal_fixture VALUES ('pending-checkpoint', 'committed-in-WAL');");
    assert.ok(statSync(path.join(f.root, `${DB}-wal`)).size > 0);
    const schemaVersion = writer.pragma('schema_version', { simple: true });
    const before = snapshot(f.root); create(f);
    assert.deepEqual(snapshot(f.root), before);
    const destination = path.join(f.dir, 'wal-restored');
    success('restore', '--archive', f.archive, '--destination', destination);
    const restored = new Database(path.join(destination, DB), { readonly: true });
    try {
      assert.deepEqual(restored.prepare('SELECT * FROM operations_wal_fixture').all(), [{ id: 'pending-checkpoint', value: 'committed-in-WAL' }]);
      const manifest = JSON.parse(readFileSync(path.join(destination, 'manifest.json'), 'utf8'));
      assert.equal(manifest.database.schema_version, schemaVersion);
    } finally { restored.close(); }
    assert.deepEqual(snapshot(f.root), before);
  } finally { writer?.close(); f.close(); }
});

test('operations: environment vault key takes precedence and remains decryptable after isolated restore', async () => {
  const f = await fixture();
  try {
    const envKey = readFileSync(path.join(f.root, KEY)).toString('base64');
    const config = path.join(f.root, 'etc/watchdog/app.env');
    writeFileSync(config, readFileSync(config, 'utf8') + `WATCHDOG_VAULT_KEY=${envKey}\n`);
    writeFileSync(path.join(f.root, KEY), Buffer.alloc(32, 7)); // Valid but deliberately wrong file key.
    create(f);
    const destination = path.join(f.dir, 'env-restored');
    const metadata = JSON.parse(success('restore', '--archive', f.archive, '--destination', destination).stdout);
    assert.equal(metadata.vault_key_source, 'environment');
    const db = new Database(path.join(destination, DB), { readonly: true });
    try {
      const store = new LocalFileSystemStore(path.join(destination, 'var/lib/watchdog/object_store'));
      const repo = new SettingsRepository(db, store), key = path.join(destination, KEY);
      const recoveredEnv = readFileSync(path.join(destination, 'etc/watchdog/app.env'), 'utf8').split('\n').find(line => line.startsWith('WATCHDOG_VAULT_KEY='))!.slice('WATCHDOG_VAULT_KEY='.length);
      assert.equal(new UserVault(repo, key, {}).resolve('local-user', 'openrouter').status, 'invalid');
      assert.equal(new UserVault(repo, key, { WATCHDOG_VAULT_KEY: recoveredEnv }).resolve('local-user', 'openrouter').use(value => value), SECRET);
    } finally { db.close(); }
  } finally { f.close(); }
});

test('operations: a never-used vault needs no generated key, but malformed environment keys are rejected', async () => {
  const f = await fixture();
  try {
    chmodSync(path.join(f.root, DB), 0o600);
    const db = new Database(path.join(f.root, DB)); db.exec('DELETE FROM user_secret_envelopes'); db.close();
    rmSync(path.join(f.root, KEY)); create(f);
    assert.equal(readManifest(f.archive).vault_key_source, 'absent-unused');
    const destination = path.join(f.dir, 'unused-restored');
    success('restore', '--archive', f.archive, '--destination', destination);
    assert.equal(existsSync(path.join(destination, KEY)), false);
    const config = path.join(f.root, 'etc/watchdog/app.env');
    writeFileSync(config, readFileSync(config, 'utf8') + 'WATCHDOG_VAULT_KEY=not-canonical-base64\n');
    const badOutput = path.join(f.dir, 'bad-env.tar.gz');
    assert.notEqual(cli('create', '--root', f.root, '--output', badOutput, '--image-id', IMAGE).status, 0);
    assert.equal(existsSync(badOutput), false);
  } finally { f.close(); }
});

test('operations: public key permissions, external storage and special source files fail closed', async () => {
  const f = await fixture();
  try {
    const rejected = () => {
      assert.notEqual(cli('create', '--root', f.root, '--output', f.archive, '--image-id', IMAGE).status, 0);
      assert.equal(existsSync(f.archive), false); assert.equal(existsSync(`${f.archive}.sha256`), false);
    };
    chmodSync(path.join(f.root, KEY), 0o644); rejected(); chmodSync(path.join(f.root, KEY), 0o600);
    const config = path.join(f.root, 'etc/watchdog/app.env'), original = readFileSync(config, 'utf8');
    writeFileSync(config, original.replace('DB_PATH=/mnt/watchdog/watchdog.sqlite', 'DB_PATH=/other/database.sqlite')); rejected();
    writeFileSync(config, original);
    const fifo = path.join(f.root, 'var/lib/watchdog/unsafe-fifo');
    const result = spawnSync('python3', ['-c', 'import os,sys; os.mkfifo(sys.argv[1],0o600)', fifo], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr); rejected();
    assert.ok(lstatSync(fifo).isFIFO());
  } finally { f.close(); }
});

test('operations: a hot rollback journal is refused without blessing uncommitted pages or mutating source', async () => {
  const f = await fixture();
  try {
    chmodSync(path.join(f.root, DB), 0o600);
    const crash = spawnSync('python3', ['-c', `import os,sqlite3,sys
connection=sqlite3.connect(sys.argv[1])
connection.execute('PRAGMA journal_mode=DELETE')
connection.execute('PRAGMA cache_size=5')
connection.execute('CREATE TABLE operations_crash_fixture (id INTEGER PRIMARY KEY, value TEXT NOT NULL)')
connection.executemany('INSERT INTO operations_crash_fixture VALUES (?,?)',((i,'old'+('x'*2048)) for i in range(500)))
connection.commit()
connection.execute('BEGIN IMMEDIATE')
connection.execute("UPDATE operations_crash_fixture SET value='new'||substr(value,4)")
os._exit(0)
`, path.join(f.root, DB)], { encoding: 'utf8', timeout: 20000 });
    assert.equal(crash.status, 0, crash.stderr);
    assert.ok(statSync(path.join(f.root, `${DB}-journal`)).size > 0);
    const before = snapshot(f.root);
    assert.notEqual(cli('create', '--root', f.root, '--output', f.archive, '--image-id', IMAGE).status, 0);
    assert.equal(existsSync(f.archive), false); assert.equal(existsSync(`${f.archive}.sha256`), false);
    assert.deepEqual(snapshot(f.root), before);
  } finally { f.close(); }
});

test('operations: a declared immutable release image must agree with the captured runtime image', async () => {
  const f = await fixture();
  try {
    writeFileSync(path.join(f.root, 'etc/watchdog/release.env'), `WATCHDOG_COMMIT=${COMMIT}\nWATCHDOG_IMAGE=sha256:${'ff'.repeat(32)}\n`);
    const before = snapshot(f.root);
    assert.notEqual(cli('create', '--root', f.root, '--output', f.archive, '--image-id', IMAGE).status, 0);
    assert.equal(existsSync(f.archive), false); assert.deepEqual(snapshot(f.root), before);
  } finally { f.close(); }
});
