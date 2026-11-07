"""Motion behavior on a synthetic host; real-call states below are browser-only fixtures."""
import json
import subprocess
import tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

output=Path('.local/motion-browser-evidence');output.mkdir(parents=True,exist_ok=True)
checks=[];errors=[];writes=[]
with tempfile.TemporaryDirectory(prefix='agenthub-motion-') as root:
    server=subprocess.Popen(['node','--import','tsx','examples/frontend-preview.ts',root,'0'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    try:
        base=json.loads(server.stdout.readline())['url']
        with sync_playwright() as p:
            browser=p.chromium.launch(headless=True)
            context=browser.new_context(viewport={'width':1440,'height':1000})
            context.add_init_script("localStorage.setItem('agenthub.configuration.language','zh-CN');localStorage.setItem('agenthub.entry.role','operator');window.motionRejections=[];addEventListener('unhandledrejection',e=>motionRejections.push(String(e.reason)));")
            page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
            page.on('request',lambda r:writes.append(r.url) if r.method=='POST' else None)
            def go(route='execution/configuration'):
                page.goto(base+'#'+route);page.wait_for_load_state('networkidle')
                expect(page.locator('.operator-workspace')).to_be_visible()
            def shot(name):
                page.wait_for_timeout(360);page.evaluate('window.scrollTo(0,0)')
                assert not page.evaluate('document.documentElement.scrollWidth>innerWidth'),name
                page.screenshot(path=str(output/(name+'.png')))
            go()
            page.locator('#team-prompt').fill('Keep this draft through motion')
            count=page.evaluate("""() => {document.querySelector('#team-node-worker-1').click();return document.getAnimations().filter(a=>a.effect.target.id==='team-inspector').length}""")
            assert count==1,count
            page.evaluate("""async()=>{for(let i=0;i<12;i++){document.querySelector('#team-node-'+(i%2?'router':'worker-1')).click();await new Promise(r=>setTimeout(r,16))}}""")
            expect(page.locator('#team-prompt')).to_have_value('Keep this draft through motion')
            page.wait_for_timeout(350)
            assert not page.locator('#team-inspector').evaluate('(n)=>n.getAnimations().length')
            checks.append('Member transitions are interruptible, settle without leftovers and preserve unsaved drafts')
            page.locator('#team-node-worker-1').click()
            page.get_by_role('tab',name='高级参数',exact=True).click()
            page.get_by_role('tab',name='基本配置',exact=True).click()
            page.locator('#team-backend').select_option('research')
            page.get_by_role('tab',name='高级参数',exact=True).click()
            page.locator('#f-execution-workers-0-parameters').fill('{broken')
            page.get_by_role('tab',name='工具与管理',exact=True).click()
            page.get_by_role('tab',name='高级参数',exact=True).click()
            expect(page.locator('#f-execution-workers-0-parameters')).to_have_value('{broken')
            expect(page.locator('#savebar .primary')).to_be_disabled()
            checks.append('Animated tabs preserve invalid advanced JSON and validation state')
            page.locator('#savebar').get_by_role('button',name='放弃更改',exact=True).click()
            page.get_by_role('dialog').get_by_role('button',name='放弃更改',exact=True).click()
            expect(page.get_by_role('dialog')).to_have_count(0)
            page.get_by_role('tab',name='基本配置',exact=True).click()
            count=page.evaluate("""()=>{[...document.querySelectorAll('button')].find(b=>b.textContent==='添加 Worker').click();return document.querySelector('#team-node-worker-5').getAnimations().length}""")
            assert count==1,count
            page.locator('#team-node-worker-2').click()
            page.get_by_role('button',name='移除',exact=True).click()
            page.get_by_role('dialog').get_by_role('button',name='移除 Worker',exact=True).click()
            expect(page.locator('#team-node-worker-2')).to_have_count(0)
            expect(page.locator('#team-node-router')).to_be_focused()
            checks.append('Add/remove animates member layout while preserving Worker identity and returning focus')
            page.locator('#savebar').get_by_role('button',name='放弃更改',exact=True).click()
            page.get_by_role('dialog').get_by_role('button',name='放弃更改',exact=True).click()
            expect(page.get_by_role('dialog')).to_have_count(0)
            for _ in range(3):
                page.locator('#workspace-switch').click();page.keyboard.press('Escape')
                expect(page.get_by_role('dialog')).to_have_count(0)
                expect(page.locator('#workspace-switch')).to_be_focused()
            page.locator('#workspace-switch').click()
            page.keyboard.press('Escape');page.emulate_media(reduced_motion='reduce')
            expect(page.get_by_role('dialog')).to_have_count(0)
            page.emulate_media(reduced_motion='no-preference')
            checks.append('Dialogs enter/exit, handle repeated Escape and reduced-motion changes, and restore focus')
            page.locator('#team-story-toggle').click()
            expect(page.locator('.story-disclaimer')).to_contain_text('不执行任务')
            page.locator('#workflow-story-step-1').click()
            expect(page.locator('#workflow-story-step-1')).to_have_attribute('aria-pressed','true')
            active=page.locator('.story-signal').evaluate_all('(nodes)=>nodes.flatMap(n=>n.getAnimations()).length')
            assert active==3,active
            assert page.evaluate("""()=>{const scene=document.querySelector('.story-scene').getBoundingClientRect(),router=document.querySelector('[data-story-node=router]').getBoundingClientRect();return [...document.querySelectorAll('.story-signal')].slice(1).every(p=>Math.abs(Number(p.getAttribute('d').split(' ')[1])-(router.right-scene.left))<1)}"""), 'Desktop branches should all leave the right side of Router'
            offsets=[]
            for _ in range(3):
                offsets.append(page.locator('.story-signal').nth(1).evaluate('(n)=>getComputedStyle(n).strokeDashoffset'))
                page.wait_for_timeout(90)
            assert len(set(offsets))==3,offsets
            shot('workflow-light')
            path=page.locator('.story-signal').nth(1).get_attribute('d')
            page.locator('#workflow-story-step-2').click()
            assert page.locator('.story-signal').nth(1).get_attribute('d')!=path
            page.locator('#workflow-story-replay').click()
            checks.append('Illustration shows distinct outbound/return paths; signals move and replay without any host mutation')
            page.locator('#workflow-story-play').click()
            expect(page.locator('.workflow-story')).to_have_attribute('data-playing','true')
            page.wait_for_timeout(1750)
            expect(page.locator('#workflow-story-step-1')).to_have_attribute('aria-pressed','true')
            page.locator('#workflow-story-play').click()
            position=page.locator('.story-position').inner_text();page.wait_for_timeout(1700)
            assert page.locator('.story-position').inner_text()==position
            assert page.locator('.story-signal').evaluate_all('(nodes)=>nodes.flatMap(n=>n.getAnimations()).length')==0
            page.locator('#workflow-story-play').click()
            page.evaluate("Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'))")
            expect(page.locator('.workflow-story')).to_have_attribute('data-playing','false')
            page.wait_for_timeout(1700)
            expect(page.locator('.story-position')).to_have_text('1 / 4')
            page.evaluate("delete document.hidden;document.dispatchEvent(new Event('visibilitychange'))")
            checks.append('Visibility-change handling stops the explanation and its timers (synthetic visibility event)')
            page.locator('#workflow-story-play').click()
            page.wait_for_timeout(6600)
            expect(page.locator('.workflow-story')).to_have_attribute('data-playing','false')
            expect(page.locator('.story-position')).to_have_text('4 / 4')
            checks.append('User-started explanation plays one four-step pass and can pause; it never loops autonomously')
            page.locator('[data-theme-toggle]').click();shot('workflow-dark')
            page.set_viewport_size({'width':390,'height':844});shot('workflow-mobile')
            page.locator('#workflow-story-play').click()
            page.emulate_media(reduced_motion='reduce')
            expect(page.locator('#workflow-story-play')).to_be_disabled()
            page.locator('#workflow-story-step-2').click()
            expect(page.locator('#workflow-story-step-2')).to_have_attribute('aria-pressed','true')
            assert page.locator('.story-signal').evaluate_all('(nodes)=>nodes.flatMap(n=>n.getAnimations()).length')==0
            page.get_by_role('button',name='收起说明',exact=True).click()
            expect(page.locator('#team-story-toggle')).to_be_focused()
            page.emulate_media(reduced_motion='no-preference')
            page.set_viewport_size({'width':1440,'height':1000})
            checks.append('Light/dark, 390px and reduced-motion states stay usable; closing explanation restores its trigger')
            page.locator('#team-story-toggle').click();page.locator('#workflow-story-play').click()
            page.locator('.operator-nav-link').filter(has_text='模型连接').click()
            page.wait_for_timeout(1800)
            assert page.locator('.story-signal').count()==0
            go('advanced/json')
            shot('advanced-json')
            checks.append('Route changes cancel explanation timers and clean up animation ownership')
            # Browser-only synthetic events verify visual truth without executing a real model.
            state={'phase':'idle'}
            def activity(route):
                response=route.fetch();data=response.json();phase=state['phase']
                if phase=='offline':route.abort();return
                if phase!='idle':
                    records=[{'id':'fixture-router','kind':'router','name':'Router','state':phase,'startedAt':1},
                             {'id':'fixture-worker','kind':'worker','name':'Worker','workerId':'worker-1','state':phase,'startedAt':2}]
                    if phase!='running':
                        for record in records:record['endedAt']=3
                    data['architecture']['activity']=records
                route.fulfill(response=response,json=data)
            page.route('**/entry-workspace',activity)
            go('execution')
            assert page.locator('.tam-flow[data-state=running]').count()==0
            state['phase']='running'
            expect(page.locator('.tam-flow[data-state=running]').first).to_be_visible(timeout=5000)
            assert page.locator('.tam-flow[data-state=running]').first.evaluate('(n)=>getComputedStyle(n).animationName')=='tam-flow'
            shot('calls-running-fixture')
            state['phase']='completed'
            expect(page.locator('.tam-flow[data-state=running]')).to_have_count(0,timeout=5000)
            state['phase']='running'
            expect(page.locator('.tam-flow[data-state=running]').first).to_be_visible(timeout=5000)
            state['phase']='offline'
            expect(page.locator('.execution-call-map')).to_have_attribute('data-stale','true',timeout=5000)
            expect(page.locator('.tam-flow[data-state=running]')).to_have_count(0)
            state['phase']='idle'
            expect(page.locator('.execution-call-map')).to_have_attribute('data-stale','false',timeout=5000)
            checks.append('Recorded Calls animate only while running; completed and disconnected states stop their signals')
            assert not writes,writes
            assert page.evaluate('motionRejections')==[],page.evaluate('motionRejections')
            assert not errors,errors
            browser.close()
        (output/'report.json').write_text(json.dumps({'scope':'Synthetic browser acceptance; no model execution','checks':checks,'errors':errors,'writes':writes},ensure_ascii=False,indent=2)+'\n')
        print(json.dumps({'passed':len(checks),'errors':errors}))
    finally:
        server.terminate();server.wait(timeout=10)
