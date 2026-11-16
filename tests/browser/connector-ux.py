"""Actual plugin setup/diagnostics locally; real IM permissions remain unverified."""
import json,os,sys,time,uuid
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright,expect
root=Path(sys.argv[1]);info=json.loads((root/'browser.json').read_text());out=root/'screenshots';out.mkdir(exist_ok=True);checks=[];errors=[];requests=[]
def control(action):
 request_id=str(uuid.uuid4());temp=root/'control-next.json';temp.write_text(json.dumps({'id':request_id,'action':action}));temp.replace(root/'control.json');deadline=time.monotonic()+25
 while True:
  if (root/'control-failed.json').exists():raise AssertionError('Local fixture control failed')
  if (root/'control-result.json').exists():
   value=json.loads((root/'control-result.json').read_text())
   if value.get('id')==request_id:assert value['result']=='ok';return value
  assert time.monotonic()<deadline,'Fixture control deadline';time.sleep(.05)
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path=os.environ['CHROMIUM_EXECUTABLE'],args=['--no-sandbox','--no-zygote']);context=browser.new_context(viewport={'width':1440,'height':1100})
 name,value=info['cookie'].split('=',1);context.add_cookies([{'name':name,'value':value,'url':info['base']}]);page=context.new_page();page.on('pageerror',lambda error:errors.append(str(error)))
 page.on('request',lambda request:requests.append({'method':request.method,'path':urlparse(request.url).path}) if '/api/connectors' in request.url or '/api/plugin-market/connection/apply' in request.url else None)
 def shot(name):page.wait_for_timeout(350);page.screenshot(path=str(out/name),full_page=True)
 def card():return page.locator('.connector-card[data-source-id="'+info['fixtureSourceId']+'"]')
 def check(layer):card().locator('[data-layer="'+layer+'"]').get_by_role('button').click()
 def assert_messages_unverified():expect(card().locator('[data-layer="messages"]')).to_have_attribute('data-state','not_tested');expect(card().locator('[data-layer="messages"]')).to_contain_text('Not verified')
 try:
  page.goto(info['url']);expect(card()).to_be_visible();expect(card()).to_contain_text('Local IM test / 本地 IM 测试');expect(card()).to_contain_text('Disabled')
  assert not card().locator('.connector-records').evaluate('(e)=>e.open')
  assert card().locator('[data-layer="authentication"] button').is_disabled();assert card().locator('[data-layer="reachable"] button').is_disabled()
  check('configuration');expect(card().locator('[data-layer="configuration"]')).to_have_attribute('data-state','passed');expect(card()).to_contain_text('Fields valid');assert_messages_unverified()
  baseline=control('stats');assert baseline['calls']['identities']==0 and baseline['calls']['heads']==0 and baseline['calls']['directories']==0
  shot('connectors-disabled-local-settings-light.png');checks.append('actual disabled local plugin permits only local settings check; no service/identity/directory call occurs; message and channel access remain unverified')
  card().get_by_role('button',name='Enable connection',exact=True).click();expect(card()).to_contain_text('Enabled')
  for layer in ['configuration','reachable','authentication','capabilities']:
   check(layer);expect(card().locator('[data-layer="'+layer+'"]')).to_have_attribute('data-state','passed');assert_messages_unverified()
  stats=control('stats');assert stats['calls']['heads']>=1 and stats['calls']['identities']>=1 and stats['calls']['directories']>=1 and stats['calls']['sends']==0 and stats['calls']['events']==0 and stats['calls']['models']==0
  assert page.locator('.connector-page').evaluate("e=>Array.from(e.querySelectorAll('*')).filter(n=>n.getClientRects().length&&n.textContent.trim()).every(n=>parseFloat(getComputedStyle(n).fontSize)>=14)")
  shot('connectors-local-layer-checks-light.png');checks.append('explicit enable and real loopback HEAD plus simulated identity/member methods through actual protected probe service; four layers separate; no real IM platform, send or Worker grant')
  for mode in ['failed','limited']:
   control(mode);check('authentication');expect(card().locator('[data-layer="authentication"]')).to_have_attribute('data-state','failed');assert 'secret-token' not in page.locator('body').inner_text();assert 'raw-stderr' not in page.locator('body').inner_text()
  shot('connectors-simulated-auth-failure-light.png')
  held=control('held');check('authentication');expect(card().locator('[data-layer="authentication"] button')).to_be_disabled()
  deadline=time.monotonic()+5
  while control('stats')['calls']['heldIdentities']<=held['calls']['heldIdentities']:
   assert time.monotonic()<deadline,'Held identity method never started';time.sleep(.02)
  control('bump_and_release');expect(card().locator('[data-layer="authentication"]')).to_have_attribute('data-state','stale');expect(card()).to_contain_text('Check again')
  control('normal');check('authentication');expect(card().locator('[data-layer="authentication"]')).to_have_attribute('data-state','passed');assert_messages_unverified();checks.append('simulated read-only authentication failures/rate limit expose fixed text; actual revision change fences a held late probe; explicit recheck recovers without replaying messages')
  card().get_by_role('button',name='Disable connection',exact=True).click();expect(card()).to_contain_text('Disabled');expect(page.locator('.connector-page')).to_contain_text('earlier actions are not undone');assert card().locator('[data-layer="authentication"] button').is_disabled()
  page.get_by_role('button',name='Add connection',exact=True).click();dialog=page.get_by_role('dialog');dialog.get_by_label('Installed app').select_option(info['fixtureKind']);dialog.get_by_role('button',name='Continue',exact=True).click()
  actor=dialog.get_by_label('Who can request work (user IDs)',exact=False);secret=dialog.get_by_label('App secret *',exact=False);rooms=dialog.get_by_label('Room IDs *',exact=False)
  dialog.get_by_label('Connection name',exact=True).fill('Local UI connection');actor.fill('fixture-member');secret.fill('fixture-secret-cleared-on-mode-change')
  dialog.locator('.connector-advanced summary').click();environment=dialog.get_by_role('checkbox');environment.check();expect(secret).to_have_value('');expect(secret).to_have_attribute('type','text');secret.fill('IM_UX_TEST_TOKEN');environment.uncheck();expect(secret).to_have_value('');expect(secret).to_have_attribute('type','password')
  secret.fill('not-a-real-app-secret');rooms.fill('   ');dialog.get_by_role('button',name='Review settings',exact=True).click();expect(dialog.get_by_role('alert')).to_be_visible();expect(dialog).to_contain_text('Check the required fields');assert 'not-a-real-app-secret' not in dialog.inner_text()
  rooms.fill('fixture-new-room');dialog.get_by_role('button',name='Review settings',exact=True).click();expect(dialog.locator('.connector-review')).to_be_visible();expect(dialog.get_by_role('button',name='Save connection',exact=True)).to_be_enabled();expect(dialog).to_contain_text('leaves this connection disabled');expect(dialog).to_contain_text('does not test messages or grant Worker tools');assert 'not-a-real-app-secret' not in dialog.inner_text();dialog.get_by_role('button',name='Save connection',exact=True).hover();shot('connector-local-plan-review-light.png')
  dialog.get_by_role('button',name='Save connection',exact=True).click();expect(dialog).not_to_be_visible(timeout=20000);created=page.locator('.connector-card').filter(has_text='Local UI connection');expect(created).to_contain_text('Disabled');page.reload();expect(created).to_contain_text('Disabled')
  stats=control('stats');saved=[source for source in stats['sources'] if source.get('label')=='Local UI connection'];assert len(saved)==1 and saved[0]['enabled']==False and saved[0]['actors']==['fixture-member'];assert stats['workerToolConnections']==0
  checks.append('plugin-defined local wizard validates, plans and really applies via existing onboarding/restart; bad local fields recover; credential mode changes clear secrets; reload retains disabled source and exact actor allowlist without Worker grants')
  page.get_by_role('button',name='Add connection',exact=True).click();dialog=page.get_by_role('dialog');dialog.get_by_label('Installed app').select_option('feishu');dialog.get_by_role('button',name='Continue',exact=True).click()
  dialog.get_by_label('Connection name',exact=True).fill('Feishu setup only — not connected');dialog.get_by_label('Who can request work (user IDs)',exact=False).fill('ou_fixture_member');dialog.get_by_label('App ID *',exact=False).fill('cli_fixture_only');dialog.get_by_label('App secret *',exact=False).fill('not-a-real-feishu-secret');dialog.get_by_label('Chat IDs *',exact=False).fill('oc_fixture_only');shot('connector-builtin-feishu-fields-light.png')
  dialog.get_by_role('button',name='Review settings',exact=True).click();expect(dialog.locator('.connector-review')).to_be_visible();expect(dialog).to_contain_text('Disabled');shot('connector-builtin-feishu-plan-light.png');dialog.get_by_role('button',name='Save connection',exact=True).click();expect(dialog).not_to_be_visible(timeout=20000)
  feishu=page.locator('.connector-card').filter(has_text='Feishu setup only — not connected');expect(feishu).to_contain_text('Disabled');assert feishu.locator('[data-layer="authentication"] button').is_disabled();assert feishu.locator('[data-layer="reachable"] button').is_disabled()
  checks.append('actual installed Feishu definition fields pass local validate/plan/apply and persist disabled; no Feishu service check or real platform call is attempted')
  # Browser-only failures below are not normal-service success evidence.
  def fail(route):route.fulfill(status=503,json={'code':'internal_failure','error':'secret-token raw-stderr'})
  page.route('**/api/connectors',fail);page.get_by_role('button',name='Refresh',exact=True).click();expect(page.locator('.connector-page').get_by_role('alert')).to_be_visible();expect(created).to_contain_text('Disabled');assert 'secret-token' not in page.locator('body').inner_text();shot('connectors-browser-refresh-failure-light.png');page.unroute('**/api/connectors',fail);page.get_by_role('button',name='Refresh',exact=True).click();expect(page.locator('.connector-page').get_by_role('alert')).not_to_be_visible()
  def malformed(route):
   response=route.fetch();body=response.json();body['instances'][0]['layers']['authentication']={'level':'authentication','revision':body['revision'],'current':True,'status':'passed','code':'identity_verified','startedAt':1,'finishedAt':'bad-date','realCall':False,'evidenceMode':'fixture'};route.fulfill(response=response,json=body)
  page.route('**/api/connectors',malformed);page.get_by_role('button',name='Refresh',exact=True).click();expect(card().locator('[data-layer="authentication"]')).to_have_attribute('data-state','unknown');shot('connectors-browser-malformed-evidence-light.png');page.unroute('**/api/connectors',malformed);page.get_by_role('button',name='Refresh',exact=True).click()
  delayed=[];newer=[]
  def old_snapshot(route):
   response=route.fetch();body=response.json()
   if not delayed:delayed.append((route,response,body));return
   body['instances'][0]['label']='Latest local view';newer.append(True);route.fulfill(response=response,json=body)
  page.route('**/api/connectors',old_snapshot);page.evaluate("window.dispatchEvent(new Event('roppo:plugins-changed'))")
  page.wait_for_timeout(100);page.evaluate("window.dispatchEvent(new Event('roppo:plugins-changed'))");expect(page.locator('.connector-page')).to_contain_text('Latest local view')
  old_route,response,body=delayed[0];body['instances'][0]['label']='Obsolete local view';old_route.fulfill(response=response,json=body);page.wait_for_timeout(200);expect(page.locator('.connector-page')).not_to_contain_text('Obsolete local view');page.unroute('**/api/connectors',old_snapshot);page.get_by_role('button',name='Refresh',exact=True).click();expect(card()).to_be_visible()
  checks.append('separate browser-only 503 retains last snapshot and redacts raw error; malformed passed/time evidence becomes unverified; deliberately delayed old GET cannot overwrite a newer plugin refresh')
  page.get_by_role('button',name='Switch to dark mode',exact=True).click();shot('connectors-dark.png');page.get_by_role('button',name='Add connection',exact=True).click();dialog=page.get_by_role('dialog');dialog.press('Escape');expect(dialog).not_to_be_visible();expect(page.get_by_role('button',name='Add connection',exact=True)).to_be_focused()
  page.emulate_media(reduced_motion='reduce');page.set_viewport_size({'width':390,'height':1000});assert page.locator('html').evaluate('(e)=>e.scrollWidth<=e.clientWidth+1');shot('connectors-mobile-reduced.png');assert page.locator('.connector-page').evaluate("e=>Array.from(e.querySelectorAll('*')).every(n=>getComputedStyle(n).animationName==='none'||parseFloat(getComputedStyle(n).animationDuration)<=.001)")
  page.get_by_role('button',name='Switch to Chinese',exact=True).click();expect(page.locator('#connector-title')).to_have_text('连接器');expect(card().locator('[data-layer="messages"]')).to_contain_text('尚未验证');shot('connectors-mobile-chinese.png');checks.append('actual dark/light/narrow themes, 14px+ default text, keyboard Escape/focus restoration, reduced motion and Chinese rendering')
  stats=control('stats');assert stats['calls']['sends']==0 and stats['calls']['events']==0 and stats['calls']['models']==0 and stats['workerToolConnections']==0;assert not errors,errors
  report={'result':'passed','mode':info['mode'],'checks':checks,'pageErrors':errors,'fixtureEvidence':stats,'requests':requests,'realIm':False,'realMessagePermissions':'unverified','screenshots':[str(path) for path in out.glob('*.png')]};(root/'browser-report.json').write_text(json.dumps(report,indent=2,ensure_ascii=False));print(json.dumps(report,ensure_ascii=False))
 except Exception:shot('failure.png');raise
 finally:browser.close()
