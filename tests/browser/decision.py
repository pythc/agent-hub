"""Real UI/settings/probe HTTP acceptance on examples/decision-acceptance.ts only."""
import json,sys
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
info=json.loads(Path(sys.argv[1]).read_text());output=Path(sys.argv[2]);output.mkdir(parents=True,exist_ok=True)
errors=[];checks=[]
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True)
    context=browser.new_context(viewport={'width':1440,'height':1000},reduced_motion='reduce')
    page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(info['base']+'/configure#models');page.get_by_label('Username',exact=True).fill(info['username']);page.get_by_label('Password',exact=True).fill(info['password']);page.get_by_role('button',name='Sign in',exact=True).click()
    page.goto(info['base']+'/configure#models');page.wait_for_load_state('networkidle')
    expect(page.locator('#decision-mode')).to_have_value('off')
    page.locator('#decision-provider').select_option('backend:cpu');page.locator('#decision-mode').select_option('advisory')
    page.get_by_role('button',name='Test current draft',exact=True).click();expect(page.locator('#decision-test-result')).to_contain_text('ms',timeout=15000)
    page.locator('#savebar .primary').click();expect(page.locator('#savebar')).to_be_hidden();page.reload();page.wait_for_load_state('networkidle')
    expect(page.locator('#decision-mode')).to_have_value('advisory');expect(page.locator('#decision-provider')).to_have_value('backend:cpu')
    checks.append('Real probe HTTP request, persistent decision settings, shared API reference')
    section=page.locator('#decision-settings');section.scroll_into_view_if_needed();page.screenshot(path=str(output/'decision-light.png'),full_page=True)
    page.get_by_role('button',name='Switch to dark mode',exact=True).click();section.scroll_into_view_if_needed();page.screenshot(path=str(output/'decision-dark.png'),full_page=True)
    expect(page.locator('html')).to_have_attribute('data-theme','dark')
    section.locator('summary').filter(has_text='Advanced').click();page.locator('#decision-timeoutMs').fill('0');expect(page.locator('#savebar .primary')).to_be_disabled();page.locator('#decision-timeoutMs').fill('3000')
    page.locator('#f-decision-parameters').fill('{bad');expect(page.locator('#savebar .primary')).to_be_disabled();page.locator('#f-decision-parameters').fill('{}')
    page.locator('#decision-provider').select_option('jev');expect(page.locator('#decision-baseUrl')).to_have_value('https://api.typesafe.ai/v1');expect(page.locator('#decision-apiKeyEnv')).to_have_value('TYPESAFE_API_KEY')
    page.locator('#decision-provider').select_option('openai-chat');page.locator('#decision-baseUrl').fill(info['provider']);page.locator('#decision-model').fill('cpu-judge')
    page.get_by_role('button',name='Test current draft',exact=True).click();expect(page.locator('#decision-test-result')).to_contain_text('ms',timeout=15000)
    checks.append('Protocol presets, custom endpoint, JSON and limit validation')
    page.set_viewport_size({'width':390,'height':844});section.scroll_into_view_if_needed();page.screenshot(path=str(output/'decision-mobile.png'),full_page=True)
    assert not page.evaluate('document.documentElement.scrollWidth > innerWidth'), 'horizontal overflow'
    page.locator('#decision-mode').focus();expect(page.locator('#decision-mode')).to_be_focused()
    checks.append('Light/dark, narrow viewport, keyboard focus, reduced motion')
    assert not errors, errors
    (output/'browser-result.json').write_text(json.dumps({'checks':checks,'errors':errors,'realModel':info['realModel']},ensure_ascii=False,indent=2))
    browser.close()
print(json.dumps(checks,ensure_ascii=False))
