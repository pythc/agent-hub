"""Click real task/detail/trace pages. All provider and MCP responses are synthetic."""
import json,os,sys,time,uuid
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright,expect
root=Path(sys.argv[1]);info=json.loads((root/'browser.json').read_text());out=root/'screenshots';out.mkdir(exist_ok=True)
checks=[];errors=[];requests=[];external=[];phase='startup'
markers=['SYNTHETIC_M4_SENTINEL','SYNTHETIC_M4_RAW_BODY','SYNTHETIC_M4_ENV_NAME','SYNTHETIC_M4_STDERR']
def control(action='stats'):
 ident=str(uuid.uuid4());temp=root/'control-next.json';temp.write_text(json.dumps({'id':ident,'action':action}));temp.replace(root/'control.json');deadline=time.monotonic()+15
 while True:
  assert not (root/'control-failed.json').exists(),'Local fixture control failed'
  if (root/'control-result.json').exists():
   value=json.loads((root/'control-result.json').read_text())
   if value.get('id')==ident:return value
  assert time.monotonic()<deadline,'Fixture control timeout';time.sleep(.05)
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path=os.environ['CHROMIUM_EXECUTABLE'],args=['--no-sandbox','--no-zygote','--disable-background-networking'])
 ctx=browser.new_context(viewport={'width':1440,'height':1100});name,cookie=info['cookie'].split('=',1);ctx.add_cookies([{'name':name,'value':cookie,'url':info['base']}]);page=ctx.new_page();page.set_default_timeout(15000);page.on('pageerror',lambda _:errors.append(True))
 def observe(request):
  if request.url.startswith(('http:','https:')) and not request.url.startswith(info['base']+'/'):external.append(True)
  requests.append({'method':request.method,'path':urlparse(request.url).path})
 page.on('request',observe)
 def safe():
  value=page.locator('body').inner_text()
  for marker in markers:assert marker not in value,'Raw synthetic diagnostic appeared in the real page'
 def shot(name):
  if name!='failure.png':
   page.evaluate('''async()=>{
    const frame=()=>new Promise(resolve=>requestAnimationFrame(resolve));await frame();await frame();await document.fonts.ready;
    const deadline=performance.now()+5000;
    const active=()=>document.getAnimations().filter(a=>{const timing=a.effect?.getComputedTiming();return (a.playState==='running'||a.pending)&&timing&&Number.isFinite(timing.endTime)&&timing.iterations!==Infinity});
    const boxes=()=>JSON.stringify([...document.querySelectorAll('.trace-page,.trace-task-detail,.trace-status,#operator-task,.drawer-body,.workspace-table')].map(node=>{const b=node.getBoundingClientRect();return [b.x,b.y,b.width,b.height].map(v=>Math.round(v*100)/100)}));
    for(;;){let timer;try{await Promise.race([Promise.allSettled(active().map(a=>a.finished)),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Finite screenshot animation did not finish')),Math.max(0,deadline-performance.now()))})])}finally{clearTimeout(timer)}
     let previous=boxes(),stable=0;while(stable<3){if(performance.now()>deadline)throw Error('Screenshot layout did not settle');await frame();const next=boxes();stable=next===previous?stable+1:0;previous=next}if(!active().length)break;
    }
   }''')
  safe();page.screenshot(path=str(out/name),full_page=True)
 def facet(name):return page.locator('[data-facet="'+name+'"]')
 def trace_select(id):page.locator('#trace-task').select_option(id)
 try:
  phase='actual_runtime_proof';initial=control();assert initial['leakCount']==0
  assert initial['counts']['apiAdapterRuns']==initial['counts']['syntheticApiRequests']==3
  assert initial['counts']['fixtureModelRuns']>=6
  assert all(initial['counts'][key]==0 for key in ['realProviderRequests','sdkAuthentication','externalMessages','blockedNetworkRequests'])
  assert len(initial['retainedThreads'])==3
  for thread in initial['retainedThreads']:assert thread['turns']==[{'status':'failed','errors':['OperationError: Backend stream failed: provider_error']}]
  for task in initial['tasks']:
   if task['case']!='unknown':assert task['receipts']==[] and task['phase']=='uncertain' and 'OperationError:' in task['error']
  unknown=next(task for task in info['tasks'] if task['case']=='unknown');assert initial['counts']['mcpToolDispatches']==1
  assert initial['receiptTransitions'][0]['state']=='running' and initial['receiptTransitions'][-1]['state']=='uncertain'
  checks.append({'kind':'actual-runtime-synthetic-transport','check':'three actual API adapters retain only fixed failed-turn errors; actual MCP init/catalog fail before any receipt; dispatched MCP disconnect retains running→uncertain','fixtureModelRuns':initial['counts']['fixtureModelRuns'],'apiAdapterRuns':initial['counts']['apiAdapterRuns'],'realProviderRequests':0})
  phase='actual_task_drawers';page.goto(info['url']);expect(page.locator('#task-search')).to_be_visible()
  for index,task in enumerate(info['tasks']):
   page.locator('#work-'+task['id']).click();dialog=page.locator('#operator-task');expect(dialog).to_be_visible();expect(dialog.locator('#operator-task-title')).to_have_text(task['title'])
   expected='Tool result is unconfirmed' if task['case']=='unknown' else 'Execution could not be confirmed. Review task records and the actual outcome before continuing.'
   expect(dialog).to_contain_text(expected);safe();shot('actual-detail-'+task['case']+'-light.png');page.get_by_role('button',name='Close details',exact=True).click();expect(dialog).to_have_count(0)
  page.reload();expect(page.locator('#task-search')).to_be_visible();page.locator('#work-'+info['tasks'][0]['id']).click();expect(page.locator('#operator-task')).to_contain_text('Execution could not be confirmed.');page.keyboard.press('Escape');expect(page.locator('#operator-task')).to_have_count(0)
  checks.append({'kind':'actual-ui','check':'existing task history and six original detail drawers show the existing fixed unconfirmed-execution guidance (specific run error is not exposed there) or safe tool-outcome summary; no raw markers; full reload retains guidance'})
  phase='actual_trace_unknown';page.goto(info['base']+'/configure#execution-trace');expect(page.locator('#trace-title')).to_be_visible();trace_select(unknown['id']);expect(facet('effects')).to_have_attribute('data-state','unknown');expect(page.get_by_role('button',name='Continue task',exact=True)).not_to_be_visible();expect(page.locator('.trace-guidance')).to_contain_text('Check the actual outcome')
  page.locator('.trace-records summary').focus();page.keyboard.press('Enter');expect(page.locator('.trace-records')).to_have_attribute('open','');expect(page.locator('.trace-timeline')).to_contain_text('Check outcome');shot('actual-unknown-records-light.png')
  page.get_by_role('button',name='Stop task',exact=True).click();expect(page.locator('.trace-confirm')).to_contain_text('Earlier actions will not be undone.');shot('actual-stop-preview-no-undo.png');page.get_by_role('button',name='Keep working',exact=True).click();expect(page.locator('.trace-confirm')).to_have_count(0)
  after=control('same_request');assert after['counts']['mcpToolDispatches']==initial['counts']['mcpToolDispatches']==1;assert after['counts']['sameRequestChecks']==1
  before_receipt=next(t for t in initial['tasks'] if t['case']=='unknown')['receipts'];assert next(t for t in after['tasks'] if t['case']=='unknown')['receipts']==before_receipt
  page.get_by_role('button',name='Refresh',exact=True).click();expect(facet('effects')).to_have_attribute('data-state','unknown');page.reload();trace_select(unknown['id']);expect(facet('effects')).to_have_attribute('data-state','unknown');safe()
  checks.append({'kind':'actual-ui-and-runtime','check':'existing trace exposes unknown outcome and original session, no Continue action; Stop preview explicitly says earlier effects are not undone (confirmation not submitted); actual same-owner/requestId call reuses original uncertain receipt, one dispatch only, then Refresh and reload keep unknown'})
  phase='actual_rendering';page.get_by_role('button',name='Switch to Chinese',exact=True).click();expect(page.locator('#trace-title')).to_have_text('任务进展');expect(facet('effects')).to_contain_text('效果未知');shot('actual-chinese-unknown-light.png');page.get_by_role('button',name='切换为深色模式',exact=True).click();shot('actual-chinese-unknown-dark.png')
  page.emulate_media(reduced_motion='reduce');page.set_viewport_size({'width':390,'height':1000});page.locator('#trace-task').focus();page.keyboard.press('Tab');expect(page.get_by_role('button',name='核对当前状态',exact=True)).to_be_focused();shot('actual-chinese-390-keyboard-reduced.png');assert page.locator('html').evaluate('(node)=>node.scrollWidth<=node.clientWidth+1')
  assert page.locator('.trace-page').evaluate("node=>[...node.querySelectorAll('*')].filter(n=>n.getClientRects().length&&n.textContent.trim()).every(n=>parseFloat(getComputedStyle(n).fontSize)>=14)")
  assert page.locator('.trace-status').evaluate("node=>[...node.querySelectorAll('*')].every(n=>getComputedStyle(n).animationName==='none'||parseFloat(getComputedStyle(n).animationDuration)<=.001)")
  page.get_by_role('button',name='切换为浅色模式',exact=True).click();shot('actual-chinese-390-light-reduced.png');safe()
  checks.append({'kind':'actual-rendering','check':'Chinese unknown outcome light/dark, 390px, keyboard focus, 14px minimum and reduced-motion; finite screenshot animations naturally finish without disabling motion'})
  phase='final_persisted_evidence';final=control();assert final['leakCount']==0;assert not errors and not external
  assert all(request['method']=='GET' for request in requests),'Browser must not submit business or recovery POSTs'
  assert all(final['counts'][key]==0 for key in ['realProviderRequests','sdkAuthentication','externalMessages','blockedNetworkRequests'])
  assert final['counts']['apiAdapterRuns']==3 and final['counts']['mcpToolDispatches']==1
  report={'result':'passed','implementationCommit':os.environ.get('ACCEPTANCE_IMPLEMENTATION_COMMIT'),'mode':info['mode'],'checks':checks,'pageErrorCount':len(errors),'pageErrors':errors,'browserExternalRequests':len(external),'browserRequests':requests,'runtimeEvidence':final,'realProviderRequests':0,'screenshots':[str(path) for path in sorted(out.glob('*.png'))]}
  (root/'browser-report.json').write_text(json.dumps(report,indent=2,ensure_ascii=False));print(json.dumps({'result':'passed','groups':len(checks),'screenshots':len(report['screenshots']),'pageErrorCount':len(errors),'realProviderRequests':0}))
 except Exception:
  page.screenshot(path=str(out/'failure.png'),full_page=True);(root/'browser-failure.json').write_text(json.dumps({'phase':phase,'checks':checks,'pageErrorCount':len(errors),'externalRequestCount':len(external),'url':page.url},indent=2));raise
 finally:browser.close()
