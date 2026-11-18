"""Synthetic pinned-Compose boundaries; never installs a real plugin or invokes Docker."""
import hashlib
import io
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'deployment/ci'))
import install_compose as compose
from apparmor_control import CiPolicyError

ENV = {'GITHUB_ACTIONS':'true', 'RUNNER_ENVIRONMENT':'github-hosted', 'RUNNER_OS':'Linux',
       'GITHUB_REPOSITORY':'pythc/agent-hub', 'GITHUB_WORKFLOW':'Container acceptance',
       'GITHUB_JOB':'compose', 'AGENTHUB_CI_APPARMOR':'1', 'GITHUB_RUN_ID':'123',
       'GITHUB_RUN_ATTEMPT':'1', 'RUNNER_ARCH':'X64'}
DATA = b'synthetic non-executable plugin payload'


def metadata(argv):
    if argv == ('docker', 'context', 'show'): return 'default\n'
    if argv == ('docker', 'context', 'inspect', 'default', '--format', '{{json .Endpoints.docker.Host}}'): return '"unix:///var/run/docker.sock"'
    if argv == ('docker', 'compose', 'version', '--short'): return compose.VERSION + '\n'
    if argv == ('docker', 'compose', 'start', '--help'): return '      --wait                 Wait healthy\n      --wait-timeout int     Maximum wait\n'
    raise AssertionError('Unexpected synthetic command')


