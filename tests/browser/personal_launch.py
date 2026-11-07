"""Real CLI + real account/browser flow; the OS opener is recorded, not launched.

Usage: .local/browser-venv/bin/python tests/browser/personal_launch.py <new-fixture-root> <evidence-dir>
Only synthetic credentials and a fresh private installation are used.
"""
import hashlib
import json
import os
import selectors
import shutil
import subprocess
import sys
import time
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

root = Path(sys.argv[1]).resolve()
out = Path(sys.argv[2]).resolve()
root.mkdir(parents=True, exist_ok=True)
out.mkdir(parents=True, exist_ok=True)
(out / 'result.json').unlink(missing_ok=True)
install = root / 'installation'
assert not (install / 'config.json').exists(), 'Use a new fixture directory'
bin_dir = root / 'bin'
bin_dir.mkdir(exist_ok=True)
(bin_dir / 'package.json').write_text('{"type":"module"}')
calls = root / 'browser-calls.jsonl'
for name in ['open', 'xdg-open', 'rundll32.exe']:
    wrapper = bin_dir / name
    wrapper.write_text('#!/usr/bin/env node\n' +
        'import {appendFileSync} from "node:fs"; appendFileSync(' + json.dumps(str(calls)) +
        ',JSON.stringify(process.argv.slice(2))+"\\n",{mode:0o600});\n' +
        'process.exit(Number(process.env.ROPPO_TEST_OPEN_EXIT || 0));\n')
    wrapper.chmod(0o700)
env = os.environ.copy()
for name in ['CI', 'SSH_CONNECTION', 'SSH_TTY', 'AGENTHUB_ENV_FILE']:
    env.pop(name, None)
env['PATH'] = str(bin_dir) + os.pathsep + env.get('PATH', '')
if sys.platform.startswith('linux'):
    env['DISPLAY'] = ':test-opener'
node = shutil.which('node')
assert node
cli = [node, '--import', str(Path('node_modules/tsx/dist/loader.mjs').resolve()), str(Path('src/cli.ts').resolve())]
child = None

def launch_calls():
    return [json.loads(line) for line in calls.read_text().splitlines()] if calls.exists() else []

def opened(count):
    end = time.monotonic() + 6
    while len(launch_calls()) < count and time.monotonic() < end:
        time.sleep(.05)
    rows = launch_calls()
    assert len(rows) == count, 'Expected one OS browser-open request per launch'
    return rows[-1][-1]

