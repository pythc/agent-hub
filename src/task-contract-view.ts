import {z} from 'zod'
import type {Runtime} from './runtime.ts'
import type {RouterGoal} from './router-goals.ts'
import type {ReplanRound} from './goal-replanning.ts'
import type {RouterRoute,ScopeContext} from './router-scope.ts'
import type {ContextManifest} from './router-memory.ts'
import type {TaskContinuation} from './task-context.ts'
import {taskView} from './task-context.ts'
import {criterionSchema,goalDetailsSchema} from './goal-contract.ts'
import {stableDigest} from './sources.ts'

export interface TaskContractViewV1 {
 schema:1;readOnly:true;observedAt:number;subject:{kind:'task';id:string}
 availability:'available'|'not_captured'|'unavailable'
 contentSource:'router_saved_goal'|'not_captured'
 basis:{contract:{kind:'goal_contract'|'mandate';digest:string}|null;goalId:string|null;goalRevision:number|null;planRevision:number|null;assignmentId:string|null;ownerEpoch:number|null;dataRevision:number|null;bindingRevision:number|null}
 details?:{nonGoals:string[]|null;inputs:string[]|null;deadline:string|null}
 lineage?:{state:'current'|'replaced';previousState:'none'|'available'|'unavailable';previous:{objective:string;criteria:{id:string;description:string}[];details?:TaskContractViewV1['details']|null;budget?:TaskContractViewV1['budget']}|null}
 objective:string|null;scope:null
 criteria:{id:string;description:string}[]
 deliverables:{files:string[];documents:string[]}
 budget:{scope:'code_project';basis:'configured_estimate';maxMinutes:number|null;maxUsd:number|null}|null
}
const version=(value:unknown):number|null=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:null
const positive=(value:unknown):number|null=>typeof value==='number'&&Number.isFinite(value)&&value>0?value:null
const objective=z.string().min(1).max(16000),criteria=z.array(criterionSchema).min(1).max(50)
function empty(id:string,now:number):TaskContractViewV1{
 return {schema:1,readOnly:true,observedAt:now,subject:{kind:'task',id},availability:'unavailable',contentSource:'not_captured',basis:{contract:null,goalId:null,goalRevision:null,planRevision:null,assignmentId:null,ownerEpoch:null,dataRevision:null,bindingRevision:null},objective:null,scope:null,criteria:[],deliverables:{files:[],documents:[]},budget:null}
}
/** Use a retained route; observation must never establish an entry, identity or authorization. */
function context(host:Runtime,triggerId:string,discussion:string):ScopeContext{
 const trigger=host.store.triggers.get(triggerId),route=host.store.get<RouterRoute>('router-route',triggerId)
 if(!trigger||!route||route.discussion!==discussion||host.memory.cleanup.blocked('trigger',triggerId,trigger))throw Error('Unavailable')
 host.scopes.assertTrigger(trigger)
 const binding=host.scopes.binding(route.entryId)
 if(binding.privateActor||binding.revision!==route.bindingRevision||route.epoch!==host.scopes.epoch(route.tenantId))throw Error('Unavailable')
 const current=host.scopes.context(trigger,discussion)
 if(!current)throw Error('Unavailable')
 host.scopes.assertCurrent(current)
 return current
}
function reviewedPlanVersion(host:Runtime,goal:RouterGoal):number|null{
 const revision=version(goal.planRevision)
 if(revision===null||revision===0)return revision
 const rounds=host.store.list<ReplanRound>('goal-replan').filter(r=>r.goalId===goal.id&&r.state==='applied'&&r.review?.approved===true&&r.proposal&&version(r.snapshot?.planRevision)===revision-1&&stableDigest(r.snapshot.contract)===stableDigest(goal.contract))
 if(rounds.length!==1||!(rounds[0]!.contextIds??[]).every(id=>host.continuity.validContext(id)))return null
 return revision
}
/** Existing records remain the only authority. No scope text is classified or interpreted as a new contract. */
export function taskContractView(host:Runtime,ticketId:string,now=Date.now()):TaskContractViewV1{
 if(version(now)===null||now>8640000000000000)throw Error('task_contract_view_invalid')
 const unavailable=empty(ticketId,now)
 try{return host.scopes.readOnly(()=>host.memory.readOnly(()=>{
  const raw=host.store.tickets.get(ticketId)
  if(!raw||host.memory.cleanup.blocked('ticket',ticketId,raw))return unavailable
  const continuation=host.store.get<TaskContinuation>('task-continuation',ticketId),ticket=taskView(host.store,raw)
  const owner=host.scopes.ownership(ticketId)
  if(!owner||!host.scopes.taskRunnable(ticketId))return unavailable
  const origin=host.scopes.binding(owner.originEntry)
  if(origin.privateActor||owner.requiredSourceIds.some(id=>!host.config.sources.find(s=>s.id===id)?.enabled))return unavailable
  host.scopes.checkTaskEntry(owner,origin.id,'context')
  const authority=host.taskAuthority(ticketId),parent=authority?.parentTrigger??continuation?.triggerId??ticket.origin.triggerId
  const trigger=host.store.triggers.get(parent)
  if(!trigger)return unavailable
  const discussion=authority?.discussion??continuation?.discussion??trigger.source+':'+trigger.threads[0]?.id
  const current=context(host,parent,discussion)
  host.scopes.checkTask(ticketId,current)
  host.routerIngress.authority(parent,discussion)
  const saved=host.store.get<{manifest:ContextManifest}>('task-context',ticketId)
  if(saved)host.memory.validate(saved.manifest)
  const result=empty(ticketId,now)
  result.availability='not_captured'
  result.basis={...result.basis,assignmentId:ticket.assignments.at(-1)?.id??null,ownerEpoch:version(owner.ownerEpoch),dataRevision:version(owner.dataRevision),bindingRevision:version(host.scopes.binding(current.route.entryId).revision)}
  // A fresh continuation quarantines old text. Do not return the original mandate hash or a formerly associated goal.
  if(continuation)return result
  const goals=host.store.list<RouterGoal>('router-goal').filter(g=>g.taskIds?.includes(ticketId))
  if(goals.length>1)return unavailable
  const goal=goals[0]
  if(!goal){result.basis.contract={kind:'mandate',digest:stableDigest(ticket.mandate)};return result}
  if(host.memory.cleanup.blocked('router-goal',goal.id,goal)||!goal.contract)return unavailable
  const original=goal.contract,originalTrigger=host.store.triggers.get(original.triggerId)
  if(!originalTrigger||stableDigest(originalTrigger)!==original.triggerHash)return unavailable
  if(stableDigest(host.routerIngress.authority(original.triggerId))!==stableDigest(original.mandate))return unavailable
  const goalContext=context(host,goal.triggerId,goal.discussion)
  if(goal.entryId!==goalContext.route.entryId||goal.bindingRevision!==goalContext.route.bindingRevision||!host.goals.list(goalContext).some(g=>g.id===goal.id&&g.contract))return unavailable
  if(goal.scopeId!==owner.scopeId||goalContext.route.routerId!==owner.routerId)return unavailable
  const creation=host.store.get<{goalId:string;result:RouterGoal}>('goal-receipt',goal.id.startsWith('goal-')?goal.id.slice(5):'')
  if(creation?.goalId!==goal.id||creation.result?.id!==goal.id||stableDigest(creation.result.contract)!==stableDigest(original))return unavailable
  if(stableDigest({objective:goal.objective,criteria:goal.criteria})!==stableDigest({objective:original.objective,criteria:original.criteria}))return unavailable
  result.basis={...result.basis,contract:{kind:'goal_contract',digest:stableDigest(original)},goalId:goal.id,goalRevision:version(goal.revision),planRevision:reviewedPlanVersion(host,goal)}
  // A legacy/non-managed goal has no structured managed contract view in this slice.
  if(!goal.managed)return result
  const retainedCriteria=criteria.parse(original.criteria),retainedObjective=objective.parse(original.objective)
  result.availability='available';result.contentSource='router_saved_goal';result.objective=retainedObjective
  if(original.details){
   const details=goalDetailsSchema.parse(original.details)
   if(!originalTrigger.human||[...(details.nonGoals??[]),...(details.inputs??[]),...(details.deadline?[details.deadline]:[])].some(text=>!originalTrigger.text.includes(text)))return unavailable
   result.details={nonGoals:details.nonGoals??null,inputs:details.inputs??null,deadline:details.deadline??null}
  }
  if(goal.supersedes||goal.supersededBy){
   result.lineage={state:goal.supersededBy?'replaced':'current',previousState:goal.supersedes?'unavailable':'none',previous:null}
   // Historical text is a separately authorized observation, never new execution authority.
   if(goal.supersedes&&creation.result.supersedes===goal.supersedes){
    try{
     const previous=host.goals.list(goalContext).find(g=>g.id===goal.supersedes)
     if(!previous?.contract||previous.supersededBy!==goal.id||previous.state!=='cancelled'||previous.scopeId!==goal.scopeId||previous.entryId!==goal.entryId||previous.actor!==goal.actor)throw Error('Unavailable')
     const pc=previous.contract,pt=host.store.triggers.get(pc.triggerId)
     if(!pt||stableDigest(pt)!==pc.triggerHash||stableDigest(host.routerIngress.authority(pc.triggerId))!==stableDigest(pc.mandate))throw Error('Unavailable')
     context(host,previous.triggerId,previous.discussion)
     const receipt=host.store.get<{goalId:string;result:RouterGoal}>('goal-receipt',previous.id.startsWith('goal-')?previous.id.slice(5):'')
     if(receipt?.goalId!==previous.id||receipt.result?.id!==previous.id||stableDigest(receipt.result.contract)!==stableDigest(pc)||stableDigest({objective:previous.objective,criteria:previous.criteria})!==stableDigest({objective:pc.objective,criteria:pc.criteria}))throw Error('Unavailable')
     result.lineage.previous={objective:objective.parse(pc.objective),criteria:criteria.parse(pc.criteria).map(c=>({id:c.id,description:c.description}))}
     const pd=pc.details?goalDetailsSchema.parse(pc.details):undefined
     if(pd&&(!pt.human||[...(pd.nonGoals??[]),...(pd.inputs??[]),...(pd.deadline?[pd.deadline]:[])].some(text=>!pt.text.includes(text))))throw Error('Unavailable')
     result.lineage.previous.details=pd?{nonGoals:pd.nonGoals??null,inputs:pd.inputs??null,deadline:pd.deadline??null}:null
     const pb=previous.project?.policy.budget
     result.lineage.previous.budget=null
     if(pb&&receipt.result.project&&stableDigest(pb)===stableDigest(receipt.result.project.policy.budget)){
      const maxMinutes=positive(pb.maxMinutes),maxUsd=positive(pb.cost?.maxUsd)
      if(maxMinutes!==null||maxUsd!==null)result.lineage.previous.budget={scope:'code_project',basis:'configured_estimate',maxMinutes,maxUsd}
     }
     result.lineage.previousState='available'
    }catch{result.lineage.previous=null}
   }
  }
  result.criteria=retainedCriteria.map(c=>({id:c.id,description:c.description}))
  result.deliverables={files:[...new Set(retainedCriteria.flatMap(c=>c.files))],documents:[...new Set(retainedCriteria.flatMap(c=>c.documents))]}
  const budget=goal.project?.policy.budget
  if(budget&&creation.result.project&&stableDigest(budget)===stableDigest(creation.result.project.policy.budget)){
   const maxMinutes=positive(budget.maxMinutes),maxUsd=positive(budget.cost?.maxUsd)
   if(maxMinutes!==null||maxUsd!==null)result.budget={scope:'code_project',basis:'configured_estimate',maxMinutes,maxUsd}
  }
  return result
 }))}catch{return unavailable}
}
