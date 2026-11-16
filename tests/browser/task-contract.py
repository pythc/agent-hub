"""Actual existing drawer/GET. Fault-injected payloads and failures are separate evidence."""
import json,os,sys,time,uuid
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright,expect
root=Path(sys.argv[1]);info=json.loads((root/'browser.json').read_text());out=root/'screenshots';out.mkdir(exist_ok=True);checks=[];errors=[];external=[];writes=[];report={};phase='startup'
def control(action):
 ident=str(uuid.uuid4());pending=root/'control-next.json';pending.write_text(json.dumps({'id':ident,'action':action}));pending.replace(root/'control.json');deadline=time.monotonic()+20
 while True:
  assert not(root/'control-failed.json').exists(),'fixture_control_failed'
  if(root/'control-result.json').exists():
   result=json.loads((root/'control-result.json').read_text())
   if result.get('id')==ident:return result
  assert time.monotonic()<deadline,'fixture_control_timeout';time.sleep(.05)
with sync_playwright()as p:
 browser=p.chromium.launch(headless=True,executable_path=os.environ.get('CHROMIUM_EXECUTABLE','/usr/bin/chromium'),args=['--no-sandbox','--no-zygote','--disable-background-networking'])
 context=browser.new_context(viewport={'width':1440,'height':1100},color_scheme='light');name,value=info['cookie'].split('=',1);context.add_cookies([{'name':name,'value':value,'url':info['base']}]);page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
 def request(r):
  if r.url.startswith(('http:','https:'))and not r.url.startswith(info['base']+'/'):external.append(True)
  if urlparse(r.url).path.startswith(('/entry-workspace/task/','/task/','/approval','/api/execution-trace'))and r.method!='GET':writes.append(r.method)
 page.on('request',request)
 def stable(locator):
  expect(locator).to_be_visible();locator.scroll_into_view_if_needed()
  page.evaluate("""async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const finite=document.getAnimations().filter(a=>a.playState==='running'&&a.effect?.getTiming().iterations!==Infinity);await Promise.race([Promise.all(finite.map(a=>a.finished.catch(()=>{}))),new Promise((_,reject)=>setTimeout(()=>reject(Error('finite_animation_timeout')),5000))]);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))}""")
  assert locator.evaluate("""async e=>{const box=()=>{const r=e.getBoundingClientRect();return[r.x,r.y,r.width,r.height]},a=box();await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return box().every((v,i)=>Math.abs(v-a[i])<.5)}"""),'unstable_screenshot_box'
 def shot(name,locator=None):
  target=locator or page.locator('#operator-task');stable(target);target.screenshot(path=str(out/name))
 def open_task(ident,state):
  page.locator('[id='+json.dumps('work-'+ident)+']').click();dialog=page.locator('#operator-task');expect(dialog).to_be_visible();card=dialog.locator('.task-contract-card');expect(card).to_have_attribute('data-state',state);return card
 def close():page.locator('#operator-task').get_by_role('button',name=__import__('re').compile('^(Close details|关闭详情)$')).click();expect(page.locator('#operator-task')).to_have_count(0)
 try:
  phase='actual_managed_detail';page.goto(info['url']);card=open_task(info['managedId'],'available');expect(card.get_by_role('heading',name='Saved goal',exact=True)).to_be_visible();expect(card).to_contain_text(info['objective']);expect(card).to_contain_text('Explain the main findings');expect(card).to_contain_text('State what remains unverified')
  assert not card.locator('details').evaluate('(e)=>e.open');assert card.get_by_role('button').count()==0 and card.get_by_role('link').count()==0
  assert card.evaluate("e=>Array.from(e.querySelectorAll('*')).concat(e).filter(n=>n.getClientRects().length&&n.textContent.trim()).every(n=>parseFloat(getComputedStyle(n).fontSize)>=14)")
  shot('actual-english-light.png',card);shot('actual-drawer-light.png');baseline=control('observe');assert baseline['allTablesUnchanged']and baseline['totalChangesUnchanged']and baseline['modelCalls']==0 and not baseline['declaredFileExists'];checks.append('normal real goal scheduler produced task; protected GET/display shows original typed goal and criteria; declared file absent is not claimed produced/accepted; no model execution')
  phase='actual_keyboard_details';card.locator('summary').focus();page.keyboard.press('Enter');expect(card.locator('details')).to_have_attribute('open','');expect(card).to_contain_text('analysis.md');expect(card).to_contain_text('not proof of completed or accepted work');expect(card).to_contain_text('Time budget: 30 minutes');expect(card).to_contain_text('Estimated cost ceiling: US$5');expect(card).to_contain_text('not an account balance');shot('actual-english-details-light.png',card);page.keyboard.press('Enter');close()
  page.get_by_role('button',name='Switch to dark mode',exact=True).click();card=open_task(info['managedId'],'available');shot('actual-english-dark.png',card);close()
  page.set_viewport_size({'width':390,'height':1100});page.emulate_media(reduced_motion='reduce');card=open_task(info['managedId'],'available');assert page.locator('html').evaluate('(e)=>e.scrollWidth<=e.clientWidth+1');assert card.evaluate("e=>Array.from(e.querySelectorAll('*')).concat(e).every(n=>getComputedStyle(n).animationName==='none')");shot('actual-390-english-dark-reduced.png',card);close()
  page.get_by_role('button',name='Switch to Chinese',exact=True).click();card=open_task(info['managedId'],'available');expect(card).to_contain_text('已保存目标');expect(card).to_contain_text('验收条件');shot('actual-390-chinese-dark-reduced.png',card);card.locator('summary').focus();page.keyboard.press('Enter');expect(card).to_contain_text('这些是验收要求，不代表文件已生成或验收已通过。');expect(card).to_contain_text('费用上限（估算）：US$5');shot('actual-390-chinese-details-reduced.png',card);close()
  page.get_by_role('button',name='切换为浅色模式',exact=True).click();card=open_task(info['managedId'],'available');shot('actual-390-chinese-light-reduced.png',card);assert card.evaluate("e=>Array.from(e.querySelectorAll('*')).concat(e).filter(n=>n.getClientRects().length&&n.textContent.trim()).every(n=>parseFloat(getComputedStyle(n).fontSize)>=14)");close();checks.append('actual normal-motion screenshots wait for real finite animations and stable boxes; keyboard details, normal 14px type, English/Chinese, light/dark and 390px reduced-motion views')
  card=open_task(info['ordinaryId'],'not_captured');expect(card).to_have_text('暂无可显示的验收条件。');shot('actual-ordinary-chinese.png',card);close()
  phase='actual_missing_route';missing=control('hide_route');assert missing['availability']=='unavailable'and missing['allTablesUnchanged']and missing['totalChangesUnchanged'];card=open_task(info['managedId'],'unavailable');expect(card).to_have_text('任务约定暂不可用。');assert info['objective']not in card.inner_text();shot('actual-missing-route-unavailable.png',card);close();restored=control('restore_route');assert restored['availability']=='available'and restored['allTablesUnchanged']and restored['totalChangesUnchanged'];card=open_task(info['managedId'],'available');shot('actual-route-restored.png',card);close();checks.append('real ordinary task not_captured and real removed-route/restored-route GET states; no missing route created by observation and no stale objective fallback')
  page.set_viewport_size({'width':1440,'height':1100});page.emulate_media(reduced_motion='no-preference');page.get_by_role('button',name='切换为英文',exact=True).click();target='**/entry-workspace/task/'+info['managedId'];fault={'mode':'schema'}
  def inject(route):
   if fault['mode']=='503':route.fulfill(status=503,json={'code':'operator_workspace_unavailable','error':'SECRET_RAW_FAULT'});return
   response=route.fetch();body=response.json();body['contractView']['scope']='SECRET_BAD_SCOPE';body['contractView']['objective']='SECRET_OLD_OBJECTIVE';route.fulfill(response=response,json=body)
  phase='injected_bad_schema';page.route(target,inject);card=open_task(info['managedId'],'unavailable');expect(card).to_have_text('The saved task agreement is unavailable.');assert 'SECRET'not in card.inner_text();shot('injected-bad-schema.png',card);close()
  phase='injected_503';fault['mode']='503'
  with page.expect_response(lambda response: urlparse(response.url).path.endswith('/entry-workspace/task/'+info['managedId']) and response.status==503):page.locator('[id='+json.dumps('work-'+info['managedId'])+']').click()
  expect(page.locator('[id='+json.dumps('work-'+info['managedId'])+']')).to_be_enabled();expect(page.locator('#operator-task')).to_have_count(0);expect(page.locator('.task-contract-card:visible')).to_have_count(0);page.unroute(target,inject);card=open_task(info['managedId'],'available');shot('actual-after-read-recovery.png',card);close();checks.append('separate browser-only malformed DTO and 503 injections never show injected strings or a previous goal; normal protected GET recovers')
  phase='injected_late_after_navigation';page.evaluate("""taskId=>{const original=window.fetch.bind(window);window.fetch=async(...args)=>{const r=await original(...args),url=typeof args[0]==='string'?args[0]:args[0].url;if(url.endsWith('/entry-workspace/task/'+taskId)&&!window.__taskContractHeld){await r.clone().text();window.__taskContractHeld=true;return new Promise(resolve=>{window.__taskContractRelease=async()=>{resolve(r);await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))}})}return r}}""",info['managedId']);page.locator('[id='+json.dumps('work-'+info['managedId'])+']').click();page.evaluate("""async()=>{const deadline=performance.now()+10000;while(typeof window.__taskContractRelease!=='function'){if(performance.now()>deadline)throw Error('held_response_timeout');await new Promise(resolve=>requestAnimationFrame(resolve))}}""");phase='injected_late_navigate';page.locator('#function-navigation').get_by_role('link',name='Conversations',exact=True).click();expect(page.get_by_label('Message Router',exact=True)).to_be_visible();phase='injected_late_release';page.evaluate('async()=>{await window.__taskContractRelease()}');expect(page.locator('.task-contract-card:visible')).to_have_count(0);checks.append('separate delayed consumer response after leaving the task surface cannot display the old goal; no new workspace/server support claimed')
  final=control('observe');assert final['modelCalls']==0 and final['allTablesUnchanged']and final['totalChangesUnchanged'];assert not errors and not external and not writes
  report={'result':'passed','mode':info['mode'],'normalTaskResponsesMocked':False,'faultStages':['malformed contract DTO','503','late consumer after navigation'],'checks':checks,'pageErrorCount':len(errors),'modelCalls':final['modelCalls'],'externalRequestCount':len(external),'actionWrites':writes,'screenshots':[str(x)for x in sorted(out.glob('*.png'))],'runtimeEvidence':'runtime-evidence.json','realProviders':False}
 except Exception as failure:
  try:page.screenshot(path=str(out/'failure.png'),full_page=True)
  except Exception:pass
  report={'result':'failed','code':'task_contract_browser_failed','phase':phase,'failureType':type(failure).__name__,'checks':checks,'pageErrorCount':len(errors),'screenshots':[str(x)for x in sorted(out.glob('*.png'))],'realProviders':False}
  try:report['diagnostics']={'conversationLinkCount':page.get_by_role('link',name='Conversations',exact=True).count(),'heldResponseInstalled':page.evaluate("typeof window.__taskContractRelease==='function'"),'path':urlparse(page.url).path}
  except Exception:pass
 finally:
  (root/'browser-report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report));browser.close()
if report.get('result')!='passed':sys.exit(1)
