"""Read-only provenance UI acceptance on the actual HTTP/SQLite memory fixture."""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

root = Path(os.environ['MEMORY_BROWSER_DIR'])
f = json.loads((root / 'fixture.json').read_text())
errors = []
checks = []
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=os.environ.get('CHROMIUM_EXECUTABLE', '/usr/bin/chromium'))
    context = browser.new_context(viewport={'width': 1440, 'height': 1000})
    name, value = f['cookie'].split('=', 1)
    context.add_cookies([{'name': name, 'value': value, 'url': f['url']}])
    page = context.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(f['url'] + '/configure#advanced/memory')
    page.evaluate("localStorage.setItem('agenthub.configuration.language','zh-CN');localStorage.setItem('agenthub.configuration.theme','light')")
    page.reload()
    memory = page.get_by_role('region', name='记忆', exact=True)
    expect(memory.locator('.memory-note')).to_have_count(4)
    expect(memory.locator('.memory-provenance')).to_have_count(4)
    expect(memory.locator('.memory-provenance-note,dl')).to_have_count(0)
    tentative = memory.locator('[data-memory-id="' + f['chatTentative'] + '"]')
    expect(tentative.locator('.memory-provenance')).to_contain_text('推断记忆')
    assert tentative.locator('.memory-provenance').evaluate('(e)=>parseFloat(getComputedStyle(e).fontSize)') >= 14
    expect(memory).not_to_contain_text('未设置到期时间')
    assert page.evaluate('window.memoryPwned') is None
    checks.append('four memories have compact origin labels; inference appears once and unset expiry adds no clutter')
    page.screenshot(path=str(root / 'provenance-light.png'), full_page=True)
    note = memory.locator('[data-memory-id="' + f['chatPreference'] + '"]')
    before = note.locator('.memory-content').inner_text()
    note.get_by_role('button', name='修改', exact=True).click()
    editor = note.get_by_role('textbox', name='记忆内容', exact=True)
    expect(editor).to_be_focused()
    editor.fill('unsaved')
    note.get_by_role('button', name='取消', exact=True).click()
    expect(note.locator('.memory-content')).to_have_text(before)
    expect(note.get_by_role('button', name='修改', exact=True)).to_be_focused()
    expect(tentative.locator('.memory-provenance')).to_be_visible()
    checks.append('edit cancellation restores focus, original content and provenance')
    page.get_by_role('button', name='切换为深色模式', exact=True).click()
    expect(page.locator('html')).to_have_attribute('data-theme', 'dark')
    page.screenshot(path=str(root / 'provenance-dark.png'), full_page=True)
    page.get_by_role('button', name='切换为英文', exact=True).click()
    expect(tentative.locator('.memory-provenance')).to_have_text('Inferred memory')
    checks.append('existing theme and language controls update explanations')
    page.emulate_media(reduced_motion='reduce')
    page.set_viewport_size({'width':390,'height':844})
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    for row in page.locator('.memory-provenance').all():
        assert row.evaluate('(e)=>e.scrollWidth<=e.clientWidth')
    page.screenshot(path=str(root / 'provenance-mobile.png'), full_page=True)
    checks.append('390px layout and reduced-motion retain all metadata without horizontal overflow')
    page.reload()
    expect(page.locator('.memory-provenance')).to_have_count(4)
    assert not errors, errors
    checks.append('reload preserves metadata with zero page errors')
    browser.close()
(root / 'provenance-evidence.json').write_text(json.dumps({'checks':checks,'errors':errors}, ensure_ascii=False, indent=2))
print(json.dumps(checks, ensure_ascii=False))
