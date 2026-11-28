// Run with the bundled Bun: npm run test:tui. The host suite remains on Node 22+.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import type { ScrollBoxRenderable, TextRenderable } from '@opentui/core'
import { createTestRenderer } from '@opentui/core/testing'
import { TuiScreen, type TuiItem } from '../src/terminal/tui-screen.ts'
import type { Snapshot } from '../src/terminal/client.ts'
import { drawCompanion, companionRows } from '../src/terminal/companion.ts'
import { entryPixels, greetingDuration } from '../src/terminal/startup.ts'
const test = await createTestRenderer({ width: 120, height: 34, kittyKeyboard: true, useMouse: true })
const sent: string[] = [], commands: string[] = []
let chosen = '', interrupted = 0
let completions: TuiItem[] = []
const screen = new TuiScreen(test.renderer, { theme: 'dark', motion: 'reduced' }, {
  send: async text => { sent.push(text) }, command: async text => { commands.push(text) },
  complete: async text => text.startsWith('/') ? completions : [], interrupt: async () => { interrupted++ }, older: async () => {}, review: async () => {}, quit: () => {}
})
const view = { conversation: {id:'personal',sequence:0}, workers:[], calls:[], browsers:[], messages: [], approvals: [], tasks: [], schedules: [], deliveries: [], run: null } as unknown as Snapshot
const capture = async (name: string) => {
  await test.renderOnce()
  if (process.env.ROPPO_TUI_CAPTURES) {
    mkdirSync(process.env.ROPPO_TUI_CAPTURES, { recursive: true })
    writeFileSync(process.env.ROPPO_TUI_CAPTURES + '/' + name + '.txt', test.captureCharFrame())
    writeFileSync(process.env.ROPPO_TUI_CAPTURES + '/' + name + '.json', JSON.stringify(test.captureSpans()))
  }
  return test.captureCharFrame()
}
try {
  screen.update(view)
  const home = await capture('home')
  assert.match(home, /Ask Roppo anything/)
  assert.doesNotMatch(home, /personal/i)
  assert.match(home, /Commands · ctrl\+p/)
  assert.equal(screen.transcript.scrollHeight, 0)
  assert.match(home, /Ready when you are/)
  assert.equal(test.renderer.root.findDescendantById('header-notice')!.visible,false)
  const companionArt=test.renderer.root.findDescendantById('header-companion')!
  assert.equal(companionArt.x+companionArt.width/2,test.renderer.width/2,'companion stays centered')
  assert.equal(home.split('\n').filter(line=>/[\u2800-\u28ff]/.test(line)).length,companionRows,'enlarged companion fits all its text rows')
  assert.deepEqual(entryPixels(greetingDuration,true),drawCompanion('idle',0),'startup settles to the same enlarged silhouette')
  const composerY=screen.draft.y
  screen.preferences({theme:'dark',motion:'reduced',animation:false})
  const hidden=await capture('companion-off')
  assert.doesNotMatch(hidden,/Ready when you are/)
  assert.equal(screen.transcript.scrollHeight,0)
  screen.preferences({theme:'dark',motion:'reduced',animation:true})
  await test.renderOnce()
  assert.equal(screen.draft.y,composerY)

  test.mockInput.pressKey('\x1b[5~'); await test.renderOnce()
  assert.equal(test.captureCharFrame(), home, 'empty page must not scroll')

  const statusNode = test.renderer.root.findDescendantById('sync-status')!
  const commandNode = test.renderer.root.findDescendantById('command-shortcut')!
  const commandCount = commands.length
  await test.mockMouse.click(statusNode.x + 1, statusNode.y)
  assert.equal(commands.at(-1), '/open', 'web label opens the current conversation in the browser')
  await test.mockMouse.click(Math.floor((statusNode.x + statusNode.width + commandNode.x) / 2), statusNode.y)
  assert.equal(commands.length, commandCount + 1, 'footer whitespace has no action')
  await test.mockMouse.click(commandNode.x + 1, commandNode.y)
  assert.equal(commands.at(-1), '/commands', 'only the Commands shortcut opens the palette')

  screen.settings({model:'gpt-6-luna',effort:'xhigh',approvalMode:'ask'} as Parameters<TuiScreen['settings']>[0])
  await test.renderOnce()
  const modelNode=test.renderer.root.findDescendantById('composer-model')!
  const effortNode=test.renderer.root.findDescendantById('composer-effort')!
  await test.mockMouse.click(modelNode.x+10,modelNode.y)
  assert.equal(commands.at(-1),'/model','model name opens model selection')
  await test.mockMouse.click(effortNode.x+3,effortNode.y)
  assert.equal(commands.at(-1),'/effort','reasoning level opens effort selection')
  const afterSettingsClicks=commands.length
  await test.mockMouse.click(effortNode.x+effortNode.width+1,effortNode.y)
  assert.equal(commands.length,afterSettingsClicks,'space after reasoning level has no action')

  const savedEfforts:(string|null)[]=[]
  const openEffort=()=>screen.effortSlider('Router · Reasoning effort',['low','medium','high','xhigh'],'medium',async value=>{savedEfforts.push(value)},'high')
  openEffort(); await capture('effort-slider')
  const track=test.renderer.root.findDescendantById('effort-slider')!
  assert.equal(track.height,5,'pixel tide has five character rows')
  await test.mockMouse.drag(track.x,track.y+2,track.x+track.width-1,track.y+2)
  await test.renderOnce()
  const effortValue=()=> (test.renderer.root.findDescendantById('effort-value') as TextRenderable).content.chunks.map(chunk=>chunk.text).join('')
  assert.equal(effortValue(),'xhigh')
  assert.equal(savedEfforts.length,0,'dragging previews the value without saving')
  test.mockInput.pressKey('ARROW_LEFT');await test.renderOnce()
  assert.equal(effortValue(),'high')
  test.mockInput.pressEnter();await test.renderOnce()
  assert.deepEqual(savedEfforts,['high'],'keyboard confirmation saves the chosen step')
  openEffort();await test.renderOnce()
  const reset=test.renderer.root.findDescendantById('effort-default')!
  await test.mockMouse.click(reset.x+1,reset.y);await test.renderOnce()
  assert.match(test.captureCharFrame(),/Model default · high/)
  const confirm=test.renderer.root.findDescendantById('effort-confirm')!
  await test.mockMouse.click(confirm.x+1,confirm.y);await test.renderOnce()
  assert.deepEqual(savedEfforts,['high',null],'default clears the explicit reasoning override')
  openEffort();await test.renderOnce()
  test.resize(48,20);await test.renderOnce()
  const narrowTrack=test.renderer.root.findDescendantById('effort-slider')!
  assert.ok(narrowTrack.x+narrowTrack.width<=48,'slider fits a resized terminal')
  await test.mockMouse.click(narrowTrack.x+narrowTrack.width-1,narrowTrack.y);await test.renderOnce()
  assert.equal(effortValue(),'xhigh','resized slider keeps mouse positions aligned with steps')
  test.mockInput.pressKey('ARROW_RIGHT');test.mockInput.pressKey('ESCAPE');await test.renderOnce()
  assert.equal(savedEfforts.length,2,'Escape discards the preview')
  test.resize(120,34);await test.renderOnce()

  screen.preferences({theme:'dark',motion:'full',animation:false})
  openEffort();await test.renderOnce()
  const animatedTrack=test.renderer.root.findDescendantById('effort-slider') as TextRenderable
  const still=animatedTrack.content.chunks.map(chunk=>chunk.text).join('')
  await new Promise(resolve=>setTimeout(resolve,250));await test.renderOnce()
  const moving=animatedTrack.content.chunks.map(chunk=>chunk.text).join('')
  assert.notEqual(moving,still,'open effort slider advances the pixel sweep')
  assert.match(moving,/[░▒▓]/)
  screen.preferences({theme:'light',motion:'reduced',animation:false});await test.renderOnce()
  const reducedFrame=animatedTrack.content.chunks.map(chunk=>chunk.text).join('')
  assert.doesNotMatch(reducedFrame,/[░▒▓]/,'reduced motion keeps the track static')
  test.resize(48,16);await test.renderOnce()
  assert.equal(animatedTrack.height,3,'short terminals use a compact tide')
  const compactConfirm=test.renderer.root.findDescendantById('effort-confirm')!
  assert.ok(compactConfirm.y<16,'save action remains visible in a short terminal')
  screen.closeModal();test.resize(120,34)
  screen.preferences({theme:'dark',motion:'reduced',animation:true});await test.renderOnce()

  await test.mockInput.pasteBracketedText('中文草稿 👩‍💻\n/permissions full')
  assert.equal(sent.length, 0, 'pasted commands are draft text')
  const draft = screen.draft.plainText
  test.mockInput.pressKey('ARROW_LEFT')
  const cursor = screen.draft.cursorOffset
  screen.update(view)
  assert.equal(screen.draft.cursorOffset, cursor, 'host events preserve the editing cursor')
  screen.menu({ title: 'Models', items: [{ label: 'First', run: () => { chosen = 'first' } }, { label: 'Second', run: () => { chosen = 'second' } }] })
  await capture('menu')
  test.mockInput.pressKey('ARROW_DOWN'); test.mockInput.pressEnter(); await test.renderOnce()
  assert.equal(chosen, 'second')
  assert.equal(screen.draft.plainText, draft, 'closing a picker preserves draft')

  const namedItems = ['zulu', ...Array.from({length: 30}, (_, i) => 'item' + (30 - i)), 'Beta', 'Alpha10', 'alpha2']
    .map(label => ({label, detail: 'Details for ' + label, run: () => {chosen = label}}))
  const pointAt = (text: string) => {
    const lines = test.captureCharFrame().split('\n'), y = lines.findIndex(line => line.includes(text))
    assert.ok(y >= 0, 'visible row: ' + text)
    return {x: lines[y]!.indexOf(text), y}
  }
  screen.menu({title: 'Sorted resources', items: namedItems})
  const sorted = await capture('sorted-menu')
  assert.ok(sorted.indexOf('alpha2') < sorted.indexOf('Alpha10') && sorted.indexOf('Alpha10') < sorted.indexOf('Beta'))
  assert.doesNotMatch(sorted, /zulu/)
  const point = pointAt('alpha2')
  for (let i = 0; i < 80; i++) await test.mockMouse.scroll(point.x, point.y, 'down')
  const scrolled = await capture('mouse-scrolled-menu')
  assert.match(scrolled, /zulu/)
  assert.doesNotMatch(scrolled, /alpha2/)
  screen.update(view); await test.renderOnce()
  assert.match(test.captureCharFrame(), /zulu/, 'host refresh preserves mouse scroll position')
  for (let i = 0; i < 80; i++) await test.mockMouse.scroll(point.x, point.y, 'up')
  await test.renderOnce()
  assert.match(test.captureCharFrame(), /alpha2/, 'wheel scrolls back to the start')
  const list = test.renderer.root.findDescendantById('menu-items') as ScrollBoxRenderable
  const bar = list.verticalScrollBar
  await test.mockMouse.drag(bar.x, bar.y, bar.x, bar.y + bar.height - 1)
  await test.renderOnce()
  assert.match(test.captureCharFrame(), /zulu/, 'scrollbar supports dragging to the bottom')
  const bottom = pointAt('zulu')
  await test.mockMouse.click(bottom.x, bottom.y); await test.renderOnce()
  assert.equal(chosen, 'zulu', 'click selects the scrolled row, not the keyboard selection')
  assert.equal(screen.draft.plainText, draft)

  screen.menu({title: 'Sorted resources', items: namedItems})
  await test.renderOnce()
  for (let i = 0; i < 80; i++) await test.mockMouse.scroll(point.x, point.y, 'down')
  const searchList = test.renderer.root.findDescendantById('menu-items') as ScrollBoxRenderable
  await test.mockMouse.click(searchList.verticalScrollBar.x, searchList.verticalScrollBar.y + searchList.verticalScrollBar.height - 1)
  await test.mockInput.typeText('alpha')
  await test.renderOnce()
  assert.match(test.captureCharFrame(), /alpha2[\s\S]*Alpha10/)
  assert.doesNotMatch(test.captureCharFrame(), /zulu/)
  test.mockInput.pressKey('ARROW_DOWN'); test.mockInput.pressEnter(); await test.renderOnce()
  assert.equal(chosen, 'Alpha10', 'keyboard search still selects the correct sorted item after scrolling')

  completions = namedItems.map(item => ({...item, label: '/' + item.label}))
  screen.setDraft('/')
  await new Promise(resolve => setTimeout(resolve, 100)); await test.renderOnce()
  const slash = pointAt('/alpha2')
  for (let i = 0; i < 80; i++) await test.mockMouse.scroll(slash.x, slash.y, 'down')
  await capture('mouse-scrolled-completions')
  const last = pointAt('/zulu')
  await test.mockMouse.click(last.x, last.y); await test.renderOnce()
  assert.equal(chosen, 'zulu', 'slash suggestions support wheel scrolling and clicking')
  completions = []; screen.setDraft(draft)
  screen.menu({title: 'Small terminal', items: namedItems})
  test.resize(60, 16); await test.renderOnce()
  const small = test.renderer.root.findDescendantById('menu-items') as ScrollBoxRenderable
  assert.ok(small.height > 0 && small.y + small.height < 16)
  await test.mockMouse.drag(small.verticalScrollBar.x, small.verticalScrollBar.y,
    small.verticalScrollBar.x, small.verticalScrollBar.y + small.verticalScrollBar.height)
  await test.renderOnce()
  assert.match(test.captureCharFrame(), /zulu/, 'small terminal can reach the last item')
  screen.closeModal(); test.resize(120, 34); await test.renderOnce()


  screen.menu({ title: 'Commands', items: [{ label: 'Models', run: () => { chosen = 'models' } }, { label: 'Memory', run: () => { chosen = 'memory' } }] })
  test.mockInput.pressKey('memory\r'); await test.renderOnce()
  assert.equal(chosen, 'memory', 'fast search and Enter select the filtered command')
  test.mockInput.pressEnter(); await test.renderOnce()
  assert.equal(sent[0], draft)

  let secretValue = '', canceled = 0
  screen.prompt('API key', '', async value => { secretValue = value }, false, true, { allowEmpty: true, cancel: () => { canceled++ } })
  await test.mockInput.pasteBracketedText('sk-private-test')
  await test.mockInput.typeText('x')
  test.mockInput.pressKey('BACKSPACE')
  const secretFrame = await capture('secret-input')
  assert.doesNotMatch(secretFrame, /sk-private-test/)
  assert.ok(secretFrame.includes('•'))
  test.mockInput.pressEnter(); await test.renderOnce()
  assert.equal(secretValue, 'sk-private-test')
  assert.equal(canceled, 0)
  screen.prompt('Cancel setup', '', async () => {}, false, false, { cancel: () => { canceled++ } })
  test.mockInput.pressKey('ESCAPE'); await test.renderOnce()
  assert.equal(canceled, 1)

  screen.setDraft('中文')
  test.mockInput.pressEnter({ shift: true }); await test.mockInput.typeText('第二行')
  assert.equal(screen.draft.plainText, '中文\n第二行')
  screen.setDraft('')
  test.mockInput.pressKey('p', { ctrl: true }); assert.equal(commands.at(-1), '/commands')

  const messages = Array.from({ length: 30 }, (_, i) => ({ id: 'm' + i, sequence: i + 1, role: i % 2 ? 'assistant' : 'user', text: 'Message ' + i + '\n中文内容，保持连续对话。', status: 'complete', createdAt: i }))
  const chat = { ...view, messages, hasMore: false } as unknown as Snapshot
  screen.update(chat); const conversation = await capture('conversation')
  assert.doesNotMatch(conversation, /[┌┐└┘]/, 'replies have no enclosing border')
  assert.ok(screen.transcript.scrollTop > 0)
  screen.transcript.scrollBy(-8); await test.renderOnce()
  const position = screen.transcript.scrollTop
  screen.update({ ...chat, messages: [...chat.messages, { ...chat.messages[1]!, id: 'new', sequence: 31, text: 'New reply' }] })
  await test.renderOnce()
  assert.equal(screen.transcript.scrollTop, position, 'new reply must not steal reading position')
  screen.latest(); await test.renderOnce(); assert.match(test.captureCharFrame(), /New reply/)

  screen.document('Permission needed', 'Read a file in Downloads', [
    { label: 'Allow once', run: () => { chosen = 'allow' } }, { label: 'Decline', run: () => { chosen = 'decline' } }
  ])
  await capture('approval'); test.mockInput.pressTab(); test.mockInput.pressEnter(); assert.equal(chosen, 'decline')
  test.resize(60, 20); await capture('narrow')
  assert.ok(screen.draft.y + screen.draft.height < 20, 'composer must stay in viewport')
  test.resize(60, 16); const short=await capture('short')
  assert.doesNotMatch(short,/Ready when you are/)
  assert.ok(screen.draft.y + screen.draft.height < 16, 'short terminals keep the composer visible')
  test.resize(120, 34); await test.renderOnce()
  test.mockInput.pressEscape(); assert.equal(interrupted, 1)
  console.log('TUI checks passed: empty viewport, Unicode paste, newline, menu draft, sorted menus, mouse scrolling/clicks, scroll follow, approval keys, resize and interrupt')
} finally {
  screen.close(); await test.dispose()
}

