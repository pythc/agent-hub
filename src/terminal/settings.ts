import {themeNames} from './themes.ts'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { terminalProfileDirectory } from './profile.ts'
import { CliError } from './client.ts'

export const terminalSettingsSchema = z.object({
  inputMode: z.enum(['queue','steer']).optional(),
  theme: z.enum(themeNames).optional(),
  verbose: z.boolean().optional(),
  animation: z.boolean().optional(),
  motion: z.enum(['full', 'reduced']).optional(),
  outputFormat: z.enum(['text', 'json', 'stream-json']).optional(),
  timeout: z.number().positive().max(86400).optional()
}).strict()
export type TerminalSettings = z.infer<typeof terminalSettingsSchema>
export type Theme = NonNullable<TerminalSettings['theme']>
export type OutputFormat = NonNullable<TerminalSettings['outputFormat']>
export const defaultSettings = { theme: 'system', verbose: false, motion: 'full', animation: true, outputFormat: 'text', timeout: 600 } as const
export const settingsPaths = (cwd: string) => ({
  user: join(terminalProfileDirectory(), 'settings.json'),
  project: join(cwd, '.roppo', 'settings.json'),
  local: join(cwd, '.roppo', 'settings.local.json')
})
function parse(value: unknown, source: string) {
  const result = terminalSettingsSchema.safeParse(value)
  if (!result.success) throw new CliError(source + ': ' + result.error.message, 'invalid_settings', 2)
  return result.data
}
function read(path: string): TerminalSettings {
  if (!existsSync(path)) return {}
  let value: unknown
  try { value = JSON.parse(readFileSync(path, 'utf8')) }
  catch (error) { throw new CliError(path + ': ' + (error as Error).message, 'invalid_settings', 2) }
  // Ignore the retired interface language in existing settings files.
  if (value && typeof value === 'object' && 'language' in value) delete value.language
  return parse(value, path)
}
export function loadTerminalSettings(cwd: string, extra?: string, overrides: TerminalSettings = {}) {
  const sources: string[] = []
  let settings: TerminalSettings = {}
  for (const path of Object.values(settingsPaths(cwd))) {
    if (!existsSync(path)) continue
    settings = { ...settings, ...read(path) }
    sources.push(path)
  }
  if (extra !== undefined) {
    if (extra.trimStart().startsWith('{')) {
      let value: unknown
      try { value = JSON.parse(extra) }
      catch (error) { throw new CliError('--settings: ' + (error as Error).message, 'invalid_settings', 2) }
      settings = { ...settings, ...parse(value, '--settings') }
      sources.push('--settings (JSON)')
    } else {
      const path = resolve(cwd, extra)
      if (!existsSync(path)) throw new CliError('Settings file not found: ' + path, 'invalid_settings', 2)
      settings = { ...settings, ...read(path) }
      sources.push(path)
    }
  }
  return { settings: { ...defaultSettings, ...settings, ...overrides }, sources, hasTheme: !!(overrides.theme ?? settings.theme) }
}
export function saveTerminalSetting(cwd: string, key: string, raw: string, scope: 'user' | 'project' | 'local' = 'user') {
  const value = (key === 'verbose' || key === 'animation') ? (raw === 'true' ? true : raw === 'false' ? false : raw)
    : key === 'timeout' ? Number(raw) : raw
  const patch = parse({ [key]: value }, '/config')
  const path = settingsPaths(cwd)[scope]
  const settings = { ...read(path), ...patch }
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temp = path + '.' + randomUUID() + '.tmp'
  writeFileSync(temp, JSON.stringify(settings, null, 2) + '\n', { mode: 0o600 })
  renameSync(temp, path)
  return { path, patch }
}
