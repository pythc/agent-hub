from pathlib import Path
import json
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parents[1];info=json.loads((root/'.capture-host/browser.json').read_text())
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True);context=browser.new_context(viewport={'width':1440,'height':810},reduced_motion='reduce')
 n,v=info['cookie'].split('=',1);context.add_cookies([{'name':n,'value':v,'url':info['base']}])
 page=context.new_page();page.goto(info['base']+'/configure#models');page.wait_for_load_state('networkidle');page.evaluate("localStorage.setItem('agenthub.configuration.language','zh-CN')");page.reload();page.wait_for_load_state('networkidle')
 page.get_by_role('button',name='新建模型连接',exact=True).click();page.wait_for_load_state('networkidle');page.wait_for_timeout(2500)
 page.screenshot(path=str(root/'public/captures/connection-new.png'))
 (root/'.evidence/connection-dom.txt').write_text(page.locator('body').inner_text())
 page.goto(info['base']+'/configure#execution');page.wait_for_load_state('networkidle');page.get_by_role('tab',name='配置团队',exact=True).click();page.wait_for_timeout(250)
 page.screenshot(path=str(root/'public/captures/team-config.png'))
 page.goto(info['base']+'/chat');page.wait_for_load_state('networkidle');page.get_by_role('button',name='会话面板',exact=True).click();page.wait_for_timeout(200)
 page.screenshot(path=str(root/'public/captures/resources.png'))
 (root/'.evidence/resources-dom.txt').write_text(page.locator('body').inner_text())
 browser.close()