class PinnedComposeTest(unittest.TestCase):
    def payload(self):
        return patch.multiple(compose, SIZE=len(DATA), SHA256=hashlib.sha256(DATA).hexdigest())

    def test_scope_and_architecture_fail_before_network_or_install(self):
        for env in ({}, {**ENV, 'RUNNER_ENVIRONMENT':'self-hosted'}, {**ENV, 'RUNNER_ARCH':'ARM64'}, {**ENV, 'DOCKER_CONFIG':'unapproved'}, {**ENV, 'DOCKER_HOST':'tcp://unapproved.invalid'}):
            with self.subTest(env=env), patch.object(compose, 'install_exclusive') as install, self.assertRaises(CiPolicyError):
                compose.install(env, run=lambda _: self.fail('Command before scope'), fetch=lambda:self.fail('Fetch before scope'))
            install.assert_not_called()

    def test_endpoint_must_be_local_before_download_or_install(self):
        with patch.object(compose, 'install_exclusive') as install, self.assertRaises(CiPolicyError):
            compose.install(ENV, run=lambda argv:'default' if argv[-1]=='show' else '"tcp://unapproved.invalid:2376"', fetch=lambda:self.fail('Remote endpoint fetched binary'))
        install.assert_not_called()

    def test_only_fixed_official_https_origins_accept_redirects(self):
        for url in (compose.URL, 'https://release-assets.githubusercontent.com/asset?sig=PRIVATE', 'https://objects.githubusercontent.com/asset'):
            self.assertEqual(compose.official_url(url), url)
        for url in ('http://github.com/asset', 'https://github.com.evil.invalid/asset', 'https://example.com/asset', 'https://user:PRIVATE@github.com/asset', 'https://github.com:444/asset'):
            with self.subTest(url=url), self.assertRaises(CiPolicyError): compose.official_url(url)

    def test_digest_and_exact_size_are_required_before_any_install_mutation(self):
        with tempfile.TemporaryDirectory() as home:
            for bad in (b'', DATA, b'PRIVATE'):
                with self.assertRaises(CiPolicyError): compose.install_exclusive(Path(home), bad)
            self.assertFalse((Path(home) / '.docker').exists())
        with self.payload():
            self.assertEqual(compose.verify_payload(DATA), DATA)
            for bad in (DATA[:-1], DATA+b'x', b'x'*len(DATA)):
                with self.assertRaises(CiPolicyError): compose.verify_payload(bad)

    def test_install_is_exclusive_and_preserves_any_existing_target(self):
        for kind in ('file', 'directory', 'dangling_symlink'):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as home, self.payload():
                target = Path(home) / '.docker/cli-plugins/docker-compose'
                target.parent.mkdir(parents=True)
                if kind == 'file': target.write_bytes(b'existing')
                elif kind == 'directory': target.mkdir()
                else: target.symlink_to('PRIVATE-missing')
                with self.assertRaises(CiPolicyError): compose.install_exclusive(Path(home), DATA)
                self.assertTrue(os.path.lexists(target))
                if kind == 'file': self.assertEqual(target.read_bytes(), b'existing')
                if kind == 'dangling_symlink': self.assertTrue(target.is_symlink())

    def test_parent_symlink_wrong_mode_and_relative_home_are_rejected(self):
        with tempfile.TemporaryDirectory() as home, self.payload():
            base = Path(home)
            (base / 'elsewhere').mkdir()
            (base / '.docker').symlink_to(base / 'elsewhere', target_is_directory=True)
            with self.assertRaises(OSError): compose.install_exclusive(base, DATA)
            self.assertEqual(list((base / 'elsewhere').iterdir()), [])
        with tempfile.TemporaryDirectory() as home, self.payload():
            (Path(home) / '.docker').mkdir(mode=0o777)
            (Path(home) / '.docker').chmod(0o777)
            with self.assertRaises(CiPolicyError): compose.install_exclusive(Path(home), DATA)
        with self.payload(), self.assertRaises(CiPolicyError): compose.install_exclusive(Path('relative'), DATA)

    def test_atomic_install_only_marks_verified_inode_executable(self):
        with tempfile.TemporaryDirectory() as home, self.payload():
            compose.install_exclusive(Path(home), DATA)
            target = Path(home) / '.docker/cli-plugins/docker-compose'
            self.assertEqual(target.read_bytes(), DATA)
            self.assertEqual(target.stat().st_mode & 0o777, 0o700)
            self.assertEqual([p.name for p in target.parent.iterdir()], ['docker-compose'])

    def test_racing_target_is_never_overwritten_and_temporary_is_removed(self):
        original_link = os.link
        with tempfile.TemporaryDirectory() as home, self.payload():
            def raced(source, target, **kwargs):
                fd = os.open(target, os.O_WRONLY|os.O_CREAT|os.O_EXCL, 0o600, dir_fd=kwargs['dst_dir_fd'])
                os.write(fd, b'race-winner'); os.close(fd)
                return original_link(source, target, **kwargs)
            with patch.object(compose.os, 'link', side_effect=raced), self.assertRaises(CiPolicyError):
                compose.install_exclusive(Path(home), DATA)
            directory = Path(home) / '.docker/cli-plugins'
            self.assertEqual((directory/'docker-compose').read_bytes(), b'race-winner')
            self.assertEqual([p.name for p in directory.iterdir()], ['docker-compose'])

    def test_actual_cli_version_and_both_wait_options_are_required(self):
        compose.verify_selection(metadata)
        for output in ('2.40.3', compose.VERSION+' PRIVATE'):
            with self.assertRaises(CiPolicyError): compose.verify_selection(lambda argv:output)
        for flags in ('--wait-timeout int', '      --wait healthy', 'PRIVATE --wait --wait-timeout'):
            with self.assertRaises(CiPolicyError): compose.verify_selection(lambda argv:compose.VERSION if argv[-1]=='--short' else flags)

    def test_download_rejects_foreign_final_origin_wrong_size_and_deadline(self):
        def response(body=DATA, url=compose.URL, length=None):
            value = io.BytesIO(body); value.status=200
            value.headers={'Content-Length':str(len(DATA) if length is None else length)}
            value.geturl=lambda:url
            return value
        class Opener:
            def __init__(self, result): self.result=result
            def open(self, url, timeout): return self.result
        with self.payload():
            for value in (response(url='https://evil.invalid/PRIVATE'), response(length=1), response(DATA+b'X')):
                with patch.object(compose.urllib.request, 'build_opener', return_value=Opener(value)), self.assertRaises(CiPolicyError): compose.download()
            with patch.object(compose.urllib.request, 'build_opener', return_value=Opener(response())), patch.object(compose.time, 'monotonic', side_effect=(0,61)), self.assertRaises(CiPolicyError): compose.download()
            with patch.object(compose.urllib.request, 'build_opener', return_value=Opener(response())):
                self.assertEqual(compose.download(), DATA)

    def test_workflow_selects_before_build_and_receipt_is_strictly_validated(self):
        workflow=(ROOT/'.github/workflows/docker.yml').read_text()
        self.assertLess(workflow.index('apparmor_control.py verify-docker'), workflow.index('install_compose.py'))
        self.assertLess(workflow.index('install_compose.py'), workflow.index('run: docker compose build'))
        source=(ROOT/'examples/container-acceptance.py').read_text()
        self.assertLess(source.index('outer_controls(controls)'), source.index("print('CI retained boundaries: '"))
        self.assertLess(source.index("print('CI retained boundaries: '"), source.index("run(['./deployment/compose.sh', 'backup']"))


if __name__ == '__main__':
    unittest.main()
