import { expect, it, vi } from 'vitest'
import { openLocalBrowser, parseLauncherArgs } from '../src/personal-launch.ts'

const url = 'http://127.0.0.1:4319/configure#pair=local-once-only'

it.each([
  ['darwin', {}, 'open', [url]],
  ['win32', {}, 'rundll32.exe', ['url.dll,FileProtocolHandler', url]],
  ['linux', { DISPLAY: ':1' }, 'xdg-open', [url]],
  ['linux', { WAYLAND_DISPLAY: 'wayland-0' }, 'xdg-open', [url]]
] as const)(
  'hands the local entry URL to the %s desktop opener as arguments',
  async (platform, env, command, args) => {
    const run = vi.fn(async () => {})
    expect(await openLocalBrowser(url, { platform, env, run })).toEqual({ opened: true })
    expect(run).toHaveBeenCalledExactlyOnceWith(command, [...args])
  }
)

it.each([
  ['darwin', { CI: 'true' }],
  ['darwin', { SSH_CONNECTION: 'local test connection' }],
  ['linux', {}],
  ['linux', { DISPLAY: ':1', SSH_TTY: '/dev/test' }]
] as const)('keeps a manual entry for %s without an interactive desktop', async (platform, env) => {
  const run = vi.fn(async () => {})
  expect(await openLocalBrowser(url, { platform, env, run })).toEqual({
    opened: false,
    reason: 'headless'
  })
  expect(run).not.toHaveBeenCalled()
})

it('does not treat CI=false as headless and does not fail the app when opening fails', async () => {
  const run = vi.fn(async () => {
    throw Error('opener stderr can contain a private URL')
  })
  expect(await openLocalBrowser(url, { platform: 'darwin', env: { CI: 'false' }, run })).toEqual({
    opened: false,
    reason: 'failed'
  })
  expect(run).toHaveBeenCalledTimes(1)
  expect(await openLocalBrowser(url, { platform: 'freebsd', env: {}, run })).toEqual({
    opened: false,
    reason: 'unsupported'
  })
  expect(run).toHaveBeenCalledTimes(1)
})

it('rejects non-local destinations and credentials before invoking a desktop program', async () => {
  const run = vi.fn(async () => {})
  for (const value of [
    'https://example.com/configure',
    'file:///tmp/setup',
    'http://127.0.0.1.example.com/configure',
    'http://secret@localhost/configure',
    'http://localhost/worker',
    'not a URL'
  ]) {
    await expect(openLocalBrowser(value, { platform: 'darwin', env: {}, run })).rejects.toThrow()
  }
  expect(run).not.toHaveBeenCalled()
})

it('recognizes manual mode without mistaking flags for installation directories', () => {
  expect(parseLauncherArgs(['--no-open', '/tmp/my roppo'], 1)).toEqual({
    values: ['/tmp/my roppo'],
    open: false
  })
  expect(parseLauncherArgs(['/tmp/my roppo', '--no-open'], 1).open).toBe(false)
  expect(parseLauncherArgs([], 1)).toEqual({ values: [], open: true })
  expect(parseLauncherArgs(['--', '--literal-directory'], 1).values).toEqual([
    '--literal-directory'
  ])
  expect(() => parseLauncherArgs(['--unknown'], 1)).toThrow('Unknown option')
  expect(() => parseLauncherArgs(['first', 'second'], 1)).toThrow('Too many')
})
