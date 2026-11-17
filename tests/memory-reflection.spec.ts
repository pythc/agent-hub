import {afterEach,expect,it} from 'vitest'
import {mkdtempSync,rmSync,copyFileSync} from 'node:fs'
import {backup} from 'node:sqlite'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
import {reflectMemories} from '../src/memory-reflection.ts'
import type {MemoryFact} from '../src/router-memory.ts'
import type {ModelRequest} from '../src/model.ts'
import {memoryContexts,changeMemoryWorkspace} from '../src/memory-workspace.ts'
import {personaFiles,importPersonaFile} from '../src/persona.ts'

const cleanup:(()=>Promise<void>)[]=[]
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close()})
function fixture(output?:(input:any)=>unknown|Promise<unknown>){
 const root=mkdtempSync(join(tmpdir(),'memory-reflection-'));let now=Date.now(),sequence=0
 const calls:ModelRequest[]=[],config=configSchema.parse({stateDir:join(root,'state'),work:{sandboxDriver:'disabled'},execution:{router:{mode:'host'},management:{enabled:true},workers:[{id:'one',backend:'codex'}]},sources:[{id:'local',kind:'local',cwd:root,allowedActors:['alice','bob']}]})
 const model={async run(r:ModelRequest){calls.push(r);const input=JSON.parse(r.input);return {threadId:randomUUID(),turnId:randomUUID(),text:JSON.stringify(await output?.(input)??{points:[{section:'communication',content:'Give concise progress updates with concrete results.',condition:'Routine task updates',evidence:[{index:0,quote:input.notes[0].content}]}]})}}}
 let h=new Runtime(config,{model,clock:()=>now})
 h.scopes.command({action:'scope.put',operationId:'setup',expectedRevision:0,scope:{id:'team',tenantId:'org',name:'Team',managers:[JSON.stringify(['local','alice'])],workerIds:['one'],sourceIds:['local'],backendIds:['codex']}})
 cleanup.push(async()=>{await h.close();rmSync(root,{recursive:true,force:true})})
 const chat=(owner='alice')=>{const conversation=h.chat.create(owner);const run=h.chat.send(conversation.id,owner,{clientMessageId:randomUUID(),text:'请记住：平时简短回复，技术报告列出验证证据。'}),trigger=h.store.triggers.get(run.runId)!;return {conversation,c:h.scopes.context(trigger,'local:chat:'+conversation.id)!}}
 const remember=(c:ReturnType<typeof chat>['c'],content:string,extra:Partial<MemoryFact>={})=>h.memory.command(c,{action:'remember',operationId:'note-'+(++sequence),expectedRevision:0,subject:'Convention '+sequence,content,kind:'preference',candidate:false,sourceIds:[h.memory.ingest(c).id],visibility:'private',learning:{inferred:false,condition:'Routine task updates',quote:'平时简短回复'},...extra},true) as MemoryFact
 const learn=(c:ReturnType<typeof chat>['c'])=>h.agentMemory.manage(c,{action:'configure',expectedRevision:h.agentMemory.policyRevision(c),policy:{writeMode:'adaptive',delayMs:0,minIntervalMs:0}})
 return {get h(){return h},root,calls,chat,remember,learn,advance:(ms=100000)=>{now+=ms},reflect:(c:ReturnType<typeof chat>['c'])=>reflectMemories(h.agentMemory,c,AbortSignal.timeout(10000)),restart:async(snapshot?:string)=>{await h.close();if(snapshot)copyFileSync(snapshot,join(config.stateDir,'state.sqlite'));h=new Runtime(config,{model,clock:()=>now})}}
}
it('runs a sourced quiet-time synthesis in the existing maintenance loop and reuses unchanged results',async()=>{
 const f=fixture(),a=f.chat(),b=f.chat('bob')
 f.remember(a.c,'Use brief updates.');f.remember(a.c,'Show verification evidence for technical reports.')
 f.remember(b.c,'BOB PRIVATE PREFERENCE');f.learn(a.c)
 expect(await f.reflect(a.c)).toMatchObject({status:'deferred'})
 f.advance();f.h.agentMemory.tick();await f.h.agentMemory.drain()
 const view=f.h.agentMemory.reflection(a.c)!;expect(view.points).toHaveLength(1)
 expect(f.h.store.db.prepare('PRAGMA user_version').get()!.user_version).toBe(15)
 f.h.store.requireEvolutionSchema();f.h.store.requireWorkflowSchema();f.h.store.requireCodeProjectSchema()
 expect(f.h.store.db.prepare('PRAGMA user_version').get()!.user_version).toBe(15)
 expect(f.calls).toHaveLength(1);expect(f.calls[0]!.instructions).toContain('in English');expect(f.calls[0]!.input).not.toContain('BOB PRIVATE')
 expect(f.h.agentMemory.reflection(b.c)).toBeUndefined()
 const packet=f.h.memory.build(a.c,{replyLocale:'zh-CN'},'test'),input=JSON.parse(packet.input)
 expect(input.replyLocale).toBe('zh-CN');expect(input.memory.personalization.points[0].content).toContain('concise progress')
 expect(packet.manifest.facts).toEqual(expect.arrayContaining(view.points[0]!.refs));f.h.memory.validate(packet.manifest)
 expect(await f.reflect(a.c)).toMatchObject({status:'unchanged'});expect(f.calls).toHaveLength(1)
 await f.restart();const restored=memoryContexts(f.h,'alice')[0]!.context
 expect(f.h.agentMemory.reflection(restored)?.points).toEqual(view.points)
})
it('keeps Chinese queries useful for English notes by searching exact source quotations',async()=>{
 const f=fixture(),a=f.chat();f.remember(a.c,'Use the embedded browser for the report.',{kind:'fact',origin:'extracted',learning:{inferred:false,condition:'',quote:'报告请使用内置浏览器'}})
 const result=await f.h.agentMemory.search(a.c,'内置浏览器')
 expect(result.items.map(n=>n.content)).toContain('Use the embedded browser for the report.')
})
it('rejects unsupported quotes and never derives working conventions from a user preference',async()=>{
 for(const bad of ['quote','category']){
  const f=fixture(input=>({points:[{section:bad==='category'?'working-conventions':'communication',content:'Invented lesson',condition:'',evidence:[{index:0,quote:bad==='quote'?'Not in the evidence':input.notes[0].content}]}]})),a=f.chat()
  f.remember(a.c,'Keep updates short.');f.remember(a.c,'Give evidence.');f.learn(a.c);f.advance()
  await expect(f.reflect(a.c)).rejects.toThrow('unverifiable_reflection')
  expect(f.h.agentMemory.reflection(a.c)).toBeUndefined()
 }
})
it('discards a reflection when its source is edited during the model call',async()=>{
 let finish!:(value:unknown)=>void
 const f=fixture(()=>new Promise(resolve=>{finish=resolve})),a=f.chat(),one=f.remember(a.c,'Keep updates short.')
 f.remember(a.c,'Give evidence.');f.learn(a.c);f.advance()
 const pending=f.reflect(a.c)
 await changeMemoryWorkspace(f.h,'alice',{entryId:a.c.route.entryId,action:'edit',id:one.id,revision:one.revision,content:'Explain each relevant tradeoff.'})
 finish({points:[]});await expect(pending).rejects.toThrow()
 expect(f.h.agentMemory.reflection(a.c)).toBeUndefined()
})
it('waits for newly arrived messages to be processed before publishing a reflection',async()=>{
 let finish!:(value:unknown)=>void
 const f=fixture(()=>new Promise(resolve=>{finish=resolve})),a=f.chat()
 f.remember(a.c,'Keep updates short.');f.remember(a.c,'Give evidence.');f.learn(a.c);f.advance()
 const pending=f.reflect(a.c)
 f.h.chat.send(a.conversation.id,'alice',{clientMessageId:randomUUID(),text:'For future reports, please explain the reasoning in detail.'})
 finish({points:[]});await expect(pending).rejects.toThrow('reflection_inputs_changed')
 f.advance(300001);expect(await f.reflect(a.c)).toMatchObject({status:'deferred'});expect(f.calls).toHaveLength(1)
})
it('removes derived copies on forgetting, retains them while memory is disabled, and clears them on reset',async()=>{
 const f=fixture(),a=f.chat(),one=f.remember(a.c,'Keep updates short.'),two=f.remember(a.c,'Give evidence.')
 f.learn(a.c);f.advance();await f.reflect(a.c)
 const view=f.h.agentMemory.reflection(a.c)!,ref=view.points[0]!.refs[0]!,target=[one,two].find(n=>n.id===ref.id)!
 f.h.agentMemory.manage(a.c,{action:'personal',enabled:false});f.h.agentMemory.reconcile()
 expect(f.h.store.get('memory-reflection',view.space)).toBeDefined();expect(f.h.agentMemory.reflection(a.c)).toBeUndefined()
 f.h.agentMemory.manage(a.c,{action:'personal',enabled:true})
 const before=f.h.memory.build(a.c,{},'test')
 await changeMemoryWorkspace(f.h,'alice',{entryId:a.c.route.entryId,action:'forget',id:target.id,revision:target.revision})
 expect(f.h.store.get('memory-reflection',view.space)).toBeUndefined();expect(()=>f.h.memory.validate(before.manifest)).toThrow()
 const fresh=memoryContexts(f.h,'alice')[0]!.context
 f.h.agentMemory.manage(fresh,{action:'configure',expectedRevision:f.h.agentMemory.policyRevision(fresh),policy:{writeMode:'explicit_only'}})
 const follow=f.h.chat.send(a.conversation.id,'alice',{clientMessageId:randomUUID(),text:'Keep future status updates compact and include links.'}),next=f.h.scopes.context(f.h.store.triggers.get(follow.runId)!,'local:chat:'+a.conversation.id)!
 f.remember(next,'Prefer compact status updates with links.');f.learn(next);f.advance(300001);await f.reflect(next)
 expect(f.h.store.list('memory-reflection').length).toBeGreaterThan(0)
 const snapshot=join(f.root,'before-reset.sqlite');await backup(f.h.store.db,snapshot)
 const settings=f.h.settings.current();f.h.chat.reset('alice',randomUUID())
 for(const kind of ['memory-reflection','memory-reflection-history','memory-reflection-run'])expect(f.h.store.list(kind).every(row=>JSON.stringify(row)==='{}'||JSON.stringify(row)==='{\"deleted\":true}')).toBe(true)
 await f.restart(snapshot)
 expect(memoryContexts(f.h,'alice')).toEqual([])
 for(const kind of ['memory-reflection','memory-reflection-history','memory-reflection-run'])expect(JSON.stringify(f.h.store.list(kind))).not.toContain('concise progress')
 expect(f.h.settings.current()).toEqual(settings)
})
it('keeps learned conventions editable without copying scoped learning into global instructions',async()=>{
 const f=fixture(),a=f.chat(),note=f.remember(a.c,'Check the output file after generation.',{kind:'fact',origin:'experience'})
 await changeMemoryWorkspace(f.h,'alice',{entryId:a.c.route.entryId,action:'edit',id:note.id,revision:note.revision,content:'Read the output file and verify its contents.'})
 expect(f.h.memory.fact(note.id)).toMatchObject({origin:'experience',protected:true,learning:{inferred:false}})
 const exported=await changeMemoryWorkspace(f.h,'alice',{entryId:a.c.route.entryId,action:'export',file:'AGENTS.md'}) as {text:string}
 expect(exported.text).toContain('Read the output file')
 const files=personaFiles(f.h,{})
 importPersonaFile(f.h,{file:'AGENTS.md',revision:files.revision,text:files.files['AGENTS.md']+'\n\n<!-- roppo:learned-conventions -->\n'+exported.text+'\n<!-- /roppo:learned-conventions -->'})
 expect(personaFiles(f.h,{}).files['AGENTS.md']).not.toContain('Read the output file')
})
it('retains the working-convention classification after consolidating operational lessons',async()=>{
 const f=fixture(()=>({merges:[{indices:[0,1],content:'Read generated files back and check their contents.'}]})),a=f.chat()
 f.remember(a.c,'Read generated files back.',{kind:'fact',origin:'experience'})
 f.remember(a.c,'Read generated files back and verify.',{kind:'fact',origin:'experience'})
 f.remember(a.c,'Read generated files back as project context.',{kind:'fact',origin:'manual'})
 await f.h.agentMemory.consolidate(a.c)
 const facts=f.h.agentMemory.applicable(a.c)
 expect(facts.filter(n=>n.origin==='experience').map(n=>n.content)).toEqual(['Read generated files back and check their contents.'])
 expect(facts.some(n=>n.content==='Read generated files back as project context.')).toBe(true)
})
