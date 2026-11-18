import type {Job,Store} from './store.ts'
import {schedulerInteractiveJob,schedulerRoutingKind} from './scheduler-status.ts'
export interface SchedulerFairness {routing:number;worker:number}
export const schedulerDomain=(job:Job)=>schedulerRoutingKind(job.kind)?'routing' as const:'worker' as const
/** Reorder the existing FIFO only. Counters are advanced by actual admissions, not this preview. */
export function orderSchedulerJobs(store:Store,jobs:Job[],burst:number,fairness:SchedulerFairness):Job[]{
 const control=jobs.filter(j=>['cancel','cleanup'].includes(j.kind)),ordinary=jobs.filter(j=>!['cancel','cleanup'].includes(j.kind))
 const ordered=(domain:'routing'|'worker')=>{
  const queue=ordinary.filter(j=>schedulerDomain(j)===domain),high=queue.filter(j=>schedulerInteractiveJob(store,j)),low=queue.filter(j=>!schedulerInteractiveJob(store,j)),out:Job[]=[]
  const allowance=Math.max(0,burst-fairness[domain])
  // A blocked ordinary job must not reset debt: scan every ordinary candidate
  // before admitting another burst once the current allowance is exhausted.
  out.push(...high.splice(0,allowance),...low,...high)
  return out
 }
 const routing=ordered('routing'),worker=ordered('worker')
 return [...control,...ordinary.map(j=>schedulerDomain(j)==='routing'?routing.shift()!:worker.shift()!)]
}
export interface SchedulerJobObservation {jobId:string;ticketId?:string;triggerId?:string;enqueuedAt:number|null;eligibleAt?:number;startedAt?:number;interactive?:boolean;reason?:string;reasonAt?:number}
export function observeSchedulerJob(store:Store,job:Job,reason:string,now=Date.now()){
 const previous=store.get<SchedulerJobObservation>('scheduler-job',job.id),payload=job.payload as {ticketId?:string;triggerId?:string}|undefined
 const base=previous??{jobId:job.id,ticketId:payload?.ticketId,triggerId:payload?.triggerId,enqueuedAt:null}
 const ready=['eligible','resource_quota','routing_capacity','background_capacity','worker_capacity','worker_busy','discussion_serialization','task_running','started'].includes(reason)
 const eligibleAt=base.eligibleAt??(ready?now:undefined),interactive=base.interactive??schedulerInteractiveJob(store,job)
 if(previous?.reason===reason&&previous.eligibleAt!==undefined&&previous.interactive!==undefined)return
 store.put('scheduler-job',job.id,{...base,eligibleAt,interactive,reason,reasonAt:now,...(reason==='started'&&base.startedAt===undefined?{startedAt:now}:{})})
}
export function recordSchedulerAdmission(store:Store,job:Job,burst:number,now=Date.now()){
 const previous=store.get<SchedulerFairness>('scheduler-fairness','current')??{routing:0,worker:0},domain=schedulerDomain(job)
 store.put('scheduler-fairness','current',{...previous,[domain]:schedulerInteractiveJob(store,job)?Math.min(burst,previous[domain]+1):0})
 observeSchedulerJob(store,job,'started',now)
}
