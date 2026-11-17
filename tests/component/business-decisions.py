"""Mounted React component automation. Controlled API, not product acceptance or screenshots."""
import os,functools,json,pathlib,subprocess,tempfile,threading,http.server
from playwright.sync_api import sync_playwright
ROOT=pathlib.Path(__file__).resolve().parents[2]
with tempfile.TemporaryDirectory(prefix='agenthub-decision-component-') as directory:
    output=pathlib.Path(directory)
    subprocess.run([str(ROOT/'node_modules/.bin/esbuild'),str(ROOT/'tests/component/business-decisions.tsx'),'--bundle','--format=esm','--jsx=automatic',f'--outfile={output}/fixture.js'],cwd=ROOT,check=True)
    (output/'index.html').write_text('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="fixture.css"><div id="root"></div><script type="module" src="fixture.js"></script>')
    handler=functools.partial(http.server.SimpleHTTPRequestHandler,directory=directory)
    server=http.server.ThreadingHTTPServer(('127.0.0.1',0),handler)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    try:
      with sync_playwright() as p:
        browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_EXECUTABLE','/usr/bin/chromium'),headless=True,args=['--no-sandbox'])
        page=browser.new_page(viewport={'width':390,'height':844},reduced_motion='reduce')
        errors=[];page.on('pageerror',lambda error: errors.append(str(error)))
        page.goto(f'http://127.0.0.1:{server.server_port}')
        answer=page.get_by_role('textbox',name='你的答复');answer.fill('方案 A')
        page.get_by_role('button',name='提交答复').evaluate('(el)=>{el.click();el.click()}')
        page.wait_for_function('fixture.calls.length===1')
        assert answer.is_disabled()
        page.evaluate('fixture.reject(0)')
        retry=page.get_by_role('button',name='重试原答复');retry.wait_for()
        assert answer.is_disabled()
        retry.click();page.wait_for_function('fixture.calls.length===2')
        assert page.evaluate('JSON.stringify(fixture.calls[0])===JSON.stringify(fixture.calls[1])')
        # A late successful receipt from an unmounted conversation must not refresh or mark the new one saved.
        page.evaluate("fixture.set({conversation:'two'})")
        answer.wait_for();page.wait_for_function('!document.querySelector("textarea").disabled')
        before=page.evaluate('fixture.refreshes');page.evaluate('fixture.resolve(1)')
        page.wait_for_timeout(50)
        assert page.evaluate('fixture.refreshes')==before
        assert page.get_by_role('button',name='提交答复').count()==1
        answer.fill('方案 B');page.get_by_role('button',name='提交答复').click()
        page.wait_for_function('fixture.calls.length===3')
        page.evaluate("fixture.set({version:'digest-two'})")
        page.wait_for_function('!document.querySelector("textarea").disabled')
        before=page.evaluate('fixture.refreshes');page.evaluate('fixture.reject(2)');page.wait_for_timeout(50)
        assert page.evaluate('fixture.refreshes')==before
        assert page.get_by_role('alert').count()==0
        # All parent gates (busy, readonly, archived, offline) share the disabled contract.
        for reason in ['busy','readonly','archived','offline']:
          page.evaluate('fixture.set({disabled:true})');page.wait_for_function('document.querySelector("textarea").disabled')
          assert page.get_by_role('button',name='提交答复').is_disabled(),reason
          page.evaluate('fixture.set({disabled:false})');page.wait_for_function('!document.querySelector("textarea").disabled')
        answer.fill('键盘答复');answer.press('Tab')
        assert page.get_by_role('button',name='提交答复').evaluate('(el)=>el===document.activeElement')
        page.keyboard.press('Enter');page.wait_for_function('fixture.calls.length===4')
        page.evaluate('fixture.resolve(3)');page.wait_for_function('fixture.refreshes>1')
        assert page.get_by_role('button',name='已保存').is_disabled()
        assert page.locator('body').evaluate('(el)=>el.scrollWidth<=innerWidth')
        assert page.get_by_role('button',name='已保存').evaluate('(el)=>getComputedStyle(el).transitionDuration')=='0s'
        for theme in ['light','dark']:
          page.evaluate('(theme)=>document.documentElement.dataset.theme=theme',theme)
          expected='rgb(245, 245, 245)' if theme=='dark' else 'rgb(23, 23, 23)'
          assert page.locator('.business-decisions').evaluate('(el)=>getComputedStyle(el).color')==expected
          assert page.locator('.business-decisions').evaluate('(el)=>getComputedStyle(el).fontSize')=='15px'
        page.evaluate("fixture.set({conversation:'three',status:'stale'})")
        renew=page.get_by_role('button',name='更新问题');renew.click();page.wait_for_function('fixture.calls.length===5')
        assert page.evaluate('fixture.calls[4].body.action')=='renew'
        assert page.evaluate('!("text" in fixture.calls[4].body)')
        assert page.get_by_role('textbox').count()==0
        assert 'digest-' not in page.locator('body').inner_text()
        assert not errors,errors
        browser.close()
        print(json.dumps({'component':'BusinessDecisions','result':'passed','api':'controlled mock','screenshots':False,'product_acceptance':False,'checks':['duplicate-submit','uncertain-same-ID-retry','conversation-late-success','version-late-failure','disabled-gates','keyboard','narrow','reduced-motion','themes','renew-no-answer']},ensure_ascii=False))
    finally:server.shutdown();server.server_close()
