"""Saved memories are managed only in Settings, through the real HTTP/SQLite fixture."""
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
    page.evaluate("""(id)=>{
      localStorage.setItem('agenthub.configuration.language','zh-CN');
      localStorage.setItem('agenthub.configuration.theme','light');
      localStorage.setItem('roppo.resources.'+id,JSON.stringify({tabs:[{id:'new',kind:'new'},{id:'files',kind:'files'},{id:'old-memory',kind:'memory'}],active:'old-memory',visible:true,recent:[{kind:'memory',at:20},{kind:'files',at:10}]}));
    }""", f['chat'])
    page.reload()
    page.wait_for_load_state('networkidle')
    expect(page.locator('#session-panel')).to_have_count(0)
    composer = page.get_by_role('textbox', name='向 Router 发送消息', exact=True)
    composer.fill('尚未发送的任务草稿')
    page.get_by_role('button', name='会话面板', exact=True).click()
    expect(page.get_by_role('tab', name='文件', exact=True)).to_be_visible()
    expect(page.get_by_role('tab', name='记忆', exact=True)).to_have_count(0)
    expect(page.get_by_role('button', name='记忆', exact=True)).to_have_count(0)
    check('the retired conversation memory tab disappears without losing other saved tools')

    api = f['url'] + '/api/chat/conversations/' + f['chat'] + '/memory'
    before = context.request.get(api).json()
    original_policy = before['policy']
    original_note = next(item for item in before['items'] if item['id'] == f['chatPreference'])
    page.get_by_role('link', name='设置', exact=True).click()
    settings_nav = page.get_by_role('navigation', name='设置分区', exact=True)
    settings_nav.get_by_role('button', name='记忆', exact=True).click()
    page.wait_for_url('**/configure#advanced/memory')
    memory = page.get_by_role('region', name='记忆', exact=True)
    expect(memory.locator('.memory-note')).to_have_count(4)
    expect(settings_nav.get_by_role('button', name='记忆', exact=True)).to_have_attribute('aria-current', 'page')
    expect(memory.locator('input,select,details')).to_have_count(0)
    expect(memory.get_by_role('switch')).to_have_count(0)
    for row in memory.locator('.memory-note').all():
        assert row.get_by_role('button').all_text_contents() == ['修改', '删除']
    expect(memory.locator('[data-memory-id="' + f['chatCandidate'] + '"]')).to_have_count(0)
    check('Settings contains saved memories with exactly Edit and Delete; no learning or entry configuration')
    page.screenshot(path=str(root / 'settings-light.png'), full_page=True)

    note = memory.locator('[data-memory-id="' + f['chatPreference'] + '"]')
    note.get_by_role('button', name='修改', exact=True).click()
    editor = note.get_by_role('textbox', name='记忆内容', exact=True)
    expect(editor).to_be_focused()
    expect(note.locator('textarea,input,select')).to_have_count(1)
    editor.fill('不保存的修改')
    note.get_by_role('button', name='取消', exact=True).click()
    expect(note.locator('.memory-content')).to_have_text(original_note['content'])
    expect(note.get_by_role('button', name='修改', exact=True)).to_be_focused()
    note.get_by_role('button', name='修改', exact=True).click()
    editor.fill('技术报告先列未验证项，再给结论与证据')
    note.get_by_role('button', name='保存', exact=True).click()
    expect(note.locator('.memory-content')).to_have_text('技术报告先列未验证项，再给结论与证据')
    saved = next(item for item in context.request.get(api).json()['items'] if item['id'] == f['chatPreference'])
    assert saved['learning']['condition'] == original_note['learning']['condition']
    assert saved['sources'] == original_note['sources']
    check('one-field editing persists content and preserves source and applicability; cancellation restores focus')

    removable = memory.locator('[data-memory-id="' + f['chatTentative'] + '"]')
    removable.get_by_role('button', name='删除', exact=True).click()
    removable.get_by_role('button', name='取消', exact=True).click()
    expect(removable.get_by_role('button', name='删除', exact=True)).to_be_focused()
    removable.get_by_role('button', name='删除', exact=True).click()
    removable.get_by_role('button', name='删除', exact=True).click()
    expect(removable).to_have_count(0)
    expect(memory.locator('.memory-note')).to_have_count(3)
    page.reload()
    expect(memory.locator('.memory-note')).to_have_count(3)
    expect(note.locator('.memory-content')).to_have_text('技术报告先列未验证项，再给结论与证据')
    unchanged = context.request.get(api).json()
    assert unchanged['policy'] == original_policy
    assert next(item for item in unchanged['items'] if item['id'] == f['chatCandidate'])['state'] == 'candidate'
    check('deletion survives reload without changing learning policy or confirming hidden candidates')

    page.get_by_role('button', name='切换为深色模式', exact=True).click()
    expect(page.locator('html')).to_have_attribute('data-theme', 'dark')
    page.screenshot(path=str(root / 'settings-dark.png'), full_page=True)
    page.get_by_role('button', name='切换为英文', exact=True).click()
    memory_en = page.get_by_role('region', name='Memory', exact=True)
    expect(memory_en.get_by_role('button', name='Edit', exact=True)).to_have_count(3)
    expect(memory_en.get_by_role('button', name='Delete', exact=True)).to_have_count(3)
    page.get_by_role('button', name='Switch to Chinese', exact=True).click()
    page.get_by_role('button', name='切换为浅色模式', exact=True).click()
    check('memory inherits the existing settings navigation, theme and language')

    page.get_by_role('link', name='共享指令', exact=True).click()
    expect(page.get_by_role('link', name='协作偏好', exact=True)).to_have_count(0)
    prompt = page.locator('#control-prompt-editor')
    prompt.fill('未保存的角色指令草稿')
    page.get_by_role('link', name='设置', exact=True).click()
    settings_nav.get_by_role('button', name='记忆', exact=True).click()
    expect(memory.locator('.memory-note')).to_have_count(3)
    page.get_by_role('link', name='共享指令', exact=True).click()
    expect(prompt).to_have_value('未保存的角色指令草稿')
    assert len(context.pages) == 1
    page.goto(f['url'] + '/chat?conversation=' + f['chat'])
    expect(composer).to_have_value('尚未发送的任务草稿')
    check('shared instructions has no memory entry and both instruction and conversation drafts survive navigation')

    page.goto(f['url'] + '/memory-workbench')
    page.wait_for_url('**/configure#advanced/memory')
    expect(memory.locator('.memory-note')).to_have_count(3)
    page.goto(f['url'] + '/configure#prompts/memory')
    page.wait_for_url('**/configure#advanced/memory')
    expect(memory.locator('.memory-note')).to_have_count(3)
    check('both retired memory addresses lead to the settings section')

    page.set_viewport_size({'width': 390, 'height': 844})
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    page.screenshot(path=str(root / 'settings-mobile.png'), full_page=True)
    note.get_by_role('button', name='修改', exact=True).click()
    expect(editor).to_be_focused()
    assert editor.evaluate('(e)=>parseFloat(getComputedStyle(e).fontSize)') >= 16
    note.get_by_role('button', name='取消', exact=True).click()
    check('390px settings and editing fit the viewport with readable input text')

    page.goto(f['url'] + '/router-management')
    page.wait_for_load_state('networkidle')
    expect(page.get_by_role('heading', name='Router 管理', exact=True)).to_be_visible()
    expect(page.locator('#memory-form,#router-memory,#clear-memory')).to_have_count(0)
    scopes_before = context.request.get(f['url'] + '/router-scopes').json()['scopes']
    page.get_by_role('button', name='保存 Router 设置', exact=True).click()
    expect(page.locator('#notice')).to_contain_text('Router 设置已保存')
    scopes_after = context.request.get(f['url'] + '/router-scopes').json()['scopes']
    assert scopes_after[0]['memoryEnabled'] == scopes_before[0]['memoryEnabled']
    check('the old Router page has no parallel memory controls; saving Router settings preserves memory policy')

    page.goto(f['url'] + '/configure#advanced/memory')
    expect(memory.locator('.memory-note')).to_have_count(3)
    for memory_id in [f['chatPreference'], f['forgetTarget'], f['old']]:
        row = memory.locator('[data-memory-id="' + memory_id + '"]')
        row.get_by_role('button', name='删除', exact=True).click()
        row.get_by_role('button', name='删除', exact=True).click()
        expect(row).to_have_count(0)
    expect(memory.get_by_text('暂无已保存的记忆。', exact=True)).to_be_visible()
    expect(memory.get_by_role('button')).to_have_count(0)
    assert context.request.get(api).json()['policy'] == original_policy
    check('an empty list has no setup prompts or extra management actions')
    assert not errors, errors
    check('no unexpected page or console errors; optional bare-host discovery probes recorded separately')
    browser.close()

(root / 'evidence.json').write_text(json.dumps({'ok': True, 'checks': checks, 'errors': errors, 'optional404Probes': optional_probes}, ensure_ascii=False, indent=2))
