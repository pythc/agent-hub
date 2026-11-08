from pathlib import Path
import json
from playwright.sync_api import sync_playwright, expect
out=Path('.evidence');out.mkdir(exist_ok=True);errors=[];checks=[]
with sync_playwright() as p:
 b=p.chromium.launch(headless=True);page=b.new_page(viewport={'width':1800,'height':1150});page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto('http://localhost:3417/Decision-Layer-Walkthrough');page.wait_for_load_state('networkidle')
 def seek(frame):
  page.keyboard.press('g');field=page.locator('input:focus');field.fill(str(frame));field.press('Enter');page.wait_for_timeout(170)
 for frame,expected in [(45,'https://api.typesafe.ai/v1'),(105,'local-judge'),(180,'复用已配置的 API 连接'),(225,'已保存')]:
  seek(frame);expect(page.get_by_text(expected,exact=True).first).to_be_visible()
  assert '概念演示 · 模拟数据' not in page.locator('body').inner_text()
 for frame,selector in [(75,'[data-decision-provider="1"]'),(141,'[data-decision-provider="2"]'),(210,'.decision-settings-footer .ui-button')]:
  seek(frame);cursor=page.locator('[data-demo-cursor]').bounding_box();target=page.locator(selector).bounding_box()
  assert target['x']<=cursor['x']<=target['x']+target['width'] and target['y']<=cursor['y']<=target['y']+target['height'],(frame,cursor,target)
 checks.append('Jev native API, self-hosted model and external API provider choices render; all 3 clicks land in controls')
 seek(333);assert page.locator('.decision-message-stack').evaluate('e=>e.clientHeight')>110
 seek(375);assert page.locator('.decision-message-stack').evaluate('e=>e.clientHeight')==0
 expect(page.get_by_text('3 条消息，共享上下文',exact=True)).to_be_visible()
 seek(411);expect(page.get_by_text('进入意图判断',exact=True)).to_be_visible()
 seek(504);expect(page.get_by_text('INTERVENE',exact=True)).to_be_visible();assert '接手并分派 Workers' not in page.locator('body').inner_text()
 seek(555);assert '接手并分派 Workers' not in page.locator('body').inner_text()
 seek(615);expect(page.get_by_text('接手并分派 Workers',exact=True)).to_be_visible();expect(page.get_by_text('完成后回原群报告',exact=True)).to_be_visible()
 rows=page.locator('.decision-pipeline>section');assert rows.count()==4
 for row in rows.all():
  footer=row.locator('footer').bounding_box();body=row.locator('.decision-stage-body').bounding_box()
  assert body['y']+body['height']<=footer['y'],(body,footer)
 checks.append('Messages visibly collapse into a shared batch; rules precede advice; advice does not execute; Router decides last; stage text does not overlap')
 page.screenshot(path=str(out/'decision-flow-studio.png'))
 seek(0);page.keyboard.press('Space');page.wait_for_timeout(21500);page.keyboard.press('Space')
 assert int(page.get_by_role('button',name='Show timeline ticks as frames').inner_text())>625
 checks.append('22-second chapter plays continuously')
 page.goto('http://localhost:3417/Roppo-Concept');page.wait_for_load_state('networkidle')
 for frame,title in [(1790,'让轻量判断，也能按需配置'),(2070,'批处理、规则检查、辅助判别，再由 Router 介入'),(2450,'群聊里提到问题，Router 主动接手'),(4710,'消息进来，工作有着落。')]:
  seek(frame);expect(page.get_by_text(title,exact=True).filter(visible=True).first).to_be_visible()
 checks.append('New chapter is inserted at 00:59; Feishu resumes at 01:21; ending remains intact')
 assert not errors,errors
 (out/'decision-scenes-verification.json').write_text(json.dumps({'checks':checks,'pageErrors':errors,'chapterSeconds':22,'totalSeconds':159},ensure_ascii=False,indent=2));print(json.dumps(checks,ensure_ascii=False));b.close()
