"""Actual scheduler transitions plus separately labelled browser fault injection."""
import json,os,sys,time,uuid
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
root=Path(sys.argv[1]);info=json.loads((root/'browser.json').read_text());out=root/'screenshots';out.mkdir(exist_ok=True);checks=[];errors=[];methods=[]
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path=os.environ['CHROMIUM_EXECUTABLE'],args=['--no-sandbox','--no-zygote'])
 context=browser.new_context(viewport={'width':1440,'height':1100});name,value=info['cookie'].split('=',1);context.add_cookies([{'name':name,'value':value,'url':info['base']}]);page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
 page.on('request',lambda request:methods.append(request.method) if '/api/scheduler-status' in request.url else None)
 def shot(name):
  page.wait_for_timeout(400)
  page.screenshot(path=str(out/name),full_page=True)
 try:
  def control(action):
   request_id=str(uuid.uuid4());temporary=root/'control-next.json';temporary.write_text(json.dumps({'id':request_id,'action':action}));temporary.replace(root/'control.json');deadline=time.monotonic()+25
   while True:
    if (root/'control-failed.json').exists():raise AssertionError('Fixture control failed; inspect private host log')
    if (root/'control-result.json').exists():
     result=json.loads((root/'control-result.json').read_text())
     if result.get('id')==request_id:
      assert result['result']=='ok';return result
    assert time.monotonic()<deadline,'Control deadline';time.sleep(.05)
  page.goto(info['url']);page.get_by_role('tab',name='Configure team',exact=True).click()
  panel=page.locator('#team-scheduler-status');expect(panel).to_have_attribute('data-state','ready')
  expect(panel.locator('[data-scheduler-value="occupancy.jobs"]')).to_have_text('1');expect(panel.locator('[data-scheduler-value="queue.ready"]')).to_have_text('1');expect(panel.locator('[data-scheduler-value="workers.idleEnabled"]')).to_have_text('0')
  actual=page.request.get(info['base']+'/api/scheduler-status').json();assert actual['occupancy']['workerJobs']==1 and actual['occupancy']['controllers']==1 and actual['queue']['ready']==1
  assert not panel.locator('details').evaluate('(e)=>e.open')
  assert panel.evaluate("e=>Array.from(e.querySelectorAll('*')).filter(n=>n.getClientRects().length&&n.textContent.trim()).every(n=>parseFloat(getComputedStyle(n).fontSize)>=14)")
  shot('scheduler-real-running-queued-light.png');checks.append('real Runtime Worker held by deterministic Model; second task reaches genuine pending start/execute queue; actual protected GET and UI both show working 1, waiting 1, idle 0 without response mocking')
  paused=control('pause');assert paused['workerCalls']==1 and paused['status']['paused'] and paused['status']['occupancy']['controllers']==1
  panel.get_by_role('button',name='Refresh status',exact=True).click();expect(panel).to_have_attribute('data-state','paused');expect(panel).to_contain_text('Existing work may still be running.');expect(panel.locator('[data-scheduler-value="occupancy.jobs"]')).to_have_text('1');expect(panel.locator('[data-scheduler-value="queue.ready"]')).to_have_text('1');shot('scheduler-real-paused-running-light.png')
  advanced=control('advance');assert advanced['workerCalls']==2 and advanced['status']['occupancy']['workerJobs']==1 and advanced['status']['queue']['ready']==0
  panel.get_by_role('button',name='Refresh status',exact=True).click();expect(panel).to_have_attribute('data-state','ready');expect(panel.locator('[data-scheduler-value="occupancy.jobs"]')).to_have_text('1');expect(panel.locator('[data-scheduler-value="queue.ready"]')).to_have_text('0');shot('scheduler-real-queue-advanced-light.png')
  finished=control('finish');assert finished['workerCalls']==2 and finished['status']['occupancy']['jobs']==0 and finished['status']['queue']['ready']==0
  panel.get_by_role('button',name='Refresh status',exact=True).click();expect(panel.locator('[data-scheduler-value="occupancy.jobs"]')).to_have_text('0');expect(panel.locator('[data-scheduler-value="workers.idleEnabled"]')).to_have_text('1');shot('scheduler-real-finished-light.png')
  checks.append('actual pause keeps first Worker alive; releasing first Model gate lets the real scheduler dispatch the second task and reduce queue 1 to 0; releasing second ends both tasks and returns occupancy to 0')
  snapshot=page.request.get(info['base']+'/api/scheduler-status').json()
  mode={'value':'active'}
  def observe(route):
   if mode['value']=='failure':route.fulfill(status=503,json={'code':'scheduler_status_unavailable','error':'secret-token/RAW_STDERR'});return
   data=json.loads(json.dumps(snapshot));data['paused']=False;data['occupancy'].update({'jobs':7,'routingJobs':4,'workerJobs':3,'controllers':2,'backgroundReservations':1,'activeManagedWork':5});data['workers'].update({'configured':5,'enabled':3,'paused':1,'retiring':1,'idleEnabled':1});data['queue'].update({'ready':6,'delayed':2,'blocked':1,'uncertain':1});data['routing']['admittedButWorkerCountedJobs']=1;data['interactive'].update({'eligibleQueued':2,'activeReservedExecutions':1})
   if mode['value']=='malformed':data['occupancy']['jobs']=-1
   route.fulfill(json=data)
  page.route('**/api/scheduler-status',observe);panel.get_by_role('button',name='Refresh status',exact=True).click();expect(panel).to_have_attribute('data-state','ready');expect(panel.locator('[data-scheduler-value="occupancy.jobs"]')).to_have_text('7');expect(panel.locator('[data-scheduler-value="queue.ready"]')).to_have_text('6')
  saved_time=panel.locator('time').inner_text();shot('scheduler-synthetic-active-light.png')
  panel.locator('summary').focus();page.keyboard.press('Enter');expect(panel.locator('details')).to_have_attribute('open','');expect(panel).to_contain_text('at most one additional slot');expect(panel).to_contain_text('other scheduling checks still apply.');shot('scheduler-details-light.png');page.keyboard.press('Enter')
  mode['value']='failure';panel.get_by_role('button',name='Refresh status',exact=True).click();expect(panel).to_have_attribute('data-state','stale');expect(panel).to_contain_text('Showing the last recorded state.');expect(panel.locator('[data-scheduler-value="occupancy.jobs"]')).to_have_text('7');assert panel.locator('time').inner_text()==saved_time;assert 'secret-token' not in panel.inner_text();shot('scheduler-last-state-failure-light.png')
  mode['value']='malformed';panel.get_by_role('button',name='Refresh status',exact=True).click();expect(panel.get_by_role('button',name='Refresh status',exact=True)).to_be_enabled();expect(panel.locator('[data-scheduler-value="occupancy.jobs"]')).to_have_text('7');checks.append('synthetic response fixtures test active counts, optional keyboard details, failed refresh retention and malformed-schema retention without raw errors')
  page.unroute('**/api/scheduler-status',observe);panel.get_by_role('button',name='Refresh status',exact=True).click();expect(panel).to_have_attribute('data-state','ready')
  page.get_by_role('button',name='Switch to dark mode',exact=True).click();shot('scheduler-real-idle-dark.png')
  page.emulate_media(reduced_motion='reduce');page.set_viewport_size({'width':390,'height':1100});panel.scroll_into_view_if_needed();assert page.locator('html').evaluate('(e)=>e.scrollWidth<=e.clientWidth+1');assert panel.evaluate("e=>Array.from(e.querySelectorAll('*')).concat(e).every(n=>getComputedStyle(n).animationName==='none')")
  panel.get_by_role('button',name='Refresh status',exact=True).focus();page.keyboard.press('Tab');expect(panel.locator('summary')).to_be_focused();shot('scheduler-mobile-keyboard.png')
  page.get_by_role('button',name='Switch to Chinese',exact=True).click();panel=page.locator('#team-scheduler-status');expect(panel).to_contain_text('调度运行中');panel.scroll_into_view_if_needed();shot('scheduler-mobile-chinese-reduced.png')
  checks.append('actual light/dark, narrow layout, keyboard details and reduced-motion Chinese page checks')
  assert all(method=='GET' for method in methods),methods;assert not errors,errors
  report={'result':'passed','mode':info['mode']+'; active aggregate variation and failure/schema cases are separately labelled browser-only injections','checks':checks,'pageErrors':errors,'schedulerMethods':methods,'screenshots':[str(x) for x in out.glob('*.png')],'realProviders':False,'runtimeEvidence':json.loads((root/'scheduler-evidence.json').read_text())};(root/'browser-report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
 except Exception:shot('failure.png');raise
 finally:browser.close()
