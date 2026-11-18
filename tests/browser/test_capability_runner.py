"""Runner orchestration regressions; no real browser or provider is invoked."""
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location('runner', Path(__file__).with_name('run-capability-increments.py'))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class RunnerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'new-run'

    def test_existing_evidence_is_untouched_and_no_process_starts(self):
        self.root.mkdir()
        for name in ['browser.json', 'host.log', 'browser-report.json']:
            (self.root / name).write_text('old evidence')
        with patch.object(runner.subprocess, 'Popen') as start:
            with self.assertRaises(FileExistsError):
                runner.run(self.root)
        start.assert_not_called()
        self.assertTrue(all(p.read_text() == 'old evidence' for p in self.root.iterdir()))

    def test_existing_empty_directory_is_not_claimed(self):
        self.root.mkdir()
        with self.assertRaises(FileExistsError):
            runner.run(self.root)

    def test_symlink_output_is_not_followed(self):
        target = Path(self.temp.name) / 'target'
        target.mkdir()
        self.root.symlink_to(target, target_is_directory=True)
        with self.assertRaises(FileExistsError):
            runner.run(self.root)
        self.assertEqual(list(target.iterdir()), [])

    def run_fixture(self, code=0, exited=False, hung=False):
        app = Mock()
        app.poll.return_value = 1 if exited else None
        if hung:
            app.wait.side_effect = [subprocess.TimeoutExpired('node', 10), 0]
        def start(*args, **kwargs):
            (self.root / 'browser.json').write_text('{}')
            return app
        with patch.object(runner.subprocess, 'Popen', side_effect=start), patch.object(runner.subprocess, 'run', return_value=Mock(returncode=code)) as browser:
            if exited:
                with self.assertRaisesRegex(RuntimeError, 'Fixture exited'):
                    runner.run(self.root)
                browser.assert_not_called()
            else:
                self.assertEqual(runner.run(self.root), code)
                browser.assert_called_once()
        app.terminate.assert_called_once()
        return app

    def test_success_is_propagated_and_fixture_stopped(self):
        self.run_fixture()

    def test_browser_failure_is_propagated(self):
        self.run_fixture(code=7)

    def test_dead_fixture_even_with_ready_file_never_runs_browser(self):
        self.run_fixture(exited=True)

    def test_hung_fixture_is_killed_and_reaped(self):
        app = self.run_fixture(hung=True)
        app.kill.assert_called_once()
        self.assertEqual(app.wait.call_count, 2)

    def test_startup_timeout_stops_fixture_without_browser(self):
        app = Mock()
        app.poll.return_value = None
        with patch.object(runner.subprocess, 'Popen', return_value=app), patch.object(runner.subprocess, 'run') as browser, patch.object(runner.time, 'monotonic', side_effect=[0, 31]):
            with self.assertRaisesRegex(RuntimeError, 'startup deadline'):
                runner.run(self.root)
        browser.assert_not_called()
        app.terminate.assert_called_once()


if __name__ == '__main__':
    unittest.main()
