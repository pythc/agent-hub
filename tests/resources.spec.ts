import {mkdtempSync,writeFileSync,mkdirSync,rmSync,symlinkSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {it,expect,afterEach} from 'vitest'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
import type {Model} from '../src/codex.ts'
const roots:string[]=[],hosts:Runtime[]=[]
afterEach(async()=>{for(const h of hosts.splice(0))await h.close();for(const r of roots.splice(0))rmSync(r,{recursive:true,force:true})})
async function fixture(){
 const root=mkdtempSync(join(tmpdir(),'resource-reader-'));roots.push(root);const cwd=join(root,'project');mkdirSync(cwd)
 const config=configSchema.parse({stateDir:join(root,'state'),sources:[{id:'local',kind:'local',cwd,allowedActors:['operator']}]})
 const model:Model={async run(r){r.onThread?.('native-test');r.onTurn?.('turn-'+Date.now());return{threadId:r.threadId??'native-test',turnId:'one',text:JSON.stringify(r.ephemeral?{action:'accept',title:'Read',scope:'Read test files',rules:[],reason:'requested'}:{state:'waiting',summary:'Waiting',reply:'',question:null,handbacks:[]})}}}
 const h=new Runtime(config,{model});hosts.push(h);h.receive('local','operator',{id:'request',thread:'topic',text:'Read',addressed:true})
 for(let i=0;i<30&&!h.store.list('run').length;i++){await h.tick();await new Promise(r=>setTimeout(r,5))}
 for(let i=0;i<10;i++){await h.tick();await new Promise(r=>setTimeout(r,5))}
 const t=h.store.tickets.list()[0]!,owner={ticketId:t.id,assignmentId:t.assignments.at(-1)!.id,cwd,sandbox:'read-only' as const,depth:0}
 return {h,cwd,root,t,owner}
}
it('paginates stable text snapshots and keeps cursors scoped to their reader',async()=>{
 const f=await fixture();writeFileSync(join(f.cwd,'large.txt'),'abcdef')
 const first=await f.h.resources.read({resource:'files/large.txt',limit:3},f.owner)
 writeFileSync(join(f.cwd,'large.txt'),'changed')
 const second=await f.h.resources.read({resource:'files/large.txt',limit:3,offset:first.nextOffset,cursor:first.cursor},f.owner)
 expect(first.text+second.text).toBe('abcdef')
 await expect(f.h.resources.read({resource:'files/large.txt',cursor:first.cursor},{...f.owner,ticketId:'other'})).rejects.toThrow('cursor')
})
it('refuses global records, another task, stale prompts, escaping paths and symlinks',async()=>{
 const f=await fixture();writeFileSync(join(f.root,'outside.txt'),'private');symlinkSync(join(f.root,'outside.txt'),join(f.cwd,'link'))
 for(const resource of ['tickets','settings','decision/other','ticket/other','files/../outside.txt','files/link','prompts/999'])await expect(f.h.resources.read({resource},f.owner)).rejects.toThrow()
 const current=await f.h.resources.read({resource:'ticket/'+f.t.id+'/assignment'},f.owner)
 expect(current.text).toContain('Read test files')
})
it('returns actual image bytes through the scoped native tool bridge',async()=>{
 const f=await fixture(),data=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+yR5cAAAAASUVORK5CYII=','base64');writeFileSync(join(f.cwd,'one.png'),data)
 const response=await f.h.workerTools.call(f.owner,'superagent_read',{resource:'image/one.png'})
 expect(response.contentItems[0]).toMatchObject({type:'inputImage',imageUrl:'data:image/png;base64,'+data.toString('base64')})
 f.h.engine.stopTicket(f.t.id,'stop')
 await expect(f.h.workerTools.call(f.owner,'superagent_read',{resource:'catalog'})).rejects.toThrow('ended')
})
it('labels native thread and turn identities separately in history resources',async()=>{
 const f=await fixture()
 f.h.model.history=async()=>({id:'native-test',turns:[{id:'turn-first',status:'completed'},{id:'turn-second',status:'completed'}]})
 const list=await f.h.resources.read({resource:'ticket/'+f.t.id+'/transcript'},f.owner)
 expect(list.items[0]).toMatchObject({id:'turn-second',nativeThreadId:'native-test',nativeTurnId:'turn-second'})
 const message=await f.h.resources.read({resource:'ticket/'+f.t.id+'/message/1'},f.owner)
 expect(message.text).toContain('"nativeThreadId": "native-test"')
 expect(message.text).toContain('"nativeTurnId": "turn-first"')
})
it('describes the subagent backend in its catalog rather than the parent worker backend',async()=>{
 const f=await fixture();f.h.store.put('work','child',{threadId:'child-conversation'})
 f.h.model.describe=(threadId,role)=>({id:threadId==='child-conversation'&&role==='subagent'?'child-backend':'parent-backend',kind:'anthropic',nativeTakeover:false,images:false,resume:true,tools:true,steering:true,promptRefresh:true})
 expect((await f.h.resources.read({resource:'catalog'},{...f.owner,agentId:'child'})).backend.id).toBe('child-backend')
 expect((await f.h.resources.read({resource:'catalog'},f.owner)).backend.id).toBe('parent-backend')
})
it('fences worker grants to an assignment instead of the admin identity',async()=>{
 const f=await fixture(),grant=f.h.workerTools.grant(f.owner)
 const {readFileSync}=await import('node:fs');const header='Bearer '+readFileSync(grant,'utf8')
 expect(f.h.workerTools.authenticate(header).ticketId).toBe(f.t.id)
 f.h.engine.report(f.t.id,{state:'blocked',summary:'test'});f.h.engine.retryTicket(f.t.id)
 expect(()=>f.h.workerTools.authenticate(header)).toThrow('expired')
})

it('previews member policy changes and rejects stale or empty directory snapshots',async()=>{
 const f=await fixture(),source=f.h.sources.get('local')!
 source.members=async()=>[{id:'new-person',name:'New'},{id:'bot',bot:true}]
 const preview=await f.h.setup.previewMembers('local')
 expect(f.h.config.sources[0]!.allowedActors).toEqual(['operator'])
 f.h.setup.applyMembers(preview.id)
 expect(f.h.config.sources[0]!.allowedActors).toEqual(['new-person'])
 expect(()=>f.h.setup.applyMembers(preview.id)).toThrow('conflict')
 source.members=async()=>[]
 await expect(f.h.setup.previewMembers('local')).rejects.toThrow('Empty')
 expect(f.h.config.sources[0]!.allowedActors).toEqual(['new-person'])
})
it('supports all original prompt keys and validates generated placeholders',async()=>{
 const f=await fixture(),{builtins,compose}=await import('../src/prompts.ts')
 const keys=['runtime/shared','runtime/orchestrator','runtime/worker','runtime/subscriptions','runtime/replies','runtime/dispatch','runtime/work','runtime/admission','runtime/handoff/orchestrator','runtime/handoff/worker','runtime/environment','runtime/policy','runtime/policy/none','skill/feishu','skill/github']
 expect(keys.every(k=>k in builtins)).toBe(true)
 expect(()=>configSchema.parse({...f.h.config,prompts:{overrides:{'runtime/environment':{text:'missing variables',base:'a'.repeat(64)}}}})).toThrow('placeholders')
 const prompts={...f.h.config.prompts,overrides:{'runtime/work':{text:'Work override marker',base:'a'.repeat(64)}}}
 expect(compose({...f.h.config,prompts},'worker',{},'p')).toContain('Work override marker')
})
it('does not allow source resource aliases to bypass a worker conversation scope',async()=>{
 const f=await fixture(),c=configSchema.parse({sources:[{id:'github',kind:'github',cwd:'.',repository:'owner/repo'}]}).sources[0]!
 f.h.sources.set('github',{config:c,trigger:()=>{throw Error('unused')},deliver:async()=>{},read:async()=>({secret:true})})
 const ticket={...f.t,mandate:{...f.t.mandate,actor:{source:'github',id:'operator'}}};f.h.store.tickets.save(ticket)
 for(const resource of ['source/github/github/issues/999','source/github/issues/999'])await expect(f.h.resources.read({resource},f.owner)).rejects.toThrow('outside')
})

it('exercises every host resource family through the shared paginated reader',async()=>{
 const f=await fixture(),t=f.h.store.tickets.get(f.t.id)!,assignment=t.assignments.at(-1)!
 f.h.engine.note(t.id,'resource-input');const input=f.h.store.tickets.get(t.id)!.inputs.at(-1)!
 f.h.store.put('work','completed-job',{id:'completed-job',ticketId:t.id,assignmentId:assignment.id,kind:'shell',state:'completed',notify:'collected',createdAt:Date.now()})
 writeFileSync(join(f.cwd,'asset.txt'),'asset-evidence');f.h.store.put('asset','asset-id',{ticketId:t.id,path:join(f.cwd,'asset.txt')})
 const scoped=['thread/local:topic','trigger/local:request','ticket/'+t.id,'ticket/'+t.id+'/assignment','ticket/'+t.id+'/assignments','ticket/'+t.id+'/inputs','ticket/'+t.id+'/input/'+input.id,'ticket/'+t.id+'/result','ticket/'+t.id+'/report/'+assignment.id,'ticket/'+t.id+'/transcript','ticket/'+t.id+'/message/0','prompts/current','prompts/0','jobs','job/completed-job','asset/asset-id','files/asset.txt','directory/']
 for(const resource of scoped)expect(await f.h.resources.read({resource},f.owner),resource).toBeDefined()
 const decision=f.h.store.list<any>('decision')[0]!
 const admin=['tickets','triggers','threads','decisions','decision/'+decision.id,'settings','settings/work','settings/delivery','prompts','prompts/defaults','prompt-preview/worker','prompt-preview/router','models','models/codex']
 for(const resource of admin)expect(await f.h.resources.read({resource}),resource).toBeDefined()
})
