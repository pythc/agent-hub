"""Driven against the signed CI and Linear fixture in personal-workflows.spec.ts."""
import os
import re
import sys
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

base, token_path = sys.argv[1:]
with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True, executable_path=os.environ.get('BROWSER_EXECUTABLE'))
    context = browser.new_context(viewport={'width': 390, 'height': 844}, reduced_motion='reduce')
    headers = {'authorization': 'Bearer ' + Path(token_path).read_text().strip(), 'origin': base}
    account = {'username': 'test-owner', 'displayName': 'Owner', 'password': 'single-test-fixture-password'}
    assert context.request.post(base + '/account/setup', headers=headers, data=account).ok
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(base + '/configure#attention')
    issue = page.locator('article').filter(has_text='OPS-7')
    expect(issue).to_contain_text('Todo → Investigating')
    issue.get_by_role('button', name=re.compile(r'^(Approve|批准)$')).click()
    expect(page.get_by_role('status').filter(has_text='OPS-7')).to_contain_text(re.compile('Written and verified|已写入并回读'))
    expect(issue).to_have_count(0)
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    assert not errors, errors
    browser.close()
