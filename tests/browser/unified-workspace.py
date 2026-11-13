"""Shared application shell + conversation resource tabs, using a real isolated host.
Run browser-workspace.py first on the same synthetic fixture to create real Worker browsers.
"""
import asyncio,json,sys
from pathlib import Path
from urllib.parse import urlparse,parse_qs
from playwright.async_api import async_playwright,expect
from resource_helpers import open_resource_async, open_workspace_async

async def main():
 root=Path(sys.argv[1]);out=Path(sys.argv[2]);out.mkdir(parents=True,exist_ok=True)
 info=json.loads((root/'browser.json').read_text());assert not info['native'];base=info['base'];checks=[];errors=[]
 (root/'workspace'/'result.md').write_text('# Browser research\n\nTwo independent Worker browsers inspected the local lab.\n')
 async with async_playwright() as p:
  browser=await p.chromium.launch();context=await browser.new_context(viewport={'width':1500,'height':960})
  name,value=info['cookie'].split('=',1);await context.add_cookies([{'name':name,'value':value,'url':base}])
  page=await context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
  conversations=(await(await page.request.get(base+'/api/chat/conversations')).json())['conversations']
  original=next(c for c in conversations if c['title'])['id']
  try:
   await page.goto(base+'/chat?conversation='+original);await expect(page.get_by_label('Message Router',exact=True)).to_be_visible()
   await page.evaluate('window.shellBefore=document.querySelector(".chat-sidebar");window.documentBefore=crypto.randomUUID()');marker=await page.evaluate('window.documentBefore')
   await expect(page.get_by_role('link',name='My browser',exact=True)).to_have_count(0)
   await page.get_by_role('button',name='Session panel',exact=True).click();await open_resource_async(page,'Files');await page.get_by_role('button',name='result.md',exact=True).click();await expect(page.locator('.file-preview')).to_contain_text('Two independent Worker browsers')
   await page.screenshot(path=str(out/'conversation-files-light.png'));checks.append('Files renders actual conversation task content')
   await open_resource_async(page,'Team activity');await open_resource_async(page,'Files');await expect(page.locator('.file-preview')).to_contain_text('Two independent Worker browsers');await page.get_by_label('Message Router',exact=True).fill('Keep my conversation draft')
   for label in ['Current workspace','Tasks','Agent team','Model connections','Settings']:
    await page.get_by_role('link',name=label,exact=True).click()
    if label=='Current workspace':await page.get_by_role('dialog',name='Switch workspace').get_by_role('button',name='Close',exact=True).click()
    await expect(page.locator('.configuration-outlet #main h1').first).to_be_visible()
    assert await page.evaluate('window.shellBefore===document.querySelector(".chat-sidebar")')
    assert await page.evaluate('window.documentBefore')==marker
    await expect(page.locator('#operator-sidebar,.entry-shell')).to_have_count(0)
    await expect(page.locator('.configuration-outlet .workspace-page-loading')).to_have_count(0)
    await expect(page.locator('.configuration-outlet .alert.error')).to_have_count(0)
   checks.append('all management routes reuse the same live navigation DOM and document')
   await page.get_by_role('link',name='Agent team',exact=True).click();model=page.locator('#team-model');await expect(model).to_have_value('gpt-6.1-terra');await model.fill('draft-model-do-not-save')
   await page.get_by_role('link',name='Conversations',exact=True).click();await expect(page.get_by_label('Message Router',exact=True)).to_have_value('Keep my conversation draft')
   await page.get_by_role('link',name='Agent team',exact=True).click();await expect(model).to_have_value('draft-model-do-not-save')
   await page.get_by_role('button',name='Switch to dark mode',exact=True).click();await expect(model).to_have_value('draft-model-do-not-save')
   await page.get_by_role('button',name='Switch to Chinese',exact=True).click();await expect(model).to_have_value('draft-model-do-not-save');await expect(page.locator('.chat-breadcrumb')).to_contain_text('Agent 团队')
   await page.get_by_role('button',name='切换为英文',exact=True).click();await model.fill('gpt-6.1-terra')
   await page.get_by_role('link',name='Conversations',exact=True).click();await page.go_back();await expect(model).to_be_visible();await page.go_forward();await expect(page.get_by_label('Message Router',exact=True)).to_have_value('Keep my conversation draft')
   checks.append('configuration and conversation drafts survive navigation, language, theme and history')
   await page.get_by_role('link',name='Current workspace',exact=True).click();await expect(page.get_by_role('dialog',name='Switch workspace')).to_be_visible();await page.get_by_role('button',name='Close',exact=True).click()
   await open_workspace_async(page);await page.screenshot(path=str(out/'workspace-dark.png'))
   await page.get_by_role('link',name='Conversations',exact=True).click();await open_resource_async(page,'Browser');await expect(page.get_by_alt_text('Live browser page')).to_be_visible(timeout=30000)
   sid=await page.get_by_label('Browser session',exact=True).input_value();await open_resource_async(page,'Team activity');await expect(page.locator('.team-panel')).to_be_visible();await open_resource_async(page,'Browser');await expect(page.get_by_label('Browser session',exact=True)).to_have_value(sid)
   await open_workspace_async(page)
   for _ in range(30):
    state=await(await page.request.get(base+'/api/browser')).json()
    if not next(s for s in state['sessions'] if s['id']==sid)['streaming']:break
    await asyncio.sleep(.2)
   else:raise AssertionError('hidden browser stream still active')
   await page.get_by_role('link',name='Conversations',exact=True).click();await expect(page.get_by_label('Browser session',exact=True)).to_have_value(sid)
   checks.append('browser tab and control state survive panel switching; hidden browser stops its stream')
   # Legacy conversation APIs remain isolated; the user-facing chat stays fixed.
   new=(await(await page.request.post(base+'/api/chat/conversations',data={})).json())['id'];assert new!=original
   listed=await(await page.request.get(base+'/api/browser?conversation='+new)).json();assert listed['sessions']==[]
   assert (await(await page.request.get(base+'/api/chat/space')).json())['conversation']['id']==original
   await expect(page.get_by_role('button',name='New conversation',exact=True)).to_have_count(0)
   await expect(page.get_by_label('Browser session',exact=True)).to_have_value(sid)
   checks.append('fixed chat retains files and browser; legacy conversation APIs keep browser ownership isolated')
   await open_resource_async(page,'Team activity');await expect(page.locator('.team-panel .worker-node')).to_have_count(2);await page.screenshot(path=str(out/'conversation-team-dark.png'),animations='disabled')
   await page.get_by_role('tab',name='Files',exact=True).focus();await page.keyboard.press('End');await expect(page.locator('.resource-tabs [role=tab]').last).to_be_focused();await page.keyboard.press('Home');await expect(page.locator('.resource-tabs [role=tab]').first).to_have_attribute('aria-selected','true')
   await page.set_viewport_size({'width':390,'height':844});await page.emulate_media(reduced_motion='reduce');await open_resource_async(page,'Browser');await expect(page.get_by_alt_text('Live browser page')).to_be_visible(timeout=30000)
   assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth && document.documentElement.scrollHeight<=innerHeight')
   await page.screenshot(path=str(out/'conversation-browser-mobile.png'));await page.get_by_role('button',name='Close panel',exact=True).click();await expect(page.get_by_label('Message Router',exact=True)).to_be_visible()
   await page.get_by_role('button',name='Open navigation',exact=True).click();await open_workspace_async(page);await expect(page.locator('.configuration-outlet #main h1').first).to_be_visible();assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth && document.documentElement.scrollHeight<=innerHeight')
   await expect(page.locator('.chat-shell')).not_to_have_class(__import__('re').compile('.*menu-open.*'));await page.screenshot(path=str(out/'workspace-mobile-dark.png'),animations='disabled');checks.append('keyboard tab navigation, mobile drawer, bounded viewport and reduced motion')
   assert not errors,errors
   result={'passed':True,'checks':checks,'pageErrors':errors,'model':'fixture','browser':'real Chromium'};print(json.dumps(result,ensure_ascii=False,indent=2));(out/'unified-result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
  except Exception:
   await page.screenshot(path=str(out/'unified-failure.png'));raise
  finally:await browser.close()
asyncio.run(main())
