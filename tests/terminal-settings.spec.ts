import { afterEach, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadTerminalSettings, saveTerminalSetting, settingsPaths } from '../src/terminal/settings.ts'
import { parseArgs } from '../src/terminal/main.ts'
import {controlCommand} from '../src/terminal/controls.ts'
import type {TerminalClient,Conversation} from '../src/terminal/client.ts'
import { PrintEvents } from '../src/terminal/output.ts'
import type { Snapshot } from '../src/terminal/client.ts'

const directories: string[] = []
afterEach(() => { vi.unstubAllEnvs(); for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }) })
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'roppo-preferences-'))
  directories.push(root)
  vi.stubEnv('ROPPO_CLI_HOME', join(root, 'profile'))
  const project = join(root, 'project')
  mkdirSync(join(project, '.roppo'), { recursive: true })
  return { root, project, paths: settingsPaths(project) }
}
it('merges user, project, local, supplied settings and launch flags without replacing unrelated keys', () => {
  const { project, paths } = fixture()
  saveTerminalSetting(project, 'theme', 'light')
  saveTerminalSetting(project, 'verbose', 'true')
  saveTerminalSetting(project, 'motion', 'reduced')
  writeFileSync(paths.project, JSON.stringify({ theme: 'dark', timeout: 120 }))
  writeFileSync(paths.local, JSON.stringify({ theme: 'mono' }))
  const loaded = loadTerminalSettings(project, '{"theme":"light","timeout":30}', { timeout: 5 })
  expect(loaded.settings).toMatchObject({ theme: 'light', timeout: 5, verbose: true })
  expect(loaded.sources).toEqual([paths.user, paths.project, paths.local, '--settings (JSON)'])
  expect(() => saveTerminalSetting(project, 'language', 'zh')).toThrow()
  expect(JSON.parse(readFileSync(paths.user, 'utf8'))).toEqual({ theme: 'light', verbose: true, motion: 'reduced' })
  expect(JSON.parse(readFileSync(paths.project, 'utf8'))).toEqual({ theme: 'dark', timeout: 120 })
})
it('reports invalid settings before connecting and refuses permission keys in project preferences', () => {
  const { project, paths } = fixture()
  writeFileSync(paths.project, '{"permissions":"full"}')
  expect(() => loadTerminalSettings(project)).toThrow('Unrecognized key')
  writeFileSync(paths.project, '{invalid')
  expect(() => loadTerminalSettings(project)).toThrow(paths.project)
  expect(() => saveTerminalSetting(project, 'verbose', 'maybe')).toThrow()
  expect(() => parseArgs(['--output-format', 'xml'])).toThrow()
  expect(parseArgs(['-p', '--output-format', 'stream-json', '--theme', 'mono', '--verbose', 'hello'])).toMatchObject({
    outputFormat: 'stream-json', json: true, prompt: 'hello', preferences: { theme: 'mono', verbose: true }
  })
})
it('emits replacements only for changed public messages in the requested run', () => {
  const events: unknown[] = []
  const output = new PrintEvents(event => events.push(event))
  const view = { conversation: { id: 'c' }, tasks: [], messages: [
    { id: 'm', runId: 'r', role: 'assistant', text: 'first', status: 'streaming' },
    { id: 'private', runId: 'r', role: 'assistant', recipient: 'worker', text: 'private' },
    { id: 'worker', runId: 'r', role: 'assistant', speaker: { kind: 'worker' }, text: 'internal reply' },
    { id: 'old', runId: 'old-run', role: 'assistant', text: 'old' }
  ] } as unknown as Snapshot
  output.update(view, 'r')
  output.update(view, 'r')
  view.messages[0]!.text = 'finished'
  view.messages[0]!.status = undefined
  output.update(view, 'r')
  expect(events).toEqual([
    expect.objectContaining({ type: 'assistant', message: expect.objectContaining({ id: 'm', text: 'first' }) }),
    expect.objectContaining({ type: 'assistant', message: expect.objectContaining({ id: 'm', text: 'finished' }) })
  ])
})

it('defaults the companion on and persists consecutive /animation toggles without touching other settings',async()=>{
 const {project}=fixture()
 saveTerminalSetting(project,'theme','light')
 const prefs=loadTerminalSettings(project).settings
 expect(prefs.animation).toBe(true)
 const toggle=()=>controlCommand({} as TerminalClient,{} as Conversation,'/animation',project,prefs,[])
 Object.assign(prefs,(await toggle())!.preferences)
 expect(loadTerminalSettings(project).settings).toMatchObject({animation:false,theme:'light'})
 Object.assign(prefs,(await toggle())!.preferences)
 expect(loadTerminalSettings(project).settings).toMatchObject({animation:true,theme:'light'})
})
