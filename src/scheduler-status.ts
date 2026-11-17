import type {Runtime} from './runtime.ts'
import type {Job,Run,Store} from './store.ts'
import {workerProfiles} from './worker-pool.ts'

/** These predicates intentionally preserve the scheduler's existing asymmetry. */
export function schedulerRoutingKind(kind:string){return ['assess','followup','router','router-admit','router-followup','router-batch','router-scheduled-followup','router-skill-run','workflow-decision','goal-verify','goal-replan'].includes(kind)}
export function schedulerRoutingKey(id:string){return ['assess:','followup:','router:','router-admit:','router-followup:','router-batch:','workflow-decision:','goal-verify:','goal-replan:'].some(prefix=>id.startsWith(prefix))}
export function schedulerInteractiveJob(store:Store,job:Job){
 const ticketId=(job.payload as {ticketId?:string}|null)?.ticketId,ticket=ticketId?store.tickets.get(ticketId):undefined
 return job.kind==='followup'||job.kind==='router-followup'||(job.kind==='execute'&&!!ticket?.inputs.some(i=>i.kind==='trigger'&&i.human&&ticket.undelivered.includes(i.id)))
}
export function schedulerFollowupSlot(host:Pick<Runtime,'config'|'store'>,job:Job){const ticketId=(job.payload as {ticketId?:string}|null)?.ticketId;return schedulerInteractiveJob(host.store,job)&&(!host.config.execution.workers||!!(ticketId&&host.store.get<Run>('run',ticketId)?.threadId))}

export interface SchedulerStatus {
 schema:1
 observedAt:number
 paused:boolean
 occupancy:{jobs:number;routingJobs:number;workerJobs:number;controllers:number;backgroundReservations:number;activeManagedWork:number}
 workers:{configured:number;enabled:number;paused:number;retiring:number;idleEnabled:number}
 routing:{countedLimit:4;admittedButWorkerCountedJobs:number}
 interactive:{additionalLimit:1;eligibleQueued:number;activeReservedExecutions:number;mode:'existing_session'|'legacy_pool'}
 queue:{ready:number;delayed:number;blocked:number;uncertain:number}
}
/** A synchronous, aggregate observation, never an admission decision or a dispatch preview. */
export function schedulerStatus(host:Runtime,runningKeys:readonly string[],controllerKeys:readonly string[],now=Date.now()):SchedulerStatus{
 const profiles=workerProfiles(host.config),runs=host.store.list<Run>('run'),controllers=new Set(controllerKeys)
 const background=runs.filter(r=>r.phase==='background'&&!controllers.has(r.ticketId)&&host.work.active(r.ticketId,r.assignmentId).length>0)
 // Match dispatchWorker's busy predicate, without selecting a profile or advancing its cursor.
 const busy=new Set(runs.filter(r=>['starting','running'].includes(r.phase)||r.phase==='background'&&host.work.active(r.ticketId,r.assignmentId).length>0).map(r=>r.workerId).filter(Boolean))
 const enabled=profiles.filter(w=>!w.state||w.state==='enabled')
 const rows=host.store.db.prepare("SELECT id,kind,state,next_at,payload FROM jobs WHERE state IN ('pending','blocked','uncertain','running')").all()
 const ready=rows.filter(r=>r.state==='pending'&&Number(r.next_at)<=now)
 const routingJobs=runningKeys.filter(schedulerRoutingKey).length
 const runningIds=new Set(runningKeys)
 return {schema:1,observedAt:now,paused:host.isPaused,
  occupancy:{jobs:runningKeys.length,routingJobs,workerJobs:runningKeys.length-routingJobs,controllers:controllerKeys.length,backgroundReservations:background.length,activeManagedWork:host.work.list().filter(w=>['starting','running'].includes(w.state)).length},
  workers:{configured:profiles.length,enabled:enabled.length,paused:profiles.filter(w=>w.state==='paused').length,retiring:profiles.filter(w=>w.state==='retiring').length,idleEnabled:enabled.filter(w=>!busy.has(w.id)).length},
  routing:{countedLimit:4,admittedButWorkerCountedJobs:rows.filter(r=>runningIds.has(String(r.id))&&schedulerRoutingKind(String(r.kind))&&!schedulerRoutingKey(String(r.id))).length},
  interactive:{additionalLimit:1,eligibleQueued:ready.filter(r=>schedulerFollowupSlot(host,{id:String(r.id),kind:String(r.kind),payload:JSON.parse(String(r.payload)),state:'pending',attempts:0,nextAt:Number(r.next_at)})).length,activeReservedExecutions:runs.filter(r=>r.interactiveReserve&&(controllers.has(r.ticketId)||background.includes(r))).length,mode:host.config.execution.workers?'existing_session':'legacy_pool'},
  queue:{ready:ready.length,delayed:rows.filter(r=>r.state==='pending'&&Number(r.next_at)>now).length,blocked:rows.filter(r=>r.state==='blocked').length,uncertain:rows.filter(r=>r.state==='uncertain').length}}
}
