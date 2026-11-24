import {randomUUID} from 'node:crypto'
import {z} from 'zod'
import {originalDestination, type DestinationBinding} from './destination-binding.ts'
import type {Runtime} from './runtime.ts'
import {stableDigest} from './sources.ts'
import type {OutboundMessage, Trigger} from './vendor/dsh-core/index.ts'

const ttl = 5 * 60_000
const recent = 24 * 60 * 60_000
const maxPreviews = 20
const kind = 'curated-summary-receipt'
const prefix = 'curated-summary:'
export const isCuratedSummary = (id:string) => id.startsWith(prefix)
const destinationKinds = new Set(['feishu','slack','wecom'])
const inputSchema = z.object({
  originTriggerId: z.string().min(1).max(1000),
  destinationTriggerId: z.string().min(1).max(1000),
  summary: z.string().trim().min(1).max(1200),
}).strict()
const confirmationSchema = z.object({id:z.string().uuid(),confirmed:z.literal(true)}).strict()
const statusSchema = z.object({id:z.string().uuid()}).strict()
const ambiguousDisplay = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u

export class CuratedSummaryError extends Error {
  constructor(readonly code: string, readonly status = 409) { super(code) }
}

interface Anchor {
  trigger: Trigger
  binding: DestinationBinding
  view: {
    triggerId: string; provider: string; account: string; sourceId: string; entryId: string;
    room: string; thread: string; scopeId: string; private: boolean; at: string; canReceive: boolean
  }
}
interface Approval {
  version: 1
  destination: DestinationBinding
  origin: DestinationBinding
  authority: string
  summaryDigest: string
  expiresAt: number
}
interface Preview extends Approval { operator: string; summary: string }
interface Receipt extends Approval { operator: string }

function anchor(host: Runtime, triggerId: string, now: number): Anchor | undefined {
  const trigger = host.store.triggers.get(triggerId)
  const channel = trigger?.channel
  const source = host.config.sources.find(s => s.id === trigger?.source)
  if (!trigger?.human || !channel || !source || !host.sources.get(source.id)?.config.enabled ||
      (!destinationKinds.has(source.kind) && source.kind !== 'local') ||
      host.routerIngress.get(triggerId)?.state !== 'accepted' ||
      host.memory.cleanup.blocked('trigger', triggerId)) return
  const at = Date.parse(trigger.at)
  if (!Number.isFinite(at) || at > now + 60_000 || now - at >= recent) return
  const entry = host.scopes.entry(trigger)
  if (!entry || entry.provider !== source.kind ||
      (source.kind !== 'local' && host.store.get<{namespace:string}>('source-identity',source.id)?.namespace !== entry.accountNamespace)) return
  if ([entry.nativeId,entry.accountNamespace,source.id,channel.thread].some(v => !v || v.length > 500 || ambiguousDisplay.test(v))) return
  try { host.routerIngress.authority(triggerId) } catch { return }
  const binding = originalDestination(host.store,host.scopes,source,{id:'',kind:'reply',text:'',channel},triggerId)
  if (!binding?.entry) return
  return {trigger,binding,view:{
    triggerId, provider: source.kind, account: entry.accountNamespace, sourceId: source.id, entryId: entry.id,
    room: entry.nativeId, thread: channel.thread, scopeId: entry.scopeId, private: !!entry.privateActor,
    at: new Date(at).toISOString(), canReceive: destinationKinds.has(source.kind),
  }}
}

function pair(host: Runtime, originId: string, destinationId: string, now: number) {
  const origin = anchor(host,originId,now), destination = anchor(host,destinationId,now)
  // A host operator may explicitly share within one current management team.
  // There is no cross-tenant export, silent default, or alternate destination.
  if (!origin || !destination || !destination.view.canReceive ||
      origin.binding.entry!.tenantId !== destination.binding.entry!.tenantId ||
      origin.view.scopeId !== destination.view.scopeId ||
      origin.view.entryId === destination.view.entryId ||
      (origin.view.provider === destination.view.provider && origin.view.account === destination.view.account &&
        origin.view.room === destination.view.room)) throw new CuratedSummaryError('summary_audience_unavailable')
  const scope = host.scopes.scope(origin.view.scopeId)
  const authority = stableDigest({
    scopeId:scope.id, scopeRevision:scope.revision, tenantEpoch:host.scopes.epoch(scope.tenantId),
    settingsRevision:host.settings.current().revision,
    originPlugin:host.sourceRegistry.packages.find(p=>p.manifest.kind===origin.view.provider)?.digest??null,
    destinationPlugin:host.sourceRegistry.packages.find(p=>p.manifest.kind===destination.view.provider)?.digest??null,
  })
  return {origin,destination,authority}
}

function matches(approval: Approval, current: ReturnType<typeof pair>, now: number): boolean {
  return approval.version === 1 && now < approval.expiresAt &&
    approval.authority === current.authority &&
    stableDigest(approval.origin) === stableDigest(current.origin.binding) &&
    stableDigest(approval.destination) === stableDigest(current.destination.binding)
}

/** This is an operator-only control, never a Router, Worker, or Connector tool. */
export class CuratedSummaries {
  private readonly previews = new Map<string, Preview>()
  constructor(private readonly host: Runtime) {}

