import type {ScheduledRun} from './router-proactive.ts'
import type {Delivery} from './store.ts'

const time=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null
/** Read-only host observations; these are not reservations or recipient receipts. */
export function schedulePlanState(plan:{active:boolean;nextAt?:number;revision:number},now:number){
 const nextDueAt=plan.active?time(plan.nextAt):null
 return {schema:1 as const,state:!plan.active?'paused' as const:nextDueAt===null?'expired' as const:nextDueAt<=now?'due' as const:'scheduled' as const,
  revision:plan.revision,nextDueAt,misfire:'coalesce_latest' as const,overlap:'skip' as const}
}
export function scheduledRunLifecycle(run:ScheduledRun,messages:Pick<Delivery,'status'>[]){
 const counts:Record<string,number>=Object.create(null)
 for(const message of messages)counts[message.status]=(counts[message.status]??0)+1
 const recognized=new Set(['pending','sending','sent','failed','uncertain','held','dropped'])
 const unknown=Object.keys(counts).some(status=>!recognized.has(status))||!!counts.uncertain
 const delivery=unknown?'unknown':counts.failed?'failed':counts.dropped?'dropped':counts.held?'held':counts.sending?'sending':counts.pending?'pending':counts.sent?'sent':'none'
 const firstDueAt=time(run.firstDueAt),dueAt=time(run.scheduledAt)
 return {schema:1 as const,
  plan:{id:run.scheduleId,revision:run.revision},
  trigger:{kind:run.triggerKind==='manual'||run.triggerKind==='scheduled'?run.triggerKind:'unknown',dueAt,observedAt:time(run.createdAt),firstDueAt,
   backlog:firstDueAt===null||dueAt===null||firstDueAt>dueAt?'unknown':firstDueAt<dueAt?'coalesced':'single',misfire:'coalesce_latest' as const},
  execution:{state:run.state,queuedAt:time(run.queuedAt),startedAt:time(run.startedAt),finishedAt:time(run.finishedAt)},
  delivery:{state:delivery,messages:messages.length,recipientReadback:'not_observed' as const}}
}
