from playwright.sync_api import sync_playwright
import json
from pathlib import Path
with sync_playwright() as p:
 b=p.chromium.launch(headless=True);page=b.new_page(viewport={'width':1700,'height':1100});page.goto('http://localhost:3417/Roppo-Concept');page.wait_for_load_state('networkidle')
 out={}
 for frame in [450,660,975,1260,1440,1800,2070,2280,2640]:
  page.keyboard.press('g');field=page.locator('input[type=text]');field.last.fill(str(frame));field.last.press('Enter');page.wait_for_timeout(160)
  out[frame]=page.locator('.camera:visible').evaluate('''cam=>{const r=cam.getBoundingClientRect(),s=r.width/1440;return [...cam.querySelectorAll('.input,.ui-button,.team-node,.send,.resource-tabs>div,.feishu-send,.message-attachment,.connection-kind,.file-row')].map(e=>{const q=e.getBoundingClientRect();return {text:e.textContent?.slice(0,90),x:Math.round((q.x+q.width/2-r.x)/s),y:Math.round((q.y+q.height/2-r.y)/s)}})}''')
 print(json.dumps(out,ensure_ascii=False,indent=2));Path('.evidence/element-positions.json').write_text(json.dumps(out,ensure_ascii=False,indent=2));b.close()
