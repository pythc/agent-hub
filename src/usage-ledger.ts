import type {Store} from './store.ts'
import {statSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import type {ExecutionContext} from './execution-activity.ts'
import {normalizeUsage,sumUsage,usageFields,type ModelUsage,type TokenCounts} from './model-usage.ts'
import type {UsagePurpose,UsageSummary,UsageGroup} from './usage-contract.ts'
export type {UsagePurpose,UsageSummary,UsageGroup} from './usage-contract.ts'

export interface UsageRecord extends ExecutionContext {id:string;purpose:UsagePurpose;role:string;state:'running'|'completed'|'failed'|'interrupted';at:number;endedAt?:number;backend?:string;model?:string;steps:Record<string,ModelUsage>;attempts?:Record<string,string>}
export function usagePurpose(role:string,context:ExecutionContext):UsagePurpose{
 const id=context.agentId??''
 return id.startsWith('memory:')?'memory':id.startsWith('goal-verify:')?'verification':id.startsWith('goal-replan:')?id.endsWith(':review')?'plan_review':'replanning':role==='router'?'router':role==='worker'?'worker':role==='auxiliary'?'auxiliary':'subagent'
}
const reported=(r:UsageRecord)=>Object.values(r.steps).some(s=>usageFields.some(field=>s[field]!==undefined))
const partial=(r:UsageRecord)=>reported(r)&&(r.state!=='completed'||Object.values(r.attempts??{}).some(s=>s!=='completed')||Object.values(r.steps).some(s=>s.inputTokens===undefined||s.outputTokens===undefined))
/** Durable accounting is independent of the pruned activity display and native history. No prompt/result content. */
export class UsageLedger {
 constructor(private store:Store,private watchdogPath?:string){for(const r of store.list<UsageRecord>('model-usage'))if(r.state==='running')this.finish(r.id,'interrupted')}
 begin(id:string,role:string,context:ExecutionContext={},purpose=usagePurpose(role,context)){
  this.store.put('model-usage',id,{id,role,purpose,...context,state:'running',at:Date.now(),steps:{}} satisfies UsageRecord)
 }
 update(id:string,metadata:{backend?:string;model?:string}){const r=this.store.get<UsageRecord>('model-usage',id);if(r)this.store.put('model-usage',id,{...r,...metadata})}
 attempt(id:string,attempt:number,state:string){const r=this.store.get<UsageRecord>('model-usage',id);if(r)this.store.put('model-usage',id,{...r,attempts:{...r.attempts,[attempt]:state}})}
 record(id:string,attempt:number,value:unknown){
  const usage=normalizeUsage(value),r=this.store.get<UsageRecord>('model-usage',id);if(!usage||!r?.steps)return // History cleanup can remove detail; never restore it from a late event.
  const key=attempt+':'+usage.id
  if(JSON.stringify(r.steps[key])===JSON.stringify(usage))return
  r.steps[key]=usage;this.store.put('model-usage',id,r)
 }
 finish(id:string,state:Exclude<UsageRecord['state'],'running'>){const r=this.store.get<UsageRecord>('model-usage',id);if(r)this.store.put('model-usage',id,{...r,state,endedAt:Date.now()})}
 summary(sourceId?:string):UsageSummary{
  let extra:UsageRecord[]=[],watchdogUnavailable=false
  // Read only the observer's numeric records. It never opens the host DB, and the
  // host must not finish/interfere with the observer's independently running calls.
  if(this.watchdogPath)try{
   statSync(this.watchdogPath)
   const db=new DatabaseSync(this.watchdogPath,{readOnly:true})
   try{extra=db.prepare("SELECT body FROM records WHERE kind='model-usage'").all().map(row=>({...JSON.parse(String(row.body)),purpose:'watchdog'}))}finally{db.close()}
  }catch(error){watchdogUnavailable=(error as NodeJS.ErrnoException).code!=='ENOENT'}
  const records=[...this.store.list<UsageRecord>('model-usage'),...extra].filter(r=>!sourceId||r.sourceId===sourceId).map(r=>({...r,steps:r.steps??{},purpose:r.purpose??usagePurpose(r.role,r)})),steps=records.flatMap(r=>Object.values(r.steps))
  const group=(purpose:UsagePurpose):UsageGroup=>{const rows=records.filter(r=>r.purpose===purpose),reportedCalls=rows.filter(reported).length;return {purpose,calls:rows.length,reportedCalls,unknownCalls:rows.length-reportedCalls,partialCalls:rows.filter(partial).length,steps:rows.reduce((n,r)=>n+Object.keys(r.steps).length,0),tokens:sumUsage(rows.flatMap(r=>Object.values(r.steps)))}}
  const ids=new Set(records.map(r=>r.id)),legacy=this.store.list<any>('execution-call').filter(r=>r.kind!=='tool'&&(!sourceId||r.sourceId===sourceId)&&!ids.has(r.id))
  return {since:records.length?records.reduce((at,r)=>Math.min(at,r.at),records[0]!.at):null,calls:records.length,reportedCalls:records.filter(reported).length,unknownCalls:records.filter(r=>!reported(r)).length,partialCalls:records.filter(partial).length,steps:steps.length,tokens:sumUsage(steps),fieldReported:Object.fromEntries(usageFields.map(field=>[field,steps.filter(s=>s[field]!==undefined).length])) as UsageSummary['fieldReported'],groups:([...new Set(records.map(r=>r.purpose))]).map(group),legacyUntrackedCalls:legacy.length,...(watchdogUnavailable?{watchdogUnavailable:true}:{})}
 }
}
