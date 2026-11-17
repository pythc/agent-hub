"""Run against examples/connection-library-acceptance.ts; all provider traffic stays local."""
import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

root = Path(sys.argv[1]).resolve()
info = json.loads((root / 'browser.json').read_text())
errors, checks, external, icon_metrics = [], [], [], []
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1440, 'height': 1000}, device_scale_factor=1)
    key, value = info['cookie'].split('=', 1)
    page.context.add_cookies([{'name': key, 'value': value, 'url': info['base']}])
    page.add_init_script("localStorage.setItem('agenthub.configuration.language','zh-CN')")
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('request', lambda r: external.append(r.url) if r.url.startswith(('https://','http://')) and not r.url.startswith(info['base']) else None)

    def screen(name):
        page.wait_for_timeout(240)
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), name + ' page overflow'
        assert not page.locator('.connection-studio').count() or 'null' not in page.locator('.connection-studio').inner_text()
        metrics = page.locator('.connection-brand').evaluate_all('''nodes => nodes.filter(n => n.getBoundingClientRect().width).map(n => {
          const box=n.getBoundingClientRect(), child=[...n.children].find(c => c.getBoundingClientRect().width), r=child.getBoundingClientRect();
          return {name:n.className, width:box.width, x:Math.abs(r.x+r.width/2-box.x-box.width/2), y:Math.abs(r.y+r.height/2-box.y-box.height/2)};
        })''')
        assert all(m['x'] < 0.6 and m['y'] < 0.6 for m in metrics), (name, metrics)
        icon_metrics.append({'screen':name,'icons':metrics})
        visible_brands = page.locator('.model-service-row .connection-brand').evaluate_all('''nodes => nodes.filter(n => n.matches('.codex,.deepseek')).map(n => {
          const img=[...n.querySelectorAll('img')].find(i=>i.getBoundingClientRect().width), r=img.getBoundingClientRect();
          const canvas=document.createElement('canvas'); canvas.width=img.naturalWidth; canvas.height=img.naturalHeight;
          const ctx=canvas.getContext('2d'); ctx.drawImage(img,0,0); const data=ctx.getImageData(0,0,canvas.width,canvas.height).data;
          let left=canvas.width,right=0;
          for(let p=0;p<data.length;p+=4) if(data[p+3]>200 && Math.max(data[p],data[p+1],data[p+2])-Math.min(data[p],data[p+1],data[p+2])>40){const x=p/4%canvas.width;left=Math.min(left,x);right=Math.max(right,x+1)}
          return {brand:n.classList.contains('codex')?'codex':'deepseek',inkWidth:(right-left)/canvas.width*r.width};
        })''')
        if len(visible_brands)>1:
            assert max(m['inkWidth'] for m in visible_brands)-min(m['inkWidth'] for m in visible_brands)<2, visible_brands
            icon_metrics[-1]['visibleArtwork']=visible_brands
        page.screenshot(path=str(root / name), full_page=True)

    def goto(route):
        page.goto(info['base'] + '/configure#' + route)
        page.wait_for_load_state('networkidle')

    goto('models')
    expect(page.locator('.model-service-row')).to_have_count(3)
    page.get_by_label('搜索名称、账号或地址').fill('does not exist')
    expect(page.get_by_text('没有匹配的连接', exact=True)).to_be_visible()
    page.get_by_role('button', name='清除搜索', exact=True).click()
    expect(page.locator('.model-service-row')).to_have_count(3)
    row = page.locator('.model-service-row').filter(has_text='Local test API')
    row.get_by_role('button', name='测试连接', exact=True).click()
    page.get_by_role('button', name='模型试运行', exact=True).click()
    expect(page.locator('.connection-sheet .connection-state')).to_have_text('模型已回复', timeout=15000)
    screen('test-success.png')
    page.keyboard.press('Escape')
    page.reload(); page.wait_for_load_state('networkidle')
    expect(page.locator('.model-service-row').filter(has_text='Local test API')).to_contain_text('模型已回复')
    screen('library-light.png')
    checks.append('saved test survives reload, search empty state, detail dialog and Escape')

    page.get_by_role('button', name='新建连接', exact=True).click()
    expect(page.get_by_role('group', name='接入方式')).to_be_visible()
    page.get_by_role('button', name='自定义', exact=True).click()
    page.locator('#entry-model-endpoint').fill(info['provider'])
    page.locator('#entry-model-credential').fill('bad-key')
    page.locator('#entry-model-model').fill('fixture-model')
    page.get_by_role('button', name='测试并保存', exact=True).click()
    expect(page.locator('.connection-check-result')).to_contain_text('密钥', timeout=15000)
    expect(page.locator('.connection-studio')).to_be_visible()
    page.locator('#entry-model-credential').fill('demo-connection-key')
    page.get_by_role('button', name='读取模型', exact=True).click()
    expect(page.locator('#connection-model-catalog option')).to_have_count(2)
    page.get_by_text('高级设置', exact=True).click()
    page.locator('#entry-model-name').fill('Browser test API')
    page.get_by_text('高级设置', exact=True).click()
    screen('create-api.png')
    page.get_by_role('button', name='测试并保存', exact=True).click()
    expect(page.locator('.model-service-row')).to_have_count(4, timeout=20000)
    expect(page.locator('.model-service-row').filter(has_text='Browser test API')).to_contain_text('模型已回复')
    config = page.request.get(info['base'] + '/configuration').json()['current']['config']
    assert config['execution']['router']['backend'] == 'codex'
    checks.append('API failure recovery, model catalog, test and save without changing Router')

    page.get_by_role('button', name='新建连接', exact=True).click()
    page.locator('.connection-kind').filter(has_text='CLI').click()
    expect(page.locator('#connection-args')).not_to_be_visible()
    page.get_by_role('button', name='检测工具', exact=True).click()
    expect(page.locator('#connection-save')).to_be_enabled(timeout=15000)
    screen('create-cli.png')
    page.get_by_text('高级设置', exact=True).click()
    page.locator('#connection-args').fill('--profile\nwork')
    expect(page.locator('#connection-save')).to_be_disabled()
    page.get_by_text('高级设置', exact=True).click()
    page.get_by_role('button', name='重新检测', exact=True).or_(page.get_by_role('button', name='检测工具', exact=True)).click()
    expect(page.locator('#connection-save')).to_be_enabled(timeout=15000)
    page.locator('#connection-save').click()
    expect(page.locator('.model-service-row')).to_have_count(5, timeout=20000)
    checks.append('CLI detection with custom arguments; changes invalidate saved check')

    page.get_by_role('button', name='新建连接', exact=True).click()
    page.locator('.connection-kind').filter(has_text='订阅账号').click()
    page.locator('#connection-saved-account').select_option('demo-account')
    expect(page.locator('#subscription-owner')).to_have_count(0)
    expect(page.locator('#connection-account')).to_have_count(0)
    expect(page.locator('#connection-save')).to_be_disabled()
    page.locator('#subscription-background').check()
    page.get_by_role('button', name='读取账号模型', exact=True).click()
    expect(page.locator('#connection-model')).to_have_value('fixture-subscription-model')
    screen('create-subscription.png')
    checks.append('subscription uses saved account, inferred owner, explicit consent and account model catalog')

    goto('execution/configuration/router')
    page.locator('#team-backend').click()
    expect(page.locator('.connection-picker-option')).to_have_count(5)
    page.locator('.connection-picker-option').filter(has_text='Browser test API').click()
    screen('component-picker.png')
    page.get_by_role('button', name='使用此连接', exact=True).click()
    expect(page.locator('#team-backend')).to_contain_text('Browser test API')
    page.get_by_role('tab', name='决策层', exact=True).click()
    expect(page.locator('.decision-settings')).to_be_visible()
    screen('router-decision.png')
    checks.append('Agent picker shares the library; decision layer belongs to Router')

    goto('models')
    page.locator('.model-service-row').filter(has_text='Browser test API').get_by_role('button', name='管理 Browser test API', exact=True).click()
    expect(page.get_by_role('button', name='删除连接', exact=True)).to_be_disabled()
    page.reload(); page.wait_for_load_state('networkidle')
    page.locator('.model-service-row').filter(has_text='Browser test API').get_by_role('button', name='管理 Browser test API', exact=True).click()
    page.get_by_role('button', name='删除连接', exact=True).click()
    page.locator('.workspace-confirm').get_by_role('button', name='删除', exact=True).click()
    expect(page.locator('.model-service-row')).to_have_count(4, timeout=15000)
    page.reload(); page.wait_for_load_state('networkidle')
    expect(page.locator('.model-service-row')).to_have_count(4)
    checks.append('unused connection deletion persists and removes it from inventory')

    page.get_by_role('button', name='切换为深色模式', exact=True).click()
    screen('library-dark.png')
    page.get_by_role('button', name='切换为浅色模式', exact=True).click()
    page.set_viewport_size({'width': 390, 'height': 844})
    screen('library-mobile.png')
    page.get_by_role('button', name='新建连接', exact=True).click()
    screen('create-api-mobile.png')
    page.locator('.connection-kind').filter(has_text='订阅账号').click()
    page.locator('#connection-saved-account').select_option('demo-account')
    screen('create-subscription-mobile.png')
    page.locator('.connection-kind').filter(has_text='CLI').click()
    screen('create-cli-mobile.png')
    checks.append('1440px light/dark and 390px library plus three forms')
    browser.close()

assert not errors, errors
assert not external, external
(root / 'results.json').write_text(json.dumps({'checks': checks, 'pageErrors': errors, 'externalBrowserRequests': external, 'iconAlignment':icon_metrics}, ensure_ascii=False, indent=2))
print(json.dumps({'passed': len(checks), 'pageErrors': errors, 'externalRequests': external}, ensure_ascii=False))
