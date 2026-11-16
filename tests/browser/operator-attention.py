"""Real GET/click acceptance; browser response/identity faults are labelled separately."""
import json,os,re,sys,time,uuid
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright,expect
root=Path(sys.argv[1]);info=json.loads((root/'browser.json').read_text());out=root/'screenshots';out.mkdir(exist_ok=True);checks=[];errors=[];requests=[];external=[];phase='startup';report={}
def control():
 identifier=str(uuid.uuid4());temp=root/'control-next.json';temp.write_text(json.dumps({'id':identifier,'action':'observe'}));temp.replace(root/'control.json');deadline=time.monotonic()+20
 while True:
  if (root/'control-failed.json').exists():raise AssertionError('local_fixture_observation_failed')
  if (root/'control-result.json').exists():
   result=json.loads((root/'control-result.json').read_text())
   if result.get('id')==identifier:return result
  assert time.monotonic()<deadline,'local_fixture_observation_timeout';time.sleep(.05)
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path=os.environ.get('CHROMIUM_EXECUTABLE','/usr/bin/chromium'),args=['--no-sandbox','--no-zygote','--disable-background-networking'])
 context=browser.new_context(viewport={'width':1440,'height':1100});name,value=info['cookie'].split('=',1);context.add_cookies([{'name':name,'value':value,'url':info['base']}]);page=context.new_page();page.on('pageerror',lambda _:errors.append(True))
 def observe(request):
  path=urlparse(request.url).path
  if request.url.startswith(('http:','https:')) and not request.url.startswith(info['base']+'/'):external.append(True)
  if path.endswith('/entry-workspace/attention') or request.method=='POST':requests.append({'path':path,'method':request.method})
 page.on('request',observe)
 def shot(name):page.wait_for_timeout(150);page.screenshot(path=str(out/name),full_page=True)
 def refresh():page.locator('.page-heading .heading-actions').get_by_role('button',name='Refresh',exact=True).click()
 try:
  phase='normal_bootstrap';page.goto(info['url']);panel=page.locator('.attention-supplement');expect(panel.locator('.attention-record-row')).to_have_count(4);expect(page.locator('.attention-status-lines li')).to_have_count(3);expect(page.get_by_text('Local workflow review',exact=True)).to_be_visible()
  assert 'native_request:' not in panel.inner_text();assert panel.evaluate("e=>Array.from(e.querySelectorAll('*')).filter(n=>n.getClientRects().length&&n.textContent.trim()).every(n=>parseFloat(getComputedStyle(n).fontSize)>=14)")
  before=control();assert before['total']==7 and before['pendingWaiters']==3;shot('attention-real-initial-light.png');checks.append('real account/bootstrap/protected GET: three independent active statuses reuse the existing task card; expired, ACP unavailable, stale workflow and unknown effect are view-only supplemental rows')
  phase='readonly_clicks';expired=panel.locator('.attention-record-row').filter(has_text='Expired');expired.get_by_role('button',name='View record',exact=True).click();dialog=page.locator('dialog.attention-record-dialog');expect(dialog).to_contain_text('Read-only record');expect(dialog).to_contain_text('This request expired');assert not dialog.get_by_role('button',name=re.compile('Approve|Submit|Retry|Stop|Save')).count();expect(dialog.get_by_role('link',name='Open all execution records',exact=True)).to_have_attribute('href',info['base']+'/configure#execution-trace');shot('attention-real-expired-readonly.png');page.keyboard.press('Escape');expect(dialog).to_have_count(0);expect(expired.get_by_role('button',name='View record',exact=True)).to_be_focused()
  unknown=panel.locator('.attention-record-row').filter(has_text='Outcome unknown');unknown.get_by_role('button',name='View record',exact=True).click();expect(page.locator('dialog.attention-record-dialog')).to_contain_text('Check what happened');page.get_by_role('link',name='Open all execution records',exact=True).click();expect(page.locator('#trace-title')).to_be_visible();expect(page.locator('#trace-task')).to_have_value('');page.evaluate("location.hash='attention'");expect(panel.locator('.attention-record-row')).to_have_count(4)
  after=control();assert after['dbDigest']==before['dbDigest'] and after['readOnlyProjectionStable'];assert not [r for r in requests if r['method']=='POST'];checks.append('real metadata-only dialogs have no mutation controls; Escape restores focus; unknown-effect link opens the existing global trace without inventing a task filter; runtime DB unchanged')
  phase='existing_native_flow';page.locator('.attention-item').get_by_role('button',name='View details',exact=True).first.click();normal=page.locator('#operator-task');expect(normal.get_by_role('button',name='Approve once',exact=True).first).to_be_visible();normal.get_by_role('button',name='Decline',exact=True).first.click();expect(normal.get_by_role('button',name='Decline',exact=True)).to_have_count(2);page.keyboard.press('Escape');checks.append('existing task drawer still exposes its original controls; declining one synthetic local native waiter uses the unchanged approval endpoint, with no model or external effect')
  phase='injected_failures';data=context.request.get(info['base']+'/entry-workspace/attention?offset=0&limit=25').json();saved_time=panel.locator('time').inner_text();fault={'kind':'503'}
  def inject(route):
   if fault['kind']=='503':route.fulfill(status=503,json={'code':'operator_attention_unavailable','error':'SECRET_INJECTED'});return
   bad=json.loads(json.dumps(data));bad['schema']=999;route.fulfill(json=bad)
  page.route('**/entry-workspace/attention?*',inject);refresh();expect(panel).to_contain_text('Update failed');assert panel.locator('time').inner_text()==saved_time and 'SECRET' not in panel.inner_text();shot('attention-injected-503-dated.png');fault['kind']='bad-dto';refresh();expect(panel).to_contain_text('Update failed');page.unroute('**/entry-workspace/attention?*',inject);refresh();expect(panel.locator('.attention-update-failed')).to_have_count(0);checks.append('labelled 503 and malformed-DTO faults retain dated records and keep original task cards available; successful refresh recovers')
  phase='theme_keyboard_mobile';page.get_by_role('button',name='Switch to dark mode',exact=True).click();shot('attention-real-dark.png');page.get_by_role('button',name='Switch to Chinese',exact=True).click();page.emulate_media(reduced_motion='reduce');page.set_viewport_size({'width':390,'height':1100});expect(panel).to_contain_text('本地入口');panel.get_by_role('button',name='查看记录',exact=True).first.focus();page.keyboard.press('Enter');dialog=page.locator('dialog.attention-record-dialog');expect(dialog).to_be_visible();assert dialog.evaluate("e=>Array.from(e.querySelectorAll('*')).filter(n=>n.getClientRects().length&&n.textContent.trim()).every(n=>parseFloat(getComputedStyle(n).fontSize)>=14)");assert page.locator('html').evaluate('(e)=>e.scrollWidth<=e.clientWidth+1');shot('attention-real-chinese-390-reduced.png');page.keyboard.press('Escape');checks.append('real dark/Chinese/390px/reduced-motion layout and keyboard dialog activation/close; visible new text remains at least 14px')
  phase='poll_lifecycle';page.get_by_role('button',name='切换为英文',exact=True).click();page.set_viewport_size({'width':1440,'height':1100});before=control();page.wait_for_timeout(11200);after=control();assert 1<=after['attentionRequests']-before['attentionRequests']<=2;assert after['dbDigest']==before['dbDigest'];page.evaluate("location.hash='tasks'");page.wait_for_timeout(11200);left=control();assert left['attentionRequests']==after['attentionRequests'];page.evaluate("location.hash='attention'");expect(panel.locator('time')).to_be_visible();checks.append('existing ten-second work poll drives the projection; no new attention requests after leaving the page; re-entry loads again')
  phase='injected_workspace_identity';page.route('**/workspaces',lambda route:route.fulfill(json={'version':1,'currentId':'studio','items':[{'id':'studio','name':'Workspace A','kind':'organization'},{'id':'other','name':'Workspace B','kind':'organization'}]}))
  def scoped(route):
   parsed=urlparse(route.request.url);parts=parsed.path.split('/',3);workspace=parts[2];target='/'+parts[3];assert route.request.method=='GET','identity_fixture_forbids_writes'
   if target=='/entry-workspace/attention':
    payload=json.loads(json.dumps(data)) if workspace=='studio' else {**data,'items':[],'total':0,'offset':0,'more':False};route.fulfill(json=payload);return
   response=route.fetch(url=info['base']+target+('?' + parsed.query if parsed.query else ''));route.fulfill(response=response)
  page.route('**/workspaces/*/**',scoped)
  phase='injected_workspace_bootstrap';page.goto(info['base']+'/configure?workspace=studio#attention');expect(panel.locator('.attention-record-row').first).to_be_visible()
  phase='hold_original_workspace_read';page.evaluate("""()=>{const original=window.fetch.bind(window);let next=true;window.fetch=async(...args)=>{const response=await original(...args);const url=typeof args[0]==='string'?args[0]:args[0].url;if(next&&url.includes('/workspaces/studio/entry-workspace/attention?')){next=false;return new Promise(resolve=>{window.__attentionRelease=()=>resolve(response);document.documentElement.dataset.attentionHeld='true'})}return response}}""");refresh();expect(page.locator('html')).to_have_attribute('data-attention-held','true');assert page.evaluate("typeof window.__attentionRelease==='function'")
  phase='finish_legacy_refresh';expect(page.locator('.entry-progress')).to_have_count(0);page.evaluate("location.hash='tasks'");expect(page.get_by_role('button',name='Configure team',exact=True)).to_be_visible()
  phase='open_workspace_picker';page.get_by_role('link',name='Current workspace',exact=True).click()
  phase='select_replacement_workspace';page.get_by_role('dialog',name='Switch workspace').get_by_role('button',name='Workspace B Organization',exact=True).click()
  phase='replacement_identity_committed';expect(page).to_have_url(re.compile(r'.*[?&]workspace=other(?:&[^#]*)?#tasks$'))
  phase='open_replacement_attention';page.get_by_role('link',name='Needs attention',exact=True).click();expect(panel.locator('time')).to_be_visible();expect(panel.locator('.attention-record-row')).to_have_count(0)
  phase='release_old_workspace_read';page.evaluate('window.__attentionRelease()');page.wait_for_timeout(250);expect(panel.locator('.attention-record-row')).to_have_count(0);shot('attention-injected-late-workspace-ignored.png');checks.append('labelled optional-workspace host simulation: held A read released after B commit cannot repopulate records; no real multiworkspace service claim')
  final=control();assert final['modelCalls']==final['historyCalls']==final['externalCalls']==0;assert not errors and not external;assert all(r['method']=='GET' for r in requests if r['path'].endswith('/entry-workspace/attention'));assert all(r['path']=='/approval' for r in requests if r['method']=='POST')
  report={'result':'passed','mode':info['mode'],'normalAttentionResponsesMocked':False,'faultStages':['503','malformed DTO','optional workspace host and held response'],'checks':checks,'pageErrorCount':len(errors),'modelCalls':final['modelCalls'],'historyCalls':final['historyCalls'],'externalEffectCalls':final['externalCalls'],'externalRequestCount':len(external),'localNativeDeclinePosts':len([r for r in requests if r['method']=='POST']),'screenshots':[str(p) for p in sorted(out.glob('*.png'))],'realProviders':False}
 except Exception as error:
  try:shot('failure.png')
  except Exception:pass
  report={'result':'failed','code':'operator_attention_browser_failed','phase':phase,'failureType':type(error).__name__,'failureCode':'strict_locator' if 'strict mode violation' in str(error) else 'navigation_aborted' if 'ERR_ABORTED' in str(error) else 'browser_operation_failed','checks':checks,'pageErrorCount':len(errors),'screenshots':[str(p) for p in sorted(out.glob('*.png'))],'realProviders':False}
 finally:
  (root/'browser-report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report));browser.close()
if report.get('result')!='passed':sys.exit(1)
