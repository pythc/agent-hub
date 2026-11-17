from pathlib import Path
import json,re
from playwright.sync_api import sync_playwright
out=Path('.evidence/english');out.mkdir(parents=True,exist_ok=True)
errors=[];checks=[];failures=[];metrics=[]
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True)
 page=browser.new_page(viewport={'width':1800,'height':1150})
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto('http://localhost:3418/Roppo-English');page.wait_for_load_state('networkidle')
 def seek(frame):
  page.keyboard.press('g');f=page.locator('input:focus');f.fill(str(frame));f.press('Enter');page.wait_for_timeout(150)
 def active():
  cams=page.locator('.camera')
  inds=[i for i in range(cams.count()) if cams.nth(i).evaluate('e=>e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})')]
  assert len(inds)==1,(inds,page.url)
  return cams.nth(inds[0])
 samples=[(300,'Your 24/7 assistant'),(498,'Opening your workspace'),(735,'Connection saved'),(975,'Run your local Codex CLI'),(1230,'Saved'),(1470,'Role instructions'),(1725,'#product-engineering'),(1830,'jev-latest'),(1890,'local-judge'),(1950,'Use an existing API connection'),(2055,'Standing by'),(2370,'Accept and delegate'),(2720,'ENG-248'),(2790,'Todo'),(2950,'In Progress'),(3150,'Task accepted'),(3400,'Research'),(3720,'Your control'),(3780,'Research is in control'),(4030,'Order export · Verification'),(4200,'Execution stopped'),(4280,'Resumed the same task'),(4380,'In Progress'),(4590,'In Review'),(4830,'Thanks!'),(5040,'Workspace ready')]
 for frame,text in samples:
  seek(frame);cam=active();rendered=cam.inner_text()
  if text not in rendered:failures.append({'frame':frame,'missing':text})
  if re.search(r'[\u4e00-\u9fff]|Feishu|飞书',rendered):failures.append({'frame':frame,'nonEnglish':rendered})
  geometry=cam.evaluate('''el=>{const issues=[];for(const e of el.querySelectorAll('h1,h2,.settings-title,.slack-message,.linear-result,.decision-pipeline>section')){const r=e.getBoundingClientRect();if(e.checkVisibility({checkOpacity:true})&&e.scrollWidth>e.clientWidth+3)issues.push({class:e.className,text:e.textContent.slice(0,80),width:e.clientWidth,scroll:e.scrollWidth});}return issues}''')
  if geometry:failures.append({'frame':frame,'overflow':geometry})
 checks.append('26 English content and state checks; no Feishu or Chinese in active UI')
 hits=[(666,'.ui-field:has(label:text-is("Default model")) .input'),(855,'[data-runtime="1"]'),(924,'[data-runtime="2"]'),(1065,'.team-inspector .ui-field:has(label:text-is("Model")) .input'),(1122,'.team-inspector .ui-field:has(label:text-is("Reasoning effort")) .input'),(1215,'.team-inspector .ui-button'),(1380,'[data-role="Research"]'),(1455,'.product-page>.settings-title .ui-button'),(1695,'.ecosystem-router .ui-button'),(1845,'[data-decision-provider="1"]'),(1911,'[data-decision-provider="2"]'),(1980,'.decision-settings-footer .ui-button'),(2451,'[data-slack-input]'),(2535,'[data-slack-send]'),(2721,'[data-slack-issue]'),(3699,'.browser-owner .ui-button'),(4164,'.send'),(4779,'[data-slack-input]'),(4818,'[data-slack-send]')]
 for frame,selector in hits:
  seek(frame);cam=active();cur=cam.locator('[data-demo-cursor]').bounding_box();tar=cam.locator(selector).first.bounding_box();box=cam.bounding_box();scale=box['width']/1440
  hit=bool(cur and tar and tar['x']<=cur['x']<=tar['x']+tar['width'] and tar['y']<=cur['y']<=tar['y']+tar['height'])
  metrics.append({'frame':frame,'selector':selector,'hit':hit,'targetCenter':[(tar['x']+tar['width']/2-box['x'])/scale,(tar['y']+tar['height']/2-box['y'])/scale]})
  if not hit:failures.append(metrics[-1])
 checks.append('19 simulated clicks target visible controls')
 for frame in [2720,4830]:
  seek(frame);cam=active();message=cam.locator('.slack-messages').bounding_box();composer=cam.locator('.slack-composer').bounding_box()
  if message['y']+message['height']>composer['y']:failures.append({'frame':frame,'overlappingComposer':True})
 for frame in [2950,4590]:
  seek(frame);cam=active();body=cam.locator('.linear-issue-inner').bounding_box();screen=cam.locator('.linear-app').bounding_box()
  if body['y']+body['height']>screen['y']+screen['height']:failures.append({'frame':frame,'linearBottomOverflow':True})
 checks.append('Slack messages and Linear evidence fit their viewports')
 for comp,text in [('Slack-Intake-EN','ENG-248'),('Linear-Intake-EN','In Progress'),('Linear-Review-EN','In Review'),('Slack-Delivery-EN','verification-report.md')]:
  page.goto('http://localhost:3418/'+comp);page.wait_for_load_state('networkidle');seek(240)
  if text not in active().inner_text():failures.append({'composition':comp,'missing':text})
 checks.append('All four integration scenes load independently')
 (out/'verification.json').write_text(json.dumps({'checks':checks,'failures':failures,'clicks':metrics,'pageErrors':errors},indent=2))
 print(json.dumps({'failures':failures,'pageErrors':errors},ensure_ascii=False))
 browser.close()
 assert not errors and not failures
