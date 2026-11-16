"""Actual single-Runtime browser checks; optional workspace proxy is explicitly synthetic."""
import json,os,sys
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright,expect
root=Path(sys.argv[1]);info=json.loads((root/'browser.json').read_text());out=root/'screenshots';out.mkdir(exist_ok=True);checks=[];errors=[];requests=[]
families=('/api/worker-templates','/api/connectors','/api/execution-trace')
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path=os.environ['CHROMIUM_EXECUTABLE'],args=['--no-sandbox','--no-zygote'])
 def context():
  ctx=browser.new_context(viewport={'width':1440,'height':1000},accept_downloads=True);name,value=info['cookie'].split('=',1);ctx.add_cookies([{'name':name,'value':value,'url':info['base']}]);return ctx
 def page_for(ctx):
  page=ctx.new_page();page.on('pageerror',lambda e:errors.append(str(e)));return page
 def shot(page,name):page.screenshot(path=str(out/name),full_page=True)
 try:
  ctx=context()
  for route in ['worker-templates','connectors','execution-trace']:
   page=page_for(ctx);seen=[]
   page.on('request',lambda request:seen.append(urlparse(request.url).path))
   page.goto(info['base']+'/configure?workspace=studio#'+route);expect(page.get_by_role('alert')).to_contain_text('does not support the workspace')
   assert not any(path.startswith(families) for path in seen),seen
   shot(page,'workspace-unsupported-'+route+'.png');page.close()
  checks.append('actual shipped single-Runtime server rejects explicit unsupported selectors before any default template/connector/trace API read or write, for all three direct capability links')
  for query in ['workspace=','workspace=studio&workspace=other']:
   page=page_for(ctx);seen=[];page.on('request',lambda request:seen.append(urlparse(request.url).path));page.goto(info['base']+'/configure?'+query+'#worker-templates');expect(page.get_by_role('alert')).to_contain_text('workspace link is invalid');assert not any(path.startswith(families) for path in seen);assert query in page.url;page.close()
  checks.append('actual blank and duplicate workspace selectors remain visible and blocked instead of navigating to the default instance')
  page=page_for(ctx);creates=[]
  page.on('request',lambda request:creates.append(request.post_data_json) if urlparse(request.url).path=='/api/worker-templates/create' else None)
  page.goto(info['url']);section=page.locator('.templates-page');expect(section).to_be_visible()
  section.get_by_role('button',name='Review recipe',exact=True).first.click();review=section.locator('.template-review');review.get_by_role('button',name='Install reviewed recipe',exact=True).click();review.get_by_role('button',name='Create Worker',exact=True).click();review.get_by_label('Worker ID',exact=True).fill('workspace-receipt');review.get_by_label('Display name',exact=True).fill('Workspace receipt')
  def lose_reply(route):
   response=route.fetch();assert response.ok;route.abort('failed')
  page.route('**/api/worker-templates/create',lose_reply);review.get_by_role('button',name='Create paused Worker',exact=True).click();expect(section.get_by_role('button',name='Complete previous creation',exact=True)).to_be_visible()
  first=creates[0];before=ctx.request.get(info['base']+'/workers').json();assert len([w for w in before['workers'] if w['id']=='workspace-receipt'])==1
  page.unroute('**/api/worker-templates/create',lose_reply);page.reload();expect(section.get_by_role('button',name='Complete previous creation',exact=True)).to_be_visible();section.get_by_role('button',name='Complete previous creation',exact=True).click();expect(section).to_contain_text('Worker creation confirmed')
  assert creates[-1]==first;after=ctx.request.get(info['base']+'/workers').json();worker=[w for w in after['workers'] if w['id']=='workspace-receipt'];assert len(worker)==1 and worker[0]['state']=='paused' and worker[0]['tools']==[] and worker[0]['toolConnections']==[]
  shot(page,'workspace-template-original-request-reconciled.png');checks.append('actual server accepts one paused Worker while browser loses its response; known-account reload retains the exact original requestId/body and reconciliation creates no duplicate or grants')
  # Legacy and another account's pending bytes are seeded browser-only privacy fixtures.
  page.evaluate("""() => {
   const attempt={path:'/create',requestId:crypto.randomUUID(),body:{id:'recipe',version:'1.0.0',digest:'a'.repeat(64),revision:0,settingsRevision:0,workerId:'PRIVATE-LEGACY-ID',label:'PRIVATE-LEGACY-LABEL',backend:'codex'}};
   sessionStorage.setItem('roppo.worker-template.pending.v1',JSON.stringify([attempt]));
   const own=Object.keys(sessionStorage).find(k=>k.startsWith('roppo.worker-template.pending.v2.'));
   if(!own)throw Error('No current partition');
   const scope=JSON.parse(decodeURIComponent(own.slice('roppo.worker-template.pending.v2.'.length)));scope[2]=['account','different-fixture-account'];
   attempt.body.workerId='PRIVATE-OTHER-ID';attempt.body.label='PRIVATE-OTHER-LABEL';
   sessionStorage.setItem('roppo.worker-template.pending.v2.'+encodeURIComponent(JSON.stringify(scope)),JSON.stringify([attempt]));
  }""")
  page.reload();expect(section).to_contain_text('An earlier request needs review');assert 'PRIVATE-' not in section.inner_text();expect(section.get_by_role('button',name='Complete previous creation',exact=True)).to_have_count(0);shot(page,'workspace-template-unattributed-quarantine.png')
  checks.append('actual page preserves unpartitioned legacy bytes and another synthetic account partition without displaying their private labels/IDs or offering their replay')
  section.locator('.template-card').filter(has_text='v1.0.0').get_by_role('button',name='Review recipe',exact=True).click();review=section.locator('.template-review');review.get_by_role('button',name='Create Worker',exact=True).click();review.get_by_label('Worker ID',exact=True).fill('quota-never-sent');review.get_by_label('Display name',exact=True).fill('Quota never sent')
  page.evaluate("""() => {const original=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key.startsWith('roppo.worker-template.pending.v2.'))throw Error('SYNTHETIC_PRIVATE_QUOTA');return original.call(this,key,value)}}""")
  count=len(creates);review.get_by_role('button',name='Create paused Worker',exact=True).click();expect(section.get_by_role('alert')).to_contain_text('Browser could not save');assert len(creates)==count;assert 'SYNTHETIC_PRIVATE_QUOTA' not in section.inner_text();shot(page,'workspace-template-storage-blocks-before-send.png');checks.append('separate browser-only quota failure blocks the create POST before sending and shows fixed normal-size recovery text')
  page.close();ctx.close()
  # Optional-workspace proxy: one real Runtime behind a synthetic inventory/prefix.
  # This verifies client paths and picker lifetime, not real server tenant isolation.
  ctx=context();page=page_for(ctx);scoped=[]
  inventory={'version':1,'currentId':'studio','canCreate':False,'items':[{'id':'studio','name':'Studio fixture','kind':'organization'},{'id':'other','name':'Other fixture','kind':'organization'}]}
  def proxy(route):
   path=urlparse(route.request.url).path
   if path=='/workspaces':route.fulfill(status=200,json=inventory);return
   for selected in ['studio','other']:
    prefix='/workspaces/'+selected
    if path.startswith(prefix+'/'):
     response=route.fetch(url=info['base']+path[len(prefix):]+('?' + urlparse(route.request.url).query if urlparse(route.request.url).query else ''));route.fulfill(response=response);return
   route.fulfill(status=404,json={'code':'workspace_unavailable'})
  page.route('**/workspaces**',proxy);page.on('request',lambda request:scoped.append(urlparse(request.url).path))
  for name,selector in [('worker-templates','.templates-page'),('connectors','.connector-page'),('execution-trace','.trace-page')]:
   page.goto(info['base']+'/configure?workspace=studio#'+name);expect(page.locator(selector)).to_be_visible()
  assert not any(path.startswith(families) for path in scoped)
  for family in families:assert any(path.startswith('/workspaces/studio'+family) for path in scoped),(family,scoped)
  page.get_by_role('link',name='Current workspace',exact=True).click();expect(page.locator('#workspace-picker')).to_be_visible();assert 'workspace=studio' in page.url
  page.locator('#workspace-picker').get_by_role('button').filter(has_text='Other fixture').click();page.wait_for_url('**workspace=other*');page.goto(info['base']+'/configure?workspace=other#connectors');expect(page.locator('.connector-page')).to_be_visible();assert any(path.startswith('/workspaces/other/api/connectors') for path in scoped);shot(page,'workspace-optional-proxy-other.png')
  checks.append('explicitly synthetic optional-workspace proxy exercises all three real React pages with scoped paths only, and the actual picker keeps the selector when switching; this is not shipped multiworkspace support or real account isolation')
  ctx.close();assert not errors,errors
  report={'result':'passed','checks':checks,'pageErrors':errors,'realServerMode':'actual shipped single Runtime for unsupported links, template creation/reload and storage recovery','optionalWorkspaceMode':'browser proxy simulation over one Runtime; no server multiworkspace or real dual-account claim','realIm':False,'realAcp':False,'screenshots':[str(path) for path in out.glob('*.png')]}
  (root/'workspace-browser-report.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
 finally:browser.close()
