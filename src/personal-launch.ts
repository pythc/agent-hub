import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)
type LaunchOptions = {
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  run?: (command: string, args: string[]) => Promise<void>
}
export type BrowserLaunch = {
  opened: boolean
  reason?: 'headless' | 'unsupported' | 'failed'
}

export function parseLauncherArgs(args: string[], maxPositionals: number) {
  const values: string[] = []
  let open = true,
    literal = false
  for (const arg of args) {
    if (!literal && arg === '--') literal = true
    else if (!literal && arg === '--no-open') open = false
    else if (!literal && arg.startsWith('--')) throw Error('Unknown option: ' + arg)
    else values.push(arg)
  }
  if (values.length > maxPositionals) throw Error('Too many launcher arguments')
  return { values, open }
}

/** The one-time setup credential goes only to the local app in the default browser. */
export async function openLocalBrowser(
  value: string,
  options: LaunchOptions = {}
): Promise<BrowserLaunch> {
  const url = new URL(value)
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    !['/configure', '/configure/', '/auth'].includes(url.pathname)
  ) {
    throw Error('The launcher requires a local Roppo entry URL')
  }
  const platform = options.platform ?? process.platform,
    env = options.env ?? process.env
  const ci = env.CI && !['0', 'false'].includes(env.CI.toLowerCase())
  if (
    ci ||
    env.SSH_CONNECTION ||
    env.SSH_TTY ||
    (platform === 'linux' && !env.DISPLAY && !env.WAYLAND_DISPLAY)
  ) {
    return { opened: false, reason: 'headless' }
  }
  const command =
    platform === 'darwin'
      ? 'open'
      : platform === 'win32'
        ? 'rundll32.exe'
        : platform === 'linux'
          ? 'xdg-open'
          : undefined
  if (!command) return { opened: false, reason: 'unsupported' }
  const args = platform === 'win32' ? ['url.dll,FileProtocolHandler', url.href] : [url.href]
  const run =
    options.run ??
    (async (binary, argv) => {
      await exec(binary, argv, { timeout: 5000, maxBuffer: 16000, windowsHide: true })
    })
  try {
    await run(command, args)
    return { opened: true }
  } catch {
    // A missing desktop/opener must not bring down the running app or expose command output.
    return { opened: false, reason: 'failed' }
  }
}

export async function announceLaunch(info: { url: string; [key: string]: unknown }, open: boolean) {
  // Keep the existing single JSON line for scripts and manual/headless deployment.
  process.stdout.write(JSON.stringify(info) + '\n')
  if (!open) return
  const result = await openLocalBrowser(info.url).catch(() => ({ opened: false }))
  if (!result.opened) process.stderr.write('Browser not opened. Open the URL above to continue.\n')
}
