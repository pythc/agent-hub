"""Real local Chromium + Roppo UI acceptance. Only synthetic local accounts.
Run against examples/browser-acceptance.ts fixture, never a user's workspace.
"""
import asyncio,json,sys,uuid
from pathlib import Path
from playwright.async_api import async_playwright,expect
from resource_helpers import open_resource_async

async def main():
 root=Path(sys.argv[1]);out=Path(sys.argv[2]);out.mkdir(parents=True,exist_ok=True)
 info=json.loads((root/'browser.json').read_text());assert not info['native']
 base=info['base'];checks=[];errors=[]
 async def remote(session,*args):
  current=next(s for s in (await state())['sessions'] if s['id']==session)
  process=await asyncio.create_subprocess_exec('node_modules/.bin/agent-browser','--config',str((root/'state/browser/driver.json').resolve()),'--session','roppo-'+session,'--profile',str((root/'state/browser'/('profiles' if current['personal'] else 'tasks')/(current['profileId'] if current['personal'] else session)).resolve()),'--json',*args,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.PIPE)
  stdout,_=await process.communicate();assert process.returncode==0
  value=json.loads(stdout);assert value['success'];return value['data']
 async with async_playwright() as p:
  browser=await p.chromium.launch(headless=True);context=await browser.new_context(viewport={'width':1500,'height':960})
  name,value=info['cookie'].split('=',1);await context.add_cookies([{'name':name,'value':value,'url':base}])
  page=await context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
  async def state():
   response=await page.request.get(base+'/api/browser');assert response.ok;return await response.json()
  async def selected():
   sid=await page.get_by_label('Browser session',exact=True).input_value();data=await state();return next(s for s in data['sessions'] if s['id']==sid)
  async def wait_state(predicate,timeout=30):
   for _ in range(timeout*5):
    value=await state()
    if predicate(value):return value
    await asyncio.sleep(.2)
   raise AssertionError('Browser state did not settle')
  async def click_remote(selector):
   s=await selected();box=await remote(s['id'],'get','box',selector)
   img=page.get_by_alt_text('Live browser page');r=await img.bounding_box();size=await img.evaluate('(e)=>({w:e.naturalWidth,h:e.naturalHeight})')
   scale=min(r['width']/size['w'],r['height']/size['h']);x=r['x']+(r['width']-size['w']*scale)/2+(box['x']+box['width']/2)*scale;y=r['y']+(r['height']-size['h']*scale)/2+(box['y']+box['height']/2)*scale
   await page.mouse.click(x,y)
  try:
   await page.goto(base+'/chat');await page.get_by_role('button',name='Session panel',exact=True).click();await open_resource_async(page,'Browser');await page.get_by_role('button',name='Create browser',exact=True).wait_for()
   data=await state()
   for stale in [s for s in data['sessions'] if not s['personal']]:
    cid=str(uuid.uuid4());lease=await(await page.request.post(base+'/api/browser/sessions/'+stale['id']+'/takeover',data={'client':cid,'force':True})).json()
    response=await page.request.post(base+'/api/browser/sessions/'+stale['id']+'/close',data={'client':cid,'epoch':lease['epoch']});assert response.ok
   if not data['profiles']:
    await page.get_by_role('button',name='Create browser',exact=True).click();await page.get_by_label('Name',exact=True).fill('Browser Lab');await page.get_by_label('Research',exact=True).check();await page.get_by_label('Review',exact=True).check();await page.get_by_role('button',name='Save',exact=True).click()
   else:await page.get_by_role('button',name='Browser Lab',exact=True).click()
   await page.get_by_alt_text('Live browser page').wait_for(timeout=30000)
   transfer=page.get_by_role('button',name='Take over here',exact=True)
   if await transfer.count():await transfer.click()
   address=page.get_by_label('Website address',exact=True);await expect(address).to_be_enabled()
   while await page.locator('.browser-tabs [role=tab]').count()>1:
    count=await page.locator('.browser-tabs [role=tab]').count();await page.locator('.browser-tabs > div > button:last-child').last.click();await expect(page.locator('.browser-tabs [role=tab]')).to_have_count(count-1)
   await address.fill(info['site']+'/login');await address.press('Enter');await expect(address).to_be_enabled(timeout=30000)
   await page.get_by_role('button',name='Saved accounts',exact=True).click()
   await page.get_by_label('Account name',exact=True).fill('Browser Lab account')
   await page.get_by_label('Sign-in URL',exact=True).fill(info['site']+'/login')
   await page.get_by_label('Username',exact=True).fill('demo');await page.get_by_label('Password',exact=True).fill('Roppo-demo-2026!')
   await page.get_by_role('button',name='Save account',exact=True).click()
   await expect(page.locator('.browser-account-list').get_by_text('Browser Lab account',exact=True).last).to_be_visible()
   data=await state();assert all('password' not in a for a in data['credentials'])
   assert 'Roppo-demo-2026!' not in (root/'state/browser/vault/credentials.json').read_text()
   await page.get_by_role('button',name='Fill',exact=True).last.click();await expect(page.locator('dialog')).to_have_count(0)
   await expect(address).to_be_enabled(timeout=30000)
   assert 'Roppo-demo-2026!' not in (await remote((await selected())['id'],'snapshot','-c'))['snapshot']
   await page.get_by_label('Browser keyboard input',exact=True).focus();await page.keyboard.press('Enter')
   await wait_state(lambda d:any(s['url'].endswith('/dashboard') for s in d['sessions']))
   s=await selected();assert 'Welcome, Alice' in (await remote(s['id'],'snapshot'))['snapshot']
   checks.append('saved credentials are encrypted and real browser login succeeds through the UI')
   print('PASS login',flush=True)
   await click_remote('#note');await page.keyboard.press('Meta+a');await page.keyboard.type('Persistent profile note')
   for _ in range(60):
    if (await remote(s['id'],'get','value','#note'))['value']=='Persistent profile note':break
    await asyncio.sleep(.2)
   else:raise AssertionError('Remote text input failed')
   await page.get_by_role('button',name='Close this browser',exact=True).click()
   await wait_state(lambda d:not any(v['id']==s['id'] for v in d['sessions']))
   await page.get_by_role('button',name='Browser Lab',exact=True).click();await page.get_by_alt_text('Live browser page').wait_for(timeout=30000)
   restored=await selected();assert restored['id']!=s['id'];assert restored['url'].endswith('/dashboard')
   assert (await remote(restored['id'],'get','value','#note'))['value']=='Persistent profile note'
   checks.append('closing and reopening restores the authenticated page and local storage')
   print('PASS persistence',flush=True)
   await page.get_by_role('button',name='Saved accounts',exact=True).click();await page.keyboard.press('Escape');await expect(page.locator('dialog')).to_have_count(0);await expect(page.locator('.browser-panel')).to_be_visible()
   await page.get_by_label('Browser keyboard input',exact=True).focus();await page.keyboard.press('Escape');await expect(page.locator('.browser-panel')).to_be_visible();await page.keyboard.press('F6');await expect(address).to_be_focused()
   await page.get_by_role('button',name='New tab',exact=True).click();await expect(page.locator('.browser-tabs [role=tab]')).to_have_count(len(restored['tabs'])+1);await page.locator('.browser-tabs [role=tab]').first.click();await expect(address).to_have_value(info['site']+'/dashboard')
   await page.get_by_role('button',name='Close tab New tab',exact=True).click();await expect(page.locator('.browser-tabs [role=tab]')).to_have_count(len(restored['tabs']))
   await page.screenshot(path=str(out/'browser-light.png'))
   await page.get_by_label('Message Router',exact=True).fill('Open the browser lab using both Workers.');await page.get_by_role('button',name='Send message',exact=True).click()
   data=await wait_state(lambda d:len([s for s in d['sessions'] if not s['personal'] and s['control']=='paused'])==2,60)
   workers=[s for s in data['sessions'] if not s['personal']];assert len({s['id'] for s in workers})==2
   for s in workers:assert 'Welcome, Alice' in (await remote(s['id'],'snapshot'))['snapshot']
   checks.append('Router fixture invokes two actual Worker tool chains and each browser inherits authorized login')
   print('PASS workers',flush=True)
   await page.get_by_label('Browser session',exact=True).select_option(workers[0]['id'])
   await page.get_by_role('button',name='Take control',exact=True).click()
   await expect(page.get_by_role('button',name='Return to Worker',exact=True)).to_be_visible()
   await click_remote('#note');await page.keyboard.press('Meta+a');await page.keyboard.type('Only worker A')
   for _ in range(60):
    if (await remote(workers[0]['id'],'get','value','#note'))['value']=='Only worker A':break
    await asyncio.sleep(.2)
   else:raise AssertionError('Worker takeover typing failed')
   assert (await remote(workers[1]['id'],'get','value','#note'))['value']=='Persistent profile note'
   assert (await remote(restored['id'],'get','value','#note'))['value']=='Persistent profile note'
   checks.append('manual input in Worker A does not modify Worker B or the persistent user browser')
   await page.screenshot(path=str(out/'worker-takeover-light.png'))
   await page.get_by_role('button',name='Switch to dark mode',exact=True).click();await page.screenshot(path=str(out/'worker-takeover-dark.png'))
   assert await page.evaluate('document.documentElement.dataset.theme')=='dark'
   await page.get_by_role('button',name='Expand panel',exact=True).click();await expect(page.locator('.thread')).to_have_attribute('inert','')
   await page.screenshot(path=str(out/'browser-expanded-dark.png'))
   await page.get_by_role('button',name='Collapse panel',exact=True).click()
   await page.set_viewport_size({'width':390,'height':844});await page.emulate_media(reduced_motion='reduce')
   assert await page.evaluate('document.documentElement.scrollWidth<=innerWidth')
   assert await page.evaluate('document.documentElement.scrollHeight<=innerHeight')
   await page.screenshot(path=str(out/'browser-mobile-dark.png'))
   await page.set_viewport_size({'width':1500,'height':960})
   await page.get_by_role('button',name='Return to Worker',exact=True).click()
   checks.append('light/dark, expanded, narrow viewport and reduced-motion preserve control UI')
   assert not errors,errors
   result={'passed':True,'checks':checks,'pageErrors':errors,'realBrowser':True,'model':'fixture','credentials':'synthetic local site only'}
   (out/'ui-result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print(json.dumps(result,ensure_ascii=False),flush=True)
  except Exception:
   await page.screenshot(path=str(out/'failure.png'));raise
  finally:await browser.close()

asyncio.run(main())
