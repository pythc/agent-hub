"""Real normal GET acceptance; separate, explicitly labelled browser fault injections."""
import json,os,sys,time,uuid
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright,expect
root=Path(sys.argv[1]);info=json.loads((root/'browser.json').read_text());out=root/'screenshots';out.mkdir(exist_ok=True);checks=[];errors=[];methods=[];external=[];report={};phase='startup'
def control(action):
 command=str(uuid.uuid4());temp=root/'control-next.json';temp.write_text(json.dumps({'id':command,'action':action}));temp.replace(root/'control.json');deadline=time.monotonic()+20
 while True:
  if (root/'control-failed.json').exists():raise AssertionError('local_fixture_control_failed')
  if (root/'control-result.json').exists():
   result=json.loads((root/'control-result.json').read_text())
   if result.get('id')==command:return result
  assert time.monotonic()<deadline,'local_fixture_control_timeout';time.sleep(.05)
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path=os.environ.get('CHROMIUM_EXECUTABLE','/usr/bin/chromium'),args=['--no-sandbox','--no-zygote','--disable-background-networking'])
 context=browser.new_context(viewport={'width':1440,'height':1100});name,value=info['cookie'].split('=',1);context.add_cookies([{'name':name,'value':value,'url':info['base']}]);page=context.new_page();page.on('pageerror',lambda error:errors.append(str(error)))
 def observe_request(request):
  if urlparse(request.url).path.endswith('/api/resource-usage'):methods.append(request.method)
  if request.url.startswith(('http:','https:')) and not request.url.startswith(info['base']+'/'):external.append(True)
 page.on('request',observe_request)
 def shot(name):page.wait_for_timeout(180);page.screenshot(path=str(out/name),full_page=True)
 try:
  phase='normal_bootstrap';page.goto(info['url']);panel=page.locator('#team-resource-usage');expect(panel).to_have_attribute('data-state','ready');expect(panel).to_contain_text('No data');expect(panel).to_contain_text('1 of 2 calls supplied usage; 1 incomplete.')
  expect(panel.locator('.resource-note')).to_have_text('Usage may be incomplete. This is not a bill or remaining quota.');assert not panel.locator('details').evaluate('(e)=>e.open');assert panel.evaluate("e=>Array.from(e.querySelectorAll('*')).filter(n=>n.getClientRects().length&&n.textContent.trim()).every(n=>parseFloat(getComputedStyle(n).fontSize)>=14)")
  actual=context.request.get(info['base']+'/api/resource-usage').json();assert actual['usage']['tokens']['totalTokens'] is None and actual['usage']['unknownCalls']==1 and actual['usage']['partialCalls']==1;settings_revision=actual['settingsRevision'];shot('resource-real-initial-null-partial-light.png');checks.append('normal actual protected Runtime GET: synthetic local unknown and partial telemetry, null total shown as unreported; no response mocking')
  before=control('observe');page.wait_for_timeout(6100);after=control('observe');assert after['resourceRequests']==before['resourceRequests'];assert after['summaryCallsBeforeObservation']==before['summaryCallsAfterObservation'];assert after['resourceRecordsStableDuringObservation'] and after['resourceRecordsStableSincePreviousObservation'];checks.append('scheduler five-second interval causes no resource GET or hidden usage.summary call; relevant usage/context/work records stay stable')
  appended=control('append');assert appended['snapshot']['settingsRevision']==settings_revision and appended['snapshot']['usage']['tokens']['totalTokens']==125
  expect(panel).to_contain_text('No data');panel.get_by_role('button',name='Refresh usage',exact=True).click();expect(panel).to_contain_text('2 of 3 calls supplied usage; 1 incomplete.');expect(panel.locator('.resource-metrics dd')).to_have_text('125');saved_time=panel.locator('time').inner_text();shot('resource-real-appended-same-revision-light.png');checks.append('real UsageLedger begin/record/finish append updates total only after manual refresh, with unchanged settings revision and remaining reporting gaps')
  panel.locator('summary').focus();page.keyboard.press('Enter');expect(panel.locator('details')).to_have_attribute('open','');expect(panel).to_contain_text('do not show free capacity');expect(panel).to_contain_text('Overdue work may still be running.');shot('resource-real-keyboard-details-light.png');page.keyboard.press('Enter')
  observed=control('observer_unavailable');assert observed['snapshot']['usage']['watchdogUnavailable'];panel.get_by_role('button',name='Refresh usage',exact=True).click();expect(panel).to_contain_text('Background usage is unavailable.');shot('resource-real-observer-unavailable-light.png');checks.append('real loopback fixture with intentionally unreadable local observer database reports observer unavailability without losing host counts; keyboard opens retained-check/limit details')
  data=context.request.get(info['base']+'/api/resource-usage').json();fault={'mode':'503'}
  def inject(route):
   if fault['mode']=='503':route.fulfill(status=503,json={'code':'resource_usage_unavailable','error':'SECRET_RAW_FAULT'});return
   bad=json.loads(json.dumps(data));bad['usage']['tokens']['totalTokens']=-1;route.fulfill(json=bad)
  page.route('**/api/resource-usage',inject);saved_time=panel.locator('time').inner_text();panel.get_by_role('button',name='Refresh usage',exact=True).click();expect(panel).to_have_attribute('data-state','stale');expect(panel.locator('.resource-metrics dd')).to_have_text('125');assert panel.locator('time').inner_text()==saved_time;assert 'SECRET' not in panel.inner_text();shot('resource-injected-503-retains-dated-record.png')
  fault['mode']='bad-schema';panel.get_by_role('button',name='Refresh usage',exact=True).click();expect(panel.get_by_role('button',name='Refresh usage',exact=True)).to_be_enabled();expect(panel.locator('.resource-metrics dd')).to_have_text('125');page.unroute('**/api/resource-usage',inject);panel.get_by_role('button',name='Refresh usage',exact=True).click();expect(panel).to_have_attribute('data-state','ready');checks.append('labelled browser-only fault injections: fixed 503 and malformed DTO retain the dated snapshot and never reveal injected error text')
  page.get_by_role('button',name='Switch to dark mode',exact=True).click();shot('resource-real-dark.png');page.emulate_media(reduced_motion='reduce');page.set_viewport_size({'width':390,'height':1100});panel.scroll_into_view_if_needed();assert page.locator('html').evaluate('(e)=>e.scrollWidth<=e.clientWidth+1');assert panel.evaluate("e=>Array.from(e.querySelectorAll('*')).concat(e).every(n=>getComputedStyle(n).animationName==='none')");panel.get_by_role('button',name='Refresh usage',exact=True).focus();page.keyboard.press('Tab');expect(panel.locator('summary')).to_be_focused();shot('resource-real-390-keyboard-reduced.png');panel.screenshot(path=str(out/'resource-card-390-english-dark-reduced.png'));panel.locator('summary').focus();page.keyboard.press('Enter');expect(panel).to_contain_text('Overdue work may still be running.');page.keyboard.press('Enter')
  page.get_by_role('button',name='Switch to Chinese',exact=True).click();panel=page.locator('#team-resource-usage');expect(panel).to_contain_text('当前环境用量');expect(panel).to_contain_text('3 次调用中 2 次提供用量，1 次不完整。');expect(panel.locator('.resource-note')).to_have_text('用量可能不全，不是账单或剩余额度。');panel.scroll_into_view_if_needed();shot('resource-real-390-chinese-reduced.png');panel.screenshot(path=str(out/'resource-card-390-chinese-dark-reduced.png'));panel.locator('summary').focus();page.keyboard.press('Enter');expect(panel).to_contain_text('超过期限的工作也可能仍在继续');page.keyboard.press('Enter');page.get_by_role('button',name='切换为浅色模式',exact=True).click();panel.screenshot(path=str(out/'resource-card-390-chinese-light-reduced.png'));assert panel.evaluate("e=>Array.from(e.querySelectorAll('*')).filter(n=>n.getClientRects().length&&n.textContent.trim()).every(n=>parseFloat(getComputedStyle(n).fontSize)>=14)");assert page.locator('html').evaluate('(e)=>e.scrollWidth<=e.clientWidth+1');page.get_by_role('button',name='切换为英文',exact=True).click();expect(panel.locator('.resource-coverage')).to_have_text('2 of 3 calls supplied usage; 1 incomplete.');panel.screenshot(path=str(out/'resource-card-390-english-light-reduced.png'));page.get_by_role('button',name='Switch to Chinese',exact=True).click();checks.append('real light/dark, readable typography, 390px layout, keyboard details and Chinese reduced-motion rendering')
  # Entire following identity stage is an explicit optional-host simulation. It is
  # not a second Runtime, real tenant boundary, provider usage, or normal GET proof.
  page.set_viewport_size({'width':1440,'height':1100});page.emulate_media(reduced_motion='no-preference');page.get_by_role('button',name='切换为英文',exact=True).click()
  def identity_payload(total):
   payload=json.loads(json.dumps(data));tokens={'inputTokens':total,'cachedInputTokens':None,'cacheWriteInputTokens':None,'outputTokens':0,'reasoningOutputTokens':None,'totalTokens':total};counts={'calls':1,'reportedCalls':1,'unknownCalls':0,'partialCalls':0,'steps':1}
   payload['usage'].update(counts);payload['usage']['tokens']=tokens;payload['usage']['fieldReported']={key:(1 if key in ['inputTokens','outputTokens','totalTokens'] else 0) for key in tokens};payload['usage']['groups']=[{'purpose':'worker',**counts,'tokens':tokens}];return payload
  page.route('**/workspaces',lambda route:route.fulfill(json={'version':1,'currentId':'studio','items':[{'id':'studio','name':'Workspace A','kind':'organization'},{'id':'other','name':'Workspace B','kind':'organization'}]}))
  def scoped(route):
   path=urlparse(route.request.url).path;parts=path.split('/',3);workspace=parts[2];target='/'+parts[3]
   assert route.request.method=='GET','identity_fixture_must_not_forward_writes'
   if target=='/api/resource-usage':route.fulfill(json=identity_payload(456 if workspace=='other' else 125));return
   response=route.fetch(url=info['base']+target);route.fulfill(response=response)
  phase='injected_workspace_bootstrap';page.route('**/workspaces/*/**',scoped);page.goto(info['base']+'/configure#execution/configuration');page.reload();panel=page.locator('#team-resource-usage');expect(panel).to_have_attribute('data-state','ready')
  # Delay only the consumer promise after the mock network reply has completed.
  # This avoids holding Playwright's route dispatcher and deliberately ignores
  # abort, so the real page/legacy epoch fences must discard the late result.
  phase='hold_original_workspace_read';page.evaluate("""stale=>{const original=window.fetch.bind(window);let next=true;window.fetch=async(...args)=>{const result=await original(...args);const url=typeof args[0]==='string'?args[0]:args[0].url;if(next&&url.endsWith('/workspaces/studio/api/resource-usage')){next=false;return new Promise(resolve=>{window.__resourceUsageRelease=()=>resolve(new Response(JSON.stringify(stale),{status:200,headers:{'content-type':'application/json'}}))})}return result}}""",identity_payload(999))
  panel.get_by_role('button',name='Refresh usage',exact=True).click();page.wait_for_function("typeof window.__resourceUsageRelease==='function'")
  phase='open_workspace_picker';page.evaluate("location.hash='tasks'");page.get_by_role('button',name='Configure team',exact=True).wait_for();page.get_by_role('link',name='Current workspace',exact=True).click();phase='select_other_workspace';page.get_by_role('dialog',name='Switch workspace').get_by_role('button',name='Workspace B Organization',exact=True).click()
  phase='open_team_after_switch';page.get_by_role('link',name='Agent team',exact=True).click();panel=page.locator('#team-resource-usage');expect(panel.locator('.resource-metrics dd')).to_have_text('456')
  phase='release_old_workspace_response';page.evaluate('window.__resourceUsageRelease()');page.wait_for_timeout(300);expect(panel.locator('.resource-metrics dd')).to_have_text('456');shot('resource-injected-late-workspace-response-ignored.png');checks.append('labelled optional-workspace browser simulation: delayed A response released after switching to B cannot replace B display; no real multiworkspace support claimed')
  final=control('observe');assert final['modelCalls']==0;assert all(method=='GET' for method in methods);assert not external;assert not errors
  report={'result':'passed','mode':info['mode'],'normalResourceResponsesMocked':False,'faultStages':['503','malformed DTO','optional workspace identity and held response'],'checks':checks,'pageErrorCount':len(errors),'modelCalls':final['modelCalls'],'externalRequestCount':len(external),'resourceMethods':methods,'screenshots':[str(path) for path in sorted(out.glob('*.png'))],'runtimeEvidence':'runtime-evidence.json','realProviders':False}
 except Exception as failure:
  try:shot('failure.png')
  except Exception:pass
  report={'result':'failed','code':'resource_usage_browser_failed','phase':phase,'failureType':type(failure).__name__,'checks':checks,'pageErrorCount':len(errors),'screenshots':[str(path) for path in sorted(out.glob('*.png'))],'realProviders':False}
 finally:
  (root/'browser-report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report));browser.close()
if report.get('result')!='passed':sys.exit(1)
