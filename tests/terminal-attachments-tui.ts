// Native attachment composer coverage: bun tests/terminal-attachments-tui.ts
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createTestRenderer } from '@opentui/core/testing'
import { TuiScreen } from '../src/terminal/tui-screen.ts'
import { TuiCommands } from '../src/terminal/tui-actions.ts'
import type { TerminalClient, Snapshot } from '../src/terminal/client.ts'
const dir = mkdtempSync(join(tmpdir(), 'roppo-attachment-ui-'))
const alpha = join(dir, 'alpha.png'), beta = join(dir, 'Beta notes.txt')
writeFileSync(alpha, Buffer.from([137,80,78,71,13,10,26,10])); writeFileSync(beta, 'notes')
mkdirSync(join(dir, 'Folder')); writeFileSync(join(dir, 'Folder', 'nested.txt'), 'nested')
const test = await createTestRenderer({ width: 100, height: 30, kittyKeyboard: true, useMouse: true, exitOnCtrlC: false })
const view = { conversation: { id: 'chat', sequence: 0 }, workers: [], calls: [], browsers: [], messages: [], approvals: [], tasks: [], schedules: [], deliveries: [], run: null } as unknown as Snapshot
const sent: { text: string; files: string[] }[] = []
let commands: TuiCommands, fail = false, release: (() => void) | undefined
const screen = new TuiScreen(test.renderer, { theme: 'dark', animation: false }, {
  send: async (text, files = []) => { sent.push({ text, files }); if (fail) throw Error('Upload failed'); if (release) await new Promise<void>(resolve => { release = resolve }) },
  command: input => commands.execute(input), complete: input => commands.complete(input),
  interrupt: async () => {}, older: async () => {}, review: async () => {}, quit: () => {}
})
let nativeSelection: string[] | null = null
const pickerDirectories: string[] = []
commands = new TuiCommands({} as TerminalClient, view.conversation, screen, { cwd: dir, preferences: {}, settingsSources: [] }, () => view, async () => {}, () => {}, async () => {}, async directory => {
  pickerDirectories.push(directory); return nativeSelection
})
const settle = async () => { await new Promise(resolve => setTimeout(resolve, 100)); await test.renderOnce() }
const clickText = async (text: string) => {
  const lines = test.captureCharFrame().split('\n'), y = lines.findIndex(line => line.includes(text))
  assert.ok(y >= 0, 'visible text: ' + text)
  await test.mockMouse.click(lines[y]!.indexOf(text) + 1, y); await settle()
}
try {
  screen.update(view); screen.setDraft('Please read these'); await test.renderOnce()
  await clickText('+ Attach')
  assert.match(test.captureCharFrame(), /Attach files/)
  assert.ok(test.captureCharFrame().indexOf('alpha.png') < test.captureCharFrame().indexOf('Beta notes.txt'))
  await clickText('Beta notes.txt')
  assert.equal(screen.draft.plainText, 'Please read these')
  assert.deepEqual(screen.attachmentFiles().map(f => f.path), [beta])
  assert.match(test.captureCharFrame(), /× Beta notes.txt/)
  test.mockInput.pressKey('o', { ctrl: true }); await settle()
  await clickText('Folder/'); await clickText('nested.txt')
  assert.equal(screen.attachmentFiles().length, 2)
  await clickText('× nested.txt')
  assert.equal(screen.attachmentFiles().length, 1)
  test.mockInput.pressKey('o', { ctrl: true }); await settle()
  assert.match(test.captureCharFrame(), /nested.txt/, 'picker remembers the last folder')
  test.mockInput.pressKey('ESCAPE'); await settle()

  const choices = await commands.complete('Please read these @alpha')
  await choices[0]!.run(); await settle()
  assert.equal(screen.draft.plainText, 'Please read these ')
  assert.deepEqual(screen.attachmentFiles().map(f => f.path), [alpha, beta])
  await commands.execute('/attach "Beta notes.txt"')
  assert.equal(screen.attachmentFiles().length, 2, 'duplicates are not queued again')
  fail = true; test.mockInput.pressEnter(); await settle()
  assert.equal(screen.draft.plainText, 'Please read these')
  assert.equal(screen.attachmentFiles().length, 2, 'failed sends retain attachments')
  assert.match(test.captureCharFrame(), /Upload failed/)
  fail = false; release = () => {}; test.mockInput.pressEnter(); await settle()
  test.mockInput.pressEnter(); await settle()
  assert.equal(sent.length, 2, 'Enter during upload does not send again')
  release!(); release = undefined; await settle()
  assert.deepEqual(sent.at(-1), { text: 'Please read these', files: [alpha, beta] })
  assert.equal(screen.attachmentFiles().length, 0)

  await screen.addAttachment(alpha); screen.setDraft(''); await settle()
  test.mockInput.pressEnter(); await settle()
  assert.deepEqual(sent.at(-1), { text: '', files: [alpha] }, 'attachments can be sent without text')
  assert.equal(screen.attachmentFiles().length, 0)

  for (let i = 0; i < 8; i++) { const path = join(dir, `file${i}.txt`); writeFileSync(path, 'x'); await screen.addAttachment(path) }
  test.resize(60, 16); await settle()
  const list = test.renderer.root.findDescendantById('draft-attachments')!
  assert.ok(screen.draft.y + screen.draft.height < 16)
  for (let i = 0; i < 20; i++) await test.mockMouse.scroll(list.x + 2, list.y, 'down')
  await settle(); await clickText('× file7.txt')
  assert.equal(screen.attachmentFiles().length, 7, 'attachment list scrolls and removes by mouse')
  test.mockInput.pressKey('c', { ctrl: true }); await settle()
  assert.equal(screen.attachmentFiles().length, 0, 'Ctrl+C clears the unsent attachment draft')
  nativeSelection = [alpha, beta]
  screen.setDraft('Keep my text')
  await commands.execute('/attach'); await settle()
  assert.deepEqual(screen.attachmentFiles().map(file => file.path), [alpha, beta], 'native picker supports multiple files')
  assert.equal(screen.draft.plainText, 'Keep my text')
  nativeSelection = []
  test.mockInput.pressKey('o', { ctrl: true }); await settle()
  assert.equal(pickerDirectories.at(-1), dir, 'native picker remembers the selected directory')
  assert.equal(screen.attachmentFiles().length, 2, 'cancel preserves selected attachments')
  assert.equal(screen.draft.plainText, 'Keep my text', 'cancel preserves draft')
  await commands.execute('/attach --browse'); await settle()
  assert.match(test.captureCharFrame(), /Attach files/, 'explicit terminal browser remains available')
  console.log('Attachment TUI passed: file picker, folders, @, dedupe, removal, failure recovery, send-only files, scroll and resize')
} finally { screen.close(); await test.dispose(); rmSync(dir, { recursive: true, force: true }) }
