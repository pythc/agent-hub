import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { z } from 'zod'
import { configSchema, type Config } from '../src/config.ts'
import { patchSchema, Settings } from '../src/settings.ts'
import { incomingSchema } from '../src/sources.ts'
import { profileInput } from '../src/browser-contract.ts'
import { entryPlanSchema } from '../src/entry-setup.ts'
import { Store } from '../src/store.ts'
import { backupState, restoreState } from '../src/backup.ts'
import { Approvals } from '../src/approvals.ts'

// Captured with Zod 3.25.76 at 02202ad, using synthetic paths and credentials.
// No old validator is installed or invoked by the upgraded runtime or tests.
const baseline: { zod: string; cases: { name: string; input: any; expected: Config }[] } =
  JSON.parse(readFileSync(new URL('./fixtures/zod3-config.json', import.meta.url), 'utf8'))
// Preserve the historical fixture byte-for-byte; account explicitly for the new feature defaults.
const watchdogUpgrade = (config: Config): Config => ({...config,watchdog:Object.assign({enabled:true,reviewIntervalMs:600000,modelTimeoutMs:60000,maxReviewsPerHour:12,maxRecoveries:3},config.watchdog)})
const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

it.each(baseline.cases)('preserves the $name Zod 3 configuration and serialized round trip', ({ input, expected }) => {
  expect(configSchema.parse(input)).toEqual(watchdogUpgrade(expected))
  expect(configSchema.parse(JSON.parse(JSON.stringify(expected)))).toEqual(watchdogUpgrade(expected))
})

it('continues accepting fractional milliseconds in pre-existing watchdog fields', () => {
  const watchdog = {staleMs:1000.5, intervalMs:1000.25}
  expect(configSchema.parse({...baseline.cases[0]!.input,watchdog}).watchdog).toMatchObject(watchdog)
})

it('keeps omitted patches absent and supplied empty objects/defaults intentional', () => {
  expect(patchSchema.parse({})).toEqual({})
  expect(patchSchema.parse({ effort: 'low' })).toEqual({ effort: 'low' })
  expect(patchSchema.parse({ work: {} })).toEqual({ work: baseline.cases[0]!.expected.work })
  expect(patchSchema.parse({ backends: {}, model: undefined })).toEqual({ backends: {}, model: undefined })
  expect(() => patchSchema.parse({ typo: true })).toThrow()
  expect(() => patchSchema.parse({ work: { typo: true } })).toThrow()
  expect(() => patchSchema.parse({ work: null })).toThrow()
})

it('preserves persisted settings, sparse saves, backup/restore and transaction failure across the upgrade', async () => {
  const root = mkdtempSync(join(tmpdir(), 'roppo-zod-upgrade-')); roots.push(root)
  const original = structuredClone(baseline.cases[1]!.expected)
  // Existing Settings startup also normalizes concurrency to the profile count.
  original.concurrency = original.execution.workers!.length
  original.stateDir = join(root, 'state')
  const path = join(original.stateDir, 'state.sqlite')
  let store = new Store(path)
  let closed = false
  const closeStore = () => { if (!closed) { store.close(); closed = true } }
  try {
    // Model the pre-upgrade persisted record; startup reparses and writes it.
    store.put('settings', 'current', { revision: 7, at: '2026-11-07T00:00:00.000Z', config: original })
    store.put('settings-backends', 'managed', true)
    const settings = new Settings(store, configSchema.parse(structuredClone(original)))
    expect(settings.current().config).toEqual(watchdogUpgrade(original))
    expect(settings.save(7, { effort: 'low' }).config).toEqual({ ...watchdogUpgrade(original), effort: 'low' })
    const after = structuredClone(settings.current())
    expect(() => settings.save(7, { concurrency: 2 })).toThrow('conflict')
    expect(() => settings.save(8, { work: { unknown: true } })).toThrow()
    const exec = store.db.exec.bind(store.db)
    store.db.exec = sql => { if (sql === 'COMMIT') throw Error('Injected commit failure'); return exec(sql) }
    try { expect(() => settings.save(8, { effort: 'high' })).toThrow('commit failure') } finally { store.db.exec = exec }
    expect(settings.current()).toEqual(after)
    expect(settings.config).toEqual(after.config)
    closeStore()
    await backupState(original, join(root, 'backup'))
    store = new Store(path)
    closed = false
    const restarted = new Settings(store, configSchema.parse(structuredClone(original)))
    expect(restarted.current()).toEqual(after)
    restarted.save(8, { effort: 'high' })
    closeStore()
    await restoreState(original, join(root, 'backup'))
    store = new Store(path)
    closed = false
    const restored = new Settings(store, configSchema.parse(structuredClone(original)))
    expect(restored.current()).toEqual(after)
    expect(store.db.prepare('PRAGMA user_version').get()!.user_version).toBe(6)
  } finally { closeStore() }
})

