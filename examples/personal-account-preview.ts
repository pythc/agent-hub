/** Isolated account acceptance host. No model, provider, or user configuration is used. */
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { Runtime } from '../src/runtime.ts'
import { configSchema } from '../src/config.ts'
import { serve } from '../src/server.ts'
const root = resolve(process.argv[2] || '.local/personal-account-preview')
mkdirSync(join(root, 'files'), { recursive: true })
const config = configSchema.parse({
  stateDir: join(root, 'state'),
  port: Number(process.argv[3] || 0),
  codex: '/not-installed/account-preview',
  work: { sandboxDriver: 'disabled', network: false },
  sources: [{ id: 'local', kind: 'local', cwd: join(root, 'files'), allowedActors: ['operator'] }],
  execution: {
    management: { enabled: true, maxWorkers: 10 },
    workers: [
      { id: 'worker-1', label: 'Research', backend: 'codex' },
      { id: 'worker-2', label: 'Build', backend: 'codex' },
      { id: 'worker-3', label: 'Review', backend: 'codex' }
    ]
  }
})
const runtime = new Runtime(config, {
  model: {
    async run() {
      throw Error('The account acceptance host never calls a model')
    }
  }
})
runtime.pause(true)
const host = await serve(runtime, { clientHome: join(root, 'client-home') })
writeFileSync(
  join(root, 'browser.json'),
  JSON.stringify({ url: host.operatorUrl, base: host.url }),
  { mode: 0o600 }
)
console.log(
  JSON.stringify({
    base: host.url,
    info: join(root, 'browser.json'),
    mode: 'isolated, paused; no model calls'
  })
)
async function close() {
  await new Promise<void>((r) => host.server.close(() => r()))
  await host.closeRuntime()
}
process.once('SIGTERM', () => void close())
process.once('SIGINT', () => void close())