// Native frames verify the real curtain, its handoff to the top slot, and a fresh launch.
const realNow = Date.now
let now = 10000
Date.now = () => now
try {
  for (const launch of [0, 1, 2]) {
    const preview = await createTestRenderer({ width: 100, height: 30, useMouse: true })
    const entry = new TuiScreen(preview.renderer, { theme: 'dark', motion: 'full' }, {
      send: async () => {}, command: async () => {}, complete: async () => [], interrupt: async () => {}, older: async () => {}, review: async () => {}, quit: () => {}
    })
    const start = now
    const advance = async (ms: number, name: string) => {
      now = start + ms; await new Promise(resolve => setTimeout(resolve, 100)); await preview.renderOnce()
      if (process.env.ROPPO_TUI_CAPTURES) {
        writeFileSync(process.env.ROPPO_TUI_CAPTURES + '/' + name + '.txt', preview.captureCharFrame())
        writeFileSync(process.env.ROPPO_TUI_CAPTURES + '/' + name + '.json', JSON.stringify(preview.captureSpans()))
      }
      return preview.captureCharFrame()
    }
    try {
      entry.update(view); await preview.renderOnce()
      assert.ok(preview.renderer.root.findDescendantById('startup-tide'), 'each launch creates its startup curtain')
      if (launch > 0) {
        if (launch === 2) await preview.mockMouse.click(50, 15)
        else preview.mockInput.pressKey('a'); await preview.renderOnce()
        assert.equal(entry.draft.plainText, launch === 1 ? 'a' : '', 'skipping does not swallow the first typed character')
        assert.equal(preview.renderer.root.findDescendantById('startup-tide'), undefined)
        entry.update(view); await advance(5000, 'startup-skipped')
        assert.equal(preview.renderer.root.findDescendantById('startup-tide'), undefined)
        continue
      }
      const initial = preview.captureCharFrame()
      const middle = await advance(1000, 'startup-tide')
      assert.notEqual(middle, initial)
      assert.doesNotMatch(middle, /█▀█ █▀█/, 'the duplicate wordmark stays hidden')
      entry.update(view)
      preview.resize(60, 20); entry.preferences({theme:'light',motion:'full'})
      await advance(1400, 'startup-small')
      preview.resize(100, 30); entry.preferences({theme:'dark',motion:'full'})
      const greeting = await advance(2400, 'startup-greeting')
      assert.equal(preview.renderer.root.findDescendantById('startup-tide'), undefined)
      assert.match(greeting, /Hello again/)
      assert.match(greeting, /Ask Roppo anything/)
      const settled = await advance(3500, 'startup-finished')
      assert.match(settled, /Ready when you are/)
      assert.doesNotMatch(settled, /personal/i)
      entry.preferences({theme:'dark',motion:'full',animation:false})
      entry.preferences({theme:'dark',motion:'full',animation:true}); entry.update(view)
      await advance(5000, 'startup-not-repeated')
      assert.equal(preview.renderer.root.findDescendantById('startup-tide'), undefined, 'updates and toggles do not replay startup')
    } finally { entry.close(); await preview.dispose() }
  }
} finally { Date.now = realNow }
console.log('Startup checks passed: tide, greeting, relaunch, typing skip, resize and footer click targets')
