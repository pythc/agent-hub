import {z} from 'zod'
import type {Runtime} from './runtime.ts'
import type {ScopeContext} from './router-scope.ts'
import {stableDigest} from './sources.ts'

// Shared only with history cleanup; never included in memory or skill consumers.
export const externalCandidateKind='chat-external-memory-candidate'
const limit=20
const entryId=z.string().min(1).max(300)
export const externalCandidateCommand=z.discriminatedUnion('action',[
 z.object({action:z.literal('external-list'),entryId}).strict(),
 z.object({action:z.literal('external-stage'),entryId,text:z.string().trim().min(1).max(4000),provenance:z.string().trim().min(1).max(200),operationId:z.string().uuid()}).strict(),
 z.object({action:z.literal('external-discard'),entryId,id:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),
])
type Command=z.infer<typeof externalCandidateCommand>
type RecordOwner={owner:string;conversationId:string;entryId:string;actor:string;scopeId:string;tenantId:string}
type Candidate=RecordOwner&{id:string;state:'unreviewed'|'discarded';at:number;text?:string;provenance?:string}
type Conversation={id:string;owner:string;archived:boolean;actor:string;discussion:string;sourceId:string;nativeId?:string}

export function externalMemoryCandidates(host:Runtime,owner:string,context:ScopeContext,conversationId:string|undefined,x:Command){
 const {route,actor}=context,binding=host.scopes.binding(route.entryId)
 const conversation=conversationId&&host.store.get<Conversation>('chat-conversation',conversationId)
 if(!conversation||conversation.owner!==owner||conversation.archived||conversation.actor!==context.trigger.actor.id||
    actor!==JSON.stringify([conversation.sourceId,conversation.actor])||conversation.discussion!==route.discussion||context.trigger.source!==conversation.sourceId||
    binding.privateActor!==actor||binding.sourceId!==conversation.sourceId||binding.nativeId!==(conversation.nativeId??'chat:'+conversation.id)||
    binding.tenantId!==route.tenantId||binding.scopeId!==route.scopeId||route.scopeId!=='@chat:'+stableDigest(owner)||
    host.memory.cleanup.blocked('chat-conversation',conversation.id,conversation))throw Error('Private Chat entry unavailable')
 const identity={owner,conversationId:conversation.id,entryId:binding.id,actor,scopeId:binding.scopeId,tenantId:binding.tenantId}
 const belongs=(r:Candidate)=>r.owner===owner&&r.conversationId===identity.conversationId&&r.entryId===identity.entryId&&
  r.actor===actor&&r.scopeId===identity.scopeId&&r.tenantId===identity.tenantId
 const list=()=>host.store.db.prepare(`SELECT body FROM records WHERE kind=? AND json_extract(body,'$.state')='unreviewed'
  AND json_extract(body,'$.owner')=? AND json_extract(body,'$.conversationId')=? AND json_extract(body,'$.entryId')=?
  AND json_extract(body,'$.actor')=? AND json_extract(body,'$.scopeId')=? AND json_extract(body,'$.tenantId')=? ORDER BY rowid DESC LIMIT ?`)
  .all(externalCandidateKind,owner,identity.conversationId,identity.entryId,actor,identity.scopeId,identity.tenantId,limit)
  .map(r=>JSON.parse(String(r.body)) as Candidate).filter(r=>!host.memory.cleanup.blocked(externalCandidateKind,r.id,r))
 const view=()=>({items:list().map(({id,at,text,provenance})=>({id,at,text,provenance,state:'unreviewed' as const}))})
 if(x.action==='external-list')return view()
 return host.store.atomic(()=>{
  if(x.action==='external-discard'){
   const item=host.store.get<Candidate>(externalCandidateKind,x.id)
   if(!item||!belongs(item)||host.memory.cleanup.blocked(externalCandidateKind,x.id,item))throw Error('Candidate unavailable')
   if(item.state==='unreviewed')host.store.put(externalCandidateKind,x.id,{...identity,id:x.id,at:item.at,state:'discarded'} satisfies Candidate)
   return view()
  }
  if(!host.scopes.scope(identity.scopeId).memoryEnabled)throw Error('Memory is disabled for this entry')
  const id=stableDigest([externalCandidateKind,owner,identity.conversationId,x.operationId])
  const previous=host.store.get<Candidate>(externalCandidateKind,id)
  if(previous){
   if(!belongs(previous)||previous.state!=='unreviewed'||previous.text!==x.text||previous.provenance!==x.provenance||
    host.memory.cleanup.blocked(externalCandidateKind,id,previous))throw Error('Candidate request has changed or was discarded')
   return view()
  }
  if(list().length>=limit)throw Error('Discard an unreviewed candidate before adding more')
  const item={...identity,id,at:Date.now(),text:x.text,provenance:x.provenance,state:'unreviewed'} satisfies Candidate
  if(host.memory.cleanup.blocked(externalCandidateKind,id,item))throw Error('Candidate entry unavailable')
  host.store.put(externalCandidateKind,id,item)
  return view()
 })
}
