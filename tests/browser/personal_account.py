"""Real local account flow. Run against examples/personal-account-preview.ts, never a user host.
Usage: .local/browser-venv/bin/python tests/browser/personal_account.py <fixture-root> <evidence-dir>
The fixture must have no owner on its first run. All credentials below are synthetic.
"""
import json, sys
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
root=Path(sys.argv[1]); evidence=Path(sys.argv[2]); evidence.mkdir(parents=True,exist_ok=True)
info=json.loads((root/'browser.json').read_text()); base=info['base']; errors=[]
username='roppo.'+'x'*34
password='test-only personal passphrase'; new_password='test-only changed passphrase'; recovered_password='test-only recovered passphrase'
with sync_playwright() as p:
    browser=p.chromium.launch()
    context=browser.new_context(viewport={'width':1440,'height':960},device_scale_factor=1,color_scheme='dark')
    page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(base+'/configure');expect(page.get_by_role('heading',name='Open Roppo to get started.')).to_be_visible()
    assert page.locator('html').get_attribute('data-theme')=='light', 'default must remain white on dark OS'
    page.goto(info['url']);expect(page.get_by_role('heading',name='Create your account.')).to_be_visible()
    assert 'pair=' not in page.url
    page.wait_for_timeout(250);page.screenshot(path=str(evidence/'setup-desktop-light.png'),full_page=True)
    page.set_viewport_size({'width':390,'height':844});page.wait_for_timeout(250);page.screenshot(path=str(evidence/'setup-mobile-light.png'),full_page=True)
    page.set_viewport_size({'width':1440,'height':960})
    page.get_by_label('Your name',exact=True).fill('Alex')
    page.get_by_label('Username',exact=True).fill(username)
    page.get_by_label('Password',exact=True).fill(password)
    page.get_by_label('Confirm password',exact=True).fill('not the same passphrase')
    # Native HTML pattern uses Unicode sets (v mode). Exercise punctuation and reject before any POST.
    setup_posts=[]
    page.on('request',lambda request:setup_posts.append(request.url) if request.method=='POST' and request.url.endswith('/account/setup') else None)
    name=page.get_by_label('Username',exact=True)
    for value in ['roppo.test','roppo_test','roppo-test']:
        name.fill(value);assert name.evaluate('(el)=>el.checkValidity()'),value
    for value in ['a b','a@b','_abc','.abc']:
        name.fill(value);assert not name.evaluate('(el)=>el.checkValidity()'),value
        page.get_by_role('button',name='Create account',exact=True).click()
    assert not setup_posts
    name.fill(username)
    page.get_by_role('button',name='Create account',exact=True).click()
    expect(page.get_by_role('alert')).to_contain_text('passwords do not match')
    page.get_by_label('Confirm password',exact=True).fill(password)
    page.get_by_role('button',name='Switch to dark mode').click()
    assert page.get_by_label('Password',exact=True).input_value()==password
    page.wait_for_timeout(250);page.screenshot(path=str(evidence/'setup-desktop-dark.png'),full_page=True)
    page.get_by_role('button',name='Switch to light mode').click()
    page.get_by_role('button',name='Create account',exact=True).click()
    expect(page.get_by_role('heading',name='Keep a way back in.')).to_be_visible()
    code=page.get_by_label('Recovery code',exact=True).inner_text()
    assert len(code)>40
    expect(page.get_by_role('button',name='Enter workspace')).to_be_disabled()
    with page.expect_download() as download_info:page.get_by_role('button',name='Download',exact=True).click()
    assert download_info.value.suggested_filename=='roppo-recovery-code.txt'
    page.get_by_label('I saved my recovery code').check()
    page.wait_for_timeout(250);page.screenshot(path=str(evidence/'recovery-desktop-light.png'),full_page=True)
    page.get_by_role('button',name='Enter workspace').click()
    expect(page.get_by_role('link',name='Your account',exact=True)).to_be_visible(timeout=20000)
    page.wait_for_timeout(250);page.screenshot(path=str(evidence/'workspace-desktop-light.png'),full_page=True)
    page.get_by_role('link',name='Your account',exact=True).click()
    expect(page.get_by_role('heading',name='Your account',exact=True)).to_be_visible()
    page.get_by_label('Display name',exact=True).fill('Alex Local')
    page.get_by_role('button',name='Save changes',exact=True).click()
    expect(page.get_by_role('status')).to_have_text('Profile saved.')
    page.wait_for_timeout(250);page.screenshot(path=str(evidence/'account-desktop-light.png'),full_page=True)
    for width in [320,390]:
        page.set_viewport_size({'width':width,'height':844})
        for theme in ['light','dark']:
            if page.locator('html').get_attribute('data-theme')!=theme:
                page.get_by_role('button',name='Switch to '+theme+' mode').click()
            page.wait_for_timeout(250)
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
            assert page.locator('.account-avatar').evaluate('(el)=>el.getBoundingClientRect().width')==60
            assert page.locator('.account-identity p').inner_text()==username
            page.screenshot(path=str(evidence/f'account-long-{width}-{theme}.png'),full_page=True)
    page.set_viewport_size({'width':1440,'height':960})
    page.get_by_role('button',name='Switch to light mode').click()
    page.get_by_role('button',name='Sign out',exact=True).click()
    expect(page.get_by_role('heading',name='Welcome back.')).to_be_visible()
    page.wait_for_timeout(250);page.screenshot(path=str(evidence/'login-desktop-light.png'),full_page=True)
    page.get_by_label('Username',exact=True).fill(username)
    page.get_by_label('Password',exact=True).fill('wrong password')
    page.get_by_role('button',name='Sign in',exact=True).click()
    expect(page.get_by_role('alert')).to_contain_text('username or password is incorrect')
    page.wait_for_timeout(250);page.screenshot(path=str(evidence/'login-error-desktop.png'),full_page=True)
    page.get_by_label('Password',exact=True).fill(password)
    page.get_by_role('button',name='Show password',exact=True).click()
    assert page.get_by_label('Password',exact=True).get_attribute('type')=='text'
    page.get_by_role('button',name='Hide password',exact=True).click()
    page.get_by_role('button',name='Sign in',exact=True).click()
    expect(page.get_by_role('link',name='Your account',exact=True)).to_be_visible()
    other=browser.new_context(); second=other.new_page();second.goto(base+'/auth')
    second.get_by_label('Username',exact=True).fill(username);second.get_by_label('Password',exact=True).fill(password);second.get_by_role('button',name='Sign in',exact=True).click()
    expect(second.get_by_role('link',name='Your account',exact=True)).to_be_visible()
    page.goto(base+'/account')
    section=page.locator('.account-section').filter(has=page.get_by_role('heading',name='Password',exact=True))
    section.get_by_label('Current password',exact=True).fill(password)
    section.get_by_label('Password',exact=True).fill(new_password)
    section.get_by_label('Confirm password',exact=True).fill(new_password)
    section.get_by_role('button',name='Update password',exact=True).click()
    expect(page.get_by_role('status')).to_contain_text('Password updated')
    second.reload();expect(second.get_by_role('heading',name='Welcome back.')).to_be_visible()
    page.get_by_role('button',name='Sign out',exact=True).click()
    page.get_by_role('button',name='Forgot password?',exact=True).click()
    page.get_by_label('Username',exact=True).fill(username);page.get_by_label('Recovery code',exact=True).fill(code)
    page.get_by_label('Password',exact=True).fill(recovered_password);page.get_by_label('Confirm password',exact=True).fill(recovered_password)
    page.get_by_role('button',name='Reset password',exact=True).click()
    expect(page.get_by_role('heading',name='Keep a way back in.')).to_be_visible()
    assert page.get_by_label('Recovery code',exact=True).inner_text()!=code
    page.get_by_label('I saved my recovery code').check();page.get_by_role('button',name='Enter workspace').click()
    expect(page.get_by_role('link',name='Your account',exact=True)).to_be_visible()
    page.goto(base+'/account')
    recovery=page.locator('.account-section').filter(has=page.get_by_role('heading',name='Recovery code',exact=True))
    recovery.get_by_label('Current password',exact=True).fill(recovered_password);recovery.get_by_role('button',name='Generate new code',exact=True).click()
    expect(page.get_by_role('heading',name='Keep a way back in.')).to_be_visible()
    page.get_by_label('I saved my recovery code').check();page.get_by_role('button',name='Enter workspace').click()
    expect(page.get_by_role('link',name='Your account',exact=True)).to_be_visible()
    # Browser restart / persistent cookie proof; host restart is covered by HTTP regression.
    storage=context.storage_state(); context.close()
    context=browser.new_context(storage_state=storage,viewport={'width':1440,'height':960});page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(base+'/account');expect(page.get_by_role('heading',name='Your account',exact=True)).to_be_visible()
    page.get_by_role('button',name='Switch to dark mode').click();page.wait_for_timeout(250);page.screenshot(path=str(evidence/'account-desktop-dark.png'),full_page=True)
    page.get_by_role('button',name='中文',exact=True).click()
    page.set_viewport_size({'width':390,'height':844});page.emulate_media(reduced_motion='reduce')
    page.wait_for_timeout(250);page.screenshot(path=str(evidence/'account-mobile-dark-zh.png'),full_page=True)
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    page.once('dialog',lambda d:d.accept());page.get_by_role('button',name='退出所有会话',exact=True).click()
    expect(page.get_by_role('heading',name='欢迎回来。')).to_be_visible()
    page.wait_for_timeout(250);page.screenshot(path=str(evidence/'login-mobile-dark-zh.png'),full_page=True)
    page.get_by_role('button',name='切换白色模式').click()
    page.wait_for_timeout(250);page.screenshot(path=str(evidence/'login-mobile-light-zh.png'),full_page=True)
    page.get_by_role('button',name='忘记密码？',exact=True).click()
    page.wait_for_timeout(250);page.screenshot(path=str(evidence/'recover-mobile-light-zh.png'),full_page=True)
    for width in [320,760,1024,1440]:
        page.set_viewport_size({'width':width,'height':900})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'),width
    page.set_viewport_size({'width':390,'height':844})
    page.get_by_role('button',name='返回登录').click()
    page.get_by_label('用户名',exact=True).focus();page.keyboard.press('Tab')
    assert page.locator(':focus').get_attribute('name')=='password'
    assert page.locator(':focus').evaluate('(el)=>getComputedStyle(el).outlineStyle')!='none'
    assert page.locator('.auth-content').evaluate('(el)=>getComputedStyle(el).animationName')=='none'
    assert page.evaluate("[...document.querySelectorAll('button')].filter(b=>b.getClientRects().length).every(b=>b.getBoundingClientRect().height>=44)")
    page.get_by_label('用户名',exact=True).fill(username);page.get_by_label('密码',exact=True).fill(recovered_password)
    context.set_offline(True);page.get_by_role('button',name='登录',exact=True).click()
    expect(page.get_by_role('alert')).to_contain_text('无法连接 Roppo')
    expect(page.get_by_role('button',name='登录',exact=True)).to_be_enabled()
    assert page.get_by_label('用户名',exact=True).input_value()==username
    context.set_offline(False)
    assert not errors,errors
    (evidence/'result.json').write_text(json.dumps({'passed':True,'consoleErrors':errors,'checks':['bootstrap','native username validity and blocked invalid submit','long username at 320/390 in both themes','setup','mismatch','themes preserve input','recovery download','workspace account link','profile','logout','wrong password','visibility','login','password change revokes other browser','recovery rotates code','regenerate code','browser restart','logout all','mobile','Chinese','overflow 320/760/1024/1440','keyboard focus','reduced motion','44px controls','offline error retains fields and enables retry'],'fixture':'real local host, synthetic credentials, paused; no provider calls'},indent=2))
    browser.close()
print(json.dumps({'passed':True,'evidence':str(evidence)}))
