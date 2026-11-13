"""Memory in the shared conversation shell; uses an isolated HTTP/SQLite fixture."""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

root = Path(os.environ['MEMORY_BROWSER_DIR'])
f = json.loads((root / 'fixture.json').read_text())
checks, errors, optional_probes = [], [], []


def check(message):
    checks.append(message)
    print('PASS ' + message, flush=True)


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(viewport={'width': 1440, 'height': 1000}, reduced_motion='reduce')
    name, value = f['cookie'].split('=', 1)
    context.add_cookies([{'name': name, 'value': value, 'url': f['url']}])
    page = context.new_page()
    page.on('pageerror', lambda error: errors.append(str(error)))
    def console(message):
        if message.type != 'error':
            return
        url = message.location.get('url', '')
        if url in {f['url'] + '/workspaces', f['url'] + '/connection-capabilities'} and '404 (Not Found)' in message.text:
            optional_probes.append(url.rsplit('/', 1)[-1])
        else:
            errors.append(message.text + ' ' + url)
    page.on('console', console)
    page.goto(f['url'] + '/chat?conversation=' + f['chat'])
    page.evaluate("localStorage.setItem('agenthub.configuration.language','zh-CN');localStorage.setItem('agenthub.configuration.theme','light')")
    page.reload()
    page.wait_for_load_state('networkidle')
    page.get_by_role('button', name='会话面板', exact=True).click()
    page.get_by_role('button', name='记忆', exact=True).click()
    panel = page.get_by_role('region', name='会话记忆', exact=True)
    expect(panel.locator('.memory-note')).to_have_count(3)
    expect(panel.get_by_text('暂定偏好', exact=True)).to_be_visible()
    expect(panel.get_by_role('switch')).to_have_count(1)
    expect(panel.locator('select')).to_have_count(0)
    check('conversation memory uses the existing shell and one learning switch')
    page.screenshot(path=str(root / 'chat-light.png'), full_page=True)

    api = f['url'] + '/api/chat/conversations/' + f['chat'] + '/memory'
    original_policy = context.request.get(api).json()['policy']
    learning = panel.get_by_role('switch', name='在协作中学习', exact=True)
    learning.click()
    expect(learning).to_be_checked()
    page.reload()
    expect(page.get_by_role('switch', name='在协作中学习', exact=True)).to_be_checked()
    saved = context.request.get(api).json()['policy']
    assert saved == {**original_policy, 'enabled': True, 'writeMode': 'adaptive'}, saved
    check('learning persists and preserves existing model, budget and retrieval settings')

    preference = panel.locator('[data-memory-id="' + f['chatPreference'] + '"]')
    preference.get_by_role('button', name='纠正', exact=True).click()
    expect(preference.get_by_role('textbox', name='记住什么', exact=True)).to_be_focused()
    preference.get_by_role('textbox', name='记住什么', exact=True).fill('技术报告先列未验证项，再给结论与证据')
    preference.get_by_role('textbox', name='适用时机', exact=True).fill('代码修复报告')
    preference.get_by_role('button', name='保存', exact=True).click()
    expect(preference.locator('.memory-content')).to_have_text('技术报告先列未验证项，再给结论与证据')
    expect(preference).to_contain_text('代码修复报告')
    preference.locator('summary').click()
    expect(preference.locator('blockquote')).to_contain_text(f['chatTitle'])
    expect(preference.locator('.memory-detail')).to_contain_text('之前：技术报告先给结论，再给验证证据')
    preference.locator('summary').click()
    check('inline correction saves applicability, retains original source and shows revision history')

    candidate = panel.locator('[data-memory-id="' + f['chatCandidate'] + '"]')
    candidate.get_by_role('button', name='保留', exact=True).click()
    expect(candidate).to_contain_text('你已确认')
    tentative = panel.locator('[data-memory-id="' + f['chatTentative'] + '"]')
    tentative.get_by_role('button', name='忘记', exact=True).click()
    tentative.get_by_role('button', name='取消', exact=True).click()
    expect(tentative).to_be_visible()
    tentative.get_by_role('button', name='忘记', exact=True).click()
    tentative.get_by_role('button', name='确认忘记', exact=True).click()
    expect(tentative).to_have_count(0)
    check('candidate confirmation and inline forgetting persist through the real API')

    current = context.request.get(api).json()
    response = context.request.post(api, headers={'Origin': f['url']}, data={'kind': 'manage', 'command': {'action': 'configure', 'expectedRevision': current['revision'], 'policy': {**current['policy'], 'writeMode': 'auto'}}})
    assert response.ok, (response.status, response.text())
    page.reload()
    expect(panel.get_by_role('switch')).to_be_checked()
    assert context.request.get(api).json()['policy']['writeMode'] == 'auto'
    check('an existing candidate-only learning policy remains enabled without being rewritten on load')
    panel.get_by_role('switch', name='在协作中学习', exact=True).click()
    expect(panel.get_by_role('switch')).not_to_be_checked()
    expect(panel.locator('.memory-note')).to_have_count(2)
    policy = context.request.get(api).json()['policy']
    assert policy['enabled'] and policy['writeMode'] == 'explicit_only'
    assert context.request.get(api).json()['enabled']
    check('stopping automatic learning keeps saved memories visible and usable')
    search = panel.get_by_role('textbox', name='查找记忆', exact=True)
    search.fill('未验证项')
    expect(panel.locator('.memory-note')).to_have_count(1)
    search.fill('')
    check('local search filters saved memories without extra model calls')

    composer = page.get_by_role('textbox', name='向 Router 发送消息', exact=True)
    composer.fill('这是一条尚未发送的任务草稿')
    page.get_by_role('button', name='收起面板', exact=True).click()
    expect(panel).to_have_count(0)
    expect(composer).to_have_value('这是一条尚未发送的任务草稿')
    page.get_by_role('button', name='会话面板', exact=True).click()
    expect(panel.locator('.memory-note')).to_have_count(2)
    check('closing and reopening memory preserves the conversation draft and selected tab')
    memory_tab = page.get_by_role('tab', name='记忆', exact=True)
    memory_tab.focus()
    page.keyboard.press('ArrowLeft')
    expect(page.get_by_role('tab', name='新标签页', exact=True)).to_be_focused()
    page.keyboard.press('ArrowRight')
    expect(memory_tab).to_be_focused()
    check('memory participates in existing keyboard tab navigation')

    page.get_by_role('button', name='切换为深色模式', exact=True).click()
    expect(page.locator('html')).to_have_attribute('data-theme', 'dark')
    page.screenshot(path=str(root / 'chat-dark.png'), full_page=True)
    page.get_by_role('button', name='切换为英文', exact=True).click()
    expect(page.get_by_role('switch', name='Learn from our work', exact=True)).to_be_visible()
    page.get_by_role('button', name='Switch to Chinese', exact=True).click()
    check('memory follows the shared dark theme and language controls')

    panel.get_by_role('link', name='查看协作偏好', exact=True).click()
    page.wait_for_url('**/configure?conversation=*#prompts/memory')
    preferences = page.get_by_role('region', name='协作偏好', exact=True)
    expect(preferences.get_by_role('heading', name='协作偏好', exact=True)).to_be_visible()
    selector = preferences.get_by_role('combobox', name='会话入口', exact=True)
    expect(selector).to_have_value(f['chatTrigger'])
    expect(preferences.locator('.memory-note')).to_have_count(2)
    page.screenshot(path=str(root / 'preferences-dark.png'), full_page=True)
    selector.select_option(label='另一个独立任务')
    expect(preferences.locator('.memory-note')).to_have_count(0)
    selector.select_option(f['chatTrigger'])
    expect(preferences.locator('.memory-note')).to_have_count(2)
    check('shared instructions opens the current conversation and switching entries removes previous notes')

    page.get_by_role('button', name='切换为浅色模式', exact=True).click()
    page.screenshot(path=str(root / 'preferences-light.png'), full_page=True)
    selector.select_option(label='用于浏览器拒绝建议验证')
    original = preferences.locator('[data-memory-id="' + f['old'] + '"]')
    original.locator('summary').click()
    expect(original.locator('blockquote')).to_contain_text('<script>window.memoryPwned=1</script>')
    assert page.evaluate('window.memoryPwned') is None
    check('source markup renders as text, without executing it')
    replacement = preferences.locator('[data-memory-id="' + f['pending'] + '"]')
    expect(replacement.locator('.memory-replacement')).to_contain_text('技术报告先给结论')
    replacement.get_by_role('button', name='采用修改', exact=True).click()
    expect(original).to_have_count(0)
    expect(replacement).to_contain_text('你已确认')
    suggestion = preferences.locator('[data-memory-id="' + f['rejected'] + '"]')
    suggestion.get_by_role('button', name='不采用', exact=True).click()
    expect(suggestion).to_have_count(0)
    deletion = preferences.locator('[data-memory-id="' + f['deletion'] + '"]')
    expect(deletion.locator('.memory-replacement')).to_contain_text('浏览器过期约定')
    deletion.get_by_role('button', name='确认忘记', exact=True).click()
    expect(deletion).to_have_count(0)
    expect(preferences.locator('[data-memory-id="' + f['forgetTarget'] + '"]')).to_have_count(0)
    check('replacement and removal suggestions state their effects; dismissal preserves unrelated notes')

    preferences.get_by_role('link', name='共享指令', exact=True).click()
    page.wait_for_url('**/configure#prompts')
    editor = page.locator('#control-prompt-editor')
    editor.fill('未保存的角色指令草稿：先给结论。')
    page.get_by_role('link', name='协作偏好', exact=True).click()
    expect(page.get_by_role('region', name='协作偏好', exact=True)).to_be_visible()
    preferences.get_by_role('link', name='共享指令', exact=True).click()
    expect(editor).to_have_value('未保存的角色指令草稿：先给结论。')
    assert len(context.pages) == 1
    check('opening collaboration preferences preserves the shared-instructions draft in the same tab')
    response = page.goto(f['url'] + '/memory-workbench')
    page.wait_for_url('**/configure#prompts/memory')
    assert response.request.redirected_from is not None
    check('existing shared instructions exposes the integrated view and the retired URL redirects')

    page.goto(f['url'] + '/chat?conversation=' + f['chat'])
    expect(panel.locator('.memory-note')).to_have_count(2)
    expect(composer).to_have_value('这是一条尚未发送的任务草稿')
    expect(panel.locator('[data-memory-id="' + f['chatPreference'] + '"]')).to_contain_text('代码修复报告')
    page.set_viewport_size({'width': 390, 'height': 844})
    expect(panel).to_be_visible()
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    page.screenshot(path=str(root / 'chat-mobile.png'), full_page=True)
    preference.get_by_role('button', name='纠正', exact=True).click()
    assert preference.get_by_role('textbox', name='记住什么', exact=True).evaluate('(e)=>parseFloat(getComputedStyle(e).fontSize)') >= 16
    preference.get_by_role('button', name='取消', exact=True).click()
    panel.get_by_role('link', name='查看协作偏好', exact=True).click()
    expect(preferences.locator('.memory-note')).to_have_count(2)
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    page.screenshot(path=str(root / 'preferences-mobile.png'), full_page=True)
    check('390px layouts fit the viewport, retain edits and use readable input sizes')

    page.goto(f['url'] + '/chat')
    page.wait_for_load_state('networkidle')
    page.get_by_role('button', name='会话面板', exact=True).click()
    page.get_by_role('button', name='记忆', exact=True).click()
    expect(panel.get_by_role('heading', name='这里还没有记忆', exact=True)).to_be_visible()
    expect(panel.get_by_role('switch')).to_have_count(0)
    expect(panel.locator('select,input')).to_have_count(0)
    check('a new conversation has an honest empty state without a setup form')
    assert not errors, errors
    check('no unexpected page or console errors; optional bare-host discovery probes recorded separately')
    browser.close()

(root / 'evidence.json').write_text(json.dumps({'ok': True, 'checks': checks, 'errors': errors, 'optional404Probes': optional_probes}, ensure_ascii=False, indent=2))
