import {z} from 'zod'
import type {Runtime} from './runtime.ts'
import {normalizeUsage,sumUsage,usageFields} from './model-usage.ts'
import type {UsageRecord} from './usage-ledger.ts'
import type {ExecutionCall} from './execution-activity.ts'
import type {UsageSummary} from './usage-contract.ts'

const count=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const time=count.max(8640000000000000)
const purpose=z.enum(['router','worker','subagent','verification','replanning','plan_review','memory','auxiliary','watchdog'])
const counts={calls:count,reportedCalls:count,unknownCalls:count,partialCalls:count,steps:count}
const tokens=z.object(Object.fromEntries(usageFields.map(field=>[field,count.nullable()])) as Record<typeof usageFields[number],z.ZodNullable<typeof count>>)
const group=z.object({purpose,...counts,tokens})
const usageSchema=z.object({since:time.nullable(),...counts,tokens,fieldReported:z.object(Object.fromEntries(usageFields.map(field=>[field,count])) as Record<typeof usageFields[number],typeof count>),groups:z.array(group).max(purpose.options.length),legacyUntrackedCalls:count,watchdogUnavailable:z.boolean().optional()})
const workStates=['starting','running','completed','failed','cancelled','interrupted'] as const
export type ResourceWorkState=typeof workStates[number]
export interface ResourceUsageSnapshot {
 schema:1;observedAt:number;settingsRevision:number;scope:'host';usage:UsageSummary
 context:{retainedActivities:number;withinBudgetActivities:number;exceededActivities:number;unrecognizedActivities:number;lastCheckAt:number|null}
 accounting?:ResourceAccounting
 work:{retainedItems:number;states:Record<ResourceWorkState,number>;unrecognizedStateItems:number;deadlineItems:number;pastDeadlineItems:number;invalidDeadlineItems:number;limits:{maxAgentsPerTicket:number;maxDepth:number;backgroundTimeoutMs:number;maxOutputBytesPerShell:number}}
}
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value)
const integer=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0
const timestamp=(value:unknown):value is number=>integer(value)&&value<=8640000000000000
const MAX_MODEL_GROUPS=20
const label=(value:unknown):string|null=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,99}$/.test(value)?value:null
const callStates=['running','completed','failed','interrupted'] as const
type ModelGroup={backend:string|null;model:string|null;calls:number;usageCalls:number;totalTokens:number|null;bucket:'identified'|'unattributed'|'other'}
interface ResourceAccounting {
 task:{distinct:number;linkedCalls:number;unlinkedCalls:number;linkedTokens:number|null;unlinkedTokens:number|null}
 models:ModelGroup[]
 tools:{retainedCalls:number;states:Record<typeof callStates[number],number>;unknownState:number}
 polling:{observedSources:number;healthy:number;retrying:number;error:number;lastCheckAt:number|null;calls:null}
 lastContextCheck:{basis:'api-wire'|'native-protocol';at:number;measuredBytes:number;reservedBytes:number;hardLimitBytes:number;status:'within_budget'|'exceeded'}|null
 cost:{estimated:null;billed:null;reason:'no_price_or_bill_evidence'}
}
function accountingProjection(host:Runtime,lastContextCheck:ResourceAccounting['lastContextCheck']):ResourceAccounting{
 // Host-only numeric projection. Do not emit task/source IDs, tool names,
 // work contents, inputs, outputs, errors, or hashes of private identifiers.
 const records=host.store.list<UsageRecord>('model-usage')
 const ids=new Set<string>()
 const buckets=new Map<string,{backend:string|null;model:string|null;rows:UsageRecord[];bucket:ModelGroup['bucket']}>()
 const linked:UsageRecord[]=[],unlinked:UsageRecord[]=[]
 const usage=(record:UsageRecord)=>Object.values(record.steps??{}).flatMap(step=>{const value=normalizeUsage(step);return value?[value]:[]})
 const tokenTotal=(rows:UsageRecord[])=>sumUsage(rows.flatMap(usage)).totalTokens
 for(const record of records){
  if(typeof record.ticketId==='string'&&record.ticketId){ids.add(record.ticketId);linked.push(record)}else unlinked.push(record)
  // The metadata reflects the selected backend/model for a host call, not a
  // provider invoice. Multi-attempt and legacy records cannot be attributed.
  const attempts=Object.keys(record.attempts??{})
  const backend=attempts.length===1?label(record.backend):null,model=attempts.length===1?label(record.model):null
  const identified=backend!==null&&model!==null,key=identified?JSON.stringify([backend,model]):'?'
  const row=buckets.get(key)??{backend:identified?backend:null,model:identified?model:null,rows:[],bucket:identified?'identified' as const:'unattributed' as const}
  row.rows.push(record);buckets.set(key,row)
 }
 const identified=[...buckets.values()].filter(row=>row.bucket==='identified').sort((a,b)=>b.rows.length-a.rows.length||(a.backend??'').localeCompare(b.backend??'')||(a.model??'').localeCompare(b.model??''))
 const groupRows=[...identified.slice(0,MAX_MODEL_GROUPS),...(buckets.has('?')?[buckets.get('?')!]:[])]
 if(identified.length>MAX_MODEL_GROUPS)groupRows.push({backend:null,model:null,rows:identified.slice(MAX_MODEL_GROUPS).flatMap(row=>row.rows),bucket:'other'})
 const models=groupRows.map(({backend,model,rows,bucket})=>({backend,model,bucket,calls:rows.length,usageCalls:rows.filter(row=>usage(row).some(step=>usageFields.some(field=>step[field]!==undefined))).length,totalTokens:tokenTotal(rows)}))
 const states={running:0,completed:0,failed:0,interrupted:0}
 const tools={retainedCalls:0,states,unknownState:0}
 for(const call of host.store.list<ExecutionCall>('execution-call')){
  if(call.kind!=='tool')continue
  tools.retainedCalls++
  if(callStates.includes(call.state))states[call.state]++;else tools.unknownState++
 }
 const polling:ResourceAccounting['polling']={observedSources:0,healthy:0,retrying:0,error:0,lastCheckAt:null,calls:null}
 for(const source of host.sources.values()){
  if(!source.config.enabled||!source.config.capabilities.events||!source.poll)continue
  const health=host.store.get<{status:string;at:number}>('source-health',source.config.id)
  if(!health||!timestamp(health.at)||!['ok','retrying','error'].includes(health.status))continue
  polling.observedSources++
  if(health.status==='ok')polling.healthy++;else if(health.status==='retrying')polling.retrying++;else polling.error++
  polling.lastCheckAt=Math.max(polling.lastCheckAt??0,health.at)
 }
 return {task:{distinct:ids.size,linkedCalls:linked.length,unlinkedCalls:unlinked.length,linkedTokens:tokenTotal(linked),unlinkedTokens:tokenTotal(unlinked)},models,tools,polling,lastContextCheck,cost:{estimated:null,billed:null,reason:'no_price_or_bill_evidence'}}
}
/** Validate and whitelist the existing ledger's summary, without repairing or re-accounting its records. */
function publicUsage(value:unknown):UsageSummary{
 const summary=usageSchema.parse(value)
 for(const row of [summary,...summary.groups])if(row.reportedCalls>row.calls||row.unknownCalls!==row.calls-row.reportedCalls||row.partialCalls>row.reportedCalls)throw Error('Usage coverage unavailable')
 if(usageFields.some(field=>summary.fieldReported[field]>summary.steps)||new Set(summary.groups.map(row=>row.purpose)).size!==summary.groups.length)throw Error('Usage coverage unavailable')
 // Never emit an imprecise total even when individual group counters are safe.
 for(const field of ['calls','reportedCalls','unknownCalls','partialCalls','steps'] as const){
  let total=0
  for(const row of summary.groups){if(row[field]>Number.MAX_SAFE_INTEGER-total)throw Error('Usage coverage unavailable');total+=row[field]}
  if(total!==summary[field])throw Error('Usage coverage unavailable')
 }
 return summary
}
/** Pure synchronous projection. Capture one Runtime; never construct accounting or budget owners on read. */
export class ResourceUsage {
 constructor(private readonly host:()=>Runtime,private readonly clock:()=>number=Date.now){}
 snapshot():ResourceUsageSnapshot{
  const host=this.host(),observedAt=time.parse(this.clock()),settingsRevision=count.parse(host.settings.current().revision)
  const usage=publicUsage(host.usage.summary()),contextRows=host.store.list<unknown>('context-budget'),workRows=host.work.list() as unknown[]
  const context:ResourceUsageSnapshot['context']={retainedActivities:contextRows.length,withinBudgetActivities:0,exceededActivities:0,unrecognizedActivities:0,lastCheckAt:null}
  let lastContextCheck:ResourceAccounting['lastContextCheck']=null
  for(const row of contextRows){
   if(!object(row)||typeof row.activity!=='string'||!row.activity||typeof row.phase!=='string'||!row.phase||typeof row.basis!=='string'||!['api-wire','native-protocol'].includes(row.basis)||typeof row.status!=='string'||!['within_budget','exceeded'].includes(row.status)||
    !integer(row.bytes)||!integer(row.maxBytes)||row.maxBytes===0||!integer(row.reservedBytes)||!timestamp(row.at)){
    context.unrecognizedActivities++;continue
   }
   // Subtraction preserves the comparison even if bytes + reservedBytes would overflow a safe integer.
   const within=row.bytes<=row.maxBytes-row.reservedBytes
   if(within!==(row.status==='within_budget')){context.unrecognizedActivities++;continue}
   if(within)context.withinBudgetActivities++;else context.exceededActivities++
   if(context.lastCheckAt===null||row.at>context.lastCheckAt){
    context.lastCheckAt=row.at
    lastContextCheck={basis:row.basis as 'api-wire'|'native-protocol',at:row.at,measuredBytes:row.bytes,reservedBytes:row.reservedBytes,hardLimitBytes:row.maxBytes,status:within?'within_budget':'exceeded'}
   }
  }
  const states=Object.fromEntries(workStates.map(state=>[state,0])) as Record<ResourceWorkState,number>
  const configured=host.config.work,limits={maxAgentsPerTicket:configured.maxAgents,maxDepth:configured.maxDepth,backgroundTimeoutMs:configured.backgroundTimeoutMs,maxOutputBytesPerShell:configured.maxOutputBytes}
  for(const value of Object.values(limits))count.positive().parse(value)
  const work:ResourceUsageSnapshot['work']={retainedItems:workRows.length,states,unrecognizedStateItems:0,deadlineItems:0,pastDeadlineItems:0,invalidDeadlineItems:0,limits}
  for(const row of workRows){
   if(!object(row)||typeof row.kind!=='string'||!['shell','agent'].includes(row.kind)||!workStates.includes(row.state as ResourceWorkState)){work.unrecognizedStateItems++;continue}
   const state=row.state as ResourceWorkState;states[state]++
   if(!['starting','running'].includes(state)||row.deadline===undefined)continue
   if(!timestamp(row.deadline)){work.invalidDeadlineItems++;continue}
   work.deadlineItems++;if(row.deadline<=observedAt)work.pastDeadlineItems++
  }
  return {schema:1,observedAt,settingsRevision,scope:'host',usage,context,work,...(host.sources?{accounting:accountingProjection(host,lastContextCheck)}:{})}
 }
}
