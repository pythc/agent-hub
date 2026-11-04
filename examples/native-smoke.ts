import { mkdtempSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { configSchema } from '../src/config.ts'
import { Runtime } from '../src/runtime.ts'

const root = mkdtempSync(resolve('examples/native-run-'))
writeFileSync(join(root, 'v1.txt'), 'Acceptance: report model accuracy.\n')
writeFileSync(join(root, 'v2.txt'), 'Acceptance: report model accuracy and macro recall.\n')
const config = configSchema.parse({
  stateDir: join(root, 'state'), model: 'gpt-6.1-terra', effort: 'high', turnTimeoutMs: 180_000,
  sources: [{ id: 'local', kind: 'local', allowedActors: ['operator'], cwd: root, sandbox: 'read-only' }],
})
const runtime = new Runtime(config)
runtime.start()
try {
  runtime.receive('local', 'operator', {
    id: 'first', thread: 'document-comparison',
    text: 'Read v1.txt and v2.txt in the current directory. In Chinese explain exactly how the acceptance condition changed. This is an analysis task. Return the answer when done.',
    addressed: true,
  })
  const deadline = Date.now() + 210_000
  while (Date.now() < deadline) {
    const deliveries = runtime.store.deliveries().filter(d => d.kind === 'reply' && d.status === 'sent')
    const blocked = runtime.store.tickets.list().find(t => t.attention)
    if (blocked) throw new Error(JSON.stringify(blocked.attention))
    if (deliveries.length) {
      const ticket = runtime.store.tickets.list()[0]!
      const evidence = { stateDir: config.stateDir, ticketId: ticket.id, ...runtime.status() }
      writeFileSync(join(root, 'evidence.json'), JSON.stringify(evidence, null, 2))
      console.log(JSON.stringify({ root, ticketId: ticket.id, run: runtime.store.get('run', ticket.id), answer: deliveries[0]!.text }, null, 2))
      break
    }
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  if (!runtime.store.deliveries().some(d => d.status === 'sent')) throw new Error('Native validation timed out')
} finally { await runtime.close() }
