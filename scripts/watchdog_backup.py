#!/usr/bin/env python3
"""Private, versioned backups for the managed disk-backed WatchDog installation.

The caller must stop the sole writer and hold the installation lock. This helper
never runs Docker, archived scripts, environment files, or migrations. Checksums
provide corruption detection, not authenticity against an attacker who can replace
both archive and sidecar. Restore publishes a private, inert directory only.

Limits (format v1): 100,000 entries, 10 GiB/file, 20 GiB payload/compressed archive,
32 MiB manifest, 512-byte path and depth 64. SQLite checks have a 60-second budget.
Linux renameat2 is required for atomic, no-replace directory publication. Source
and destination parent directories must be trusted and remain unchanged during
operation. Symlinks, hardlinked regular files and special files are never accepted.
"""
import argparse
import base64
import ctypes
import errno
import gzip
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import sqlite3
import stat
import sys
import tarfile
import tempfile
import time

VERSION = 1
MAX_ENTRIES = 100_000
MAX_FILE = 10 * 1024**3
MAX_TOTAL = 20 * 1024**3
MAX_MANIFEST = 32 * 1024**2
MAX_TAR = MAX_TOTAL + MAX_ENTRIES * 4096 + MAX_MANIFEST
BLOCK = 1024**2
DIRECTORIES = ('etc/watchdog', 'var/lib/watchdog')
FIXED_FILES = ('etc/systemd/system/watchdog.service', 'usr/local/sbin/watchdogctl')
OPTIONAL = 'usr/local/lib/watchdog/watchdog_backup.py'
OPTIONAL_FILES = (OPTIONAL, 'usr/local/lib/watchdog/watchdog_access.sh', 'etc/systemd/system/watchdog-proxy.service')
REQUIRED = ('etc/watchdog/app.env', 'etc/watchdog/release.env',
            'etc/watchdog/installer-v1', 'var/lib/watchdog/watchdog.sqlite') + FIXED_FILES
DB = 'var/lib/watchdog/watchdog.sqlite'
KEY = 'var/lib/watchdog/secrets/master.key'
IMAGE_RE = re.compile(r'sha256:[0-9a-f]{64}\Z')
HASH_RE = re.compile(r'[0-9a-f]{64}\Z')
SCAFFOLDS = {str(p) for name in DIRECTORIES + FIXED_FILES + OPTIONAL_FILES
             for p in PurePosixPath(name).parents if str(p) != '.'}


class BackupError(Exception):
    pass


def demand(condition, message):
    if not condition:
        raise BackupError(message)


def safe_name(name):
    demand(isinstance(name, str) and 0 < len(name.encode('utf-8')) <= 512,
           'Invalid archive path length')
    demand(not name.startswith('/') and '\\' not in name and
           all(c not in ('', '.', '..') for c in name.split('/')) and
           not any(ord(c) < 32 or ord(c) == 127 for c in name) and
           len(name.split('/')) <= 64, 'Unsafe archive path')
    return name


def allowed(name):
    return name in SCAFFOLDS or name in FIXED_FILES or name in OPTIONAL_FILES or any(
        name == d or name.startswith(d + '/') for d in DIRECTORIES)


def absolute_path(value):
    path = Path(value)
    demand(path.is_absolute() and '..' not in path.parts,
           'An absolute path without parent traversal is required')
    demand(not any(ord(c) < 32 or ord(c) == 127 for c in str(path)), 'Invalid filesystem path')
    for parent in list(reversed(path.parents)) + [path]:
        if parent.is_symlink():
            raise BackupError('Symlink filesystem paths are not accepted')
    return path


