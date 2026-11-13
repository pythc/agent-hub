"""Browser acceptance for the isolated model-fixture host, never a user deployment.
Run after examples/chat-acceptance.ts fixture. All requests use that host's synthetic account.
"""
import json,sys
from pathlib import Path
from urllib.parse import urlparse,parse_qs
from playwright.sync_api import sync_playwright,expect
root=Path(sys.argv[1]); evidence=Path(sys.argv[2]); evidence.mkdir(parents=True,exist_ok=True)
info=json.loads((root/'browser.json').read_text()); assert not info['native']
base=info['base']; errors=[];console_errors=[];expected_offline_errors=[];checks=[]
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True)
    context=browser.new_context(viewport={'width':1536,'height':1024},device_scale_factor=1)
    page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('console',lambda m:(expected_offline_errors if 'net::ERR_INTERNET_DISCONNECTED' in m.text else console_errors).append(m.text) if m.type=='error' else None)
    try:
        page.goto(base+'/chat');expect(page.get_by_role('heading',name='Welcome back.')).to_be_visible()
        page.get_by_label('Username',exact=True).fill(info['username'])
        page.get_by_label('Password',exact=True).fill(info['password'])
        page.get_by_role('button',name='Sign in',exact=True).click()
        expect(page.get_by_role('heading',name='What shall we work on?')).to_be_visible(timeout=15000)
        assert urlparse(page.url).path=='/chat'
        checks.append('login returns to chat')
        (evidence/'initial-dom.html').write_text(page.content())
        page.screenshot(path=str(evidence/'empty-light.png'))
        composer=page.get_by_role('textbox',name='Message Router',exact=True)
        composer.fill('A saved draft');page.reload();expect(composer).to_have_value('A saved draft')
        composer.fill('Help me plan the Roppo launch. Research the market and draft a practical release plan.')
        page.get_by_role('button',name='Send message',exact=True).click()
        expect(page.locator('.user-message')).to_have_count(1,timeout=15000)
        first=page.request.get(base+'/api/chat/space').json()['conversation']['id']
        expect(page.locator('.inline-team>summary')).to_be_visible(timeout=15000)
        page.locator('.inline-team>summary').click()
        page.screenshot(path=str(evidence/'conversation-light-running.png'))
        page.get_by_role('button',name='Team activity',exact=True).click()
        expect(page.get_by_role('complementary',name='Team activity',exact=True)).to_be_visible()
        expect(page.get_by_role('complementary',name='Team activity',exact=True)).to_have_css('opacity','1')
        page.get_by_role('button',name='Switch to dark mode',exact=True).click()
        assert page.locator('html').get_attribute('data-theme')=='dark'
        page.screenshot(path=str(evidence/'conversation-dark-team.png'))
        expect(page.locator('.message-tool-activity .tool-call').first).to_be_visible()
        expect(page.locator('.team-branch.flowing').first).to_be_visible(timeout=15000)
        assert page.locator('.team-map.has-flow').count()==1
        assert page.locator('.router-node').get_attribute('data-state')=='running'
        page.screenshot(path=str(evidence/'tools-and-flow-running.png'))
        streamed=page.locator('.assistant-message[data-streaming="true"] .assistant-body').first
        expect(streamed).to_be_visible(timeout=15000)
        first_fragment=streamed.inner_text()
        page.wait_for_function("n => {const e=document.querySelector('.assistant-message[data-streaming=true] .assistant-body');return e && e.textContent.length>n}",arg=len(first_fragment),timeout=10000)
        page.screenshot(path=str(evidence/'streaming-reply.png'))
        checks.extend(['tool calls rendered from runtime','live Router and Worker topology','text grows before response completion'])
        context.set_offline(True)
        expect(page.locator('.connection-state')).to_be_visible(timeout=10000)
        assert page.locator('.team-branch.flowing').count()==0
        page.wait_for_timeout(400);context.set_offline(False)
        expect(page.locator('.connection-state')).not_to_be_visible(timeout=15000)
        checks.append('disconnect pauses motion and reconnect resumes durable state')
        page.keyboard.press('Escape');expect(page.get_by_role('complementary',name='Team activity',exact=True)).not_to_be_visible()
        expect(page.get_by_role('button',name='Team activity',exact=True)).to_be_focused()
        expect(page.locator('.run-status')).to_have_text('Complete',timeout=45000)
        assert 'Router' in page.locator('.assistant-identity strong').all_text_contents()
        assert any(name!='Router' for name in page.locator('.assistant-identity strong').all_text_contents())
        checks.extend(['real Router/Worker runtime projection with fixture provider','collapsible team pane','theme toggle','Escape restores focus','Router and Worker transcript'])
        page.reload();expect(page.locator('.user-message')).to_have_count(1);expect(page.locator('.run-status')).to_have_text('Complete')
        assert page.locator('html').get_attribute('data-theme')=='dark'
        expect(page.locator('.message-tool-activity .tool-call').first).to_be_visible()
        assert page.locator('.team-branch.flowing').count()==0
        checks.append('history, tool calls and theme survive refresh')
        before=page.locator('.assistant-message').count()
        expect(page.get_by_role('button',name='New conversation',exact=True)).to_have_count(0)
        composer.fill('A separate conversation to stop')
        page.get_by_role('button',name='Send message',exact=True).click()
        expect(page.get_by_role('button',name='Stop this run',exact=True)).to_be_visible(timeout=15000)
        second=page.request.get(base+'/api/chat/space').json()['conversation']['id'];assert first==second
        page.get_by_role('button',name='Stop this run',exact=True).click()
        expect(page.locator('.run-status')).to_have_text('Run stopped',timeout=15000)
        page.wait_for_timeout(3500);assert page.locator('.assistant-message').count()==before
        checks.append('cancellation suppresses late replies')
        composer.fill('A conversation to stop during a partial response')
        page.get_by_role('button',name='Send message',exact=True).click()
        expect(page.locator('.assistant-message[data-streaming="true"]')).to_be_visible(timeout=20000)
        page.get_by_role('button',name='Stop this run',exact=True).click()
        expect(page.locator('.run-status')).to_have_text('Run stopped',timeout=15000)
        expect(page.locator('.partial-status')).to_have_text('Output stopped')
        stopped_text=page.locator('.assistant-body').last.inner_text()
        page.wait_for_timeout(500);assert page.locator('.assistant-body').last.inner_text()==stopped_text
        page.reload();expect(page.locator('.partial-status')).to_have_text('Output stopped')
        checks.append('mid-stream stop retains incomplete output without a late completion')
        composer.fill('Keep the single chat draft');page.reload();expect(composer).to_have_value('Keep the single chat draft')
        expect(page.locator('.user-message')).to_have_count(3)
        checks.append('one persistent chat and draft across follow-ups')
        page.get_by_role('button',name='Switch to Chinese',exact=True).click()
        expect(page.get_by_role('textbox',name='向 Router 发送消息',exact=True)).to_be_visible()
        composer=page.get_by_role('textbox',name='向 Router 发送消息',exact=True)
        composer.fill('输入法测试')
        composer.dispatch_event('compositionstart')
        composer.dispatch_event('keydown',{'key':'Enter','code':'Enter','keyCode':229,'isComposing':True,'bubbles':True})
        composer.dispatch_event('compositionend')
        page.wait_for_timeout(200);assert page.locator('.user-message').count()==3
        checks.append('IME Enter does not send')
        for width,height in [(1440,960),(1024,768),(390,844),(320,680)]:
            page.set_viewport_size({'width':width,'height':height})
            for theme in ['light','dark']:
                if page.locator('html').get_attribute('data-theme')!=theme:
                    page.get_by_role('button',name='切换为浅色模式' if theme=='light' else '切换为深色模式',exact=True).click()
                page.wait_for_timeout(200)
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'),(width,theme,'horizontal overflow')
                assert page.evaluate('document.documentElement.scrollHeight <= innerHeight'),(width,theme,'page scroll')
                box=composer.bounding_box();assert box and box['y']+box['height']<=height,(width,theme,'composer clipped')
                page.screenshot(path=str(evidence/f'{width}-{theme}-zh.png'))
            if width<700:
                page.get_by_role('button',name='打开导航',exact=True).click()
                expect(page.get_by_role('link',name='对话',exact=True)).to_be_visible()
                page.keyboard.press('Escape');expect(page.get_by_role('button',name='打开导航',exact=True)).to_be_focused()
                page.get_by_role('button',name='团队动态',exact=True).click()
                panel=page.get_by_role('complementary',name='团队动态')
                expect(panel).to_be_visible();expect(panel).to_have_css('opacity','1')
                panel_box=panel.bounding_box();assert panel_box and panel_box['x']>=0 and panel_box['x']+panel_box['width']<=width+1
                page.screenshot(path=str(evidence/f'{width}-team-zh.png'))
                page.keyboard.press('Escape')
        checks.extend(['four viewport sizes in both themes','mobile navigation and team drawer','fixed viewport with visible composer'])
        page.emulate_media(reduced_motion='reduce')
        assert page.evaluate("[...document.querySelectorAll('.spin,.message,.team-panel')].every(e=>getComputedStyle(e).animationName==='none')")
        checks.append('reduced motion')
        page.set_viewport_size({'width':1536,'height':1024})
        page.get_by_role('button',name='切换为英文',exact=True).click()
        if page.locator('html').get_attribute('data-theme')!='light':page.get_by_role('button',name='Switch to light mode',exact=True).click()
        composer=page.get_by_role('textbox',name='Message Router',exact=True);composer.fill('')
        page.screenshot(path=str(evidence/'final-light.png'))
        page.get_by_role('button',name='Team activity',exact=True).click()
        page.get_by_role('button',name='Switch to dark mode',exact=True).click()
        page.screenshot(path=str(evidence/'final-dark-team.png'))
        assert not errors,errors
        assert not console_errors,console_errors
        result={'passed':True,'provider':'fixture model through real Runtime and WorkerManager','checks':checks,'pageErrors':errors,'consoleErrors':console_errors,'expectedOfflineErrors':expected_offline_errors,'url':page.url}
        (evidence/'browser-result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
        print(json.dumps(result,ensure_ascii=False))
    except Exception:
        page.screenshot(path=str(evidence/'failure.png'))
        (evidence/'failure-dom.html').write_text(page.content())
        (evidence/'failure-log.json').write_text(json.dumps({'checksCompleted':checks,'pageErrors':errors,'consoleErrors':console_errors},ensure_ascii=False,indent=2))
        raise
    finally:
        browser.close()
