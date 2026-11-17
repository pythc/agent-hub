import {z} from 'zod'
import type {Runtime} from './runtime.ts'
import type {ContextManifest} from './router-memory.ts'
import type {ScopeContext,RouterRoute,TaskOwnership,EntryBinding} from './router-scope.ts'
import {operatorTaskReadable} from './operator-attention.ts'
import {assertNoMemorySecret} from './memory-policy.ts'
import {stableDigest} from './sources.ts'
import {taskDecisionOperations,type DecisionOperationView} from './task-decision-operations.ts'

const id=z.string().min(1).max(1000),at=z.number().int().nonnegative().max(8640000000000000),words=z.string().min(1).max(16000)
const tuple={scopeId:id,entryId:id,discussion:id,actor:id}
const eventSchema=z.object({id,...tuple,triggerIds:z.array(id).min(1).max(100),kind:z.enum(['user','router']),text:words,at,contextId:id.optional(),knowledge:z.array(z.object({documentId:id,revision:z.number().int().positive()}).strict()).max(100).optional()}).strict()
const itemSchema=z.object({id,...tuple,triggerIds:z.array(id).min(1).max(100),eventIds:z.array(id).min(1).max(100),contextId:id.optional(),kind:z.enum(['requirement','decision','commitment']),text:words,active:z.boolean(),at,supersededBy:id.optional()}).strict()
type Item=z.infer<typeof itemSchema>
export interface DecisionSourceView {speaker:'user'|'assistant';text:string;recordedAt:number}
export interface DecisionRecordContent {kind:Item['kind'];text:string;recordedAt:number;sources:DecisionSourceView[]}
export interface TaskDecisionsView {schema:3;readOnly:true;taskState:'active'|'ended';operations:{items:DecisionOperationView[];more:boolean};subject:{kind:'task';id:string};observedAt:number;items:(DecisionRecordContent&{confirmation:'not_recorded';execution:'not_recorded';history:DecisionRecordContent[];historyMore:boolean;previous?:DecisionRecordContent})[];more:boolean}

/** Store.get does not filter reads: every retained body needs the cleanup fence. */
function saved<T>(h:Runtime,kind:string,key:string):T|undefined {const value=h.store.get<T>(kind,key);return value&&!h.memory.cleanup.blocked(kind,key,value)?value:undefined}
function rows<T>(h:Runtime,kind:string){return h.store.db.prepare('SELECT id FROM records WHERE kind=? ORDER BY rowid').all(kind).flatMap(row=>{const key=String(row.id),value=saved<T&{id?:string}>(h,kind,key);return value?.id===key?[value]:[]})}
function sameTuple(v:{scopeId:string;entryId:string;discussion:string;actor:string},c:ScopeContext){return v.scopeId===c.route.scopeId&&v.entryId===c.route.entryId&&v.discussion===c.route.discussion&&v.actor===c.actor}
function sourceContext(h:Runtime,triggerId:string,discussion:string){
 const t=saved<import('./vendor/dsh-core/index.ts').Trigger>(h,'trigger',triggerId),r=saved<RouterRoute>(h,'router-route',triggerId)
 if(!t||t.id!==triggerId||!r||r.triggerId!==triggerId||r.discussion!==discussion)throw Error('unavailable')
 const b=saved<EntryBinding>(h,'entry-binding',r.entryId)
 if(!b||b.id!==r.entryId||h.scopes.entry(t)?.id!==b.id||b.sourceId!==t.source||b.tenantId!==r.tenantId||b.privateActor||b.revision!==r.bindingRevision||r.epoch!==h.scopes.epoch(r.tenantId))throw Error('unavailable')
 h.scopes.assertTrigger(t);h.routerIngress.authority(triggerId,discussion)
 const c=h.scopes.context(t,discussion);if(!c)throw Error('unavailable');h.scopes.assertCurrent(c);return c
}
function manifest(h:Runtime,key:string,c:ScopeContext){
 const m=saved<ContextManifest>(h,'context-manifest',key)
 if(!m||m.id!==key||m.actor!==c.actor||m.entryId!==c.route.entryId||m.scopeId!==c.route.scopeId||m.routerId!==c.route.routerId||m.tenantId!==c.route.tenantId||!h.continuity.validContext(key))throw Error('unavailable')
 return m
}
function content(item:Item,sources:DecisionSourceView[]):DecisionRecordContent{return{kind:item.kind,text:item.text,recordedAt:item.at,sources}}

