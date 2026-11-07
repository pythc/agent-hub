"""Browser contract acceptance. Uses an isolated, synthetic server; no provider calls."""
import argparse
import json
import subprocess
import tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('--output', default='.local/frontend-browser-evidence')
parser.add_argument('--legacy', default='http://127.0.0.1:4347')
args = parser.parse_args()
output = Path(args.output).resolve(); output.mkdir(parents=True, exist_ok=True)
results = []; errors = []; requests = []

with tempfile.TemporaryDirectory(prefix='agenthub-ui-') as root:
    server = subprocess.Popen(['node', '--import', 'tsx', 'examples/frontend-preview.ts', root, '0'], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        info = json.loads(server.stdout.readline()); base = info['url'].removesuffix('/configure')
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(viewport={'width': 1440, 'height': 1000})
            context.add_init_script("localStorage.setItem('agenthub.configuration.language','zh-CN');localStorage.setItem('agenthub.entry.role','operator');")
            page = context.new_page(); page.on('pageerror', lambda error: errors.append(str(error)))
            page.on('request', lambda request: requests.append((request.method, request.url, request.post_data)))

            def navigate(hash='execution/configuration'):
                # A hash-only goto does not guarantee the newly rendered layout is ready.
                page.goto(base + '/configure#' + hash)
                page.wait_for_load_state('networkidle')
                expect(page.locator('.operator-workspace')).to_be_visible()

            def snapshot(name):
                page.wait_for_timeout(450)
                page.evaluate("window.scrollTo({top:0,behavior:'instant'})")
                assert not page.evaluate('document.documentElement.scrollWidth > innerWidth'), name + ': page overflow'
                page.screenshot(path=str(output / (name + '.png')), full_page=True)
                page.screenshot(path=str(output / (name + '-viewport.png')))

            def save():
                page.locator('#savebar .primary').click()
                expect(page.locator('#savebar')).to_be_hidden()

            navigate()
            expect(page.locator('#team-inspector-title')).to_have_text('Router')
            expect(page.locator('#team-effort')).to_have_value('medium')
            snapshot('desktop-team')
            page.locator('#team-node-worker-1').click()
            expect(page.locator('#team-effort')).to_have_value('high')
            page.locator('#team-name').fill('研究与资料核验')
            page.locator('#team-prompt').fill('逐项核实来源，保留验证证据。')
            page.locator('#team-effort').select_option('medium')
            page.locator('#team-node-worker-2').click()
            expect(page.locator('#team-effort')).to_have_value('high')
            page.locator('#team-node-worker-1').click()
            expect(page.locator('#team-name')).to_have_value('研究与资料核验')
            page.locator('#workspace-switch').click()
            page.get_by_role('button', name='研究团队 组织').click()
            expect(page.get_by_role('dialog')).to_contain_text('请先保存或放弃当前草稿')
            page.get_by_role('dialog').get_by_role('button', name='关闭', exact=True).click()
            save()
            page.reload(); page.wait_for_load_state('networkidle')
            page.locator('#team-node-worker-1').click()
            expect(page.locator('#team-prompt')).to_have_value('逐项核实来源，保留验证证据。')
            results.append('Independent profile persistence, Router/Worker effort and dirty workspace guard')

            page.locator('#team-backend').select_option('research')
            page.get_by_role('tab', name='高级参数', exact=True).click()
            params = page.locator('#f-execution-workers-0-parameters')
            params.fill('{broken')
            expect(page.locator('#savebar .primary')).to_be_disabled()
            page.get_by_role('tab', name='基本配置', exact=True).click()
            page.get_by_role('tab', name='高级参数', exact=True).click()
            expect(params).to_have_value('{broken')
            params.fill('{"temperature":0.2,"nested":{"keep":null},"array":[1,2]}')
            page.locator('#team-maxSteps').fill('0')
            expect(page.locator('#team-maxSteps')).to_have_attribute('aria-invalid', 'true')
            expect(page.locator('#savebar .primary')).to_be_disabled()
            page.locator('#team-maxSteps').fill('12')
            page.get_by_text('查看将保存的配置', exact=True).click()
            expect(page.locator('#team-config-preview')).to_contain_text('12')
            page.locator('#team-maxSteps').fill('15')
            expect(page.locator('#team-config-preview')).to_contain_text('15')
            snapshot('desktop-advanced')
            save()
            saved = context.request.get(base + '/workspaces/personal/configuration').json()['current']['config']
            assert saved['execution']['workers'][0]['parameters']['nested']['keep'] is None
            assert saved['execution']['workers'][0]['maxSteps'] == 15
            assert saved['execution']['workers'][1]['effort'] == 'high'
            results.append('Invalid JSON persistence, numeric validation, live config preview and actual save payload')

            page.get_by_role('button', name='复制 Worker', exact=True).click()
            expect(page.locator('.team-worker-list .team-node')).to_have_count(5)
            expect(page.locator('#team-name')).to_have_value('研究与资料核验 副本')
            page.get_by_role('button', name='移除', exact=True).click()
            page.get_by_role('dialog').get_by_role('button', name='移除 Worker', exact=True).click()
            expect(page.locator('.team-worker-list .team-node')).to_have_count(4)
            if page.locator('#savebar').is_visible(): save()
            results.append('Worker clone and explicit removal')

            page.locator('#team-node-router').click()
            page.get_by_role('tab',name='基本配置',exact=True).click()
            page.locator('#team-model').fill('unsaved-router-model')
            remote=context.request.get(base+'/workspaces/personal/configuration').json()['current']
            context.request.post(base+'/workspaces/personal/settings',data={'revision':remote['revision'],'patch':{'model':'concurrent-default'}})
            page.locator('#savebar .primary').click()
            expect(page.locator('#savebar')).to_contain_text('版本冲突')
            expect(page.locator('#team-model')).to_have_value('unsaved-router-model')
            page.get_by_role('button',name='放弃更改',exact=True).click()
            page.get_by_role('dialog').get_by_role('button',name='放弃更改',exact=True).click()
            expect(page.locator('#savebar')).to_be_hidden()
            results.append('Revision conflict retains the unsaved agent draft')

            page.route('**/workspaces/studio/configuration',lambda route:route.fulfill(status=503,json={'error':'Fixture unavailable workspace'}),times=1)
            page.locator('#workspace-switch').click()
            page.get_by_role('button',name='研究团队 组织').click()
            expect(page.locator('#entry-error')).to_be_visible()
            expect(page.locator('#workspace-switch')).to_contain_text('我的工作区')
            expect(page.locator('.team-worker-list .team-node')).to_have_count(4)
            results.append('Failed workspace switch leaves the current identity and data intact')

            page.locator('#workspace-switch').click()
            snapshot('workspace-picker')
            page.get_by_role('button', name='研究团队 组织').click()
            expect(page.locator('#page-title')).to_have_text('研究团队')
            assert 'workspace=studio' in page.url
            page.reload(); page.wait_for_load_state('networkidle')
            expect(page.locator('#page-title')).to_have_text('研究团队')
            page.get_by_role('button', name='配置团队', exact=True).click()
            expect(page.locator('.team-worker-list .team-node')).to_have_count(2)
            page.locator('#team-node-worker-1').click()
            page.locator('#team-name').fill('组织专用分析员'); save()
            personal = context.request.get(base + '/workspaces/personal/configuration').json()['current']['config']
            assert personal['execution']['workers'][0]['label'] == '研究与资料核验'
            results.append('Organization switch, URL restoration and separate scoped configuration writes')

            page.locator('#workspace-switch').click()
            page.locator('#workspace-new-name').fill('设计评审组')
            page.locator('#workspace-new-kind').select_option('organization')
            page.get_by_role('button', name='创建工作区', exact=True).click()
            expect(page.locator('#page-title')).to_have_text('设计评审组')
            results.append('New organization workspace contract')

            page.locator('#workspace-switch').click()
            page.get_by_role('button', name='我的工作区 个人').click()
            expect(page.locator('#page-title')).to_have_text('我的工作区')
            snapshot('desktop-workspace')
            page.get_by_role('button', name='接入模型', exact=True).click()
            page.wait_for_load_state('networkidle')
            snapshot('desktop-connections')
            primary=page.get_by_role('button',name='检查 AI 连接',exact=True)
            contrast_values=[]
            for state in ['default','hover','focus']:
                if state=='hover':primary.hover()
                if state=='focus':primary.focus()
                page.wait_for_timeout(180)
                colors=primary.evaluate("el=>({text:getComputedStyle(el).color,background:getComputedStyle(el).backgroundColor})")
                def luminance(color):
                    values=[float(value)/255 for value in color.split('(')[1].split(')')[0].split(',')[:3]]
                    linear=[value/12.92 if value<=0.04045 else ((value+0.055)/1.055)**2.4 for value in values]
                    return sum(value*weight for value,weight in zip(linear,[0.2126,0.7152,0.0722]))
                values=sorted([luminance(colors['text']),luminance(colors['background'])])
                ratio=(values[1]+0.05)/(values[0]+0.05);assert ratio>=4.5,(state,ratio,colors)
                contrast_values.append({'state':state,'ratio':round(ratio,2),'colors':colors})
            (output/'primary-contrast.json').write_text(json.dumps(contrast_values,indent=2))
            results.append('API primary action contrast above 4.5:1 in default, hover and focus')
            page.locator('#entry-model-name').fill('研究模型服务')
            page.locator('#entry-model-model').fill('preview-model')
            page.get_by_role('button', name='检查 AI 连接', exact=True).click()
            page.get_by_role('button', name='保存预览 AI 连接', exact=True).click()
            expect(page.locator('#page-title')).to_have_text('模型连接')
            expect(page.locator('main')).to_contain_text('研究模型服务')
            results.append('API connection existing plan/check/apply flow')

            page.get_by_role('button', name='新建模型连接', exact=True).click()
            page.get_by_role('button', name='CLI 后端', exact=False).click()
            page.locator('#connection-cli-provider').select_option('gemini')
            page.locator('#connection-name').fill('Gemini 预览执行器')
            page.locator('#connection-command').fill('/preview/gemini')
            page.locator('#connection-args').fill('["--output-format","json"]')
            page.get_by_role('button', name='检查 CLI', exact=True).click()
            expect(page.get_by_role('button', name='创建 CLI 连接', exact=True)).to_be_visible()
            page.locator('#connection-command').fill('/preview/changed')
            expect(page.get_by_role('button', name='创建 CLI 连接', exact=True)).to_have_count(0)
            page.get_by_role('button', name='检查 CLI', exact=True).click()
            page.get_by_role('button', name='创建 CLI 连接', exact=True).click()
            expect(page.locator('#page-title')).to_have_text('模型连接')
            expect(page.locator('main')).to_contain_text('Gemini 预览执行器')
            results.append('CLI check invalidation and receipt-driven creation (synthetic)')

            page.get_by_role('button', name='新建模型连接', exact=True).click()
            page.get_by_role('button', name='订阅账号', exact=False).click()
            page.locator('#connection-name').fill('个人订阅预览')
            page.get_by_role('button', name='开始授权', exact=True).click()
            page.get_by_role('button', name='检查授权状态', exact=True).click()
            expect(page.locator('#connection-status')).not_to_contain_text('账号已连接')
            with context.expect_page() as popup:
                page.get_by_role('link', name='打开服务商授权页', exact=True).click()
            popup.value.wait_for_load_state('networkidle');popup.value.close()
            page.get_by_role('button', name='检查授权状态', exact=True).click()
            expect(page.locator('#connection-status')).to_contain_text('账号已连接')
            results.append('Subscription pending versus connected state (synthetic, no provider login)')

            navigate()
            page.get_by_role('button', name='了解任务流转', exact=True).click()
            page.get_by_role('button', name='回报进展', exact=True).click()
            expect(page.locator('.team-step-description')).to_contain_text('补充要求仍关联同一任务')
            page.get_by_role('button', name='收起说明', exact=True).click()
            page.get_by_role('tab', name='基本配置', exact=True).focus()
            page.keyboard.press('ArrowRight')
            expect(page.get_by_role('tab', name='工具与管理', exact=True)).to_be_focused()
            page.get_by_role('tab', name='基本配置', exact=True).click()
            snapshot('desktop-final')
            for width in [729, 390]:
                page.set_viewport_size({'width': width, 'height': 900})
                page.locator('#team-node-worker-1').click()
                snapshot('team-' + str(width))
                if width <= 700:
                    page.locator('#operator-menu').click()
                    page.keyboard.press('Escape')
                    expect(page.locator('#operator-menu')).to_be_focused()
            page.emulate_media(reduced_motion='reduce')
            page.locator('#team-node-router').click()
            assert page.locator('#team-node-router').evaluate("el => getComputedStyle(el).transitionDuration") == '0s'
            snapshot('mobile-reduced-motion')
            results.append('Workflow explanation, keyboard tabs/navigation, 729px/390px layouts and reduced motion')
            assert not errors, errors
            assert not any(method == 'POST' and url.endswith('/settings') and '/workspaces/' not in url for method, url, body in requests)
            results.append('No unscoped configuration writes or browser exceptions')

            # Exercise the concurrent backend's actual /subscription/* adapter.
            # Network fixtures below represent its contract, never real login.
            native = browser.new_context(viewport={'width':1440,'height':1000})
            native.add_init_script("localStorage.setItem('agenthub.configuration.language','zh-CN');localStorage.setItem('agenthub.entry.role','operator');")
            def native_config(route):
                response=route.fetch();data=response.json();data['editableKeys'].append('backends')
                data['current']['config']['sources'][0]['allowedActors']=['preview-operator','second-owner']
                route.fulfill(response=response,json=data)
            native.route('**/configuration',native_config)
            native.route('**/connection-capabilities',lambda route:route.fulfill(status=404,json={'error':'legacy adapter'}))
            native.route('**/subscription/accounts',lambda route:route.fulfill(json=[{'id':'personal','signedIn':True},{'id':'second','signedIn':True}]))
            native.route('**/subscription/login',lambda route:route.fulfill(json={'attempt':'fixture-attempt','url':'https://auth.openai.com/fixture-never-opened'}))
            native.route('**/subscription/status',lambda route:route.fulfill(json={'account':'personal','status':'completed'}))
            native.route('**/subscription/models',lambda route:route.fulfill(json={'data':[{'id':'fixture-account-model'}]}))
            n=native.new_page();n.on('pageerror',lambda error:errors.append(str(error)))
            n.goto(base+'/configure#models/new');n.wait_for_load_state('networkidle')
            n.get_by_role('button',name='订阅账号',exact=False).click()
            n.locator('#connection-name').fill('原生订阅协议测试')
            n.locator('#connection-account').fill('personal')
            n.get_by_role('button',name='使用 ChatGPT 登录',exact=True).click()
            n.get_by_role('button',name='检查授权状态',exact=True).click()
            expect(n.locator('#connection-status')).to_contain_text('授权已完成')
            n.locator('#subscription-source').select_option('local')
            n.locator('#subscription-owner').select_option('preview-operator')
            n.get_by_role('button',name='读取账号模型',exact=True).click()
            n.locator('#connection-model').fill('fixture-account-model')
            expect(n.get_by_role('button',name='保存订阅连接',exact=True)).to_be_disabled()
            n.locator('#subscription-background').check()
            expect(n.get_by_role('button',name='保存订阅连接',exact=True)).to_be_enabled()
            n.locator('#subscription-owner').select_option('second-owner')
            expect(n.locator('#subscription-background')).not_to_be_checked()
            expect(n.get_by_role('button',name='保存订阅连接',exact=True)).to_be_disabled()
            n.wait_for_timeout(450)
            n.evaluate("window.scrollTo({top:0,behavior:'instant'})")
            n.screenshot(path=str(output/'native-subscription.png'),full_page=True)
            n.screenshot(path=str(output/'native-subscription-viewport.png'))
            n.locator('#subscription-background').check()
            n.locator('#subscription-source').select_option('')
            expect(n.locator('#subscription-background')).not_to_be_checked()
            n.locator('#subscription-source').select_option('local')
            n.locator('#subscription-owner').select_option('preview-operator')
            n.locator('#subscription-background').check()
            n.locator('#connection-account').fill('second')
            expect(n.locator('#subscription-background')).not_to_be_checked()
            expect(n.locator('#subscription-owner')).to_have_value('')
            n.locator('#connection-account').fill('personal')
            n.locator('#subscription-source').select_option('local')
            n.locator('#subscription-owner').select_option('preview-operator')
            n.locator('#connection-model').fill('fixture-account-model')
            n.locator('#subscription-background').check()
            n.get_by_role('button',name='保存订阅连接',exact=True).click()
            expect(n.locator('#page-title')).to_have_text('模型连接')
            config=native.request.get(base+'/workspaces/personal/configuration').json()['current']['config']
            definition=next(value for value in config['backends'].values() if value.get('label')=='原生订阅协议测试')
            assert definition['subscription']=={'provider':'chatgpt','account':'personal','owner':{'source':'local','actor':'preview-operator'},'backgroundAuthorized':True}
            n.get_by_role('button',name='新建模型连接',exact=True).click()
            n.get_by_role('button',name='订阅账号',exact=False).click()
            expect(n.locator('#subscription-background')).not_to_be_checked()
            expect(n.locator('#connection-account')).to_have_value('')
            results.append('Subscription consent resets on account, owner, entry and new connection changes')
            results.append('Actual backend subscription adapter: login status, account models, owner scope and explicit background consent (mock network)')
            assert not errors,errors
            browser.close()
        (output / 'report.json').write_text(json.dumps({'scope':'synthetic frontend contract, not real providers','checks':results,'errors':errors}, ensure_ascii=False, indent=2))
        print(json.dumps({'passed':len(results),'checks':results,'evidence':str(output)},ensure_ascii=False))
    finally:
        server.terminate()
        try: server.wait(timeout=10)
        except subprocess.TimeoutExpired: server.kill();server.wait()
