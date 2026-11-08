"""Check the revised Feishu scenes in Studio, including clipping and pointer targets."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

out = Path('.evidence')
out.mkdir(exist_ok=True)
errors, checks = [], []
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1800, 'height': 1150})
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto('http://localhost:3417/Roppo-Concept')
    page.wait_for_load_state('networkidle')

    def seek(frame):
        page.keyboard.press('g')
        page.locator('input:focus').fill(str(frame))
        page.locator('input:focus').press('Enter')
        page.wait_for_timeout(180)

    def camera():
        cams = page.locator('.camera')
        return next(cams.nth(i) for i in range(cams.count()) if cams.nth(i).evaluate(
            'e=>e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})'))

    def within(inner, outer):
        return all([inner['x'] >= outer['x'] - 1, inner['y'] >= outer['y'] - 1,
                    inner['x'] + inner['width'] <= outer['x'] + outer['width'] + 1,
                    inner['y'] + inner['height'] <= outer['y'] + outer['height'] + 1])

    for frame in [2735, 4230, 4310]:
        seek(frame)
        cam = camera()
        assert cam.locator('.feishu-channel').count() == 10
        for row in cam.locator('.feishu-message.outgoing').all():
            a = row.locator('.fs-avatar').bounding_box()
            b = row.locator('.feishu-bubble').bounding_box()
            assert a['x'] > b['x'] + b['width']
        for row in cam.locator('.feishu-message.incoming').all():
            a = row.locator('.fs-avatar').bounding_box()
            b = row.locator('.feishu-bubble').bounding_box()
            assert a['x'] + a['width'] < b['x']
        viewport = cam.locator('.feishu-messages').bounding_box()
        assert within(cam.locator('.feishu-message').last.bounding_box(), viewport)
        if frame > 4120:
            assert within(cam.locator('.message-attachment').bounding_box(), viewport)
    checks.append('Outgoing messages align right; incoming messages align left; final messages and report attachment fit the chat viewport')
    for frame, selector in [(2451, '.feishu-input'), (2535, '.feishu-send'), (4239, '.feishu-input'), (4278, '.feishu-send')]:
        seek(frame)
        cam = camera()
        cursor = cam.locator('[data-demo-cursor]').bounding_box()
        target = cam.locator(selector).bounding_box()
        stage = cam.locator('xpath=../..').bounding_box()
        assert within(target, stage), (frame, 'clipped control', target, stage)
        assert target['x'] <= cursor['x'] <= target['x'] + target['width'] and target['y'] <= cursor['y'] <= target['y'] + target['height'], (frame, cursor, target)
    checks.append('All four Feishu typing/send clicks land inside visible controls while the camera moves')
    for start, duration, end in [(2430, 11200, 2730), (4080, 8500, 4310)]:
        seek(start)
        page.keyboard.press('Space')
        page.wait_for_timeout(duration)
        page.keyboard.press('Space')
        frame = int(page.get_by_role('button', name='Show timeline ticks as frames').inner_text())
        assert frame > end, (start, frame)
    checks.append('Both revised scenes play continuously in the complete timeline')
    for url, frame in [('Feishu-Inbox', 305), ('Feishu-Delivery', 230)]:
        page.goto(f'http://localhost:3417/{url}')
        page.wait_for_load_state('networkidle')
        seek(frame)
        assert camera().locator('.feishu').count() == 1
        page.screenshot(path=str(out / f'{url}-studio.png'))
    checks.append('Both standalone editable Feishu compositions load')
    assert not errors, errors
    (out / 'feishu-verification.json').write_text(json.dumps({'checks': checks, 'pageErrors': errors}, ensure_ascii=False, indent=2))
    print(json.dumps(checks, ensure_ascii=False))
    browser.close()
