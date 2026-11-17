"""Mounted React component automation. Controlled API, not product acceptance or screenshots."""
import os,functools,json,pathlib,subprocess,tempfile,threading,http.server
from playwright.sync_api import sync_playwright
ROOT=pathlib.Path(__file__).resolve().parents[2]
with tempfile.TemporaryDirectory(prefix='agenthub-memory-component-') as directory:
    output=pathlib.Path(directory)
    subprocess.run([str(ROOT/'node_modules/.bin/esbuild'),str(ROOT/'tests/component/memory-settings.tsx'),'--bundle','--format=esm','--jsx=automatic',f'--outfile={output}/fixture.js'],cwd=ROOT,check=True)
    (output/'index.html').write_text('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="fixture.css"><div id="root"></div><script type="module" src="fixture.js"></script>')
    handler=functools.partial(http.server.SimpleHTTPRequestHandler,directory=directory)
    server=http.server.ThreadingHTTPServer(('127.0.0.1',0),handler)
    threading.Thread(target=server.serve_forever,daemon=True).start()
    try:
      with sync_playwright() as p:
        browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_EXECUTABLE','/usr/bin/chromium'),headless=True,args=['--no-sandbox'])
        page=browser.new_page(viewport={'width':390,'height':844},reduced_motion='reduce')
        errors=[];page.on('pageerror',lambda error: errors.append(str(error)))
        page.goto(f'http://127.0.0.1:{server.server_port}')
        page.get_by_role('heading',name='事实',exact=True).wait_for()
        assert page.locator('.memory-details').get_attribute('open') is None
        page.locator('summary').click()
        assert '当前任务记录：已完成' in page.locator('.memory-details').inner_text()
        assert '任务记录晚于这条记忆' in page.locator('.memory-details').inner_text()
        page.get_by_role('button',name='修改',exact=True).click()
        page.get_by_label('分类',exact=True).select_option('project_decision')
        page.get_by_label('记忆内容',exact=True).fill('采用新方案')
        page.get_by_role('button',name='取消',exact=True).click()
        assert page.evaluate('fixture.calls.length')==0
        page.get_by_role('button',name='修改',exact=True).click()
        page.get_by_label('分类',exact=True).select_option('method')
        page.get_by_role('button',name='保存',exact=True).click()
        page.get_by_role('heading',name='方法',exact=True).wait_for()
        assert page.evaluate('fixture.calls[0].command.category')=='method'
        assert page.evaluate('fixture.calls.length')==1
        assert page.locator('body').evaluate('(el)=>el.scrollWidth<=innerWidth')
        assert not errors,errors
        browser.close()
        print(json.dumps({'component':'MemorySettings','result':'passed','api':'controlled mock','screenshots':False,'product_acceptance':False,'checks':['collapsed-details','task-current-record','edit-cancel','classification-save','narrow']},ensure_ascii=False))
    finally:server.shutdown();server.server_close()
