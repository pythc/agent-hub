import {afterEach,it,expect,vi} from 'vitest'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {configSchema} from '../src/config.ts'
import {Runtime} from '../src/runtime.ts'
import type {Model,ModelRequest} from '../src/model.ts'
import {currentTaskAssignment} from '../src/task-assignment-contract.ts'
const hosts:Runtime[]=[],roots:string[]=[]
afterEach(async()=>{vi.restoreAllMocks();for(const h of hosts.splice(0))await h.close();for(const p of roots.splice(0))rmSync(p,{recursive:true,force:true})})
const result=JSON.stringify({state:'ready',summary:'Implemented',reply:'Done',question:null,askedBy:null,handbacks:[]})
async function until(host:Runtime,done:()=>boolean){for(let i=0;i<400;i++){if(done())return;await host.tick();await new Promise(r=>setTimeout(r,3))}throw Error('Did not settle '+JSON.stringify(host.store.db.prepare('SELECT id,state,error FROM jobs').all()))}
function fixture(mode:'host'|'client'='host'){
 const calls:ModelRequest[]=[];const model:Model={async run(r){if(r.role==='worker')calls.push(r);const threadId='native-'+calls.length;r.onThread?.(threadId);return {threadId,turnId:'turn-'+calls.length,text:r.role==='worker'?result:'{"reply":""}'}}}
 const root=mkdtempSync(join(tmpdir(),'assignment-runtime-'));roots.push(root)
 const config=configSchema.parse({stateDir:join(root,'state'),acceptMode:'auto',work:{sandboxDriver:'disabled',autoRecover:false},execution:{router:{mode},management:{enabled:true,maxWorkers:2},workers:[{id:'front',backend:'codex'},{id:'back',backend:'codex'}]},sources:[{id:'local',kind:'local',cwd:root,workspace:{mode:'source'},allowedActors:['alice']}]})
 const host=new Runtime(config,{model});hosts.push(host)
 if(mode==='client')return {host,config,root,calls,context:undefined as any,admit:(_id:string,_text:string):any=>{throw Error('Client fixture has no scoped context')}}
 host.scopes.command({action:'scope.put',operationId:'scope',expectedRevision:0,scope:{id:'team',tenantId:'org',name:'Team',managers:[JSON.stringify(['local','alice'])],workerIds:['front','back'],sourceIds:['local'],backendIds:['codex']}})
 host.scopes.command({action:'entry.bind',operationId:'entry',expectedRevision:0,scopeId:'team',sourceId:'local',accountNamespace:'local',nativeId:'topic',history:'group'})
 const incoming=host.receive('local','alice',{id:'request',thread:'topic',scope:'topic',text:'Implement the frontend and backend against the same interface.',addressed:true}) as {triggerId:string}
 const scoped=host.scopes.context(host.store.triggers.get(incoming.triggerId)!,'local:topic')!,context={trigger:scoped.trigger,scoped,discussion:'local:topic'}
 const admit=(id:string,text:string)=>{const event=host.receive('local','alice',{id,thread:'topic-'+id,scope:'topic',text,addressed:true}) as {triggerId:string};const trigger=host.store.triggers.get(event.triggerId)!,scoped=host.scopes.context(trigger,'local:topic-'+id)!;return {trigger,scoped,discussion:scoped.route.discussion,manifest:host.memory.build(scoped,{request:text},'test').manifest}}
 return {host,config,context,root,calls,admit}
}

