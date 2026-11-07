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
    expect(page.locator('#decision-mode-off')).to_be_checked()
    page.locator('#decision-provider').select_option('backend:cpu');page.locator('#decision-mode-advisory').check()
    page.get_by_role('button',name='Run test',exact=True).click();expect(page.locator('#decision-test-result')).to_contain_text('ms',timeout=15000)
    expect(page.locator('.decision-metrics')).to_contain_text('42' if not info['realModel'] else 'Input tokens')
    page.locator('#savebar .primary').click();expect(page.locator('#savebar')).to_be_hidden(timeout=20000);page.reload();page.wait_for_load_state('networkidle')
    expect(page.locator('#decision-mode-advisory')).to_be_checked();expect(page.locator('#decision-provider')).to_have_value('backend:cpu')
    checks.append('Real probe HTTP request, persistent decision settings, shared API reference')
    section=page.locator('#decision-settings');section.scroll_into_view_if_needed();page.screenshot(path=str(output/'decision-light.png'),full_page=True)
    page.get_by_role('button',name='Switch to dark mode',exact=True).click();section.scroll_into_view_if_needed();page.screenshot(path=str(output/'decision-dark.png'),full_page=True)
    expect(page.locator('html')).to_have_attribute('data-theme','dark')
    section.locator('summary').filter(has_text='Advanced').click();page.locator('#f-decision-timeoutMs').fill('0');expect(page.locator('#savebar .primary')).to_be_disabled();expect(page.locator('#decision-test')).to_be_disabled();page.locator('#f-decision-timeoutMs').fill('3000')
    page.locator('#f-decision-parameters').fill('{bad');expect(page.locator('#savebar .primary')).to_be_disabled();page.locator('#f-decision-parameters').fill('{}');expect(page.locator('#decision-test')).to_be_enabled()
    page.locator('#decision-provider').select_option('jev');expect(page.locator('#decision-baseUrl')).to_have_value('https://api.typesafe.ai/v1');expect(page.locator('#decision-apiKeyEnv')).to_have_value('TYPESAFE_API_KEY')
    page.locator('#decision-provider').select_option('openai-chat');page.locator('#decision-baseUrl').fill(info['provider']);page.locator('#decision-model').fill('cpu-judge')
    page.get_by_role('button',name='Run test',exact=True).click();expect(page.locator('#decision-test-result')).to_contain_text('ms',timeout=15000)
    checks.append('Protocol presets, custom endpoint, JSON and limit validation')
    # Hold one synthetic HTTP reply to exercise re-rendering during a pending probe.
    held=[]
    page.route('**/decision/probe',lambda route:held.append(route))
    page.locator('#decision-test').click()
    page.get_by_role('button',name='Switch to Chinese',exact=True).click()
    expect(page.locator('#decision-test')).to_be_disabled()
    assert held
    held.pop().fulfill(status=200,content_type='application/json',body=json.dumps({'status':'ok','decisions':[{'id':'sample','action':'REVIEW'}],'latencyMs':1}))
    expect(page.locator('#decision-test-result')).to_contain_text('REVIEW')
    expect(page.locator('#decision-test')).to_be_enabled()
    page.unroute('**/decision/probe')
    page.get_by_role('button',name='切换为英文',exact=True).click()
    expect(page.locator('#decision-test-result')).to_contain_text('REVIEW')
    advanced=section.locator('details').first
    if advanced.get_attribute('open') is None: advanced.locator('summary').click()
    page.locator('#decision-effort').select_option('low')
    page.locator('#decision-provider').select_option('anthropic')
    page.locator('#decision-provider').select_option('openai-chat')
    advanced=section.locator('details').first
    if advanced.get_attribute('open') is None: advanced.locator('summary').click()
    expect(page.locator('#decision-effort')).to_have_value('')
    checks.append('Pending probe survives language re-render; Anthropic switch clears incompatible effort')
    # A response for an edited sample must not be presented as the new sample's result.
    held=[]
    page.route('**/decision/probe',lambda route:held.append(route))
    page.locator('#decision-test').click()
    page.locator('#decision-sample').fill('A different message while the request is pending.')
    assert held
    held.pop().fulfill(status=200,content_type='application/json',body=json.dumps({'status':'ok','decisions':[{'id':'sample','action':'STOP'}],'latencyMs':5}))
    expect(page.locator('#decision-test')).to_be_enabled()
    expect(page.locator('#decision-test-result')).not_to_contain_text('STOP')
    page.unroute('**/decision/probe')
    page.locator('#decision-sample').fill('   ');expect(page.locator('#decision-test')).to_be_disabled()
    page.get_by_role('button',name='Quotation',exact=True).click()
    assert 'quoting' in page.locator('#decision-sample').input_value()
    # Unavailable results remain actionable and the next real HTTP probe can recover.
    page.route('**/decision/probe',lambda route:route.fulfill(status=200,content_type='application/json',body=json.dumps({'status':'unavailable','code':'timeout'})))
    page.locator('#decision-test').click();expect(page.locator('#decision-test-result')).to_contain_text('timeout')
    page.unroute('**/decision/probe')
    page.locator('#decision-baseUrl').fill(info['provider']);page.locator('#decision-model').fill('cpu-judge')
    page.locator('#decision-test').click();expect(page.locator('#decision-test-result')).to_contain_text('ms',timeout=15000)
    # Native radio controls support arrow navigation without losing focus on re-render.
    page.locator('#decision-mode-advisory').focus();page.keyboard.press('ArrowLeft')
    expect(page.locator('#decision-mode-shadow')).to_be_checked();expect(page.locator('#decision-mode-shadow')).to_be_focused()
    page.keyboard.press('ArrowRight');expect(page.locator('#decision-mode-advisory')).to_be_checked()
    page.locator('#f-decision-timeoutMs').fill('0')
    page.get_by_role('button',name='Switch to Chinese',exact=True).click()
    expect(page.locator('#f-decision-timeoutMs')).to_have_value('0');expect(page.locator('#decision-test')).to_be_disabled()
    page.locator('#f-decision-timeoutMs').fill('3000')
    page.locator('#decision-test').click();expect(page.locator('#decision-test-result')).to_contain_text('ms',timeout=15000)
    advanced=section.locator('details').first
    if advanced.get_attribute('open') is not None: advanced.locator('summary').click()
    expect(advanced).not_to_have_attribute('open')
    page.locator('#decision-provider').select_option('backend:cpu')
    expect(section.locator('details').first).not_to_have_attribute('open')
    page.locator('#decision-test').click();expect(page.locator('#decision-test-result')).to_contain_text('ms',timeout=15000)
    for width in [900,1440]:
        page.set_viewport_size({'width':width,'height':1050})
        assert not page.evaluate('document.documentElement.scrollWidth > innerWidth')
    page.locator('.models-page').evaluate('(el)=>{for(let p=el.parentElement;p;p=p.parentElement){if(p.scrollHeight>p.clientHeight)p.scrollTop=0}}')
    page.screenshot(path=str(output/'models-dark-zh.png'),full_page=True)
    # Theme tokens must provide readable body and secondary text on both panes.
    contrasts=page.locator('.decision-heading p').evaluate(r"""el=>{const rgb=s=>s.match(/[\d.]+/g).slice(0,3).map(Number);const lum=c=>{let a=c.map(n=>{n/=255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4});return .2126*a[0]+.7152*a[1]+.0722*a[2]};let f=lum(rgb(getComputedStyle(el).color));let result=[];for(let name of ['--surface','--surface-soft']){let b=lum(rgb(getComputedStyle(document.documentElement).getPropertyValue(name).trim().startsWith('#')?(()=>{let h=getComputedStyle(document.documentElement).getPropertyValue(name).trim().slice(1);return 'rgb('+[0,2,4].map(i=>parseInt(h.slice(i,i+2),16)).join(',')+')'})():getComputedStyle(document.documentElement).getPropertyValue(name)));result.push((Math.max(f,b)+.05)/(Math.min(f,b)+.05))}return result}""")
    assert min(contrasts)>=4.5, contrasts
    page.get_by_role('button',name='切换为英文',exact=True).click()
    page.get_by_role('button',name='Switch to light mode',exact=True).click()
    page.screenshot(path=str(output/'models-light.png'),full_page=True)
    checks.append('Edited pending sample rejects stale result; blank input; failure recovery; radio keyboard; invalid draft survives language change; readable dark contrast')

    page.set_viewport_size({'width':390,'height':844});section.scroll_into_view_if_needed();page.screenshot(path=str(output/'decision-mobile.png'),full_page=True)
    assert not page.evaluate('document.documentElement.scrollWidth > innerWidth'), 'horizontal overflow'
    page.locator('#decision-mode-advisory').focus();expect(page.locator('#decision-mode-advisory')).to_be_focused()
    checks.append('Light/dark, narrow viewport, keyboard focus, reduced motion')
    assert not errors, errors
    (output/'browser-result.json').write_text(json.dumps({'checks':checks,'errors':errors,'realModel':info['realModel']},ensure_ascii=False,indent=2))
    browser.close()
print(json.dumps(checks,ensure_ascii=False))
