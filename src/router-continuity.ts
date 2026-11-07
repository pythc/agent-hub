import {z} from 'zod'
import type {Runtime} from './runtime.ts'
import type {ScopeContext} from './router-scope.ts'
import type {ContextManifest} from './router-memory.ts'
import type {ToolSpec} from './model.ts'
import {stableDigest} from './sources.ts'

const id=z.string().min(1).max(300)
export const journalCommandSchema=z.object({action:z.enum(['read','record','supersede','checkpoint']),id:id.optional(),operationId:id.optional(),kind:z.enum(['requirement','decision','commitment']).optional(),text:z.string().min(1).max(16000).optional(),sourceIds:z.array(id).min(1).max(100).optional(),supersedes:id.optional(),offset:z.number().int().min(0).default(0),limit:z.number().int().min(1).max(100).default(20)}).strict()
interface JournalItem {id:string;scopeId:string;entryId:string;discussion:string;actor:string;triggerIds:string[];kind:'user'|'router';text:string;at:number;contextId?:string;knowledge?:{documentId:string;revision:number}[]}
interface Commitment {id:string;scopeId:string;entryId:string;discussion:string;actor:string;triggerIds:string[];eventIds:string[];contextId?:string;kind:'requirement'|'decision'|'commitment';text:string;active:boolean;at:number;supersededBy?:string}
export const journalSpecs:ToolSpec[]=[{type:'function',name:'router_journal',description:'Persistent requirements, decisions and commitments for this conversation. record must cite sourceIds returned by read, and cannot invent user authority. Explicit user text remains verbatim in every rebuilt context. supersede requires a new explicit human input and keeps history. checkpoint summarizes past Router replies only, never deletes original user requirements or effects. Preserve decisions and next steps before returning. read is paginated.',inputSchema:{type:'object',properties:{action:{type:'string',enum:journalCommandSchema.shape.action.options},id:{type:'string'},operationId:{type:'string'},kind:{type:'string',enum:['requirement','decision','commitment']},text:{type:'string'},sourceIds:{type:'array',items:{type:'string'}},supersedes:{type:'string'},offset:{type:'integer'},limit:{type:'integer'}},required:['action'],additionalProperties:false}}]

/** Native sessions are an optimization. The journal/checkpoint is the durable
 * recovery input; missing mandatory history holds the turn, never truncates it.
 */
