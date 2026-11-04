import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { configSchema } from '../src/config.ts'
import { Runtime } from '../src/runtime.ts'
const root = resolve(process.argv[2]!)
const first = JSON.parse(readFileSync(join(root, 'evidence.json'), 'utf8'))
const oldId = first.tickets[0].run.threadId
const config = configSchema.parse({
  stateDir: join(root, 'state'), model: 'gpt-6.1-terra', effort: 'high', turnTimeoutMs: 180_000,
  sources: [{ id: 'local', kind: 'local', allowedActors: ['operator'], cwd: root, sandbox: 'read-only' }],
})
const runtime = new Runtime(config)
runtime.start()
try {
  runtime.receive('local', 'operator', { id: 'followup', thread: 'document-comparison', addressed: true,
    text: '请接着上面的比较，确认新版是否规定了宏平均召回率的具体达标数值。引用原文依据，简短回答。' })
  const deadline = Date.now() + 210_000
  while (Date.now() < deadline) {
    const ticket = runtime.store.tickets.list()[0]!
    if (ticket.attention) throw new Error(JSON.stringify(ticket.attention))
    const sent = runtime.store.deliveries().filter(d => d.kind === 'reply' && d.status === 'sent')
    if (sent.length >= 2) {
      const status = runtime.status()
      if (status.tickets.length !== 1 || status.tickets[0]!.run?.threadId !== oldId) throw new Error('Native identity did not survive restart')
      writeFileSync(join(root, 'resume-evidence.json'), JSON.stringify(status,null,2))
      console.log(JSON.stringify({ threadId: oldId, workCount: status.tickets.length, answers: sent.map(d=>d.text) },null,2))
      break
    }
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  if (runtime.store.deliveries().filter(d=>d.status==='sent').length<2) throw new Error('Resume validation timed out')
} finally { await runtime.close() }
