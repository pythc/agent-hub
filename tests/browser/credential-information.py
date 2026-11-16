"""Actual protected presence/wizard checks; browser-only faults/contexts are separate."""
import json,os,sys,time,uuid
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright,expect
root=Path(sys.argv[1]);info=json.loads((root/'browser.json').read_text());out=root/'screenshots';out.mkdir(exist_ok=True);checks=[];errors=[];requests=[];simulations=[]
def control(action):
 ident=str(uuid.uuid4());temp=root/'control-next.json';temp.write_text(json.dumps({'id':ident,'action':action}));temp.replace(root/'control.json');deadline=time.monotonic()+15
 while True:
  assert not (root/'control-failed.json').exists(),'Local fixture control failed'
  if (root/'control-result.json').exists():
   value=json.loads((root/'control-result.json').read_text())
   if value.get('id')==ident:return value
  assert time.monotonic()<deadline,'Fixture control timeout';time.sleep(.05)
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path=os.environ['CHROMIUM_EXECUTABLE'],args=['--no-sandbox','--no-zygote'])
 def context():
  value=browser.new_context(viewport={'width':1440,'height':1100});name,cookie=info['cookie'].split('=',1);value.add_cookies([{'name':name,'value':cookie,'url':info['base']}]);return value
 def page_for(ctx):
  value=ctx.new_page();value.set_default_timeout(15000);value.on('pageerror',lambda error:errors.append(str(error)));value.on('request',lambda request:requests.append({'method':request.method,'path':urlparse(request.url).path,'level':request.post_data_json.get('level') if request.method=='POST' and '/api/connectors/probe' in request.url else None}) if '/api/credential-references' in request.url or '/api/connectors' in request.url or '/api/plugin-market/connection/apply' in request.url else None);return value
 ctx=context();page=page_for(ctx)
 def shot(name):page.wait_for_timeout(150);page.screenshot(path=str(out/name),full_page=True)
 def card(id):return page.locator('.connector-card[data-source-id="'+id+'"]')
 def row(kind,id):return page.locator('.connector-information[data-information-kind="'+kind+'"][data-information-id="'+id+'"]')
 def refresh():page.get_by_role('button',name='Refresh',exact=True).click()
 def safe():
  text=page.locator('.connector-page').inner_text()
  for value in ['O18_BROWSER_FOUND','O18_BROWSER_MISSING','SYNTHETIC_LOCAL_ONLY_NO_PROVIDER_TOKEN','SYNTHETIC_RAW_ERROR','raw-stderr','process_environment','Local references','Not declared']:
   assert value not in text,value
 def no_effects(stats):
  assert all(stats['calls'][key]==0 for key in ['models','identity','members','sends','events','toolCatalog','toolCalls']),stats['calls'];assert stats['workerGrants']==0
 try:
  assert browser.new_context().request.get(info['base']+'/api/credential-references').status==401
  page.goto(info['url']);expect(card('app-present')).to_be_visible();expect(row('source','app-present')).to_have_attribute('data-information-state','present')
  actual=ctx.request.get(info['base']+'/api/credential-references');assert actual.status==200;data=actual.json()
  expected={'app-present':'present','app-missing':'missing','app-unknown':'unknown','app-empty':'not_declared'}
  assert {key:next(item['state'] for item in data['connections'] if item['kind']=='source' and item['id']==key) for key in expected}==expected
  for key,state in expected.items():expect(row('source',key)).to_have_attribute('data-information-state',state)
  assert page.locator('.connector-credential-records').count()==0;safe();shot('actual-source-information-light.png')
  page.locator('.connector-tools>summary').click()
  for suffix,state in [('present','present'),('missing','missing'),('unknown','unknown'),('empty','not_declared')]:expect(row('tool','tool-'+suffix)).to_have_attribute('data-information-state',state)
  row('tool','tool-empty').scroll_into_view_if_needed();shot('actual-tools-four-states-light.png');stats=control('stats');no_effects(stats)
  checks.append({'kind':'actual-runtime','result':'passed','check':'protected GET and four actual configured source/tool presence states, no field/env/slot/raw-error display, no authentication/provider/tool calls','settingsRevision':stats['settingsRevision']})
  card('app-present').locator('[data-layer="configuration"] button').click();expect(card('app-present').locator('[data-layer="configuration"]')).to_have_attribute('data-state','passed')
  assert control('stats')['calls']['localValidations']>0
  page.get_by_role('button',name='Add connection',exact=True).click();dialog=page.get_by_role('dialog');dialog.get_by_label('Installed app').select_option(info['fixtureKind']);dialog.get_by_role('button',name='Continue',exact=True).click()
  dialog.get_by_label('Connection name',exact=True).fill('Saved local information test');dialog.get_by_label('Room IDs *',exact=False).fill('synthetic-room');dialog.get_by_label('App secret *',exact=False).fill('SYNTHETIC_WIZARD_SECRET')
  dialog.get_by_role('button',name='Review settings',exact=True).click();expect(dialog.locator('.connector-review')).to_be_visible();expect(dialog.get_by_role('button',name='Save connection',exact=True)).to_be_enabled();assert 'SYNTHETIC_WIZARD_SECRET' not in dialog.inner_text();shot('actual-disabled-save-review.png')
  dialog.get_by_role('button',name='Save connection',exact=True).click();expect(dialog).not_to_be_visible(timeout=25000);created=page.locator('.connector-card').filter(has_text='Saved local information test');expect(created).to_contain_text('Disabled');expect(created.locator('.connector-information')).to_have_attribute('data-information-state','present')
  stats=control('stats');saved=[source for source in stats['savedSources'] if source.get('label')=='Saved local information test'];assert len(saved)==1 and saved[0]['enabled']==False and saved[0]['allowedActorCount']==0;no_effects(stats)
  checks.append({'kind':'actual-runtime','result':'passed','check':'existing local configuration check still works; original onboarding validate/plan/apply saves an empty-actor disabled source, without grants/authentication/send'})
  before=control('stats');changed=control('missing');assert changed['settingsRevision']==before['settingsRevision'];assert changed['sourceStates']['app-present']=='missing';refresh();expect(row('source','app-present')).to_have_attribute('data-information-state','missing');expect(row('tool','tool-present')).to_have_attribute('data-information-state','missing');card('app-present').scroll_into_view_if_needed();shot('actual-same-revision-environment-change.png')
  restored=control('restore');assert restored['settingsRevision']==before['settingsRevision'];refresh();expect(row('source','app-present')).to_have_attribute('data-information-state','present');no_effects(control('stats'))
  checks.append({'kind':'actual-runtime','result':'passed','check':'fixture changes only synthetic environment presence; actual GET and existing Refresh update source/tool status at unchanged settings revision','settingsRevision':before['settingsRevision']})
  endpoint='**/api/credential-references'
  def failure(route):route.fulfill(status=503,json={'code':'credential_references_unavailable','error':'SYNTHETIC_RAW_ERROR raw-stderr'})
  page.route(endpoint,failure);refresh();expect(row('source','app-present')).to_have_attribute('data-information-state','stale');expect(row('source','app-present')).to_contain_text('Earlier record');expect(page.locator('.connector-information-note time')).to_be_visible();expect(page.get_by_role('button',name='Add connection',exact=True)).to_be_enabled();expect(card('app-present').locator('[data-layer="configuration"] button')).to_be_enabled();safe();shot('browser-only-information-503-earlier.png');page.unroute(endpoint,failure)
  def denied(route):route.fulfill(status=403,json={'code':'workspace_unavailable','error':'SYNTHETIC_RAW_ERROR'})
  page.route(endpoint,denied);refresh();expect(row('source','app-present')).to_have_attribute('data-information-state','failed');expect(page.locator('.connector-information-note time')).to_have_count(0);expect(card('app-present')).to_contain_text('Information check unavailable');safe();shot('browser-only-information-403-cleared.png');page.unroute(endpoint,denied)
  def malformed(route):route.fulfill(status=200,json={'schema':2,'scope':'host','settingsRevision':before['settingsRevision'],'observedAt':1000,'connections':[],'environment':'SYNTHETIC_RAW_ERROR'})
  page.route(endpoint,malformed);refresh();expect(row('source','app-present')).to_have_attribute('data-information-state','failed');expect(page.get_by_role('button',name='Add connection',exact=True)).to_be_enabled();safe();shot('browser-only-invalid-dto.png');page.unroute(endpoint,malformed);refresh();expect(row('source','app-present')).to_have_attribute('data-information-state','present')
  simulations.append('Browser-only credential GET 503 retains explicitly earlier timestamped values; 403 clears them; unsupported DTO stays local/unavailable; existing connector buttons remain enabled and real GET recovers')
  checks.append({'kind':'browser-response-simulation','result':'passed','check':simulations[-1]})
  page.get_by_role('button',name='Add connection',exact=True).click();dialog=page.get_by_role('dialog');dialog.press('Escape');expect(dialog).not_to_be_visible();expect(page.get_by_role('button',name='Add connection',exact=True)).to_be_focused();shot('actual-keyboard-focus-restored.png')
  page.get_by_role('button',name='Switch to Chinese',exact=True).click();expect(page.locator('#connector-title')).to_have_text('连接器');expect(row('source','app-present')).to_contain_text('已在当前环境找到');expect(row('source','app-missing')).to_contain_text('缺少部分资料');expect(row('source','app-unknown')).to_contain_text('暂无法检查');expect(row('source','app-empty')).to_contain_text('暂无可检查项');card('app-present').scroll_into_view_if_needed();shot('actual-chinese-light.png')
  page.get_by_role('button',name='切换为深色模式',exact=True).click();shot('actual-chinese-dark.png')
  page.emulate_media(reduced_motion='reduce');page.set_viewport_size({'width':390,'height':1000});card('app-present').scroll_into_view_if_needed();shot('actual-chinese-dark-390-reduced.png');row('tool','tool-empty').scroll_into_view_if_needed();shot('actual-chinese-tools-390-reduced.png')
  assert page.locator('html').evaluate('(e)=>e.scrollWidth<=e.clientWidth+1')
  assert page.locator('.connector-page').evaluate("e=>Array.from(e.querySelectorAll('*')).filter(n=>n.getClientRects().length&&n.textContent.trim()).every(n=>parseFloat(getComputedStyle(n).fontSize)>=14)")
  assert page.locator('.connector-page').evaluate("e=>Array.from(e.querySelectorAll('*')).every(n=>getComputedStyle(n).animationName==='none'||parseFloat(getComputedStyle(n).animationDuration)<=.001)")
  page.get_by_role('button',name='切换为浅色模式',exact=True).click();card('app-present').scroll_into_view_if_needed();shot('actual-chinese-light-390-reduced.png');safe()
  checks.append({'kind':'actual-rendering','result':'passed','check':'Chinese light/dark at desktop and 390px, four human-readable states, keyboard Escape/focus restoration, 14px minimum, no horizontal overflow and reduced motion'})
  # This proxy is explicitly synthetic; there is still only one real Runtime.
  optional=context();other=page_for(optional);scoped=[];held=[];served=[];cancelled=[]
  inventory={'version':1,'currentId':'studio','canCreate':False,'items':[{'id':'studio','name':'Studio fixture','kind':'organization'},{'id':'other','name':'Other fixture','kind':'organization'}]}
  def proxy(route):
   path=urlparse(route.request.url).path
   if path=='/workspaces':route.fulfill(status=200,json=inventory);return
   for selected in ['studio','other']:
    prefix='/workspaces/'+selected
    if path.startswith(prefix+'/'):
     response=route.fetch(url=info['base']+path[len(prefix):]);body=response.json()
     if path.endswith('/api/credential-references'):
      if selected=='studio' and not held:held.append((route,response,body));return
      for item in body['connections']:
       if item['kind']=='source' and item['id']=='app-present':item['state']='unknown';item['references']=[{'slot':0,'purpose':'authentication','state':'unknown'}]
      served.append(selected)
     route.fulfill(response=response,json=body);return
   route.fulfill(status=404,json={'code':'workspace_unavailable'})
  other.on('requestfailed',lambda request:cancelled.append(True) if urlparse(request.url).path=='/workspaces/studio/api/credential-references' else None)
  other.route('**/workspaces**',proxy);other.on('request',lambda request:scoped.append(urlparse(request.url).path));other.goto(info['base']+'/configure?workspace=studio#connectors');expect(other.locator('.connector-card').first).to_be_visible()
  deadline=time.monotonic()+10
  while not held:assert time.monotonic()<deadline,'Old credential read was not held';other.wait_for_timeout(30)
  def switch(name,expected):
   other.get_by_role('link',name='Current workspace',exact=True).click();other.locator('#workspace-picker').get_by_role('button').filter(has_text=name).click();other.wait_for_url('**workspace='+expected+'*');other.evaluate("location.hash='connectors'");expect(other.locator('.connector-information[data-information-kind="source"][data-information-id="app-present"]')).to_have_attribute('data-information-state','unknown')
  switch('Other fixture','other');switch('Studio fixture','studio')
  old_route,response,body=held[0]
  late='attempted_late_response'
  try:old_route.fulfill(response=response,json=body)
  except Exception:
   other.wait_for_timeout(50);assert cancelled,'Old route failed without an observed cancelled read';late='read_cancelled_before_late_response'
  other.wait_for_timeout(150);expect(other.locator('.connector-information[data-information-kind="source"][data-information-id="app-present"]')).to_have_attribute('data-information-state','unknown')
  assert not any(path.startswith('/api/credential-references') or path.startswith('/api/connectors') for path in scoped)
  assert '/workspaces/other/api/credential-references' in scoped and '/workspaces/studio/api/credential-references' in scoped
  other.screenshot(path=str(out/'browser-only-late-workspace-context.png'),full_page=True);optional.close()
  simulations.append('Browser-only optional-workspace proxy over one Runtime: A→B→A uses scoped GET paths; held old presence cannot replace the newer unknown observation. This is not real multiworkspace/account isolation.')
  checks.append({'kind':'browser-context-simulation','result':'passed','check':simulations[-1],'lateRead':late,'cancelledOldReadObserved':bool(cancelled)})
  stats=control('stats');no_effects(stats);assert not errors,errors
  allowed={'/api/connectors/probe','/api/connectors/validate','/api/connectors/plan','/api/plugin-market/connection/apply'}
  for request in requests:
   if request['method']!='GET':assert request['path'] in allowed,request
   if request['path']=='/api/connectors/probe':assert request['level']=='configuration',request
  report={'result':'passed','implementationCommit':os.environ.get('ACCEPTANCE_IMPLEMENTATION_COMMIT'),'mode':info['mode'],'checks':checks,'simulations':simulations,'pageErrorCount':len(errors),'pageErrors':errors,'realProviders':False,'runtimeEvidence':stats,'requests':requests,'screenshots':[str(path) for path in sorted(out.glob('*.png'))]}
  (root/'browser-report.json').write_text(json.dumps(report,indent=2,ensure_ascii=False));print(json.dumps({'result':'passed','groups':len(checks),'screenshots':len(report['screenshots']),'pageErrorCount':len(errors)}))
 except Exception:
  shot('failure.png');raise
 finally:browser.close()
