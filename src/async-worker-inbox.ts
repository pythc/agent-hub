import {validateTaskAssignment} from './task-assignment-contract.ts'
import {randomUUID} from 'node:crypto'
import type {Runtime} from './runtime.ts'
import type {RouterGoal} from './router-goals.ts'
import type {Run} from './store.ts'
import type {WorkOwner} from './work.ts'
import {stableDigest} from './sources.ts'
import {taskView} from './task-context.ts'
import type {ContextManifest} from './router-memory.ts'

export interface WorkerBasis {
 taskId:string;assignmentId:string;taskAssignmentDigest?:string|null;mandateDigest:string;goalId:string|null;contractDigest:string|null;
 goalRevision:number|null;planRevision:number|null;ownerEpoch:number|null;dataRevision:number|null;bindingRevision:number|null;
}
export interface WorkerAttempt {
 schema:1;id:string;ticketId:string;assignmentId:string;source:'host_activation';causeJobId:string|null;startedAt:number;basis:WorkerBasis;
}
export interface WorkerEvent {
 kind:'progress'|'blocked'|'result';payload:unknown;nativeTurnId?:string|null;
}
export interface WorkerEventReceipt {
 schema:1;id:string;ticketId:string;assignmentId:string;attemptId:string;kind:WorkerEvent['kind'];
 source:'host_progress_observation'|'host_worker_report';causationRef:string;basis:WorkerBasis;
 payloadDigest:string;nativeTurnDigest:string|null;observedAt:number;occurredAt:null;sourceSequence:null;
 disposition:'applied'|'archived';reason:'current'|'attempt_superseded'|'authority_changed'|'basis_changed'|'terminal_observed';
}
const version=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0?v:null
const digest=(value:unknown)=>stableDigest(value===undefined?null:value)
const identity=(basis:WorkerBasis)=>{const {goalRevision,...rest}=basis;return {...rest,taskAssignmentDigest:basis.taskAssignmentDigest??null}}
function basis(host:Runtime,ticketId:string,assignmentId:string,delivery=false):WorkerBasis {
 const task=host.store.tickets.get(ticketId)
 if(!task||host.memory.cleanup.blocked('ticket',ticketId,task))throw Error('async_worker_task_unavailable')
 const owner=host.scopes.ownership(ticketId),authority=host.taskAuthority(ticketId)
 const route=authority?.parentTrigger?host.store.get<{entryId:string}>('router-route',authority.parentTrigger):undefined
 const entryId=route?.entryId??owner?.originEntry
 const binding=entryId?host.scopes.binding(entryId):undefined
 if(owner&&entryId)host.scopes.checkTaskEntry(owner,entryId,'context')
 const goals=host.store.list<RouterGoal>('router-goal').filter(g=>host.goals.taskIdsForGoal(g).includes(ticketId))
 if(goals.length>1)throw Error('async_worker_goal_ambiguous')
 const goal=goals[0]
 if(goal&&(goal.supersededBy||host.memory.cleanup.blocked('router-goal',goal.id,goal)||!(delivery?['active','waiting','completed']:['active','waiting']).includes(goal.state)))throw Error('async_worker_goal_unavailable')
 return {taskId:ticketId,assignmentId,taskAssignmentDigest:validateTaskAssignment(host,ticketId)?.digest??null,mandateDigest:digest(taskView(host.store,task).mandate),goalId:goal?.id??null,contractDigest:goal?.contract?digest(goal.contract):null,goalRevision:version(goal?.revision),planRevision:version(goal?.planRevision),ownerEpoch:version(owner?.ownerEpoch),dataRevision:version(owner?.dataRevision),bindingRevision:version(binding?.revision)}
}
function authorized(host:Runtime,attempt:Pick<WorkerAttempt,'ticketId'|'assignmentId'>):boolean {
 try{
 const task=host.store.tickets.get(attempt.ticketId)
 if(!task||host.memory.cleanup.blocked('ticket',task.id,task))return false
 const source=host.sources.get(task.mandate.actor.source)?.config
 if(!source?.enabled)return false
 const owner=host.scopes.ownership(task.id)
 if(owner?.requiredSourceIds.some(id=>!host.config.sources.find(s=>s.id===id)?.enabled))return false
 const run=host.store.get<Run>('run',task.id)
 return host.validWork({ticketId:task.id,assignmentId:attempt.assignmentId,cwd:run?.cwd??source.cwd,sandbox:source.sandbox,depth:0,network:false} as WorkOwner)
 }catch{return false}
}
function currentReason(host:Runtime,attempt:WorkerAttempt):WorkerEventReceipt['reason'] {
 if(host.store.get('async-worker-revoked',attempt.id))return 'authority_changed'
 if(host.store.get<{attemptId:string}>('async-worker-current',attempt.ticketId)?.attemptId!==attempt.id)return 'attempt_superseded'
 if(host.store.get('async-worker-terminal',attempt.id))return 'terminal_observed'
 if(!authorized(host,attempt))return 'authority_changed'
 try{
  const fresh=basis(host,attempt.ticketId,attempt.assignmentId)
  return digest(identity(attempt.basis))===digest(identity(fresh))?'current':'basis_changed'
 }catch{return 'authority_changed'}
}
/** Advisory read-only fence; observe still repeats the check in its transaction. */
export function isCurrent(host:Runtime,attempt:WorkerAttempt):boolean {
 try{return host.scopes.readOnly(()=>host.memory.readOnly(()=>{
  const saved=host.store.get<WorkerAttempt>('async-worker-attempt',attempt.id)
  return !!saved&&digest(saved)===digest(attempt)&&currentReason(host,attempt)==='current'
 }))}catch{return false}
}
/** Delivery is not new execution: a valid completed report remains readable. */
export function isDeliverable(host:Runtime,receipt:WorkerEventReceipt):boolean {
 try{return host.scopes.readOnly(()=>host.memory.readOnly(()=>{
  if(receipt.disposition!=='applied'||host.store.get('async-worker-revoked',receipt.attemptId))return false
  const saved=host.store.get<WorkerEventReceipt>('async-worker-event',receipt.id)
  const {replayed:_,...reference}=receipt as WorkerEventReceipt&{replayed?:boolean}
  if(!saved||digest(saved)!==digest(reference))return false
  const attempt=host.store.get<WorkerAttempt>('async-worker-attempt',receipt.attemptId)
  if(!attempt||attempt.ticketId!==receipt.ticketId||attempt.assignmentId!==receipt.assignmentId||digest(attempt.basis)!==digest(receipt.basis))return false
  if(host.store.get<{attemptId:string}>('async-worker-current',receipt.ticketId)?.attemptId!==receipt.attemptId)return false
  const task=host.store.tickets.get(receipt.ticketId),last=task?.assignments.at(-1)
  if(!task||task.ended?.by==='human'||last?.id!==receipt.assignmentId||host.memory.cleanup.blocked('ticket',task.id,task)||host.memory.cleanup.blocked('async-worker-event',receipt.id,saved))return false
  if(host.store.get<Run>('run',task.id)?.phase==='human'||!host.scopes.taskRunnable(task.id)||!host.webhooks.taskExecutionAllowed(task.id))return false
  if(!host.sources.get(task.mandate.actor.source)?.config.enabled)return false
  const owner=host.scopes.ownership(task.id),authority=host.taskAuthority(task.id)
  if(owner?.requiredSourceIds.some(id=>!host.config.sources.find(s=>s.id===id)?.enabled))return false
  if(host.config.execution.router?.mode==='host'&&!authority)return false
  if(authority?.parentTrigger){
   host.routerIngress.authority(authority.parentTrigger,authority.discussion)
   const route=host.store.get<{entryId:string}>('router-route',authority.parentTrigger)
   if(owner){if(!route)return false;host.scopes.checkTaskEntry(owner,route.entryId,'result')}
  }else if(owner)host.scopes.checkTaskEntry(owner,owner.originEntry,'result')
  const context=host.store.get<{manifest:ContextManifest}>('task-context',task.id)
  if(context)host.memory.validate(context.manifest)
  const fresh=basis(host,task.id,receipt.assignmentId,true)
  return digest(identity(receipt.basis))===digest(identity(fresh))
 }))}catch{return false}
}
/** Real activation identity, not a provider event ID or invented native sequence. */
export function begin(host:Runtime,ticketId:string,assignmentId:string,causeJobId?:string):WorkerAttempt {
 return host.store.atomic(()=>{
  if(!authorized(host,{ticketId,assignmentId}))throw Error('async_worker_authority_unavailable')
  if(causeJobId!==undefined){
   const job=host.store.db.prepare('SELECT payload FROM jobs WHERE id=?').get(causeJobId)
   const payload=job?JSON.parse(String(job.payload)):undefined
   if(!payload||payload.ticketId!==ticketId||payload.assignmentId!==assignmentId)throw Error('async_worker_cause_unavailable')
  }
  const attempt:WorkerAttempt={schema:1,id:randomUUID(),ticketId,assignmentId,source:'host_activation',causeJobId:causeJobId??null,startedAt:Date.now(),basis:basis(host,ticketId,assignmentId)}
  host.store.requireAsyncWorkerSchema()
  host.store.put('async-worker-attempt',attempt.id,attempt)
  host.store.put('async-worker-current',ticketId,{schema:1,ticketId,assignmentId,attemptId:attempt.id})
  return attempt
 })
}
/** Receipt and its synchronous business effect are committed or rolled back together. */
export function observe(host:Runtime,attempt:WorkerAttempt,event:WorkerEvent,applySync:(receipt:WorkerEventReceipt)=>void):WorkerEventReceipt&{replayed:boolean} {
 if(!['progress','blocked','result'].includes(event.kind)||event.kind==='progress'&&typeof event.payload!=='string')throw Error('async_worker_event_invalid')
 const payloadDigest=digest(event.payload),nativeTurnDigest=event.kind!=='progress'&&event.nativeTurnId?digest(event.nativeTurnId):null
 const id='worker-event:'+digest([attempt.id,event.kind==='progress'?'progress:'+payloadDigest:event.kind,nativeTurnDigest])
 return host.store.atomic(()=>{
  const saved=host.store.get<WorkerAttempt>('async-worker-attempt',attempt.id)
  if(!saved||digest(saved)!==digest(attempt))throw Error('async_worker_attempt_unavailable')
  // Deleted data stays deleted: never recreate receipts from a retained callback.
  const task=host.store.tickets.get(attempt.ticketId)
  if(!task||host.memory.cleanup.blocked('ticket',task.id,task)||host.memory.cleanup.blocked('async-worker-attempt',attempt.id,saved))throw Error('async_worker_task_unavailable')
  const previous=host.store.get<WorkerEventReceipt>('async-worker-event',id)
  if(previous){
   if(previous.kind!==event.kind||previous.payloadDigest!==payloadDigest||previous.nativeTurnDigest!==nativeTurnDigest)throw Error('async_worker_event_conflict')
   return {...previous,replayed:true}
  }
  const reason=currentReason(host,attempt)
  const terminal=host.store.get<{eventId:string}>('async-worker-terminal',attempt.id)
  const receipt:WorkerEventReceipt={schema:1,id,ticketId:attempt.ticketId,assignmentId:attempt.assignmentId,attemptId:attempt.id,kind:event.kind,source:event.kind==='progress'?'host_progress_observation':'host_worker_report',causationRef:attempt.id,basis:attempt.basis,payloadDigest,nativeTurnDigest,observedAt:Date.now(),occurredAt:null,sourceSequence:null,disposition:reason==='current'?'applied':'archived',reason}
  if(reason==='current'){
   const result=applySync(receipt) as unknown
   if(result&&typeof (result as {then?:unknown}).then==='function')throw Error('async_worker_apply_must_be_synchronous')
  }
  host.store.put('async-worker-event',id,receipt)
  if(event.kind!=='progress'&&!terminal)host.store.put('async-worker-terminal',attempt.id,{schema:1,ticketId:attempt.ticketId,assignmentId:attempt.assignmentId,attemptId:attempt.id,eventId:id})
  return {...receipt,replayed:false}
 })
}
export const captureWorkerAttempt=begin
export const observeWorkerEvent=observe
