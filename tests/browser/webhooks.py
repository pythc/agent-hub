"""Real browser against the isolated host fixture. No production account or state."""
import json,sys,hmac,hashlib,base64,time,uuid
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
root=Path(sys.argv[1]); info=json.loads((root/'browser-info.json').read_text()); keys=json.loads((root/'test-keys.json').read_text()); base=info['url']; errors=[]
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True); context=browser.new_context(viewport={'width':1440,'height':1000},reduced_motion='reduce'); page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
 status=context.request.get(base+'/account/status',headers={'authorization':'Bearer '+info['token']}).json()
 if not status.get('configured'):
  setup=context.request.post(base+'/account/setup',headers={'authorization':'Bearer '+info['token'],'origin':base},data={'username':'webhook-test','displayName':'Webhook 验证','password':'isolated-browser-test-only-2026'});assert setup.ok,setup.status
 else:
  login=context.request.post(base+'/account/login',headers={'origin':base},data={'username':'webhook-test','password':'isolated-browser-test-only-2026'});assert login.ok,login.status
 page.goto(base+'/webhook-workbench');page.wait_for_load_state('networkidle');page.screenshot(path=str(root/'desktop-before.png'),full_page=True)
 (root/'initial-dom.txt').write_text(page.locator('main').inner_text())
 expect(page.get_by_role('button',name='Compute',exact=False)).to_be_visible();page.get_by_role('button',name='Compute',exact=False).click();expect(page.get_by_role('heading',name='Compute',exact=True)).to_be_visible()
 before=context.request.get(base+'/webhooks').json();page.get_by_text('预演事件',exact=True).click();page.get_by_role('button',name='验证规则，不创建任务').click();expect(page.locator('#status')).to_contain_text('预演通过');after=context.request.get(base+'/webhooks').json();assert before['receipts']==after['receipts'] and before['deliveries']==after['deliveries']
 page.get_by_role('button',name='停止接收',exact=True).click();expect(page.get_by_role('button',name='恢复接收',exact=True)).to_be_visible();page.reload();page.wait_for_load_state('networkidle');page.get_by_role('button',name='Compute',exact=False).click();expect(page.get_by_role('button',name='恢复接收',exact=True)).to_be_visible();page.get_by_role('button',name='恢复接收',exact=True).click();expect(page.get_by_role('button',name='停止接收',exact=True)).to_be_visible()
 page.get_by_text('轮换签名密钥',exact=True).click();page.get_by_label('新输入密钥变量',exact=True).fill('WEBHOOK_UI_IN_NEXT');page.get_by_label('新输出密钥变量',exact=True).fill('WEBHOOK_UI_OUT_NEXT');page.get_by_role('button',name='应用轮换',exact=True).click();expect(page.locator('#status')).to_contain_text('密钥版本已更新')
 # Signed HTTP events exercise the actual inbox, task engine, waits and callback ledger.
 def event(kind,identifier):
  body=json.dumps({'specversion':'1.0','id':identifier,'source':'https://producer.example/events','type':kind,'data':{'batch':'browser-batch'}},separators=(',',':')).encode();timestamp=str(int(time.time()));delivery='browser_'+uuid.uuid4().hex;secret=base64.b64decode(keys['WEBHOOK_UI_IN_NEXT'][6:]);sig=base64.b64encode(hmac.new(secret,delivery.encode()+b'.'+timestamp.encode()+b'.'+body,hashlib.sha256).digest()).decode();response=context.request.post(info['webhookUrl']+'/webhooks/'+info['grantId'],headers={'content-type':'application/json','webhook-id':delivery,'webhook-timestamp':timestamp,'webhook-signature':'v1,'+sig},data=body);assert response.status==202,response.text();return response.json()
 first=event('test.request','browser-start');assert event('test.request','browser-start')['duplicate']
 for _ in range(80):
  snap=context.request.get(base+'/webhooks').json()
  if snap['waits'] and snap['waits'][0]['state']=='waiting':break
  time.sleep(.1)
 else:raise AssertionError('No durable wait')
 page.get_by_role('button',name='刷新',exact=True).click();expect(page.get_by_role('button',name='暂停任务',exact=True)).to_be_visible();page.get_by_role('button',name='暂停任务',exact=True).click();expect(page.get_by_role('button',name='继续推进',exact=True)).to_be_visible();event('test.release','browser-release');page.get_by_role('button',name='继续推进',exact=True).click()
 for _ in range(120):
  snap=context.request.get(base+'/webhooks').json()
  if snap['deliveries'] and snap['deliveries'][0]['state']=='sent':break
  time.sleep(.1)
 else:raise AssertionError('No delivered callback')
 page.get_by_role('button',name='刷新',exact=True).click();expect(page.locator('#detail')).to_contain_text('已送达');assert snap['deliveries'][0]['attempts']==2
 page.get_by_role('button',name='新建自动化',exact=True).click();expect(page.get_by_role('heading',name='新建自动化',exact=True)).to_be_visible();f=page.locator('#create');f.locator('[name=authorizationQuote]').fill('Authorize this event automation');f.locator('[name=namespace]').fill('browser-created');f.locator('[name=eventSource]').fill('https://producer.example/events');f.locator('[name=secretEnv]').fill('WEBHOOK_UI_IN');f.locator('[name=callbackSecret]').fill('WEBHOOK_UI_OUT');f.locator('[name=url]').fill('http://127.0.0.1:'+str(info['callbackPort'])+'/callback');f.locator('[name=title]').fill('Browser created automation');f.locator('[name=objective]').fill('Write result.json whose total is 42. Never deploy.');f.locator('[name=nodes]').fill(json.dumps([{'id':'work','title':'Write result','instruction':'Write result.json whose total is 42','workerId':'one','criterionIds':['result'],'dependsOn':[]} ]));f.locator('[name=idempotent]').check();f.get_by_role('button',name='创建固定授权').click();expect(page.locator('#status')).to_contain_text('自动化已创建');expect(page.get_by_role('heading',name='Browser created automation',exact=True)).to_be_visible()
 page.get_by_label('筛选自动化',exact=True).fill('no-match');expect(page.locator('#grants')).to_contain_text('没有符合条件');page.get_by_label('筛选自动化',exact=True).fill('');page.screenshot(path=str(root/'desktop-after.png'),full_page=True)
 page.keyboard.press('Tab');assert page.evaluate('document.activeElement !== document.body');page.set_viewport_size({'width':390,'height':844});page.screenshot(path=str(root/'mobile.png'),full_page=True);assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth')
 assert not errors,errors; (root/'browser-evidence.json').write_text(json.dumps({'ok':True,'checks':['authenticated UI','dry-run no effects','receive stop resume persisted on reload','key rotation','HTTP duplicate','durable event wait','goal pause resume','callback retry','create grant through form','search empty state','keyboard focus','390px no overflow'],'consoleErrors':errors,'model':'fixture stub; native model evidence separate'},ensure_ascii=False,indent=2));browser.close()
