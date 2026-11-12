import {z} from 'zod'
import type {Runtime} from './runtime.ts'
import type {WorkOwner} from './work.ts'
import type {EntryBinding} from './router-scope.ts'
import type {ContextManifest} from './router-memory.ts'
import type {Trigger} from './vendor/dsh-core/index.ts'
import {allowNewTaskInputs} from './task-context.ts'
import {stableDigest} from './sources.ts'

const key=z.string().min(1).max(300)
const choice=z.object({id:key,name:key})
export const transitionView=z.object({account:key,issue:key,label:key,revision:key,current:choice,states:z.array(choice)})
export type TransitionView=z.infer<typeof transitionView>
export interface StatusTarget {key:string;entryId:string;teamId:string;issueId:string}
type State='pending'|'applying'|'applied'|'declined'|'stale'|'uncertain'|'observed'
export interface WorkflowAction {
  id:string;ticketId:string;originTriggerId:string;notificationTriggerId:string;sourceId:string;target:StatusTarget;entryRevision:number;ownerEpoch:number;dataRevision:number
  view:TransitionView;next:z.infer<typeof choice>;state:State;at:number;finishedAt?:number;receipt?:{issue:string;state:string;revision:string}
  decision?:{kind:'approve'|'decline';at:number;via:'operator'|'conversation';actorId?:string;triggerId?:string}
}
export const workflowRequest=z.discriminatedUnion('action',[
  z.object({action:z.literal('list')}).strict(),
  z.object({action:z.literal('inspect'),sourceId:key,target:key}).strict(),
  z.object({action:z.literal('propose'),sourceId:key,target:key,stateId:key,requestId:key}).strict(),
])
export const decisionRequest=z.object({id:key,decision:z.enum(['approve','decline','reconcile'])}).strict()

