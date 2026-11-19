import {workflowEffectState} from './effect-receipt.ts'
import {z} from 'zod'
import type {Runtime} from './runtime.ts'
import type {ScopeContext,TaskOwnership} from './router-scope.ts'
import {assertNoMemorySecret} from './memory-policy.ts'
import {stableDigest} from './sources.ts'

const id=z.string().min(1).max(300),at=z.number().int().nonnegative().max(8640000000000000),choice=z.object({id,name:id}).strict()
const action=z.object({id,ticketId:id,originTriggerId:id,notificationTriggerId:id,sourceId:id,
 target:z.object({key:id,entryId:id,teamId:id,issueId:id}).strict(),entryRevision:z.number().int().nonnegative(),ownerEpoch:z.number().int().nonnegative(),dataRevision:z.number().int().positive(),
 effectReceiptVersion:z.unknown().optional(),effectReceipt:z.unknown().optional(),
 planDigest:z.string().regex(/^[a-f0-9]{64}$/).optional(),
 view:z.object({account:id,issue:id,label:id,revision:id,current:choice,states:z.array(choice).max(1000)}).strict(),next:choice,
 state:z.enum(['pending','applying','applied','declined','stale','uncertain','observed']),at,finishedAt:at.optional(),
 receipt:z.object({issue:id,state:id,revision:id}).strict().optional(),
 decision:z.object({kind:z.enum(['approve','decline']),at,via:z.enum(['operator','conversation']),actorId:id.optional(),triggerId:id.optional()}).strict().optional()
}).strict()
export interface DecisionOperationView {kind:'workflow_status';label:string;from:string;to:string;proposedAt:number;confirmation:'not_recorded'|'approved'|'declined';confirmationAt?:number;execution:'not_recorded'|'in_progress'|'applied_readback'|'observed_only'|'unknown'|'not_applied';finishedAt?:number}
/** Concrete workflow proposal receipts, not inferred links to free-text journal items.
 * Revalidate both task and resource audience before exposing even a state name. */
export function taskDecisionOperations(h:Runtime,taskId:string,c:ScopeContext,owner:TaskOwnership,anchors:Set<string>):{items:DecisionOperationView[];more:boolean}{
 const values:DecisionOperationView[]=[]
 for(const row of h.store.db.prepare("SELECT id FROM records WHERE kind='workflow-action' AND json_extract(body,'$.ticketId')=? ORDER BY rowid").all(taskId))try{
  const key=String(row.id),raw=h.store.get('workflow-action',key)
  if(!raw||h.memory.cleanup.blocked('workflow-action',key,raw))continue
  const v=action.parse(raw)
  if(v.finishedAt!==undefined&&v.finishedAt<v.at)continue
  if(v.id!==key||v.ticketId!==taskId||!anchors.has(v.originTriggerId)||v.ownerEpoch!==owner.ownerEpoch||v.dataRevision!==(owner.dataRevision??1))continue
  const source=h.config.sources.find(s=>s.id===v.sourceId),entry=h.scopes.binding(v.target.entryId),scope=h.scopes.scope(owner.scopeId)
  if(!source?.enabled||!source.capabilities.resources||!source.capabilities.replies||!scope.sourceIds.includes(source.id)||!h.sourceRegistry.allowsScope(source,v.target.teamId)||entry.privateActor||entry.id!==c.route.entryId||entry.revision!==v.entryRevision)continue
  h.scopes.checkTaskEntry(owner,entry.id,'context');h.scopes.checkTaskEntry(owner,entry.id,'result')
  if(!Array.isArray(source.options?.statusTargets)||!source.options.statusTargets.some(target=>stableDigest(target)===stableDigest(v.target)))continue
  const origin=h.store.triggers.get(v.originTriggerId)
  if(!origin||h.memory.cleanup.blocked('trigger',origin.id,origin))continue
  h.scopes.assertTrigger(origin);h.routerIngress.authority(origin.id)
  const route=h.scopes.context(origin,c.route.discussion)
  if(!route||route.actor!==c.actor||route.route.entryId!==c.route.entryId||route.route.scopeId!==c.route.scopeId)continue
  for(const text of [v.view.label,v.view.current.name,v.next.name])assertNoMemorySecret(text)
  if(!v.view.states.some(s=>s.id===v.next.id&&s.name===v.next.name)||v.next.id===v.view.current.id)continue
  let confirmation:DecisionOperationView['confirmation']='not_recorded'
  if(v.decision){
   if(v.decision.at<v.at||v.finishedAt!==undefined&&v.finishedAt<v.decision.at)continue
   if(v.decision.via==='conversation'){
    const t=v.decision.triggerId&&h.store.triggers.get(v.decision.triggerId)
    if(!t||!t.human||t.actor.id!==v.decision.actorId||h.memory.cleanup.blocked('trigger',t.id,t))continue
    h.scopes.assertTrigger(t);if(h.routerIngress.authority(t.id).strength!=='explicit')continue
    const r=h.scopes.context(t,t.source+':'+t.threads[0]?.id)
    if(!r||r.route.entryId!==c.route.entryId||r.route.scopeId!==c.route.scopeId||!h.scopes.canManage(r))continue
    const anchor=h.store.triggers.get(v.notificationTriggerId)
    if(!anchor?.channel||h.memory.cleanup.blocked('trigger',anchor.id,anchor)||anchor.source!==t.source||anchor.channel.thread!==t.channel?.thread)continue
    h.scopes.assertTrigger(anchor)
    const prefix=h.sources.get(t.source)?.verificationCommand,text=prefix&&t.text.trim().startsWith(prefix+' ')?t.text.trim().slice(prefix.length).trim():t.text.trim(),match=/^(批准|拒绝|approve|decline) ([a-f0-9]{16})$/i.exec(text)
    if(!match||match[2]!==v.id.slice(0,16)||(/^(批准|approve)$/i.test(match[1]!)?'approve':'decline')!==v.decision.kind)continue
   }else if(!v.decision.actorId||v.decision.triggerId)continue
   confirmation=v.decision.kind==='approve'?'approved':'declined'
  }
  const state=workflowEffectState(v as Parameters<typeof workflowEffectState>[0])
  const readback=v.receipt?.issue===v.view.issue&&v.receipt.state===v.next.id&&v.finishedAt!==undefined
  // observed is only readback: the writer is unknown. A decision alone is never execution.
  const execution:DecisionOperationView['execution']=state==='applied'?(readback&&confirmation==='approved'?'applied_readback':'unknown'):state==='observed'?(readback?'observed_only':'unknown'):state==='uncertain'?'unknown':state==='applying'?'in_progress':state==='stale'||state==='declined'?'not_applied':'not_recorded'
  values.push({kind:'workflow_status',label:v.view.label,from:v.view.current.name,to:v.next.name,proposedAt:v.at,confirmation,...(confirmation!=='not_recorded'?{confirmationAt:v.decision!.at}:{}),execution,...(v.finishedAt!==undefined?{finishedAt:v.finishedAt}:{})})
 }catch{/* Unreadable or inconsistent evidence is not repaired or summarized. */}
 values.sort((a,b)=>b.proposedAt-a.proposedAt)
 return{items:values.slice(0,20),more:values.length>20}
}
