import { afterEach, expect, it } from 'vitest'
import { PassThrough } from 'node:stream'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { TerminalEditor } from '../src/terminal/editor.ts'
import { projectFiles, suggestions } from '../src/terminal/suggestions.ts'
import { command, mentionedFiles } from '../src/terminal/commands.ts'
import type { Snapshot, TerminalClient } from '../src/terminal/client.ts'
import { draftLines } from '../src/terminal/presentation.ts'

const cleanups: (() => void)[] = []
it('offers personal actions first while retaining explicit diagnostic commands', () => {
  const menu = suggestions('/', 1, [])!
  expect(menu.items.map(i => i.label)).toContain('/files')
  expect(menu.items.map(i => i.label)).not.toContain('/tasks')
  expect(suggestions('/tasks', 6, [])!.items[0]!.value).toBe('/tasks')
  expect(suggestions('/stop', 5, [])!.items[0]!.submit).toBe(true)
})
afterEach(() => {
  for (const fn of cleanups.splice(0).reverse()) fn()
})
function fixture() {
  const input = Object.assign(new PassThrough(), {
    isRaw: false,
    setRawMode(on: boolean) {
      this.isRaw = on
      return this
    }
  })
  const out = new PassThrough()
  const editor = new TerminalEditor(
    input as unknown as NodeJS.ReadStream,
    out as unknown as NodeJS.WriteStream,
    process.cwd()
  )
  cleanups.push(() => {
    editor.close()
    input.destroy()
    out.destroy()
  })
  return { editor, input, out, lines: editor[Symbol.asyncIterator]() }
}
it('captures wheel reports without changing the draft and restores terminal mouse handling on exit', () => {
  const { editor, input, out } = fixture()
  expect(out.read().toString()).toContain('\x1b[?1000h\x1b[?1006h')
  const pages: number[][] = []
  editor.on('page', (...args) => pages.push(args))
  input.write('draft')
  input.write('\x1b[<6')
  input.write('4;20;10M\x1b[<65;20;10M')
  input.write('\x1b[<0;20;10M\x1b[<0;20;10m')
  expect(pages).toEqual([[-1, 3], [1, 3]])
  expect(editor.line).toBe('draft')
  input.write('\x15/')
  const selected = editor.menu!.selected
  input.write('\x1b[<65;20;10M')
  expect(editor.menu!.selected).toBe(selected + 1)
  expect(editor.line).toBe('/')
  expect(pages).toHaveLength(2)
  editor.close()
  expect(out.read().toString()).toContain('\x1b[?1006l\x1b[?1000l')
})
it('keeps split bracketed paste, Unicode edits and multiline history as one submission', async () => {
  const { input, editor, lines } = fixture()
  input.write('\x1b[20')
  input.write('0~一\r\n👩‍💻')
  input.write('\x1b[201~')
  expect(editor.line).toBe('一\n👩‍💻')
  input.write('\x1b[D')
  input.write('好')
  input.write('\r')
  expect((await lines.next()).value).toBe('一\n好👩‍💻')
  input.write('\x1b[A')
  input.write('\x1b\r')
  input.write('末尾')
  expect(editor.line).toBe('一\n好👩‍💻\n末尾')
  expect(draftLines('一\n二', 2, 10)).toEqual({ lines: ['一', '二'], caret: { row: 1, col: 0 } })
  editor.close()
  expect(input.isRaw).toBe(false)
})
it('selects commands, preserves the draft on failure and restores failed submissions', async () => {
  const { editor, input, lines } = fixture()
  input.write('/d')
  expect(editor.menu!.items.map(item => item.label).filter(label => label.startsWith('/d'))).toEqual(['/decline', '/diff'])
  input.write('if')
  expect(editor.menu!.items[0]!.label).toBe('/diff')
  input.write('\t')
  expect(editor.line).toBe('/diff')
  input.write('\x15/help\r')
  expect((await lines.next()).value).toBe('/help')
  input.write('/open\r')
  expect((await lines.next()).value).toBe('/open')
  editor.restoreDraft('我的问题')
  expect(editor.line).toBe('我的问题')
  editor.restoreDraft('older')
  expect(editor.line).toBe('我的问题')
})
it('completes quoted filenames and uses repository ignore rules', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'roppo-files-'))
  cleanups.push(() => rmSync(cwd, { recursive: true, force: true }))
  execFileSync('git', ['-C', cwd, 'init', '-q'])
  const filename = 'one "quoted" file.md'
  writeFileSync(join(cwd, filename), 'ok')
  writeFileSync(join(cwd, '.gitignore'), 'ignored\n')
  writeFileSync(join(cwd, 'ignored'), 'ignore')
  const files = await projectFiles(cwd)
  expect(files).toContain(filename)
  expect(files).not.toContain('ignored')
  const menu = suggestions('Use @one', 8, [], files)!
  expect(mentionedFiles('Use ' + menu.items[0]!.value, cwd)).toEqual([join(cwd, filename)])
})
it('completes Router approval commands for durable requests and omits expired and closed cards', () => {
  const request = { id: 'permission:' + 'a'.repeat(64), ticketId: 'router-turn', workerId: 'router', method: 'roppo/tool', state: 'pending', expiresAt: null, facts: { tool: 'worker_manage' }, questions: [] }
  const view = { approvals: [request, { ...request, ticketId: 'expired', expiresAt: 10 }, { ...request, ticketId: 'closed', state: 'denied' }] } as unknown as Snapshot
  const menu = (line: string) => suggestions(line, line.length, [], [], view)!.items
  expect(menu('/approve ').map((item) => item.value)).toEqual(['/approve router-turn '])
  expect(menu('/approve router-turn ').map((item) => item.value)).toEqual(['/approve router-turn ' + request.id])
  expect(menu('/answer ')).toEqual([])
  expect(menu('/diff ')).toEqual([])
})
it('binds a selected Router answer to the original question and ignores closed questions', async () => {
  const m = {
    id: 'decision:original',
    decision: { question: 'Choose a format', options: [{ label: 'PDF' }, { label: 'Markdown' }] }
  }
  const view = {
    messages: [m, { ...m, id: 'old', decision: { ...m.decision, closed: true } }],
    approvals: []
  } as unknown as Snapshot
  const choice = suggestions('/choose ', 8, [], [], view)!
  expect(choice.items).toHaveLength(2)
  const sent: unknown[] = []
  const client = {
    view: async () => view,
    request: async (...args: unknown[]) => sent.push(args)
  } as unknown as TerminalClient
  await command(client, 'chat', choice.items.find(item => item.label === 'Markdown')!.value)
  expect(sent).toEqual([
    [
      '/api/chat/conversations/chat/decisions',
      expect.objectContaining({ messageId: m.id, answer: 'Markdown' })
    ]
  ])
  await expect(command(client, 'chat', '/choose old 1')).rejects.toThrow('no longer available')
})
it('orders capabilities by name and inspects the selected item by stable ID', async () => {
  const library = {
    items: [
      { id: 'codex/toolkit', name: 'A toolkit', kind: 'mcp', source: 'Codex', status: 'cli' },
      {
        id: 'host/toolkit',
        name: 'Z toolkit',
        kind: 'tool',
        source: 'Roppo',
        status: 'builtin',
        description: 'Workspace tools'
      }
    ],
    warnings: [],
    refreshing: false
  } as const
  const snapshot = { ...library, items: [...library.items], warnings: [] }
  const menu = suggestions('/tools toolkit', 14, [], undefined, undefined, snapshot)!
  expect(menu.items.map((c) => c.detail)).toEqual(['Codex · mcp', 'Roppo · tool'])
  const client = { request: async () => snapshot } as unknown as TerminalClient
  expect(await command(client, 'chat', menu.items[1]!.value)).toContain('Workspace tools')
})
it('interrupts a live run before exiting, and restores drafts after menus and history search', async () => {
  const { editor, input, lines } = fixture()
  let interrupts = 0
  editor.on('interrupt', () => interrupts++)
  editor.setView({ run: { state: 'running' } } as Snapshot)
  input.write('keep this draft\x03')
  expect(interrupts).toBe(1)
  expect(input.isRaw).toBe(true)
  expect(editor.line).toBe('keep this draft')
  input.write('\x13')
  expect(editor.line).toBe('')
  input.write('\x13')
  expect(editor.line).toBe('keep this draft')
  editor.pick('Models', [{ label: 'Example', detail: '', value: '/model example' }])
  input.write('\r')
  expect((await lines.next()).value).toBe('/model example')
  expect(editor.line).toBe('keep this draft')
  editor.recall(['older question', 'latest question'])
  input.write('\x12older\r')
  expect(editor.line).toBe('older question')
  expect(editor.picking).toBe(false)
  editor.setView({ run: undefined } as unknown as Snapshot)
  input.write('\x03')
  expect(editor.line).toBe('')
  input.write('\x03')
  expect(input.isRaw).toBe(true)
  input.write('\x03')
  expect(input.isRaw).toBe(false)
})
it('resumes a paused input stream when switching to another conversation', async () => {
  const { editor, input } = fixture()
  editor.close()
  input.pause()
  const output = new PassThrough()
  const next = new TerminalEditor(input as unknown as NodeJS.ReadStream, output as unknown as NodeJS.WriteStream, process.cwd())
  cleanups.push(() => { next.close(); output.destroy() })
  const lines = next[Symbol.asyncIterator]()
  input.write('after switching\r')
  expect((await lines.next()).value).toBe('after switching')
})