export class WorkflowActions {
  constructor(private host:Runtime,private now:()=>number=Date.now){
    for(const item of this.list())if(item.state==='applying')this.save({...item,state:'uncertain'})
  }
  list(){return this.host.store.list<WorkflowAction>('workflow-action').filter(a=>a.view?.current&&a.target)}
  private operatorVisible(item:WorkflowAction){
    const entry=this.host.store.get<EntryBinding>('entry-binding',item.target.entryId)
    return !!entry&&!entry.privateActor&&this.host.scopes.sourceActive(entry)
  }
  forOperator(ticketId?:string){
    return this.list().filter(a=>(ticketId?a.ticketId===ticketId:['pending','applying','uncertain'].includes(a.state))&&this.operatorVisible(a))
  }
  unsettled(ticketId:string){
    return !!this.host.store.db.prepare("SELECT 1 FROM records WHERE kind='workflow-action' AND json_extract(body,'$.ticketId')=? AND json_extract(body,'$.state') IN ('pending','applying','uncertain') LIMIT 1").get(ticketId)
  }
  private save(item:WorkflowAction){this.host.store.put('workflow-action',item.id,item);return item}
  private targets(ticketId:string){
    const owner=this.host.scopes.ownership(ticketId),ticket=this.host.store.tickets.get(ticketId)
    if(!owner||owner.state!=='active'||!ticket||ticket.ended?.by==='human')throw Error('Task authority is unavailable')
    const entry=this.host.scopes.binding(owner.originEntry)
    this.host.scopes.checkTaskEntry(owner,entry.id,'result')
    const manifest=this.host.store.get<{manifest:ContextManifest}>('task-context',ticketId)?.manifest
    if(manifest)this.host.memory.validate(manifest)
    const parent=this.host.taskAuthority(ticketId)?.parentTrigger
    if(parent)this.host.routerIngress.authority(parent)
    const automation=ticket.mandate.basis.scope?.automationInputId
    if(typeof automation==='string')this.host.routerIngress.authority(automation)
    const scope=this.host.scopes.scope(owner.scopeId)
    return this.host.config.sources.filter(s=>s.enabled&&s.capabilities.resources&&s.capabilities.replies&&scope.sourceIds.includes(s.id)&&Array.isArray(s.options?.statusTargets)&&this.host.sources.get(s.id)?.applyWorkflowState)
      .flatMap(s=>(s.options!.statusTargets as StatusTarget[]).filter(t=>t.entryId===entry.id&&this.host.sourceRegistry.allowsScope(s,t.teamId))
        .map(target=>({sourceId:s.id,target,entryRevision:entry.revision,ownerEpoch:owner.ownerEpoch,dataRevision:owner.dataRevision??1})))
  }
  private target(ticketId:string,sourceId:string,key:string){
    const binding=this.targets(ticketId).find(item=>item.sourceId===sourceId&&item.target.key===key)
    const source=this.host.sources.get(sourceId)
    if(!binding||!source?.workflowState||!source.applyWorkflowState)throw Error('Status target is unavailable for this task')
    return {binding,source}
  }
  private current(item:WorkflowAction){
    this.host.routerIngress.authority(item.originTriggerId)
    const result=this.target(item.ticketId,item.sourceId,item.target.key)
    const {sourceId,target,entryRevision,ownerEpoch,dataRevision}=item
    if(stableDigest(result.binding)!==stableDigest({sourceId,target,entryRevision,ownerEpoch,dataRevision}))throw Error('Task or status target authorization changed')
    return result.source
  }
  private notice(item:WorkflowAction){
    const origin=item.originTriggerId,trigger=this.host.store.triggers.get(item.notificationTriggerId)
    if(!this.host.proactive.notify(origin))return
    if(!trigger?.channel||trigger.channel.address.routerInbox)return
    const id='workflow-action:'+item.id+':'+item.state
    const description=item.view.label+' · '+item.view.current.name+' → '+item.next.name
    const prefix=this.host.sources.get(trigger.source)?.verificationCommand,command=prefix?prefix+' ':''
    const text=item.state==='pending'?'待确认 '+description+'（账号 '+item.view.account+'）。在本会话回复「'+command+'批准 '+item.id.slice(0,16)+'」或「'+command+'拒绝 '+item.id.slice(0,16)+'」，也可打开 Roppo「待我处理」。':description+' · '+({applied:'已写入并回读',observed:'已回读目标状态，写入方未确认',declined:'已拒绝',stale:'事项已变化，请重新提案',uncertain:'写入结果待核对',applying:'正在提交'}[item.state])
    const manifest=this.host.store.get<{manifest:ContextManifest}>('task-context',item.ticketId)?.manifest
    this.host.store.put('router-reply-owner',id,{discussion:trigger.source+':'+trigger.threads[0]!.id,triggerId:trigger.id,inputs:[...new Set([origin,trigger.id])],...(manifest?{manifest}:{})})
    this.host.store.outbox.send({id,channel:trigger.channel,kind:'reply',text})
  }
  private reply(trigger:Trigger){
    const prefix=this.host.sources.get(trigger.source)?.verificationCommand
    const text=trigger.text.trim()
    return /^(批准|拒绝|approve|decline) ([a-f0-9]{16})$/i.exec(prefix&&text.startsWith(prefix+' ')?text.slice(prefix.length).trim():text)
  }
  isDecisionReply(trigger:Trigger){return trigger.human&&!!this.reply(trigger)}
  queueReply(trigger:Trigger){
    if(!this.isDecisionReply(trigger))return false
    this.host.store.enqueue('workflow-decision:'+trigger.id,'workflow-decision',{triggerId:trigger.id})
    return true
  }
  async decideReply(triggerId:string){
    const trigger=this.host.store.triggers.get(triggerId)!
    const match=this.reply(trigger)!
    const authorized=()=>{
      const mandate=this.host.routerIngress.authority(trigger.id)
      const c=this.host.scopes.context(trigger,trigger.source+':'+trigger.threads[0]!.id)
      if(!trigger.human||mandate.strength!=='explicit'||!c||!this.host.scopes.canManage(c))throw Error('A current entry manager must decide')
      const items=this.list().filter(a=>a.id.startsWith(match[2]!)&&a.target.entryId===c.route.entryId)
      const item=items.length===1?items[0]:undefined
      const anchor=item&&this.host.store.triggers.get(item.notificationTriggerId)
      if(!item||!anchor?.channel||anchor.source!==trigger.source||anchor.channel.thread!==trigger.channel?.thread)throw Error('No matching decision in this conversation')
      return item
    }
    await this.decide({id:authorized().id,decision:['批准','approve'].includes(match[1]!.toLowerCase())?'approve':'decline'},{trigger,authorize:authorized})
  }
  async request(owner:WorkOwner,value:unknown){
    const input=workflowRequest.parse(value),ticketId=owner.ticketId
    if(owner.agentId||!this.host.validWork(owner))throw Error('An active root Worker is required')
    if(input.action==='list')return this.targets(ticketId).map(({sourceId,target})=>({sourceId,target:target.key}))
    const {binding,source}=this.target(ticketId,input.sourceId,input.target)
    const id=input.action==='propose'?stableDigest([ticketId,input.requestId]):''
    const prior=id&&this.host.store.get<WorkflowAction>('workflow-action',id)
    if(prior){
      if(prior.sourceId!==input.sourceId||prior.target.key!==input.target||input.action!=='propose'||prior.next.id!==input.stateId)throw Error('Request ID is bound to a different proposal')
      this.current(prior)
      return prior
    }
    const view=transitionView.parse(await source.workflowState!(binding.target))
    if(!this.host.validWork(owner)||stableDigest(binding)!==stableDigest(this.target(ticketId,input.sourceId,input.target).binding))throw Error('Task changed while reading status')
    if(input.action==='inspect')return view
    const next=view.states.find(s=>s.id===input.stateId)
    if(!next||next.id===view.current.id)throw Error('Choose a different workflow state for this issue')
    return this.host.store.atomic(()=>{
      const existing=this.host.store.get<WorkflowAction>('workflow-action',id)
      if(existing){if(existing.sourceId!==input.sourceId||existing.target.key!==input.target||existing.next.id!==next.id)throw Error('Request ID is bound to a different proposal');return existing}
      this.host.store.requireWorkflowSchema()
      const originTriggerId=this.host.goals.forTask(ticketId)?.triggerId??this.host.taskAuthority(ticketId)?.parentTrigger??this.host.store.tickets.get(ticketId)!.origin.triggerId
      this.host.routerIngress.authority(originTriggerId)
      const notificationTriggerId=this.host.webhooks.notificationAnchor(originTriggerId)?.id??originTriggerId
      const item=this.save({id,ticketId,originTriggerId,notificationTriggerId,...binding,view,next,state:'pending',at:this.now()})
      this.notice(item)
      return item
    })
  }
  private finish(item:WorkflowAction,state:State,view?:TransitionView){
    return this.host.store.atomic(()=>{
      const updated=this.save({...item,state,finishedAt:this.now(),...(view?{receipt:{issue:view.issue,state:view.current.id,revision:view.revision}}:{})})
      this.notice(updated)
      const ticket=this.host.store.tickets.get(item.ticketId)
      if(ticket&&!ticket.ended&&state!=='uncertain'){
        const prior=ticket.inputs.map(i=>i.id)
        this.host.engine.note(ticket.id,JSON.stringify({kind:'workflow_action_result',id:item.id,state,receipt:updated.receipt}))
        allowNewTaskInputs(this.host.store,ticket.id,prior)
      }
      return updated
    })
  }
  async decide(value:unknown,context?:{trigger?:Trigger;operatorId?:string;authorize:()=>unknown}){
    const authorize=context?.authorize
    authorize?.()
    const {id,decision}=decisionRequest.parse(value)
    const get=()=>this.host.store.get<WorkflowAction>('workflow-action',id)!
    let item=get()
    if(!item?.view?.current||!item.target||(!context?.trigger&&!this.operatorVisible(item)))throw Error('Unknown workflow action')
    if(item.state==='pending'&&decision!=='reconcile'){
      item={...item,decision:{kind:decision,at:this.now(),...(context?.trigger?{via:'conversation',actorId:context.trigger.actor.id,triggerId:context.trigger.id}:{via:'operator',actorId:context?.operatorId??'local-operator'})}}
    }
    if(decision==='decline'&&item.state==='pending')return this.finish(item,'declined')
    if(decision==='reconcile'&&item.state==='uncertain'){
      const view=transitionView.parse(await this.current(item).workflowState!(item.target))
      this.current(item);authorize?.()
      if(get().state!=='uncertain')return get()
      if(view.account!==item.view.account||view.issue!==item.view.issue||view.current.id!==item.next.id)return item
      return this.finish(item,'observed',view)
    }
    if(decision!=='approve'||item.state!=='pending')return item
    const source=this.current(item)
    const view=transitionView.parse(await source.workflowState!(item.target))
    this.current(item);authorize?.()
    if(get().state!=='pending')return get()
    if(view.account!==item.view.account||view.issue!==item.view.issue||view.revision!==item.view.revision||view.current.id!==item.view.current.id||!view.states.some(s=>s.id===item.next.id))return this.finish(item,'stale')
    this.save({...item,state:'applying'})
    try{
      const result=await source.applyWorkflowState!(item.target,view,item.next.id,()=>{this.current(item);authorize?.();return get().state==='applying'})
      if(result==='changed')return this.finish(item,'stale')
      const after=transitionView.parse(await this.current(item).workflowState!(item.target))
      if(after.issue!==view.issue||after.account!==view.account||after.current.id!==item.next.id)return this.finish(item,'uncertain')
      return this.finish(item,'applied',after)
    }catch{return this.finish(item,'uncertain')}
  }
}