def boot(mode='setup'):
    global child
    args = ['serve', str(install / 'config.json')] if mode == 'serve' else ['setup', str(install)]
    child = subprocess.Popen(cli + args, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    with selectors.DefaultSelector() as selector:
        selector.register(child.stdout, selectors.EVENT_READ)
        assert selector.select(12), 'CLI did not report readiness'
        line = child.stdout.readline()
    assert line.startswith('{'), 'CLI startup failed'
    return json.loads(line)

def command(*args, extra_env=None):
    result = subprocess.run(cli + list(args), env={**env, **(extra_env or {})}, capture_output=True, text=True, timeout=15)
    assert result.returncode == 0, 'CLI entry command failed'
    return json.loads(result.stdout), result.stderr

def stop():
    global child
    if child is not None:
        child.terminate()
        try:
            child.communicate(timeout=8)
        except subprocess.TimeoutExpired:
            child.kill()
            child.communicate(timeout=3)
        child = None

errors = []
try:
    first = boot()
    assert opened(1) == first['url']
    base = first['url'].split('/configure')[0]
    with sync_playwright() as p:
        browser = p.chromium.launch()
        context = browser.new_context(viewport={'width':1440, 'height':960}, reduced_motion='reduce')
        page = context.new_page()
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(base)
        expect(page.get_by_role('heading', name='Open Roppo to get started.')).to_be_visible()
        page.goto(first['url'])
        expect(page.get_by_role('heading', name='Create your account.')).to_be_visible()
        assert 'pair=' not in page.url
        assert page.evaluate('document.documentElement.scrollHeight<=innerHeight')
        page.screenshot(path=str(out / 'first-launch.png'))
        page.get_by_label('Your name', exact=True).fill('Launch Test')
        page.get_by_label('Username', exact=True).fill('launch.test')
        page.get_by_label('Password', exact=True).fill('test-only launch passphrase')
        page.get_by_label('Confirm password', exact=True).fill('test-only launch passphrase')
        page.get_by_role('button', name='Create account', exact=True).click()
        expect(page.get_by_role('heading', name='Keep a way back in.')).to_be_visible()
        page.get_by_label('I saved my recovery code').check()
        page.get_by_role('button', name='Enter workspace').click()
        expect(page.get_by_role('heading', name='Current workspace', exact=True)).to_be_visible(timeout=15000)
        second, _ = command('setup', str(install))
        assert second['reused'] is True and opened(2) == second['url']
        page.goto(second['url'])
        expect(page.get_by_role('heading', name='Current workspace', exact=True)).to_be_visible()
        page.screenshot(path=str(out / 'remembered-entry.png'))
        other = browser.new_context(viewport={'width':390, 'height':844}, reduced_motion='reduce')
        fresh = other.new_page()
        fresh.on('pageerror', lambda error: errors.append(str(error)))
        link, _ = command('open', base, first['tokenFile'])
        assert opened(3) == link['url']
        fresh.goto(link['url'])
        expect(fresh.get_by_role('heading', name='Welcome back.')).to_be_visible()
        expect(fresh.get_by_role('button', name='Create account', exact=True)).to_have_count(0)
        fresh.screenshot(path=str(out / 'new-browser-login.png'))
        account_file = install / 'state' / 'personal-account.json'
        account_hash = hashlib.sha256(account_file.read_bytes()).hexdigest()
        stop()
        restarted = boot()
        assert opened(4) == restarted['url']
        assert restarted['url'].split('/configure')[0] == base
        assert hashlib.sha256(account_file.read_bytes()).hexdigest() == account_hash
        page.goto(restarted['url'])
        expect(page.get_by_role('heading', name='Current workspace', exact=True)).to_be_visible()
        fresh.goto(base)
        expect(fresh.get_by_role('heading', name='Welcome back.')).to_be_visible()
        manual, _ = command('setup', '--no-open', str(install))
        assert manual['reused'] is True and len(launch_calls()) == 4
        _, _ = command('open', base, first['tokenFile'], '--no-open')
        assert len(launch_calls()) == 4
        _, warning = command('setup', str(install), extra_env={'ROPPO_TEST_OPEN_EXIT':'1'})
        opened(5)
        assert 'Browser not opened' in warning and '#pair=' not in warning
        assert page.request.get(base + '/health').ok
        _, _ = command('setup', str(install), extra_env={'CI':'true'})
        assert len(launch_calls()) == 5
        # Existing configured service deployments keep their explicit startup mode.
        account_hash = hashlib.sha256(account_file.read_bytes()).hexdigest()
        stop()
        served = boot('serve')
        assert len(launch_calls()) == 5
        assert hashlib.sha256(account_file.read_bytes()).hexdigest() == account_hash
        page.goto(served['url'])
        expect(page.get_by_role('heading', name='Current workspace', exact=True)).to_be_visible()
        assert not errors, errors
        browser.close()
    (out / 'result.json').write_text(json.dumps({'passed':True,'checks':['CLI dispatches browser entry on fresh launch, reuse, explicit open and restart','first launch creates account without manual pairing','remembered session enters workspace','new browser requires login','restart preserves owner and remembered session','manual/no-open and CI modes','opener failure keeps host alive','explicit serve preserves existing account and does not open a browser'],'pageErrors':errors,'boundary':'OS opener recorded by a test executable; pages and backend exercised in desktop Chromium; native OS browser opening not verified'}, indent=2))
    print(json.dumps({'passed':True, 'evidence':str(out)}))
finally:
    stop()
