from pathlib import Path
import json
from playwright.sync_api import sync_playwright, expect

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
        field = page.locator('input:focus')
        field.fill(str(frame))
        field.press('Enter')
        page.wait_for_timeout(170)

    samples = [
        (75, '一个入口，整支 Agent 团队。'), (300, '你的 24 小时助手'),
        (300, '智能协作中枢大脑'), (480, '进入你的工作区'),
        (690, '接入你选择的模型'), (975, '调用本地 Codex CLI'),
        (1200, '一个 Router，分工明确的 Workers'), (1470, '角色提示词'),
        (1725, 'Slack'), (1725, 'Linear'), (1830, 'jev-latest'), (1890, 'local-judge'), (1950, '复用已配置的 API 连接'), (2055, '持续待命 · 空闲时不调用模型'),
        (2400, '接手并分派 Workers'), (2735, '已接手。我会复现、修复并验证，完成后在这里报告。'),
        (2910, '消息进入 Roppo，成为可追踪的任务'), (3180, '并行推进，统一交付'),
        (3450, '由你接管 · Worker 已暂停'), (3516, 'Research 正在操作'),
        (3750, '订单导出 · 验证报告'), (3912, '已停止执行'),
        (4014, '任务已续接'), (4290, '订单导出问题已修复，供你确认。'),
        (4530, '配置属于你的 AI 团队。'), (4710, '消息进来，工作有着落。'),
    ]
    for frame, text in samples:
        seek(frame)
        expect(page.get_by_text(text, exact=text != "持续待命 · 空闲时不调用模型").filter(visible=True).first).to_be_visible()
        assert '概念演示 · 模拟数据' not in page.locator('body').inner_text()
    checks.append('26 content/state checkpoints cover all requested concepts; removed corner label is absent')
    hits = [
        (666, '.ui-field:has(label:text-is("默认模型")) .input'),
        (855, '[data-runtime="1"]'), (924, '[data-runtime="2"]'),
        (1065, '.team-inspector .ui-field:has(label:text-is("模型")) .input'),
        (1122, '.team-inspector .ui-field:has(label:text-is("思考强度")) .input'),
        (1215, '.team-inspector .ui-button'), (1380, '[data-role="Research"]'),
        (1455, '.product-page>.settings-title .ui-button'),
        (1695, '.ecosystem-router .ui-button'), (1845, '[data-decision-provider="1"]'), (1911, '[data-decision-provider="2"]'), (1980, '.decision-settings-footer .ui-button'), (2535, '.feishu-send'),
        (3429, '.browser-owner .ui-button'), (3894, '.send'),
    ]
    for frame, selector in hits:
        seek(frame)
        cameras = page.locator('.camera')
        active = [i for i in range(cameras.count()) if cameras.nth(i).evaluate('e=>e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})')]
        assert len(active) == 1
        cam = cameras.nth(active[0])
        cursor = cam.locator('[data-demo-cursor]').bounding_box()
        target = cam.locator(selector).bounding_box()
        assert cursor and target
        assert target['x'] <= cursor['x'] <= target['x'] + target['width'] and target['y'] <= cursor['y'] <= target['y'] + target['height'], (frame, cursor, target)
    checks.append('15 important simulated clicks land within their intended controls')
    seek(3030)
    page.get_by_text('浏览器 · 人工接管', exact=True).last.click()
    expect(page.get_by_text('镜头标题', exact=True)).to_be_visible()
    checks.append('Scene title and caption remain editable in the Studio inspector')
    page.keyboard.press('Escape')
    for composition, frame, expected in [
        ('Personal-And-Organization', 150, '你的 24 小时助手'),
        ('Model-Access', 195, '调用本地 Codex CLI'),
        ('Role-Tools', 200, '角色提示词'),
        ('App-Ecosystem', 230, 'Linear'),
        ('Decision-Layer-Settings', 180, '复用已配置的 API 连接'), ('Proactive-Listening', 345, '接手并分派 Workers'),
        ('Local-Deployment', 180, '配置属于你的 AI 团队。'),
    ]:
        page.goto(f'http://localhost:3417/{composition}')
        page.wait_for_load_state('networkidle')
        seek(frame)
        expect(page.get_by_text(expected, exact=True).first).to_be_visible()
    checks.append('Seven product standalone scene previews load')
    assert not errors, errors
    (out / 'verification.json').write_text(json.dumps({'checks': checks, 'pageErrors': errors, 'durationSeconds': 159, 'resolution': [1920, 1080], 'fps': 30}, ensure_ascii=False, indent=2))
    print(json.dumps(checks, ensure_ascii=False))
    browser.close()
