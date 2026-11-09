import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto'
import { chmodSync, existsSync, lstatSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { atomicPrivateFile } from './managed-config.ts'

const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const secretSchema = z
  .object({ salt: z.string().regex(/^[a-f0-9]{32}$/), hash: z.string().regex(/^[a-f0-9]{128}$/) })
  .strict()
const ownerSchema = z
  .object({
    id: z.string().uuid(),
    username: z.string(),
    displayName: z.string(),
    password: secretSchema,
    recovery: z.string().regex(/^[a-f0-9]{64}$/),
    createdAt: z.number(),
    updatedAt: z.number()
  })
  .strict()
const sessionSchema = z
  .object({
    hash: z.string().regex(/^[a-f0-9]{64}$/),
    createdAt: z.number(),
    expiresAt: z.number(),
    remember: z.boolean()
  })
  .strict()
const dataSchema = z
  .object({
    version: z.literal(1),
    owner: ownerSchema.nullable(),
    sessions: z.array(sessionSchema).max(20),
    failures: z.array(z.number()).max(20)
  })
  .strict()
type AccountData = z.infer<typeof dataSchema>
export const usernameSchema = z
  .string()
  .trim()
  .min(3)
  .max(40)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/)
export const passwordSchema = z.string().min(12).max(128)
const loginPassword = z.string().min(1).max(128)
export const setupAccountSchema = z
  .object({
    username: usernameSchema,
    displayName: z.string().trim().min(1).max(60),
    password: passwordSchema,
    remember: z.boolean().default(true)
  })
  .strict()
export const loginAccountSchema = z
  .object({
    username: z.string().trim().min(1).max(40),
    password: loginPassword,
    remember: z.boolean().default(true)
  })
  .strict()
export const recoverAccountSchema = z
  .object({
    username: z.string().trim().min(1).max(40),
    recoveryCode: z.string().min(1).max(100),
    password: passwordSchema,
    remember: z.boolean().default(true)
  })
  .strict()
export class AccountError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400
  ) {
    super(message)
  }
}

