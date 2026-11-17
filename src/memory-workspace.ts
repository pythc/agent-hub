import {randomUUID} from 'node:crypto'
import {z} from 'zod'
import type {Runtime} from './runtime.ts'
import type {ScopeContext,RouterRoute} from './router-scope.ts'
import {stableDigest} from './sources.ts'
import type {MemoryFact} from './router-memory.ts'

interface Context {id:string;label:string;conversationId?:string;context:ScopeContext}
/** Resolve the signed-in owner's private Chat and manageable public entries anew
 * on every request. A client never chooses a trigger to impersonate. */
export function memoryContexts(host:Runtime,owner:string):Context[]{
 const conversations=new Map(host.store.list<{id:string;owner:string;title:string}>('chat-conversation').filter(c=>c.owner===owner).map(c=>[c.id,c]))
 const runs=new Map(host.store.list<{id:string;triggerId:string;conversationId:string}>('chat-run').filter(r=>conversations.has(r.conversationId)).map(r=>[r.triggerId,r]))
 const seen=new Set<string>(),result:Context[]=[]
 for(const route of host.store.list<RouterRoute>('router-route').reverse()){
  if(seen.has(route.entryId))continue
  try{
   const trigger=host.store.triggers.get(route.triggerId);if(!trigger?.human)continue
   host.routerIngress.authority(trigger.id)
   const entry=host.scopes.binding(route.entryId),run=runs.get(trigger.id)
   if(entry.privateActor&&!run)continue
   const context=host.scopes.context(trigger,route.discussion)
   if(!context||!host.scopes.canManage(context)||!host.scopes.sourceActive(entry))continue
   if(entry.privateActor&&entry.privateActor!==context.actor)continue
   seen.add(entry.id)
   result.push({id:entry.id,label:run?(conversations.get(run.conversationId)?.title||'Chat'):entry.nativeId,conversationId:run?.conversationId,context})
  }catch{/* Revoked or deleted contexts are not manageable. */}
 }
 return result
}
const command=z.object({entryId:z.string().min(1),action:z.enum(['edit','forget','confirm','dismiss','inspect','learning','consolidate','export','skill','skill-export','skill-read','import']),
 id:z.string().optional(),revision:z.number().int().nonnegative().optional(),content:z.string().min(1).max(16000).optional(),condition:z.string().max(300).optional(),
 enabled:z.boolean().optional(),file:z.enum(['USER.md','MEMORY.md','AGENTS.md','ALIGNMENT_SYNTHESIS.md']).optional(),skill:z.unknown().optional(),
 text:z.string().max(32000).optional(),operationId:z.string().uuid().optional(),
}).strict()

export function memoryWorkspace(host:Runtime,owner:string){
 const contexts=memoryContexts(host,owner)
 return {contexts:contexts.map(({id,label,conversationId,context:c})=>({id,label:conversationId?label:host.scopes.scope(c.route.scopeId).name,conversationId,scopeId:c.route.scopeId,
  request:{id:c.trigger.id,text:c.trigger.text},policy:host.agentMemory.policy(c),revision:host.agentMemory.policyRevision(c),enabled:host.agentMemory.enabled(c),
  items:host.agentMemory.authorized(c,true).filter(f=>f.entryId===id),
  skills:host.skills.list(c.route.scopeId,c),
  goals:host.goals.list(c).filter(g=>g.state==='completed'&&g.nodes?.every(n=>n.workerId)).sort((a,b)=>b.at-a.at).map(g=>({id:g.id,title:g.title})),
  cooperation:host.agentMemory.cooperation(c),
  reflection:host.agentMemory.reflection(c),
  learning:host.agentMemory.manage(c,{action:'inspect'}).adaptation,
 }))}
}

