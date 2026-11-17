"""Run a fixture and browser with exclusive ownership of fresh evidence output."""
import os
from pathlib import Path
import subprocess
import sys
import time


def run(root: Path) -> int:
    # Never reuse a session, report, or screenshot from another acceptance run.
    # mkdir is atomic: concurrent runners cannot both claim the same directory.
    root.mkdir(parents=True, exist_ok=False)
    with (root / 'host.log').open('w') as log:
        app = subprocess.Popen(
            ['node', '--import', 'tsx', 'examples/capability-increments-acceptance.ts', str(root)],
            stdout=log, stderr=subprocess.STDOUT,
        )
        try:
            deadline = time.monotonic() + 30
            while True:
                if app.poll() is not None:
                    raise RuntimeError('Fixture exited before browser acceptance; inspect host.log')
                if (root / 'browser.json').exists():
                    break
                if time.monotonic() > deadline:
                    raise RuntimeError('Fixture startup deadline')
                time.sleep(.1)
            env = os.environ.copy()
            shell = Path('.local/browsers/chrome-headless-shell-linux64/chrome-headless-shell')
            if shell.exists():
                env.setdefault('CHROMIUM_EXECUTABLE', str(shell.resolve()))
            with (root / 'browser.log').open('w') as output:
                result = subprocess.run(
                    ['python3', 'tests/browser/capability-increments.py', str(root)],
                    env=env, stdout=output, stderr=subprocess.STDOUT,
                )
            print('Browser exit', result.returncode)
            print((root / 'browser.log').read_text()[-6000:])
            return result.returncode
        finally:
            app.terminate()
            try:
                app.wait(timeout=10)
            except subprocess.TimeoutExpired:
                app.kill()
                app.wait()


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit('Usage: python3 tests/browser/run-capability-increments.py NEW_OUTPUT_DIRECTORY')
    try:
        sys.exit(run(Path(sys.argv[1])))
    except FileExistsError:
        sys.exit('Output path already exists. Choose a new directory; previous evidence was not changed.')