def regular_open(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    info = os.fstat(fd)
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
        os.close(fd)
        raise BackupError('Expected a regular file with a single link')
    return os.fdopen(fd, 'rb')


def digest_file(path):
    with regular_open(path) as source:
        digest = hashlib.sha256()
        while chunk := source.read(BLOCK):
            digest.update(chunk)
        return digest.hexdigest()


def read_small(path, limit=MAX_MANIFEST):
    with regular_open(path) as source:
        data = source.read(limit + 1)
        demand(len(data) <= limit, 'Metadata file exceeds size limit')
        return data


def parse_env(path):
    result = {}
    for line in read_small(path, 1024**2).decode('utf-8').splitlines():
        if not line.strip() or line.lstrip().startswith('#'):
            continue
        match = re.fullmatch(r'([A-Za-z_][A-Za-z0-9_]*)=(.*)', line)
        demand(match is not None, 'Environment file must use literal KEY=value lines')
        key, value = match.groups()
        demand(key not in result, 'Duplicate environment key')
        demand('\x00' not in value, 'Invalid environment value')
        result[key] = value
    return result


def database_metadata(root):
    # SQLite may create/update WAL shared memory even with mode=ro. Inspect a
    # separate private copy so verification cannot alter the recovered bytes.
    with tempfile.TemporaryDirectory(prefix='watchdog-db-check-') as work:
        probe = Path(work) / 'watchdog.sqlite'
        for suffix in ('', '-wal', '-shm', '-journal'):
            source = root / (DB + suffix)
            if source.exists():
                shutil.copyfile(source, str(probe) + suffix)
                os.chmod(str(probe) + suffix, 0o600)
        connection = sqlite3.connect(probe.as_uri() + '?mode=ro', uri=True, timeout=1)
        try:
            connection.enable_load_extension(False)
            connection.execute('PRAGMA query_only=ON')
            connection.execute('PRAGMA trusted_schema=OFF')
            deadline = time.monotonic() + 60
            connection.set_progress_handler(lambda: int(time.monotonic() > deadline), 10000)
            demand(connection.execute('PRAGMA quick_check').fetchall() == [('ok',)],
                   'SQLite quick_check failed')
            rows = connection.execute('SELECT id FROM schema_migrations ORDER BY id').fetchmany(1001)
            ids = [row[0] for row in rows]
            demand(0 < len(ids) <= 1000 and len(ids) == len(set(ids)) and all(
                isinstance(item, str) and re.fullmatch(r'[0-9]{3}_[a-z0-9_]+', item)
                for item in ids), 'Missing or invalid schema migration history')
            tables = {row[0] for row in connection.execute(
                "SELECT name FROM sqlite_schema WHERE type='table'")}
            envelopes = connection.execute('SELECT count(*) FROM user_secret_envelopes').fetchone()[0] \
                if 'user_secret_envelopes' in tables else 0
            schema = connection.execute(
                'SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').fetchall()
            return {'user_version': connection.execute('PRAGMA user_version').fetchone()[0],
                    'schema_version': connection.execute('PRAGMA schema_version').fetchone()[0],
                    'migrations': ids, 'vault_envelopes': envelopes,
                    'schema_sha256': hashlib.sha256(json.dumps(schema, separators=(',', ':'),
                                                               ensure_ascii=True).encode()).hexdigest()}
        finally:
            connection.close()


def inspect_payload(root, image_id):
    for name in REQUIRED:
        demand((root / name).is_file(), 'Required backup file missing: ' + name)
    demand((root / 'var/lib/watchdog/object_store').is_dir(), 'Object store directory missing')
    config = parse_env(root / 'etc/watchdog/app.env')
    expected = {'DB_PATH': '/mnt/watchdog/watchdog.sqlite', 'STORE_BACKEND': 'local',
                'STORE_PATH': '/mnt/watchdog/object_store'}
    for key, value in expected.items():
        demand(config.get(key) == value, 'Unsupported managed storage configuration: ' + key)
    demand(config.get('WATCHDOG_VAULT_KEY_FILE', '/mnt/watchdog/secrets/master.key') ==
           '/mnt/watchdog/secrets/master.key', 'External vault key paths are unsupported')
    diagnostic = config.get('WATCHDOG_DIAGNOSTICS_DIR', '/mnt/watchdog/diagnostics')
    demand(diagnostic.startswith('/mnt/watchdog/') and '..' not in diagnostic.split('/'),
           'External diagnostic paths are unsupported')
    release = parse_env(root / 'etc/watchdog/release.env')
    recorded_image = release.get('WATCHDOG_IMAGE', '')
    if recorded_image.startswith('sha256:'):
        demand(recorded_image == image_id, 'Release image disagrees with backup image identity')
    if release.get('WATCHDOG_IMAGE_ID'):
        demand(release['WATCHDOG_IMAGE_ID'] == image_id, 'Release image ID disagrees with backup image identity')
    commit = release.get('WATCHDOG_COMMIT', '')
    demand(re.fullmatch(r'[0-9a-f]{40}', commit), 'Release commit must be a full lowercase SHA')
    database = database_metadata(root)
    key_source = 'absent-unused'
    if config.get('WATCHDOG_VAULT_KEY'):
        try:
            encoded = config['WATCHDOG_VAULT_KEY']
            key = base64.b64decode(encoded, validate=True)
            demand(len(key) == 32 and base64.b64encode(key).decode() == encoded,
                   'Environment vault key must encode exactly 32 bytes')
        except (ValueError, UnicodeError) as error:
            raise BackupError('Invalid environment vault key encoding') from error
        key_source = 'environment'
    elif (root / KEY).exists():
        demand(len(read_small(root / KEY, 32)) == 32 and
               (root / KEY).stat().st_mode & 0o077 == 0,
               'Vault key must be 32 raw bytes with private permissions')
        key_source = 'file'
    else:
        demand(database['vault_envelopes'] == 0,
               'Vault master key missing for stored encrypted credentials')
    return {'commit': commit, 'database': database, 'vault_key_source': key_source}


def stage_source(root, stage):
    original_modes = {}
    count = 0
    total = 0

    def copy(name):
        nonlocal count, total
        safe_name(name)
        source = absolute_path(root / name)
        info = source.lstat()
        count += 1
        demand(count <= MAX_ENTRIES, 'Too many backup entries')
        demand(stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode),
               'Symlink or special source file rejected')
        target = stage / name
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        original_modes[name] = stat.S_IMODE(info.st_mode)
        if stat.S_ISDIR(info.st_mode):
            target.mkdir(mode=0o700, exist_ok=True)
            for child in sorted(source.iterdir()):
                copy(name + '/' + child.name)
        else:
            demand(info.st_nlink == 1 and info.st_size <= MAX_FILE,
                   'Hardlinked or oversized source file rejected')
            total += info.st_size
            demand(total <= MAX_TOTAL, 'Backup exceeds total size limit')
            if name == KEY:
                demand(info.st_mode & 0o077 == 0, 'Source vault key permissions are not private')
            with regular_open(source) as stream, target.open('xb') as out:
                before = os.fstat(stream.fileno())
                remaining = before.st_size
                while remaining:
                    chunk = stream.read(min(BLOCK, remaining))
                    demand(bool(chunk), 'Source file changed during backup')
                    out.write(chunk)
                    remaining -= len(chunk)
                demand(not stream.read(1), 'Source file grew during backup')
                after = os.fstat(stream.fileno())
                demand((before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
                       (after.st_size, after.st_mtime_ns, after.st_ctime_ns),
                       'Source file changed during backup')
            os.chmod(target, 0o700 if info.st_mode & 0o111 else 0o600)

    for name in DIRECTORIES + FIXED_FILES:
        copy(name)
    for optional in OPTIONAL_FILES:
        if os.path.lexists(root / optional):
            copy(optional)
    entries = []
    for path in sorted(stage.rglob('*')):
        name = path.relative_to(stage).as_posix()
        info = path.stat()
        entry = {'path': name, 'type': 'directory' if path.is_dir() else 'file',
                 'mode': stat.S_IMODE(info.st_mode),
                 'source_mode': original_modes.get(name, 0o700),
                 'size': 0 if path.is_dir() else info.st_size}
        if path.is_file():
            entry['sha256'] = digest_file(path)
        entries.append(entry)
    demand(len(entries) <= MAX_ENTRIES, 'Too many backup entries including directories')
    return entries


def canonical_json(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=True) + '\n').encode()


