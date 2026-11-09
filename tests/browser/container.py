"""Check a retained, isolated container acceptance host with real Chrome."""
import argparse
import json
from pathlib import Path
import subprocess
import time
import urllib.error
import urllib.request
from urllib.parse import urlparse

from playwright.sync_api import expect, sync_playwright

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('browser_file', type=Path)
parser.add_argument('output', type=Path)
parser.add_argument('--chrome', default='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
args = parser.parse_args()
config = json.loads(args.browser_file.read_text())
assert config['project'].startswith(('roppo-acceptance-', 'roppo-container-check-'))
args.output.mkdir(parents=True, exist_ok=False, mode=0o700)
result = {'passed': False, 'states': [], 'pageErrors': [], 'consoleErrors': [], 'failedResponses': []}
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=args.chrome, headless=True)
        try:
            context = browser.new_context(viewport={'width': 1440, 'height': 1000})
            page = context.new_page()
            page.on('pageerror', lambda e: result['pageErrors'].append(str(e)))
            page.goto(config['base'] + '/configure#models', wait_until='networkidle')
            page.locator('#field-username').fill(config['username'])
            page.locator('#field-username').press('Tab')
            expect(page.locator('#field-password')).to_be_focused()
            page.locator('#field-password').fill(config['password'])
            page.get_by_role('checkbox').check()
            page.get_by_role('button', name='Sign in', exact=True).click()
            expect(page.locator('#field-username')).to_be_hidden(timeout=30000)
            page.on('console', lambda m: result['consoleErrors'].append(m.text) if m.type == 'error' else None)
            page.on('response', lambda r: result['failedResponses'].append({'status': r.status, 'path': urlparse(r.url).path}) if r.status >= 400 else None)
            page.goto(config['base'] + '/configure#models', wait_until='networkidle')
            expect(page.get_by_role('heading', name='Model connections', exact=True)).to_be_visible()
            cookies = [c for c in context.cookies() if c['name'].startswith('roppo_owner_')]
            assert len(cookies) == 1 and cookies[0]['httpOnly'] and cookies[0]['sameSite'] == 'Strict'
            assert page.request.get(config['base'] + '/settings').status == 200
            result['mappedPortLoginAndAuthenticatedRequests'] = True
            for language in ('en', 'zh'):
                if language == 'zh':
                    page.get_by_role('button', name='Switch to Chinese', exact=True).click()
                for theme in ('light', 'dark'):
                    if page.locator('html').get_attribute('data-theme') != theme:
                        label = ('Switch to light mode' if theme == 'light' else 'Switch to dark mode') if language == 'en' else ('切换为浅色模式' if theme == 'light' else '切换为深色模式')
                        page.get_by_role('button', name=label, exact=True).click()
                    expect(page.locator('html')).to_have_attribute('data-theme', theme)
                    for width in (1440, 390):
                        page.set_viewport_size({'width': width, 'height': 1000})
                        expect(page.get_by_role('heading', name='Model connections' if language == 'en' else '模型连接', exact=True)).to_be_visible()
                        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Horizontal overflow'
                        page.screenshot(path=str(args.output / f'{language}-{theme}-{width}.png'), full_page=True, animations='disabled')
                        result['states'].append({'language': language, 'theme': theme, 'width': width, 'overflow': False})
            page.emulate_media(reduced_motion='reduce')
            page.reload(wait_until='networkidle')
            expect(page.get_by_role('heading', name='模型连接', exact=True)).to_be_visible()
            expect(page.locator('html')).to_have_attribute('data-theme', 'dark')
            result['preferencesAndReload'] = True
            # Restart only the exact project container created by our fixture.
            cid = subprocess.check_output(['docker', 'ps', '-q', '--filter', 'label=com.docker.compose.project=' + config['project'], '--filter', 'label=com.docker.compose.service=roppo'], text=True).strip()
            assert cid and '\n' not in cid
            info = json.loads(subprocess.check_output(['docker', 'inspect', cid], text=True))[0]
            assert info['Config']['Labels']['com.docker.compose.project'] == config['project']
            subprocess.run(['docker', 'restart', cid], check=True, capture_output=True, timeout=60)
            deadline = time.monotonic() + 90
            while time.monotonic() < deadline:
                try:
                    with urllib.request.urlopen(config['base'] + '/health', timeout=2) as response:
                        if json.load(response).get('ok'):
                            break
                except (urllib.error.URLError, TimeoutError, ConnectionError):
                    pass
                time.sleep(.25)
            else:
                raise AssertionError('Container did not recover after restart')
            assert page.request.get(config['base'] + '/settings').status == 200
            page.reload(wait_until='networkidle')
            expect(page.get_by_role('heading', name='模型连接', exact=True)).to_be_visible()
            result['sameBrowserSessionAfterContainerRestart'] = True
            page.goto(config['base'] + '/chat', wait_until='networkidle')
            expect(page.locator('#field-username')).to_have_count(0)
            result['chatAfterRestart'] = True
            known = {'/workspaces', '/connection-capabilities'}
            unexpected = [r for r in result['failedResponses'] if not (r['status'] == 404 and r['path'] in known)]
            console = [e for e in result['consoleErrors'] if e != 'Failed to load resource: the server responded with a status of 404 (Not Found)']
            result['unexpectedResponses'] = unexpected
            result['unexpectedConsoleErrors'] = console
            assert not result['pageErrors'] and not unexpected and not console
            result['passed'] = True
        finally:
            browser.close()
finally:
    (args.output / 'result.json').write_text(json.dumps(result, indent=2, ensure_ascii=False))
print(json.dumps({'passed': result['passed'], 'states': len(result['states']), 'evidence': str(args.output)}))