/** A bounded observation of existing records. It never confers permission or reports execution. */
export function taskDecisionsView(h:Runtime,taskId:string,now=Date.now()):TaskDecisionsView|undefined {
 try{return h.scopes.readOnly(()=>h.memory.readOnly(()=>{
  if(!at.safeParse(now).success)return
  const ticket=saved<import('./vendor/dsh-core/index.ts').Ticket>(h,'ticket',taskId),owner=saved<TaskOwnership>(h,'task-ownership',taskId)
  if(!ticket||ticket.id!==taskId||!operatorTaskReadable(h,ticket)||!owner||owner.ticketId!==taskId||owner.state!=='active'||saved(h,'task-continuation',taskId))return
  const first=saved<{ticketId:string;mode:string;parentTrigger?:string;discussion:string;actor:string;source:string}>(h,'worker-assignment',taskId)
  if(!first||first.ticketId!==taskId||first.mode!=='host'||!first.parentTrigger)return
  const origin=saved<import('./vendor/dsh-core/index.ts').Trigger>(h,'trigger',ticket.origin.triggerId)
  if(!origin||origin.id!==ticket.origin.triggerId||origin.meta.delegatedBy!=='router'||origin.meta.parentTrigger!==first.parentTrigger||origin.source!==first.source||origin.actor.id!==first.actor)return
  const firstContext=sourceContext(h,first.parentTrigger,first.discussion)
  const routing=saved<{ticketId:string;source:string;discussion:string;parentTrigger:string;entryId:string;mode:string}>(h,'task-routing',taskId)
  if(routing&&(routing.ticketId!==taskId||routing.mode!=='host'||routing.entryId!==owner.originEntry||!id.safeParse(routing.parentTrigger).success||!id.safeParse(routing.discussion).success||routing.source!==first.source))return
  const association=routing?{...first,...routing}:first
  if(!association.parentTrigger)return
  const c=sourceContext(h,association.parentTrigger,association.discussion)
  if(firstContext.actor!==c.actor||firstContext.route.entryId!==c.route.entryId||firstContext.route.scopeId!==c.route.scopeId)return
  if(association.actor!==c.trigger.actor.id||association.source!==c.trigger.source||owner.scopeId!==c.route.scopeId||owner.routerId!==c.route.routerId)return
  h.scopes.checkTask(taskId,c)
  const taskContext=saved<{manifest:ContextManifest}>(h,'task-context',taskId)?.manifest
  if(!taskContext)return
  const original=manifest(h,taskContext.id,c)
  for(const key of ['id','actor','tenantId','scopeId','entryId','routerId','epoch','generation']as const)if(taskContext[key]!==original[key])return
  const contextSource=sourceContext(h,taskContext.triggerId,c.route.discussion)
  if(contextSource.actor!==c.actor||contextSource.route.entryId!==c.route.entryId||contextSource.route.scopeId!==c.route.scopeId)return
  const refs=taskContext.taskOwners.filter(ref=>ref.id===taskId)
  if(refs.length!==1||refs[0]!.epoch!==owner.ownerEpoch||(refs[0]!.dataRevision??1)!==(owner.dataRevision??1))return
  h.memory.validate(taskContext)
  const assignment=ticket.assignments.at(-1)?.id,basis=stableDigest({owner,context:taskContext,assignment,routing})
  // Start with the canonical continuity visibility rules, then strengthen provenance.
  const visible=new Set(h.continuity.events(c).map(e=>e.id)),sources=new Map<string,DecisionSourceView>(),eventTriggers=new Map<string,string[]>()
  for(const raw of rows<unknown>(h,'router-journal')){
   try{
    const e=eventSchema.parse(raw);if(!visible.has(e.id)||!sameTuple(e,c)||new Set(e.triggerIds).size!==e.triggerIds.length)continue
    assertNoMemorySecret(e.text)
    for(const key of e.triggerIds){const source=sourceContext(h,key,c.route.discussion);if(source.actor!==c.actor||source.route.entryId!==c.route.entryId||source.route.scopeId!==c.route.scopeId)throw Error('unavailable')}
    if(e.kind==='user'){
     if(e.triggerIds.length!==1)continue
     const t=saved<import('./vendor/dsh-core/index.ts').Trigger>(h,'trigger',e.triggerIds[0]!)
     if(!t?.human||t.id!==e.triggerIds[0]||t.text!==e.text||e.id!=='journal:'+stableDigest([h.continuity.key(c),t.id]))continue
    }else{
     if(!e.id.startsWith('journal-reply:')||!e.contextId)continue
     const jobId=e.id.slice('journal-reply:'.length),job=h.store.db.prepare("SELECT kind,state,payload FROM jobs WHERE id=?").get(jobId),result=saved<{discussion:string;reply:string}>(h,'router-result',jobId),reply=saved<{discussion:string;inputs:string[];manifest?:ContextManifest}>(h,'router-reply-owner','router-reply:'+jobId)
     if(!job)continue
     const payload=JSON.parse(String(job.payload))
     if(payload.discussion!==c.route.discussion||!e.triggerIds.includes(payload.triggerId)||h.memory.cleanup.blocked('job',jobId,payload))continue
     const m=manifest(h,e.contextId,c)
     if(job?.kind!=='router'||job.state!=='done'||result?.discussion!==c.route.discussion||result.reply!==e.text||reply?.discussion!==c.route.discussion||reply.manifest?.id!==m.id||stableDigest(reply.inputs)!==stableDigest(e.triggerIds)||stableDigest(reply.manifest)!==stableDigest(m))continue
     if(h.memory.cleanup.blocked('router-reply-owner','router-reply:'+jobId,reply))continue
    }
    sources.set(e.id,{speaker:e.kind==='user'?'user':'assistant',text:e.text,recordedAt:e.at});eventTriggers.set(e.id,e.triggerIds)
   }catch{/* One unverifiable source must never expose a fallback body. */}
  }
  const items=new Map<string,Item>(),itemSources=new Map<string,DecisionSourceView[]>()
  for(const raw of rows<unknown>(h,'router-commitment')){
   try{
    const v=itemSchema.parse(raw)
    if(!sameTuple(v,c)||!v.id.startsWith('commitment:')||new Set(v.eventIds).size!==v.eventIds.length||new Set(v.triggerIds).size!==v.triggerIds.length||v.eventIds.length>5||!v.eventIds.every(key=>sources.has(key)))continue
    const triggers=[...new Set(v.eventIds.flatMap(key=>eventTriggers.get(key)!))]
    if(stableDigest([...v.triggerIds].sort())!==stableDigest(triggers.sort()))continue
    const receipt=saved<{result?:unknown}>(h,'journal-receipt',v.id.slice('commitment:'.length)),origin=itemSchema.safeParse(receipt?.result)
    if(!origin.success||!origin.data.active||origin.data.supersededBy)continue
    const {active:_active,supersededBy:_next,...immutable}=v,{active:_oldActive,supersededBy:_oldNext,...originalItem}=origin.data
    if(stableDigest(immutable)!==stableDigest(originalItem))continue
    const refs=v.eventIds.map(key=>sources.get(key)!)
    if(v.contextId)manifest(h,v.contextId,c);else if(v.kind!=='requirement'||refs.some(source=>source.speaker!=='user'))continue
    if(v.kind==='requirement'&&!refs.some(source=>source.speaker==='user'&&source.text.includes(v.text)))continue
    assertNoMemorySecret(v.text);items.set(v.id,v);itemSources.set(v.id,refs)
   }catch{/* Omit a corrupted, removed or sensitive item. */}
  }
  const anchors=new Set([first.parentTrigger,association.parentTrigger,...ticket.origin.triggerIds,...ticket.inputs.flatMap(input=>input.kind==='trigger'?[input.triggerId]:[])])
  const missingEdges=new Set<string>(),previous=new Map<string,Item[]>();for(const v of items.values())if(!v.active&&v.supersededBy){
   // A mutable predecessor pointer is not proof of replacement. The successor's
   // atomic command receipt captures the validated supersede operation.
   const successor=items.get(v.supersededBy),receipt=saved<{supersedes?:string}>(h,'journal-receipt',v.supersededBy.slice('commitment:'.length))
   if(!successor)continue
   if(receipt?.supersedes!==v.id){missingEdges.add(successor.id);continue}
   const list=previous.get(v.supersededBy)??[];list.push(v);previous.set(v.supersededBy,list)
  }
  function related(v:Item,seen=new Set<string>()):boolean {
   if(seen.size>=20||seen.has(v.id))return false
   seen.add(v.id);const prior=previous.get(v.id)??[]
   if(prior.length>1)return false
   if(v.triggerIds.some(key=>anchors.has(key)))return true
   return prior.length===1&&related(prior[0]!,seen)
  }
  const current=[...items.values()].filter(v=>v.active&&!v.supersededBy&&related(v)).sort((a,b)=>b.at-a.at||a.id.localeCompare(b.id))
  const operations=taskDecisionOperations(h,taskId,c,owner,anchors)
  if(!current.length&&!operations.items.length)return
  const view=current.slice(0,5).map(v=>{
   const history:DecisionRecordContent[]=[],seen=new Set([v.id]);let cursor=v,historyMore=false
   while(true){
    const prior=previous.get(cursor.id)??[]
    if(!prior.length){historyMore=missingEdges.has(cursor.id)||!!saved<{supersedes?:string}>(h,'journal-receipt',cursor.id.slice('commitment:'.length))?.supersedes;break}
    if(prior.length!==1||seen.has(prior[0]!.id)){historyMore=true;break}
    if(history.length===20){historyMore=true;break}
    cursor=prior[0]!;seen.add(cursor.id);history.push(content(cursor,itemSources.get(cursor.id)!))
   }
   return{...content(v,itemSources.get(v.id)!),confirmation:'not_recorded'as const,execution:'not_recorded'as const,history,historyMore,...(history[0]?{previous:history[0]}:{})}
  })
  const finalOwner=h.scopes.ownership(taskId),finalContext=saved<{manifest:ContextManifest}>(h,'task-context',taskId)?.manifest,finalTicket=saved<import('./vendor/dsh-core/index.ts').Ticket>(h,'ticket',taskId)
  if(!finalTicket||finalTicket.id!==taskId||!finalOwner||!finalContext||stableDigest({owner:finalOwner,context:finalContext,assignment:finalTicket.assignments.at(-1)?.id,routing:saved(h,'task-routing',taskId)})!==basis||!operatorTaskReadable(h,finalTicket))return
  return{schema:3,readOnly:true,taskState:ticket.ended?'ended':'active',operations,subject:{kind:'task',id:taskId},observedAt:now,items:view,more:current.length>5}
 }))}catch{return}
}
