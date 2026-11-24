import type { SourceConfig } from './config.ts'
import type { ManagementScope, RouterScopes } from './router-scope.ts'
import type { Store } from './store.ts'
import { stableDigest } from './sources.ts'
import type { OutboundMessage, Trigger } from './vendor/dsh-core/index.ts'

/** Host-owned envelope, never supplied by the model or sent to an adapter. */
export interface DestinationBinding {
  version: 1
  triggerId: string
  sourceId: string
  nativeId: string
  thread: string
  addressDigest: string
  configurationDigest: string
  entry?: { id: string; tenantId: string; revision: number; privateActorDigest?: string }
}

/**
 * Bind the full connector-owned address rather than reconstructing an address
 * from a display name, a thread prefix, a task subscription, or model output.
 * Some connectors have no separate message id; their address is still bound
 * exactly (including a provider message id or key when it exists).
 */
export function originalDestination(
  store: Store, scopes: RouterScopes, source: SourceConfig | undefined,
  message: OutboundMessage, triggerId?: string,
): DestinationBinding | undefined {
  const trigger = triggerId ? store.triggers.get(triggerId) : undefined
  const channel = trigger?.channel
  if (!source?.enabled || !source.capabilities.replies || !trigger || !channel ||
      channel.address.routerInbox || channel.source !== trigger.source ||
      (source.listenScopes && !source.listenScopes.includes(String(trigger.meta.scope??'default'))) ||
      trigger.source !== source.id || message.channel.source !== source.id ||
      message.channel.thread !== channel.thread ||
      stableDigest(message.channel.address) !== stableDigest(channel.address) ||
      scopes.triggerRestriction(trigger) ||
      store.list<{triggers:string[]}>('history-plan').some(p=>p.triggers.includes(trigger.id))) return
  const entry = scopes.entry(trigger)
  if (entry && (!scopes.sourceActive(entry) || !store.get<ManagementScope>('management-scope',entry.scopeId)?.sourceIds.includes(source.id) ||
      (entry.privateActor && entry.privateActor !== scopes.actor(trigger)))) return
  const account = store.get<{namespace:string}>('source-identity', source.id)?.namespace
  if (entry && account !== undefined && account !== entry.accountNamespace) return
  const { kind, allowedActors, allowedBots, admission, listenScopes, capabilities, replyUrl, tokenEnv, repository, github, feishu, wecom, options } = source
  return {
    version: 1, triggerId: trigger.id, sourceId: source.id, nativeId: scopes.nativeId(trigger),
    thread: channel.thread, addressDigest: stableDigest(channel.address),
    configurationDigest: stableDigest({kind,allowedActors,allowedBots,admission,listenScopes,capabilities,replyUrl,tokenEnv,repository,github,feishu,wecom,options,account}),
    ...(entry ? {entry:{id:entry.id,tenantId:entry.tenantId,revision:entry.revision,...(entry.privateActor?{privateActorDigest:stableDigest(entry.privateActor)}:{})}} : {}),
  }
}

/** Only the current recipient entry may contribute raw input to a reply. */
export function belongsToAudience(scopes: RouterScopes, binding: DestinationBinding, input: Trigger): boolean {
  if (input.source !== binding.sourceId || scopes.nativeId(input) !== binding.nativeId ||
      (input.channel?.thread??input.threads[0]?.id)!==binding.thread || scopes.triggerRestriction(input)) return false
  if (!binding.entry) return !scopes.enabled()
  const entry = scopes.entry(input)
  return entry?.id === binding.entry.id && entry.tenantId === binding.entry.tenantId &&
    (!binding.entry.privateActorDigest || binding.entry.privateActorDigest === stableDigest(scopes.actor(input)))
}
