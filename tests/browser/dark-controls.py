"""Read-only contrast regression for lazily mounted configuration controls.
Usage: python dark-controls.py <acceptance host directory> <evidence directory>
No configuration edits or model calls, including when run against the live preview.
"""
import json,sys
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
root,out=map(Path,sys.argv[1:3]);out.mkdir(parents=True,exist_ok=True)
info=json.loads((root/'browser.json').read_text());base=info['base'];errors=[];writes=[];results=[]
contrast=r'''() => {
 const rgb=v=>(v.match(/[\d.]+/g)||[]).map(Number);
 const over=(a,b)=>{const alpha=a[3]??1;return a.slice(0,3).map((v,i)=>v*alpha+b[i]*(1-alpha))};
 const background=e=>{const chain=[];for(let n=e;n;n=n.parentElement)chain.unshift(n);return chain.reduce((c,n)=>over(rgb(getComputedStyle(n).backgroundColor),c),[255,255,255])};
 const lum=c=>c.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
 return [...document.querySelectorAll('.management-content .ui-seg__opt,.management-content .ui-button')].filter(e=>e.getBoundingClientRect().width&&e.getBoundingClientRect().height&&!e.disabled).map(e=>{
  const s=getComputedStyle(e),selected=e.getAttribute('aria-selected')==='true';
  // The selected pill is a sibling behind the text, not an ancestor background.
  const pill=selected?e.closest('.ui-seg').querySelector('.ui-seg__pill'):null;
  const bg=background(pill||e),fg=over(rgb(s.color),bg),a=lum(fg),b=lum(bg);
  return {text:e.textContent.trim().slice(0,60),selected,color:s.color,background:bg,ratio:+((Math.max(a,b)+.05)/(Math.min(a,b)+.05)).toFixed(2)};
 });
}'''
with sync_playwright() as p:
 browser=p.chromium.launch();ctx=browser.new_context(viewport={'width':1440,'height':960});name,value=info['cookie'].split('=',1);ctx.add_cookies([{'name':name,'value':value,'url':base}]);page=ctx.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.on('request',lambda r:writes.append(r.url) if r.method!='GET' else None)
 def capture(label):
  page.wait_for_timeout(550) # Let the existing pill/label and theme transitions settle.
  rows=page.evaluate(contrast);assert len(rows)>=4,(label,rows)
  failures=[r for r in rows if r['ratio']<4.5];assert not failures,(label,failures)
  results.append({'view':label,'minimumContrast':min(r['ratio'] for r in rows),'controls':rows})
  page.screenshot(path=str(out/(label+'.png')),animations='disabled')
 try:
  page.goto(base+'/chat');expect(page.get_by_role('textbox',name='Message Router',exact=True)).to_be_visible()
  page.get_by_role('button',name='Switch to dark mode',exact=True).click()
  page.get_by_role('link',name='Agent team',exact=True).click();expect(page.locator('.execution-mode-tabs')).to_be_visible()
  page.locator('.execution-mode-tabs').get_by_role('tab',name='Live activity',exact=True).click()
  expect(page.locator('.execution-call-overview')).to_be_visible();capture('lazy-dark')
  expect(page.locator('.execution-page .ui-seg__pill').first).to_have_css('background-color','rgb(25, 25, 25)')
  expect(page.locator('.execution-page .ui-button').first).to_have_css('background-color','rgb(25, 25, 25)')
  secondary=page.locator('.execution-page .ui-button[data-variant=secondary]').first;secondary.hover();capture('hover-dark');page.mouse.move(10,10)
  page.get_by_role('button',name='Edit Router instructions',exact=True).click();expect(page.locator('#execution-instructions')).to_be_visible();capture('dialog-dark')
  primary=page.locator('#execution-instructions .ui-button[data-variant=primary]');expect(primary).to_have_css('color','rgb(23, 23, 23)');expect(primary).to_have_css('background-color','rgb(245, 245, 245)')
  page.locator('#execution-instructions').get_by_role('button',name='Close',exact=True).click()
  page.get_by_role('button',name='Switch to light mode',exact=True).click();capture('light')
  expect(page.locator('.execution-page .ui-seg__pill').first).to_have_css('background-color','rgb(255, 255, 255)')
  page.get_by_role('button',name='Switch to dark mode',exact=True).click();page.reload();expect(page.locator('.execution-call-overview')).to_be_visible();capture('reload-dark')
  # Switching the selected actor checks both the moving selection and inactive text.
  actors=page.locator('.execution-actor-tabs [role=tab]');actors.nth(1).click();capture('worker-dark');actors.nth(0).click()
  page.get_by_role('button',name='Switch to Chinese',exact=True).click();capture('chinese-dark')
  page.set_viewport_size({'width':390,'height':844});page.emulate_media(reduced_motion='reduce');capture('mobile-dark')
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  assert not errors,errors;assert not writes,writes
  result={'passed':True,'pageErrors':errors,'requestsOtherThanGET':0,'contrastThreshold':4.5,'views':results};(out/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));print(json.dumps({'passed':True,'views':len(results),'minimumContrast':min(r['minimumContrast'] for r in results),'pageErrors':errors,'requestsOtherThanGET':0}))
 except Exception:page.screenshot(path=str(out/'failure.png'),animations='disabled');raise
 finally:browser.close()
