import type {Store} from './store.ts'
import type {UsageRecord} from './usage-ledger.ts'
import type {RouterGoal} from './router-goals.ts'

/** Cached input is included in input; reasoning is included in output. Rates are the operator's estimates. */
export function projectBudget(store:Store,g:RouterGoal,now:number){
 const p=g.project,policy=p?.policy.budget
 if(!p||!policy)return
 const end=p.review?.state==='pending'?p.review.at:p.review?.state==='approved'?p.review.decidedAt??now:now
 const elapsedMs=Math.max(0,end-g.at-p.reviewWaitMs)
 const remainingMs=policy.maxMinutes===undefined?undefined:policy.maxMinutes*60000-elapsedMs
 const price=policy.cost
 let estimatedUsd=0,unknownCalls=0
 if(price){
  for(const row of store.list<UsageRecord>('model-usage')){
   if(!(row.ticketId?g.taskIds.includes(row.ticketId):!!row.triggerId&&p.triggerIds.includes(row.triggerId)))continue
   const steps=Object.entries(row.steps)
   let unknown=Object.entries(row.attempts??{}).some(([attempt,state])=>state!=='running'&&!steps.some(([key])=>key.startsWith(attempt+':')))
   if(row.state!=='running'&&!steps.length)unknown=true
   for(const [,s] of steps){
    if((s.inputTokens===undefined&&price.inputUsdPerMillion>0||s.outputTokens===undefined&&price.outputUsdPerMillion>0)&&row.state!=='running')unknown=true
    estimatedUsd+=((s.inputTokens??0)*price.inputUsdPerMillion+(s.outputTokens??0)*price.outputUsdPerMillion)/1e6
   }
   if(unknown)unknownCalls++
  }
 }
 const reason=remainingMs!==undefined&&remainingMs<=0?'项目时间预算已用完':price&&estimatedUsd>=price.maxUsd?'项目估算费用已达到预算':price&&unknownCalls?'模型用量回执不完整，无法核算剩余费用预算':undefined
 return {elapsedMs,remainingMs,estimatedUsd:price?estimatedUsd:undefined,unknownCalls,reason,policy}
}
