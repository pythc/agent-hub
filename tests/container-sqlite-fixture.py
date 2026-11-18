"""Exercise acceptance fixture SQL with real independent SQLite writers, no Docker."""
from pathlib import Path
import selectors
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'examples'))
from container_sqlite_fixture import sqlite_write

LOCKER = """
import sqlite3,sys
c=sqlite3.connect(sys.argv[1], timeout=1)
try:
 c.execute('BEGIN IMMEDIATE')
 print('LOCKED', flush=True)
 sys.stdin.readline()
 c.commit()
finally:
 c.close()
"""


class FixtureWrites(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = str(Path(self.directory.name) / 'state.sqlite')
        with sqlite3.connect(self.path) as db:
            db.execute('PRAGMA journal_mode=WAL')
            db.execute('CREATE TABLE jobs(id TEXT PRIMARY KEY)')
        db.close()

    def process(self, argv):
        p = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        def cleanup():
            if p.poll() is None:
                p.kill()
            p.communicate(timeout=5)
            for stream in (p.stdin, p.stdout, p.stderr):
                stream.close()
        self.addCleanup(cleanup)
        return p

    def line(self, p):
        with selectors.DefaultSelector() as selector:
            selector.register(p.stdout, selectors.EVENT_READ)
            self.assertTrue(selector.select(5), 'child did not reach readiness barrier')
        return p.stdout.readline().strip()

    def lock(self):
        p = self.process([sys.executable, '-u', '-c', LOCKER, self.path])
        self.assertEqual(self.line(p), 'LOCKED')
        return p

    def writer(self, timeout=5000):
        code = sqlite_write('INSERT INTO jobs VALUES(?)', ['one'], path=self.path, timeout_ms=timeout)
        # Signal immediately before the actual generated write; the other process
        # already owns the write lock. No replacement/mock of the SQL operation.
        code = code.replace('d.prepare(', "console.log('WRITING');d.prepare(", 1)
        p = self.process(['node', '--input-type=module', '-e', code])
        self.assertEqual(self.line(p), 'WRITING')
        return p

    def release(self, locker):
        locker.stdin.write('release\n')
        locker.stdin.flush()
        self.assertEqual(locker.wait(timeout=5), 0)

    def count(self):
        db = sqlite3.connect(self.path)
        try:
            return db.execute('SELECT count(*) FROM jobs').fetchone()[0]
        finally:
            db.close()

    def test_waits_for_lock_then_writes_exactly_once(self):
        locker = self.lock()
        writer = self.writer()
        time.sleep(.15)
        self.assertIsNone(writer.poll(), 'write should still be waiting for the held lock')
        self.assertEqual(self.count(), 0)
        self.release(locker)
        _, error = writer.communicate(timeout=7)
        self.assertEqual(writer.returncode, 0, error)
        self.assertEqual(self.count(), 1)

    def test_timeout_is_failure_and_database_remains_usable(self):
        locker = self.lock()
        writer = self.writer(timeout=100)
        _, error = writer.communicate(timeout=5)
        self.assertNotEqual(writer.returncode, 0)
        self.assertIn('database is locked', error)
        self.assertEqual(self.count(), 0)
        self.release(locker)
        retry = self.writer()
        _, error = retry.communicate(timeout=5)
        self.assertEqual(retry.returncode, 0, error)
        self.assertEqual(self.count(), 1)

    def test_constraints_are_not_swallowed_or_retried(self):
        first = self.writer()
        self.assertEqual(first.wait(timeout=5), 0)
        duplicate = self.writer()
        _, error = duplicate.communicate(timeout=5)
        self.assertNotEqual(duplicate.returncode, 0)
        self.assertIn('UNIQUE constraint failed', error)
        self.assertEqual(self.count(), 1)
        # The same helper serves cleanup and maintenance writes, not just inserts.
        for sql, values in [('UPDATE jobs SET id=? WHERE id=?', ['two', 'one']), ('DELETE FROM jobs WHERE id=?', ['two'])]:
            result = subprocess.run(['node', '--input-type=module', '-e', sqlite_write(sql, values, path=self.path)], capture_output=True, text=True, timeout=5)
            self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.count(), 0)


if __name__ == '__main__':
    unittest.main()