const spec={allowedTools:['superagent_progress'],allowedConnections:[],workspace:{mode:'read-only'},limits:{timeoutMs:1000}}
async function assigned(f:ReturnType<typeof fixture>,text='Original task',context=f.context){const a=await f.host.manager.call({action:'assign',id:'front',text,revision:0,requestId:'assign',assignment:spec},context);await until(f.host,()=>!!f.host.store.tickets.get(a.ticketId)?.ended);await f.host.flush();return a.ticketId as string}
it('revises an idle completed assignment on migration without running, preserving initial contract and ceilings',async()=>{
 const f=fixture(),id=await assigned(f),initial=f.host.store.get<any>('task-assignment-contract',id),calls=f.calls.length
 await f.host.manager.call({action:'configure',id:'front',patch:{model:'other',timeoutMs:5000},revision:0,requestId:'configure'})
 const migration=await f.host.manager.call({action:'migrate',ticketId:id,revision:1,requestId:'migrate'},f.context)
 expect(migration.status).toBe('awaiting_followup');expect(f.calls).toHaveLength(calls);expect(f.host.store.get('task-assignment-contract',id)).toEqual(initial)
 const revised=currentTaskAssignment(f.host,id)!;expect(revised.revision).toBe(2);expect(revised.previousDigest).toBe(initial.digest);expect(revised.cause?.kind).toBe('migration');expect(revised.effective.tools).toEqual(initial.effective.tools);expect(revised.effective.connections).toEqual(initial.effective.connections);expect(revised.effective.sandbox).toBe('read-only');expect(revised.effective.options.timeoutMs).toBe(1000)
 for(let n=0;n<3;n++)await f.host.tick();expect(f.calls).toHaveLength(calls)
 await f.host.manager.call({action:'send',ticketId:id,text:'Continue once',revision:1,requestId:'follow'},f.context);await until(f.host,()=>f.calls.length>calls&&!!f.host.store.tickets.get(id)?.ended);expect(f.calls.at(-1)!.model).toBe('other');expect(f.calls.at(-1)!.options?.timeoutMs).toBe(1000)
})
it('permission rebuild quarantines old contract text and keeps effective ceilings without automatic execution',async()=>{
 const f=fixture(),first=f.admit('old','OLD-PRIVATE-7319'),id=await assigned(f,'OLD-PRIVATE-7319',first),initial=f.host.store.get<any>('task-assignment-contract',id)
 f.host.sourceChanged('local',{id:'permission-change',kind:'entry.permissions_changed',scope:'topic',at:Date.now()});const fresh=f.admit('fresh','Calculate 2+2 from public inputs'),calls=f.calls.length
 const rebuilt=await f.host.manager.call({action:'rebuild',ticketId:id,text:'Calculate 2+2',workspaceReviewed:true,requestId:'rebuild',revision:0},fresh)
 expect(rebuilt.status).toBe('awaiting_followup');expect(f.calls).toHaveLength(calls);expect(f.host.store.get('task-assignment-contract',id)).toEqual(initial)
 const revised=currentTaskAssignment(f.host,id)!;expect(revised.cause?.kind).toBe('rebuild');expect(revised.objective).not.toContain('OLD-PRIVATE-7319');expect(revised.effective.tools).toEqual(initial.effective.tools);expect(revised.effective.options.timeoutMs).toBe(1000)
 expect(JSON.stringify(await f.host.resources.read({resource:'ticket/'+id},{ticketId:id}))).not.toContain('OLD-PRIVATE-7319')
 await f.host.manager.call({action:'send',ticketId:id,text:'Recheck 2+2 now',requestId:'follow',revision:0},fresh);await until(f.host,()=>f.calls.length>calls&&!!f.host.store.tickets.get(id)?.ended)
 expect(f.calls.at(-1)!.input+f.calls.at(-1)!.instructions).not.toContain('OLD-PRIVATE-7319');expect(f.calls.at(-1)!.threadId).toBeUndefined()
})
it('rolls back migration session and revision state when saving the revision fails',async()=>{
 const f=fixture(),id=await assigned(f),initial=f.host.store.get('task-assignment-contract',id),run=f.host.store.get('run',id),pointer=f.host.store.get('task-assignment-current',id),put=f.host.store.put.bind(f.host.store)
 vi.spyOn(f.host.store,'put').mockImplementation((kind:string,key:string,value:any)=>{if(kind==='task-assignment-revision')throw Error('injected revision write failure');return put(kind,key,value)})
 await expect(f.host.manager.call({action:'migrate',ticketId:id,revision:0,requestId:'failed-migrate'},f.context)).rejects.toThrow('injected revision write failure')
 expect(f.host.store.get('run',id)).toEqual(run);expect(f.host.store.get('task-assignment-contract',id)).toEqual(initial);expect(f.host.store.get('task-assignment-current',id)).toEqual(pointer);expect(f.host.store.list('worker-migration')).toEqual([]);expect(f.host.store.list('task-assignment-revision')).toEqual([])
})

it('refuses migration while a real client result is pending, then succeeds after flush',async()=>{
 const f=fixture('client'),a=await f.host.manager.call({action:'assign',id:'front',text:'Return a result',revision:0,requestId:'assign',discussion:'cli-main',assignment:spec})
 await until(f.host,()=>!!f.host.store.tickets.get(a.ticketId)?.ended)
 expect(f.host.store.deliveries().some(d=>d.ticketId===a.ticketId&&['pending','held'].includes(d.status))).toBe(true)
 const initial=f.host.store.get('task-assignment-contract',a.ticketId),run=f.host.store.get('run',a.ticketId)
 await expect(f.host.manager.call({action:'migrate',ticketId:a.ticketId,revision:0,requestId:'pending-migrate'})).rejects.toThrow('Reconcile')
 expect(f.host.store.get('run',a.ticketId)).toEqual(run);expect(f.host.store.get('task-assignment-contract',a.ticketId)).toEqual(initial)
 await f.host.flush();expect(f.host.store.deliveries().filter(d=>d.ticketId===a.ticketId).every(d=>d.status==='sent')).toBe(true)
 expect((await f.host.manager.call({action:'migrate',ticketId:a.ticketId,revision:0,requestId:'flushed-migrate'})).status).toBe('awaiting_followup');expect(f.calls).toHaveLength(1)
})
