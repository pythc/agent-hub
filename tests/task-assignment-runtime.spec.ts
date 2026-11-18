import {afterEach,it,expect,vi} from 'vitest'
import {mkdtempSync,rmSync,existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {configSchema} from '../src/config.ts'
import {Runtime} from '../src/runtime.ts'
import type {Model,ModelRequest} from '../src/model.ts'
import {ExecutionTrace} from '../src/execution-trace.ts'
const hosts:Runtime[]=[],roots:string[]=[]
afterEach(async()=>{vi.restoreAllMocks();for(const h of hosts.splice(0))await h.close();for(const p of roots.splice(0))rmSync(p,{recursive:true,force:true})})
const result=JSON.stringify({state:'ready',summary:'Implemented',reply:'Done',question:null,askedBy:null,handbacks:[]})
async function until(host:Runtime,done:()=>boolean){for(let i=0;i<400;i++){if(done())return;await host.tick();await new Promise(r=>setTimeout(r,3))}throw Error('Did not settle '+JSON.stringify(host.store.db.prepare('SELECT id,state,error FROM jobs').all()))}
function fixture(model:Model,driver:'disabled'|'seatbelt'|'bubblewrap'='disabled'){
 const root=mkdtempSync(join(tmpdir(),'assignment-runtime-'));roots.push(root)
 const config=configSchema.parse({stateDir:join(root,'state'),acceptMode:'auto',work:{sandboxDriver:driver,autoRecover:false},execution:{router:{mode:'host'},management:{enabled:true,maxWorkers:2},workers:[{id:'front',backend:'codex'},{id:'back',backend:'codex'}]},sources:[{id:'local',kind:'local',cwd:root,workspace:{mode:'source'},allowedActors:['alice']}]})
 const host=new Runtime(config,{model});hosts.push(host)
 host.scopes.command({action:'scope.put',operationId:'scope',expectedRevision:0,scope:{id:'team',tenantId:'org',name:'Team',managers:[JSON.stringify(['local','alice'])],workerIds:['front','back'],sourceIds:['local'],backendIds:['codex']}})
 host.scopes.command({action:'entry.bind',operationId:'entry',expectedRevision:0,scopeId:'team',sourceId:'local',accountNamespace:'local',nativeId:'topic',history:'group'})
 const incoming=host.receive('local','alice',{id:'request',thread:'topic',scope:'topic',text:'Implement the frontend and backend against the same interface.',addressed:true}) as {triggerId:string}
 const scoped=host.scopes.context(host.store.triggers.get(incoming.triggerId)!,'local:topic')!,context={trigger:scoped.trigger,scoped,discussion:'local:topic'}
 return {host,config,context,root}
}
const shared={key:'Orders API',version:1,inputs:['GET /orders'],outputs:['JSON orders array'],acceptance:['Both sides use the same schema']}
it('previews without writes and executes two real Worker activations against one immutable interface with host tool ceilings',async()=>{
 const calls:ModelRequest[]=[],denials:unknown[]=[]
 const f=fixture({async run(r){if(r.role==='worker'){calls.push(r);expect(r.tools?.map(t=>t.name)).toEqual(['superagent_progress']);denials.push(await r.onTool!('superagent_shell',{command:'touch forbidden',requestId:'forbidden'},'forbidden'));await r.onTool!('superagent_progress',{summary:'Following shared interface'},'progress');return {threadId:'thread-'+calls.length,turnId:'turn-'+calls.length,text:result}}return {threadId:'router',turnId:'router',text:'{"reply":""}'}}})
 const snapshot=()=>JSON.stringify({records:f.host.store.db.prepare('SELECT * FROM records ORDER BY kind,id').all(),jobs:f.host.store.db.prepare('SELECT * FROM jobs ORDER BY id').all(),tickets:f.host.store.tickets.list(),deliveries:f.host.store.deliveries()})
 const before=snapshot(),spec={interface:shared,allowedTools:['superagent_progress'],allowedConnections:[],workspace:{mode:'read-only'},limits:{timeoutMs:1000}}
 const preview=await f.host.manager.call({action:'preview_assign',id:'front',assignment:spec},f.context)
 expect(snapshot()).toBe(before);expect(preview.interface.version).toBe(1)
 const a=await f.host.manager.call({action:'assign',id:'front',text:'Implement frontend',revision:0,requestId:'front',assignment:spec},f.context)
 const b=await f.host.manager.call({action:'assign',id:'back',text:'Implement backend',revision:0,requestId:'back',assignment:{...spec,interface:{id:preview.interface.id,digest:preview.interface.digest}}},f.context)
 expect(a.taskAssignment.contract.interface.digest).toBe(b.taskAssignment.contract.interface.digest)
 await until(f.host,()=>calls.length===2&&[a,b].every(t=>f.host.store.tickets.get(t.ticketId)?.ended))
 for(const request of calls){expect(request.instructions).toContain(preview.interface.digest);expect(request.instructions).toContain('Orders API');expect(request.sandbox).toBe('read-only');expect(request.options?.timeoutMs).toBe(1000)}
 expect(denials).toEqual([expect.objectContaining({success:false}),expect.objectContaining({success:false})]);expect(f.host.work.list()).toEqual([])
 expect(f.host.store.list('task-workspace-lease')).toHaveLength(2)
 expect(f.host.store.db.prepare('PRAGMA user_version').get()!.user_version).toBe(19)
 const trace=JSON.stringify(new ExecutionTrace(()=>f.host).snapshot())
 expect(trace).toContain('Orders API');expect(trace).not.toContain(f.root)
})
it('rejects unavailable capabilities without creating tasks and prevents a queued old-interface assignment from starting',async()=>{
 const executed:string[]=[]
 const f=fixture({async run(r){if(r.role==='worker'){executed.push(r.activity!.ticketId!);return {threadId:'worker',turnId:'done',text:result}}return {threadId:'router',turnId:'router',text:'{"reply":""}'}}})
 const tasks=f.host.store.tickets.list().length
 await expect(f.host.manager.call({action:'assign',id:'front',text:'Impossible',revision:0,requestId:'unavailable',assignment:{requiredTools:['superagent_shell']}},f.context)).rejects.toThrow('required_tool_unavailable')
 expect(f.host.store.tickets.list()).toHaveLength(tasks)
 const a=await f.host.manager.call({action:'assign',id:'front',text:'Old interface',revision:0,requestId:'old',assignment:{interface:shared}},f.context)
 const b=await f.host.manager.call({action:'assign',id:'back',text:'New interface',revision:0,requestId:'new',assignment:{interface:{...shared,version:2,outputs:['JSON orders page']}}},f.context)
 await until(f.host,()=>f.host.store.tickets.get(b.ticketId)?.ended!==undefined)
 expect(executed).not.toContain(a.ticketId);expect(executed).toContain(b.ticketId)
 const old=await f.host.manager.call({action:'inspect',ticketId:a.ticketId},f.context)
 expect(old.taskAssignment.contract.interface.version).toBe(1);expect(old.taskAssignment.blocker).toMatch(/interface_superseded/)
})

it('enforces a read-only assignment at the actual managed shell boundary',async()=>{
 let request:ModelRequest|undefined,release!:()=>void;const gate=new Promise<void>(r=>release=r)
 const f=fixture({async run(r){if(r.role==='worker'){request=r;await gate;return {threadId:'worker',turnId:'done',text:result}}return {threadId:'router',turnId:'done',text:'{"reply":""}'}}},process.platform==='darwin'?'seatbelt':'bubblewrap')
 const task=await f.host.manager.call({action:'assign',id:'front',revision:0,requestId:'readonly-shell',text:'Inspect without changing files',assignment:{workspace:{mode:'read-only'},requiredTools:['superagent_shell']}},f.context)
 try{
  await until(f.host,()=>!!request)
  expect(request!.sandbox).toBe('read-only')
  await request!.onTool!('superagent_shell',{command:'printf assignment-shell-entered; printf forbidden > assignment-must-not-write.txt',requestId:'readonly-write'},'readonly-write')
  await until(f.host,()=>f.host.work.list(task.ticketId).some(w=>!['starting','running'].includes(w.state)))
  const work=f.host.work.list(task.ticketId);expect(work).toHaveLength(1);expect(work[0]!.state).toBe('failed');expect(work[0]!.sandbox).toBe('read-only');expect(f.host.work.read({...work[0]!},work[0]!.id).output).toContain('assignment-shell-entered')
  expect(existsSync(join(f.root,'assignment-must-not-write.txt'))).toBe(false)
 }finally{release()}
})

it('rechecks the assignment before retrying a transient provider failure',async()=>{
 let calls=0
 const f=fixture({async run(r){if(r.role==='worker'){calls++;throw Error('HTTP 429 controlled retry')}return {threadId:'router',turnId:'done',text:'{"reply":""}'}}})
 const task=await f.host.manager.call({action:'assign',id:'front',revision:0,requestId:'retry-old',text:'Implement v1',assignment:{interface:shared}},f.context)
 await until(f.host,()=>calls===1)
 await f.host.manager.call({action:'assign',id:'back',revision:0,requestId:'retry-new',text:'Implement v2',assignment:{interface:{...shared,version:2}}},f.context)
 // Do not tick the new assignment. Wait for the original provider retry loop only.
 await new Promise(r=>setTimeout(r,1200))
 expect(calls).toBe(1)
 expect(f.host.activity.list().filter(a=>a.ticketId===task.ticketId&&a.state==='running')).toEqual([])
})
