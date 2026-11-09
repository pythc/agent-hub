#!/usr/bin/env python3
"""Exclusive ownership for the managed container volume, across PID namespaces."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import sqlite3
import subprocess
import sys
import tarfile
import tempfile
import time
import uuid

os.umask(0o077)
ROOT = Path('/data')
STATE = ROOT / 'state'
MARKER = ROOT / '.roppo-container.json'
NODE = ['node', '--import', 'tsx']
CLI = '/opt/roppo/src/container-cli.ts'

def regular(path):
    if path.is_symlink() or path.exists() and not path.is_file():
        raise RuntimeError('Expected a private regular file: ' + str(path))

def backup():
    directory = STATE / 'backups'
    directory.mkdir(mode=0o700, exist_ok=True)
    if directory.is_symlink():
        raise RuntimeError('Backup directory must not be a symlink')
    name = 'container-' + time.strftime('%Y%m%dT%H%M%SZ', time.gmtime()) + '-' + uuid.uuid4().hex[:12]
    archive = directory / (name + '.tar.gz')
    temporary = directory / (name + '.tar.gz.pending')
    records = {}
    def digest(path):
        h = hashlib.sha256()
        with path.open('rb') as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b''):
                h.update(block)
        return h.hexdigest()
    def add(tree, path):
        if path == directory or path == ROOT / '.roppo-container.lock':
            return
        relative = str(path.relative_to(ROOT))
        if path.is_symlink():
            records[relative] = {'symlink': os.readlink(path)}
            tree.add(path, arcname=relative, recursive=False)
        elif path.is_dir():
            tree.add(path, arcname=relative, recursive=False)
            for child in sorted(path.iterdir()):
                add(tree, child)
        elif path.is_file():
            before = path.stat()
            sha = digest(path)
            tree.add(path, arcname=relative, recursive=False)
            after = path.stat()
            if (before.st_ino, before.st_size, before.st_mtime_ns) != (after.st_ino, after.st_size, after.st_mtime_ns) or digest(path) != sha:
                raise RuntimeError('File changed during offline backup: ' + relative)
            records[relative] = {'sha256': sha, 'bytes': after.st_size}
        else:
            raise RuntimeError('Stop all browser/CLI processes before backing up special file: ' + relative)
    with tarfile.open(temporary, 'w:gz', dereference=False) as tree:
        for path in sorted(ROOT.iterdir()):
            add(tree, path)
    with tarfile.open(temporary, 'r:gz') as tree:
        for member in tree:
            record = records.get(member.name)
            if record and 'sha256' in record:
                stream = tree.extractfile(member)
                h = hashlib.sha256()
                for block in iter(lambda: stream.read(1024 * 1024), b''):
                    h.update(block)
                if h.hexdigest() != record['sha256']:
                    raise RuntimeError('Backup archive checksum mismatch')
    schemas = {}
    with tempfile.TemporaryDirectory(prefix='roppo-backup-check-') as check:
        for relative in ['state.sqlite', 'watchdog/state.sqlite']:
            source = STATE / relative
            if not source.exists():
                continue
            target = Path(check) / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            for suffix in ['', '-wal', '-shm']:
                if Path(str(source) + suffix).exists():
                    shutil.copy2(str(source) + suffix, str(target) + suffix)
            with sqlite3.connect(target) as db:
                if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                    raise RuntimeError('Backup database failed integrity check')
                schemas[relative] = db.execute('PRAGMA user_version').fetchone()[0]
    os.replace(temporary, archive)
    manifest = {'format': 1, 'archive': archive.name, 'sha256': digest(archive), 'schemas': schemas, 'files': records, 'externalEffects': 'not_reverted', 'externalCredentials': 'not_included'}
    destination = directory / (name + '.json')
    with destination.open('x') as stream:
        json.dump(manifest, stream, indent=2)
        stream.write('\n')
    print(json.dumps({'backup': str(archive), 'manifest': str(destination), 'sha256': manifest['sha256'], 'files': len(records), 'schemas': schemas}), flush=True)

def main():
    if ROOT.is_symlink() or not ROOT.is_dir():
        raise RuntimeError('/data must be a dedicated writable volume')
    lock = ROOT / '.roppo-container.lock'
    regular(lock)
    descriptor = os.open(lock, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'a+') as ownership:
        try:
            fcntl.flock(ownership, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('This data volume is already owned by another container')
        regular(MARKER)
        if not MARKER.exists():
            if set(p.name for p in ROOT.iterdir()) != {lock.name}:
                raise RuntimeError('Use an empty dedicated volume; existing native installations are not adopted automatically')
            with MARKER.open('x') as stream:
                json.dump({'format': 1, 'id': str(uuid.uuid4())}, stream)
        if json.loads(MARKER.read_text()).get('format') != 1:
            raise RuntimeError('Container volume format is newer than this program')
        if STATE.is_symlink():
            raise RuntimeError('Private state must not be a symlink')
        STATE.mkdir(mode=0o700, exist_ok=True)
        action = sys.argv[1] if len(sys.argv) > 1 else 'serve'
        if action in ['backup', 'backup-if-existing']:
            if action == 'backup' or (STATE / 'state.sqlite').exists():
                backup()
            else:
                print(json.dumps({'backup': 'not_needed', 'reason': 'new_installation'}))
            return 0
        if action not in ['serve', 'inspect']:
            raise RuntimeError('Supported container commands: serve, inspect, backup, backup-if-existing')
        if action == 'inspect':
            return subprocess.call(NODE + [CLI, 'inspect'])
        # flock proves no managed instance owns this volume, even when container
        # PID numbers were reused. Never infer this from kill(pid, 0).
        for file in [STATE / 'host.lock', STATE / 'watchdog' / 'daemon.lock']:
            if file.parent.is_symlink():
                raise RuntimeError('Private lock directory must not be a symlink')
            regular(file)
            file.unlink(missing_ok=True)
        subprocess.run(NODE + [CLI, 'init'], check=True)
        child = subprocess.Popen(NODE + ['/opt/roppo/src/cli.ts', 'supervise', str(STATE / 'config.json')])
        def stop(signum, frame):
            if child.poll() is None:
                child.send_signal(signum)
        signal.signal(signal.SIGTERM, stop)
        signal.signal(signal.SIGINT, stop)
        return child.wait()

try:
    sys.exit(main())
except Exception as error:
    print('Container startup failed: ' + str(error), file=sys.stderr, flush=True)
    sys.exit(1)
