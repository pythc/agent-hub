import { createCliRenderer, type CliRenderer } from '@opentui/core'
import { AppleTerminalOutput } from './apple-terminal-output.ts'

export async function withTerminalRenderer<T>(run: (renderer: CliRenderer) => Promise<T>): Promise<T> {
  const appleOutput = process.env.TERM_PROGRAM === 'Apple_Terminal' ? new AppleTerminalOutput(process.stdout) : undefined
  let terminal: CliRenderer | undefined
  const resize = () => terminal?.resize(process.stdout.columns, process.stdout.rows)
  if (appleOutput) process.stdin.on('data', appleOutput.rememberCursor)
  try {
    const renderer = terminal = await createCliRenderer({ screenMode: 'alternate-screen', exitOnCtrlC: false,
      ...(appleOutput ? { stdout: appleOutput as unknown as NodeJS.WriteStream, remote: false,
        environment: { OPENTUI_GRAPHICS: '0' } } : {}),
      useMouse: true, targetFps: 30, maxFps: 30, consoleMode: 'disabled', openConsoleOnError: false })
    // OpenTUI only installs SIGWINCH automatically for process.stdout itself.
    if (appleOutput) process.on('SIGWINCH', resize)
    return await run(renderer)
  } finally {
    terminal?.destroy()
    await terminal?.closed
    if (appleOutput) {
      process.off('SIGWINCH', resize)
      process.stdin.off('data', appleOutput.rememberCursor)
      appleOutput.destroy()
    }
  }
}
