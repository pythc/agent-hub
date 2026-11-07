"""Real isolated Runtime/HTTP/settings/resources + real local MCP; synthetic model only."""
import json
import subprocess
import tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

output = Path('.local/integration-browser-evidence'); output.mkdir(parents=True, exist_ok=True)
checks = []; errors = []; writes = []; reads = []
with tempfile.TemporaryDirectory(prefix='agenthub-integration-ui-') as root:
    server = subprocess.Popen(['node', '--import', 'tsx', 'examples/frontend-integrated-preview.ts', root, '0'], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        line = server.stdout.readline()
        if not line: raise RuntimeError(server.stderr.read())
        info = json.loads(Path(json.loads(line)['info']).read_text()); base = info['base']
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(viewport={'width': 1440, 'height': 1000})
            context.add_init_script("localStorage.setItem('agenthub.configuration.language','zh-CN');localStorage.setItem('agenthub.entry.role','operator');")
            page = context.new_page(); page.on('pageerror', lambda e: errors.append(str(e)))
            page.on('request', lambda r: writes.append({'path': r.url.removeprefix(base), 'data': r.post_data_json}) if r.method == 'POST' and r.url.startswith(base) else None)
            page.goto(info['url']); page.wait_for_load_state('networkidle')
            def go(hash):
                page.goto(base + '/configure#' + hash); page.wait_for_load_state('networkidle')
                expect(page.locator('.operator-workspace')).to_be_visible()
            def saved(): return page.request.get(base + '/configuration').json()['current']
            def save():
                page.locator('#savebar .primary').click()
                expect(page.locator('#savebar')).to_be_hidden()
            go('integrations')
            expect(page.locator('h1')).to_have_text('工具与应用')
            expect(page.get_by_role('heading', name='Local MCP fixture', exact=True)).to_be_visible()
            adapter = page.locator('.integration-card').filter(has=page.get_by_role('heading', name='Team events (example)', exact=True))
            expect(adapter).to_contain_text('接收事件'); expect(adapter).not_to_contain_text('发送回复')
            assert len(json.loads(Path(root, 'mcp-calls.jsonl').read_text().splitlines()[0])['arguments']['text']) > 0
            checks.append('Actual registered plugin and source capability flags; inventory does not call tools')
            page.get_by_role('button', name='刷新回执', exact=True).click()
            expect(page.get_by_role('heading', name='docs / echo')).to_be_visible()
            page.get_by_role('button', name='读取回执', exact=True).click()
            expect(page.locator('.integration-resource pre')).to_contain_text('Local MCP integration verified')
            checks.append('Real local stdio MCP call receipt is read through the actual paginated /read endpoint')
            page.screenshot(path=str(output / 'integrations-light.png'), full_page=True)
            go('execution/configuration'); page.locator('#team-node-worker-1').click()
            page.get_by_role('tab', name='工具与管理', exact=True).click()
            expect(page.locator('#tool-grant-docs')).to_be_checked()
            expect(page.locator('#tool-grant-disabled')).to_be_disabled()
            before = saved()
            page.locator('#tool-grant-docs').uncheck(); save()
            after = saved(); assert after['revision'] == before['revision'] + 1
            assert after['config']['execution']['workers'][0]['toolConnections'] == []
            assert after['config']['execution']['workers'][1] == before['config']['execution']['workers'][1]
            page.reload(); page.wait_for_load_state('networkidle'); page.locator('#team-node-worker-1').click(); page.get_by_role('tab', name='工具与管理', exact=True).click()
            expect(page.locator('#tool-grant-docs')).not_to_be_checked()
            page.locator('#team-tool-grant-mode').select_option('inherit'); save()
            assert 'toolConnections' not in saved()['config']['execution']['workers'][0]
            expect(page.locator('#tool-grant-docs')).to_be_disabled()
            page.locator('#team-tool-grant-mode').select_option('custom'); page.locator('#tool-grant-docs').check(); save()
            assert saved()['config']['execution']['workers'][0]['toolConnections'] == ['docs']
            checks.append('Worker grants save/read back independently; explicit empty differs from inheritance; disabled connections cannot be newly granted')
            page.locator('#team-node-router').click()
            expect(page.locator('#team-tool-grant-mode')).to_have_count(0)
            expect(page.locator('#team-inspector')).to_contain_text('Router 通过 Worker 执行外部工具任务')
            page.get_by_role('tab', name='基本配置', exact=True).click()
            page.locator('#team-router-mode').select_option('client')
            expect(page.locator('#team-model')).to_have_count(0)
            expect(page.locator('#team-inspector')).to_contain_text('CLI 会话就是 Router')
            page.locator('#team-router-mode').select_option('assessment')
            page.locator('#team-node-worker-2').click()
            page.locator('#team-effort').select_option('none'); page.locator('#team-backend').select_option('claude')
            expect(page.locator('#team-effort')).to_have_count(0)
            page.get_by_role('button', name='移除通用 effort 覆盖').click()
            page.locator('#team-worker-state').select_option('paused')
            save(); assert saved()['config']['execution']['workers'][1]['state'] == 'paused'
            assert 'effort' not in saved()['config']['execution']['workers'][1]
            checks.append('Router never has MCP grants; CLI mode hides ineffective host controls; Anthropic exposes provider parameters and clears unsupported effort')
            go('execution')
            page.get_by_role('tab', name='Research', exact=True).click()
            page.locator('#execution-map-center-history').click()
            expect(page.get_by_role('dialog')).to_be_visible()
            page.get_by_role('dialog').get_by_role('option').filter(has_text='Worker').first.click()
            page.get_by_role('button', name='读取回执', exact=True).click()
            expect(page.locator('.integration-resource pre')).to_contain_text('local-test-model')
            page.get_by_role('button', name='继续读取', exact=True).click()
            expect(page.locator('.integration-resource button')).to_be_hidden()
            resource = page.locator('.integration-resource pre').inner_text()
            receipt = json.loads(resource); assert receipt['sent']['fixture'] is True; assert 'confirmed' not in receipt
            page.wait_for_timeout(1500); expect(page.locator('.integration-resource pre')).to_have_text(resource)
            reads = [w['data'] for w in writes if w['path'] == '/read' and w['data']['resource'].startswith('agent-configuration/')]
            assert len(reads) == 2 and reads[1]['offset'] == 8000 and reads[1].get('cursor')
            checks.append('Configuration receipt distinguishes sent from confirmed; cursor paging assembles valid JSON and survives polling')
            page.keyboard.press('Escape'); go('integrations')
            page.get_by_role('button', name='MCP · HTTP', exact=True).click()
            page.locator('#integration-deployment-json').fill('{broken')
            page.get_by_role('button', name='下载配置片段', exact=True).click()
            expect(page.locator('.integration-deployment .alert')).to_be_visible()
            fragment = {'toolConnections': {'custom': {'transport': {'kind': 'http', 'url': 'https://example.com/mcp', 'headerEnv': {'Authorization': 'MY_AUTH'}}, 'allowedTools': ['exact_name']}}}
            page.locator('#integration-deployment-json').fill(json.dumps(fragment))
            count = len([w for w in writes if w['path'] == '/settings'])
            with page.expect_download() as download:
                page.get_by_role('button', name='下载配置片段', exact=True).click()
            assert json.loads(Path(download.value.path()).read_text()) == fragment
            assert len([w for w in writes if w['path'] == '/settings']) == count
            checks.append('Deployment export preserves environment references, rejects malformed JSON and never POSTs restart-only settings')
            page.get_by_role('button', name='深色模式', exact=True).click()
            assert page.locator('.integration-card').first.evaluate('(n)=>getComputedStyle(n).backgroundColor') == 'rgb(25, 25, 25)'
            expect(page.locator('.integration-deployment .alert')).to_have_count(0)
            page.wait_for_timeout(350)
            page.screenshot(path=str(output / 'integrations-dark.png'), full_page=True)
            page.set_viewport_size({'width': 390, 'height': 844}); page.emulate_media(reduced_motion='reduce')
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
            expect(page.locator('#integration-deployment-json')).to_have_value(json.dumps(fragment))
            page.screenshot(path=str(output / 'integrations-mobile.png'), full_page=True)
            checks.append('Dark and 390px reduced-motion layouts preserve deployment draft without horizontal overflow')
            assert len(Path(root, 'mcp-calls.jsonl').read_text().splitlines()) == 1
            assert not errors, errors
            checks.append('No browser exceptions and no additional MCP executions caused by configuration, inventory or readback')
            browser.close()
    finally:
        server.terminate(); server.wait(timeout=15)
output.joinpath('report.json').write_text(json.dumps({'checks': checks, 'errors': errors, 'configurationPagesRead': len(reads), 'externalModelCalls': 0}, ensure_ascii=False, indent=2))
print(json.dumps({'passed': len(checks), 'errors': errors}, ensure_ascii=False))
