"""Single chat and read-only Worker dialogue, using real HTTP/SQLite and a deterministic model."""
import json, os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
root=Path(os.environ['CHAT_BROWSER_DIR']);f=json.loads((root/'fixture.json').read_text());checks=[];errors=[]
def passed(s):
 checks.append(s);print('PASS '+s,flush=True)
with sync_playwright() as p:
 browser=p.chromium.launch();context=browser.new_context(viewport={'width':1440,'height':960},reduced_motion='reduce');name,value=f['cookie'].split('=',1);context.add_cookies([{'name':name,'value':value,'url':f['url']}]);page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(f['url']+'/chat');page.evaluate("localStorage.setItem('agenthub.configuration.language','zh-CN');localStorage.setItem('agenthub.configuration.theme','light')");page.reload();page.wait_for_load_state('networkidle')
 expect(page.get_by_role('button',name='新建会话',exact=True)).to_have_count(0);expect(page.locator('.conversation-sidebar')).to_have_count(0)
 composer=page.get_by_role('textbox',name='向 Router 发送消息',exact=True);composer.fill('论文摘要遇到 emoji 会被截坏，帮我修复并验证一下。');page.get_by_role('button',name='发送消息',exact=True).click()
 expect(page.locator('.assistant-body').filter(has_text='开发 Worker 已完成修复和回归验证，请验收。')).to_be_visible(timeout=20000)
 expect(page.locator('.assistant-identity strong').filter(has_text='开发 Worker')).to_have_count(1)
 expect(page.locator('.assistant-body').filter(has_text='请修复摘要遇到 emoji 被截断的问题，并运行回归验证。')).to_be_visible()
 page.wait_for_function("Array.from(document.querySelectorAll('.agent-portrait')).every(img => img.complete && img.naturalWidth > 0)")
 worker_portrait=page.locator('.assistant-identity .agent-portrait[data-agent-id="developer"]').get_attribute('src')
 assert worker_portrait and worker_portrait.endswith('.webp')
 passed('group chat shows the real Router delegation, Worker reply and Router final response with speaker identities')
 page.screenshot(path=str(root/'group-light.png'),full_page=True)
 original=context.request.get(f['url']+'/api/chat/space').json()['conversation']['id'];composer.fill('保留这份未发送的草稿')
 def settings():
  page.get_by_role('link',name='设置',exact=True).click();page.get_by_role('navigation',name='设置分区',exact=True).get_by_role('button',name='聊天',exact=True).click();expect(page.get_by_role('heading',name='聊天显示',exact=True)).to_be_visible()
 def chat():
  page.locator('.function-link[href="/chat"]').click();expect(page.locator('.conversation-body')).to_be_visible()
 settings();page.get_by_role('radio',name='好友列表',exact=False).check();expect(page.get_by_role('radio',name='好友列表',exact=False)).to_be_checked();expect(page.get_by_role('button',name='清空所有记忆和上下文',exact=True)).to_be_enabled();page.screenshot(path=str(root/'settings-light.png'),full_page=True);chat()
 expect(page.get_by_role('textbox',name='向 Router 发送消息',exact=True)).to_have_value('保留这份未发送的草稿')
 expect(page.locator('.agent-contact')).to_have_count(3)
 assert page.locator('.agent-contact .agent-portrait[data-agent-id="developer"]').get_attribute('src')==worker_portrait
 page.locator('.agent-contact').filter(has_text='开发 Worker').click()
 expect(page.get_by_role('textbox',name='请与 Router 对话',exact=True)).to_be_disabled();expect(page.get_by_role('button',name='发送消息',exact=True)).to_have_count(0)
 expect(page.locator('.message')).to_have_count(2)
 expect(page.locator('.assistant-body').filter(has_text='请修复摘要遇到 emoji 被截断的问题')).to_be_visible();expect(page.locator('.assistant-body').filter(has_text='摘要截断已修改')).to_be_visible()
 passed('Worker contact is read-only and shows only the actual Router/Worker exchange')
 page.screenshot(path=str(root/'worker-light.png'),full_page=True)
 page.get_by_role('button',name='前往 Router',exact=True).click();expect(page.get_by_role('textbox',name='向 Router 发送消息',exact=True)).to_have_value('保留这份未发送的草稿')
 page.reload();page.wait_for_load_state('networkidle');expect(page.locator('.agent-contact')).to_have_count(3);expect(page.get_by_role('textbox',name='向 Router 发送消息',exact=True)).to_have_value('保留这份未发送的草稿')
 assert page.locator('.agent-contact .agent-portrait[data-agent-id="developer"]').get_attribute('src')==worker_portrait
 assert context.request.get(f['url']+'/api/chat/space').json()['conversation']['id']==original
 passed('display switching, selecting a Worker, navigation and reload preserve the same chat and Router draft')
 page.get_by_role('button',name='切换为深色模式',exact=True).click();page.locator('.agent-contact').filter(has_text='开发 Worker').click();expect(page.locator('.message')).to_have_count(2);page.screenshot(path=str(root/'worker-dark.png'),full_page=True)
 assert page.locator('.agent-contact .agent-portrait[data-kind="router"]').evaluate('(img)=>getComputedStyle(img).filter')=='invert(1)'
 assert page.locator('.agent-contact .agent-portrait[data-agent-id="developer"]').evaluate('(img)=>getComputedStyle(img).filter')=='none'
 page.set_viewport_size({'width':390,'height':844});page.get_by_role('button',name='打开导航',exact=True).click();expect(page.locator('.agent-contact').filter(has_text='复核 Worker')).to_be_visible();page.locator('.agent-contact').filter(has_text='复核 Worker').click();expect(page.get_by_role('heading',name='暂无协作消息',exact=True)).to_be_visible();expect(page.get_by_role('textbox',name='请与 Router 对话',exact=True)).to_be_disabled()
 assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
 page.screenshot(path=str(root/'worker-mobile.png'),full_page=True);passed('dark mode and 390px navigation/read-only empty state have no horizontal overflow')
 page.set_viewport_size({'width':1440,'height':960});settings();page.get_by_role('button',name='清空所有记忆和上下文',exact=True).click();page.get_by_role('button',name='取消',exact=True).click();assert context.request.get(f['url']+'/api/chat/space').json()['conversation']['id']==original
 other=context.new_page();other.goto(f['url']+'/chat');expect(other.locator('.message').first).to_be_visible();
 page.get_by_role('button',name='清空所有记忆和上下文',exact=True).click();expect(page.get_by_text('使用这些聊天上下文的任务将停止。此操作无法撤销，保留连接和项目配置。',exact=True)).to_be_visible();page.get_by_role('button',name='确认清空',exact=True).click();expect(page.get_by_text('上次清空已完成。',exact=True)).to_be_visible(timeout=15000)
 assert context.request.get(f['url']+'/api/chat/conversations/'+original).status==409
 expect(other.locator('.message')).to_have_count(0);expect(other.get_by_role('textbox',name='向 Router 发送消息',exact=True)).to_have_value('');other.close()
 chat();expect(page.get_by_role('textbox',name='向 Router 发送消息',exact=True)).to_have_value('');expect(page.locator('.message')).to_have_count(0)
 page.get_by_role('textbox',name='向 Router 发送消息',exact=True).fill('重新开始一个任务');page.get_by_role('button',name='发送消息',exact=True).click();expect(page.locator('.assistant-body').filter(has_text='开发 Worker 已完成修复和回归验证，请验收。')).to_be_visible(timeout=20000)
 fresh=context.request.get(f['url']+'/api/chat/space').json();assert fresh['conversation']['id']!=original;assert fresh['display']=='agents'
 passed('confirmed reset clears old chat and drafts, reports verified cleanup and admits a fresh task while retaining display preference')
 settings();page.get_by_role('radio',name='群聊',exact=False).check();chat();expect(page.locator('.conversation-sidebar')).to_have_count(0);assert context.request.get(f['url']+'/api/chat/space').json()['conversation']['id']==fresh['conversation']['id']
 assert not errors,errors;passed('both display modes remain usable after reset, with no browser page errors')
 (root/'evidence.json').write_text(json.dumps({'checks':checks,'errors':errors,'model':'deterministic fixture; no external provider','chatBefore':original,'chatAfter':fresh['conversation']['id']},ensure_ascii=False,indent=2));browser.close()
