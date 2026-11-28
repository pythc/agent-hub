import { expect, it } from 'vitest'
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  statSync,
  readdirSync,
  realpathSync
} from 'node:fs'
import { join } from 'node:path'
import { terminalCredentialFiles } from '../src/terminal/profile.ts'
import { projectRoot } from '../src/terminal/project.ts'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { spawn, execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { TerminalPairing } from '../src/terminal/pairing.ts'
import { clean, localOrigin, TerminalClient } from '../src/terminal/client.ts'
import { controlCommand } from '../src/terminal/controls.ts'
import { command } from '../src/terminal/commands.ts'
import { loadTerminalSettings } from '../src/terminal/settings.ts'
import { parseArgs } from '../src/terminal/main.ts'
import { configSchema, type Config } from '../src/config.ts'
import { Runtime } from '../src/runtime.ts'
import { serve } from '../src/server.ts'
import type { ModelRequest } from '../src/model.ts'

it('expires terminal pairs, rejects a wrong secret and consumes the credential once', () => {
  let now = 0
  const pairs = new TerminalPairing(() => now),
    p = pairs.start()
  expect(pairs.claim(p.id, p.secret).token).toBeUndefined()
  expect(() => pairs.claim(p.id, 'wrong')).toThrow()
  pairs.approve(p.id, () => 'credential')
  expect(pairs.claim(p.id, p.secret)).toEqual({ token: 'credential' })
  expect(() => pairs.claim(p.id, p.secret)).toThrow()
  const next = pairs.start()
  now = 181000
  expect(() => pairs.approve(next.id, () => 'unused')).toThrow()
})
it('validates local origins, escapes terminal controls and parses project options', () => {
  expect(() => localOrigin('http://127.0.0.1@other.example')).toThrow()
  expect(() => localOrigin('https://example.org')).toThrow()
  expect(clean('\x1b[2Jone\r\u202etwo')).toBe('onetwo')
  expect(parseArgs(['-p', '--json', '--file', 'notes', '--', '-line'])).toMatchObject({
    print: true,
    json: true,
    prompt: '-line',
    files: ['notes']
  })
  expect(() => parseArgs(['-r', 'id', '-c'])).toThrow()
})
it('includes each saved terminal credential in the host private files', () => {
  const saved = process.env.ROPPO_CLI_HOME,
    home = mkdtempSync(join(tmpdir(), 'roppo-cli-profile-'))
  try {
    process.env.ROPPO_CLI_HOME = home
    const file = join(home, '1'.repeat(64) + '.json')
    writeFileSync(file, '{}')
    writeFileSync(join(home, 'host.json'), '{}')
    expect(terminalCredentialFiles()).toContain(file)
    expect(terminalCredentialFiles()).not.toContain(join(home, 'host.json'))
  } finally {
    if (saved === undefined) delete process.env.ROPPO_CLI_HOME
    else process.env.ROPPO_CLI_HOME = saved
    rmSync(home, { recursive: true, force: true })
  }
})
it('pairs the actual executable, binds projects, waits for its Worker, resumes and revokes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'roppo-terminal-')),
    project = join(root, 'project'),
    other = join(root, 'other'),
    home = join(root, 'cli')
  mkdirSync(project)
  mkdirSync(other)
  writeFileSync(join(project, 'notes.txt'), 'visible')
  const config = configSchema.parse({
    stateDir: join(root, 'state'),
    port: 0,
    work: { sandboxDriver: 'disabled' },
    execution: {
      router: { mode: 'host' },
      management: { enabled: true },
      workers: [{ id: 'research', backend: 'codex' }]
    },
    sources: [
      {
        id: 'local',
        kind: 'local',
        cwd: project,
        allowedActors: ['operator'],
        workspace: { mode: 'source' }
      }
    ]
  })
  const cwds: string[] = []
  let workerApproval = false
  const savedHome = process.env.ROPPO_CLI_HOME
  const create = (config: Config) =>
    new Runtime(config, {
      model: {
        async catalog() {
          return { data: [{ id: 'fixture-model', supportedReasoningEfforts: ['low', 'high'] }] }
        },
        async run(r: ModelRequest) {
          cwds.push(realpathSync(r.cwd))
          const threadId = r.threadId ?? randomUUID(),
            turnId = randomUUID()
          r.onThread?.(threadId)
          r.onTurn?.(turnId)
          let result: unknown
          if (r.role === 'worker') {
            if (workerApproval) {
              workerApproval = false
              await r.onHumanRequest!({ id: randomUUID(), method: 'item/commandExecution/requestApproval', params: { command: 'read fixture', cwd: r.cwd } })
            }
            await delay(200)
            result = {
              state: 'ready',
              summary: 'Reviewed the file',
              reply: 'Worker complete',
              question: null,
              askedBy: null,
              handbacks: []
            }
          } else {
            const input = JSON.parse(r.input)
            if (input.kind === 'user_message' && input.trigger.text === 'failure') throw Error('Fixture provider unavailable')
            if (input.kind === 'user_message' && input.trigger.text === 'delegate approval') workerApproval = true
            if (input.kind === 'user_message' && input.trigger.text === 'slow') await delay(1400)
            if (input.kind === 'user_message' && input.trigger.text.includes('delegate')) {
              const assigned = await r.onTool!(
                'worker_manage',
                {
                  action: 'assign',
                  id: 'research',
                  revision: host.runtime.settings.current().revision,
                  requestId: randomUUID(),
                  text: 'Review notes'
                },
                'assign'
              )
              if (!assigned.success) throw Error('fixture could not assign the Worker')
              result = { reply: 'Work assigned' }
            } else
              result = {
                reply:
                  input.kind === 'user_message'
                    ? 'Echo ' + input.trigger.text
                    : 'Reviewed the Worker result'
              }
          }
          return { threadId, turnId, text: JSON.stringify(result) }
        }
      }
    })
  const host = await serve(create(config), { createRuntime: create })
  const bin = fileURLToPath(new URL('../bin/roppo.mjs', import.meta.url))
  const cli = (args: string[], stdin = '', onError?: (line: string) => void, interrupt = false) => {
    const child = spawn(process.execPath, [bin, ...args], {
      cwd: project,
      env: { ...process.env, CI: '1', ROPPO_HOST: host.url, ROPPO_CLI_HOME: home },
      stdio: 'pipe'
    })
    let stdout = '',
      stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk
      if (interrupt && stdout.includes('"subtype":"init"')) {
        interrupt = false
        child.kill('SIGINT')
      }
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
      onError?.(String(chunk))
    })
    child.stdin.end(stdin)
    return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      child.once('error', reject)
      child.once('close', (code) => resolve({ code, stdout, stderr }))
    })
  }
  const post = (path: string, data: unknown, headers: Record<string, string> = {}) =>
    fetch(host.url + path, {
      method: 'POST',
      headers: { origin: host.url, 'content-type': 'application/json', ...headers },
      body: JSON.stringify(data)
    })
  try {
    const setup = await post(
      '/account/setup',
      { username: 'local', displayName: 'Test', password: randomUUID() },
      { authorization: 'Bearer ' + readFileSync(host.tokenPath, 'utf8').trim() }
    )
    expect(setup.status).toBe(201)
    const cookie = setup.headers.getSetCookie()[0]!.split(';')[0]!
    let approved: Promise<Response> | undefined
    const login = await cli(['login'], '', (line) => {
      const id = line.match(/pair#([0-9a-f]{32})/)
      if (id) approved = post('/api/terminal/pair/approve', { id: id[1] }, { cookie })
    })
    expect((await approved)?.status).toBe(200)
    expect(login.code, login.stderr).toBe(0)
    const profile = join(home, readdirSync(home).find((f) => f !== 'host.json')!)
    expect(statSync(profile).mode & 0o777).toBe(0o600)
    const credential = JSON.parse(readFileSync(profile, 'utf8')).token
    const auth = { authorization: 'Roppo-CLI ' + credential }
    expect((await fetch(host.url + '/settings', { headers: auth })).status).toBe(401)
    const memory = await fetch(host.url + '/api/chat/memory', { headers: auth })
    expect(memory.status).toBe(200)
    expect(await memory.json()).toHaveProperty('contexts')
    // Newly exposed personal controls still resolve the signed-in owner on the server.
    expect((await post('/api/chat/memory', { action: 'forget', entryId: 'someone-else', id: 'private', revision: 1 }, auth)).status).toBe(400)
    const missingConversation = randomUUID()
    expect((await post('/api/chat/conversations/' + missingConversation + '/approvals', { id: randomUUID(), value: 'accept' }, auth)).status).toBe(404)
    expect((await fetch(host.url + '/api/chat/conversations/' + missingConversation + '/schedules', { method: 'PATCH', headers: { ...auth, origin: host.url, 'content-type': 'application/json' }, body: JSON.stringify({ id: 'private', operationId: randomUUID(), expectedRevision: 1, active: false }) })).status).toBe(404)
    const forged = cookie.split('=')[0] + '=terminal:' + credential
    expect((await fetch(host.url + '/settings', { headers: { cookie: forged } })).status).toBe(401)
    const space = await post('/api/chat/space', {}, { cookie })
    expect(space.status).toBe(200)
    const sharedId = (await space.json()).conversation.id
    const opened = await Promise.all([post('/api/chat/space', {}, auth), post('/api/chat/space', {}, auth)])
    for (const response of opened) expect((await response.json()).conversation.id).toBe(sharedId)
    const patch = await fetch(host.url + '/api/chat/space', {
      method: 'PATCH',
      headers: { ...auth, origin: host.url, 'content-type': 'application/json' },
      body: JSON.stringify({ approvalMode: 'full' })
    })
    expect(patch.status).toBe(401)
    const settingsResponse = await fetch(host.url + '/api/terminal/settings', { headers: auth })
    expect(settingsResponse.status).toBe(200)
    const terminalSettings = await settingsResponse.json() as any
    expect(terminalSettings).toMatchObject({ approvalMode: 'ask', backend: 'codex' })
    expect(terminalSettings).not.toHaveProperty('config')
    const modelChange = await post('/api/terminal/settings', { action: 'model', revision: terminalSettings.revision, backend: 'codex', model: 'fixture-model' }, auth)
    expect(modelChange.status).toBe(200)
    expect(host.runtime.config.execution.router?.model).toBe('fixture-model')
    expect((await post('/api/terminal/settings', { action: 'model', revision: terminalSettings.revision, backend: 'codex' }, auth)).status).toBe(409)
    let agents = await modelChange.json() as any
    const worker = agents.workers[0].id
    const setWorker = async (patch: object) => {
      const response = await post('/api/terminal/settings', { revision: agents.revision, worker, ...patch }, auth)
      expect(response.status).toBe(200); agents = await response.json() as any
    }
    await setWorker({ action: 'model', backend: 'codex', model: 'fixture-model' })
    await setWorker({ action: 'effort', effort: 'high' })
    await setWorker({ action: 'rename', label: 'My Worker' })
    expect(agents.workers[0]).toMatchObject({ id: worker, label: 'My Worker', model: 'fixture-model', effort: 'high' })
    expect(agents.effort).not.toBe('high')
    expect((await post('/api/terminal/settings', { action: 'effort', revision: agents.revision, worker, effort: 'ultra' }, auth)).status).toBe(400)
    expect((await post('/api/terminal/settings', { action: 'rename', revision: agents.revision, worker: 'missing', label: 'Wrong' }, auth)).status).toBe(404)
    expect((await post('/api/terminal/mode', { conversation: missingConversation, mode: 'plan' }, auth)).status).toBe(404)
    expect((await post('/api/terminal/clear', { conversation: missingConversation, operationId: randomUUID(), expectedSequence: 0 }, auth)).status).toBe(404)
    expect((await post('/api/terminal/settings', { action: 'permissions', mode: 'full', tools: ['*'] }, auth)).status).toBe(400)
    expect((await post('/api/terminal/settings', { action: 'permissions', mode: 'full' }, auth)).status).toBe(200)
    expect((await (await post('/api/chat/space', {}, { cookie })).json()).approvalMode).toBe('full')
    await post('/api/terminal/settings', { action: 'permissions', mode: 'ask' }, auth)
    const fresh = await (await post('/api/chat/conversations', {}, auth)).json() as any
    expect((await post('/api/terminal/session', { id: fresh.id }, auth)).status).toBe(200)
    expect((await (await post('/api/chat/space', {}, { cookie })).json()).conversation.id).toBe(fresh.id)
    await post('/api/terminal/session', { id: sharedId }, auth)
    const personalPrint = await cli(['-p', 'personal hello', '--json'])
    expect(personalPrint.code, personalPrint.stderr).toBe(0)
    expect(JSON.parse(personalPrint.stdout)).toMatchObject({ conversationId: sharedId, text: 'Echo personal hello' })
    const personalContinue = await cli(['-c', '-p', 'personal again', '--json'])
    expect(JSON.parse(personalContinue.stdout)).toMatchObject({ conversationId: sharedId, text: 'Echo personal again' })
    const personalResume = await cli(['-r', fresh.id, '-p', 'resume personal', '--json'])
    expect(JSON.parse(personalResume.stdout)).toMatchObject({ conversationId: fresh.id })
    expect((await (await post('/api/chat/space', {}, { cookie })).json()).conversation.id).toBe(fresh.id)
    await post('/api/terminal/session', { id: sharedId }, auth)
    const first = await cli(['--cwd', project, '-p', 'delegate', '--json', '--file', 'notes.txt'], 'piped context')
    expect(first.code, first.stderr + first.stdout).toBe(0)
    const run = JSON.parse(first.stdout)
    expect(run.conversationId).not.toBe(sharedId)
    expect(run).toMatchObject({
      status: 'completed',
      text: 'Reviewed the Worker result',
      tasks: [{ workerId: 'research', state: 'completed' }]
    })
    expect(cwds.every((c) => c === realpathSync(project))).toBe(true)
    const streamed = await cli(['--cwd', project, '-r', run.conversationId, '-p', 'streamed', '--output-format', 'stream-json'])
    expect(streamed.code, streamed.stderr).toBe(0)
    const events = streamed.stdout.trim().split('\n').map(line => JSON.parse(line))
    expect(events[0]).toMatchObject({ type: 'system', subtype: 'init', conversationId: run.conversationId })
    expect(events.at(-1)).toMatchObject({ type: 'result', status: 'completed', text: 'Echo streamed' })
    expect(events.filter(e => e.type === 'result')).toHaveLength(1)
    expect(events.some(e => e.type === 'assistant' && e.message.text === 'Echo streamed')).toBe(true)
    const context = await fetch(host.url + '/api/chat/conversations/' + run.conversationId + '/context', { headers: auth })
    expect(context.status).toBe(200)
    const next = await cli(['--cwd', project, '-c', '-p', 'second', '--json'])
    expect(next.code, next.stdout + next.stderr).toBe(0)
    expect(JSON.parse(next.stdout)).toMatchObject({
      conversationId: run.conversationId,
      text: 'Echo second'
    })
    const view = (await (
      await fetch(
        host.url +
          '/api/chat/conversations/' +
          run.conversationId +
          '?run=' +
          encodeURIComponent(run.runId),
        { headers: auth }
      )
    ).json()) as any
    expect(view.messages.find((m: any) => m.role === 'user')).toMatchObject({
      text: 'delegate\n\npiped context',
      attachments: [{ name: 'notes.txt' }]
    })
    expect(view.messages.every((m: any) => m.runId === run.runId)).toBe(true)
    expect((await cli(['-p', 'x', '--json', '--cwd', other])).code).toBe(1)
    const bound = await cli(['-p', 'other', '--cwd', other, '--trust-project', '--json'])
    expect(bound.code, bound.stdout + bound.stderr).toBe(0)
    const cross = await cli(['-r', run.conversationId, '-p', 'x', '--cwd', other])
    expect(cross.code).toBe(1)
    expect(cross.stderr).toContain('not found in this project')
    const crossTask = await post(
      '/api/terminal/tasks',
      { conversation: JSON.parse(bound.stdout).conversationId, ticket: run.tasks[0].id, action: 'stop' },
      auth
    )
    expect(crossTask.status).toBe(404)
    const resumed = await cli(['--cwd', project, '-p', 'slow', '--timeout', '0.04', '--json', '-r', run.conversationId])
    expect(resumed.code, resumed.stdout + resumed.stderr).toBe(124)
    const timeout = JSON.parse(resumed.stdout)
    expect(timeout).toMatchObject({ status: 'timeout', conversationId: run.conversationId })
    const old = (await (
      await fetch(
        host.url +
          '/api/chat/conversations/' +
          run.conversationId +
          '?run=' +
          encodeURIComponent(run.runId),
        { headers: auth }
      )
    ).json()) as any
    expect(old.run.state).toBe('completed')
    const cancelled = await post(
      '/api/chat/conversations/' + run.conversationId + '/cancel',
      { runId: timeout.runId },
      auth
    )
    expect(cancelled.status).toBe(200)
    const get = async (path: string) =>
      (await (await fetch(host.url + path, { headers: auth })).json()) as any
    expect(
      (
        await get(
          '/api/chat/conversations/' + run.conversationId + '?run=' + encodeURIComponent(timeout.runId)
        )
      ).run.state
    ).toBe('cancelled')
    const task = run.tasks[0].id
    const pending = host.runtime.approvals.request(task, {
      id: randomUUID(),
      method: 'item/commandExecution/requestApproval',
      params: { command: 'read fixture' }
    })
    const taskQuery = (action: string, extra: object = {}) =>
      post(
        '/api/terminal/tasks',
        { conversation: run.conversationId, ticket: task, action, ...extra },
        auth
      )
    const requests = (await (await taskQuery('approvals')).json()) as any
    expect(requests.pending).toHaveLength(1)
    expect(
      (
        await get(
          '/api/chat/conversations/' + run.conversationId + '?run=' + encodeURIComponent(run.runId)
        )
      ).run.state
    ).toBe('waiting')
    expect(
      (await taskQuery('answer', { approval: requests.pending[0].id, answer: 'decline' })).status
    ).toBe(200)
    await expect(pending).resolves.toEqual({ decision: 'decline' })
    expect((await taskQuery('diff')).status).toBe(404)
    // Exercise the real Git diff path against an isolated task worktree.
    execFileSync('git', ['init', '-q', project])
    execFileSync('git', ['-C', project, 'add', 'notes.txt'])
    execFileSync('git', [
      '-C',
      project,
      '-c',
      'user.name=QA',
      '-c',
      'user.email=qa@example.test',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-qm',
      'Initial'
    ])
    const nested = join(project, 'sub')
    mkdirSync(nested)
    expect(await projectRoot(nested)).toEqual({ cwd: realpathSync(project), git: true, committed: true })
    const child = join(nested,'child')
    mkdirSync(child)
    const registered = [{ ...config.sources.find(s=>s.kind==='local')!, cwd:nested }]
    expect(await projectRoot(child,registered)).toEqual({cwd:realpathSync(nested),git:false,committed:false})
    const dir = join(
      config.stateDir,
      'work',
      createHash('sha256').update(task).digest('hex').slice(0, 20)
    )
    mkdirSync(join(config.stateDir, 'work'), { recursive: true })
    execFileSync('git', ['-C', project, 'worktree', 'add', '--quiet', '--detach', dir])
    writeFileSync(join(dir, 'notes.txt'), 'change in task')
    writeFileSync(join(dir, 'new.txt'), 'not committed')
    host.runtime.store.put('run', task, { ...host.runtime.store.get<object>('run', task), cwd: dir })
    const diff = (await (await taskQuery('diff')).json()) as any
    expect(diff.diff).toContain('+change in task')
    expect(diff.untracked).toEqual(['new.txt'])
    const savedConversation = host.runtime.store.get<any>('chat-conversation', run.conversationId)
    host.runtime.store.put('chat-conversation', run.conversationId, { ...savedConversation, project: undefined })
    expect((await (await taskQuery('diff')).json() as any).diff).toContain('+change in task')
    host.runtime.store.put('chat-conversation', run.conversationId, savedConversation)
    expect(readFileSync(join(project, 'notes.txt'), 'utf8')).toBe('visible')
    const interrupted = await cli(['--cwd', project, '-r', run.conversationId, '-p', 'slow', '--output-format', 'stream-json'], '', undefined, true)
    expect(interrupted.code, interrupted.stderr + interrupted.stdout).toBe(130)
    const cancelledResult = JSON.parse(interrupted.stdout.trim().split('\n').at(-1)!)
    expect(cancelledResult).toMatchObject({ type: 'result', status: 'cancelled' })
    expect((await get('/api/chat/conversations/' + run.conversationId + '?run=' + cancelledResult.runId)).run.state).toBe('cancelled')

    // Exercise slash commands through their real authenticated host routes.
    process.env.ROPPO_CLI_HOME = home
    const client = new TerminalClient(host.url)
    const conversation = (await client.view(run.conversationId)).conversation
    const browserView = await (await fetch(host.url + '/api/chat/conversations/' + conversation.id, { headers: { cookie } })).json()
    expect(browserView.messages.map((m: any) => m.id)).toEqual((await client.view(conversation.id)).messages.map(m => m.id))
    const webSettings = async () => (await (await fetch(host.url + '/settings', { headers: { cookie } })).json()).current
    expect((await webSettings()).config.execution.router.model).toBe('fixture-model')
    let observedModel = ''
    const settingsAbort = new AbortController()
    const watching = client.watch(conversation.id, settingsAbort.signal, async () => {
      observedModel = (await client.request<any>('/api/terminal/settings')).model ?? ''
    }, () => {})
    try {
      await expect.poll(() => observedModel).toBe('fixture-model')
      const current = await webSettings()
      expect((await post('/settings', { revision: current.revision, patch: { execution: { ...current.config.execution, router: { ...current.config.execution.router, model: 'web-selected-model' } } } }, { cookie })).status).toBe(200)
      await expect.poll(() => observedModel).toBe('web-selected-model')
      const changed = await webSettings()
      expect((await post('/settings', { revision: changed.revision, patch: { execution: current.config.execution } }, { cookie })).status).toBe(200)
      await expect.poll(() => observedModel).toBe('fixture-model')
    } finally { settingsAbort.abort(); await watching }
    const preferences = loadTerminalSettings(project).settings
    const control = (input: string) => controlCommand(client, conversation, input, project, preferences, [])
    expect((await control('/status'))?.text).toContain('fixture-model')
    expect((await control('/context'))?.text).not.toContain('undefined')
    expect((await control('/model'))?.menu?.items.some(item => item.value === '/model codex')).toBe(true)
    expect((await control('/model codex'))?.menu?.items.some(item => item.value === '/model codex fixture-model')).toBe(true)
    expect((await control('/effort'))?.menu?.items.map(item => item.label)).toEqual(['default', 'low', 'high'])
    await control('/effort high')
    expect(await client.request('/api/terminal/settings')).toMatchObject({ effort: 'high' })
    await expect(control('/effort ultra')).rejects.toThrow()
    expect(await client.request('/api/terminal/settings')).toMatchObject({ effort: 'high' })
    await control('/effort default')
    await control('/model codex --default')
    expect((await client.request<any>('/api/terminal/settings')).model).toBeUndefined()
    await control('/permissions full')
    expect((await (await post('/api/chat/space', {}, { cookie })).json()).approvalMode).toBe('full')
    await control('/permissions ask')
    expect((await control('/rename'))?.text).toContain('interactive terminal')
    await control('/config theme=mono local')
    await control('/config verbose=true project')
    expect(loadTerminalSettings(project).settings).toMatchObject({ theme: 'mono', verbose: true })
    const background = await client.send(conversation.id, 'slow', [], 'en')
    expect((await control('/clear'))?.next).toBeUndefined()
    expect((await control('/clear'))?.text).toContain('interactive terminal')
    expect((await client.view(conversation.id)).messages.length).toBeGreaterThan(0)
    let backgroundView = await client.view(conversation.id, background.runId)
    for (let i = 0; i < 100 && backgroundView.run?.state !== 'completed'; i++) {
      await delay(50)
      backgroundView = await client.view(conversation.id, background.runId)
    }
    expect(backgroundView.run?.state).toBe('completed')
    expect((await control('/resume'))?.next).toBeUndefined()

    const text = await cli(['-p', 'plain text', '--output-format', 'text'])
    expect(text.code, text.stderr).toBe(0)
    expect(text.stdout.trim()).toBe('Echo plain text')
    const invalid = await cli(['-p', 'invalid', '--settings', '{"permissions":"full"}', '--output-format', 'stream-json'])
    expect(invalid.code).toBe(2)
    expect(JSON.parse(invalid.stdout)).toMatchObject({ type: 'result', status: 'error', code: 'invalid_settings' })
    const missing = await cli(['-p', 'missing file', '--file', 'absent.txt', '--json'])
    expect(missing.code).toBe(1)
    expect(JSON.parse(missing.stdout).status).toBe('error')
    const failed = await cli(['-p', 'failure', '--json', '--timeout', '10'])
    expect(failed.code, failed.stdout + failed.stderr).toBe(1)
    expect(JSON.parse(failed.stdout)).toMatchObject({ status: 'failed' })
    const waiting = await cli(['-p', 'delegate approval', '--json', '--timeout', '10'])
    expect(waiting.code, waiting.stdout + waiting.stderr).toBe(3)
    const approvalRun = JSON.parse(waiting.stdout)
    expect(approvalRun.status).toBe('waiting')
    const approvalView = await client.view(approvalRun.conversationId)
    const approval = approvalView.approvals.find(a => a.state === 'pending')!
    expect(approval).toBeDefined()
    const permissionMenu = (await controlCommand(client, approvalView.conversation, '/approvals', project, preferences, []))!
    expect(permissionMenu.menu!.items.some(item => item.value === '/approvals ' + approval.id)).toBe(true)
    expect(permissionMenu.menu!.items.every(item => !item.label.includes(approval.ticketId))).toBe(true)
    const choices = (await controlCommand(client, approvalView.conversation, '/approvals ' + approval.id, project, preferences, []))!
    expect(choices.menu!.items.map(item => item.label)).toEqual(['Allow', 'Decline'])
    expect(await command(client, approvalRun.conversationId, choices.menu!.items[1]!.value)).toBe('Response submitted.')
    expect((await cli(['logout'])).code).toBe(0)
    expect((await fetch(host.url + '/api/chat/readiness', { headers: auth })).status).toBe(401)
  } finally {
    if (savedHome === undefined) delete process.env.ROPPO_CLI_HOME
    else process.env.ROPPO_CLI_HOME = savedHome
    host.server.closeAllConnections()
    await new Promise<void>((r) => host.server.close(() => r()))
    await host.closeRuntime()
    rmSync(root, { recursive: true, force: true })
  }
}, 90000)
