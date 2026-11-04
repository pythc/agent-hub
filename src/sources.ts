import { z } from 'zod'
import { createHash } from 'node:crypto'
import type { Trigger, OutboundMessage } from './vendor/dsh-core/index.ts'
import type { Store } from './store.ts'
import type { SourceConfig } from './config.ts'

export const incomingSchema = z.object({
  id: z.string().min(1).max(200), thread: z.string().min(1).max(300),
  text: z.string().min(1).max(100_000), addressed: z.boolean().default(true),
}).strict()
export type Incoming = z.infer<typeof incomingSchema>
export interface SourceContext {
  store: Store
  signal?:AbortSignal
  receive(trigger: Trigger): unknown
  bind(ticketId: string, thread: string, own: boolean): void
  closed(thread: string, outcome: 'merged'|'closed', at: string): void
}
export interface Source {
  config: SourceConfig
  trigger(input: Incoming, actor: string, human?: boolean): Trigger
  deliver(message: OutboundMessage): Promise<void>
  idempotencyKey?(trigger:Trigger):string
  poll?(context: SourceContext): Promise<void>
  validThread?(thread:string):boolean
  members?(scope?:string):Promise<{id:string;name?:string;bot?:boolean}[]>
  identity?():Promise<{id:string;type:string}>
  start?(context:SourceContext):void
  close?():Promise<void>
  context?(thread: string): Promise<unknown>
  read?(request:{resource:string;trigger?:Trigger;pageSize:number}):Promise<any>
}
export class UncertainDelivery extends Error {}
/** Additional sources implement this interface, without modifying the domain. */
export class MessageSource implements Source {
  constructor(readonly config: SourceConfig) {}
  trigger(input: Incoming, actor: string, human = true): Trigger {
    return {
      id: this.config.id + ':' + input.id, source: this.config.id,
      threads: [{ source: this.config.id, id: input.thread }],
      actor: { source: this.config.id, id: actor }, human,
      ...(input.addressed ? { addressed: 'direct' as const } : {}),
      at: new Date().toISOString(), text: input.text, meta: {},
      channel: { source: this.config.id, thread: input.thread, address: { thread: input.thread } },
    }
  }
  async deliver(message: OutboundMessage): Promise<void> {
    // Local deliveries are durably readable through status, CLI and MCP.
    if (this.config.kind === 'local') return
    if (!this.config.replyUrl) throw new Error('External delivery is disabled until replyUrl is configured')
    const token = this.config.tokenEnv ? process.env[this.config.tokenEnv] : undefined
    try {
      const response = await fetch(this.config.replyUrl, {
        method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': message.id, ...(token ? { authorization: 'Bearer ' + token } : {}) },
        body: JSON.stringify(message), signal: AbortSignal.timeout(15_000), redirect: 'error',
      })
      if (!response.ok) throw new UncertainDelivery('Delivery returned HTTP ' + response.status + '; check destination before replay')
    } catch (error) {
      if (error instanceof UncertainDelivery) throw error
      throw new UncertainDelivery('Delivery outcome unknown; check destination before replay')
    }
  }
}
export function bodyDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}
