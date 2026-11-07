import { mkdtempSync, rmSync, readFileSync, writeFileSync, statSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Script } from 'node:vm'
import { configurationPage } from '../src/ui/configuration.ts'
import { accountPage } from '../src/ui/account.ts'
import { afterEach, it, expect } from 'vitest'
import { configSchema } from '../src/config.ts'
import { Runtime } from '../src/runtime.ts'
import { serve } from '../src/server.ts'
import { PersonalAccount } from '../src/personal-account.ts'
import { backupState, restoreState } from '../src/backup.ts'

const roots: string[] = [],
  closers: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const close of closers.splice(0)) await close()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
const owner = {
  username: 'local.owner',
  displayName: 'Local Owner',
  password: 'a long local passphrase',
  remember: true
}
function root() {
  const value = mkdtempSync(join(tmpdir(), 'roppo-account-'))
  roots.push(value)
  return value
}
async function hostFixture(dir = root()) {
  mkdirSync(join(dir, 'files'), { recursive: true })
  const config = configSchema.parse({
    stateDir: join(dir, 'state'),
    port: 0,
    work: { sandboxDriver: 'disabled', network: false },
    sources: [{ id: 'local', kind: 'local', cwd: join(dir, 'files'), allowedActors: ['operator'] }]
  })
  const runtime = new Runtime(config, {
    model: {
      async run() {
        throw Error('Account tests never execute a model')
      }
    }
  })
  runtime.pause(true)
  const host = await serve(runtime),
    bearer = 'Bearer ' + readFileSync(host.tokenPath, 'utf8').trim()
  let closed = false
  const close = async () => {
    if (closed) return
    closed = true
    await new Promise<void>((r) => host.server.close(() => r()))
    await host.closeRuntime()
  }
  closers.push(close)
  async function request(
    path: string,
    body?: unknown,
    cookie = '',
    extra: Record<string, string> = {}
  ) {
    const response = await fetch(host.url + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        origin: host.url,
        'content-type': 'application/json',
        ...(cookie ? { cookie } : {}),
        ...extra
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    })
    const type = response.headers.get('content-type') || ''
    return {
      status: response.status,
      body: type.includes('json') ? await response.json() : await response.text(),
      cookie: response.headers.get('set-cookie')?.split(';')[0] || '',
      setCookie: response.headers.get('set-cookie') || ''
    }
  }
  async function setup() {
    const pair = await request('/pair', { code: new URL(host.operatorUrl).hash.slice(6) })
    const result = await request('/account/setup', owner, pair.cookie)
    expect(result.status).toBe(201)
    return { ...result, bootstrap: pair.cookie }
  }
  return { dir, host, runtime, request, setup, close, bearer }
}
it('requires local bootstrap authorization, claims once, hides secrets, and gates the workspace', async () => {
  const f = await hostFixture()
  expect((await f.request('/account/status')).body).toEqual({
    configured: false,
    authenticated: false,
    setupAllowed: false
  })
  expect((await f.request('/configure')).body).toContain('id="account-app"')
  expect((await f.request('/account/setup', owner)).status).toBe(403)
  const pair = await f.request('/pair', { code: new URL(f.host.operatorUrl).hash.slice(6) })
  expect((await f.request('/account/status', undefined, pair.cookie)).body.setupAllowed).toBe(true)
  const attempts = await Promise.all([
    f.request('/account/setup', owner, pair.cookie),
    f.request('/account/setup', { ...owner, username: 'other-owner' }, pair.cookie)
  ])
  expect(attempts.map((r) => r.status).sort()).toEqual([201, 409])
  const account = attempts.find((r) => r.status === 201)!
  expect(account.setCookie).toContain('HttpOnly; SameSite=Strict')
  expect(account.setCookie).toContain('Max-Age=2592000')
  expect((await f.request('/configuration', undefined, pair.cookie)).status).toBe(401)
  expect((await f.request('/configuration', undefined, account.cookie)).status).toBe(200)
  const workspacePage=(await f.request('/configure', undefined, account.cookie)).body
  expect(workspacePage).toContain('id="root"')
  expect((await f.request('/chat', undefined, account.cookie)).body).toBe(workspacePage)
  const publicStatus = await f.request('/account/status')
  expect((await f.request('/connect-info')).status).toBe(401)
  expect(publicStatus.body).toEqual({ configured: true, authenticated: false, setupAllowed: false })
  const privateStatus = await f.request('/account/status', undefined, account.cookie)
  expect(privateStatus.body.user.displayName).toBe(owner.displayName)
  const persisted = readFileSync(join(f.dir, 'state/personal-account.json'), 'utf8')
  expect(persisted).not.toContain(owner.password)
  expect(persisted).not.toContain(account.body.recoveryCode)
  expect(persisted).not.toContain(account.cookie.split('=')[1])
  expect(statSync(join(f.dir, 'state/personal-account.json')).mode & 0o777).toBe(0o600)
  expect(JSON.stringify(privateStatus.body)).not.toMatch(/"password"|"recovery"|"hash"/)
})
it('keeps remembered sessions across restart, preserves bearer clients, and prevents pairing from bypassing login', async () => {
  const f = await hostFixture(),
    account = await f.setup()
  await f.close()
  const next = await hostFixture(f.dir)
  expect((await next.request('/session', undefined, account.cookie)).body.operator).toBe(true)
  expect(
    (await next.request('/configuration', undefined, '', { authorization: next.bearer })).status
  ).toBe(200)
  const pair = await next.request('/pair', { code: new URL(next.host.operatorUrl).hash.slice(6) })
  expect(pair.body).toMatchObject({ operator: false, loginRequired: true })
  expect(pair.setCookie).toBe('')
  expect((await next.request('/session', undefined, account.bootstrap)).body.operator).toBe(false)
  expect((await next.request('/account/logout', {}, account.cookie)).status).toBe(200)
  expect((await next.request('/configuration', undefined, account.cookie)).status).toBe(401)
  await next.close()
  const last = await hostFixture(f.dir)
  expect((await last.request('/session', undefined, account.cookie)).body.operator).toBe(false)
})
it('rejects cross-origin, missing-origin and bearer-only account mutations; validates inputs', async () => {
  const f = await hostFixture(),
    account = await f.setup()
  for (const origin of ['https://elsewhere.example', 'null', ''])
    expect((await f.request('/account/login', owner, '', { origin })).status).toBe(403)
  expect(
    (await f.request('/settings', { revision: 0, patch: {} }, account.cookie, { origin: '' }))
      .status
  ).toBe(403)
  expect(
    (
      await f.request('/account/profile', { displayName: 'Changed' }, '', {
        authorization: f.bearer
      })
    ).status
  ).toBe(401)
  expect(
    (
      await f.request(
        '/account/password',
        { currentPassword: owner.password, password: 'short' },
        account.cookie
      )
    ).status
  ).toBe(400)
  expect(
    (await f.request('/account/profile', { displayName: ' '.repeat(5) }, account.cookie)).status
  ).toBe(400)
  expect(
    (await f.request('/account/profile', { displayName: 'Updated Owner' }, account.cookie)).status
  ).toBe(200)
  expect(
    (await f.request('/account/status', undefined, account.cookie)).body.user.displayName
  ).toBe('Updated Owner')
})
it('changes passwords, revokes old sessions, rotates single-use recovery codes, and signs out everywhere', async () => {
  const f = await hostFixture(),
    account = await f.setup(),
    login = await f.request('/account/login', {
      username: owner.username.toUpperCase(),
      password: owner.password,
      remember: false
    })
  expect(login.status).toBe(200)
  expect(login.setCookie).not.toContain('Max-Age')
  const changed = await f.request(
    '/account/password',
    { currentPassword: owner.password, password: 'a different long passphrase' },
    account.cookie
  )
  expect(changed.status).toBe(200)
  for (const cookie of [account.cookie, login.cookie])
    expect((await f.request('/configuration', undefined, cookie)).status).toBe(401)
  expect(
    (await f.request('/account/login', { username: owner.username, password: owner.password }))
      .status
  ).toBe(401)
  expect((await f.request('/configuration', undefined, changed.cookie)).status).toBe(200)
  const replaced = await f.request(
    '/account/recovery-code',
    { currentPassword: 'a different long passphrase' },
    changed.cookie
  )
  expect(replaced.status).toBe(200)
  expect(
    (
      await f.request('/account/recover', {
        username: owner.username,
        recoveryCode: account.body.recoveryCode,
        password: 'a recovered long passphrase'
      })
    ).status
  ).toBe(401)
  const recovered = await f.request('/account/recover', {
    username: owner.username,
    recoveryCode: replaced.body.recoveryCode.toLowerCase(),
    password: 'a recovered long passphrase'
  })
  expect(recovered.status).toBe(200)
  expect(recovered.body.recoveryCode).not.toBe(replaced.body.recoveryCode)
  expect((await f.request('/configuration', undefined, changed.cookie)).status).toBe(401)
  expect(
    (
      await f.request('/account/recover', {
        username: owner.username,
        recoveryCode: replaced.body.recoveryCode,
        password: 'another long recovery passphrase'
      })
    ).status
  ).toBe(401)
  const other = await f.request('/account/login', {
    username: owner.username,
    password: 'a recovered long passphrase'
  })
  expect((await f.request('/account/logout-all', {}, recovered.cookie)).status).toBe(200)
  expect((await f.request('/configuration', undefined, other.cookie)).status).toBe(401)
})
function mockResponse() {
  let cookie = ''
  return {
    res: {
      setHeader(_key: string, value: string) {
        cookie = value
      }
    } as unknown as ServerResponse,
    cookie: () => cookie.split(';')[0]!
  }
}
const req = (cookie = '') => ({ headers: { cookie } }) as IncomingMessage
it('expires short and remembered sessions using server time', async () => {
  let now = 1000
  const dir = root(),
    account = new PersonalAccount(dir, () => now),
    a = mockResponse(),
    b = mockResponse()
  await account.setup(owner, a.res)
  await account.login({ ...owner, remember: false }, b.res)
  now += 12 * 60 * 60 * 1000
  expect(account.authorized(req(b.cookie()))).toBe(false)
  expect(account.authorized(req(a.cookie()))).toBe(true)
  now += 30 * 24 * 60 * 60 * 1000
  expect(account.authorized(req(a.cookie()))).toBe(false)
})
it('persists attempt throttling and lets the window expire', async () => {
  let now = 1000
  const dir = root(),
    account = new PersonalAccount(dir, () => now)
  await account.setup(owner, mockResponse().res)
  for (let i = 0; i < 8; i++)
    await expect(
      account.recover(
        {
          username: owner.username,
          recoveryCode: 'wrong',
          password: owner.password,
          remember: true
        },
        mockResponse().res
      )
    ).rejects.toMatchObject({ status: 401 })
  const restarted = new PersonalAccount(dir, () => now)
  await expect(restarted.login(owner, mockResponse().res)).rejects.toMatchObject({
    code: 'account_rate_limited',
    status: 429
  })
  now += 15 * 60 * 1000 + 1
  await expect(restarted.login(owner, mockResponse().res)).resolves.toMatchObject({ ok: true })
})
it('fails closed on corrupt or newer account data without overwriting it', () => {
  const dir = root(),
    file = join(dir, 'personal-account.json')
  for (const text of ['broken-json', '{"version":999,"owner":null,"sessions":[],"failures":[]}']) {
    writeFileSync(file, text)
    expect(() => new PersonalAccount(dir)).toThrow(/will not be reset/)
    expect(readFileSync(file, 'utf8')).toBe(text)
  }
})

