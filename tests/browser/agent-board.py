"""Real packaged view + authenticated host acceptance. Uses isolated synthetic Runtime records only.
Run examples/agent-board-acceptance.ts first, then pass its output directory.
"""
import asyncio, json, os, sys
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright, expect

async def main():
    root=Path(sys.argv[1]); info=json.loads((root/'browser.json').read_text()); out=root/'screenshots';out.mkdir(exist_ok=True)
    checks=[]; errors=[]; responses=[]
    async with async_playwright() as p:
        options={'headless':True}
        if os.environ.get('PLAYWRIGHT_CHROMIUM_EXECUTABLE'):options['executable_path']=os.environ['PLAYWRIGHT_CHROMIUM_EXECUTABLE']
        browser=await p.chromium.launch(**options)
        context=await browser.new_context(viewport={'width':1440,'height':1000})
        name,value=info['cookie'].split('=',1);await context.add_cookies([{'name':name,'value':value,'url':info['base']}])
        page=await context.new_page();page.on('pageerror',lambda e: errors.append(str(e)));page.on('response',lambda r: responses.append((r.status,r.url)))
        try:
            await page.goto(info['url']);await page.wait_for_load_state('networkidle')
            frame=page.frame_locator('iframe[title="Agent board"]')
            await expect(frame.locator('.connection')).to_have_text('Live')
            await expect(page).to_have_title('Agent board · Roppo')
            await expect(page.get_by_role('link',name='Agent board',exact=True)).to_have_count(1)
            await expect(page.locator('.entry-shell')).to_have_count(0)
            await expect(frame.locator('.workers .agent')).to_have_count(4)
            assert await page.locator('iframe').get_attribute('sandbox')=='allow-scripts'
            isolation=await frame.locator('html').evaluate('''async () => {
              let parentBlocked=false,networkBlocked=false;
              try {void window.parent.document.body} catch {parentBlocked=true}
              try {await fetch('https://example.com/')} catch {networkBlocked=true}
              window.parent.postMessage({type:'navigate',destination:'team'},'*');
              return {parentBlocked,networkBlocked};
            }''')
            assert isolation=={'parentBlocked':True,'networkBlocked':True},isolation
            assert '#plugin/agent-board' in page.url
            await page.screenshot(path=str(out/'overview-light.png'))
            checks.append('authenticated package in shared shell; parent DOM/network blocked; arbitrary window commands ignored')

            await page.get_by_role('button',name='Switch to dark mode',exact=True).click()
            await expect(frame.locator('html')).to_have_class('dark');await page.wait_for_timeout(250)
            await page.screenshot(path=str(out/'overview-dark.png'))
            # Polling must preserve the focused node, not remount buttons every five seconds.
            agent=frame.get_by_role('button',name='Inspect Research',exact=True)
            await agent.focus();await page.wait_for_timeout(5400);await expect(agent).to_be_focused()
            await agent.press('Enter');await expect(frame.get_by_role('dialog')).to_be_visible()
            await frame.get_by_role('button',name='Close details').press('Escape');await expect(agent).to_be_focused()
            checks.append('dark theme, polling focus persistence, agent drawer, Escape and focus return')

            await frame.get_by_role('tab',name='Overview',exact=True).focus();await page.keyboard.press('ArrowRight')
            await expect(frame.get_by_role('tab',name='Tasks',exact=True)).to_have_attribute('aria-selected','true')
            await expect(frame.locator('.task-row')).to_have_count(25)
            await frame.get_by_role('button',name='Next',exact=True).click();await expect(frame.locator('.task-row')).to_have_count(7)
            await frame.get_by_role('combobox',name='Filter by source').select_option('personal')
            await expect(frame.locator('.task-row')).to_have_count(11)
            assert all('Personal workspace' in text for text in await frame.locator('.task-subtitle').all_text_contents())
            await frame.get_by_role('combobox',name='Filter by source').select_option('')
            await expect(frame.locator('.task-row')).to_have_count(25)
            delayed=asyncio.Event();release=asyncio.Event()
            async def old_query(route):
                if 'source=personal' in route.request.url:
                    delayed.set();await release.wait()
                try:await route.continue_()
                except Exception:pass # Host deliberately aborted the obsolete request.
            await page.route('**/api/workspace-views/*/runtime?*',old_query)
            await frame.get_by_role('combobox',name='Filter by source').select_option('personal')
            await asyncio.wait_for(delayed.wait(),5)
            await expect(frame.locator('.task-row')).to_have_count(0)
            await frame.get_by_role('combobox',name='Filter by source').select_option('product')
            release.set()
            await expect(frame.locator('.task-row')).to_have_count(21)
            assert all('#product' in text for text in await frame.locator('.task-subtitle').all_text_contents())
            await page.unroute('**/api/workspace-views/*/runtime?*',old_query)
            await frame.get_by_role('combobox',name='Filter by source').select_option('')
            await expect(frame.locator('.task-row')).to_have_count(25)
            await frame.get_by_role('textbox',name='Search tasks').fill('NO_MATCH_ACCEPTANCE')
            await expect(frame.get_by_text('No tasks in this view.',exact=True)).to_be_visible()
            await expect(frame.get_by_role('textbox',name='Search tasks')).to_be_focused()
            await frame.get_by_role('textbox',name='Search tasks').fill('')
            await expect(frame.locator('.task-row')).to_have_count(25)
            await page.screenshot(path=str(out/'tasks-dark.png'))
            checks.append('keyboard tabs, real pagination, source filters, delayed old-query fencing and empty search')

            await frame.get_by_role('tab',name='Listening & usage').click()
            await expect(frame.locator('.usage')).to_contain_text('360')
            await expect(frame.locator('.usage')).to_contain_text('1 / 2')
            await expect(frame.locator('.usage')).not_to_contain_text('99999')
            await page.screenshot(path=str(out/'listening-dark.png'))
            checks.append('routing usage is partial, source-global and excludes probe tokens')

            # Capture expected transport failure separately from unexpected HTTP errors.
            async def unavailable(route):await route.fulfill(status=503,content_type='application/json',body='{"code":"fixture_offline"}')
            await page.route('**/api/workspace-views/*/runtime?*',unavailable)
            await frame.get_by_role('button',name='Refresh board').click()
            await expect(frame.locator('.connection')).to_contain_text('stale')
            await frame.get_by_role('tab',name='Overview',exact=True).click()
            await expect(frame.locator('.flow')).to_have_count(0)
            await page.screenshot(path=str(out/'stale-dark.png'))
            await page.unroute('**/api/workspace-views/*/runtime?*',unavailable)
            await page.wait_for_timeout(350);await frame.get_by_role('button',name='Retry',exact=True).click()
            await expect(frame.locator('.connection')).to_have_text('Live')
            checks.append('stale data retains evidence, stops flow animation and recovers')

            await page.emulate_media(reduced_motion='reduce')
            animation=await frame.locator('.flow').first.evaluate('(el)=>getComputedStyle(el).animationName')
            assert animation=='none',animation
            await page.set_viewport_size({'width':390,'height':844})
            await expect(frame.get_by_role('heading',name='Agent board',exact=True)).to_be_visible()
            for target in [page.locator('html'),frame.locator('html')]:
                assert await target.evaluate('(el)=>el.scrollWidth<=el.clientWidth+1')
            await page.screenshot(path=str(out/'overview-mobile-dark.png'))
            await page.set_viewport_size({'width':1440,'height':1000})
            await page.get_by_role('button',name='Switch to Chinese',exact=True).click()
            frame=page.frame_locator('iframe[title="Agent 看板"]')
            await expect(frame.get_by_role('heading',name='Agent 看板',exact=True)).to_be_visible()
            await page.screenshot(path=str(out/'overview-zh-dark.png'))
            checks.append('reduced motion, 390px no horizontal overflow, live language propagation')

            await page.get_by_role('button',name='切换为英文',exact=True).click()
            frame=page.frame_locator('iframe[title="Agent board"]')
            # Host-directed navigation returns to the existing configuration, not a second app shell.
            await frame.get_by_role('button',name='Configure',exact=True).click()
            await expect(page.locator('.operator-workspace')).to_be_visible()
            await expect(page.locator('iframe')).to_have_count(0)
            await page.get_by_role('link',name='Agent board',exact=True).click()
            frame=page.frame_locator('iframe[title="Agent board"]');await expect(frame.locator('.connection')).to_have_text('Live')
            # Revoked capability/disabled package cannot keep an old frame mounted.
            async def revoked(route):await route.fulfill(status=404,content_type='application/json',body='{"code":"view_unavailable"}')
            await page.route('**/api/workspace-views/*/runtime?*',revoked)
            await frame.get_by_role('button',name='Refresh board').click()
            await expect(page.locator('.workspace-view-placeholder[role=alert]')).to_be_visible()
            await expect(page.locator('iframe')).to_have_count(0)
            await page.unroute('**/api/workspace-views/*/runtime?*',revoked)
            checks.append('host navigation, teardown/remount and immediate frame removal on revoked read')
            assert not errors,errors
            # The existing configuration UI deliberately probes these optional APIs and falls back on 404/405.
            optional={'/workspaces','/connection-capabilities'}
            compatibility=[r for r in responses if r[0] in (404,405) and urlparse(r[1]).path in optional]
            unexpected=[r for r in responses if r[0]>=400 and urlparse(r[1]).path!='/favicon.ico' and '/api/workspace-views/' not in r[1] and r not in compatibility]
            assert not unexpected,unexpected
            (root/'browser-results.json').write_text(json.dumps({'checks':checks,'pageErrors':errors,'compatibilityProbes':compatibility,'fixture':True},indent=2,ensure_ascii=False))
            print(json.dumps({'passed':checks,'pageErrors':errors},ensure_ascii=False))
        except Exception:
            await page.screenshot(path=str(out/'failure.png'))
            (root/'browser-failure.json').write_text(json.dumps({'url':page.url,'pageErrors':errors,'httpErrors':[r for r in responses if r[0]>=400]},indent=2))
            raise
        finally:await browser.close()

asyncio.run(main())
