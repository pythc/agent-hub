"""Actual cloud-local UI. Deterministic model/ACP fixtures, disabled IM, no external effects."""
import json,sys,uuid,os
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
root=Path(sys.argv[1]);info=json.loads((root/'browser.json').read_text());out=root/'screenshots';out.mkdir(exist_ok=True)
checks=[];errors=[]
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path=os.environ.get('CHROMIUM_EXECUTABLE','/usr/bin/chromium'),args=['--no-sandbox','--no-zygote'])
 context=browser.new_context(viewport={'width':1440,'height':1000},accept_downloads=True)
 name,value=info['cookie'].split('=',1);context.add_cookies([{'name':name,'value':value,'url':info['base']}])
 page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
 def api(path,body=None):
  r=context.request.get(info['base']+path) if body is None else context.request.post(info['base']+path,headers={'origin':info['base']},data=body)
  assert r.ok,(path,r.status,r.text()[:350]);return r.json()
 def shot(name):page.screenshot(path=str(out/name),full_page=True)
 try:
  page.goto(info['url']);section=page.locator('.templates-page');expect(section.get_by_role('heading',name='Worker templates',exact=True)).to_be_visible()
  expect(page.locator('.management-content')).not_to_be_visible();shot('templates-light.png')
  section.get_by_role('button',name='Review recipe',exact=True).first.click();review=section.locator('.template-review')
  expect(review).to_contain_text('Installation grants no permissions');shot('template-review-light.png')
  review.get_by_role('button',name='Install reviewed recipe',exact=True).click();expect(review.get_by_role('button',name='Create Worker',exact=True)).to_be_visible()
  review.get_by_role('button',name='Create Worker',exact=True).click();review.get_by_label('Worker ID',exact=True).fill('browser-review');review.get_by_label('Display name',exact=True).fill('Browser review')
  expect(review.get_by_label('Execution backend').locator('option[value="acp"]')).to_be_disabled()
  review.get_by_role('button',name='Create paused Worker',exact=True).click();expect(section.get_by_role('status')).to_contain_text('Worker created and paused')
  worker=next(w for w in api('/workers')['workers'] if w['id']=='browser-review');assert worker['state']=='paused' and worker['tools']==[] and worker['toolConnections']==[]
  page.reload();expect(section.locator('.template-card').filter(has_text='v1.0.0')).to_have_count(1)
  section.locator('.template-card').filter(has_text='v1.0.0').get_by_role('button',name='Review recipe').click()
  with page.expect_download() as download:section.get_by_role('button',name='Export',exact=True).click()
  download.value.save_as(str(root/'exported.worker.json'));assert json.loads((root/'exported.worker.json').read_text())['id']=='evidence-reviewer'
  page.get_by_role('button',name='Switch to dark mode',exact=True).click();shot('template-library-dark.png')
  checks.append('review/install/export recipe; paused Worker and empty grants; ACP managed option disabled; reload persistence')

  page.goto(info['base']+'/configure#connectors');connections=page.locator('.connector-page');expect(connections.get_by_role('heading',name='Connections',exact=True)).to_be_visible()
  card=connections.locator('.connector-card').filter(has_text='Feishu setup preview')
  card.get_by_role('button',name='Check Configuration for Feishu setup preview',exact=True).click();expect(card).to_contain_text('Local fields match the adapter contract')
  expect(connections).to_contain_text('Read, receive, send and target-channel permissions remain unverified');shot('connectors-diagnostics-dark.png')
  connections.get_by_role('button',name='Add connection',exact=True).click();dialog=page.get_by_role('dialog');expect(dialog).to_be_visible()
  dialog.get_by_label('Installed app').select_option('feishu');dialog.get_by_role('button',name='Continue',exact=True).click()
  dialog.get_by_label('Connection name',exact=True).fill('Browser Feishu fixture');dialog.get_by_label('Allowed actor IDs',exact=True).fill('operator');dialog.get_by_label('Use existing host environment references',exact=True).check()
  dialog.get_by_label('App ID *',exact=True).fill('FIXTURE_FEISHU_APP_ID');dialog.get_by_label('App secret *',exact=True).fill('FIXTURE_FEISHU_APP_SECRET');dialog.get_by_label('Chat IDs *',exact=True).fill('oc_browser_fixture')
  dialog.get_by_role('button',name='Review connection',exact=True).click();expect(dialog).to_contain_text('Ready to apply');expect(dialog).to_contain_text('It does not authenticate, send a message or grant Worker tools');shot('connector-reviewed-plan-dark.png')
  dialog.get_by_role('button',name='Apply connection',exact=True).click();expect(dialog).not_to_be_visible(timeout=15000)
  expect(connections.locator('.connector-card').filter(has_text='Browser Feishu fixture')).to_contain_text('Disabled');page.reload();expect(connections.locator('.connector-card').filter(has_text='Browser Feishu fixture')).to_contain_text('Disabled')
  checks.append('plugin-defined Feishu help, local validation and existing onboarding apply; starts disabled; diagnostic scope and persisted reload')

  page.goto(info['base']+'/configure#models');expect(page.locator('.models-page')).to_be_visible();acp=page.locator('.model-service-row').filter(has_text='ACP outbound')
  expect(acp).to_contain_text('Cannot serve as a managed Worker');acp.get_by_role('button',name='Probe protocol',exact=True).click();expect(acp).to_contain_text('Protocol: reachable',timeout=25000);expect(acp).to_contain_text('Authentication: unknown');expect(acp).to_contain_text('Model call unverified');shot('acp-compatibility-probe-dark.png')
  checks.append('existing backend UI; actual sandboxed ACP initialize; auth unknown; model-call unverified; managed gate unchanged')

  workers=api('/workers');api('/workers',{'action':'resume','id':'browser-review','revision':workers['revision'],'requestId':str(uuid.uuid4())});workers=api('/workers')
  assigned=api('/workers',{'action':'assign','id':'browser-review','revision':workers['revision'],'requestId':str(uuid.uuid4()),'discussion':'browser-acceptance','text':'Complete the deterministic local acceptance task.'})
  page.goto(info['base']+'/configure#execution-trace');trace=page.locator('.trace-page');expect(trace.get_by_role('heading',name='Execution trace',exact=True)).to_be_visible();trace.get_by_label('Show',exact=True).select_option(assigned['ticketId'])
  expect(trace.locator('.trace-task-detail')).to_contain_text('Retained in task history',timeout=15000);expect(trace.locator('.trace-task-detail')).to_contain_text('A completed tool call alone does not verify a commit');expect(trace.locator('.trace-evidence')).to_contain_text('Unverified');shot('trace-result-evidence-dark.png')
  page.reload();trace.get_by_label('Show',exact=True).select_option(assigned['ticketId']);expect(trace.locator('.trace-timeline li').first).to_be_visible();event_count=trace.locator('.trace-timeline li').count();assert event_count>0
  def fail_refresh(route):route.fulfill(status=503,json={'code':'fixture_temporarily_unavailable'})
  page.route('**/api/execution-trace?*',fail_refresh);trace.get_by_role('button',name='Refresh',exact=True).click();expect(trace.get_by_role('alert')).to_contain_text('Updates are unavailable');assert trace.locator('.trace-timeline li').count()>=event_count;shot('trace-refresh-failure-dark.png')
  page.unroute('**/api/execution-trace?*',fail_refresh);trace.get_by_role('button',name='Try refresh',exact=True).click();expect(trace.get_by_role('alert')).not_to_be_visible()
  checks.append('explicit Worker activation and real scheduler fixture run; persisted dispatch/result; independent commit/test/deploy evidence; reload/failed-refresh recovery')

  workers=api('/workers');unknown=api('/workers',{'action':'assign','id':'research','revision':workers['revision'],'requestId':str(uuid.uuid4()),'discussion':'browser-unknown','text':'fixture-unknown-effect: exercise reconciliation fence.'})
  trace.get_by_role('button',name='Refresh',exact=True).click();expect(trace.get_by_label('Show').locator('option[value="'+unknown['ticketId']+'"]').first).to_be_attached(timeout=15000);trace.get_by_label('Show').select_option(unknown['ticketId'])
  expect(trace.locator('.trace-task-detail')).to_contain_text('Some effects are unconfirmed',timeout=15000);expect(trace.get_by_role('button',name='Resume original session',exact=True)).not_to_be_visible();shot('trace-unknown-effect-dark.png')
  trace.get_by_role('button',name='Stop task',exact=True).click();trace.locator('.trace-confirm').get_by_role('button',name='Stop task',exact=True).click();expect(trace.locator('.trace-task-detail')).to_contain_text('Stopped',timeout=15000)
  page.reload();trace.get_by_label('Show').select_option(unknown['ticketId']);expect(trace.get_by_role('button',name='Resume original session',exact=True)).not_to_be_visible();expect(trace.locator('.trace-task-detail')).to_contain_text('Stopped')
  checks.append('actual typed unknown-effect failure is fenced; inspect before retry; explicit cancellation persists after reload and cannot resume')

  page.emulate_media(reduced_motion='reduce');page.set_viewport_size({'width':390,'height':844})
  for route,selector in [('worker-templates','.templates-page'),('connectors','.connector-page'),('execution-trace','.trace-page')]:
   page.goto(info['base']+'/configure#'+route);expect(page.locator(selector)).to_be_visible();assert page.locator('html').evaluate('(e)=>e.scrollWidth<=e.clientWidth+1'),route
   shot(route+'-mobile-reduced-motion.png');assert page.locator(selector).evaluate("e=>Array.from(e.querySelectorAll('*')).every(n=>getComputedStyle(n).animationName==='none'||parseFloat(getComputedStyle(n).animationDuration)<=0.001)"),route
  page.set_viewport_size({'width':1440,'height':1000});page.goto(info['base']+'/configure#connectors');page.get_by_role('button',name='Switch to light mode',exact=True).click();shot('connectors-light.png')
  connections.get_by_role('button',name='Add connection',exact=True).click();dialog=page.get_by_role('dialog');dialog.press('Escape');expect(dialog).not_to_be_visible();expect(connections.get_by_role('button',name='Add connection',exact=True)).to_be_focused()
  page.get_by_role('button',name='Switch to Chinese',exact=True).click();expect(connections.locator('h1')).to_have_text('连接器');shot('connectors-chinese-light.png')
  checks.append('light/dark/narrow themes; reduced motion; keyboard Escape/focus restoration; Chinese translation')
  assert not errors,errors
  report={'result':'passed','checks':checks,'pageErrors':errors,'mode':info['mode'],'realIm':False,'realAcp':False,'screenshots':[str(p) for p in out.glob('*.png')]};(root/'browser-report.json').write_text(json.dumps(report,indent=2,ensure_ascii=False));print(json.dumps(report,ensure_ascii=False))
 except Exception:
  shot('failure.png');(root/'browser-failure.json').write_text(json.dumps({'checks':checks,'pageErrors':errors,'url':page.url},indent=2));raise
 finally:browser.close()
