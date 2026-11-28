import {chatUploadLimits} from '../execution-limits.ts'
import { terminalProfileDirectory } from './profile.ts'
import { createHash, randomUUID } from 'node:crypto'
import {
  readFileSync,
  statSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  renameSync,
  rmSync
} from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname, basename } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { stripVTControlCharacters } from 'node:util'
import { openLocalBrowser } from '../personal-launch.ts'
import type { ChatSessions } from '../chat.ts'
export type Snapshot = ReturnType<ChatSessions['view']>
export type Conversation = Snapshot['conversation']
export class CliError extends Error {
  constructor(
    message: string,
    readonly code = 'cli_error',
    readonly exit = 1
  ) {
    super(message)
  }
}
export const clean = (text: string) =>
  stripVTControlCharacters(text).replace(
    /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,
    ''
  )
export function localOrigin(input: string) {
  const u = new URL(input)
  if (
    u.protocol !== 'http:' ||
    !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) ||
    u.username ||
    u.password ||
    u.pathname !== '/' ||
    u.search ||
    u.hash
  )
    throw new CliError(
      'Choose a local HTTP host, for example http://127.0.0.1:4390.'
    )
  return u.origin
}
function privateWrite(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temp = path + '.' + randomUUID() + '.tmp'
  try {
    writeFileSync(temp, JSON.stringify(value), { mode: 0o600, flag: 'wx' })
    renameSync(temp, path)
  } finally {
    rmSync(temp, { force: true })
  }
}
function discoverHost() {
  const selected = join(terminalProfileDirectory(), 'host.json')
  if (!process.env.ROPPO_CONNECTION_FILE && existsSync(selected))
    return JSON.parse(readFileSync(selected, 'utf8')).url as string
  const path =
    process.env.ROPPO_CONNECTION_FILE ?? join(process.env.ROPPO_HOME ?? join(homedir(), '.agent-hub'), 'state', 'connection.json')
  if (!existsSync(path))
    throw new CliError(
      'No local host found. Run roppo init or set ROPPO_HOST.', 'host_not_found'
    )
  return JSON.parse(readFileSync(path, 'utf8')).url as string
}
export class TerminalClient {
  readonly base: string
  private readonly profile: string
  private token?: string
  constructor(host?: string) {
    this.base = localOrigin(host ?? process.env.ROPPO_HOST ?? discoverHost())
    this.profile = join(
      terminalProfileDirectory(),
      createHash('sha256').update(this.base).digest('hex') + '.json'
    )
    if (existsSync(this.profile)) this.token = JSON.parse(readFileSync(this.profile, 'utf8')).token
  }
  async request<T>(
    path: string,
    data?: unknown,
    {
      native,
      binary,
      bytes,
      signal,
      method,
      timeoutMs = 20_000
    }: { timeoutMs?: number; native?: boolean; binary?: Uint8Array; bytes?: boolean; signal?: AbortSignal; method?: 'DELETE' | 'PATCH' } = {}
  ): Promise<T> {
    const headers: Record<string, string> = {}
    if (!native) {
      if (!this.token)
        throw new CliError(
          'Sign in with roppo login on this host.',
          'login_required'
        )
      headers.authorization = 'Roppo-CLI ' + this.token
      headers.origin = this.base
    }
    if (data !== undefined || binary)
      headers['content-type'] = binary ? 'application/octet-stream' : 'application/json'
    let response: Response
    try {
      response = await fetch(this.base + path, {
        method: method ?? (data === undefined && !binary ? 'GET' : 'POST'),
        headers,
        redirect: 'error',
        body: binary ? new Uint8Array(binary) : JSON.stringify(data),
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
          : AbortSignal.timeout(timeoutMs)
      })
    } catch {
      throw new CliError(
        ('Cannot reach Roppo at ' + this.base + '. Check the local host.'),
        'host_unavailable'
      )
    }
    if (response.ok && bytes) return new Uint8Array(await response.arrayBuffer()) as T
    const result = (await response.json()) as { error?: string; code?: string }
    if (!response.ok)
      throw new CliError(
        response.status === 401
          ? 'Sign in with roppo login on this host.'
          : (result.error ?? result.code ?? response.statusText),
        result.code
      )
    return result as T
  }
  async watch(
    id: string,
    signal: AbortSignal,
    changed: () => Promise<void>,
    failed: (message: string) => void
  ) {
    let revision = ''
    while (!signal.aborted) {
      try {
        const headers: Record<string, string> = {
          authorization: 'Roppo-CLI ' + this.token,
          accept: 'text/event-stream'
        }
        if (revision) headers['last-event-id'] = revision
        const response = await fetch(this.base + '/api/chat/conversations/' + id + '/events', {
          headers,
          signal,
          redirect: 'error'
        })
        if (response.status === 401) {
          failed(
            'Sign-in expired. Reconnect with roppo login.'
          )
          return
        }
        if (!response.ok || !response.body)
          throw Error(
            'The host event stream is unavailable.'
          )
        const decoder = new TextDecoder()
        let buffer = ''
        for await (const chunk of response.body) {
          buffer += decoder.decode(chunk, { stream: true })
          let end
          while ((end = buffer.indexOf('\n\n')) >= 0) {
            const frame = buffer.slice(0, end)
            buffer = buffer.slice(end + 2)
            if (frame.includes('event: reset')) {
              failed(
                'This conversation was reset. Exit and start a new session.'
              )
              return
            }
            if (!frame.includes('event: change') && !frame.includes('event: settings')) continue
            await changed()
            revision = /^id: (.+)$/m.exec(frame)?.[1] ?? revision
          }
        }
      } catch (error) {
        if (!signal.aborted) failed((error as Error).message)
      }
      if (!signal.aborted) await delay(800, undefined, { signal }).catch(() => {})
    }
  }
  get signedIn() {
    return !!this.token
  }
  async loginWithPassword(input:{username:string;password:string;displayName?:string},setupToken?:string){
    const response=await fetch(this.base+(setupToken?'/account/setup':'/account/login'),{
      method:'POST',headers:{'content-type':'application/json',origin:this.base,...(setupToken?{authorization:'Bearer '+setupToken}:{})},
      body:JSON.stringify({...input,remember:true}),redirect:'error',signal:AbortSignal.timeout(20_000)
    })
    const result=await response.json() as {recoveryCode?:string;error?:string;code?:string}
    if(!response.ok)throw new CliError(result.error??result.code??'Sign-in failed',result.code)
    const cookie=response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ')
    const pair=await this.request<{id:string;secret:string}>('/api/terminal/pair/start',{}, {native:true})
    const approved=await fetch(this.base+'/api/terminal/pair/approve',{method:'POST',headers:{'content-type':'application/json',origin:this.base,cookie},body:JSON.stringify({id:pair.id}),redirect:'error',signal:AbortSignal.timeout(20_000)})
    if(!approved.ok)throw new CliError('Could not connect this terminal. Try roppo login.')
    const claim=await this.request<{token:string}>('/api/terminal/pair/claim',pair,{native:true})
    privateWrite(this.profile,{token:claim.token});privateWrite(join(terminalProfileDirectory(),'host.json'),{url:this.base});this.token=claim.token
    // The temporary browser session has served its purpose; keep only the CLI credential.
    await fetch(this.base+'/account/logout',{method:'POST',headers:{'content-type':'application/json',origin:this.base,cookie},body:'{}',redirect:'error',signal:AbortSignal.timeout(20_000)})
    return result
  }
  async login() {
    const pair = await this.request<{ id: string; secret: string }>(
      '/api/terminal/pair/start',
      {},
      { native: true }
    )
    const url = this.base + '/terminal/pair#' + pair.id
    process.stderr.write(
      '\nRoppo CLI  ·  Connect your account\n\nConnect code ' +
        pair.id.slice(-8).toUpperCase() +
        '  ' +
        url +
        '\n'
    )
    const browser = await openLocalBrowser(url)
    process.stderr.write(
      (browser.opened
        ? 'In your browser, match the code and choose Connect terminal.'
        : 'Open the link above, match the code and choose Connect terminal.') + '\n'
    )
    for (;;) {
      const { token } = await this.request<{ token?: string }>('/api/terminal/pair/claim', pair, {
        native: true
      })
      if (token) {
        privateWrite(this.profile, { token })
        privateWrite(join(terminalProfileDirectory(), 'host.json'), { url: this.base })
        this.token = token
        return
      }
      await delay(750)
    }
  }
  async logout() {
    await this.request('/api/terminal/logout', {})
    rmSync(this.profile, { force: true })
    this.token = undefined
  }
  project(cwd: string, trust = false) {
    return this.request<{ cwd: string; registered: boolean; sandbox: string }>(
      '/api/terminal/projects',
      { cwd, trust }
    )
  }
  create(cwd: string) {
    return this.request<Conversation>('/api/terminal/conversations', { cwd })
  }
  async list(cwd?: string) {
    return (
      await this.request<{ conversations: Conversation[] }>('/api/chat/conversations')
    ).conversations.filter((c) => c.project === cwd)
  }
  view(id: string, run?: string, signal?: AbortSignal) {
    return this.request<Snapshot>(
      '/api/chat/conversations/' + id + (run ? '?run=' + encodeURIComponent(run) : ''),
      undefined,
      { signal }
    )
  }
  older(id: string, before: number, signal: AbortSignal) {
    return this.request<Snapshot>(
      '/api/chat/conversations/' + id + '?before=' + before,
      undefined,
      { signal }
    )
  }
  link(id: string) {
    return this.base + '/chat#conversation/' + id
  }
  async send(id: string, text: string, files: string[], locale: string, options: { steer?: boolean; clientMessageId?: string; attachments?: string[]; uploaded?: (ids:string[])=>void } = {}) {
    const unique = options.attachments ? [] : [...new Set(files)]
    if (unique.length > chatUploadLimits.maxFiles)
      throw new CliError('Attach up to 32 files.')
    for (const file of unique) {
      const stat = statSync(file)
      if (!stat.isFile() || stat.size > chatUploadLimits.maxBytes)
        throw new CliError(
          'Choose a regular file under 100 MiB: ' + file
        )
    }
    const attachments: string[] = [...(options.attachments??[])],
      base = '/api/chat/conversations/' + id
    try {
      for (const file of unique) {
        const uuid = randomUUID()
        attachments.push(uuid)
        await this.request(
          base + '/attachments/' + uuid + '?name=' + encodeURIComponent(basename(file)),
          undefined,
          { binary: readFileSync(file) }
        )
      }
    } catch (error) {
      await Promise.allSettled(
        attachments.map((uuid) =>
          this.request(base + '/attachments/' + uuid, undefined, { method: 'DELETE' })
        )
      )
      throw error
    }
    options.uploaded?.(attachments)
    const input = { text, attachments, locale, ...(options.steer?{steer:true}:{}), clientMessageId: options.clientMessageId??randomUUID() }
    try {
      return await this.request<{ runId: string; delivery?: 'steered'|'next-turn' }>(base + '/messages', input)
    } catch (e) {
      if (!(e instanceof CliError && e.code === 'host_unavailable')) throw e
      return this.request<{ runId: string; delivery?: 'steered'|'next-turn' }>(base + '/messages', input)
    }
  }
}
