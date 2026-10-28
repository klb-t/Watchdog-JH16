#!/usr/bin/env python3
"""Periodic off-machine copies of a WatchDog installation's data (E3.5, option B').

This is NOT Litestream and not continuous replication. Each `push` takes a
consistent SQLite snapshot with the online backup API (a read transaction; the
live database and its journal mode are not changed), uploads it only when its
logical content differs from the last upload, and copies new object-store
files. The recovery point is therefore the push interval, set where the push
is scheduled (WATCHDOG_REPLICA_INTERVAL_MINUTES in the systemd timer).

What is copied: the SQLite database and the write-once object store (raw
responses, manifests, evaluations). What is never copied: `secrets/` (the vault
key). The database holds only encrypted vault envelopes, so a replica alone
cannot decrypt stored credentials; keep the key in the separate private backup.

Order per push: snapshot, then object-store files, then the snapshot, then
LATEST.json. Every blob the snapshot references was written before the
snapshot, so it is uploaded before LATEST can point at that snapshot.

Destinations: gs://bucket/prefix (through `gcloud storage`, with the machine's
own credentials) or file:///path (for restore tests). Remote files are never
deleted by this tool; retention is the bucket's lifecycle rule, and `push`
re-uploads an unchanged database every --refresh-days so the newest snapshot
never ages out.

`restore` writes into a new private directory only, verifies file and logical
hashes, SQLite integrity and every referenced raw blob, and refuses the live
data directory.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time

FORMAT = 'watchdog-replica-v1'
LIVE_DATA = Path('/var/lib/watchdog')
NEVER_COPIED = ('secrets',)


class ReplicaError(Exception):
    pass


def demand(condition, message):
    if not condition:
        raise ReplicaError(message)


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def utc_now():
    return time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())


# ------------------------------------------------------------------ SQLite

def snapshot(db, out):
    """Consistent copy through the online backup API, read-only on the source."""
    source = sqlite3.connect(Path(db).resolve().as_uri() + '?mode=ro', uri=True, timeout=30)
    try:
        target = sqlite3.connect(out)
        try:
            source.backup(target)
        finally:
            target.close()
    finally:
        source.close()


def inspect(path):
    """quick_check, logical digest, migrations and raw-blob references of a database file."""
    connection = sqlite3.connect(Path(path).resolve().as_uri() + '?mode=ro', uri=True)
    try:
        connection.execute('PRAGMA query_only=ON')
        demand(connection.execute('PRAGMA quick_check').fetchall() == [('ok',)], f'SQLite quick_check failed: {path}')
        digest = hashlib.sha256()
        for line in connection.iterdump():
            digest.update(line.encode('utf-8'))
            digest.update(b'\n')
        migrations = [row[0] for row in connection.execute('SELECT id FROM schema_migrations ORDER BY id')]
        blobs = sorted(row[0] for row in connection.execute('SELECT sha256 FROM raw_blobs'))
        return {'logical_sha256': digest.hexdigest(), 'migrations': migrations, 'raw_blobs': blobs}
    finally:
        connection.close()


# ------------------------------------------------------------ destinations

class FileDestination:
    def __init__(self, root):
        self.root = Path(root)

    def put(self, local, name, replace=False):
        target = self.root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        if target.exists() and not replace:
            demand(sha256_file(target) == sha256_file(local), f'Remote {name} holds different bytes')
            return
        temporary = target.with_name(target.name + '.partial')
        shutil.copyfile(local, temporary)
        os.replace(temporary, target)

    def get(self, name, local):
        source = self.root / name
        demand(source.is_file(), f'Missing in replica: {name}')
        shutil.copyfile(source, local)

    def sync_up(self, directory, prefix):
        for path in sorted(Path(directory).rglob('*')):
            if path.is_file():
                self.put(path, f'{prefix}/{path.relative_to(directory).as_posix()}')

    def sync_down(self, prefix, directory):
        source = self.root / prefix
        if source.is_dir():
            shutil.copytree(source, directory, dirs_exist_ok=False)
        else:
            Path(directory).mkdir()


class GcsDestination:
    def __init__(self, url):
        self.url = url.rstrip('/')

    def _run(self, *args):
        result = subprocess.run(['gcloud', 'storage', *args], capture_output=True, text=True)
        demand(result.returncode == 0, f'gcloud storage {args[0]} failed: {result.stderr.strip()[-400:]}')

    def put(self, local, name, replace=False):
        self._run('cp', *([] if replace else ['--no-clobber']), str(local), f'{self.url}/{name}')

    def get(self, name, local):
        self._run('cp', f'{self.url}/{name}', str(local))

    def sync_up(self, directory, prefix):
        # Never deletes remote objects: the local store is write-once.
        self._run('rsync', '--recursive', str(directory), f'{self.url}/{prefix}')

    def sync_down(self, prefix, directory):
        Path(directory).mkdir()
        self._run('rsync', '--recursive', f'{self.url}/{prefix}', str(directory))


def destination(url):
    if url.startswith('gs://'):
        return GcsDestination(url)
    if url.startswith('file://'):
        return FileDestination(url[len('file://'):])
    raise ReplicaError('Destination must be gs://bucket/prefix or file:///path')


# ------------------------------------------------------------------ commands

def push(args):
    dest = destination(args.dest)
    state_path = Path(args.state)
    state = json.loads(state_path.read_text()) if state_path.exists() else {}
    store = Path(args.store)
    demand(store.is_dir(), f'Object store not found: {store}')
    demand(not any(part in NEVER_COPIED for part in store.resolve().parts), 'The object store path must not be inside secrets/')
    with tempfile.TemporaryDirectory(prefix='watchdog-replica-') as work:
        snap = Path(work) / 'watchdog.sqlite'
        snapshot(args.db, snap)
        info = inspect(snap)
        age_days = (time.time() - state.get('pushed_epoch', 0)) / 86400
        if state.get('logical_sha256') == info['logical_sha256'] and age_days < args.refresh_days:
            dest.sync_up(store, 'object_store')
            print(json.dumps({'pushed': False, 'reason': 'unchanged', 'logical_sha256': info['logical_sha256']}))
            return
        name = f'db/{utc_now()}-{info["logical_sha256"][:16]}'
        manifest = {'format': FORMAT, 'created_utc': utc_now(), 'snapshot': f'{name}.sqlite', 'byte_size': snap.stat().st_size,
                    'file_sha256': sha256_file(snap), 'logical_sha256': info['logical_sha256'],
                    'migrations': info['migrations'], 'raw_blobs': len(info['raw_blobs']), 'not_copied': list(NEVER_COPIED)}
        manifest_path = Path(work) / 'manifest.json'
        manifest_path.write_text(json.dumps(manifest, indent=1, sort_keys=True) + '\n')
        dest.sync_up(store, 'object_store')
        dest.put(snap, f'{name}.sqlite')
        dest.put(manifest_path, f'{name}.json')
        dest.put(manifest_path, 'LATEST.json', replace=True)
        state_path.write_text(json.dumps({'logical_sha256': info['logical_sha256'], 'pushed_epoch': time.time(), 'snapshot': manifest['snapshot']}) + '\n')
        print(json.dumps({'pushed': True, **{k: manifest[k] for k in ('snapshot', 'file_sha256', 'logical_sha256', 'raw_blobs')}}))


def restore(args):
    out = Path(args.out).absolute()
    demand(not out.exists(), f'Refusing to restore into an existing path: {out}')
    demand(LIVE_DATA not in (out, *out.parents), 'Refusing to restore into the live data directory')
    src = destination(args.src)
    out.mkdir(mode=0o700, parents=False)
    try:
        latest = out / '.manifest.json'
        src.get(args.snapshot.replace('.sqlite', '.json') if args.snapshot else 'LATEST.json', latest)
        manifest = json.loads(latest.read_text())
        demand(manifest.get('format') == FORMAT, 'Unknown replica format')
        db = out / 'watchdog.sqlite'
        src.get(manifest['snapshot'], db)
        demand(sha256_file(db) == manifest['file_sha256'], 'Snapshot file hash does not match its manifest')
        info = inspect(db)
        demand(info['logical_sha256'] == manifest['logical_sha256'], 'Snapshot logical content does not match its manifest')
        src.sync_down('object_store', out / 'object_store')
        missing, corrupt = [], []
        for sha in info['raw_blobs']:
            blob = out / 'object_store' / 'raw' / sha
            if not blob.is_file():
                missing.append(sha)
            elif sha256_file(blob) != sha:
                corrupt.append(sha)
        demand(not missing and not corrupt, f'Referenced raw blobs missing {len(missing)}, corrupt {len(corrupt)}')
        print(json.dumps({'restored': str(out), 'snapshot': manifest['snapshot'], 'logical_sha256': info['logical_sha256'],
                          'migrations': len(info['migrations']), 'raw_blobs_verified': len(info['raw_blobs']), 'vault_key': 'not in replica'}))
    except BaseException:
        shutil.rmtree(out, ignore_errors=True)
        raise


def compare(args):
    """Logical equality of two databases (the live one is read through a snapshot)."""
    with tempfile.TemporaryDirectory(prefix='watchdog-replica-') as work:
        digests = []
        for i, path in enumerate(args.db):
            snap = Path(work) / f'{i}.sqlite'
            snapshot(path, snap)
            digests.append(inspect(snap)['logical_sha256'])
    print(json.dumps({'equal': len(set(digests)) == 1, 'logical_sha256': digests}))
    return 0 if len(set(digests)) == 1 else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    sub = parser.add_subparsers(dest='command', required=True)
    p = sub.add_parser('push')
    p.add_argument('--db', required=True); p.add_argument('--store', required=True)
    p.add_argument('--dest', required=True); p.add_argument('--state', required=True)
    p.add_argument('--refresh-days', type=float, default=7.0)
    r = sub.add_parser('restore')
    r.add_argument('--src', required=True); r.add_argument('--out', required=True); r.add_argument('--snapshot')
    c = sub.add_parser('compare')
    c.add_argument('--db', action='append', required=True)
    args = parser.parse_args()
    try:
        return {'push': push, 'restore': restore, 'compare': compare}[args.command](args) or 0
    except (ReplicaError, OSError, sqlite3.Error, ValueError, KeyError) as error:
        print(f'ERROR: {error}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
