"""Cross-page navigation regression. No model calls or configuration writes.
Use a dedicated examples/chat-acceptance.ts fixture host.
"""
import asyncio,json,sys,time
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright,expect

async def main():
    root=Path(sys.argv[1]);out=Path(sys.argv[2]);out.mkdir(parents=True,exist_ok=True)
    info=json.loads((root/'browser.json').read_text());assert not info['native']
    base=info['base'];checks=[];errors=[];requests=[];legacy=[];timings=[]
    async with async_playwright() as p:
        browser=await p.chromium.launch(headless=True)
        context=await browser.new_context(viewport={'width':1440,'height':960})
        name,value=info['cookie'].split('=',1);await context.add_cookies([{'name':name,'value':value,'url':base}])
        await context.expose_binding('reportLegacy',lambda source,url:legacy.append(url))
        await context.add_init_script("""(() => {
          let seen=false;
          new MutationObserver(() => {
            if(!seen && document.querySelector('.entry-shell')) {seen=true;window.reportLegacy(location.href)}
          }).observe(document,{childList:true,subtree:true});
        })()""")
        page=await context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
        page.on('request',lambda r:requests.append({'path':urlparse(r.url).path,'method':r.method}))
        try:
            # Every real chat navigation link is exercised; no bootstrap probe may block it.
            for label,hash_value in [('Current workspace','#tasks'),('Tasks','#tasks/history'),('Agent team','#execution/configuration'),('Model connections','#models'),('Settings','#advanced/host')]:
                await page.goto(base+'/chat');await expect(page.get_by_role('textbox',name='Message Router',exact=True)).to_be_visible()
                begin=len(requests);started=time.monotonic()
                await page.get_by_role('link',name=label,exact=True).click()
                if label=='Current workspace':await page.get_by_role('dialog',name='Switch workspace').get_by_role('button',name='Close',exact=True).click()
                await expect(page.locator('.operator-workspace')).to_be_visible()
                await expect(page.locator('.operator-body .workspace-page-loading')).to_have_count(0,timeout=15000)
                await expect(page.locator('#main h1').first).to_be_visible()
                assert page.url.endswith(hash_value),page.url
                assert not any(r['path']=='/entry-setup' for r in requests[begin:])
                timings.append({'page':label,'seconds':round(time.monotonic()-started,3)})
            checks.append('all five chat links keep authentication and do not run client probes')
            print('PASS: chat links',flush=True)
            await page.reload();await expect(page.locator('#main h1').first).to_be_visible()
            await page.go_back();await expect(page.get_by_role('textbox',name='Message Router',exact=True)).to_be_visible()
            await page.go_forward();await expect(page.locator('#main h1').first).to_be_visible()
            checks.append('reload and browser back/forward preserve the destination')
            print('PASS: browser history',flush=True)

            # A delayed session response must show the product loading state, not the old token form.
            await page.goto('about:blank')
            release=asyncio.Event();started=asyncio.Event()
            async def slow_session(route):
                started.set();await release.wait();await route.continue_()
            await page.route('**/session',slow_session)
            await page.goto(base+'/configure#tasks',wait_until='domcontentloaded');await asyncio.wait_for(started.wait(),10)
            await expect(page.locator('.workspace-bootstrap')).to_be_visible()
            await expect(page.locator('.entry-shell')).to_have_count(0)
            await page.screenshot(path=str(out/'session-loading-light.png'))
            release.set();await expect(page.get_by_role('heading',name='Your agent team')).to_be_visible()
            await page.unroute('**/session',slow_session);checks.append('slow session never flashes legacy connection UI')
            print('PASS: slow session',flush=True)

            # External-client inventory stays local to its page; navigation remains usable while it waits.
            release_inventory=asyncio.Event();inventory_started=asyncio.Event()
            async def slow_inventory(route):
                inventory_started.set();await release_inventory.wait();await route.continue_()
            await page.route('**/entry-setup',slow_inventory)
            await page.get_by_role('link',name='Conversation entries',exact=True).click();await asyncio.wait_for(inventory_started.wait(),10)
            await expect(page.locator('.workspace-page-loading')).to_be_visible()
            await expect(page.locator('.chat-sidebar')).to_be_visible()
            await page.screenshot(path=str(out/'inventory-loading-light.png'))
            await page.get_by_role('link',name='Agent team',exact=True).click()
            await expect(page.locator('.workspace-page-loading')).to_have_count(0)
            release_inventory.set();await page.wait_for_timeout(3500)
            assert page.url.endswith('#execution/configuration')
            await expect(page.locator('.entry-shell')).to_have_count(0)
            await page.unroute('**/entry-setup',slow_inventory);checks.append('slow client discovery never blocks other navigation')
            print('PASS: lazy inventory',flush=True)

            # Fail once, then explicit retry; no automatic retry loop and no token prompt.
            await page.goto('about:blank')
            failed=0
            async def fail_inventory(route):
                nonlocal failed
                failed+=1
                if failed==1:await route.fulfill(status=503,content_type='application/json',body=json.dumps({'code':'test_unavailable','error':'Temporary inventory failure'}))
                else:await route.continue_()
            await page.route('**/entry-setup',fail_inventory)
            await page.goto(base+'/configure#connections')
            await expect(page.locator('.workspace-load-error')).to_be_visible()
            await page.wait_for_timeout(300);assert failed==1
            await page.get_by_role('button',name='Retry',exact=True).click()
            await expect(page.locator('.workspace-page-loading')).to_have_count(0,timeout=15000)
            await expect(page.locator('.entry-shell')).to_have_count(0)
            await page.unroute('**/entry-setup',fail_inventory);checks.append('inventory failure offers retry inside workspace and recovers')
            print('PASS: inventory retry',flush=True)

            await page.goto('about:blank');session_failures=0
            async def fail_session(route):
                nonlocal session_failures
                session_failures+=1
                if session_failures==1:await route.abort('connectionfailed')
                else:await route.continue_()
            await page.route('**/session',fail_session);await page.goto(base+'/configure#tasks/history')
            await expect(page.locator('.workspace-bootstrap .workspace-load-error')).to_be_visible()
            await page.get_by_role('button',name='Retry',exact=True).click()
            await expect(page.locator('#task-search')).to_be_visible(timeout=15000)
            await page.unroute('**/session',fail_session);checks.append('session network failure is retryable without token instructions')
            print('PASS: session retry',flush=True)

            await page.goto('about:blank');config_failures=0
            async def fail_config(route):
                nonlocal config_failures
                config_failures+=1
                if config_failures==1:await route.fulfill(status=503,content_type='application/json',body=json.dumps({'code':'configuration_restarting'}))
                else:await route.continue_()
            await page.route('**/configuration',fail_config);await page.goto(base+'/configure#models')
            await expect(page.locator('.workspace-page-loading .workspace-load-error')).to_be_visible()
            await page.get_by_role('button',name='Retry',exact=True).click()
            await expect(page.locator('.workspace-page-loading')).to_have_count(0)
            await expect(page.get_by_role('heading',name='Model connections',exact=True)).to_be_visible()
            await page.unroute('**/configuration',fail_config);checks.append('configuration loading failure recovers with the same account')
            print('PASS: configuration retry',flush=True)

            # Both themes, a narrow viewport and reduced motion retain the same loading contract.
            for theme in ['dark','light']:
                await page.evaluate('(theme) => localStorage.setItem("agenthub.configuration.theme",theme)',theme)
                await page.goto('about:blank')
                await page.goto(base+'/configure#tasks/history');await expect(page.locator('#task-search')).to_be_visible()
                await expect(page.locator('html')).to_have_attribute('data-theme',theme)
                await page.screenshot(path=str(out/('tasks-'+theme+'.png')))
            await page.set_viewport_size({'width':390,'height':844});await page.emulate_media(reduced_motion='reduce')
            await page.goto('about:blank');await page.goto(base+'/configure#tasks');await expect(page.get_by_role('heading',name='Your agent team')).to_be_visible()
            assert await page.evaluate('() => document.documentElement.scrollWidth <= innerWidth')
            await page.screenshot(path=str(out/'workspace-mobile.png'))
            checks.append('light/dark themes and narrow viewport remain usable')

            await context.clear_cookies();await page.goto('about:blank');await page.goto(base+'/configure#tasks/history')
            await expect(page.get_by_role('heading',name='Welcome back.',exact=True)).to_be_visible()
            await page.get_by_label('Username',exact=True).fill(info['username']);await page.get_by_label('Password',exact=True).fill(info['password'])
            await page.get_by_role('button',name='Sign in',exact=True).click();await expect(page.locator('#task-search')).to_be_visible(timeout=15000)
            assert page.url.endswith('#tasks/history')
            checks.append('expired login returns to account sign-in and restores the task destination')
            assert not errors,errors;assert not legacy,legacy
            writes=[r for r in requests if r['method']!='GET'];assert all(r['path']=='/account/login' for r in writes),writes
            result={'passed':True,'checks':checks,'timings':timings,'pageErrors':errors,'legacyConnectionScreens':legacy,'submittedModelRequests':False,'configurationWrites':False}
            (out/'navigation-result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print(json.dumps(result))
        except Exception:
            await page.screenshot(path=str(out/'failure.png'));(out/'failure.html').write_text(await page.content());(out/'failure.json').write_text(json.dumps({'errors':errors,'legacy':legacy,'requests':requests},indent=2));raise
        finally:await browser.close()

asyncio.run(main())
