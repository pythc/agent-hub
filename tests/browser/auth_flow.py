"""Pausable architecture illustration, against an isolated configured account host."""
import io
import json
import sys
import time
from pathlib import Path

from PIL import Image
from playwright.sync_api import expect, sync_playwright

info = json.loads((Path(sys.argv[1]) / 'browser.json').read_text())
out = Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)
(out / 'result.json').unlink(missing_ok=True)
errors = []

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={'width': 1440, 'height': 960}, reduced_motion='no-preference')
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(info['base'] + '/auth')
    page.wait_for_load_state('networkidle')
    expect(page.get_by_role('heading', name='Welcome back.')).to_be_visible()
    expect(page.get_by_role('group', name='You talk to the Router.', exact=False)).to_be_visible()
    diagram = page.locator('.coordination')
    expect(diagram.locator('.diagram-rails path')).to_have_count(4)
    expect(diagram.locator('.diagram-flow.outbound')).to_have_count(4)
    expect(diagram.locator('.diagram-flow.return')).to_have_count(4)
    # Measure actual animation progress; snapshots alone cannot prove motion.
    times = lambda: diagram.evaluate('(e)=>e.getAnimations({subtree:true}).filter(a=>a.effect.getTiming().iterations===Infinity).map(a=>a.currentTime)')
    before = times()
    page.wait_for_timeout(240)
    assert any(b > a + 100 for a, b in zip(before, times())), 'flow must actually advance'
    pause = page.get_by_role('button', name='Pause architecture animation')
    pause.focus()
    pause.press('Space')
    expect(page.get_by_role('button', name='Play architecture animation')).to_be_focused()
    page.wait_for_function('''() => document.querySelector('.coordination').getAnimations({subtree:true})
      .filter(a=>a.effect.getTiming().iterations===Infinity).every(a=>a.playState==='paused' && !a.pending)''')
    before = times()
    page.wait_for_timeout(240)
    assert all(abs(a-b) < 1 for a, b in zip(before, times())), 'pause must freeze every flow and node ring'
    # Both pause and form input survive language changes and navigation.
    page.get_by_label('Username', exact=True).fill('preserved.name')
    page.get_by_role('button', name='中文', exact=True).click()
    expect(page.get_by_label('用户名', exact=True)).to_have_value('preserved.name')
    expect(page.get_by_role('button', name='播放架构动效')).to_be_visible()
    page.get_by_role('button', name='忘记密码？', exact=True).click()
    expect(page.get_by_role('button', name='播放架构动效')).to_be_visible()
    page.get_by_role('button', name='返回登录', exact=True).click()
    page.get_by_role('button', name='播放架构动效').click()
    before = times()
    page.wait_for_timeout(240)
    assert any(b > a + 100 for a, b in zip(before, times())), 'resume must advance'
    # Turning reduced motion on mid-cycle removes beams and cancels active animation.
    page.emulate_media(reduced_motion='reduce')
    expect(page.locator('.diagram-flow').first).to_be_hidden()
    expect(page.locator('.diagram-toggle')).to_be_hidden()
    assert page.evaluate('document.getAnimations().filter(a=>a.playState==="running").length') == 0
    page.screenshot(path=str(out / 'reduced-motion.png'))
    page.emulate_media(reduced_motion='no-preference')
    expect(page.get_by_role('button', name='暂停架构动效')).to_be_visible()
    for width, height in [(1024,768), (800,600), (641,890), (320,568), (1440,960)]:
        page.set_viewport_size({'width':width, 'height':height})
        assert page.evaluate('document.documentElement.scrollWidth<=innerWidth && document.documentElement.scrollHeight<=innerHeight+1')
        if width <= 760:
            expect(diagram).to_be_hidden()
            assert page.evaluate('document.getAnimations().filter(a=>a.playState==="running" && a.effect.getTiming().iterations===Infinity).length') == 0
        else:
            expect(diagram).to_be_visible()
            # Route geometry and node centers remain aligned across actual widths.
            assert diagram.evaluate('''e => {
              const svg=e.querySelector('svg.diagram-lines'), matrix=svg.getScreenCTM();
              const routes=[...e.querySelectorAll('.diagram-rails path')];
              const centers=[e.querySelector('.node-icon'),e.querySelector('.router-hub'),...e.querySelectorAll('.diagram-worker')].map(n=>{const r=n.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}});
              return routes.every((p,i)=>{const start=p.getPointAtLength(0).matrixTransform(matrix),end=p.getPointAtLength(p.getTotalLength()).matrixTransform(matrix),a=centers[i===0?0:1],b=centers[i===0?1:i+1];return Math.hypot(start.x-a.x,start.y-a.y)<1 && Math.hypot(end.x-b.x,end.y-b.y)<1});
            }'''), 'paths must terminate at node centers'
    # Capture real elapsed motion across a full cycle, in both themes.
    for theme in ['light', 'dark']:
        if theme == 'dark':
            page.get_by_role('button', name='切换黑暗模式').click()
        # Reload restarts the illustrative cycle without synthetic run events.
        page.reload()
        expect(page.get_by_role('heading', name='欢迎回来。')).to_be_visible()
        frames = []
        started = time.monotonic()
        for index in range(36):
            due = started + index * .25
            if due > time.monotonic():
                page.wait_for_timeout((due-time.monotonic())*1000)
            bounds = diagram.bounding_box()
            clip = {'x': bounds['x']-12, 'y': bounds['y']-36, 'width': bounds['width']+24, 'height': bounds['height']+60}
            frames.append(Image.open(io.BytesIO(page.screenshot(clip=clip))).convert('RGB'))
            if index in [3, 9, 21, 28]:
                page.screenshot(path=str(out / f'{theme}-phase-{index}.png'))
        frames[0].save(out / f'{theme}-flow.gif', save_all=True, append_images=frames[1:], duration=250, loop=0)
    assert not errors, errors
    (out / 'result.json').write_text(json.dumps({'passed':True, 'checks':['actual elapsed animation', 'keyboard pause/resume', 'pause and input persistence', 'reduced motion mid-cycle', '5 responsive sizes', 'aligned path endpoints', 'full light/dark cycle capture'], 'pageErrors':errors, 'browser':'Desktop Chromium; no physical phone hardware'}, indent=2))
    browser.close()

print(json.dumps({'passed':True, 'evidence':str(out)}))