def no_duplicate_keys(pairs):
    result = {}
    for key, value in pairs:
        demand(key not in result, 'Duplicate JSON key')
        result[key] = value
    return result


def validate_manifest(manifest):
    demand(isinstance(manifest, dict) and set(manifest) == {
        'schema_version', 'image_id', 'commit', 'database', 'vault_key_source', 'entries'},
        'Unsupported manifest structure')
    demand(type(manifest['schema_version']) is int and manifest['schema_version'] == VERSION,
           'Unsupported backup schema version')
    demand(isinstance(manifest['image_id'], str) and IMAGE_RE.fullmatch(manifest['image_id']),
           'Image must have immutable sha256 ID')
    entries = manifest['entries']
    demand(isinstance(entries, list) and 0 < len(entries) <= MAX_ENTRIES, 'Invalid manifest entries')
    indexed = {}
    total = 0
    for entry in entries:
        demand(isinstance(entry, dict), 'Invalid manifest entry')
        name = safe_name(entry.get('path'))
        demand(allowed(name) and name not in indexed, 'Unexpected or duplicate payload path')
        kind = entry.get('type')
        keys = {'path', 'type', 'mode', 'source_mode', 'size'} | ({'sha256'} if kind == 'file' else set())
        demand(kind in ('file', 'directory') and set(entry) == keys, 'Invalid manifest entry fields')
        demand(type(entry['mode']) is int and entry['mode'] in ((0o600, 0o700) if kind == 'file' else (0o700,)),
               'Payload permissions must be private')
        demand(type(entry['source_mode']) is int and 0 <= entry['source_mode'] <= 0o7777,
               'Invalid source permissions')
        demand(type(entry['size']) is int and 0 <= entry['size'] <= MAX_FILE and
               (kind == 'file' or entry['size'] == 0), 'Invalid payload size')
        if kind == 'file':
            demand(isinstance(entry['sha256'], str) and HASH_RE.fullmatch(entry['sha256']), 'Invalid file digest')
        if name in SCAFFOLDS or name in DIRECTORIES:
            demand(kind == 'directory', 'Expected directory in payload')
        total += entry['size']
        demand(total <= MAX_TOTAL, 'Payload exceeds size limit')
        indexed[name] = entry
    demand(list(indexed) == sorted(indexed), 'Manifest paths must be sorted')
    for name in indexed:
        for parent in PurePosixPath(name).parents:
            if str(parent) != '.':
                demand(str(parent) in indexed and indexed[str(parent)]['type'] == 'directory',
                       'Missing parent directory in manifest')
    for name in REQUIRED:
        demand(name in indexed and indexed[name]['type'] == 'file', 'Required manifest file missing: ' + name)
    demand(indexed.get('var/lib/watchdog/object_store', {}).get('type') == 'directory',
           'Object store missing from manifest')
    return indexed


