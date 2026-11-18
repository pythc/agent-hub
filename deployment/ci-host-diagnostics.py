"""Read-only, bounded host evidence for a failing GitHub-hosted Linux CI job.

Never prints kernel lines, profile lists, arbitrary stderr or exception messages.
This script creates/loads no policy and changes no host or container setting.
"""
import json
import os
from pathlib import Path
import re
import select
import signal
import subprocess
import sys
import time
from dataclasses import dataclass

MAX_BYTES = 4 * 1024 * 1024
TIMEOUT_SECONDS = 8
PROFILE_PATH = '/sys/kernel/security/apparmor/profiles'
ENABLED_PATH = '/sys/module/apparmor/parameters/enabled'
COUNTER_KEYS = ('apparmorDenied', 'bwrapDenied', 'dockerDefaultDenied',
                'bwrapDockerDefaultMountDenied', 'bwrapDockerDefaultPivotDenied',
                'bwrapDockerDefaultUmountDenied', 'rootPropagationDenied')
JOURNAL = ('sudo', '-n', 'journalctl', '--kernel', '--boot', '--since=-30min',
           '--no-pager', '--quiet', '--output=cat', '--lines=4000')
DMESG = ('sudo', '-n', 'dmesg', '--color=never', '--time-format=raw')
PROFILES = ('sudo', '-n', 'cat', PROFILE_PATH)

@dataclass
class Capture:
    text: str = ''
    status: str = 'unavailable'
    bytes_read: int = 0


def capture(command):
    """A fixed read command; stdout bounded in memory, stderr never retained."""
    child = None
    data = bytearray()
    state = 'unavailable'
    try:
        child = subprocess.Popen(command, stdin=subprocess.DEVNULL,
                                 stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                 start_new_session=True)
        deadline = time.monotonic() + TIMEOUT_SECONDS
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                state = 'timeout'
                break
            readable, _, _ = select.select([child.stdout], [], [], remaining)
            if not readable:
                state = 'timeout'
                break
            part = os.read(child.stdout.fileno(), min(65536, MAX_BYTES - len(data) + 1))
            if not part:
                code = child.wait(timeout=min(1, remaining))
                state = 'complete' if code == 0 else 'unavailable'
                break
            data.extend(part)
            if len(data) > MAX_BYTES:
                del data[MAX_BYTES:]
                state = 'bounded'
                break
    except (OSError, ValueError, subprocess.SubprocessError):
        state = 'unavailable'
    finally:
        if child is not None:
            if child.poll() is None:
                try:
                    os.killpg(child.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            try:
                child.wait(timeout=1)
            except (OSError, subprocess.SubprocessError):
                pass
            if child.stdout:
                child.stdout.close()
    # Timeout/error data may be incomplete and is never mistaken for a clean scan.
    return Capture(data.decode('utf8', errors='replace'), state, len(data))


def read_bounded(path):
    try:
        with Path(path).open('rb') as stream:
            data = stream.read(MAX_BYTES + 1)
        return Capture(data[:MAX_BYTES].decode('utf8', errors='replace'),
                       'bounded' if len(data) > MAX_BYTES else 'complete',
                       min(len(data), MAX_BYTES))
    except OSError:
        return Capture()


def classify_kernel(text):
    counts = dict.fromkeys(COUNTER_KEYS, 0)
    for line in text.splitlines():
        # Only literal AppArmor audit fields are compared; none are returned.
        fields = {match[0]: match[1] or match[2] for match in
                  re.findall(r'\b([a-z_]+)=(?:"([^"\n]*)"|([^\s]+))', line)}
        if fields.get('apparmor') != 'DENIED':
            continue
        counts['apparmorDenied'] += 1
        bwrap = fields.get('comm') == 'bwrap'
        default = fields.get('profile') == 'docker-default'
        counts['bwrapDenied'] += int(bwrap)
        counts['dockerDefaultDenied'] += int(default)
        if not (bwrap and default):
            continue
        operation = fields.get('operation')
        counts['bwrapDockerDefaultMountDenied'] += int(operation == 'mount')
        counts['bwrapDockerDefaultPivotDenied'] += int(operation == 'pivotroot')
        counts['bwrapDockerDefaultUmountDenied'] += int(operation == 'umount')
        flags = {flag.strip() for flag in fields.get('flags', '').split(',')}
        counts['rootPropagationDenied'] += int(operation == 'mount' and
                                              fields.get('name') == '/' and
                                              bool(flags.intersection(('rslave', 'slave'))))
    return counts


def profile_mode(text):
    modes = {'enforce', 'complain', 'kill', 'unconfined'}
    for line in text.splitlines():
        match = re.fullmatch(r'docker-default \(([^()]+)\)', line.strip())
        if match and match[1] in modes:
            return match[1]
    return 'absent'


def report(environment=None, run=capture, read=read_bounded):
    environment = os.environ if environment is None else environment
    output = {'schemaVersion': 1, 'scope': 'github-hosted-linux-runner',
              'collection': 'unavailable',
              'apparmor': {'enabled': 'unknown', 'dockerDefaultMode': 'unknown'},
              'kernel': {'source': 'none', 'status': 'unavailable',
                         'window': 'unknown', 'bytesScanned': 0, 'counts': None,
                         'evidence': 'unknown', 'attribution': 'host_log_pattern_only'}}
    # These are scope guards, not credentials. No local/Mac/production collection.
    if environment.get('GITHUB_ACTIONS') != 'true' or environment.get('RUNNER_ENVIRONMENT') != 'github-hosted' or environment.get('RUNNER_OS') != 'Linux':
        output['reason'] = 'outside_supported_ci_scope'
        return output
    try:
        enabled = read(ENABLED_PATH)
        if enabled.status == 'complete' and enabled.text.strip() in ('Y', 'N'):
            output['apparmor']['enabled'] = 'yes' if enabled.text.strip() == 'Y' else 'no'
        profiles = read(PROFILE_PATH)
        if profiles.status != 'complete':
            profiles = run(PROFILES)
        if profiles.status == 'complete':
            output['apparmor']['dockerDefaultMode'] = profile_mode(profiles.text)
        result = run(JOURNAL)
        source, window = 'journalctl', 'last_30_minutes_up_to_4000_kernel_lines'
        if result.status == 'unavailable':
            result = run(DMESG)
            source, window = 'dmesg', 'available_ring_buffer_time_window_unknown'
        usable = result.status in ('complete', 'bounded', 'timeout')
        if usable:
            # An unfinished last line is excluded from partial captures.
            text = result.text if result.status == 'complete' else result.text.rsplit('\n', 1)[0] if '\n' in result.text else ''
            counts = classify_kernel(text)
            matched = counts['bwrapDockerDefaultMountDenied'] > 0
            output['kernel'] = {'source': source, 'status': result.status,
                                'window': window, 'bytesScanned': result.bytes_read,
                                'counts': counts,
                                'evidence': 'matching_apparmor_bwrap_mount_denial' if matched else 'no_matching_records_in_observed_window' if result.status == 'complete' else 'unknown',
                                'attribution': 'host_log_pattern_only'}
            output['collection'] = 'observed' if result.status == 'complete' else 'partial'
        else:
            output['reason'] = 'kernel_log_source_unavailable'
    except Exception:
        # Even exception class names are unnecessary uncontrolled diagnostic text.
        output['reason'] = 'diagnostic_collection_failed'
    return output


if __name__ == '__main__':
    print(json.dumps(report(), sort_keys=True))
