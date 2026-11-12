import { z } from 'zod'
import { createHash } from 'node:crypto'
import type { Trigger, OutboundMessage,Ticket } from './vendor/dsh-core/index.ts'
import type { Store } from './store.ts'
import type { SourceConfig } from './config.ts'

export const incomingSchema = z.object({
  id: z.string().min(1).max(200), thread: z.string().min(1).max(300),
  text: z.string().min(1).max(100_000), addressed: z.boolean().default(true),
  scope:z.string().min(1).max(300).optional(),at:z.string().datetime({offset:true}).optional(),
  message:z.object({id:z.string().min(1).max(300),url:z.string().url().optional()}).strict().optional(),
  attachments:z.array(z.object({id:z.string().min(1),name:z.string().optional(),mimeType:z.string().optional(),url:z.string().url().optional()}).strict()).max(100).optional(),
}).strict()
export type Incoming = z.infer<typeof incomingSchema>
/** Connector-verified lifecycle facts; never inferred from chat text. */
export const sourceChangeSchema=z.object({
 id:z.string().min(1).max(500),kind:z.enum(['message.updated','message.deleted','entry.unavailable','entry.available','entry.permissions_changed','member.removed','member.added']),
 scope:z.string().min(1).max(300),at:z.number().int().nonnegative(),messageId:z.string().min(1).max(300).optional(),
 contentHash:z.string().regex(/^[a-f0-9]{64}$/).optional(),actorIds:z.array(z.string().min(1).max(300)).max(1000).optional(),
}).strict().superRefine((v,c)=>{if(v.kind.startsWith('message.')&&!v.messageId)c.addIssue({code:'custom',message:'Message identity required'});if(v.kind==='message.updated'&&!v.contentHash)c.addIssue({code:'custom',message:'Verified content hash required'});if(v.kind.startsWith('member.')&&!v.actorIds?.length)c.addIssue({code:'custom',message:'Member identity required'})})
export type SourceChange=z.infer<typeof sourceChangeSchema>
export interface RecordQuery {sourceId?:string;ids?:string[];cursor?:string;limit?:number;scope?:string;messageIds?:string[];subscribed?:boolean}
export interface RecordPage<T=any> {items:{id:string;value:T}[];next?:string}
export interface SourceContext {
  beforeExternalWrite?():Promise<void>
  repositoryUpdate?(update:import('./repository-source.ts').RepositoryUpdate):unknown
  /** Source-scoped bounded history; list/get on the v2 store contains only local/control state. */
  records?(kind:string,query?:RecordQuery):Promise<RecordPage>
  store: Store
  /** Resolve only after pending plugin events have been committed by the host. */
  checkpoint?():Promise<void>
  signal?:AbortSignal
  receive(trigger: Trigger): unknown
  change?(event:SourceChange):unknown
  bind(ticketId: string, thread: string, own: boolean): void
  closed(thread: string, outcome: 'merged'|'closed', at: string): void
}
export interface Source {
  workflowState?(target:import('./workflow-actions.ts').StatusTarget):Promise<import('./workflow-actions.ts').TransitionView>
  applyWorkflowState?(target:import('./workflow-actions.ts').StatusTarget,expected:import('./workflow-actions.ts').TransitionView,stateId:string,mayAct?:()=>boolean):Promise<'updated'|'changed'>
  readonly code?:import('./repository-source.ts').RepositoryAccess
  config: SourceConfig
  trigger(input: Incoming, actor: string, human?: boolean): Trigger
  deliver(message: OutboundMessage): Promise<void>
  idempotencyKey?(trigger:Trigger):string
  poll?(context: SourceContext): Promise<void>
  validThread?(thread:string):boolean
  members?(scope?:string):Promise<{id:string;name?:string;bot?:boolean}[]>
  identity?():Promise<{id:string;type:string;verified?:boolean}>
  isPullRequest?(trigger:Trigger):Promise<boolean>
  initialBindings?(trigger:Trigger):Promise<{thread:string;own:boolean}[]>
  readonly verificationCommand?:string
  replay?(scope:string|undefined,since:string):{key:string;since:string}
  check?():Promise<void>
  references?(thread:string):string[]
  authorizeRead?(ticket:Ticket,resource:string):void
  start?(context:SourceContext):void|Promise<void>
  close?():Promise<void>
  context?(thread: string): Promise<unknown>
  read?(request:{resource:string;trigger?:Trigger;pageSize:number}):Promise<any>
}
export class UncertainDelivery extends Error {}
/** Additional sources implement this interface, without modifying the domain. */
export class MessageSource implements Source {
  constructor(readonly config: SourceConfig) {}
  get verificationCommand(){return ''}
  /** Retain the old adapter hook while exposing a platform-neutral task lifecycle. */
  async initialBindings(trigger:Trigger){const legacy=(this as Source).isPullRequest;return legacy&&trigger.threads[0]&&await legacy.call(this,trigger)?[{thread:trigger.threads[0].id,own:false}]:[]}
  trigger(input: Incoming, actor: string, human = true): Trigger {
    return {
      id: this.config.id + ':' + input.id, source: this.config.id,
      threads: [{ source: this.config.id, id: input.thread }],
      actor: { source: this.config.id, id: actor }, human,
      ...(input.addressed ? { addressed: 'direct' as const } : {}),
      at: input.at??new Date().toISOString(), text: input.text, meta: {...(input.scope?{scope:input.scope}:{}),...(input.message?{message:input.message}:{}),...(input.attachments?{attachments:input.attachments}:{})},
      channel: { source: this.config.id, thread: input.thread, address: { thread: input.thread,...(input.message?{messageId:input.message.id}:{}),...(input.message?.url?{url:input.message.url}:{}) } },
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
export function stableDigest(value:unknown):string{
  const canonical=(v:any):any=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v
  return bodyDigest(canonical(value))
}
