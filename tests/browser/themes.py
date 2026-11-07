"""Theme acceptance on an isolated preview; never reads or changes the running host."""
import json
import subprocess
import tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

output = Path('.local/theme-browser-evidence'); output.mkdir(parents=True, exist_ok=True)
checks = []; errors = []; writes = []; contrast = []
contrast_script = """() => {
  const rgba = v => (v.match(/[\\d.]+/g)||[]).map(Number);
  const over = (a,b) => { const alpha=a.length>3?a[3]:1; return a.slice(0,3).map((v,i)=>v*alpha+b[i]*(1-alpha)) };
  const background = element => {
    const chain=[]; for(let node=element;node;node=node.parentElement) chain.unshift(node);
    return chain.reduce((color,node)=>over(rgba(getComputedStyle(node).backgroundColor),color),[255,255,255]);
  };
  const luminance = c => c.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
  const failures=[];
  for(const node of document.querySelectorAll('body *')) {
    const c=getComputedStyle(node), r=node.getBoundingClientRect();
    if(!r.width || !r.height || c.visibility==='hidden' || node.closest('[disabled]') || node.closest('svg'))continue;
    let visible=true; for(let p=node;p;p=p.parentElement)if(Number(getComputedStyle(p).opacity)<.95)visible=false;
    if(!visible)continue;
    const text=[...node.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join('').trim();
    if(!text && !['INPUT','TEXTAREA','SELECT'].includes(node.tagName))continue;
    const bg=background(node), fg=over(rgba(c.color),bg), a=luminance(fg),b=luminance(bg),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
    const large=parseFloat(c.fontSize)>=24 || parseFloat(c.fontSize)>=18.66&&Number(c.fontWeight)>=700;
    if(ratio<(large?3:4.5))failures.push({text:(text||node.value||node.placeholder).slice(0,65),class:node.className,ratio:+ratio.toFixed(2),color:c.color,background:bg});
  }
  return failures;
}"""
with tempfile.TemporaryDirectory(prefix='agenthub-themes-') as root:
    server=subprocess.Popen(['node','--import','tsx','examples/frontend-preview.ts',root,'0'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    try:
        base=json.loads(server.stdout.readline())['url']
        with sync_playwright() as p:
            browser=p.chromium.launch(headless=True)
            context=browser.new_context(viewport={'width':1440,'height':1000},color_scheme='dark')
            context.add_init_script("localStorage.setItem('agenthub.configuration.language','zh-CN');localStorage.setItem('agenthub.entry.role','operator');")
            page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
            page.on('request',lambda r:writes.append(r.url) if r.method=='POST' and r.url.endswith('/settings') else None)
            def navigate(route='execution/configuration'):
                page.goto(base+'#'+route);page.wait_for_load_state('networkidle')
                expect(page.locator('.operator-workspace')).to_be_visible()
            def capture(name):
                page.wait_for_timeout(450)
                page.evaluate("window.scrollTo({top:0,behavior:'instant'})")
                assert not page.evaluate('document.documentElement.scrollWidth > innerWidth'),name
                failures=page.evaluate(contrast_script)
                contrast.append({'view':name,'failures':failures})
                page.screenshot(path=str(output/(name+'.png')))
            navigate()
            expect(page.locator('html')).to_have_attribute('data-theme','light')
            assert page.locator('body').evaluate('(n)=>getComputedStyle(n).backgroundColor')=='rgb(255, 255, 255)'
            assert page.locator('.sidebar').evaluate('(n)=>getComputedStyle(n).backgroundColor')=='rgb(255, 255, 255)'
            capture('team-light')
            checks.append('Default is pure white even when the OS requests dark')
            page.locator('#team-prompt').fill('主题切换保留这份未保存草稿')
            page.locator('#team-prompt').evaluate('(n)=>window.themeDraftNode=n')
            page.locator('[data-theme-toggle]').focus()
            page.keyboard.press('Enter')
            expect(page.locator('[data-theme-toggle]')).to_be_focused()
            expect(page.locator('[data-theme-toggle]')).to_have_attribute('aria-pressed','true')
            expect(page.locator('#team-prompt')).to_have_value('主题切换保留这份未保存草稿')
            assert page.locator('#team-prompt').evaluate('(n)=>n===window.themeDraftNode')
            assert not writes
            expect(page.locator('#savebar')).to_be_visible()
            checks.append('Keyboard theme toggle preserves mounted form, dirty draft and focus, with zero settings writes')
            page.locator('#savebar').get_by_role('button',name='放弃更改',exact=True).click()
            capture('discard-dark')
            page.get_by_role('dialog').get_by_role('button',name='放弃更改',exact=True).click()
            capture('team-dark')
            page.reload();page.wait_for_load_state('networkidle')
            expect(page.locator('html')).to_have_attribute('data-theme','dark')
            expect(page.locator('#team-prompt')).to_have_value('')
            checks.append('Dark choice survives reload')
            page.locator('#workspace-switch').click()
            capture('workspace-dark')
            page.get_by_role('dialog').get_by_role('button',name='关闭',exact=True).click()
            for route,name in [('execution','calls-dark'),('models','connections-dark'),('prompts','prompts-dark'),('advanced','settings-dark'),('usage','usage-dark')]:
                navigate(route);capture(name)
            checks.append('Dark theme covers Calls, model connections, prompts, advanced settings, dialogs and conversation entry')
            navigate()
            page.set_viewport_size({'width':390,'height':844})
            capture('mobile-dark')
            expect(page.locator('[data-theme-toggle]')).to_be_in_viewport()
            page.locator('[data-theme-toggle]').click()
            capture('mobile-light')
            expect(page.locator('html')).to_have_attribute('data-theme','light')
            checks.append('390px light/dark layouts retain a visible toggle without horizontal overflow')
            second=context.new_page();second.goto(base+'#execution/configuration');second.wait_for_load_state('networkidle')
            second.locator('[data-theme-toggle]').click()
            expect(page.locator('html')).to_have_attribute('data-theme','dark')
            second.evaluate("localStorage.removeItem('agenthub.configuration.theme')")
            expect(page.locator('html')).to_have_attribute('data-theme','light')
            second.close()
            checks.append('Theme preference synchronizes across tabs and reset returns to light')
            page.emulate_media(reduced_motion='reduce')
            page.locator('[data-theme-toggle]').click()
            expect(page.locator('html')).to_have_attribute('data-theme','dark')
            assert page.locator('.team-node').first.evaluate('(n)=>getComputedStyle(n).transitionDuration')=='0s'
            checks.append('Reduced motion remains respected')
            context.close()
            blocked=browser.new_context()
            blocked.add_init_script("Object.defineProperty(window,'localStorage',{get(){throw new Error('storage unavailable')}})")
            bpage=blocked.new_page();bpage.on('pageerror',lambda e:errors.append(str(e)))
            bpage.goto(base+'#execution/configuration');bpage.wait_for_load_state('networkidle')
            expect(bpage.locator('html')).to_have_attribute('data-theme','light')
            bpage.locator('[data-theme-toggle]').click()
            expect(bpage.locator('html')).to_have_attribute('data-theme','dark')
            blocked.close()
            checks.append('Inaccessible localStorage does not prevent initial rendering or theme changes')
            browser.close()
        (output/'report.json').write_text(json.dumps({'checks':checks,'errors':errors,'settingsWrites':writes,'contrast':contrast},ensure_ascii=False,indent=2)+'\n')
        assert not errors, errors
        assert not writes, writes
        assert not any(v['failures'] for v in contrast), contrast
        print(json.dumps({'passed':len(checks),'screenshots':len(contrast),'errors':errors}))
    finally:
        server.terminate();server.wait(timeout=10)