export class RouterContinuity {
 constructor(private host:Runtime){}
 key(c:ScopeContext){return stableDigest([c.route.routerId,c.route.entryId,c.route.discussion,c.actor])}
 private belongs(v:{scopeId:string;entryId:string;discussion:string;actor:string},c:ScopeContext){return v.scopeId===c.route.scopeId&&v.entryId===c.route.entryId&&v.discussion===c.route.discussion&&v.actor===c.actor}
 private validInputs(ids:string[]){try{for(const id of ids)this.host.routerIngress.authority(id);return true}catch{return false}}
 validContext(contextId?:string){
  if(!contextId)return true
  const m=this.host.store.get<ContextManifest>('context-manifest',contextId);if(!m)return false
  try{
   // Ordinary task progress does not revoke historical discussion. Ownership,
   // audience and fact revisions still do; validate with current task revisions.
   this.host.memory.validate({...m,taskOwners:m.taskOwners.map(t=>({...t,dataRevision:this.host.scopes.ownership(t.id)?.dataRevision??1}))});return true
  }catch{return false}
 }
 events(c:ScopeContext){
  this.host.scopes.assertCurrent(c)
  return this.host.store.list<JournalItem>('router-journal').filter(v=>this.belongs(v,c)&&v.text&&this.validInputs(v.triggerIds)&&this.validContext(v.contextId)&&!this.host.memory.cleanup.blocked('router-journal',v.id,v)).filter(v=>{try{this.host.knowledge.validate(c,v.knowledge??[]);return true}catch{return false}})
 }
 private commitments(c:ScopeContext){const ids=new Set(this.events(c).map(e=>e.id));return this.host.store.list<Commitment>('router-commitment').filter(v=>this.belongs(v,c)&&v.active&&v.text&&v.eventIds?.every(id=>ids.has(id))&&this.validContext(v.contextId)&&this.validInputs(v.triggerIds)&&!this.host.memory.cleanup.blocked('router-commitment',v.id,v))}
 capture(c:ScopeContext,triggerIds:string[]){
  for(const triggerId of triggerIds){
   const t=this.host.store.triggers.get(triggerId);if(!t?.human)continue
   this.host.routerIngress.authority(triggerId)
   const route=this.host.scopes.context(t,t.source+':'+t.threads[0]!.id)
   if(!route||!this.belongs({...route.route,actor:route.actor},c))continue
   const key='journal:'+stableDigest([this.key(c),triggerId])
   if(!this.host.store.get('router-journal',key))this.host.store.put('router-journal',key,{id:key,scopeId:c.route.scopeId,entryId:c.route.entryId,discussion:c.route.discussion,actor:c.actor,triggerIds:[triggerId],kind:'user',text:t.text,at:Date.now()} satisfies JournalItem)
  }
 }
 prepare(c:ScopeContext,packet:{input:string;manifest:ContextManifest},backendIdentity:string){
  // Upgrade captures historical admitted messages, not arbitrary platform history.
  for(const a of this.host.store.list<any>('router-admission')){
   const t=this.host.store.triggers.get(a.triggerId),r=this.host.store.get<any>('router-route',a.triggerId)
   if(a.state==='accepted'&&a.discussion===c.route.discussion&&t?.human&&r?.entryId===c.route.entryId&&JSON.stringify([t.actor.source,t.actor.id])===c.actor&&this.validInputs([t.id]))this.capture(c,[t.id])
  }
  // Recover pre-upgrade replies only with their original delivery provenance.
  // Unverifiable legacy replies are reported as a gap, never silently trusted.
  let legacyUnavailable=0
  for(const row of this.host.store.db.prepare("SELECT id,payload FROM jobs WHERE kind='router' AND state='done'").all()){
   const p=JSON.parse(String(row.payload)),result=this.host.store.get<any>('router-result',String(row.id))
   if(p.discussion!==c.route.discussion||!result?.reply||this.host.store.get('router-journal','journal-reply:'+row.id))continue
   const source=this.host.store.triggers.get(p.triggerId),owner=this.host.store.get<any>('router-reply-owner','router-reply:'+row.id)
   if(!source||JSON.stringify([source.actor.source,source.actor.id])!==c.actor)continue
   if(owner?.manifest?.entryId===c.route.entryId&&this.validInputs(owner.inputs)&&this.validContext(owner.manifest.id))this.finish(c,String(row.id),result.reply,owner.inputs,owner.manifest.id,owner.manifest.knowledge??[])
   else legacyUnavailable++
  }
  const key=this.key(c),events=this.events(c),requirements=this.commitments(c)
  const checkpoint=this.host.store.get<any>('router-checkpoint',key)
  const safeCheckpoint=checkpoint&&checkpoint.text&&Array.isArray(checkpoint.triggerIds)&&this.validInputs(checkpoint.triggerIds)&&this.validContext(checkpoint.contextId)&&checkpoint.eventIds.every((id:string)=>events.some(e=>e.id===id))?checkpoint:undefined
  const history=events.filter(e=>e.kind==='user'||!safeCheckpoint?.eventIds.includes(e.id)).map(({id,kind,text,triggerIds})=>({id,kind,text,triggerIds}))
  const envelope={...JSON.parse(packet.input),continuity:{history,requirements,legacyUnavailable,...(safeCheckpoint?{checkpoint:{text:safeCheckpoint.text,eventIds:safeCheckpoint.eventIds}}:{}),notice:'History is sourced background. Latest user instructions and current authorization govern. Retain all active constraints; continue unresolved goals. legacyUnavailable counts pre-upgrade replies without verifiable provenance; do not claim complete recovery if nonzero.'}}
  const max=this.host.scopes.scope(c.route.scopeId).contextBytes
  const previous=this.host.store.get<any>('router-session',key)
  const signature=stableDigest([backendIdentity,c.route.epoch,this.host.memory.generation(c.route.scopeId),this.host.scopes.scope(c.route.scopeId).revision])
  let reusable=previous?.signature===signature&&previous?.threadId&&Array.isArray(previous.eventIds)&&previous.eventIds.every((id:string)=>events.some(e=>e.id===id))&&(previous.contextIds??[]).every((id:string)=>this.validContext(id))
  try{this.host.knowledge.validate(c,previous?.knowledge??[])}catch{reusable=false}
  // Rotate by the accumulated input budget, not an arbitrary number of turns.
  // The backend additionally enforces its full protocol/tool-result budget.
  if((previous?.inputBytes??0)+Buffer.byteLength(packet.input)>max)reusable=false
  if(reusable)envelope.continuity.history=history.filter(e=>!previous.eventIds.includes(e.id))
  const input=JSON.stringify({...envelope,continuity:{...envelope.continuity,mode:reusable?'resume':'rebuild'}})
  if(Buffer.byteLength(input)>max)throw Error('Continuity context exceeds budget; retained user requests were not silently dropped. Increase the scope context budget or explicitly move to a new discussion with an approved handoff.')
  packet.manifest.bytes=Buffer.byteLength(input);this.host.store.put('context-manifest',packet.manifest.id,packet.manifest)
  return {input,key,signature,previous,reuse:reusable?previous.threadId as string:undefined,eventIds:events.map(e=>e.id),contextIds:reusable?[...(previous.contextIds??[]),packet.manifest.id]:[packet.manifest.id],inputBytes:(reusable?previous.inputBytes??0:0)+Buffer.byteLength(input)}
 }
 finish(c:ScopeContext,jobId:string,text:string,triggerIds:string[],contextId:string,knowledge:{documentId:string;revision:number}[]){
  const id='journal-reply:'+jobId
  this.host.store.put('router-journal',id,{id,scopeId:c.route.scopeId,entryId:c.route.entryId,discussion:c.route.discussion,actor:c.actor,triggerIds,kind:'router',text,at:Date.now(),contextId,knowledge} satisfies JournalItem)
 }
 command(value:unknown,c:ScopeContext,manifest?:ContextManifest):any{
  this.host.scopes.assertCurrent(c);const x=journalCommandSchema.parse(value),events=this.events(c)
  if(x.action==='read')return {items:events.slice(x.offset,x.offset+x.limit),total:events.length,nextOffset:x.offset+x.limit<events.length?x.offset+x.limit:null,requirements:this.commitments(c)}
  if(!x.operationId||!x.text||!x.sourceIds)throw Error('Journal mutation requires operationId, text and sourceIds')
  const refs=x.sourceIds.map(id=>{const e=events.find(e=>e.id===id||e.triggerIds.includes(id));if(!e)throw Error('Journal source unavailable');return e})
  const key=stableDigest([this.key(c),x.operationId]),fingerprint=stableDigest(x),store=this.host.store
  return store.atomic(()=>{
   const old=store.get<any>('journal-receipt',key);if(old){if(old.fingerprint!==fingerprint)throw Error('operationId reused with different content');if(!this.validContext(old.result?.contextId))throw Error('Journal receipt sources changed');return old.result}
   const triggerIds=[...new Set(refs.flatMap(e=>e.triggerIds))]
   let result:any
   if(x.action==='checkpoint'){
    if(refs.some(e=>e.kind!=='router'))throw Error('Checkpoints summarize Router replies only; user inputs remain mandatory')
    const previous=store.get<any>('router-checkpoint',this.key(c))
    if(previous?.eventIds?.some((id:string)=>!refs.some(e=>e.id===id)))throw Error('Checkpoint must cover the preceding checkpoint as well')
    result={scopeId:c.route.scopeId,entryId:c.route.entryId,discussion:c.route.discussion,actor:c.actor,text:x.text,triggerIds,eventIds:refs.map(e=>e.id),contextId:manifest?.id,at:Date.now()};store.put('router-checkpoint',this.key(c),result)
   }else{
    if(!x.kind)throw Error('Journal kind required')
    if(x.kind==='requirement'&&!refs.some(e=>e.kind==='user'&&e.text.includes(x.text!)))throw Error('Requirements must preserve an exact user quote; use decision for an interpretation')
    result={id:'commitment:'+key,scopeId:c.route.scopeId,entryId:c.route.entryId,discussion:c.route.discussion,actor:c.actor,triggerIds,eventIds:refs.map(e=>e.id),contextId:manifest?.id,kind:x.kind,text:x.text!,active:true,at:Date.now()} satisfies Commitment
    if(x.action==='supersede'){
     if(!c.trigger.human||this.host.routerIngress.authority(c.trigger.id).strength!=='explicit'||!triggerIds.includes(c.trigger.id))throw Error('Superseding requires the current explicit human input')
     const prior=this.commitments(c).find(p=>p.id===x.supersedes);if(!prior)throw Error('Prior commitment unavailable')
     store.put('router-commitment',prior.id,{...prior,active:false,supersededBy:result.id})
    }
    store.put('router-commitment',result.id,result)
   }
   store.put('journal-receipt',key,{scopeId:c.route.scopeId,entryId:c.route.entryId,triggerIds,fingerprint,result});return result
  })
 }
}
