"""Capture a real terminal resize/exit session using the offline TUI fixture.

Run this from the affected terminal, resize its window, then enter /exit.
The log contains only the fixture's output and terminal input, not real chats.
"""
import base64
import errno
import fcntl
import json
import os
from pathlib import Path
import pty
import select
import signal
import struct
import sys
import termios
import time
import tty

ROOT = Path(__file__).resolve().parents[2]
LOG = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.home() / '.roppo' / 'terminal-resize-diagnostic.jsonl'
if not sys.stdin.isatty() or not sys.stdout.isatty():
    raise SystemExit('Run this script inside the affected Terminal window.')
LOG.parent.mkdir(parents=True, exist_ok=True)
log_fd = os.open(LOG, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
log = os.fdopen(log_fd, 'w')


def record(kind, value):
    log.write(json.dumps({'time': time.monotonic(), 'kind': kind, 'value': value}) + '\n')
    log.flush()


def position(label):
    os.write(1, b'\x1b[6n')
    response = b''
    until = time.monotonic() + 0.5
    while time.monotonic() < until and not response.endswith(b'R'):
        if select.select([0], [], [], max(0, until - time.monotonic()))[0]:
            response += os.read(0, 1024)
    record(label, base64.b64encode(response).decode())


print('Offline Roppo test: resize this window / switch full screen, then type /exit.')
print('The diagnostic will be saved to ' + str(LOG), flush=True)
original = termios.tcgetattr(0)
child = None
master = None
try:
    tty.setraw(0)
    position('cursor-before')
    child, master = pty.fork()
    if child == 0:
        log.close()
        os.chdir(ROOT)
        os.execv(str(ROOT / 'node_modules/.bin/bun'), ['bun', str(Path(__file__).with_name('terminal-exit-fixture.ts'))])

    def resize(_signal=None, _frame=None):
        size = fcntl.ioctl(0, termios.TIOCGWINSZ, b'\0' * 8)
        fcntl.ioctl(master, termios.TIOCSWINSZ, size)
        record('size', list(struct.unpack('HHHH', size)))

    resize()
    signal.signal(signal.SIGWINCH, resize)
    record('environment', {key: os.environ.get(key) for key in ['TERM', 'TERM_PROGRAM', 'TERM_PROGRAM_VERSION']})
    while True:
        readable, _, _ = select.select([0, master], [], [])
        if master in readable:
            try:
                output = os.read(master, 65536)
            except OSError as error:
                if error.errno == errno.EIO:
                    break
                raise
            if not output:
                break
            record('output', base64.b64encode(output).decode())
            os.write(1, output)
        if 0 in readable:
            keys = os.read(0, 4096)
            record('input', base64.b64encode(keys).decode())
            os.write(master, keys)
    _, status = os.waitpid(child, 0)
    child = None
    record('exit-status', os.waitstatus_to_exitcode(status))
    position('cursor-after')
finally:
    termios.tcsetattr(0, termios.TCSADRAIN, original)
    if master is not None:
        os.close(master)
    if child:
        os.kill(child, signal.SIGHUP)
        os.waitpid(child, 0)
    log.close()
print('\nSaved: ' + str(LOG))