class LimitedReader:
    """Bound decompression and extension-header allocations before tarfile reads."""
    def __init__(self, stream):
        self.stream = stream
        self.total = 0

    def read(self, amount=-1):
        demand(0 <= amount <= MAX_MANIFEST, 'Oversized tar read or extended header')
        data = self.stream.read(amount)
        self.total += len(data)
        demand(self.total <= MAX_TAR, 'Decompressed archive exceeds limit')
        return data


def unpack_verified(archive, stage):
    demand(archive.stat().st_size <= MAX_TOTAL, 'Compressed archive exceeds size limit')
    sidecar = read_small(Path(str(archive) + '.sha256'), 4096).decode('ascii')
    demand(sidecar == digest_file(archive) + '  ' + archive.name + '\n', 'Archive checksum mismatch')
    with regular_open(archive) as compressed, gzip.GzipFile(fileobj=compressed, mode='rb') as raw:
        reader = LimitedReader(raw)
        with tarfile.open(fileobj=reader, mode='r|') as tar:
            first = next(iter(tar), None)
            demand(first is not None and first.name == 'manifest.json' and first.type in (tarfile.REGTYPE, tarfile.AREGTYPE) and
                   not first.pax_headers and first.mode == 0o600 and 0 < first.size <= MAX_MANIFEST,
                   'Archive must start with a private manifest.json')
            stream = tar.extractfile(first)
            manifest_bytes = stream.read(MAX_MANIFEST + 1)
            demand(len(manifest_bytes) == first.size, 'Truncated manifest')
            manifest = json.loads(manifest_bytes, object_pairs_hook=no_duplicate_keys)
            indexed = validate_manifest(manifest)
            seen = set()
            for item in tar:
                if item is first:
                    continue
                name = safe_name(item.name)
                demand(name in indexed and name not in seen and not item.pax_headers,
                       'Unexpected, extended or duplicate archive member')
                entry = indexed[name]
                demand(item.mode == entry['mode'] and item.size == entry['size'] and
                       ((item.isdir() and entry['type'] == 'directory') or
                        (item.type in (tarfile.REGTYPE, tarfile.AREGTYPE) and entry['type'] == 'file')),
                       'Archive member disagrees with manifest')
                target = stage / name
                if item.isdir():
                    target.mkdir(mode=0o700, parents=True, exist_ok=True)
                else:
                    target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                    digest = hashlib.sha256()
                    with tar.extractfile(item) as source, target.open('xb') as output:
                        remaining = item.size
                        while remaining:
                            data = source.read(min(BLOCK, remaining))
                            demand(bool(data), 'Truncated archive member')
                            output.write(data)
                            digest.update(data)
                            remaining -= len(data)
                    os.chmod(target, item.mode)
                    demand(digest.hexdigest() == entry['sha256'], 'Payload checksum mismatch')
                seen.add(name)
            demand(seen == set(indexed), 'Archive is incomplete')
            # Drain tarfile's own readahead buffer as well as gzip.
            while data := tar.fileobj.read(BLOCK):
                demand(not data.strip(b'\0'), 'Unexpected content after archive terminator')
        # Consume the gzip stream to validate CRC and reject concatenated hidden
        # archive content (tarfile otherwise stops at the first end marker).
        while data := reader.read(BLOCK):
            demand(not data.strip(b'\0'), 'Unexpected content after archive terminator')
    observed = inspect_payload(stage, manifest['image_id'])
    demand(all(manifest[field] == value for field, value in observed.items()),
           'Payload metadata disagrees with manifest')
    return manifest, hashlib.sha256(manifest_bytes).hexdigest()


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def sync_tree(root):
    for directory, dirs, files in os.walk(root, topdown=False):
        for filename in files:
            with regular_open(Path(directory) / filename) as stream:
                os.fsync(stream.fileno())
        sync_directory(directory)


