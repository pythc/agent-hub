"""Numeric-only usage bridge, source filtering, unknown/zero and older-host compatibility."""
import json
import os
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

root = Path(sys.argv[1])
info = json.loads((root / 'browser.json').read_text())
out = root / 'usage-screenshots'
out.mkdir(exist_ok=True)
checks, errors, variant = [], [], {}
with sync_playwright() as p:
    options = {'headless': True}
    chrome = os.environ.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE')
    if chrome:
        options['executable_path'] = chrome
    browser = p.chromium.launch(**options)
    context = browser.new_context(viewport={'width': 1440, 'height': 1080}, reduced_motion='reduce')
    name, value = info['cookie'].split('=', 1)
    context.add_cookies([{'name': name, 'value': value, 'url': info['base']}])
    page = context.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))

    def fixture(route):
        response = route.fetch()
        data = response.json()
        if variant.get('legacy'):
            data.pop('usage', None)
        elif variant.get('unknown'):
            for key in data['usage']['tokens']:
                data['usage']['tokens'][key] = None
            data['usage']['tokens']['outputTokens'] = 0
        route.fulfill(response=response, json=data)

    page.route('**/api/workspace-views/*/runtime?*', fixture)
    try:
        page.goto(info['url'])
        page.wait_for_load_state('networkidle')
        frame = page.frame_locator('iframe[title="Agent board"]')
        frame.get_by_role('tab', name='Listening & usage', exact=True).click()
        usage = frame.get_by_role('region', name='Team token usage')
        expect(usage.locator('.usage-totals dd')).to_have_text(['76,200', '75,000', '48,000', '1,200', '240'])
        expect(usage.locator('.usage-coverage')).to_contain_text('Calls with usage 6 / 7')
        expect(usage.locator('.usage-coverage')).to_contain_text('Unknown 1')
        expect(usage.locator('.usage-coverage')).to_contain_text('Partial 0')
        frame.get_by_role('combobox', name='Filter by source').select_option('personal')
        expect(usage.locator('.usage-totals dd').first).to_have_text('39,600')
        expect(frame.locator('.usage').locator('dl dd').first).to_have_text('360')
        frame.get_by_role('combobox', name='Filter by source').select_option('')
        expect(usage.locator('.usage-totals dd').first).to_have_text('76,200')
        checks.append('Real numeric bridge; team source filter; auxiliary all-source scope preserved')

        for language in ['en', 'zh']:
            if language == 'zh':
                page.get_by_role('button', name='Switch to Chinese', exact=True).click()
                frame = page.frame_locator('iframe[title="Agent 看板"]')
                usage = frame.get_by_role('region', name='团队 token 用量')
            for dark in [False, True]:
                if dark:
                    page.get_by_role('button', name='Switch to dark mode' if language == 'en' else '切换为深色模式', exact=True).click()
                for width in [1440, 390]:
                    page.set_viewport_size({'width': width, 'height': 1080})
                    expect(usage).to_be_visible()
                    assert usage.locator('table tbody tr').count() == 6
                    assert frame.locator('html').evaluate('e => e.scrollWidth <= e.clientWidth + 1')
                    page.screenshot(path=str(out / f'{language}-{dark}-{width}.png'), full_page=True)
                if dark:
                    page.get_by_role('button', name='Switch to light mode' if language == 'en' else '切换为浅色模式', exact=True).click()
        checks.append('English/Chinese, light/dark, 1440/390px and reduced motion without page overflow')

        variant['unknown'] = True
        page.wait_for_timeout(350)
        frame.get_by_role('button', name='刷新看板').click()
        expect(usage.locator('.usage-totals dd')).to_have_text(['未知', '未知', '未知', '0', '未知'])
        variant.clear()
        variant['legacy'] = True
        page.wait_for_timeout(350)
        frame.get_by_role('button', name='刷新看板').click()
        expect(usage).to_contain_text('当前宿主尚未提供团队用量。')
        checks.append('Unknown differs from zero; old hosts show unavailable instead of fake totals')
        assert not errors, errors
    finally:
        (root / 'usage-results.json').write_text(json.dumps({'checks': checks, 'errors': errors}, ensure_ascii=False, indent=2))
        browser.close()
print(json.dumps({'passed': True, 'checks': checks}, ensure_ascii=False))
