"""Exercise the real diagnostic function without Docker or application effects."""
import ast
import contextlib
import io
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import types
import unittest

SOURCE = Path(__file__).resolve().parents[1] / 'examples/container-acceptance.py'
FUNCTION = next(node for node in ast.parse(SOURCE.read_text()).body if isinstance(node, ast.FunctionDef) and node.name == 'startup_diagnostics')

class DiagnosticsTest(unittest.TestCase):
    def exercise(self, broken=False):
        sentinel = 'SYNTHETIC_PRIVATE_VALUE WITH SPACE'
        calls = []
        def compose(*argv, **kwargs):
            calls.append(argv)
            if broken:
                raise RuntimeError(sentinel)
            if argv[0] == 'run':
                return subprocess.CompletedProcess(argv, 1, sentinel, 'bwrap: Failed to make / slave: Permission denied\npassword="' + sentinel + '"')
            if argv == ('ps', '--all', '--quiet', 'roppo'):
                return subprocess.CompletedProcess(argv, 0, 'a' * 64, '')
            raise AssertionError('Raw application logs must not be requested')
        def run(argv, **kwargs):
            self.assertEqual(argv[:4], ['docker', 'inspect', '--format', '{{json .State}}'])
            state = {'Status':'restarting', 'Running':False, 'Restarting':True, 'ExitCode':1, 'Paused':sentinel, 'Error':sentinel,
                     'Health':{'Status':'unhealthy', 'FailingStreak':3, 'Log':[{'Output':sentinel}]}}
            return subprocess.CompletedProcess(argv, 0, json.dumps(state), sentinel)
        with tempfile.TemporaryDirectory() as directory:
            scope = dict(compose=compose, run=run, args=types.SimpleNamespace(output=Path(directory)), json=json, re=re, sys=sys)
            exec(compile(ast.Module(body=[FUNCTION], type_ignores=[]), str(SOURCE), 'exec'), scope)
            captured = io.StringIO()
            with contextlib.redirect_stderr(captured):
                scope['startup_diagnostics']()
            files = {path.name:path.read_text() for path in Path(directory).iterdir()}
        self.assertNotIn(sentinel, captured.getvalue() + ''.join(files.values()))
        self.assertTrue(all(call[0] != 'logs' for call in calls))
        return files, captured.getvalue()

    def test_failure_has_useful_typed_metadata_without_raw_logs(self):
        files, _ = self.exercise()
        self.assertEqual(json.loads(files['sandbox-startup-failure.json']), {'exitCode':1, 'classification':'root_mount_propagation_permission_denied'})
        state = json.loads(next(value for name,value in files.items() if name.startswith('container-state-')))
        self.assertEqual(state, {'Running':False, 'Restarting':True, 'ExitCode':1, 'Status':'restarting', 'HealthStatus':'unhealthy', 'HealthFailingStreak':3})

    def test_collection_error_does_not_echo_exception_contents(self):
        files, output = self.exercise(broken=True)
        self.assertEqual(files, {})
        self.assertIn('RuntimeError', output)

if __name__ == '__main__':
    unittest.main()
