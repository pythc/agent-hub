"""Verify uninterrupted Studio playback, without rendering or modifying source."""
from pathlib import Path
import json
import time
from playwright.sync_api import sync_playwright

out = Path('.evidence')
out.mkdir(exist_ok=True)
errors, samples, scenes = [], [], set()
looped = False
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1800, 'height': 1150})
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto('http://localhost:3417/Roppo-Concept')
    page.wait_for_load_state('networkidle')
    page.keyboard.press('g')
    field = page.locator('input:focus')
    field.fill('0')
    field.press('Enter')
    page.keyboard.press('Space')
    started = time.monotonic()
    while time.monotonic() - started < 190:
        page.wait_for_timeout(1000)
        frame = int(page.get_by_role('button', name='Show timeline ticks as frames').inner_text())
        titles = page.locator('.scene-label').evaluate_all('''els => els
            .filter(e => e.checkVisibility({checkOpacity: true, checkVisibilityCSS: true}))
            .map(e => e.textContent)''')
        scenes.update(titles)
        # A one-second sample can skip the final 20 frames and observe the loop.
        looped = bool(samples and samples[-1]['frame'] >= 4740 and frame < 30)
        samples.append({'elapsed': round(time.monotonic() - started, 1), 'frame': frame, 'scenes': titles})
        if frame >= 4750 or looped:
            break
    page.keyboard.press('Space')
    result = {'samples': samples, 'sceneCount': len(scenes), 'pageErrors': errors, 'completedLoop': looped}
    (out / 'playback.json').write_text(json.dumps(result, ensure_ascii=False, indent=2))
    assert samples[-1]['frame'] >= 4750 or looped, samples[-1]
    assert len(scenes) == 17, sorted(scenes)
    assert not errors, errors
    print(json.dumps({'passed': True, 'lastFrame': samples[-1]['frame'], 'scenes': len(scenes), 'pageErrors': errors}))
    browser.close()
