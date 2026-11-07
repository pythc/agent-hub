"""Remembered task IDs can disappear; the file pane must recover using live task membership."""
import json,sys
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
from resource_helpers import open_resource
root=Path(sys.argv[1]);out=Path(sys.argv[2]);info=json.loads((root/'browser.json').read_text());assert not info['native'];errors=[]
with sync_playwright() as p:
 browser=p.chromium.launch();context=browser.new_context(viewport={'width':1440,'height':960});name,value=info['cookie'].split('=',1);context.add_cookies([{'name':name,'value':value,'url':info['base']}]);page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
 conversations=page.request.get(info['base']+'/api/chat/conversations').json()['conversations'];conversation=next(c['id'] for c in conversations if c['title'])
 page.goto(info['base']+'/chat?conversation='+conversation)
 page.evaluate('id=>sessionStorage.setItem("roppo.files."+id,JSON.stringify({ticket:"removed-task",path:"old.txt",kind:"files"}))',conversation)
 page.get_by_role('button',name='Session panel',exact=True).click();open_resource(page,'Files');page.get_by_role('button',name='result.md',exact=True).click();expect(page.locator('.file-preview')).to_contain_text('Two independent Worker browsers')
 open_resource(page,'Team activity');open_resource(page,'Files');expect(page.locator('.file-preview')).to_contain_text('Two independent Worker browsers')
 attempts=[0]
 def fail_chunk(route):
  attempts[0]+=1
  if attempts[0]==1:route.fulfill(status=503,body='Temporarily unavailable')
  else:route.continue_()
 page.route('**/_virtual_configuration-content-*.js',fail_chunk)
 page.get_by_role('link',name='Model connections',exact=True).click();page.get_by_role('button',name='Couldn’t load this page. Reload',exact=True).click();expect(page.locator('.configuration-outlet #main h1').first).to_be_visible();assert attempts[0]>=2
 assert not errors,errors
 result={'passed':True,'staleTaskRecovers':True,'fileSelectionRestored':True,'moduleLoadFailureRecovers':True,'pageErrors':errors};print(json.dumps(result));(out/'files-recovery.json').write_text(json.dumps(result,indent=2));browser.close()
