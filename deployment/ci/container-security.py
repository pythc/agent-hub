"""Fixed CI container checks; emits booleans only, never proc/file contents."""
import ctypes
import errno
import json
import os
from pathlib import Path
import tempfile
import uuid


REQUIRED = frozenset(('profileEnforcing', 'effectiveCapabilitiesZero', 'boundingCapabilitiesZero',
                      'noNewPrivileges', 'seccompFiltering', 'rootTestIdentity', 'outerMountDenied',
                      'protectedProcWriteDenied', 'protectedSysWriteDenied', 'rootFilesystemWriteDenied'))

def verified(value):
    return isinstance(value, dict) and set(value) == REQUIRED and all(item is True for item in value.values())

def denied_open(path, flags, required_errno=None):
    try:
        descriptor = os.open(path, flags | os.O_NOFOLLOW, 0o600)
        os.close(descriptor)
    except OSError as error:
        return error.errno == required_errno if required_errno is not None else error.errno in (errno.EACCES, errno.EPERM, errno.EROFS)
    if flags & os.O_CREAT:
        try:
            os.unlink(path)
        except OSError:
            pass
    return False


def inspect():
    label = Path('/proc/self/attr/current').read_text().strip()
    status = dict(line.split(':', 1) for line in Path('/proc/self/status').read_text().splitlines() if ':' in line)
    values = {'profileEnforcing':label == 'agenthub-bubblewrap-ci (enforce)',
              'effectiveCapabilitiesZero':int(status['CapEff'].strip(), 16) == 0,
              'boundingCapabilitiesZero':int(status['CapBnd'].strip(), 16) == 0,
              'noNewPrivileges':status['NoNewPrivs'].strip() == '1',
              'seccompFiltering':status['Seccomp'].strip() == '2',
              'rootTestIdentity':os.getuid() == 0}
    mount_root = tempfile.mkdtemp(prefix='agenthub-ci-outer-', dir='/tmp')
    try:
        libc = ctypes.CDLL(None, use_errno=True)
        code = libc.mount(b'tmpfs', os.fsencode(mount_root), b'tmpfs', 0, None)
        values['outerMountDenied'] = code == -1 and ctypes.get_errno() in (errno.EACCES, errno.EPERM)
        if code == 0:
            libc.umount2(os.fsencode(mount_root), 2)
    finally:
        os.rmdir(mount_root)
    values['protectedProcWriteDenied'] = denied_open('/proc/sys/kernel/hostname', os.O_WRONLY)
    values['protectedSysWriteDenied'] = denied_open('/sys/kernel/.agenthub-ci-' + uuid.uuid4().hex, os.O_WRONLY | os.O_CREAT | os.O_EXCL)
    values['rootFilesystemWriteDenied'] = denied_open('/opt/roppo/.agenthub-ci-' + uuid.uuid4().hex, os.O_WRONLY | os.O_CREAT | os.O_EXCL, errno.EROFS)
    return values


if __name__ == '__main__':
    try:
        result = inspect()
        print(json.dumps(result, sort_keys=True))
        raise SystemExit(0 if verified(result) else 1)
    except Exception:
        print(json.dumps({'checkCompleted':False}))
        raise SystemExit(1)
