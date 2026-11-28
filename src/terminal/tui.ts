import { withTerminalRenderer } from './renderer-session.ts'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { TuiScreen } from './tui-screen.ts'
import { TuiCommands } from './tui-actions.ts'
import { TerminalClient, type Conversation, type Snapshot } from './client.ts'
import { mentionedFiles } from './commands.ts'
import type { HostSettings } from './host-settings.ts'
import type { TerminalSettings } from './settings.ts'

export async function interactiveTui(client: TerminalClient, conversation: Conversation, options: {
  cwd: string; preferences: TerminalSettings; settingsSources: string[]; prompt: string; files: string[]
}): Promise<Conversation | undefined> {
  return withTerminalRenderer(async renderer => {
    const abort = new AbortController()
    let view: Snapshot, next: Conversation | undefined, stopped = false, loadingOlder = false
    let watch: Promise<void> | undefined
    let finish!: () => void
    const done = new Promise<void>(resolve => { finish = resolve })
    const quit = (conversation?: Conversation) => { next = conversation; stopped = true; abort.abort(); finish() }
    const refresh = async () => {
      const [current, settings] = await Promise.all([
        client.view(conversation.id, undefined, abort.signal), client.request<HostSettings>('/api/terminal/settings', undefined, { signal: abort.signal })
      ])
      if (stopped || view && current.conversation.contextVersion < view.conversation.contextVersion) return
      if (view && view.conversation.contextVersion === current.conversation.contextVersion) {
        const recent = new Set(current.messages.map(m => m.id))
        const earlier = view.messages.filter(m => !recent.has(m.id) && m.sequence < (current.messages[0]?.sequence ?? Infinity))
        current.messages = [...earlier, ...current.messages]
        if (earlier.length) current.hasMore = view.hasMore
      }
      view = current; screen.update(view); screen.settings(settings); screen.connection(true)
    }
    const older = async () => {
      if (loadingOlder || !view?.hasMore || !view.messages.length) return
      loadingOlder = true
      try {
        const page = await client.older(conversation.id, view.messages[0]!.sequence, abort.signal)
        if (stopped || page.conversation.contextVersion !== view.conversation.contextVersion) return
        const known = new Set(view.messages.map(m => m.id))
        view = { ...view, messages: [...page.messages.filter(m => !known.has(m.id)), ...view.messages], hasMore: page.hasMore }
        screen.update(view, true)
      } finally { loadingOlder = false }
    }
    const send = async (text: string, files: string[] = []) => {
      screen.setLoading(true)
      try {
        await client.send(conversation.id, text, [...files, ...mentionedFiles(text, options.cwd)], Intl.DateTimeFormat().resolvedOptions().locale)
        screen.run(refresh().then(() => { if (!stopped) screen.latest() }))
      }
      finally { if (!stopped) screen.setLoading(false) }
    }
    const interrupt = async () => {
      const run = view?.run
      if (run && ['running', 'queued', 'waiting'].includes(run.state)) {
        await client.request('/api/chat/conversations/' + conversation.id + '/cancel', { runId: run.id }); await refresh()
      }
    }
    const screen: TuiScreen = new TuiScreen(renderer, options.preferences, {
      send, interrupt, older, quit: () => quit(),
      copy: async text => {
        if (process.platform !== 'darwin') { renderer.copyToClipboardOSC52(text); return }
        await new Promise<void>((resolve, reject) => {
          const copy = spawn('pbcopy', [], { stdio: ['pipe', 'ignore', 'ignore'] })
          copy.once('error', reject); copy.once('close', code => code === 0 ? resolve() : reject(Error('Could not copy text')))
          copy.stdin.end(text)
        })
      },
      command: input => commands.execute(input), complete: input => commands.complete(input), review: () => commands.review()
    })
    const commands: TuiCommands = new TuiCommands(client, conversation, screen, options, () => view, refresh, quit, older)
    renderer.once('destroy', () => quit())
    try {
      screen.setLoading(true); await refresh(); screen.setLoading(false)
      watch = client.watch(conversation.id, abort.signal, refresh, message => { if (!stopped) { screen.connection(false); screen.notice(message, true) } })
      if (options.prompt || options.files.length) await send(options.prompt, options.files.map(file => resolve(options.cwd, file)))
      await done
    } catch (error) {
      if (!abort.signal.aborted) throw error
    } finally {
      stopped = true; abort.abort(); screen.close(); await watch
    }
    return next
  })
}
