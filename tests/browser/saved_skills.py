"""Drive the skill workbench against examples/webhook-workbench-fixture.ts (WEBHOOK_UI_WAIT=0)."""
import base64
import hashlib
import hmac
import json
import os
import re
import sys
import time
import uuid
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

root = Path(sys.argv[1])
info = json.loads((root / 'browser-info.json').read_text())
base = info['url']
errors = []
with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True, executable_path=os.environ.get('BROWSER_EXECUTABLE'))
    context = browser.new_context(viewport={'width': 1366, 'height': 900}, reduced_motion='reduce')
    page = context.new_page()
    page.on('pageerror', lambda error: errors.append(str(error)))
    api = context.request
    headers = {'authorization': 'Bearer ' + info['token'], 'origin': base}
    account = {'username': 'skills-owner', 'displayName': 'Owner', 'password': 'skills-workbench-only-test'}
    if not api.get(base + '/account/status', headers=headers).json()['configured']:
        assert api.post(base + '/account/setup', headers=headers, data=account).ok
    assert api.post(base + '/account/login', headers={'origin': base}, data={'username': account['username'], 'password': account['password']}).ok
    event_id = uuid.uuid4().hex
    body = json.dumps({'specversion': '1.0', 'id': event_id, 'source': 'https://producer.example/events',
                       'type': 'test.request', 'data': {'batch': event_id}}, separators=(',', ':')).encode()
    key = base64.b64decode(json.loads((root / 'test-keys.json').read_text())['WEBHOOK_UI_IN'][6:])
    stamp = str(int(time.time()))
    sig = base64.b64encode(hmac.new(key, event_id.encode() + b'.' + stamp.encode() + b'.' + body, hashlib.sha256).digest()).decode()
    assert api.post(info['webhookUrl'] + '/webhooks/' + info['grantId'], data=body, headers={
        'content-type': 'application/cloudevents+json', 'webhook-id': event_id, 'webhook-timestamp': stamp,
        'webhook-signature': 'v1,' + sig}).ok
    page.goto(base + '/router-proactive')
    page.wait_for_load_state('networkidle')
    for _ in range(60):
        if page.locator('#accepted-goal option').count():
            break
        page.get_by_role('button', name='刷新状态').click()
        page.wait_for_timeout(300)
    page.goto(base + '/configure#tasks/history')
    page.locator('button[id^="work-"]').first.click()
    page.get_by_role('dialog').get_by_role('link', name=re.compile('Save as a skill|保存为技能')).click()
    form = page.locator('#skill-editor')
    form.get_by_label('名称').fill('CI diagnosis')
    form.get_by_role('button', name='保存新版本').click()
    expect(page.locator('#skills')).to_contain_text('CI diagnosis')
    page.get_by_role('button', name='编辑或恢复此版').first.click()
    form.get_by_label('名称').fill('CI diagnosis v2')
    form.get_by_role('button', name='保存新版本').click()
    expect(page.locator('#skills')).to_contain_text('v2')
    first = page.locator('#skills tr').filter(has_text='v1')
    first.get_by_role('button', name='绑定事件').click()
    expect(page.locator('#editor-title')).to_contain_text('CI diagnosis v1')
    expect(page.locator('#create [name=objective]')).to_have_attribute('readonly', '')
    page.go_back()
    page.set_viewport_size({'width': 390, 'height': 844})
    page.wait_for_load_state('networkidle')
    page.locator('#skills tr').filter(has_text='v1').get_by_role('button', name='手动运行').click()
    expect(page.get_by_label('本次请求原文')).to_be_focused()
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    assert not errors, errors
    print('Browser passed: opened a completed task, saved two versions, opened the pinned event form, reached manual run on mobile.')
    browser.close()