const minimal = baseline.cases[0]!.input
const boundaries: { name: string; limit: number; schema: z.ZodType; wrap: (values: unknown[]) => unknown; path: string[]; valid: (index: number) => unknown }[] = [
  { name: 'Worker profiles', limit: 10, schema: configSchema, wrap: workers => ({ ...minimal, execution: { workers } }), path: ['execution', 'workers'], valid: i => ({ id: 'worker-' + i, backend: 'codex' }) },
  { name: 'event attachments', limit: 100, schema: incomingSchema, wrap: attachments => ({ id: 'event', thread: 'discussion', text: 'Read', attachments }), path: ['attachments'], valid: i => ({ id: 'attachment-' + i }) },
  { name: 'browser grants', limit: 10, schema: profileInput, wrap: allowedWorkers => ({ name: 'Personal', allowedWorkers }), path: ['allowedWorkers'], valid: i => 'worker-' + i },
  { name: 'entry actors', limit: 50, schema: entryPlanSchema, wrap: actors => ({ revision: 0, entryId: 'feishu', actors }), path: ['actors'], valid: i => 'actor-' + i },
]

it.each(boundaries)('rejects oversized $name before reading elements, retaining valid boundary inputs', ({ limit, schema, wrap, path, valid }) => {
  for (const length of [limit + 1, 1000]) {
    const values = Array.from({ length }, () => null)
    let reads = 0
    Object.defineProperty(values, 0, { enumerable: true, get() { reads++; return null } })
    const result = schema.safeParse(wrap(values))
    expect(result.success).toBe(false)
    if (result.success) throw Error('Oversized input accepted')
    expect(reads).toBe(0)
    expect(result.error.issues).toEqual([expect.objectContaining({ code: 'too_big', path })])
  }
  expect(schema.safeParse(wrap(Array.from({ length: limit }, (_, i) => valid(i)))).success).toBe(true)
  expect(schema.safeParse(wrap([null])).success).toBe(false)
})

it('rejects oversized approval answers without resolving or invalidating the pending request', async () => {
  const root = mkdtempSync(join(tmpdir(), 'roppo-zod-approval-')); roots.push(root)
  const store = new Store(join(root, 'state.sqlite')), approvals = new Approvals(store)
  try {
    const pending = approvals.request('ticket', { id: 'ask', method: 'item/tool/requestUserInput', params: { questions: [{ id: 'choice' }] } })
    void pending.catch(() => {})
    const id = store.list<any>('approval')[0].id
    let failure: unknown
    try { approvals.answer(id, { choice: { answers: Array(1000).fill(null) } }) } catch (error) { failure = error }
    expect(failure).toBeInstanceOf(z.ZodError)
    expect((failure as z.ZodError).issues).toEqual([expect.objectContaining({ code: 'too_big', path: ['choice', 'answers'] })])
    expect(store.get<any>('approval', id).status).toBe('pending')
    approvals.answer(id, { choice: { answers: ['Proceed'] } })
    await expect(pending).resolves.toEqual({ answers: { choice: { answers: ['Proceed'] } } })
  } finally { approvals.close(); store.close() }
})

it('rejects non-finite and unsafe numbers while preserving valid numeric configuration', () => {
  expect(() => configSchema.parse({ ...minimal, turnTimeoutMs: Number.MAX_SAFE_INTEGER + 1 })).toThrow()
  expect(() => configSchema.parse({ ...minimal, sources: [{ ...minimal.sources[0], pollSeconds: Infinity }] })).toThrow()
  expect(configSchema.parse({ ...minimal, turnTimeoutMs: 600000 }).turnTimeoutMs).toBe(600000)
})