/** One local owner. Stored separately from task records and configuration backups. */
export class PersonalAccount {
  readonly file: string
  private readonly cookieName: string
  private data: AccountData = { version: 1, owner: null, sessions: [], failures: [] }
  private pending = 0
  constructor(
    stateDir: string,
    private readonly now: () => number = Date.now,
    cookieScope?:string
  ) {
    this.file = join(stateDir, 'personal-account.json')
    this.cookieName = 'roppo_owner_' + digest(resolve(stateDir)+(cookieScope?'|'+cookieScope:'')).slice(0, 12)
    if (existsSync(this.file)) {
      if (lstatSync(this.file).isSymbolicLink())
        throw Error('Personal account file must not be a symbolic link')
      try {
        this.data = dataSchema.parse(JSON.parse(readFileSync(this.file, 'utf8')))
      } catch {
        throw Error(
          'Personal account data is invalid or newer than this version. Restore the account file; it will not be reset automatically.'
        )
      }
      chmodSync(this.file, 0o600)
    }
  }
  get configured() {
    return this.data.owner !== null
  }
  private save(next: AccountData) {
    atomicPrivateFile(this.file, JSON.stringify(dataSchema.parse(next), null, 2) + '\n')
    this.data = next
  }
  private token(request: IncomingMessage) {
    const prefix = this.cookieName + '='
    return String(request.headers.cookie ?? '')
      .split(';')
      .map((v) => v.trim())
      .find((v) => v.startsWith(prefix))
      ?.slice(prefix.length)
  }
  private session(request: IncomingMessage) {
    const token = this.token(request)
    return (
      token && this.data.sessions.find((s) => s.hash === digest(token) && s.expiresAt > this.now())
    )
  }
  authorized(request: IncomingMessage) {
    return this.configured && !!this.session(request)
  }
  status(request: IncomingMessage, setupAllowed = false) {
    const session = this.session(request),
      owner = this.data.owner
    return {
      configured: !!owner,
      authenticated: !!owner && !!session,
      setupAllowed: !owner && setupAllowed,
      ...(owner && session
        ? {
            user: {
              id: owner.id,
              username: owner.username,
              displayName: owner.displayName,
              createdAt: owner.createdAt
            },
            session: { expiresAt: session.expiresAt, remember: session.remember }
          }
        : {})
    }
  }
  private cookie(response: ServerResponse, token: string, remember: boolean) {
    response.setHeader(
      'set-cookie',
      this.cookieName +
        '=' +
        token +
        '; HttpOnly; SameSite=Strict; Path=/' +
        (remember ? '; Max-Age=2592000' : '')
    )
  }
  private issue(next: AccountData, response: ServerResponse, remember: boolean) {
    const token = randomBytes(32).toString('base64url'),
      now = this.now()
    next.sessions = next.sessions.filter((s) => s.expiresAt > now).slice(-19)
    next.sessions.push({
      hash: digest(token),
      createdAt: now,
      expiresAt: now + (remember ? 30 * 24 : 12) * 60 * 60 * 1000,
      remember
    })
    next.failures = []
    this.save(next)
    this.cookie(response, token, remember)
  }
  private guard() {
    const failures = this.data.failures.filter((at) => at > this.now() - 15 * 60 * 1000)
    if (failures.length >= 8)
      throw new AccountError(
        'account_rate_limited',
        'Too many attempts. Try again in 15 minutes.',
        429
      )
    if (this.pending >= 2)
      throw new AccountError(
        'account_busy',
        'Another sign-in is being checked. Try again shortly.',
        429
      )
  }
  private failed(code = 'account_credentials_invalid') {
    this.save({
      ...this.data,
      failures: [
        ...this.data.failures.filter((at) => at > this.now() - 15 * 60 * 1000),
        this.now()
      ].slice(-20)
    })
    throw new AccountError(code, 'The account credentials are incorrect.', 401)
  }
  private async hash(password: string, salt = randomBytes(16).toString('hex')) {
    // Fixed cost parameters; account files cannot request unbounded scrypt memory.
    if (this.pending >= 2)
      throw new AccountError(
        'account_busy',
        'Another sign-in is being checked. Try again shortly.',
        429
      )
    this.pending++
    try {
      const key = await new Promise<Buffer>((resolve, reject) =>
        scrypt(
          password,
          salt,
          64,
          { N: 65536, r: 8, p: 1, maxmem: 96 * 1024 * 1024 },
          (error, key) => (error ? reject(error) : resolve(key))
        )
      )
      return { salt, hash: key.toString('hex') }
    } finally {
      this.pending--
    }
  }
  private async matches(password: string, owner: NonNullable<AccountData['owner']>) {
    const derived = await this.hash(password, owner.password.salt)
    return timingSafeEqual(
      Buffer.from(derived.hash, 'hex'),
      Buffer.from(owner.password.hash, 'hex')
    )
  }
  private recovery() {
    const code = randomBytes(20).toString('hex').toUpperCase().match(/.{8}/g)!.join('-')
    return { code, hash: digest(code.replaceAll('-', '')) }
  }
  async setup(input: z.infer<typeof setupAccountSchema>, response: ServerResponse) {
    if (this.configured)
      throw new AccountError('account_exists', 'This installation already has an owner.', 409)
    this.guard()
    const password = await this.hash(input.password)
    // Check again after async hashing: two simultaneous claims cannot overwrite the owner.
    if (this.configured)
      throw new AccountError('account_exists', 'This installation already has an owner.', 409)
    const recovery = this.recovery(),
      now = this.now()
    const owner = {
      id: randomUUID(),
      username: input.username.toLowerCase(),
      displayName: input.displayName,
      password,
      recovery: recovery.hash,
      createdAt: now,
      updatedAt: now
    }
    this.issue({ version: 1, owner, sessions: [], failures: [] }, response, input.remember)
    return { ok: true, recoveryCode: recovery.code }
  }
  async login(input: z.infer<typeof loginAccountSchema>, response: ServerResponse) {
    if (!this.data.owner)
      throw new AccountError('account_setup_required', 'Set up the local owner first.', 409)
    this.guard()
    const owner = this.data.owner,
      valid = await this.matches(input.password, owner)
    if (this.data.owner !== owner)
      throw new AccountError('account_changed', 'The account changed. Sign in again.', 409)
    if (!valid || input.username.toLowerCase() !== owner.username) this.failed()
    this.issue({ ...this.data }, response, input.remember)
    return { ok: true }
  }
  logout(request: IncomingMessage, response: ServerResponse, all = false) {
    const token = this.token(request)
    if (this.configured && (all || token))
      this.save({
        ...this.data,
        sessions: all ? [] : this.data.sessions.filter((s) => s.hash !== digest(token!))
      })
    response.setHeader(
      'set-cookie',
      this.cookieName + '=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'
    )
    return { ok: true }
  }
  async changePassword(
    request: IncomingMessage,
    response: ServerResponse,
    current: string,
    password: string
  ) {
    this.guard()
    const owner = this.data.owner,
      session = this.session(request)
    if (!owner || !session)
      throw new AccountError('account_login_required', 'Sign in to your account.', 401)
    if (!(await this.matches(current, owner))) this.failed()
    const nextPassword = await this.hash(password)
    if (this.data.owner !== owner || !this.authorized(request))
      throw new AccountError('account_changed', 'The account changed. Sign in again.', 409)
    this.issue(
      {
        ...this.data,
        owner: { ...owner, password: nextPassword, updatedAt: this.now() },
        sessions: []
      },
      response,
      session.remember
    )
    return { ok: true }
  }
  async recover(input: z.infer<typeof recoverAccountSchema>, response: ServerResponse) {
    this.guard()
    const owner = this.data.owner
    if (!owner)
      throw new AccountError('account_setup_required', 'Set up the local owner first.', 409)
    const actual = digest(input.recoveryCode.replace(/[-\s]/g, '').toUpperCase())
    if (
      input.username.toLowerCase() !== owner.username ||
      !timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(owner.recovery, 'hex'))
    )
      this.failed('account_recovery_invalid')
    const password = await this.hash(input.password)
    if (this.data.owner !== owner)
      throw new AccountError('account_changed', 'The account changed. Sign in again.', 409)
    const recovery = this.recovery()
    this.issue(
      {
        ...this.data,
        owner: { ...owner, password, recovery: recovery.hash, updatedAt: this.now() },
        sessions: []
      },
      response,
      input.remember
    )
    return { ok: true, recoveryCode: recovery.code }
  }
  async replaceRecovery(request: IncomingMessage, current: string) {
    this.guard()
    const owner = this.data.owner
    if (!owner || !this.authorized(request))
      throw new AccountError('account_login_required', 'Sign in to your account.', 401)
    if (!(await this.matches(current, owner))) this.failed()
    if (this.data.owner !== owner || !this.authorized(request))
      throw new AccountError('account_changed', 'The account changed. Sign in again.', 409)
    const recovery = this.recovery()
    this.save({
      ...this.data,
      owner: { ...owner, recovery: recovery.hash, updatedAt: this.now() },
      failures: []
    })
    return { ok: true, recoveryCode: recovery.code }
  }
  updateProfile(request: IncomingMessage, displayName: string) {
    if (!this.authorized(request))
      throw new AccountError('account_login_required', 'Sign in to your account.', 401)
    this.save({ ...this.data, owner: { ...this.data.owner!, displayName, updatedAt: this.now() } })
    return { ok: true }
  }
}
