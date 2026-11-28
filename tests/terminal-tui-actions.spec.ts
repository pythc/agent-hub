import * as browser from '../src/personal-launch.ts'
import { expect, it, vi } from 'vitest'
import { TuiCommands, personalCommands } from '../src/terminal/tui-actions.ts'
import type { TuiMenu, TuiScreen } from '../src/terminal/tui-screen.ts'
import type { TerminalClient, Snapshot } from '../src/terminal/client.ts'

function fixture() {
  let menu: TuiMenu, prompt: { initial: string; submit: (value: string) => Promise<void> }, notice = ''
  let slider: Parameters<TuiScreen['effortSlider']>
  const requests: { path: string; body?: any }[] = []
  const settings = { revision: 7, backend: 'codex', model: 'router-model', effort: 'low', connections: [{ id: 'codex', label: 'Codex', kind: 'codex' }], workers: [
    { id: 'one', label: 'Research', backend: 'codex', model: 'worker-model', effort: 'high' },
    { id: 'two', label: 'Writing', backend: 'codex', model: 'writer-model' }
  ] }
  const client = { link: (id: string) => 'http://127.0.0.1:4319/chat#conversation/' + id, request: async (path: string, body?: any) => {
    requests.push({ path, body })
    if (path === '/api/terminal/settings') return settings
    if (path.startsWith('/api/terminal/models')) return { models: ['router-model', 'worker-model'], reasoning: { efforts: ['high', 'low'], defaultEffort: 'low' } }
    if (path.endsWith('/compact')) return {settings:{automatic:true,threshold:0.8},last:null,running:false,status:'unchanged'}
    if (path === '/api/terminal/tasks') return { diff: '+new text' }
    return {}
  } } as unknown as TerminalClient
  const screen = { setLoading() {}, menu(value: TuiMenu) { menu = value }, prompt(_title: string, initial: string, submit: (value: string) => Promise<void>) { prompt = { initial, submit } },
    effortSlider(...args: Parameters<TuiScreen['effortSlider']>) { slider = args },
    notice(value: string) { notice = value }, document(_title: string, text: string) { notice = text }, setDraft() {}
  } as unknown as TuiScreen
  const view = { conversation: { id: 'chat', sequence: 12, mode: 'act' }, workers: settings.workers, messages: [], tasks: [
    { id: 'research-task', workerId: 'one', title: 'Research change', state: 'completed', updatedAt: 2 },
    { id: 'writing-task', workerId: 'two', title: 'Writing change', state: 'completed', updatedAt: 1 }
  ] } as unknown as Snapshot
  const commands = new TuiCommands(client, view.conversation, screen, { cwd: '.', preferences: {}, settingsSources: [] }, () => view, async () => {}, () => {}, async () => {})
  return { commands, requests, view, menu: () => menu, prompt: () => prompt, notice: () => notice, slider: () => slider,
    choose: async (label: string) => { const item = menu.items.find(i => i.label === label); expect(item, label).toBeDefined(); await item!.run() } }
}
it('narrows slash suggestions by command prefix as the user types and deletes', async () => {
  const { commands } = fixture()
  for (const [input, expected] of [
    ['/', personalCommands().map(c => c.name)],
    ['/e', ['/effort', '/exit']],
    ['/ex', ['/exit']],
    ['/exit', ['/exit']],
    ['/exitx', []],
    ['/ex', ['/exit']],
    ['/e', ['/effort', '/exit']],
    ['/', personalCommands().map(c => c.name)]
  ] as const) {
    expect((await commands.complete(input)).map(item => item.label), input).toEqual(expected)
  }
})
it('selects an explicit Worker for model and effort changes and keeps Router as a separate target', async () => {
  const f = fixture()
  await f.commands.execute('/model'); expect(f.menu().items.map(i => i.label)).toEqual(['Router', 'Worker'])
  await f.choose('Worker'); await f.choose('Research'); await f.choose('Codex'); await f.choose('worker-model')
  expect(f.requests.at(-1)?.body).toEqual({ action: 'model', revision: 7, worker: 'one', backend: 'codex', model: 'worker-model' })
  await f.commands.execute('/effort'); await f.choose('Worker'); await f.choose('Writing')
  expect(f.slider().slice(1,3)).toEqual([['low','high'],null])
  expect(f.slider()[4]).toBe('low')
  await f.slider()[3]('high')
  expect(f.requests.at(-1)?.body).toEqual({ action: 'effort', revision: 7, worker: 'two', effort: 'high' })
  await f.commands.execute('/effort'); await f.choose('Router')
  expect(f.slider()[2]).toBe('low')
  await f.slider()[3]('low')
  expect(f.requests.at(-1)?.body).toEqual({ action: 'effort', revision: 7, effort: 'low' })
  await f.slider()[3](null)
  expect(f.requests.at(-1)?.body).toEqual({ action: 'effort', revision: 7, effort: null })
})
it('renames a selected Worker and filters changes to that Worker’s tasks', async () => {
  const f = fixture()
  await f.commands.execute('/rename'); await f.choose('Writing')
  expect(f.prompt().initial).toBe('Writing'); await f.prompt().submit('Editor')
  expect(f.requests.at(-1)?.body).toMatchObject({ action: 'rename', worker: 'two', label: 'Editor' })
  await f.commands.execute('/diff'); await f.choose('Research')
  expect(f.menu().items.map(i => i.label)).toEqual(['Research change'])
  await f.choose('Research change')
  expect(f.requests.at(-1)).toMatchObject({ path: '/api/terminal/tasks', body: { ticket: 'research-task', action: 'diff' } })
  expect(f.notice()).toBe('+new text')
})
it('does not clear without confirmation and binds confirmation to the displayed conversation version', async () => {
  const f = fixture()
  await f.commands.execute('/clear'); await f.choose('Cancel'); expect(f.requests).toEqual([])
  await f.commands.execute('/clear'); f.view.conversation.sequence++
  await f.choose('Confirm clear')
  expect(f.requests[0]).toMatchObject({ path: '/api/terminal/clear', body: { conversation: 'chat', expectedSequence: 12 } })
})
it('keeps single-conversation search, removes session navigation and changes mode without sending a task', async () => {
  const f = fixture()
  expect(personalCommands().map(c => c.name)).toContain('/history')
  await f.commands.execute('/resume'); expect(f.requests).toEqual([])
  await f.commands.execute('/plan'); await f.choose('Plan · clarify and design')
  expect(f.requests).toEqual([{ path: '/api/terminal/mode', body: { conversation: 'chat', mode: 'plan' } }])
})

it('offers explicit context compaction and shared automatic threshold settings',async()=>{
 const f=fixture()
 await f.commands.execute('/compact');await f.choose('Automatic compaction · on')
 expect(f.requests.find(r=>r.body?.action==='settings')?.body).toEqual({action:'settings',settings:{automatic:false,threshold:0.8}})
 await f.choose('Trigger threshold · 80%');await f.choose('70%')
 expect(f.requests.filter(r=>r.body?.action==='settings').at(-1)?.body.settings.threshold).toBe(0.7)
 await f.commands.execute('/compact');await f.choose('Compact now')
 expect(f.requests.at(-1)).toMatchObject({path:'/api/chat/conversations/chat/compact',body:{action:'compact'}})
})

it('opens the current shared conversation in the browser', async () => {
  const open = vi.spyOn(browser, 'openLocalBrowser').mockResolvedValue({opened:true})
  try {
    const f = fixture(); await f.commands.execute('/open')
    expect(open).toHaveBeenCalledWith('http://127.0.0.1:4319/chat#conversation/chat')
    expect(f.notice()).toBe('Opened this conversation in your browser.')
    expect(f.requests).toEqual([])
  } finally { open.mockRestore() }
})
