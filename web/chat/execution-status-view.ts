import type {TaskStatusProjection} from '../../src/execution-status.ts'

export type StatusState<K extends 'execution'|'effects'|'acceptance'|'delivery'>=TaskStatusProjection[K]['state']|'unknown'
export type StatusView={observedAt:number|null;available:boolean;execution:StatusState<'execution'>;effects:StatusState<'effects'>;receiptCount:number|null;acceptance:StatusState<'acceptance'>;freshness:TaskStatusProjection['acceptance']['freshness'];delivery:StatusState<'delivery'>;counts:TaskStatusProjection['delivery']['counts']|null;scope:TaskStatusProjection['delivery']['scope']|'unknown';hostRecord:boolean}
const object=(value:unknown):Record<string,unknown>|undefined=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:undefined
function statusState<S extends string>(value:unknown,allowed:readonly S[]):S|'unknown'{return typeof value==='string'&&(allowed as readonly string[]).includes(value)?value as S:'unknown'}
const count=(value:unknown):number|null=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null
const buckets=['pending','retry_wait','sending','uncertain','held','dropped','recorded'] as const
function deliveryCounts(value:unknown):TaskStatusProjection['delivery']['counts']|null{
 const raw=object(value),keys=['total',...buckets] as const
 if(!raw||keys.some(key=>count(raw[key])===null))return null
 const counts=Object.fromEntries(keys.map(key=>[key,raw[key]])) as TaskStatusProjection['delivery']['counts']
 const sum=buckets.reduce((total,key)=>total+counts[key],0)
 return Number.isSafeInteger(sum)&&sum===counts.total?counts:null
}
/** Validate claimed evidence; do not derive a replacement backend state from counts. */
function compatibleDelivery(state:StatusState<'delivery'>,counts:TaskStatusProjection['delivery']['counts'],scope:StatusView['scope'],evidence:unknown){
 if(scope==='unknown'||evidence!==(counts.recorded>0?'host_record':'none'))return false
 if(!counts.total)return state==='not_recorded'&&scope==='not_recorded'
 if(scope==='not_recorded'||scope==='mixed'&&counts.total<2)return false
 if(state==='recorded')return counts.recorded===counts.total&&counts.total>0
 if(state==='dropped')return counts.dropped===counts.total
 if(state==='partial')return counts.recorded>0&&counts.recorded<counts.total&&counts.uncertain===0&&counts.sending===0&&counts.held===0
 if(state==='not_recorded'||state==='unknown')return false
 // Never present a lower-priority label that hides a retained unknown outcome.
 if(counts.uncertain>0&&state!=='uncertain')return false
 return counts[state]>0
}
/** Render only the new projection; legacy aggregate state never supplies missing evidence. */
export function readTaskStatus(value:unknown):StatusView{
 const unknown:StatusView={available:false,observedAt:null,execution:'unknown',effects:'unknown',receiptCount:null,acceptance:'unknown',freshness:'unknown',delivery:'unknown',counts:null,scope:'unknown',hostRecord:false}
 const root=object(value)
 if(root?.schema!==1)return unknown
 const observedAt=typeof root.observedAt==='number'&&Number.isFinite(root.observedAt)&&root.observedAt>=0&&!Number.isNaN(new Date(root.observedAt).getTime())?root.observedAt:null
 if(observedAt===null)return unknown
 const execution=object(root.execution),effects=object(root.effects),acceptance=object(root.acceptance),delivery=object(root.delivery)
 const receiptCount=count(effects?.receiptCount),freshness=statusState(acceptance?.freshness,['current','stale','unknown','not_recorded'] as const)
 let acceptanceState:StatusState<'acceptance'>=statusState(acceptance?.state,['not_recorded','pending','running','passed','failed','insufficient','errored','stale'] as const)
 if(freshness==='stale'||freshness!=='current'&&['passed','failed','insufficient','errored'].includes(acceptanceState))acceptanceState='stale'
 let effectState=statusState(effects?.state,['not_recorded','in_progress','recorded','unknown'] as const)
 if(effectState==='recorded'&&(receiptCount===null||receiptCount===0))effectState='unknown'
 let deliveryState:StatusState<'delivery'>=statusState(delivery?.state,['not_recorded','pending','retry_wait','sending','uncertain','held','dropped','recorded','partial'] as const)
 const counts=deliveryCounts(delivery?.counts),scope=statusState(delivery?.scope,['local','external','mixed','not_recorded'] as const)
 const validDelivery=counts!==null&&compatibleDelivery(deliveryState,counts,scope,delivery?.evidence)
 if(!validDelivery)deliveryState='unknown'
 return {available:true,observedAt,execution:statusState(execution?.state,['not_started','queued','running','waiting_input','interrupted','failed','cancelled','finished'] as const),effects:effectState,receiptCount,acceptance:acceptanceState,freshness,delivery:deliveryState,counts:validDelivery?counts:null,scope:validDelivery?scope:'unknown',hostRecord:validDelivery&&delivery?.evidence==='host_record'}
}
