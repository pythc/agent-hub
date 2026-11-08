from pathlib import Path
import json
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1]
info=json.loads((root/'.capture-host/browser.json').read_text())
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True)
 context=browser.new_context(viewport={'width':1440,'height':810},device_scale_factor=1,reduced_motion='reduce')
 page=context.new_page()
 page.goto(info['base']+'/auth');page.wait_for_load_state('networkidle')
 page.screenshot(path=str(root/'public/captures/login.png'))
 cookie_name,cookie_value=info['cookie'].split('=',1)
 context.add_cookies([{'name':cookie_name,'value':cookie_value,'url':info['base']}])
 page.goto(info['base']+'/chat');page.wait_for_load_state('networkidle')
 page.evaluate("localStorage.setItem('agenthub.configuration.language','zh-CN')")
 page.reload();page.wait_for_load_state('networkidle')
 page.screenshot(path=str(root/'public/captures/chat-empty.png'))
 (root/'.evidence/chat-dom.txt').write_text(page.locator('body').inner_text()+'\n'+str(page.get_by_role('button').evaluate_all('(els)=>els.map(e=>({text:e.textContent,label:e.getAttribute("aria-label"),title:e.title}))')))
 page.goto(info['base']+'/configure#models');page.wait_for_load_state('networkidle');page.screenshot(path=str(root/'public/captures/models.png'))
 page.goto(info['base']+'/configure#execution');page.wait_for_load_state('networkidle');page.screenshot(path=str(root/'public/captures/team.png'))
 (root/'.evidence/team-dom.txt').write_text(page.locator('body').inner_text())
 browser.close()
print('Captured isolated Roppo UI references')
