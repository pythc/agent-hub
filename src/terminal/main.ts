import {chooseSetupTheme,withSetupPages} from './setup-welcome.ts'
import {themeNames} from './themes.ts'
import {saveTerminalSetting} from './settings.ts'
import {accountSetup,configureConnection,setupClient,terminalSetupUI,SetupCancelled} from './setup.ts'
import { loadTerminalSettings, type TerminalSettings, type OutputFormat } from './settings.ts'
import { controlCommand } from './controls.ts'
import { PrintEvents } from './output.ts'
import {messageCharacters} from '../execution-limits.ts'
import { isApprovalPending } from '../chat-workflow.ts'
import type { CapabilitySnapshot } from '../capability-types.ts'
import { TerminalEditor } from './editor.ts'
import { TerminalLayout } from './presentation.ts'
import { SessionDisplay } from './session-display.ts'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { basename, resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { createInterface as promptInterface } from 'node:readline/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { TerminalClient, CliError, clean, type Snapshot, type Conversation } from './client.ts'
import { command, mentionedFiles, runResult } from './commands.ts'

const help = () =>
  `Roppo — your personal agent, shared with web Chat.

  roppo [prompt]                  Continue the conversation shared with web Chat
  roppo -c                        Continue your personal conversation
  roppo -r [id]                   Choose or resume a personal conversation
  roppo -p "prompt"               Print the result of one request
  cat notes.txt | roppo -p "Summarize"   Send piped text with an instruction
  roppo login | logout | init     Connect an account or start local setup

  --output-format FORMAT         text, json or stream-json (print mode)
  --json                         Alias for --output-format json
  --settings JSON_OR_FILE        Override terminal preferences for this launch
  --theme NAME                    Terminal color theme
  --verbose                      Expand tool activity by default
  --file PATH                    Attach a file (repeatable)
  --trust-project                Register the project on first use
  --timeout SECONDS              Wait limit for print mode (default 600)
  --cwd DIRECTORY                Explicit project mode (optional)
  --host URL                     Select a local Roppo instance
  --help, --version

  In a conversation, type /help for settings, files and pending requests.`
interface Options {
  settings?: string
  preferences: TerminalSettings
  settingsSources: string[]
  outputFormat?: OutputFormat
  print: boolean
  json: boolean
  latest: boolean
  resume?: string
  trust: boolean
  timeout: number
  cwd: string
  explicitProject?: boolean
  host?: string
  files: string[]
  prompt: string
  action?: string
}
export function parseArgs(args: string[]): Options {
  const o: Options = {
      preferences: {},
      settingsSources: [],
      print: false,
      json: false,
      latest: false,
      trust: false,
      timeout: 600,
      cwd: process.cwd(),
      files: [],
      prompt: ''
    },
    words: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!,
      value = () => {
        if (i + 1 >= args.length || args[i + 1]!.startsWith('--'))
          throw new CliError('Missing value for ' + a, 'usage', 2)
        return args[++i]!
      }
    if (a === '--') {
      words.push(...args.slice(i + 1))
      break
    }
    if (a === '--help' || a === '-h') o.action = 'help'
    else if (a === '--version' || a === '-V') o.action = 'version'
    else if (a === '--print' || a === '-p') o.print = true
    else if (a === '--json') { o.json = true; o.outputFormat = 'json' }
    else if (a === '--output-format') {
      const format = value()
      if (!['text', 'json', 'stream-json'].includes(format)) throw new CliError('Choose --output-format text|json|stream-json', 'usage', 2)
      o.outputFormat = format as OutputFormat
      o.json = format !== 'text'
      o.print = true
    }
    else if (a === '--settings') o.settings = value()
    else if (a === '--verbose') o.preferences.verbose = true
    else if (a === '--theme') {
      const theme = value()
      if (!themeNames.some(name => name === theme)) throw new CliError('Choose a theme: ' + themeNames.join(', '), 'usage', 2)
      o.preferences.theme = theme as TerminalSettings['theme']
    }
    else if (a === '--continue' || a === '-c') o.latest = true
    else if (a === '--resume' || a === '-r')
      o.resume = args[i + 1] && !args[i + 1]!.startsWith('-') ? args[++i] : ''
    else if (a === '--trust-project') o.trust = true
    else if (a === '--lang') throw new CliError('The Roppo CLI uses English. Remove --lang to continue.')
    else if (a === '--cwd') {
      o.cwd = resolve(value())
      o.explicitProject = true
    } else if (a === '--host') o.host = value()
    else if (a === '--timeout') {
      o.timeout = Number(value())
      o.preferences.timeout = o.timeout
      if (!Number.isFinite(o.timeout) || o.timeout <= 0 || o.timeout > 86400)
        throw new CliError(
          'Choose a timeout between 0 and 86400 seconds.',
          'usage',
          2
        )
    } else if (a === '--file') o.files.push(value())
    else if (a.startsWith('-'))
      throw new CliError('Unknown option ' + a, 'usage', 2)
    else if (!words.length && !o.action && ['init', 'login', 'logout', 'lang'].includes(a))
      o.action = a
    else words.push(a)
  }
  if (o.latest && o.resume !== undefined)
    throw new CliError('Choose either -c or -r.', 'usage', 2)
  o.prompt = words.join(' ')
  return o
}
async function ask(text: string) {
  const rl = promptInterface({ input: process.stdin, output: process.stderr })
  try {
    return (await rl.question(clean(text))).trim()
  } finally {
    rl.close()
  }
}
async function selectConversation(
  client: TerminalClient,
  o: Options,
  project: string | undefined,
  tty: boolean
) {
  if (!project && o.resume === undefined) {
    const { conversation } = await client.request<{ conversation: Conversation }>('/api/chat/space', {})
    return conversation
  }
  if (!o.latest && o.resume === undefined) return client.create(project!)
  const list = await client.list(project)
  if (!list.length)
    throw new CliError(
      'No saved conversations here. Start one with roppo.'
    )
  if (o.latest) return list[0]!
  if (o.resume) {
    const match = list.find((c) => c.id === o.resume)
    if (match) return match
    throw new CliError(project ? 'Conversation not found in this project.' : 'Personal conversation not found.')
  }
  if (!tty)
    throw new CliError(
      'Pass a conversation ID with -r when running a script.',
      'usage',
      2
    )
  if (process.env.TERM !== 'dumb') {
    const input = new TerminalEditor(process.stdin, process.stderr, project ?? o.cwd, (query) => ({
      title: 'Resume conversation',
      start: 0,
      end: query.length,
      empty: 'No matching conversations',
      items: list
        .filter((c) => (c.title + ' ' + c.id).toLowerCase().includes(query.toLowerCase()))
        .map((c) => ({
          label: c.title || 'New conversation',
          detail: new Date(c.updatedAt).toLocaleString(),
          value: c.id,
          submit: true
        }))
    }))
    const display = new SessionDisplay(process.stderr, input, false, true)
    const paint = () => display.paint()
    input.on('change', paint)
    process.stderr.on('resize', paint)
    try {
      paint()
      for await (const id of input) return list.find((c) => c.id === id)!
      return undefined
    } finally {
      input.close()
      display.close()
      process.stderr.off('resize', paint)
    }
  }
  const layout = new TerminalLayout(
    process.stderr.columns || 80,
    !!process.stderr.isTTY && !process.env.NO_COLOR && process.env.TERM !== 'dumb'
  )
  const choices = [
    ...layout.result('Resume a conversation · ' + (project ? basename(project) : 'Personal chat'))
  ]
  for (const [i, c] of list.entries()) {
    choices.push(
      ...layout.message(
        String(i + 1) + '. ' + (c.title || 'New conversation'),
        c.id,
        true
      )
    )
  }
  process.stderr.write(choices.join('\n') + '\n\n')
  const n = Number(await ask('Resume number › '))
  if (!Number.isInteger(n) || !list[n - 1])
    throw new CliError('Invalid selection.')
  return list[n - 1]!
}
const locale = () => Intl.DateTimeFormat().resolvedOptions().locale
const terminalStates = ['completed', 'failed', 'cancelled', 'waiting']
async function printRun(client: TerminalClient, c: Conversation, o: Options) {
  const sent = await client.send(
    c.id,
    o.prompt,
    o.files.map((f) => resolve(o.cwd, f)),
    locale()
  )
  const cancelled = new AbortController()
  const wait = AbortSignal.any([cancelled.signal, AbortSignal.timeout(Math.max(1, Math.ceil(o.timeout * 1000)))])
  let cancellation: Promise<unknown> | undefined
  const interrupt = () => {
    cancelled.abort()
    cancellation ??= client.request('/api/chat/conversations/' + c.id + '/cancel', { runId: sent.runId })
      .catch(error => process.stderr.write(clean((error as Error).message) + '\n'))
  }
  process.once('SIGINT', interrupt)
  const events = o.outputFormat === 'stream-json' ? new PrintEvents(event => console.log(JSON.stringify(event))) : undefined
  if (events) console.log(JSON.stringify({ type: 'system', subtype: 'init', conversationId: c.id, runId: sent.runId, url: client.link(c.id) }))
  let view: Snapshot | undefined
  let status = 'timeout'
  try {
    while (!wait.aborted) {
      try {
        view = await client.view(c.id, sent.runId, wait)
        events?.update(view, sent.runId)
        if (view.run && terminalStates.includes(view.run.state)) {
          status = view.run.state
          break
        }
      } catch (error) {
        if (
          !wait.aborted &&
          !(
            error instanceof CliError &&
            ['host_unavailable', 'configuration_restarting'].includes(error.code)
          )
        )
          throw error
      }
      await delay(600, undefined, { signal: wait }).catch(() => {})
    }
  } finally {
    process.off('SIGINT', interrupt)
    await cancellation
  }
  if (cancelled.signal.aborted) status = 'cancelled'
  const result = view
    ? runResult(view, sent.runId, status)
    : { conversationId: c.id, runId: sent.runId, status, text: '', tasks: [], deliveries: [] }
  if (o.json) console.log(JSON.stringify({ ...(events ? { type: 'result' } : {}), ...result, url: client.link(c.id) }))
  else {
    if (result.text) console.log(clean(result.text))
    for (const delivery of result.deliveries)
      console.log(clean(delivery.name + '  ' + client.base + delivery.path))
    if (status !== 'completed')
      process.stderr.write(clean(status + ' · ' + client.link(c.id)) + '\n')
  }
  switch (status) {
    case 'completed':
      return 0
    case 'waiting':
      return 3
    case 'timeout':
      return 124
    case 'cancelled':
      return 130
    default:
      return 1
  }
}
async function interactive(client: TerminalClient, c: Conversation, o: Options) {
  if (process.env.TERM !== 'dumb' && process.env.ROPPO_LEGACY_TUI !== '1') {
    const { interactiveTui } = await import('./tui.ts')
    return interactiveTui(client, c, o)
  }
  const plain = process.env.TERM === 'dumb'
  const editor = plain
    ? undefined
    : new TerminalEditor(process.stdin, process.stdout, o.cwd, undefined, () =>
        client.request<CapabilitySnapshot>('/api/capability-library')
      )
  const basic = plain
    ? createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: false,
        prompt: '› '
      })
    : undefined
  const rl = editor ?? basic!
  const lines: AsyncIterable<string> = rl
  if (editor) editor.expanded = o.preferences.verbose ?? false
  const display = new SessionDisplay(process.stdout, rl, plain, false, o.preferences.theme)
  display.motion = o.preferences.motion ?? 'full'
  let nextConversation: Conversation | undefined
  const stream = new AbortController()
  let stopped = false,
    buffer = '',
    lastError = ''
  let latest: Snapshot | undefined,
    interrupting = false
  let tick: NodeJS.Timeout | undefined
  let redraw: NodeJS.Immediate | undefined
  const requestDraw = () => {
    if (stopped || redraw) return
    redraw = setImmediate(() => {
      redraw = undefined
      if (!stopped) display.paint()
    })
  }
  let oldest: number | undefined,
    hasOlder = false,
    loadingOlder = false
  const syncAnimation = () => {
    const waiting = latest?.run?.state === 'waiting' || latest?.approvals.some(a => isApprovalPending(a))
    const busy = display.sending || display.loading || !waiting && (latest?.run?.state === 'running' || latest?.run?.state === 'queued' ||
      latest?.run?.state === 'cancel_requested' || latest?.tasks.some(t => ['queued', 'running'].includes(t.state)))
    const animate = editor && busy && display.motion !== 'reduced'
    if (animate && !tick) tick = setInterval(requestDraw, 150).unref()
    if (!animate && tick) { clearInterval(tick); tick = undefined }
  }
  editor?.on('page', async (direction: number, lines?: number) => {
    if (!display.scroll(direction, lines) || !hasOlder || oldest === undefined || loadingOlder) return
    const revision = display.scrollPositionRevision
    loadingOlder = true
    try {
      const page = await client.older(c.id, oldest, stream.signal)
      if (stopped) return
      hasOlder = page.hasMore
      oldest = page.messages[0]?.sequence
      display.prepend(page.messages, revision)
    } catch (error) {
      if (!stopped) say((error as Error).message, true)
    } finally {
      loadingOlder = false
    }
  })
  const refresh = async () => {
    const view = await client.view(c.id, undefined, stream.signal)
    if (stopped) return
    if (!latest) {
      oldest = view.messages[0]?.sequence
      hasOlder = view.hasMore
      editor?.recall(
        view.messages.filter((m) => m.role === 'user' && !m.recipient).map((m) => m.text)
      )
    }
    latest = view
    editor?.setView(view)
    display.update(view)
    syncAnimation()
  }
  const say = (value: string, error = false) => {
    if (!stopped) display.notice((l) => l.result(value, error))
  }
  const send = async (text: string, files: string[] = []) => {
    display.sending = true
    display.paint()
    syncAnimation()
    try {
      await client.send(c.id, text, [...files, ...mentionedFiles(text, o.cwd)], locale())
    } finally {
      display.sending = false
      display.paint()
      syncAnimation()
    }
  }
  editor?.on('change', requestDraw)
  editor?.on('redraw', () => display.redraw())
  editor?.on('notice', (message) => say(message, true))
  editor?.on('interrupt', async () => {
    const run = latest?.run
    if (interrupting || !run || !['running', 'queued', 'waiting'].includes(run.state)) return
    interrupting = true
    try {
      await client.request('/api/chat/conversations/' + c.id + '/cancel', { runId: run.id })
    } catch (error) {
      say((error as Error).message, true)
    } finally {
      interrupting = false
    }
  })
  const closed = () => {
    stopped = true
    stream.abort()
  }
  editor?.on('close', closed)
  basic?.on('close', closed)
  process.stdout.on('resize', requestDraw)
  let watch: Promise<void> | undefined
  try {
    await refresh()
    if (o.prompt || o.files.length)
      await send(
        o.prompt,
        o.files.map((f) => resolve(o.cwd, f))
      )
    watch = client.watch(
      c.id,
      stream.signal,
      async () => {
        await refresh()
        lastError = ''
      },
      (message) => {
        if (message !== lastError) {
          lastError = message
          say(message, true)
        }
      }
    )
    basic?.prompt()
    for await (const line of lines) {
      if (basic && line.endsWith('\\')) {
        buffer += line.slice(0, -1) + '\n'
        display.continuation = true
        display.paint()
        basic?.prompt()
        continue
      }
      display.continuation = false
      const text = (buffer + line).trim()
      buffer = ''
      if (text === '/exit' || text === '/quit') {
        rl.close()
        break
      }
      try {
        if (text.startsWith('/') && !text.includes('\n')) {
          display.loading = true
          display.paint()
          syncAnimation()
          if (!['/choose ', '/tools --inspect ', '/approvals ', '/approve ', '/decline ', '/answer '].some(prefix => text.startsWith(prefix)))
            display.notice((l) => l.message('You', text, true))
          const control = await controlCommand(client, c, text, o.cwd, o.preferences, o.settingsSources)
          if (control) {
            if (control.next) { nextConversation = control.next; break }
            if (control.preferences) {
              Object.assign(o.preferences, control.preferences)
              if (control.preferences.theme) display.setTheme(control.preferences.theme)
              if (control.preferences.motion) display.motion = control.preferences.motion
              if (editor && control.preferences.verbose !== undefined) editor.expanded = control.preferences.verbose
            }
            if (control.menu) {
              if (editor) editor.pick(control.menu.title, control.menu.items)
              else say(control.menu.title + '\n' + control.menu.items.map(item => item.value + '  ' + item.label).join('\n'))
            }
            if (control.text && (!control.menu || !editor || text.startsWith('/model ') || text.startsWith('/approvals '))) say(control.text)
            await refresh()
            basic?.prompt()
            continue
          }
          const result = await command(client, c.id, text)
          if (result)
            display.notice((l) => (text.startsWith('/diff ') ? l.diff(result) : l.result(result)))
        } else if (text) {
          display.follow()
          await send(text)
        }
      } catch (e) {
        editor?.restoreDraft(text)
        say((e as Error).message, true)
      } finally {
        display.loading = false
        syncAnimation()
        display.paint()
      }
      basic?.prompt()
    }
  } finally {
    stopped = true
    stream.abort()
    clearImmediate(redraw)
    clearInterval(tick)
    process.stdout.off('resize', requestDraw)
    display.close()
    rl.close()
    process.stdin.pause()
    await watch
  }
  return nextConversation
}
export async function main(args: string[]): Promise<number> {
  let json = args.includes('--json') || ['json', 'stream-json'].includes(args[args.indexOf('--output-format') + 1] ?? '')
  let streaming = args[args.indexOf('--output-format') + 1] === 'stream-json'
  try {
    const o = parseArgs(args)
    if (o.action === 'lang') { console.log('The Roppo CLI uses English.'); return 0 }
    json = o.json
    if (o.action === 'help') {
      console.log(help())
      return 0
    }
    if (o.action === 'version') {
      console.log(
        JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version
      )
      return 0
    }
    const loaded = loadTerminalSettings(o.cwd, o.settings, o.preferences)
    o.preferences = loaded.settings
    o.settingsSources = loaded.sources
    o.timeout = o.preferences.timeout ?? 600
    o.outputFormat ??= o.preferences.outputFormat ?? 'text'
    const session = async (conversation: Conversation): Promise<number> => {
      let current: Conversation | undefined = conversation
      while (current) {
        current = await interactive(client, current, o)
        o.prompt = ''
        o.files = []
      }
      return 0
    }
    const tty = !!(process.stdin.isTTY && process.stdout.isTTY)
    const print = o.print || o.json || !tty
    o.json = print && o.outputFormat !== 'text'
    json = o.json
    streaming = print && o.outputFormat === 'stream-json'
    const screen = tty && process.env.TERM !== 'dumb' && !o.print && !o.json
    const clearScreen = '\x1b[2J\x1b[H'
    if (screen && process.env.ROPPO_LEGACY_TUI === '1' && o.action !== 'logout') process.stdout.write(clearScreen)
    if (o.action === 'init' && !tty) throw new CliError('Run roppo init in an interactive terminal.','usage',2)
    const dialog = !print || o.action === 'init' ? terminalSetupUI() : undefined
    const client = dialog ? await setupClient(o.host,dialog) : new TerminalClient(o.host)
    if (o.action === 'login') {
      await client.login()
      process.stderr.write('Connected to ' + client.base + '\n')
      return 0
    }
    if (o.action === 'logout') {
      await client.logout()
      return 0
    }
    if (print && !process.stdin.isTTY) {
      let bytes = 0
      const chunks: Buffer[] = []
      for await (const chunk of process.stdin) {
        bytes += chunk.length
        if (bytes > messageCharacters * 4)
          throw new CliError(
            'Input exceeds 256,000 characters.',
            'usage',
            2
          )
        chunks.push(chunk)
      }
      const piped = Buffer.concat(chunks).toString('utf8').trim()
      o.prompt = [o.prompt, piped].filter(Boolean).join('\n\n')
    }
    if (o.prompt.length > messageCharacters || (print && !o.prompt && !o.files.length))
      throw new CliError(
        'Provide a prompt or file (up to 256,000 characters).',
        'usage',
        2
      )
    const needsLogin = !client.signedIn && !print
    if (dialog) {
      const needsConnection = o.action === 'init' || needsLogin ||
        !(await client.request<{ready:boolean}>('/api/terminal/setup')).ready
      if (needsConnection) await withSetupPages(dialog,o.preferences,async pages => {
        await accountSetup(client,pages)
        if (o.action === 'init' || !needsLogin || !(await client.request<{ready:boolean}>('/api/terminal/setup')).ready)
          await configureConnection(client,pages)
      })
      if (!loaded.hasTheme) {
        const appearance = await chooseSetupTheme(dialog,o.preferences)
        for (const [key,value] of Object.entries(appearance)) saveTerminalSetting(o.cwd,key,String(value))
        Object.assign(o.preferences,appearance)
      }
      if (o.action === 'init') return 0
    }
    if (!o.explicitProject && !o.trust) {
      if (screen && needsLogin) process.stdout.write(clearScreen)
      const conversation = await selectConversation(client, o, undefined, tty && !print)
      if (!conversation) return 0
      if (o.resume !== undefined) await client.request('/api/terminal/session', { id: conversation.id })
      return print ? await printRun(client, conversation, o) : await session(conversation)
    }
    const project = await client.project(o.cwd, o.trust)
    if (!project.registered) {
      if (print)
        throw new CliError(
          'First use of this project. Run roppo --cwd . or pass --trust-project.',
          'project_trust_required'
        )
      if (
        !/^y(es)?$/i.test(
          await ask(
            ('Register ' + project.cwd + ' with ' + project.sandbox + ' access? [y/N] ')
          )
        )
      )
        return 0
      await client.project(project.cwd, true)
    }
    if (screen && (needsLogin || !project.registered)) process.stdout.write(clearScreen)
    const c = await selectConversation(client, o, project.cwd, tty && !print)
    if (!c) return 0
    return print ? await printRun(client, c, o) : await session(c)
  } catch (e) {
    if (e instanceof SetupCancelled) { process.stderr.write(e.message+'\n'); return 0 }
    const err = e as Error
    if (json)
      console.log(
        JSON.stringify({
          ...(streaming ? { type: 'result' } : {}),
          status: 'error',
          code: e instanceof CliError ? e.code : 'cli_error',
          error: err.message
        })
      )
    else process.stderr.write(clean(err.message) + '\n')
    return e instanceof CliError ? e.exit : 1
  }
}
