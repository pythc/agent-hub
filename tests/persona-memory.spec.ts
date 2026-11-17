import {afterEach,expect,it} from 'vitest'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
import {memoryWorkspace,changeMemoryWorkspace,memoryContexts} from '../src/memory-workspace.ts'
import {personaFiles,importPersonaFile} from '../src/persona.ts'
import {previewInstructions} from '../src/execution-prompts.ts'
import type {MemoryFact} from '../src/router-memory.ts'
import type {ModelRequest} from '../src/model.ts'
const cleanup:(()=>Promise<void>)[]=[]
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close()})
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'persona-memory-')),calls:ModelRequest[]=[]
 const h=new Runtime(configSchema.parse({stateDir:join(root,'state'),work:{sandboxDriver:'disabled'},execution:{router:{mode:'host'},management:{enabled:true},workers:[{id:'one',backend:'codex'}]},sources:[{id:'local',kind:'local',cwd:root,allowedActors:['operator']}]}),{model:{async run(r){calls.push(r);return {threadId:randomUUID(),turnId:randomUUID(),text:'{"reply":"收到"}'}}}})
 cleanup.push(async()=>{await h.close();rmSync(root,{recursive:true,force:true})})
 h.scopes.command({action:'scope.put',operationId:'setup',expectedRevision:0,scope:{id:'team',tenantId:'org',name:'Team',managers:[JSON.stringify(['local','operator'])],workerIds:['one'],sourceIds:['local'],backendIds:['codex']}})
 const chat=(owner:string)=>{const conversation=h.chat.create(owner),run=h.chat.send(conversation.id,owner,{clientMessageId:randomUUID(),text:'请记住：技术报告先给结论'}),trigger=h.store.triggers.get(run.runId)!,c=h.scopes.context(trigger,'local:chat:'+conversation.id)!;return {conversation,c,entryId:c.route.entryId}}
 const note=(c:ReturnType<typeof chat>['c'],text:string,candidate=false)=>h.memory.command(c,{action:'remember',operationId:randomUUID(),expectedRevision:0,subject:'报告方式',content:text,kind:'preference',sourceIds:[h.memory.ingest(c).id],candidate,visibility:'private',learning:{inferred:false,condition:'技术报告'}},true) as MemoryFact
 return {h,chat,note,calls}
}
it('shows only the signed-in owner’s private memories and rejects cross-owner writes',async()=>{
 const f=fixture(),a=f.chat('alice'),b=f.chat('bob'),note=f.note(a.c,'Alice 的报告偏好');f.note(b.c,'Bob 的报告偏好')
 const alice=memoryWorkspace(f.h,'alice');expect(alice.contexts.map(c=>c.id)).toEqual([a.entryId]);expect(alice.contexts[0]!.items.map(f=>f.content)).toContain(note.content)
 expect(JSON.stringify(alice)).not.toContain('Bob 的报告偏好')
 await expect(changeMemoryWorkspace(f.h,'bob',{action:'edit',entryId:a.entryId,id:note.id,revision:note.revision,content:'跨用户修改'})).rejects.toThrow('unavailable')
 f.h.chat.reset('alice',randomUUID());expect(memoryContexts(f.h,'alice')).toEqual([]);expect(memoryWorkspace(f.h,'bob').contexts).toHaveLength(1)
})
it('imports candidates idempotently, dismisses without suppressing source, and keeps edits revisioned',async()=>{
 const f=fixture(),a=f.chat('alice'),note=f.note(a.c,'先给结论'),policy=f.h.agentMemory.policy(a.c)
 const input={entryId:a.entryId,action:'import',file:'USER.md',text:'# USER.md\n\n- 喜欢简短的日报\n- 每周五看周报',operationId:randomUUID()}
 await changeMemoryWorkspace(f.h,'alice',input);await changeMemoryWorkspace(f.h,'alice',input)
 let view=memoryWorkspace(f.h,'alice').contexts[0]!,candidates=view.items.filter(f=>f.state==='candidate');expect(candidates).toHaveLength(2)
 await changeMemoryWorkspace(f.h,'alice',{entryId:a.entryId,action:'dismiss',id:candidates[0]!.id,revision:candidates[0]!.revision})
 expect(f.h.memory.fact(note.id)?.state).toBe('active');expect(f.h.memory.evidence(note.sources[0]!.id)?.revoked).toBeFalsy()
 await changeMemoryWorkspace(f.h,'alice',{entryId:a.entryId,action:'confirm',id:candidates[1]!.id,revision:candidates[1]!.revision})
 await changeMemoryWorkspace(f.h,'alice',{entryId:a.entryId,action:'edit',id:note.id,revision:note.revision,content:'先列验证结果',condition:'代码报告'})
 await expect(changeMemoryWorkspace(f.h,'alice',{entryId:a.entryId,action:'edit',id:note.id,revision:note.revision,content:'过期编辑'})).rejects.toThrow('changed')
 const edited=f.h.memory.fact(note.id)!;expect(edited.sources).toEqual(note.sources);expect(f.h.agentMemory.cooperation(a.c)).toContainEqual(expect.objectContaining({content:'先列验证结果',condition:'代码报告'}))
 await changeMemoryWorkspace(f.h,'alice',{entryId:a.entryId,action:'forget',id:edited.id,revision:edited.revision})
 expect(f.h.agentMemory.cooperation(memoryContexts(f.h,'alice')[0]!.context).some(f=>f.id===note.id)).toBe(false)
 const exported=await changeMemoryWorkspace(f.h,'alice',{entryId:a.entryId,action:'export',file:'USER.md'});expect(JSON.stringify(exported)).not.toContain('先列验证结果')
 expect(f.h.agentMemory.policy(a.c)).toEqual(policy)
})
it('preserves an existing auto learning policy across pause/resume and rejects stale changes',async()=>{
 const f=fixture(),a=f.chat('alice');f.h.agentMemory.manage(a.c,{action:'configure',expectedRevision:0,policy:{writeMode:'auto',maxCallsPerDay:7}})
 await changeMemoryWorkspace(f.h,'alice',{entryId:a.entryId,action:'learning',enabled:false,revision:1})
 expect(f.h.agentMemory.policy(a.c)).toMatchObject({writeMode:'explicit_only',maxCallsPerDay:7})
 await expect(changeMemoryWorkspace(f.h,'alice',{entryId:a.entryId,action:'learning',enabled:true,revision:1})).rejects.toThrow('revision')
 await changeMemoryWorkspace(f.h,'alice',{entryId:a.entryId,action:'learning',enabled:true,revision:2})
 expect(f.h.agentMemory.policy(a.c)).toMatchObject({writeMode:'auto',maxCallsPerDay:7})
})
it('round trips personality files through revisioned settings and shares preview with actual execution',async()=>{
 const f=fixture(),rev=f.h.settings.current().revision
 importPersonaFile(f.h,{agentId:'router',file:'IDENTITY.md',text:'# IDENTITY.md\n\nName: Roppo\n\n项目协调助手',revision:rev})
 importPersonaFile(f.h,{agentId:'router',file:'SOUL.md',text:'# SOUL.md\n\n简洁、坦诚，有自己的判断',revision:rev+1})
 importPersonaFile(f.h,{agentId:'one',file:'SOUL.md',text:'重视证据的执行者',revision:rev+2})
 const files=personaFiles(f.h,{agentId:'router'});expect(files.files['IDENTITY.md']).toContain('Name: Roppo');expect(files.files['SOUL.md']).toContain('坦诚')
 expect(()=>importPersonaFile(f.h,{agentId:'router',file:'SOUL.md',text:'陈旧修改',revision:rev})).toThrow()
 const preview=previewInstructions(f.h.config,{role:'router'});expect(preview.text).toContain('项目协调助手');expect(preview.text.match(/简洁、坦诚/g)).toHaveLength(1);expect(preview.text).not.toContain('重视证据的执行者')
 f.chat('alice');for(let i=0;i<100&&!f.calls.length;i++){await f.h.tick();await new Promise(r=>setTimeout(r,3))}
 expect(f.calls[0]!.instructions).toContain('简洁、坦诚');expect(f.calls[0]!.instructions.match(/简洁、坦诚/g)).toHaveLength(1)
})
