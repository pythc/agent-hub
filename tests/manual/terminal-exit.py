"""Run on macOS/Linux: python3 tests/manual/terminal-exit.py.

Exercise the production TUI in a real PTY, including its native terminal writes.
Unsupported capability probes must never reach the original shell buffer.
"""
import errno
import fcntl
import os
from pathlib import Path
import pty
import re
import select
import signal
import struct
import subprocess
import termios
import time

ROOT = Path(__file__).resolve().parents[2]
ENTER, LEAVE = b'\x1b[?1049h', b'\x1b[?1049l'


def printable(data):
    return re.sub(rb'\x1b(?:\][^\x07\x1b]*(?:\x07|\x1b\\)|\[[0-?]*[ -/]*[@-~]|.)', b'', data)


def check(mode):
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 30, 120, 0, 0))
    original = termios.tcgetattr(slave)
    command = [str(ROOT / 'node_modules/.bin/bun'), str(Path(__file__).with_name('terminal-exit-fixture.ts'))]
    if mode == 'startup error':
        command.append('--fail')
    if mode == 'early /exit':
        command.append('--slow')
    child = subprocess.Popen(command, stdin=slave, stdout=slave, stderr=slave, cwd=ROOT,
                             env=dict(os.environ, TERM='xterm-256color', TERM_PROGRAM='Apple_Terminal'))
    output = b''
    sent = False
    resized_at = None
    cursor_reported = False
    deadline = time.monotonic() + 12
    try:
        while time.monotonic() < deadline:
            if select.select([master], [], [], 0.1)[0]:
                try:
                    chunk = os.read(master, 65536)
                except OSError as error:
                    if error.errno == errno.EIO:
                        break
                    raise
                if not chunk:
                    break
                output += chunk
            elif child.poll() is not None:
                break
            if mode in ['grow /exit', 'resize /exit'] and not cursor_reported and b'\x1b[6n' in output:
                os.write(master, b'\x1b[6;1R')
                cursor_reported = True
            last_row = b'\x1b[60;1H' if mode == 'grow /exit' else b'\x1b[24;1H'
            if resized_at is not None and not sent and last_row in output[resized_at:]:
                os.write(master, b'/exit\r')
                sent = True
            if not sent and b'Ask Roppo' in output:
                if mode in ['/exit', 'early /exit']:
                    os.write(master, b'/exit\r')
                elif mode == 'SIGTERM':
                    child.send_signal(signal.SIGTERM)
                elif mode in ['resize /exit', 'grow /exit']:
                    if resized_at is None:
                        resized_at = len(output)
                        rows, columns = (60, 207) if mode == 'grow /exit' else (24, 90)
                        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', rows, columns, 0, 0))
                        child.send_signal(signal.SIGWINCH)
                    continue
                sent = True
        assert child.poll() == 0, (mode, child.poll(), output[-2000:])
        assert output.count(ENTER) == output.count(LEAVE) == 1, mode
        before, active = output.split(ENTER)
        active, after = active.split(LEAVE)
        assert printable(before) == b'SHELL_BEFORE\r\n', (mode, before)
        assert printable(after) == b'SHELL_RETURN raw=false\r\n', (mode, after)
        if mode in ['grow /exit', 'resize /exit']:
            assert b'\x1b[H\x1b[24L' in before, 'Preserve shell rows before switching buffers'
            remaining = 24 if mode == 'grow /exit' else 18
            assert after.startswith(f'\x1b[H\x1b[{remaining}M\x1b[6;1H'.encode()), 'Restore the real shell cursor before returning to the shell'
        # Do not merely hide these in another buffer: never send them to Apple Terminal.
        assert b'+q4d73' not in output and b'Gi=31337' not in output, mode
        assert b'\x1bP' not in output and b'\x1b_' not in output and b'$p' not in output, mode
        assert b'\n' not in active, (mode, 'startup scrolled probes into terminal history')
        assert b'\x1b[?1000l' in active and b'\x1b[?2004l' in active, mode
        assert termios.tcgetattr(slave) == original, mode
        print(f'PASS {mode}: shell buffer isolated, input and mouse modes restored')
    finally:
        if child.poll() is None:
            child.kill()
        child.wait()
        os.close(master)
        os.close(slave)


for mode in ['/exit', 'early /exit', 'resize /exit', 'grow /exit', 'SIGTERM', 'startup error']:
    check(mode)
