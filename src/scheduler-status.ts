import {stableDigest} from './sources.ts'
import type {SchedulerJobObservation} from './scheduler-order.ts'
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

export interface SchedulerWaitSample {samples:number;p50Ms:number|null;p95Ms:number|null;maxMs:number|null}
export interface SchedulerAdmissionStatus {schema:1;interactiveBurst:number;reasons:{code:string;count:number}[];resources:{kind:string;ref:string;limit:number|null;used:number;reserved:number;available:number|null}[];browser:ReturnType<Runtime['browser']['browserCapacity']>;waits:{windowMs:number;interactive:SchedulerWaitSample;background:SchedulerWaitSample;unknown:number}}
export interface SchedulerStatus {
 admission?:SchedulerAdmissionStatus
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
 return {schema:1,observedAt:now,paused:host.isPaused,admission:schedulerAdmissionStatus(host,rows,now),
  occupancy:{jobs:runningKeys.length,routingJobs,workerJobs:runningKeys.length-routingJobs,controllers:controllerKeys.length,backgroundReservations:background.length,activeManagedWork:host.work.list().filter(w=>['starting','running'].includes(w.state)).length},
  workers:{configured:profiles.length,enabled:enabled.length,paused:profiles.filter(w=>w.state==='paused').length,retiring:profiles.filter(w=>w.state==='retiring').length,idleEnabled:enabled.filter(w=>!busy.has(w.id)).length},
  routing:{countedLimit:4,admittedButWorkerCountedJobs:rows.filter(r=>runningIds.has(String(r.id))&&schedulerRoutingKind(String(r.kind))&&!schedulerRoutingKey(String(r.id))).length},
  interactive:{additionalLimit:1,eligibleQueued:ready.filter(r=>schedulerFollowupSlot(host,{id:String(r.id),kind:String(r.kind),payload:JSON.parse(String(r.payload)),state:'pending',attempts:0,nextAt:Number(r.next_at)})).length,activeReservedExecutions:runs.filter(r=>r.interactiveReserve&&(controllers.has(r.ticketId)||background.includes(r))).length,mode:host.config.execution.workers?'existing_session':'legacy_pool'},
  queue:{ready:ready.length,delayed:rows.filter(r=>r.state==='pending'&&Number(r.next_at)>now).length,blocked:rows.filter(r=>r.state==='blocked').length,uncertain:rows.filter(r=>r.state==='uncertain').length}}
}

function schedulerAdmissionStatus(host:Runtime,rows:Record<string,unknown>[],now:number):SchedulerAdmissionStatus{
 const counts=new Map<string,number>()
 for(const r of rows){if(r.state==='running')continue;let reason:string
  try{reason=host.schedulerDecision({id:String(r.id),kind:String(r.kind),state:String(r.state),payload:JSON.parse(String(r.payload)),attempts:0,nextAt:Number(r.next_at)}).reason}catch{reason='context_unavailable'}
  counts.set(reason,(counts.get(reason)??0)+1)
 }
 const resources=new Map<string,{kind:string;ref:string;limit:number|null;used:number;reserved:number;available:number|null}>()
 for(const result of host.schedulerResourceSnapshot())for(const [kind,d] of Object.entries(result.dimensions)){if(!d)continue;resources.set(kind+':'+d.key,{kind,ref:schedulerResourceRef(kind,d.key),limit:d.limit,used:d.used,reserved:d.reserved,available:d.available})}
 const windowMs=3600000,observations=host.store.list<SchedulerJobObservation>('scheduler-job').filter(o=>o.startedAt!==undefined&&o.startedAt<=now&&o.startedAt>=now-windowMs)
 const summary=(interactive:boolean):SchedulerWaitSample=>{
  const waits=observations.filter(o=>o.interactive===interactive&&o.enqueuedAt!==null&&Number.isFinite(o.enqueuedAt)&&o.enqueuedAt!<=o.startedAt!).map(o=>o.startedAt!-o.enqueuedAt!).sort((a,b)=>a-b)
  const percentile=(n:number)=>waits.length?waits[Math.ceil(waits.length*n)-1]!:null
  return {samples:waits.length,p50Ms:percentile(.5),p95Ms:percentile(.95),maxMs:waits.at(-1)??null}
 }
 return {schema:1,interactiveBurst:host.config.scheduler.interactiveBurst,reasons:[...counts].map(([code,count])=>({code,count})),resources:[...resources.values()],browser:host.browser.browserCapacity(),waits:{windowMs,interactive:summary(true),background:summary(false),unknown:observations.filter(o=>o.enqueuedAt===null).length}}
}

export const schedulerResourceRef=(kind:string,key:string)=>'resource-'+stableDigest([kind,key]).slice(0,12)
export interface TaskQueueSummary {schema:1;reason:string;waitMs:number|null;resources:{kind:string;ref:string;limit:number|null;used:number;reserved:number;available:number|null;blocker:'limit_reached'|'identity_unknown'|null}[]}
export function taskQueueSummary(host:Runtime,ticketId:string,now=Date.now()):TaskQueueSummary|undefined{
 try{return host.scopes.readOnly(()=>host.memory.readOnly(()=>{
  const row=host.store.db.prepare("SELECT * FROM jobs WHERE json_extract(payload,'$.ticketId')=? AND state IN ('pending','blocked','uncertain') ORDER BY rowid LIMIT 1").get(ticketId)
  if(!row)return
  const job:Job={id:String(row.id),kind:String(row.kind),state:String(row.state),payload:JSON.parse(String(row.payload)),attempts:Number(row.attempts),nextAt:Number(row.next_at)},decision=host.schedulerDecision(job)
  const observation=host.store.get<SchedulerJobObservation>('scheduler-job',job.id),enqueued=observation?.enqueuedAt
  const quota=host.schedulerQuota(ticketId)
  return {schema:1 as const,reason:decision.reason,waitMs:typeof enqueued==='number'&&Number.isSafeInteger(enqueued)&&enqueued>=0&&enqueued<=now?now-enqueued:null,resources:quota?Object.entries(quota.dimensions).flatMap(([kind,d])=>d?[{kind,ref:schedulerResourceRef(kind,d.key),limit:d.limit,used:d.used,reserved:d.reserved,available:d.available,blocker:quota.blockers.find(b=>b.dimension===kind)?.code??null}]:[]):[]}
 }))}catch{return undefined}
}