export async function changeMemoryWorkspace(host:Runtime,owner:string,value:unknown){
 if(z.object({action:z.literal('refresh')}).strict().safeParse(value).success){
  for(const entry of memoryContexts(host,owner))host.agentMemory.settleNotes(entry.context)
  return memoryWorkspace(host,owner)
 }
 const x=command.parse(value),entry=memoryContexts(host,owner).find(c=>c.id===x.entryId)
 if(!entry)throw Error('Memory entry unavailable')
 const c=entry.context
 if(x.action==='learning'){
  if(x.enabled===undefined||x.revision===undefined)throw Error('Learning setting and revision required')
  return host.store.atomic(()=>{
   const previous=host.store.get<{pausedWriteMode?:'auto'|'adaptive'}>('memory-policy',c.route.scopeId),policy=host.agentMemory.policy(c)
   const result=host.agentMemory.manage(c,{action:'configure',expectedRevision:x.revision,policy:{...policy,writeMode:x.enabled?(previous?.pausedWriteMode??'adaptive'):'explicit_only'}})
   if(!x.enabled&&policy.writeMode!=='explicit_only')host.store.put('memory-policy',c.route.scopeId,{...host.store.get<object>('memory-policy',c.route.scopeId),pausedWriteMode:policy.writeMode})
   return result
  })
 }
 if(x.action==='consolidate')return host.agentMemory.consolidate(c)
 if(x.action==='import'){
  if(!x.file||!x.text?.trim()||!x.operationId)throw Error('Choose a nonempty Markdown file')
  const notes=x.text.replace(/<!--[^]*?-->/g,'').split(/\n\s*\n|\n(?=\s*[-*]\s)/).map(t=>t.replace(/^\s*[-*]\s/,'').trim()).filter(t=>t&&!t.startsWith('#'))
  if(!notes.length||notes.length>50||notes.some(n=>n.length>16000))throw Error('Import up to 50 notes per file')
  return host.store.atomic(()=>{
   const parent=host.memory.ingest(c),id=stableDigest(['memory-file',c.route.entryId,c.actor,x.operationId]),prior=host.memory.evidence(id)
   if(parent.revoked)throw Error('Import source unavailable')
   if(prior&&(prior.revoked||prior.hash!==stableDigest(x.text)))throw Error('This import changed or was revoked')
   if(!prior)host.store.put('memory-evidence',id,{...parent,id,parentId:parent.id,text:x.text,hash:stableDigest(x.text),locator:'memory-file:'+x.file})
   const facts=notes.map((content,index)=>host.memory.command(c,{action:'remember',operationId:id+':'+index,expectedRevision:0,subject:x.file,content,kind:x.file==='USER.md'?'profile':'fact',origin:'manual',candidate:false,sourceIds:[id,parent.id],visibility:host.scopes.binding(c.route.entryId).privateActor?'private':'group'},true))
   return {imported:facts.length}
  })
 }
 if(x.action==='skill-read')return host.skills.resolve({id:x.id??'',version:x.revision??0},c.route.scopeId,c.route.entryId,c)
 if(x.action==='skill-export'){
  const item=host.skills.resolve({id:x.id??'',version:x.revision??0},c.route.scopeId,c.route.entryId,c)
  return {file:'SKILL.md',text:'# '+item.template.title+'\n\nVersion: '+item.version+'\n\n'+item.template.objective+'\n\n'+item.template.nodes.map((n,i)=>(i+1)+'. '+n.instruction).join('\n')+'\n\n## Inputs\n'+(item.parameters??[]).map(p=>'- '+p.name+': '+p.label).join('\n')+'\n\n## Acceptance\n'+item.template.criteria.map(cr=>'- '+cr.description).join('\n')}
 }
 if(x.action==='skill')return host.skills.command(x.skill,c)
 if(x.action==='export'){
  const facts=host.agentMemory.applicable(c).filter(f=>f.entryId===entry.id)
  if(x.file==='ALIGNMENT_SYNTHESIS.md'){
   const points=host.agentMemory.reflection(c)?.points??[]
   return {file:x.file,text:'# ALIGNMENT_SYNTHESIS.md\n\n'+points.map(p=>'## '+p.section+'\n\n'+p.content+(p.condition?'\n\nApplies when: '+p.condition:'')+'\n\n<!-- sources: '+p.refs.map(r=>r.id+'@'+r.revision).join(', ')+' -->').join('\n\n')}
  }
  const selected=x.file==='USER.md'?facts.filter(f=>f.kind==='profile'||f.kind==='preference'):x.file==='AGENTS.md'?facts.filter(f=>f.origin==='experience'):facts
  return {file:x.file??'MEMORY.md',text:'# '+(x.file??'MEMORY.md')+'\n\n'+selected.map(f=>'- '+f.content+(f.learning?.condition?'（'+f.learning.condition+'）':'')+'\n  <!-- memory:'+f.id+'@'+f.revision+' -->').join('\n')}
 }
 if(x.action==='inspect')return host.agentMemory.manage(c,{action:'inspect',id:x.id})
 const fact=host.agentMemory.authorized(c,true).find(f=>f.id===x.id&&f.entryId===entry.id)
 if(!fact||fact.revision!==x.revision)throw Error('Memory changed. Refresh before editing.')
 if(x.action==='dismiss'){
  if(fact.state!=='candidate')throw Error('Only pending proposals can be dismissed')
  return host.agentMemory.manage(c,{action:'archive',id:fact.id,expectedRevision:fact.revision})
 }
 if(x.action==='edit'){
  if(!['active','candidate'].includes(fact.state))throw Error('Memory cannot be edited')
  if(!x.content)throw Error('Memory content required')
  return host.memory.command(c,editMemory(fact,x.content,x.condition),true)
 }
 return host.memory.command(c,{action:x.action,id:fact.id,expectedRevision:fact.revision,operationId:randomUUID()},true)
}
function editMemory(f:MemoryFact,content:string,condition?:string){return {action:'remember',id:f.id,operationId:randomUUID(),expectedRevision:f.revision,
 subject:f.subject,content,kind:f.kind,importance:f.importance,sourceIds:f.sources.map(s=>s.id),derivedFrom:f.dependencies?.map(d=>d.id),relation:f.relation,
 candidate:false,visibility:f.visibility,ticketId:f.ticketId,expiresAt:f.expiresAt,origin:f.origin==='experience'?'experience':'manual',topicAliases:f.topicAliases,
 learning:{inferred:false,condition:condition??f.learning?.condition??'',...(f.learning?.discussion?{discussion:f.learning.discussion}:{})},
}}