def publish_directory(source, destination):
    libc = ctypes.CDLL(None, use_errno=True)
    rename = getattr(libc, 'renameat2', None)
    demand(rename is not None, 'Atomic no-replace restore requires Linux renameat2')
    rename.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    rename.restype = ctypes.c_int
    if rename(-100, os.fsencode(source), -100, os.fsencode(destination), 1) != 0:
        code = ctypes.get_errno()
        if code == errno.EEXIST:
            raise BackupError('Restore destination already exists')
        raise OSError(code, 'Atomic restore publication failed')


def summary(manifest, manifest_digest):
    return {key: manifest[key] for key in ('schema_version', 'image_id', 'commit', 'database', 'vault_key_source')} | {
        'manifest_sha256': manifest_digest, 'entry_count': len(manifest['entries'])}


def create(args):
    root, output = absolute_path(args.root), absolute_path(args.output)
    demand(root.is_dir() and output.parent.is_dir(), 'Source root and output parent must exist')
    demand(IMAGE_RE.fullmatch(args.image_id), 'Image must have immutable sha256 ID')
    for source_dir in DIRECTORIES:
        demand(not output.is_relative_to(root / source_dir), 'Archive output cannot be inside backup payload')
    sidecar = Path(str(output) + '.sha256')
    demand(not os.path.lexists(output) and not os.path.lexists(sidecar), 'Backup output already exists')
    published = []
    try:
        with tempfile.TemporaryDirectory(prefix='.watchdog-backup-', dir=output.parent) as temporary:
            work = Path(temporary)
            stage = work / 'payload'
            stage.mkdir(mode=0o700)
            entries = stage_source(root, stage)
            manifest = {'schema_version': VERSION, 'image_id': args.image_id,
                        **inspect_payload(stage, args.image_id), 'entries': entries}
            validate_manifest(manifest)
            manifest_bytes = canonical_json(manifest)
            demand(len(manifest_bytes) <= MAX_MANIFEST, 'Manifest exceeds size limit')
            staged_archive = work / output.name
            with staged_archive.open('xb') as target, gzip.GzipFile(fileobj=target, mode='wb', mtime=0, filename='') as zipped:
                with tarfile.open(fileobj=zipped, mode='w|', format=tarfile.USTAR_FORMAT) as tar:
                    info = tarfile.TarInfo('manifest.json')
                    info.mode, info.size = 0o600, len(manifest_bytes)
                    tar.addfile(info, io.BytesIO(manifest_bytes))
                    for entry in entries:
                        info = tarfile.TarInfo(entry['path'])
                        info.mode, info.size = entry['mode'], entry['size']
                        info.type = tarfile.DIRTYPE if entry['type'] == 'directory' else tarfile.REGTYPE
                        if info.isfile():
                            with regular_open(stage / entry['path']) as source:
                                tar.addfile(info, source)
                        else:
                            tar.addfile(info)
            os.chmod(staged_archive, 0o600)
            staged_sidecar = Path(str(staged_archive) + '.sha256')
            staged_sidecar.write_text(digest_file(staged_archive) + '  ' + output.name + '\n', encoding='ascii')
            os.chmod(staged_sidecar, 0o600)
            verified = work / 'verified'
            verified.mkdir(mode=0o700)
            checked, manifest_digest = unpack_verified(staged_archive, verified)
            # Hardlink publication is no-replace, then remove private staging.
            # A final name without its sidecar is deliberately not a ready backup.
            for staged, final in ((staged_archive, output), (staged_sidecar, sidecar)):
                with staged.open('rb') as stream:
                    os.fsync(stream.fileno())
                os.link(staged, final, follow_symlinks=False)
                published.append(final)
                staged.unlink()
            sync_directory(output.parent)
            return summary(checked, manifest_digest) | {'archive': str(output)}
    except BaseException:
        for own_file in reversed(published):
            own_file.unlink()
        raise


