import type {Runtime} from './runtime.ts'
import type {Approval} from './approvals.ts'
import type {Ticket} from './vendor/dsh-core/index.ts'
import type {ContextManifest} from './router-memory.ts'
import type {RouterGoal} from './router-goals.ts'
import type {WorkflowAction} from './workflow-actions.ts'
import type {Run} from './store.ts'
import {makePolicy} from './policy.ts'
import {stableDigest} from './sources.ts'
import {taskView} from './task-context.ts'

export type AttentionKind='task_question'|'native_question'|'native_approval'|'workflow_review'|'project_review'|'effect_unknown'|'open_work'
export type AttentionState='needs_reply'|'waiting_permission'|'needs_review'|'outcome_unknown'|'expired'|'unavailable'|'stale'|'in_progress'
export interface OperatorAttentionItem {
 id:string;kind:AttentionKind;state:AttentionState
 taskRef?:{id:string;assignmentId?:string}
 read?:boolean;sourceLabel:string;createdAt:number|null;expiresAt:number|null;observed:string
 /** Navigation descriptors only. These are never permission or mutation tokens. */
 next:{kind:'task'|'records'|'workflow'|'project_review';id:string}
}
export interface OperatorAttentionSnapshot {
 schema:1;readOnly:true;observedAt:number;total:number;offset:number;limit:number;more:boolean;unread?:number;items:OperatorAttentionItem[]
}
const timestamp=(v:unknown):number|null=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0&&v<=8.64e15?v:null
const labels:Record<string,string>={local:'Local operator',feishu:'Feishu',slack:'Slack',wecom:'WeCom',github:'GitHub',webhook:'HTTP events',delegation:'Delegated team'}
const supportedNative=new Set(['item/commandExecution/requestApproval','item/fileChange/requestApproval','item/permissions/requestApproval','item/tool/requestUserInput'])
function sourceLabel(host:Runtime,sourceId:string){return labels[host.config.sources.find(s=>s.id===sourceId)?.kind??'']??'Connection'}
function routeVisible(host:Runtime,triggerId:string,discussion:string){
 const trigger=host.store.triggers.get(triggerId)
 if(!trigger)return false
 host.scopes.assertTrigger(trigger)
 if(host.scopes.enabled()){
  const route=host.store.get<import('./router-scope.ts').RouterRoute>('router-route',triggerId)
  if(!route||route.discussion!==discussion)return false
  const entry=host.scopes.binding(route.entryId)
  if(entry.privateActor||entry.revision!==route.bindingRevision||route.epoch!==host.scopes.epoch(entry.tenantId))return false
  const context=host.scopes.context(trigger,discussion)
  if(!context)return false
  host.scopes.assertCurrent(context)
 }
 return true
}
function taskVisible(host:Runtime,ticket:Ticket){
 try{
  if(host.memory.cleanup.blocked('ticket',ticket.id,ticket))return false
  const source=host.config.sources.find(s=>s.id===ticket.mandate.actor.source)
  if(!source?.enabled||!makePolicy(host.config,()=>host.isPaused,host.sourceRegistry).revalidate(ticket.mandate))return false
  if(!host.scopes.taskRunnable(ticket.id))return false
  const owner=host.scopes.ownership(ticket.id)
  if(host.scopes.enabled()){
   if(!owner)return false
   const entry=host.scopes.binding(owner.originEntry)
   if(entry.privateActor)return false
   host.scopes.checkTaskEntry(owner,entry.id,'context')
   if(owner.requiredSourceIds.some(id=>!host.config.sources.find(s=>s.id===id)?.enabled))return false
  }
  const saved=host.store.get<{manifest:ContextManifest}>('task-context',ticket.id)
  if(saved)host.memory.validate(saved.manifest)
  const authority=host.taskAuthority(ticket.id),parent=authority?.parentTrigger??ticket.origin.triggerId
  const trigger=host.store.triggers.get(parent)
  const discussion=authority?.discussion??trigger?.source+':'+trigger?.threads[0]?.id
  if(!trigger||!routeVisible(host,parent,discussion))return false
  if(host.scopes.enabled()){
   const context=host.scopes.context(trigger,discussion)
   if(!context)return false
   host.scopes.checkTask(ticket.id,context)
  }
  // A stop withdraws execution, but does not erase an already-unknown effect.
  if(!host.store.get('router-cancelled',parent)&&authority?.parentTrigger)host.routerIngress.authority(parent,authority.discussion)
  return true
 }catch{return false}
}
function currentTask(host:Runtime,ticket:Ticket){
 const parent=host.taskAuthority(ticket.id)?.parentTrigger??ticket.origin.triggerId
 return !ticket.ended&&!host.store.get('router-cancelled',parent)
}
function approvalState(host:Runtime,ticket:Ticket,item:Approval,now:number,expiry:number|null):AttentionState {
 if(item.status==='expired'||expiry!==null&&expiry<=now)return 'expired'
 const run=host.store.get<Run>('run',ticket.id),assignment=ticket.assignments.at(-1),params=item.native?.params
 if(!supportedNative.has(item.native?.method)||!host.approvals.hasLiveRequest(item.id,now)||!run||assignment?.state!=='running'||!assignment.startedAt||run.assignmentId!==assignment.id||run.phase!=='human'||!run.threadId||!params||typeof params!=='object'||params.threadId!==run.threadId)return 'unavailable'
 if(typeof params.turnId!=='string'||typeof run.turnId!=='string'||params.turnId!==run.turnId)return 'unavailable'
 const start=Date.parse(assignment?.startedAt??assignment?.createdAt??'')
 if(timestamp(item.createdAt)===null||!Number.isFinite(start)||item.createdAt<=start)return 'unavailable'
 return 'waiting_permission'
}
/** A synchronous view of existing facts. No new inbox, decision or authorization exists here. */
export class OperatorAttention {
 constructor(private readonly host:()=>Runtime){}
 snapshot(offset=0,limit=25,now=Date.now(),reader?:string):OperatorAttentionSnapshot {
  if(!Number.isSafeInteger(offset)||offset<0||offset>1_000_000||!Number.isSafeInteger(limit)||limit<1||limit>100||timestamp(now)===null)throw Error('operator_attention_query_invalid')
  const items=this.project(now,reader)
  return {schema:1,readOnly:true,observedAt:now,total:items.length,offset,limit,more:offset+limit<items.length,
   ...(reader?{unread:items.filter(item=>!item.read).length}:{}),items:items.slice(offset,offset+limit)}
 }
 private stampId(reader:string,id:string){return stableDigest([reader,id])}
 /** Presentation only: never answers, approves, cancels, or issues a task. */
 markRead(reader:string,id:string,observed:string,now=Date.now()){
  const host=this.host()
  return host.store.atomic(()=>{
   const current=this.project(now,reader).find(item=>item.id===id)
   if(!current||current.observed!==observed)return false
   if(!current.read)host.store.put('operator-inbox-read',this.stampId(reader,id),{observed})
   return true
  })
 }
 private project(now:number,reader?:string){
  const host=this.host()
  return host.scopes.readOnly(()=>host.memory.readOnly(()=>{
   const items:OperatorAttentionItem[]=[],visible=new Map(host.store.tickets.list().filter(t=>taskVisible(host,t)).map(t=>[t.id,t]))
   const add=(kind:AttentionKind,key:string,state:AttentionState,sourceId:string,createdAt:unknown,expiresAt:unknown,facts:unknown,next:OperatorAttentionItem['next'],ticket?:Ticket)=>{
    const owner=ticket&&host.scopes.ownership(ticket.id),assignment=ticket?.assignments.at(-1)
    const family=next.kind==='workflow'?'workflow':kind==='native_approval'||kind==='native_question'?'native_request':kind
    const id=family+':'+stableDigest([family,key]),observed=stableDigest({kind,key,state,facts,revision:host.settings.current().revision,owner,assignment:assignment?.id})
    items.push({id,kind,state,...(ticket?{taskRef:{id:ticket.id,...(assignment?{assignmentId:assignment.id}:{})}}:{}),sourceLabel:sourceLabel(host,sourceId),createdAt:timestamp(createdAt),expiresAt:timestamp(expiresAt),observed,next,
     ...(reader?{read:host.store.get<{observed:string}>('operator-inbox-read',this.stampId(reader,id))?.observed===observed}:{})})
   }
   for(const ticket of visible.values()){
    const view=taskView(host.store,ticket)
    if(reader&&currentTask(host,ticket)){
     const run=host.store.get<Run>('run',ticket.id),assignment=view.assignments.at(-1)
     add('open_work',ticket.id,'in_progress',ticket.mandate.actor.source,Date.parse(ticket.createdAt),null,
      {ticketUpdatedAt:ticket.updatedAt,phase:run?.phase,assignmentState:assignment?.state},{kind:'task',id:ticket.id},ticket)
    }
    if(currentTask(host,ticket)&&view.attention?.id){
     const assignment=view.assignments.at(-1)
     const state=assignment?.state==='running'&&assignment.report?.state==='blocked'?'needs_reply':'stale'
     add('task_question',view.attention.id,state,ticket.mandate.actor.source,null,null,{attentionId:view.attention.id,reportAt:assignment?.report?.at}, {kind:'task',id:ticket.id},ticket)
    }
   }
   for(const item of host.store.list<Approval>('approval')){
    const ticket=visible.get(item.ticketId)
    if(!ticket||!currentTask(host,ticket)||!['pending','expired'].includes(item.status)||typeof item.id!=='string')continue
    let expiry=timestamp(item.expiresAt)
    if(item.native?.method==='acp/permission'){
     const nativeExpiry=timestamp(item.native.params?.expiresAt)
     expiry=expiry!==null&&nativeExpiry!==null?Math.min(expiry,nativeExpiry):null
    }
    const question=item.native?.method==='item/tool/requestUserInput',state=approvalState(host,ticket,item,now,expiry)
    add(question?'native_question':'native_approval',item.id,question&&state==='waiting_permission'?'needs_reply':state,ticket.mandate.actor.source,item.createdAt,expiry,{status:item.status,expiry,method:supportedNative.has(item.native?.method)?item.native.method:'unsupported'}, {kind:'task',id:ticket.id},ticket)
   }
   for(const item of host.store.list<WorkflowAction>('workflow-action')){
    const ticket=visible.get(item.ticketId)
    if(!ticket||!['pending','applying','uncertain'].includes(item.state)||!item.target||!item.view?.current)continue
    try{
     const entry=host.scopes.binding(item.target.entryId),owner=host.scopes.ownership(ticket.id),source=host.config.sources.find(s=>s.id===item.sourceId)
     if(entry.privateActor||!host.scopes.sourceActive(entry)||!source?.enabled||!host.sourceRegistry.allowsScope(source,item.target.teamId)||!owner||entry.id!==owner.originEntry)continue
     let currentTarget=false
     try{
      host.scopes.checkTaskEntry(owner,entry.id,'result')
      const configured=(source.options?.statusTargets as WorkflowAction['target'][]|undefined)?.some(target=>stableDigest(target)===stableDigest(item.target))
      currentTarget=!!configured&&source.capabilities.resources&&source.capabilities.replies&&host.scopes.scope(owner.scopeId).sourceIds.includes(source.id)&&!!host.sources.get(source.id)?.applyWorkflowState
      if(host.scopes.enabled()&&!host.store.get('router-route',item.originTriggerId))currentTarget=false
      else host.routerIngress.authority(item.originTriggerId)
     }catch{currentTarget=false}
     const fresh=currentTarget&&currentTask(host,ticket)&&item.entryRevision===entry.revision&&item.ownerEpoch===owner.ownerEpoch&&item.dataRevision===(owner.dataRevision??1)
     add(item.state==='pending'?'workflow_review':'effect_unknown',item.id,item.state==='pending'?(fresh?'needs_review':'stale'):'outcome_unknown',item.sourceId,item.at,null,{state:item.state,entryRevision:entry.revision,ownerEpoch:owner.ownerEpoch,dataRevision:owner.dataRevision??1,viewRevision:item.view.revision}, {kind:'workflow',id:item.id},ticket)
    }catch{/* Missing or revoked target facts are not repaired on observation. */}
   }
   for(const goal of host.store.list<RouterGoal>('router-goal')){
    const review=goal.project?.review
    if(goal.state!=='needs_input'||review?.state!=='pending')continue
    try{
     const binding=host.scopes.binding(goal.entryId)
     if(binding.privateActor||binding.revision!==goal.bindingRevision||!host.scopes.sourceActive(binding)||!routeVisible(host,goal.triggerId,goal.discussion))continue
     host.goals.context(goal)
     if(goal.taskIds.some(id=>!visible.has(id)))continue
     const round=host.store.get<import('./goal-verification.ts').VerificationRound>('goal-verification',review.roundId)
     const record=host.store.get<{goalId:string}>('project-review',review.id),node=goal.nodes?.find(n=>n.id===goal.project!.integration)
     const delivery=node?.ticketId?host.store.get<{id:string}>('goal-delivery',node.ticketId):undefined
     const linked=record?.goalId===goal.id
     const fresh=linked&&goal.finalRoundId===review.roundId&&round?.goalId===goal.id&&round.state==='passed'&&delivery?.id===review.deliveryId&&host.projectCode.receipt(delivery.id)?.head===review.head&&host.verification.current(round,goal,{readOnly:true})
     const next:OperatorAttentionItem['next']=linked?{kind:'project_review',id:review.id}:{kind:'records',id:goal.taskIds[0]!}
     if(!linked&&!goal.taskIds.length)continue
     add('project_review',review.id,fresh?'needs_review':'stale',binding.sourceId,review.at,null,{goalRevision:goal.revision,roundId:review.roundId,deliveryId:review.deliveryId,head:review.head}, next)
    }catch{/* Invalid context and stale evidence never become an approvable review. */}
   }
   // Unknown outcomes retain their original operation identity, even after stop or reassignment.
   for(const row of host.store.db.prepare("SELECT kind,id,body FROM records WHERE kind IN ('run','tool-receipt','browser-receipt','work','pr-delivery','review-action','merge-attempt') ORDER BY kind,id").all()){
    const value=JSON.parse(String(row.body)),kind=String(row.kind),key=String(row.id)
    const ticketId=kind==='merge-attempt'?host.store.get<{ticketId:string}>('merge-grant',key)?.ticketId:value.ticketId
    const ticket=visible.get(ticketId)
    if(!ticket)continue
    const state=value.state??value.phase
    const unknown=kind==='run'?state==='uncertain':kind==='tool-receipt'||kind==='browser-receipt'?!['running','complete'].includes(state):kind==='work'?state==='interrupted':kind==='pr-delivery'?!['pushing','creating','pushed','draft'].includes(state):kind==='review-action'?!['resolved','stale'].includes(state):kind==='merge-attempt'?!['waiting','submitting','merged','revoked'].includes(state):false
    if(!unknown)continue
    add('effect_unknown',kind+':'+key,'outcome_unknown',ticket.mandate.actor.source,value.at??value.createdAt,null,{state,assignmentId:value.assignmentId}, {kind:'records',id:ticket.id},ticket)
   }
   for(const row of host.store.db.prepare("SELECT id,payload FROM jobs WHERE state='uncertain' ORDER BY id").all()){
    const payload=JSON.parse(String(row.payload)),ticket=visible.get(payload.ticketId)
    if(ticket)add('effect_unknown','job:'+row.id,'outcome_unknown',ticket.mandate.actor.source,null,null,{assignmentId:payload.assignmentId}, {kind:'records',id:ticket.id},ticket)
   }
   for(const delivery of host.store.deliveries().filter(d=>d.status==='uncertain')){
    const ids=delivery.ticketId?[delivery.ticketId]:host.store.get<{taskIds?:string[]}>('router-reply-owner',delivery.id)?.taskIds??[]
    // A shared Router reply is visible only when every referenced task remains readable.
    if(!ids.length||ids.some(id=>!visible.has(id)))continue
    const ticket=visible.get(ids[0]!)!
    add('effect_unknown','outbox:'+delivery.id,'outcome_unknown',ticket.mandate.actor.source,null,null,{status:delivery.status,attempts:delivery.attempts,taskIds:ids},{kind:'records',id:ticket.id},ticket)
   }
   items.sort((a,b)=>Number(a.kind==='open_work')-Number(b.kind==='open_work')||(b.createdAt??-1)-(a.createdAt??-1)||a.id.localeCompare(b.id))
   return items
  }))
 }
}

/** Read-only visibility; never an execution or recovery capability. */
export function operatorTaskReadable(host:Runtime,ticket:Ticket){return host.scopes.readOnly(()=>host.memory.readOnly(()=>taskVisible(host,ticket)))}
