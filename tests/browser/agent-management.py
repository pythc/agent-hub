"""Agent management against a dedicated chat-acceptance fixture; never use a live deployment."""
import json, sys, time, uuid
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

root, output = map(Path, sys.argv[1:3]); output.mkdir(parents=True, exist_ok=True)
info = json.loads((root/'browser.json').read_text()); assert not info['native']
base = info['base']; errors = []; checks = []
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(viewport={'width':1440,'height':960}, extra_http_headers={'Origin':base})
    name, value = info['cookie'].split('=', 1)
    context.add_cookies([{'name':name,'value':value,'url':base}])
    context.add_init_script("localStorage.setItem('agenthub.configuration.language','en');")
    api = context.request
    conversation = api.post(base+'/api/chat/space', data={}).json()['conversation']['id']
    api.patch(base+'/api/chat/space', data={'display':'agents'})
    response = api.post(base+'/api/chat/conversations/'+conversation+'/messages', data={'text':'Check the plan using the team','clientMessageId':str(uuid.uuid4())})
    assert response.ok, response.status
    deadline = time.monotonic()+60
    while time.monotonic() < deadline:
        view = api.get(base+'/api/chat/conversations/'+conversation).json()
        if view['run']['state']=='completed' and any(m.get('recipient',{}).get('id')=='research' for m in view['messages']): break
        time.sleep(.3)
    else: raise AssertionError('Fixture work did not complete')
    before = view['messages']
    page = context.new_page(); page.on('pageerror', lambda e:errors.append(str(e)))
    page.goto(base+'/chat')
    expect(page.locator('.agent-contact')).to_have_count(5)
    page.get_by_role('link', name='Manage Research', exact=True).click()
    expect(page.locator('#team-inspector-title')).to_have_text('Research')
    page.get_by_role('button', name='Remove', exact=True).click()
    page.get_by_role('dialog').get_by_role('button', name='Remove Worker', exact=True).click()
    page.locator('#savebar .primary').click(); expect(page.locator('#savebar')).to_be_hidden()
    page.goto(base+'/chat')
    expect(page.get_by_role('link', name='Manage Research', exact=True)).to_have_count(0)
    page.reload(); expect(page.locator('.agent-contact')).to_have_count(4)
    after = api.get(base+'/api/chat/conversations/'+conversation).json()
    assert after['messages']==before
    assert 'research' not in [w['id'] for w in after['workers']]
    checks.append('Delete via UI; refreshed contacts exclude the Worker; historical messages remain intact')
    page.get_by_role('link', name='Manage Router', exact=True).click()
    expect(page.locator('#team-inspector-title')).to_have_text('Router')
    expect(page.locator('.team-inspector-footer').get_by_role('button',name='Remove',exact=True)).to_have_count(0)
    page.locator('#team-name').fill('Coordinator')
    page.locator('#savebar .primary').click(); expect(page.locator('#savebar')).to_be_hidden()
    page.reload(); expect(page.locator('#team-name')).to_have_value('Coordinator')
    checks.append('Router management link works; retained Router can be renamed and survives refresh')
    for worker in ['planning','review','worker-4']:
        page.locator('#team-node-'+worker).click()
        page.get_by_role('button', name='Remove', exact=True).click()
        page.get_by_role('dialog').get_by_role('button', name='Remove Worker', exact=True).click()
    page.locator('#savebar .primary').click(); expect(page.locator('#savebar')).to_be_hidden()
    page.reload(); expect(page.locator('.team-worker-list .team-node')).to_have_count(0)
    page.goto(base+'/chat'); expect(page.locator('.agent-contact')).to_have_count(1)
    for theme, width in [('light',1440),('dark',1440),('dark',390)]:
        page.set_viewport_size({'width':width,'height':960})
        page.evaluate("theme=>{localStorage.setItem('agenthub.configuration.theme',theme);document.documentElement.dataset.theme=theme}", theme)
        page.wait_for_timeout(350)
        assert not page.evaluate('document.documentElement.scrollWidth > innerWidth')
        page.screenshot(path=str(output/f'contacts-{theme}-{width}.png'))
    checks.append('All Workers can be removed; refresh keeps an empty pool and one Router; no page overflow')
    page.set_viewport_size({'width':1440,'height':960})
    page.goto(base+'/configure#execution/configuration')
    page.get_by_role('button', name='Add Worker', exact=True).click()
    expect(page.locator('#team-node-worker-1')).to_be_visible()
    page.locator('#savebar .primary').click(); expect(page.locator('#savebar')).to_be_hidden()
    page.reload(); expect(page.locator('.team-worker-list .team-node')).to_have_count(1)
    checks.append('A new Worker can be added after deleting all Workers')
    page.goto(base+'/chat')
    page.get_by_role('button', name='Switch to Chinese', exact=True).click()
    expect(page.get_by_role('link', name='管理 Coordinator', exact=True)).to_be_visible()
    page.get_by_role('link', name='管理 Coordinator', exact=True).focus()
    page.keyboard.press('Enter')
    expect(page.locator('#team-name')).to_have_value('Coordinator')
    checks.append('Chinese management labels and keyboard activation work')
    assert not errors, errors
    (output/'results.json').write_text(json.dumps({'checks':checks,'errors':errors},indent=2))
    print(json.dumps({'checks':checks,'errors':errors},indent=2))
    browser.close()
