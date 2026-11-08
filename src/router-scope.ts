import {z} from 'zod'
import {randomUUID} from 'node:crypto'
import type {Config} from './config.ts'
import type {Store,Run} from './store.ts'
import type {Trigger} from './vendor/dsh-core/index.ts'
import {stableDigest} from './sources.ts'
import {executionSchema} from './backend-config.ts'
import {builtinSources,type SourceRegistry} from './source-plugins.ts'

const id=z.string().min(1).max(300)
const scopeInput=z.object({id,tenantId:id,name:id,managers:z.array(id).min(1),workerIds:z.array(id),sourceIds:z.array(id),backendIds:z.array(id),dataEntryIds:z.array(id).default([]),router:executionSchema.unwrap().shape.router.optional(),memoryEnabled:z.boolean().default(true),contextBytes:z.number().int().min(4096).max(1000000).default(256000)}).strict()
export type ManagementScope=z.infer<typeof scopeInput>&{routerId:string;revision:number;epoch:number}
export interface EntryBinding {id:string;tenantId:string;sourceId:string;provider:string;accountNamespace:string;nativeId:string;scopeId:string;revision:number;active:boolean;history:'unknown'|'group';privateActor?:string}
export interface RouterRoute {triggerId:string;discussion:string;entryId:string;tenantId:string;scopeId:string;routerId:string;epoch:number;bindingRevision:number;taskId?:string;ownerEpoch?:number}
export interface TaskOwnership {ticketId:string;tenantId:string;scopeId:string;routerId:string;ownerEpoch:number;dataRevision?:number;originEntry:string;discussion:string;requiredSourceIds:string[];backendId:string;state:'active'|'held';reason?:string}
export interface TaskChannel {ticketId:string;entryId:string;revision:number;context:boolean;request:boolean;result:boolean;active:boolean;dataRevision?:number}
export interface ScopeContext {route:RouterRoute;actor:string;trigger:Trigger}
const common={operationId:id,expectedRevision:z.number().int().min(0)}
export const scopeCommandSchema=z.discriminatedUnion('action',[
 z.object({action:z.literal('migration.activate'),...common}).strict(),
 z.object({action:z.literal('migration.hold'),...common,items:z.array(z.object({kind:id,id}).strict()).min(1)}).strict(),
 z.object({action:z.literal('scope.put'),...common,scope:scopeInput}).strict(),
 z.object({action:z.literal('entry.bind'),...common,scopeId:id,sourceId:id,accountNamespace:id,nativeId:id,history:z.enum(['unknown','group']).default('unknown'),privateActor:id.optional(),active:z.boolean().default(true)}).strict(),
 z.object({action:z.literal('task.channel'),...common,ticketId:id,entryId:id,context:z.boolean(),request:z.boolean(),result:z.boolean(),active:z.boolean().default(true)}).strict(),
 z.object({action:z.literal('task.transfer'),...common,ticketId:id,scopeId:id}).strict(),
 z.object({action:z.literal('reply.resolve'),...common,messageId:id,decision:z.enum(['continue','withdraw'])}).strict(),
])
export class RouterScopeAmbiguity extends Error {}
/** Host control plane. No organization entities or mutable authority enter dsh-core. */
export class RouterScopes {
 constructor(readonly store:Store,readonly config:Config,private busy:(ticketId:string)=>boolean=()=>false,private registry:SourceRegistry=builtinSources){}
 enabled(){return this.store.list<ManagementScope>('management-scope').length>0}
 scope(id:string){const s=this.store.get<ManagementScope>('management-scope',id);if(!s)throw Error('Unknown management scope');return s}
 binding(id:string){const b=this.store.get<EntryBinding>('entry-binding',id);if(!b)throw Error('Unknown entry');return b}
 bindings(){return this.store.list<EntryBinding>('entry-binding')}
 ownership(id:string){return this.store.get<TaskOwnership>('task-ownership',id)}
 actor(t:Trigger){return JSON.stringify([t.actor.source,t.actor.id])}
 nativeId(t:Trigger){return String(t.meta.chat??t.meta.scope??t.threads[0]?.id??'')}
 entry(t:Trigger){return this.bindings().find(b=>b.sourceId===t.source&&b.nativeId===this.nativeId(t))}
 sourceActive(b:EntryBinding){const s=this.config.sources.find(s=>s.id===b.sourceId);return !!(b.active&&this.store.get<any>('source-entry-state',b.id)?.available!==false&&s?.enabled&&this.registry.allowsScope(s,b.nativeId))}
 assertTrigger(t:Trigger){
  if(this.store.get('source-invalid-trigger',t.id))throw Error('Source content or membership changed; a fresh authorized input is required')
  if(!this.enabled())return
  const entry=this.entry(t)
  if(!entry||!this.sourceActive(entry))throw Error('Entry is unassigned or unavailable')
  if(this.store.get<any>('source-member-state',stableDigest([entry.id,t.actor.id]))?.available===false)throw Error('Actor is no longer available in this entry')
 }
 epoch(tenantId:string){return this.store.get<number>('tenant-epoch',tenantId)??0}
 bump(tenantId:string){this.store.put('tenant-epoch',tenantId,this.epoch(tenantId)+1)}
 private checkRevision(actual:number,expected:number){if(actual!==expected)throw Error('Revision conflict; refresh the object before retrying')}
 snapshot(){return {protocol:1,memoryGenerations:Object.fromEntries(this.store.list<ManagementScope>('management-scope').map(s=>[s.id,this.store.get<number>('memory-generation',s.id)??0])),heldReplies:this.store.deliveries().filter(d=>d.status==='held').map(d=>({id:d.id,hold:this.store.get('reply-hold',d.id)})),scopes:this.store.list('management-scope'),entries:this.bindings(),sourceIdentities:this.store.list('source-identity'),identityLinks:this.store.list('identity-link'),tasks:this.store.list('task-ownership'),channels:this.store.list('task-channel'),maintenanceGaps:this.store.list('maintenance-gap'),migration:this.store.get('scope-migration','current')}}
 command(value:unknown){
  const x=scopeCommandSchema.parse(value),key=stableDigest(['scope',x.operationId]),fingerprint=stableDigest(x)
  return this.store.atomic(()=>{
   const old=this.store.get<{fingerprint:string;result:unknown}>('control-receipt',key)
   if(old){if(old.fingerprint!==fingerprint)throw Error('operationId reused with different content');return old.result}
   const result=this.apply(x)
   this.store.put('control-receipt',key,{fingerprint,result});this.store.audit({type:'scope.command',action:x.action,operationId:x.operationId});return result
  })
 }
 private apply(x:z.infer<typeof scopeCommandSchema>):unknown{
  if(x.action==='migration.hold'){
   const migration=this.store.get<any>('scope-migration','current');if(!migration||migration.phase!=='verified_paused')throw Error('Paused migration required');this.checkRevision(migration.revision,x.expectedRevision)
   if(x.items.some(i=>!migration.held.some((h:any)=>h.kind===i.kind&&h.id===i.id)))throw Error('Unknown held migration item')
   const held=migration.held.map((h:any)=>x.items.some(i=>i.kind===h.kind&&i.id===h.id)?{...h,resolution:'keep_held'}:h),next={...migration,held,revision:migration.revision+1}
   this.store.put('scope-migration','current',next);return next
  }
  if(x.action==='migration.activate'){
   const migration=this.store.get<any>('scope-migration','current');if(!migration)throw Error('No migration to activate');this.checkRevision(migration.revision,x.expectedRevision)
   if(migration.phase!=='verified_paused'||migration.held.some((i:any)=>i.resolution!=='keep_held')||!this.enabled())throw Error('Migration has unresolved items or missing scope bindings')
   const gap=this.store.get<any>('maintenance-gap',migration.operationId);if(gap)this.store.put('maintenance-gap',gap.id,{...gap,resumedAt:Date.now(),state:'awaiting_replay'})
   const next={...migration,phase:'active',revision:migration.revision+1};this.store.put('scope-migration','current',next);return next
  }
  if(x.action==='scope.put'){
   const old=this.store.get<ManagementScope>('management-scope',x.scope.id);this.checkRevision(old?.revision??0,x.expectedRevision)
   if(!this.enabled()&&this.store.tickets.list().length&&!this.store.get('scope-migration','current'))throw Error('Existing tasks require an explicit ownership migration before enabling scopes')
   if(old&&old.tenantId!==x.scope.tenantId)throw Error('Scope tenant cannot change')
   for(const source of x.scope.sourceIds)if(!this.config.sources.some(s=>s.id===source))throw Error('Unknown source')
   for(const backend of [...x.scope.backendIds,...(x.scope.router?.backend?[x.scope.router.backend]:[])])if(backend!=='codex'&&!this.config.backends[backend])throw Error('Unknown backend')
   if(x.scope.router?.backend&&!x.scope.backendIds.includes(x.scope.router.backend))throw Error('Router backend is outside scope permission')
   for(const entryId of x.scope.dataEntryIds)if(this.binding(entryId).tenantId!==x.scope.tenantId)throw Error('Data entry is outside tenant')
   const next:ManagementScope={...x.scope,routerId:old?.routerId??'router-'+randomUUID(),revision:(old?.revision??0)+1,epoch:(old?.epoch??0)+1}
   this.store.put('management-scope',next.id,next);this.bump(next.tenantId);return next
  }
  if(x.action==='entry.bind'){
   const scope=this.scope(x.scopeId),source=this.config.sources.find(s=>s.id===x.sourceId)
   if(!source||!scope.sourceIds.includes(source.id))throw Error('Source is outside management scope')
   if(!this.registry.allowsScope(source,x.nativeId))throw Error('Entry is outside configured source')
   const identity=this.store.get<any>('source-identity',source.id)
   if(source.kind!=='local'&&!identity)throw Error('Verify source account before binding')
   if(identity&&identity.namespace!==x.accountNamespace)throw Error('Entry namespace does not match verified connection identity')
   const aliases=this.bindings().filter(b=>b.sourceId===source.id)
   if(aliases.some(b=>b.accountNamespace!==x.accountNamespace))throw Error('Source account namespace is immutable; use a separately verified source')
   const entryId=stableDigest([scope.tenantId,source.kind,x.accountNamespace,x.nativeId])
   const old=this.store.get<EntryBinding>('entry-binding',entryId)
   if(this.bindings().some(b=>b.sourceId===source.id&&b.nativeId===x.nativeId&&b.id!==entryId))throw Error('Entry is already owned by another tenant')
   if(old&&(old.sourceId!==source.id||old.privateActor!==x.privateActor))throw Error('Entry identity cannot change')
   this.checkRevision(old?.revision??0,x.expectedRevision)
   const next:EntryBinding={id:entryId,tenantId:scope.tenantId,sourceId:source.id,provider:source.kind,accountNamespace:x.accountNamespace,nativeId:x.nativeId,scopeId:scope.id,revision:(old?.revision??0)+1,active:x.active,history:x.history,...(x.privateActor?{privateActor:x.privateActor}:{})}
   this.store.put('entry-binding',entryId,next);this.bump(next.tenantId);return next
  }
  if(x.action==='task.channel'){
   const owner=this.ownership(x.ticketId),entry=this.binding(x.entryId)
   if(!owner||owner.tenantId!==entry.tenantId)throw Error('Task entry tenant mismatch')
   const key=stableDigest([x.ticketId,x.entryId]),old=this.store.get<TaskChannel>('task-channel',key);this.checkRevision(old?.revision??0,x.expectedRevision)
   // Sharing a result is an explicit data-publishing action. It never changes a Mandate.
   const next:TaskChannel={ticketId:x.ticketId,entryId:x.entryId,context:x.context,request:x.request,result:x.result,active:x.active,revision:(old?.revision??0)+1,dataRevision:owner.dataRevision??1}
   this.store.put('task-channel',key,next)
   this.store.put('memory-query-version',owner.tenantId,(this.store.get<number>('memory-query-version',owner.tenantId)??0)+1)
   return next
  }
  if(x.action==='reply.resolve'){
   const hold=this.store.get<{ticketId:string;revision:number}>('reply-hold',x.messageId)
   if(!hold)throw Error('Reply is not held');this.checkRevision(hold.revision,x.expectedRevision)
   const msg=this.store.deliveries().find(d=>d.id===x.messageId),owner=this.ownership(hold.ticketId)
   if(!msg||msg.status!=='held'||!owner||owner.state!=='active')throw Error('Reply cannot be released')
   // Releasing a stale model output needs a fresh Router review; only withdrawing is direct.
   if(x.decision==='continue')throw Error('Fresh Router review required; withdraw the stale reply and request a new reviewed response')
   this.store.db.prepare("UPDATE outbox SET status='dropped' WHERE id=? AND status='held'").run(msg.id)
   this.store.put('reply-hold',msg.id,{...hold,revision:hold.revision+1,resolved:'withdrawn'});return {id:msg.id,status:'dropped'}
  }
  const owner=this.ownership(x.ticketId),target=this.scope(x.scopeId)
  if(!owner||owner.tenantId!==target.tenantId)throw Error('Task transfer must remain within tenant')
  this.checkRevision(owner.ownerEpoch,x.expectedRevision)
  if(owner.state!=='active')throw Error('Task requires reconciliation')
  if(!target.dataEntryIds.includes(owner.originEntry)||owner.requiredSourceIds.some(s=>!target.sourceIds.includes(s))||!target.backendIds.includes(owner.backendId))throw Error('Target lacks required data, environment or backend permission')
  const delegated=this.store.get<{workerId:string}>('worker-assignment',x.ticketId)
  if(delegated&&!target.workerIds.includes(delegated.workerId))throw Error('Target lacks permission to manage the existing Worker')
  const run=this.store.get<Run>('run',x.ticketId)
  if(this.busy(x.ticketId)||run&&run.phase!=='idle'||this.store.list<any>('work').some(w=>w.ticketId===x.ticketId&&['starting','running'].includes(w.state)))throw Error('Drain all task execution before transfer')
  if(this.store.deliveries().some(d=>d.ticketId===x.ticketId&&['sending','uncertain'].includes(d.status)))throw Error('Reconcile uncertain delivery before transfer')
  const oldEpoch=this.epoch(owner.tenantId),savedContext=this.store.get<any>('task-context',owner.ticketId)
  if(savedContext&&!target.dataEntryIds.includes(savedContext.manifest.entryId))throw Error('Target lacks permission for the current task audience')
  if(savedContext&&savedContext.manifest.epoch!==oldEpoch)throw Error('Task context needs reconciliation before transfer')
  const next={...owner,scopeId:target.id,routerId:target.routerId,ownerEpoch:owner.ownerEpoch+1}
  this.store.put('task-ownership',x.ticketId,next)
  for(const msg of this.store.deliveries()){
   const reply=this.store.get<any>('router-reply-owner',msg.id)
   if(msg.status==='pending'&&(msg.ticketId===x.ticketId||reply?.taskIds?.includes(x.ticketId))){
    this.store.db.prepare("UPDATE outbox SET status='held' WHERE id=? AND status='pending'").run(msg.id)
    this.store.put('reply-hold',msg.id,{ticketId:x.ticketId,revision:1,reason:'Task ownership changed'})
   }
  }
  this.advanceTaskContext(next,oldEpoch);return next
 }
 private advanceTaskContext(owner:TaskOwnership,previousEpoch:number){
  const context=this.store.get<any>('task-context',owner.ticketId)
  if(context?.manifest.epoch===previousEpoch){
   const manifest={...context.manifest,scopeId:owner.scopeId,routerId:owner.routerId,generation:this.store.get<number>('memory-generation',owner.scopeId)??0,epoch:this.epoch(owner.tenantId),taskOwners:context.manifest.taskOwners.map((ref:any)=>ref.id===owner.ticketId?{id:owner.ticketId,epoch:owner.ownerEpoch,dataRevision:owner.dataRevision??1}:ref)}
   this.store.put('task-context',owner.ticketId,{...context,manifest});this.store.put('context-manifest',manifest.id,manifest)
  }
 }
 route(trigger:Trigger,discussion:string):RouterRoute|undefined{
  if(!this.enabled())return
  const previous=this.store.get<RouterRoute>('router-route',trigger.id);if(previous)return previous
  const entry=this.entry(trigger);if(!entry||!this.sourceActive(entry))throw Error('Entry is unassigned or unavailable')
  let scope=this.scope(entry.scopeId),task:TaskOwnership|undefined
  const references=this.store.list<TaskOwnership>('task-ownership').filter(t=>trigger.text.includes(t.ticketId))
  if(references.length>1)throw new RouterScopeAmbiguity('Multiple task references; clarify one task')
  if(references.length){task=references[0]!;this.checkTaskEntry(task,entry.id,'request',true);scope=this.scope(task.scopeId)}
  else {
   const linked=this.store.list<TaskOwnership>('task-ownership').filter(t=>t.originEntry===entry.id&&t.discussion===discussion)
   const owners=new Set(linked.map(t=>t.scopeId))
   if(owners.size>1)throw new RouterScopeAmbiguity('Conversation has multiple task owners; specify a task')
   if(linked.length){task=linked.length===1?linked[0]:undefined;scope=this.scope(linked[0]!.scopeId)}
  }
  const route:RouterRoute={triggerId:trigger.id,discussion,entryId:entry.id,tenantId:scope.tenantId,scopeId:scope.id,routerId:scope.routerId,epoch:this.epoch(scope.tenantId),bindingRevision:entry.revision,...(task?.state==='active'?{taskId:task.ticketId,ownerEpoch:task.ownerEpoch}:{})}
  this.store.put('router-route',trigger.id,route);return route
 }
 context(trigger:Trigger,discussion:string):ScopeContext|undefined{
  const saved=this.route(trigger,discussion);if(!saved)return
  const route={...saved,epoch:this.epoch(saved.tenantId)}
  if(saved.taskId){const task=this.ownership(saved.taskId);if(!task)throw Error('Task ownership missing');this.checkTaskEntry(task,saved.entryId,'context');Object.assign(route,{scopeId:task.scopeId,routerId:task.routerId,ownerEpoch:task.ownerEpoch})}
  if(!this.sourceActive(this.binding(route.entryId)))throw Error('Entry is unavailable')
  return {route,actor:this.actor(trigger),trigger}
 }
 contextForTask(trigger:Trigger,discussion:string,ticketId:string):ScopeContext|undefined{
  const current=this.context(trigger,discussion);if(!current)return
  const owner=this.ownership(ticketId);if(!owner)throw Error('Task ownership missing')
  this.checkTaskEntry(owner,current.route.entryId,'result')
  return {...current,route:{...current.route,scopeId:owner.scopeId,routerId:owner.routerId,taskId:owner.ticketId,ownerEpoch:owner.ownerEpoch}}
 }
 assertCurrent(c:ScopeContext){
  this.assertTrigger(c.trigger)
  if(c.route.epoch!==this.epoch(c.route.tenantId)||!this.sourceActive(this.binding(c.route.entryId)))throw Error('Context permissions changed; rebuild before continuing')
  if(c.route.taskId){const o=this.ownership(c.route.taskId);if(!o||o.ownerEpoch!==c.route.ownerEpoch)throw Error('Task ownership changed')}
 }
 canManage(c:ScopeContext){this.assertCurrent(c);return this.scope(c.route.scopeId).managers.includes(c.actor)}
 checkTaskEntry(owner:TaskOwnership,entryId:string,capability:'context'|'request'|'result',allowHeld=false){
  const entry=this.binding(entryId),channel=this.store.get<TaskChannel>('task-channel',stableDigest([owner.ticketId,entryId]))
  const controlledHold=allowHeld&&owner.state==='held'&&owner.reason==='context_permissions_changed'
  if(owner.state!=='active'&&!controlledHold||entry.tenantId!==owner.tenantId||!this.sourceActive(entry)||!channel?.active||!channel[capability]||capability==='result'&&(channel.dataRevision??1)!==(owner.dataRevision??1))throw Error('Task is outside this entry permission')
 }
 checkTask(ticketId:string,c:ScopeContext,mutate=false,allowHeld=false){
  this.assertCurrent(c);const owner=this.ownership(ticketId)
  if(!owner||owner.routerId!==c.route.routerId)throw Error('Task ownership changed or is outside this Router')
  this.checkTaskEntry(owner,c.route.entryId,mutate?'request':'context',allowHeld)
  if(mutate){const t=this.store.tickets.get(ticketId);if(!this.canManage(c)&&(t?.mandate.actor?.id!==c.trigger.actor.id||t?.mandate.actor?.source!==c.trigger.actor.source))throw Error('Task changes require its requester or a manager')}
 }
 own(ticketId:string,c:ScopeContext,backendId:string){
  this.assertCurrent(c);const scope=this.scope(c.route.scopeId)
  if(!scope.backendIds.includes(backendId)||!scope.sourceIds.includes(c.trigger.source))throw Error('Task backend or environment is outside scope')
  const owner:TaskOwnership={ticketId,tenantId:scope.tenantId,scopeId:scope.id,routerId:scope.routerId,ownerEpoch:1,originEntry:c.route.entryId,discussion:c.route.discussion,requiredSourceIds:[c.trigger.source],backendId,state:'active'}
  this.store.put('task-ownership',ticketId,owner)
  this.store.put('task-channel',stableDigest([ticketId,c.route.entryId]),{ticketId,entryId:c.route.entryId,revision:1,context:true,request:true,result:true,active:true} satisfies TaskChannel)
  return owner
 }
 noteInput(ticketId:string,c:ScopeContext){
  const owner=this.ownership(ticketId)!;this.checkTask(ticketId,c,true)
  const next={...owner,dataRevision:(owner.dataRevision??1)+1};this.store.put('task-ownership',ticketId,next)
  const key=stableDigest([ticketId,c.route.entryId]),channel=this.store.get<TaskChannel>('task-channel',key)!
  if(!channel.result||!channel.active)throw Error('A follow-up needs an explicit result channel')
  this.store.put('task-channel',key,{...channel,dataRevision:next.dataRevision,revision:channel.revision+1})
  this.store.put('task-routing',ticketId,{ticketId,source:c.trigger.source,discussion:c.route.discussion,parentTrigger:c.trigger.id,entryId:c.route.entryId,mode:'host'})
 }
 addWorker(scopeId:string,workerId:string){const scope=this.scope(scopeId);if(!scope.workerIds.includes(workerId))this.store.put('management-scope',scope.id,{...scope,workerIds:[...scope.workerIds,workerId],revision:scope.revision+1})}
 taskRunnable(ticketId:string){const owner=this.ownership(ticketId);const migration=this.store.get<any>('scope-migration','current');return (!migration||migration.phase==='active')&&(!this.enabled()||!!owner&&owner.state==='active'&&owner.requiredSourceIds.every(s=>this.scope(owner.scopeId).sourceIds.includes(s))&&this.scope(owner.scopeId).backendIds.includes(owner.backendId))}
}
