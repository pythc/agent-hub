"""Focused auth viewport/motion checks against a disposable real local host."""
import json,sys
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
info=json.loads((Path(sys.argv[1])/'browser.json').read_text());out=Path(sys.argv[2]);out.mkdir(parents=True,exist_ok=True)
base=info['base'];errors=[];checks=[]
def fits(page,inner=True):
    state=page.evaluate('''() => ({w:innerWidth,h:innerHeight,docW:document.documentElement.scrollWidth,docH:document.documentElement.scrollHeight,y:scrollY,stage:(()=>{const e=document.querySelector('.auth-stage');return e?{client:e.clientHeight,scroll:e.scrollHeight}:null})()})''')
    assert state['docW']<=state['w'] and state['docH']<=state['h']+1,state
    assert state['y']==0,state
    if inner and state['stage']:assert state['stage']['scroll']<=state['stage']['client']+1,state
with sync_playwright() as p:
    browser=p.chromium.launch()
    context=browser.new_context(viewport={'width':390,'height':568},reduced_motion='reduce')
    page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(info['url']);expect(page.get_by_role('heading',name='Create your account.')).to_be_visible()
    fits(page);expect(page.get_by_label('Password',exact=True)).to_be_hidden()
    expect(page.get_by_role('button',name='Continue',exact=True)).to_be_visible()
    page.get_by_label('Your name',exact=True).fill('Motion Check');page.get_by_label('Username',exact=True).fill('motion.test')
    page.get_by_role('button',name='Continue',exact=True).click();fits(page)
    expect(page.get_by_label('Password',exact=True)).to_be_visible()
    page.get_by_label('Password',exact=True).fill('motion test passphrase');page.get_by_label('Confirm password',exact=True).fill('motion test passphrase')
    page.get_by_role('button',name='Back',exact=True).click();expect(page.get_by_label('Username',exact=True)).to_have_value('motion.test')
    page.get_by_role('button',name='Continue',exact=True).click();expect(page.get_by_label('Password',exact=True)).to_have_value('motion test passphrase')
    page.set_viewport_size({'width':1024,'height':960});expect(page.get_by_label('Username',exact=True)).to_be_visible();fits(page)
    page.set_viewport_size({'width':320,'height':568});fits(page)
    page.screenshot(path=str(out/'setup-step-mobile.png'))
    page.get_by_role('button',name='Create account',exact=True).click()
    expect(page.get_by_role('heading',name='Keep a way back in.')).to_be_visible();fits(page)
    code=page.get_by_label('Recovery code',exact=True).inner_text()
    page.get_by_label('I saved my recovery code').check();page.get_by_role('button',name='Enter workspace').click()
    expect(page.get_by_role('heading',name='Current workspace',exact=True)).to_be_visible(timeout=15000)
    page.goto(base+'/account');expect(page.get_by_role('heading',name='Your account',exact=True)).to_be_visible()
    assert not page.locator('html').evaluate("e=>e.classList.contains('auth-viewport')")
    assert page.evaluate('document.documentElement.scrollHeight>innerHeight')
    page.get_by_role('button',name='Sign out',exact=True).click();expect(page.get_by_role('heading',name='Welcome back.')).to_be_visible()
    for width,height in [(1440,960),(1024,768),(641,890),(390,844),(320,568),(760,600)]:
        page.set_viewport_size({'width':width,'height':height});fits(page)
        page.mouse.wheel(0,1500);fits(page)
        page.get_by_role('button',name='Forgot password?',exact=True).click();fits(page)
        if page.get_by_role('button',name='Continue',exact=True).is_visible():
            page.get_by_label('Username',exact=True).fill('motion.test');page.get_by_label('Recovery code',exact=True).fill(code)
            page.get_by_role('button',name='Continue',exact=True).click();fits(page)
            page.get_by_role('button',name='Back',exact=True).click()
        page.get_by_role('button',name='Back to sign in',exact=True).click()
    checks.extend(['root and form fit at 6 viewport sizes','wheel does not scroll page','short setup and recover step navigation preserves inputs','resizing preserves entered fields','account settings remain scrollable'])
    page.set_viewport_size({'width':641,'height':890});page.get_by_role('button',name='Forgot password?',exact=True).click();page.screenshot(path=str(out/'recover-user-641.png'));fits(page)
    page.get_by_role('button',name='Back to sign in',exact=True).click()
    page.set_viewport_size({'width':390,'height':568});page.get_by_role('button',name='中文',exact=True).click();fits(page)
    page.get_by_role('button',name='切换黑暗模式').click();fits(page);page.screenshot(path=str(out/'login-mobile-dark.png'))
    # Empty/invalid submit has no movement, and reduced-motion stops both CSS and WAAPI.
    assert page.evaluate('document.getAnimations().filter(a=>a.playState==="running").length')==0
    page.emulate_media(reduced_motion='no-preference');page.set_viewport_size({'width':1440,'height':960});page.reload()
    expect(page.get_by_role('heading',name='欢迎回来。')).to_be_visible()
    assert page.locator('.auth-shell').get_attribute('data-intro')=='true'
    assert page.locator('.diagram-flow').first.evaluate('(e)=>getComputedStyle(e).animationName')=='beam-outbound'
    page.wait_for_timeout(1500);fits(page)
    assert page.evaluate('document.getAnimations().filter(a=>a.playState==="running" && a.effect.getTiming().iterations!==Infinity).length')==0,'finite entrance must settle'
    page.screenshot(path=str(out/'login-desktop-dark.png'))
    page.get_by_role('button',name='切换白色模式').click()
    assert page.locator('.auth-label').first.evaluate('(e)=>getComputedStyle(e).color===getComputedStyle(document.body).color'),'theme switch must retain readable labels'
    page.screenshot(path=str(out/'login-desktop-light.png'))
    for i in range(4):
        page.get_by_role('button',name='忘记密码？',exact=True).click()
        page.get_by_role('button',name='返回登录',exact=True).click()
    page.emulate_media(reduced_motion='reduce');assert page.evaluate('document.getAnimations().filter(a=>a.playState==="running").length')==0
    page.get_by_label('用户名',exact=True).fill('motion.test');page.get_by_label('密码',exact=True).fill('wrong password')
    page.get_by_role('button',name='登录',exact=True).click();expect(page.get_by_role('alert')).to_contain_text('用户名或密码不正确');fits(page)
    page.set_viewport_size({'width':320,'height':568});fits(page);page.screenshot(path=str(out/'login-error-mobile.png'))
    checks.extend(['one-time intro settles; architecture flow repeats','rapid form changes','reduced motion cancels active animation','error state fits','light/dark and Chinese'])
    assert not errors,errors
    (out/'result.json').write_text(json.dumps({'passed':True,'checks':checks,'pageErrors':errors,'hardware':'Desktop Chromium; mobile-sized viewports only, physical mobile keyboard not tested'},indent=2))
    browser.close()
print(json.dumps({'passed':True,'evidence':str(out)}))
