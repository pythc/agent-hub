import {stableDigest} from '../sources.ts'
import {workerProfiles} from '../worker-pool.ts'
import {z} from 'zod'
import type {Runtime} from '../runtime.ts'
import {connectionChecks,subscriptionOwners} from '../connection-library.ts'
import type {Onboarding} from '../onboarding.ts'
import {workerCommandSchema} from '../worker-manager.ts'

export function terminalSetupInfo(host:Runtime,onboarding:Onboarding){
 return {revision:host.settings.current().revision,ready:host.chat.readiness().ready,
  initial:host.config.execution.router?.mode!=='host',connections:onboarding.info().connections,
  checks:connectionChecks(host),accounts:host.subscriptions.list(),owners:subscriptionOwners(host)}
}
export const terminalSetupAction=z.discriminatedUnion('action',[
 z.object({action:z.literal('plan'),value:z.unknown()}).strict(),
 z.object({action:z.literal('check'),id:z.string().uuid()}).strict(),
 z.object({action:z.literal('apply'),id:z.string().uuid()}).strict(),
 z.object({action:z.literal('models'),connection:z.unknown()}).strict(),
 z.object({action:z.literal('oauth.start')}).strict(),
 z.object({action:z.literal('oauth.status'),attempt:z.string().min(1)}).strict(),
 z.object({action:z.literal('oauth.models'),account:z.string().min(1)}).strict()
])
export const terminalWorkerAction=workerCommandSchema.extend({action:z.enum(['create','clone','pause','resume','destroy']),cancelRunning:z.literal(false).optional()})

/** Start a fresh personal installation with its private long-term memory enabled. */
export function initializeTerminalMemory(host:Runtime,owner:string){
 if(host.scopes.enabled()||host.store.tickets.list().length)return
 const selected=host.config.execution.router?.backend??host.config.execution.backend,backend=host.config.backends[selected]
 const principal=backend&&'subscription'in backend?backend.subscription?.owner:undefined
 const source=host.config.sources.find(s=>s.kind==='local'&&s.enabled&&s.allowedActors.length&&(!principal||s.id===principal.source))!
 const id='@chat:'+stableDigest(owner)
 host.scopes.command({action:'scope.put',operationId:'terminal-memory:'+id,expectedRevision:0,scope:{id,tenantId:id,name:'Chat',managers:[JSON.stringify([source.id,principal?.actor??source.allowedActors[0]!])],sourceIds:[source.id],workerIds:workerProfiles(host.config).map(w=>w.id),backendIds:['codex',...Object.keys(host.config.backends).filter(id=>id!=='codex')],memoryEnabled:true}})
}
