"""Synthetic host diagnostic tests: no sudo, Docker, journal or policy operations."""
import importlib.util
import json
from pathlib import Path
import sys
import unittest

PATH = Path(__file__).resolve().parents[1] / 'deployment/ci-host-diagnostics.py'
SPEC = importlib.util.spec_from_file_location('ci_host_diagnostics', PATH)
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)
ENV = {'GITHUB_ACTIONS': 'true', 'RUNNER_ENVIRONMENT': 'github-hosted', 'RUNNER_OS': 'Linux'}
SECRET = 'SYNTHETIC_PRIVATE_VALUE WITH SPACES'

class HostDiagnosticTest(unittest.TestCase):
    def exercise(self, journal=None, dmesg=None, profiles=None):
        calls = []
        def read(path):
            self.assertIn(path, (MODULE.ENABLED_PATH, MODULE.PROFILE_PATH))
            return MODULE.Capture('Y\n', 'complete', 2) if path == MODULE.ENABLED_PATH else profiles or MODULE.Capture('docker-default (enforce)\n' + SECRET, 'complete', 80)
        def run(command):
            calls.append(command)
            self.assertIn(command, (MODULE.JOURNAL, MODULE.DMESG, MODULE.PROFILES))
            if command == MODULE.JOURNAL:
                return journal or MODULE.Capture()
            if command == MODULE.DMESG:
                return dmesg or MODULE.Capture()
            return MODULE.Capture()
        value = MODULE.report(ENV, run=run, read=read)
        self.assertNotIn(SECRET, json.dumps(value))
        return value, calls

    def test_only_fixed_counts_and_enums_leave_matching_kernel_records(self):
        text = '\n'.join([
            SECRET,
            'audit: apparmor="DENIED" operation="mount" profile="docker-default" name="/" comm="bwrap" flags="rw, rslave" arbitrary="' + SECRET + '"',
            'audit: apparmor="DENIED" operation="mount" profile="docker-default-other" comm="bwrap"',
            'audit: apparmor="DENIED" operation="mount" profile="docker-default" comm="another"',
            'audit: apparmor="ALLOWED" operation="mount" profile="docker-default" comm="bwrap"',
        ])
        value, calls = self.exercise(MODULE.Capture(text, 'complete', len(text)))
        self.assertEqual(value['apparmor'], {'enabled':'yes', 'dockerDefaultMode':'enforce'})
        self.assertEqual(value['kernel']['counts'], {'apparmorDenied':3, 'bwrapDenied':2, 'dockerDefaultDenied':2, 'bwrapDockerDefaultMountDenied':1, 'bwrapDockerDefaultPivotDenied':0, 'bwrapDockerDefaultUmountDenied':0, 'rootPropagationDenied':1})
        self.assertEqual(value['kernel']['evidence'], 'matching_apparmor_bwrap_mount_denial')
        self.assertEqual(calls, [MODULE.JOURNAL])

    def test_unavailable_sources_are_unknown_not_zero_denials(self):
        value, calls = self.exercise()
        self.assertIsNone(value['kernel']['counts'])
        self.assertEqual(value['kernel']['evidence'], 'unknown')
        self.assertEqual(calls, [MODULE.JOURNAL, MODULE.DMESG])

    def test_dmesg_fallback_explicitly_has_unknown_time_window(self):
        value, _ = self.exercise(dmesg=MODULE.Capture(SECRET, 'complete', len(SECRET)))
        self.assertEqual(value['kernel']['source'], 'dmesg')
        self.assertIn('time_window_unknown', value['kernel']['window'])
        self.assertEqual(value['kernel']['evidence'], 'no_matching_records_in_observed_window')

    def test_timeout_and_truncation_never_claim_absence(self):
        for status in ('timeout', 'bounded'):
            value, _ = self.exercise(MODULE.Capture(SECRET, status, len(SECRET)))
            self.assertEqual(value['collection'], 'partial')
            self.assertEqual(value['kernel']['status'], status)
            self.assertEqual(value['kernel']['evidence'], 'unknown')

    def test_scope_guard_prevents_local_and_self_hosted_reads(self):
        def forbidden(*args):
            raise AssertionError('Must not inspect a host outside authorized CI scope')
        for env in ({}, {**ENV, 'RUNNER_ENVIRONMENT':'self-hosted'}, {**ENV, 'RUNNER_OS':'macOS'}):
            value = MODULE.report(env, run=forbidden, read=forbidden)
            self.assertEqual(value['reason'], 'outside_supported_ci_scope')

    def test_capture_bounds_output_and_times_out_without_exposing_child_stderr(self):
        old_bytes, old_timeout = MODULE.MAX_BYTES, MODULE.TIMEOUT_SECONDS
        try:
            MODULE.MAX_BYTES = 128
            MODULE.TIMEOUT_SECONDS = 0.2
            bounded = MODULE.capture((sys.executable, '-c', 'print("x"*300)'))
            self.assertEqual(bounded.status, 'bounded')
            self.assertEqual(bounded.bytes_read, 128)
            timed = MODULE.capture((sys.executable, '-c', 'import sys,time;sys.stderr.write("' + SECRET + '");time.sleep(5)'))
            self.assertEqual(timed.status, 'timeout')
            self.assertNotIn(SECRET, timed.text)
        finally:
            MODULE.MAX_BYTES, MODULE.TIMEOUT_SECONDS = old_bytes, old_timeout

    def test_exception_contents_and_foreign_profile_names_never_escape(self):
        def broken(*args):
            raise RuntimeError(SECRET)
        value = MODULE.report(ENV, run=broken, read=broken)
        self.assertNotIn(SECRET, json.dumps(value))
        self.assertEqual(value['reason'], 'diagnostic_collection_failed')
        self.assertEqual(MODULE.profile_mode('other-' + SECRET + ' (enforce)\n'), 'absent')

if __name__ == '__main__':
    unittest.main()
