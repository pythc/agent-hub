"""Explicit live-Codex acceptance. Uses only a named isolated native acceptance host."""
import json,sys,time
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
root=Path(sys.argv[1]);evidence=Path(sys.argv[2]);evidence.mkdir(parents=True,exist_ok=True)
info=json.loads((root/'browser.json').read_text());assert info['native']
prior=json.loads((evidence/'native-stream.json').read_text());assert prior['verified']
errors=[];samples=[]
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True);page=browser.new_page(viewport={'width':1536,'height':1024})
    page.on('pageerror',lambda e:errors.append(str(e)))
    try:
        page.goto(info['base']+'/chat?conversation='+prior['conversation'])
        page.get_by_label('Username',exact=True).fill(info['username']);page.get_by_label('Password',exact=True).fill(info['password']);page.get_by_role('button',name='Sign in',exact=True).click()
        expect(page.locator('.run-status')).to_have_text('Complete',timeout=15000)
        expect(page.locator('.tool-call').first).to_be_visible()
        old_calls=page.locator('.tool-call').count()
        page.get_by_role('button',name='Team activity',exact=True).click();page.get_by_role('button',name='Switch to dark mode',exact=True).click()
        page.get_by_role('textbox',name='Message Router',exact=True).fill('不要创建或恢复任务。只根据本会话已经完成的任务，用不少于 500 字中文解释任务状态、工具调用状态和回复输出状态分别表示什么，说明失败调用恢复后为何仍应保留失败记录。请使用连贯段落，最后写 ROPPO_BROWSER_STREAM_OK。')
        page.get_by_role('button',name='Send message',exact=True).click()
        streamed=page.locator('.assistant-message[data-streaming="true"] .assistant-body').last
        expect(streamed).to_be_visible(timeout=120000)
        start=time.monotonic();last='';captured=False
        while time.monotonic()-start<120:
            if streamed.count():
                text=streamed.inner_text()
                if text!=last:samples.append({'elapsed':round(time.monotonic()-start,3),'length':len(text)});last=text
                if len(text)>60 and not captured:
                    assert page.locator('.router-node').get_attribute('data-state')=='running'
                    page.screenshot(path=str(evidence/'native-browser-streaming.png'));captured=True
            if page.locator('.run-status').inner_text()=='Complete':break
            page.wait_for_timeout(100)
        expect(page.locator('.run-status')).to_have_text('Complete')
        expect(page.locator('.assistant-message').last).to_contain_text('ROPPO_BROWSER_STREAM_OK')
        assert len(samples)>=2 and samples[-1]['length']>samples[0]['length'],samples
        assert page.locator('.tool-call').count()==old_calls
        assert page.locator('.team-branch.flowing').count()==0
        assert not errors,errors
        page.screenshot(path=str(evidence/'native-browser-complete.png'))
        result={'passed':True,'provider':'Native Codex','samples':samples,'historyToolCalls':old_calls,'pageErrors':errors,'url':page.url}
        (evidence/'native-browser-stream.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print(json.dumps({'passed':True,'observedTextUpdates':len(samples),'historyToolCalls':old_calls,'url':page.url}))
    except Exception:
        page.screenshot(path=str(evidence/'native-browser-failure.png'));(evidence/'native-browser-failure.html').write_text(page.content());raise
    finally:browser.close()
