"""Actual click, refresh, cancellation and motion acceptance for O07."""
import json,os,sys,time,uuid
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
root=Path(sys.argv[1]);info=json.loads((root/'browser.json').read_text());out=root/'screenshots';out.mkdir(exist_ok=True)
checks=[];errors=[]
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path=os.environ.get('CHROMIUM_EXECUTABLE','/usr/bin/chromium'),args=['--no-sandbox','--no-zygote'])
 context=browser.new_context(viewport={'width':1440,'height':1100})
 name,value=info['cookie'].split('=',1);context.add_cookies([{'name':name,'value':value,'url':info['base']}])
 page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
 def shot(name):page.screenshot(path=str(out/name),full_page=True)
 def facet(name):return page.locator('[data-facet="'+name+'"]')
 def select(ticket):page.get_by_label('Show',exact=True).select_option(ticket)
 try:
  page.goto(info['url']);select(info['verifiedTicketId'])
  expect(facet('execution')).to_have_attribute('data-state','finished')
  expect(facet('acceptance')).to_have_attribute('data-state','passed')
  expect(facet('delivery')).to_have_attribute('data-state','held')
  expect(facet('delivery')).not_to_contain_text('Read back')
  shot('status-current-light.png');checks.append('real local goal completed and independently verified while held delivery remains separate')
  page.reload();select(info['verifiedTicketId']);expect(facet('acceptance')).to_have_attribute('data-state','passed')
  change=str(uuid.uuid4());(root/'control.json').write_text(json.dumps({'action':'change_artifact','id':change}))
  deadline=time.monotonic()+5
  while not (root/'control-result.json').exists():
   assert time.monotonic()<deadline;time.sleep(.05)
  page.get_by_role('button',name='Refresh',exact=True).click();expect(facet('acceptance')).to_have_attribute('data-state','stale')
  page.get_by_role('button',name='Switch to dark mode',exact=True).click();shot('status-stale-dark.png')
  page.reload();select(info['verifiedTicketId']);expect(facet('acceptance')).to_have_attribute('data-state','stale')
  checks.append('artifact changed after current acceptance; actual refresh and full reload show stale without rewriting passed round')
  select(info['unknownTicketId']);expect(facet('effects')).to_have_attribute('data-state','unknown')
  expect(page.get_by_role('button',name='Resume original session',exact=True)).not_to_be_visible()
  page.get_by_role('button',name='Stop task',exact=True).click();page.locator('.trace-confirm').get_by_role('button',name='Stop task',exact=True).click()
  expect(facet('execution')).to_have_attribute('data-state','cancelled');expect(facet('effects')).to_have_attribute('data-state','unknown')
  shot('status-cancelled-unknown-dark.png');page.reload();select(info['unknownTicketId'])
  expect(facet('execution')).to_have_attribute('data-state','cancelled');expect(facet('effects')).to_have_attribute('data-state','unknown')
  checks.append('cancel through real recovery API preserves unknown effect and cannot revive after reload')
  page.emulate_media(reduced_motion='reduce');page.set_viewport_size({'width':390,'height':844})
  expect(facet('execution')).to_be_visible();assert page.locator('html').evaluate('(e)=>e.scrollWidth<=e.clientWidth+1')
  assert page.locator('.trace-status').evaluate("e=>Array.from(e.querySelectorAll('*')).every(n=>getComputedStyle(n).animationName==='none'||parseFloat(getComputedStyle(n).animationDuration)<=0.001)")
  page.get_by_label('Show',exact=True).focus();page.keyboard.press('Tab');shot('status-mobile-reduced-motion.png')
  page.set_viewport_size({'width':1440,'height':1100});page.get_by_role('button',name='Switch to Chinese',exact=True).click()
  expect(page.locator('.trace-page h1')).to_have_text('执行轨迹');shot('status-chinese-dark.png')
  checks.append('actual narrow page, dark/light, keyboard focus, reduced motion and Chinese rendering')
  assert not errors,errors
  report={'result':'passed','checks':checks,'pageErrors':errors,'mode':info['mode'],'realIm':False,'realAcp':False,'screenshots':[str(s) for s in out.glob('*.png')]}
  (root/'browser-report.json').write_text(json.dumps(report,indent=2,ensure_ascii=False));print(json.dumps(report,ensure_ascii=False))
 except Exception:
  shot('failure.png');(root/'browser-failure.json').write_text(json.dumps({'checks':checks,'pageErrors':errors,'url':page.url},indent=2));raise
 finally:browser.close()
