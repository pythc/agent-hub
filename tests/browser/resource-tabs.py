"""Real resource launcher and browser checks, using the isolated browser fixture."""
import json,sys,time,uuid
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
from resource_helpers import open_resource
root,out=map(Path,sys.argv[1:3]);out.mkdir(parents=True,exist_ok=True)
info=json.loads((root/'browser.json').read_text());assert not info['native'];base=info['base'];website=info['site']+'/login?tab-check='+uuid.uuid4().hex;errors=[];writes=[];checks=[]
with sync_playwright() as p:
 browser=p.chromium.launch();context=browser.new_context(viewport={'width':1500,'height':960});name,value=info['cookie'].split('=',1);context.add_cookies([{'name':name,'value':value,'url':base}]);page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.on('request',lambda r:writes.append(r.url) if r.method!='GET' else None)
 def button(name):return page.get_by_role('button',name=name,exact=True)
 def tab(name):return page.locator('.resource-tabs').get_by_role('tab',name=name,exact=True)
 def shot(name):page.screenshot(path=str(out/(name+'.png')),animations='disabled')
 def bounded():assert page.evaluate('document.documentElement.scrollWidth<=innerWidth && document.documentElement.scrollHeight<=innerHeight')
 def state():return page.request.get(base+'/api/browser').json()
 try:
  cs=page.request.get(base+'/api/chat/conversations').json()['conversations'];original=next(c for c in cs if c['title'])['id']
  page.goto(base+'/chat?conversation='+original);expect(page.get_by_role('textbox',name='Message Router',exact=True)).to_be_visible()
  expect(page.get_by_role('link',name='Workspace',exact=True)).to_have_count(0)
  expect(page.get_by_role('link',name='Current workspace',exact=True)).to_have_count(1)
  page.get_by_role('link',name='Current workspace',exact=True).click();page.get_by_role('dialog',name='Switch workspace').get_by_role('button',name='Close',exact=True).click();expect(page.locator('.configuration-outlet #main h1').first).to_be_visible();page.get_by_role('link',name='Conversations',exact=True).click();checks.append('one workspace entry, with the existing picker and overview')
  button('Session panel').click();expect(tab('New tab')).to_have_attribute('aria-selected','true');expect(page.locator('.resource-tabs [role=tab]')).to_have_count(1)
  search=page.get_by_role('textbox',name='Search tools or enter a website',exact=True);search.fill('files');expect(page.locator('.resource-tool-grid>button')).to_have_count(1);search.press('Enter');expect(tab('Files')).to_have_attribute('aria-selected','true')
  button('result.md').click();expect(page.locator('.file-preview')).to_contain_text('Two independent Worker browsers')
  open_resource(page,'Team activity');expect(page.locator('.worker-node')).to_have_count(2);button('New workspace tab').click();expect(page.locator('.resource-recent>button')).to_have_count(2);shot('recent-light')
  page.locator('.resource-recent').get_by_role('button',name=__import__('re').compile('Files')).click();expect(page.locator('.file-preview')).to_contain_text('Two independent Worker browsers');button('Close Files view').click();expect(tab('Files')).to_have_count(0);open_resource(page,'Files');expect(page.locator('.file-preview')).to_contain_text('Two independent Worker browsers');expect(tab('Files')).to_have_count(1)
  page.reload();expect(tab('Files')).to_have_attribute('aria-selected','true');expect(page.locator('.file-preview')).to_contain_text('Two independent Worker browsers');checks.append('launcher search, real files/team, independent tab closing/reopening, recent records and reload persistence')
  button('New workspace tab').click();search.fill(website);search.press('Enter');expect(tab('Browser')).to_have_attribute('aria-selected','true');expect(page.locator('.browser-pending-site')).to_be_visible();button('Browser Lab').click()
  if button('Take over here').count():button('Take over here').click()
  expect(page.get_by_alt_text('Live browser page')).to_be_visible(timeout=30000)
  address=page.get_by_label('Website address',exact=True);expect(address).to_have_value(website,timeout=30000);expect(page.locator('.browser-pending-site')).to_have_count(0);expect(address).to_be_enabled(timeout=30000)
  sid=page.get_by_label('Browser session',exact=True).input_value();tabs_before=next(s for s in state()['sessions'] if s['id']==sid)['tabs'];assert sum(t['url']==website for t in tabs_before)==1
  button('Switch to dark mode').click();expect(page.locator('html')).to_have_attribute('data-theme','dark');page.wait_for_timeout(200);shot('browser-dark')
  button('Close Browser view').click();expect(tab('Browser')).to_have_count(0)
  for _ in range(40):
   session=next(s for s in state()['sessions'] if s['id']==sid)
   if not session['streaming']:break
   time.sleep(.2)
  else:raise AssertionError('closed view still streaming')
  assert len(session['tabs'])==len(tabs_before)
  open_resource(page,'Browser');expect(page.get_by_label('Browser session',exact=True)).to_have_value(sid);expect(page.get_by_alt_text('Live browser page')).to_be_visible(timeout=30000);assert len(next(s for s in state()['sessions'] if s['id']==sid)['tabs'])==len(tabs_before);checks.append('launcher URL opens one real browser tab; closing its view stops streaming and preserves the live browser')
  # A malformed address is a search, never an executable navigation.
  button('New workspace tab').click();search.fill('javascript:alert(1)');search.press('Enter');expect(tab('New tab')).to_have_attribute('aria-selected','true');expect(page.locator('.resource-no-results')).to_be_visible();search.fill('')
  tab('New tab').focus();page.keyboard.press('End');expect(page.locator('.resource-tabs [role=tab]').last).to_be_focused();page.keyboard.press('Home');expect(tab('New tab')).to_be_focused();page.keyboard.press('Delete');expect(tab('New tab')).to_have_count(0);expect(page.locator('.resource-tabs [aria-selected=true]')).to_be_focused();button('New workspace tab').click()
  button('Switch to Chinese').click();page.wait_for_timeout(200);shot('recent-dark-zh')
  for width in [820,390,320]:
   page.set_viewport_size({'width':width,'height':844});page.emulate_media(reduced_motion='reduce');bounded();expect(page.get_by_role('textbox',name='搜索工具或输入网址',exact=True)).to_be_visible()
   page.locator('.resource-tool-grid').get_by_role('button',name='文件',exact=True).click();expect(page.locator('.file-preview')).to_contain_text('Two independent Worker browsers');button('新建工作标签页').click();bounded()
   if width==390:shot('launcher-mobile-dark')
  checks.append('tab keyboard navigation/Delete/focus, Chinese/dark theme, 820/390/320px and reduced motion')
  # Last-tab close restores a usable launcher; hiding the panel remains a separate operation.
  page.set_viewport_size({'width':1500,'height':960});button('切换为英文').click()
  for _ in range(8):
   if page.locator('.resource-tabs [role=tab]').count()==1:break
   page.locator('.resource-tab-close').first.click()
  page.locator('.resource-tab-close').first.click();expect(tab('New tab')).to_have_attribute('aria-selected','true');expect(search).to_be_visible();button('Close panel').click();expect(page.locator('.resource-workspace')).to_have_count(0);expect(button('Session panel')).to_be_focused()
  checks.append('last view close recovers a launcher; panel close returns focus')
  assert not errors,errors
  assert not any('/configuration' in w or '/runs' in w or '/messages' in w for w in writes),writes
  result={'passed':True,'checks':checks,'pageErrors':errors,'realBrowser':True,'paidModelCalls':0,'configurationWrites':0};(out/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print(json.dumps(result,ensure_ascii=False,indent=2))
 except Exception:shot('failure');raise
 finally:browser.close()