  catalog() {
    const now = Date.now(), seen = new Set<string>(), anchors: Anchor['view'][] = []
    // Look at at most the last 2,000 records, not an unbounded transcript scan.
    const rows = this.host.store.db.prepare(`SELECT id FROM
      (SELECT id,kind,rowid FROM records ORDER BY rowid DESC LIMIT 2000)
      WHERE kind='trigger' ORDER BY rowid DESC LIMIT 160`).all()
    for (const row of rows) {
      const item = anchor(this.host,String(row.id),now)
      if (!item) continue
      const key = stableDigest([item.view.entryId,item.view.thread])
      if (seen.has(key)) continue
      seen.add(key); anchors.push(item.view)
      if (anchors.length >= 40) break
    }
    return {anchors}
  }

  preview(value: unknown, operator: string) {
    const input = inputSchema.parse(value)
    if (Buffer.byteLength(input.summary,'utf8') > 3600 || ambiguousDisplay.test(input.summary.replace(/[\r\n\t]/g,'')))
      throw new CuratedSummaryError('summary_text_invalid',400)
    if (this.host.isPaused) throw new CuratedSummaryError('summary_host_paused')
    const now = Date.now()
    const {origin,destination,authority} = pair(this.host,input.originTriggerId,input.destinationTriggerId,now)
    for (const [id,p] of this.previews) if (p.expiresAt <= now) this.previews.delete(id)
    if (this.previews.size >= maxPreviews) this.previews.delete(this.previews.keys().next().value!)
    const id = randomUUID(), expiresAt = now + ttl
    this.previews.set(id,{version:1,operator,summary:input.summary,summaryDigest:stableDigest(input.summary),
      origin:origin.binding,destination:destination.binding,authority,expiresAt})
    return {id,expiresAt,summary:input.summary,origin:origin.view,destination:destination.view}
  }

  confirm(value: unknown, operator: string) {
    const {id} = confirmationSchema.parse(value), messageId = prefix + id
    const result = this.host.store.atomic(()=>{
      const old = this.host.store.get<Receipt>(kind,messageId)
      if (old?.operator === operator) return this.status({id},operator)
      const preview = this.previews.get(id)
      if (!preview || preview.operator !== operator) throw new CuratedSummaryError('summary_preview_required')
      if (this.host.isPaused) throw new CuratedSummaryError('summary_host_paused')
      const now = Date.now()
      const current = pair(this.host,preview.origin.triggerId,preview.destination.triggerId,now)
      if (!matches(preview,current,now)) throw new CuratedSummaryError('summary_preview_stale')
      const {summary, ...receipt} = preview
      this.host.store.outbox.send({id:messageId,kind:'reply',text:summary,channel:current.destination.trigger.channel!},receipt.destination.triggerId)
      const record = this.host.store.db.prepare('SELECT body,status FROM outbox WHERE id=?').get(messageId)
      if (record?.status !== 'pending' || !validEnvelope(JSON.parse(String(record.body)),receipt)) throw new CuratedSummaryError('summary_queue_unavailable')
      this.host.store.requireCuratedSummarySchema()
      this.host.store.put(kind,messageId,receipt)
      // The audit references approvals but never duplicates the text or transcript.
      this.host.store.audit({type:'router.curated-summary-approved',id:messageId,
        originEntry:receipt.origin.entry?.id,destinationEntry:receipt.destination.entry?.id})
      return {id,status:'pending'}
    })
    this.previews.delete(id)
    return result
  }

  status(value: unknown, operator: string) {
    const {id}=statusSchema.parse(value), messageId=prefix+id
    const receipt=this.host.store.get<Receipt>(kind,messageId)
    if (receipt?.operator !== operator) throw new CuratedSummaryError('summary_release_unknown',404)
    const row=this.host.store.db.prepare('SELECT status,attempts FROM outbox WHERE id=?').get(messageId)
    // Existing durable delivery distinguishes a definite block from a provider
    // outcome we cannot confirm. Never create a second send on a repeated click.
    return {id,status:row?.status==='pending'&&Number(row.attempts)>=3?'failed':String(row?.status??'unavailable')}
  }
}

function validEnvelope(message: OutboundMessage & {destinationBinding?:DestinationBinding}, approval: Approval) {
  return message.kind === 'reply' && !message.ticketId && !message.channel.address.routerInbox &&
    message.channel.source === approval.destination.sourceId && message.channel.thread === approval.destination.thread &&
    stableDigest(message.channel.address) === approval.destination.addressDigest &&
    approval.summaryDigest === stableDigest(message.text) &&
    stableDigest(approval.destination) === stableDigest(message.destinationBinding??null)
}

/** Used by the existing outbox dispatcher immediately before a provider send. */
export function curatedSummaryAllowed(host: Runtime,message: OutboundMessage & {destinationBinding?:DestinationBinding}) {
  if (!isCuratedSummary(message.id)) return true
  try {
    const approved = host.store.get<Receipt>(kind,message.id), now = Date.now()
    if (!approved || now >= approved.expiresAt || !validEnvelope(message,approved)) return false
    return matches(approved,pair(host,approved.origin.triggerId,approved.destination.triggerId,now),now)
  } catch { return false }
}