def verify_or_restore(args):
    archive = absolute_path(args.archive)
    destination = absolute_path(args.destination) if args.command == 'restore' else None
    if destination:
        demand(not os.path.lexists(destination), 'Restore destination already exists')
        demand(destination.parent.is_dir(), 'Restore destination parent must already exist')
    with tempfile.TemporaryDirectory(prefix='.watchdog-restore-', dir=destination.parent if destination else None) as work:
        stage = Path(work) / 'payload'
        stage.mkdir(mode=0o700)
        manifest, manifest_digest = unpack_verified(archive, stage)
        result = summary(manifest, manifest_digest)
        if destination:
            (stage / 'manifest.json').write_bytes(canonical_json(manifest))
            os.chmod(stage / 'manifest.json', 0o600)
            sync_tree(stage)
            publish_directory(stage, destination)
            sync_directory(destination.parent)
            result['destination'] = str(destination)
        return result


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest='command', required=True)
    create_parser = commands.add_parser('create', help='Caller must stop writer and hold installation lock')
    create_parser.add_argument('--root', required=True)
    create_parser.add_argument('--output', required=True)
    create_parser.add_argument('--image-id', required=True)
    for command in ('verify', 'restore'):
        sub = commands.add_parser(command)
        sub.add_argument('--archive', required=True)
        if command == 'restore':
            sub.add_argument('--destination', required=True)
    args = parser.parse_args()
    try:
        result = create(args) if args.command == 'create' else verify_or_restore(args)
        print(json.dumps(result, sort_keys=True))
        return 0
    except (BackupError, OSError, ValueError, KeyError, TypeError, RecursionError, sqlite3.Error, tarfile.TarError, EOFError) as error:
        # Never dump configuration, archived content or secret bytes on failure.
        print('Backup failed: ' + (str(error) if isinstance(error, BackupError) else type(error).__name__), file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
