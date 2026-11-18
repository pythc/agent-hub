"""Install one hash-pinned Compose plugin on the authorized ephemeral CI runner."""
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import secrets
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

from apparmor_control import CiPolicyError, command, local_docker, require_ci

VERSION = '5.7.1'
SHA256 = 'af426722a8af5de812fcee30cc1c39f0639f5f723cbadefb25e5d4db054064cf'
SIZE = 33952322
URL = 'https://github.com/docker/compose/releases/download/v' + VERSION + '/docker-compose-linux-x86_64'
HOSTS = {'github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'}


def official_url(url):
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme != 'https' or parsed.hostname not in HOSTS or parsed.username or parsed.password or parsed.port not in (None, 443):
        raise CiPolicyError('ci_compose_download_origin_forbidden')
    return url


class OfficialRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        official_url(newurl)
        return super().redirect_request(request, fp, code, message, headers, newurl)


def verify_payload(data):
    if len(data) != SIZE or hashlib.sha256(data).hexdigest() != SHA256:
        raise CiPolicyError('ci_compose_digest_or_size_mismatch')
    return data


def download():
    deadline = time.monotonic() + 60
    try:
        opener = urllib.request.build_opener(OfficialRedirect())
        with opener.open(official_url(URL), timeout=20) as response:
            official_url(response.geturl())
            if response.status != 200 or response.headers.get('Content-Length') != str(SIZE):
                raise CiPolicyError('ci_compose_download_metadata_invalid')
            data = bytearray()
            while len(data) <= SIZE:
                if time.monotonic() >= deadline:
                    raise CiPolicyError('ci_compose_download_timeout')
                chunk = response.read(min(65536, SIZE + 1 - len(data)))
                if not chunk:
                    break
                data.extend(chunk)
            return verify_payload(data)
    except (OSError, ValueError, urllib.error.URLError):
        raise CiPolicyError('ci_compose_download_failed') from None


def directory_fd(path):
    """Pin each directory inode; never follow a symlink or write through a new parent."""
    if not path.is_absolute() or path.resolve(strict=True) != path:
        raise CiPolicyError('ci_compose_parent_path_invalid')
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    info = os.fstat(fd)
    if info.st_uid != os.getuid() or info.st_mode & 0o022:
        os.close(fd)
        raise CiPolicyError('ci_compose_parent_owner_or_mode_invalid')
    return fd


def plugin_directory(home):
    fd = directory_fd(home)
    try:
        for name in ('.docker', 'cli-plugins'):
            try:
                os.mkdir(name, 0o700, dir_fd=fd)
            except FileExistsError:
                pass
            child = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            info = os.fstat(child)
            if info.st_uid != os.getuid() or info.st_mode & 0o022:
                os.close(child)
                raise CiPolicyError('ci_compose_parent_owner_or_mode_invalid')
            os.close(fd)
            fd = child
        return fd
    except BaseException:
        os.close(fd)
        raise


def install_exclusive(home, data):
    # Verify before creating/chmodding any executable. The target is never replaced.
    verify_payload(data)
    fd = plugin_directory(home)
    temporary = '.agenthub-compose-' + secrets.token_hex(12)
    created = False
    try:
        try:
            os.stat('docker-compose', dir_fd=fd, follow_symlinks=False)
        except FileNotFoundError:
            pass
        else:
            raise CiPolicyError('ci_compose_plugin_already_exists')
        output = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=fd)
        created = True
        with os.fdopen(output, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
            os.fchmod(stream.fileno(), 0o700)
        # Hard-link the verified inode with exclusive destination semantics, including races.
        os.link(temporary, 'docker-compose', src_dir_fd=fd, dst_dir_fd=fd, follow_symlinks=False)
    except FileExistsError:
        raise CiPolicyError('ci_compose_plugin_already_exists') from None
    except OSError:
        raise CiPolicyError('ci_compose_plugin_install_failed') from None
    finally:
        if created:
            os.unlink(temporary, dir_fd=fd)
        os.close(fd)


def verify_selection(run=command):
    if run(('docker', 'compose', 'version', '--short')).strip() != VERSION:
        raise CiPolicyError('ci_compose_selected_version_mismatch')
    help_text = run(('docker', 'compose', 'start', '--help'))
    if not re.search(r'^\s+--wait\s', help_text, re.MULTILINE) or not re.search(r'^\s+--wait-timeout\s', help_text, re.MULTILINE):
        raise CiPolicyError('ci_compose_start_wait_unavailable')


def install(environment=None, run=command, fetch=download):
    environment = os.environ if environment is None else environment
    require_ci(environment)
    if environment.get('RUNNER_ARCH') != 'X64' or platform.system() != 'Linux' or platform.machine() not in ('x86_64', 'amd64'):
        raise CiPolicyError('ci_compose_architecture_outside_scope')
    local_docker(environment, run)
    install_exclusive(Path.home(), fetch())
    verify_selection(run)
    return {'version':VERSION, 'sha256':SHA256, 'ciUserPluginInstalled':True,
            'startWaitSupported':True, 'localDockerEndpointVerified':True}


if __name__ == '__main__':
    try:
        if len(sys.argv) != 1:
            raise CiPolicyError('invalid_ci_compose_operation')
        print(json.dumps(install(), sort_keys=True))
    except (CiPolicyError, OSError, ValueError):
        # Never echo paths, download URLs with redirect queries, subprocess output or stderr.
        print(json.dumps({'installed':'unknown', 'code':'ci_compose_setup_failed'}), file=sys.stderr)
        sys.exit(1)