it('ships syntactically valid account and integrated workspace documents', () => {
  for (const page of [accountPage, configurationPage])
    for (const match of page.matchAll(/<script>([\s\S]*?)<\/script>/g))
      expect(() => new Script(match[1]!)).not.toThrow()
})

it('restoring an older task backup does not roll back account passwords or revoked sessions', async () => {
  const f = await hostFixture(),
    account = await f.setup(),
    config = f.runtime.config,
    backup = join(f.dir, 'task-backup')
  await backupState(config, backup)
  const changed = await f.request(
    '/account/password',
    { currentPassword: owner.password, password: 'password after the task backup' },
    account.cookie
  )
  expect(changed.status).toBe(200)
  const file = join(config.stateDir, 'personal-account.json'),
    before = readFileSync(file, 'utf8')
  await f.close()
  await restoreState(config, backup)
  expect(readFileSync(file, 'utf8')).toBe(before)
  const next = await hostFixture(f.dir)
  expect((await next.request('/configuration', undefined, account.cookie)).status).toBe(401)
  expect((await next.request('/configuration', undefined, changed.cookie)).status).toBe(200)
  expect(
    (await next.request('/account/login', { username: owner.username, password: owner.password }))
      .status
  ).toBe(401)
  expect(
    (
      await next.request('/account/login', {
        username: owner.username,
        password: 'password after the task backup'
      })
    ).status
  ).toBe(200)
})
