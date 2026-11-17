"""Exercise the real Chat HTTP/SSE projection using the isolated companion fixture."""
import json,sys
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
root=Path(sys.argv[1]);evidence=Path(sys.argv[2]);evidence.mkdir(parents=True,exist_ok=True)
f=json.loads((root/'browser.json').read_text());assert not f['native']
checks=[];errors=[];metrics=[]
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True)
 context=browser.new_context(viewport={'width':1440,'height':960},device_scale_factor=2)
 page=context.new_page();page.on('pageerror',lambda error:errors.append(str(error)))
 def check(name):checks.append(name);print(name,flush=True)
 def phase(value):expect(page.locator('.chat-companion')).to_have_attribute('data-phase',value,timeout=20000)
 def capture(name):page.screenshot(path=str(evidence/(name+'.png')))
 def send(text):page.locator('.composer-input').fill(text);page.get_by_role('button',name='发送消息',exact=True).click()
 def layout(width):
  page.set_viewport_size({'width':width,'height':900});page.wait_for_timeout(260)
  values=page.evaluate('''()=>{const rect=s=>document.querySelector(s).getBoundingClientRect();const t=rect('.thread'),m=rect('.transcript-inner'),c=rect('.composer'),a=rect('.assistant-body');return {width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,centerDelta:Math.abs((m.x+m.width/2)-(c.x+c.width/2)),widthDelta:Math.abs(m.width-c.width),bodyDelta:Math.abs(a.x-m.x),messageFont:getComputedStyle(document.querySelector('.message')).fontSize,inputFont:getComputedStyle(document.querySelector('.composer-input')).fontSize,modelFont:getComputedStyle(document.querySelector('.model-link')).fontSize,companion:rect('.chat-companion').toJSON(),actions:rect('.header-actions').toJSON()}}''')
  assert not values['overflow'],values
  assert values['centerDelta']<1 and values['widthDelta']<1 and values['bodyDelta']<1,values
  assert values['messageFont']==('14px' if width<=700 else '15px'),values
  assert values['inputFont']==('16px' if width<=700 else '15px'),values
  assert values['modelFont']==('11px' if width<=700 else '12px'),values
  assert values['companion']['right']<=values['actions']['left']+1,values
  metrics.append(values)
 try:
  page.goto(f['base']+'/chat');page.wait_for_load_state('networkidle')
  page.get_by_label('Username',exact=True).fill(f['username']);page.get_by_label('Password',exact=True).fill(f['password']);page.get_by_role('button',name='Sign in',exact=True).click()
  expect(page.locator('.composer-input')).to_be_visible();page.get_by_role('button',name='Switch to Chinese',exact=True).click();phase('idle');capture('idle')
  textarea=page.locator('.composer-input');textarea.fill('输入法确认');textarea.dispatch_event('compositionstart');textarea.dispatch_event('keydown',{'key':'Enter','code':'Enter','keyCode':229,'isComposing':True,'bubbles':True});textarea.dispatch_event('compositionend');page.wait_for_timeout(200);expect(page.locator('.user-message')).to_have_count(0)
  textarea.fill('第一行');textarea.press('Shift+Enter');textarea.type('第二行');expect(textarea).to_have_value('第一行\n第二行');check('中文输入法确认不发送，Shift+Enter 正常换行')
  with page.expect_file_chooser() as chooser:page.get_by_role('button',name='上传文件',exact=True).click()
  chooser.value.set_files({'name':'layout-notes.txt','mimeType':'text/plain','buffer':b'Chat layout acceptance'})
  expect(page.locator('.draft-attachment')).to_be_visible();expect(page.get_by_role('button',name='发送消息',exact=True)).to_be_enabled(timeout=15000);capture('attachment')
  send('检查聊天页布局和交互');phase('thinking');capture('thinking');phase('working');capture('working')
  first=page.locator('.roppo-arm-left').evaluate('(e)=>getComputedStyle(e).transform');page.wait_for_timeout(130);second=page.locator('.roppo-arm-left').evaluate('(e)=>getComputedStyle(e).transform');assert first!=second,(first,second)
  timing=page.evaluate('''()=>new Promise(resolve=>{const frames=[];let last;function tick(t){if(last!==undefined)frames.push(t-last);last=t;if(frames.length===45)resolve(frames);else requestAnimationFrame(tick)}requestAnimationFrame(tick)})''');metrics.append({'rafMedian':sorted(timing)[len(timing)//2],'rafP95':sorted(timing)[int(len(timing)*.95)]})
  phase('reviewing');expect(page.locator('.companion-label')).to_have_text('正在审查输入组件');capture('reviewing')
  phase('completed');expect(page.locator('.assistant-body').last).to_contain_text('本次调整');check('真实 SSE 展示模型短句及思考、工作、审查、完成状态；手部连续运动')
  page.locator('.transcript').evaluate('(e)=>e.scrollTop=0');capture('conversation-light');expect(page.locator('.draft-attachment')).to_have_count(0);expect(page.locator('.user-message .chat-attachment')).to_be_visible();check('文件随消息发送，草稿附件清除')
  for width in [1440,1024,800,700,390,320]:layout(width);capture('layout-'+str(width))
  check('六种宽度正文和输入栏同轴，现有字号未改变，无横向溢出或顶栏重叠')
  page.set_viewport_size({'width':1440,'height':960});page.get_by_role('button',name='切换为深色模式',exact=True).click();capture('conversation-dark')
  page.get_by_role('button',name='查看当前任务进展',exact=True).click();expect(page.locator('#session-panel')).to_be_visible();layout(1440);capture('resource-open');page.keyboard.press('Escape');expect(page.locator('#session-panel')).not_to_be_visible();expect(page.get_by_role('button',name='查看当前任务进展',exact=True)).to_be_focused();check('角色入口打开团队动态，资源面板打开后正文仍居中')
  send('工作测试');phase('working');page.locator('.transcript').evaluate('(e)=>e.scrollTop=0');before=page.locator('.transcript').evaluate('(e)=>e.scrollTop');page.wait_for_timeout(600);assert page.locator('.transcript').evaluate('(e)=>e.scrollTop')==before;expect(page.get_by_role('button',name='回到最新消息',exact=True)).to_be_visible();check('向上阅读保留滚动位置，提供回到最新入口')
  context.set_offline(True);phase('offline');capture('offline');context.set_offline(False);phase('working');check('断线停止工作姿态，重连恢复当前任务')
  page.emulate_media(reduced_motion='reduce');assert page.locator('.roppo-character').evaluate('(e)=>e.getAnimations({subtree:true}).filter(a=>a.playState==="running").length')==0;page.emulate_media(reduced_motion='no-preference');check('减少动态效果模式无角色循环动画')
  page.get_by_role('button',name='停止本次任务',exact=True).click();phase('stopped');capture('stopped');page.wait_for_timeout(500);phase('stopped');check('停止任务后不再敲键盘，不被旧状态覆盖')
  send('失败测试');phase('failed');capture('failed');check('真实运行失败显示异常状态')
  send('等待测试');phase('waiting');capture('waiting');check('Worker 等待用户补充时切换等待姿态')
  assert not errors,errors
  (evidence/'results.json').write_text(json.dumps({'checks':checks,'metrics':metrics,'pageErrors':errors,'provider':'deterministic fixture; real HTTP/SSE and task lifecycle'},ensure_ascii=False,indent=2))
 except Exception:
  capture('failure');(evidence/'failure.html').write_text(page.content());raise
 finally:browser.close()
