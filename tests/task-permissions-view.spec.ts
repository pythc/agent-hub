import {taskPermissionsView} from '../src/task-permissions-view.ts'
import {stableDigest} from '../src/sources.ts'
import {afterEach,expect,it,vi} from 'vitest'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
import {taskDecisionsView} from '../src/task-decisions-view.ts'
import {serve} from '../src/server.ts'
import {operatorTask} from '../src/operator-workspace.ts'
const roots:string[]=[],hosts:Runtime[]=[],servers:Awaited<ReturnType<typeof serve>>[]=[]
afterEach(async()=>{vi.restoreAllMocks();for(const s of servers.splice(0)){s.server.closeAllConnections();await new Promise<void>(r=>s.server.close(()=>r()))}for(const h of hosts.splice(0))await h.close();for(const path of roots.splice(0))rmSync(path,{force:true,recursive:true})})
async function fixture(secondManager=false){
 const root=mkdtempSync(join(tmpdir(),'task-decisions-'));roots.push(root)
 const model={run:vi.fn(async()=>{throw Error('No model call allowed')}),history:vi.fn(async()=>{throw Error('No history call allowed')})}
 const h=new Runtime(configSchema.parse({stateDir:join(root,'state'),port:0,watchdog:{enabled:false},work:{sandboxDriver:'disabled',network:false,autoRecover:false},execution:{router:{mode:'host'},management:{enabled:true,maxWorkers:1},workers:[{id:'one',backend:'codex'}]},sources:[{id:'local',kind:'local',cwd:root,workspace:{mode:'source'},allowedActors:['alice','bob']}]}),{model});hosts.push(h);h.pause(true)
 h.scopes.command({action:'scope.put',operationId:'scope',expectedRevision:0,scope:{id:'team',tenantId:'local',name:'Team',managers:[JSON.stringify(['local','alice']),...(secondManager?[JSON.stringify(['local','bob'])]:[])],workerIds:['one'],sourceIds:['local'],backendIds:['codex']}})
 for(const nativeId of ['topic','other'])h.scopes.command({action:'entry.bind',operationId:nativeId,expectedRevision:0,scopeId:'team',sourceId:'local',accountNamespace:'local',nativeId,history:'group'})
 let sequence=0
 function receive(text:string,actor='alice',thread='topic'){
  const result=h.receive('local',actor,{id:'request-'+(++sequence),thread,scope:thread,text,addressed:true})as{triggerId:string},trigger=h.store.triggers.get(result.triggerId)!,context=h.scopes.context(trigger,'local:'+thread)!
  h.continuity.capture(context,[trigger.id]);const packet=h.memory.build(context,{request:text},'codex');return{trigger,context,packet}
 }
 const initial=receive('Please analyze the local note. You could consider adding a chart; do not deploy.')
 const assigned=await h.manager.call({action:'assign',id:'one',revision:h.settings.current().revision,requestId:'assign',text:'Analyze the local note'},{discussion:initial.context.route.discussion,trigger:initial.trigger,scoped:initial.context,manifest:initial.packet.manifest})
 const id=assigned.ticketId
 function record(kind:'requirement'|'decision'|'commitment',text:string,input=initial,op='record-'+(++sequence)){
  return h.continuity.command({action:'record',operationId:op,kind,text,sourceIds:[input.trigger.id]},input.context,input.packet.manifest)
 }
 const requirement=record('requirement','You could consider adding a chart; do not deploy.'),decision=record('decision','Compare two chart options before making a recommendation.')
 return{h,model,root,id,initial,requirement,decision,receive,record,read:()=>taskDecisionsView(h,id,1234)}
}
function db(h:Runtime){return JSON.stringify(h.store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row=>{const name=String(row.name);return[name,h.store.db.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'"').all()]}))}
it('explains current follow-up checks without issuing authority or writing any records',async()=>{
 const f=await fixture(),before=db(f.h);expect(taskPermissionsView(f.h,f.id,123)).toMatchObject({readOnly:true,authorization:false,reason:'current',execution:'not_assessed'});expect(db(f.h)).toBe(before);expect(f.model.run).not.toHaveBeenCalled()
})
it.each(['source','scope','member','request','private','ended'])('projects distinct safe guidance for %s, with no hidden names or mutations',async mode=>{
 const f=await fixture(),owner=f.h.scopes.ownership(f.id)!,entry=owner.originEntry
 if(mode==='source')f.h.config.sources[0]!.enabled=false
 if(mode==='scope')f.h.config.sources[0]!.listenScopes=['secret-other-conversation']
 if(mode==='member')f.h.store.put('source-member-state',stableDigest([entry,'alice']),{available:false})
 if(mode==='request'){const key=stableDigest([f.id,entry]);f.h.store.put('task-channel',key,{...f.h.store.get<any>('task-channel',key),request:false})}
 if(mode==='private')f.h.store.put('entry-binding',entry,{...f.h.scopes.binding(entry),privateActor:'alice'})
 if(mode==='ended')f.h.store.tickets.save({...f.h.store.tickets.get(f.id)!,ended:{at:new Date().toISOString(),reason:'completed'}} as any)
 const before=db(f.h),view=taskPermissionsView(f.h,f.id)
 if(mode==='private')expect(view).toBeUndefined()
 else expect(view?.reason).toBe(({source:'source_disabled',scope:'scope_not_listened',member:'member_not_admitted',request:'request_scope_missing',ended:'task_unavailable'}as any)[mode])
 expect(JSON.stringify(view)??'').not.toContain('secret-other-conversation');expect(db(f.h)).toBe(before)
})
it('does not let a previously current or forged explanation bypass the production host after revocation',async()=>{
 const f=await fixture(),view=taskPermissionsView(f.h,f.id)!;expect(view.reason).toBe('current')
 f.h.config.sources[0]!.allowedActors=[]
 expect(taskPermissionsView(f.h,f.id)?.reason).toBe('member_not_admitted')
 await expect(f.h.manager.call({action:'send',ticketId:f.id,revision:f.h.settings.current().revision,requestId:'revoked',text:'Continue'},{discussion:f.initial.context.route.discussion,trigger:f.initial.trigger,scoped:f.initial.context,manifest:f.initial.packet.manifest})).rejects.toThrow()
 await expect(f.h.manager.call({action:'send',ticketId:f.id,revision:f.h.settings.current().revision,requestId:'forged',text:'Continue',authorization:true,explain:view} as any)).rejects.toThrow()
 expect(f.model.run).not.toHaveBeenCalled()
})
it('serves a read-only explanation only through the authenticated operator HTTP path',async()=>{
 const f=await fixture()
 // serve starts the 150ms scheduler; pause does not suppress its health writes.
 // Isolate HTTP reads from that independent writer without excluding any DB rows.
 const start=vi.spyOn(f.h,'start').mockImplementation(()=>{})
 const server=await serve(f.h);servers.push(server);const url=server.url
 expect(start).toHaveBeenCalledOnce()
 const idle=db(f.h);await f.h.tick()
 expect(f.h.store.get('health','host')).toMatchObject({pid:process.pid})
 expect(db(f.h)).not.toBe(idle)
 const path='/entry-workspace/task/'+encodeURIComponent(f.id)
 expect((await fetch(url+path)).status).toBe(401)
 const before=db(f.h),r=await fetch(url+path,{headers:{Authorization:'Bearer '+readFileSync(server.tokenPath,'utf8').trim()}})
 expect(r.status).toBe(200);expect((await r.json() as any).permissions.reason).toBe('current');expect(db(f.h)).toBe(before)
 expect((await fetch(url+path,{method:'POST',headers:{Authorization:'Bearer '+readFileSync(server.tokenPath,'utf8').trim(),Origin:'https://foreign.invalid','Content-Type':'application/json'},body:JSON.stringify({authorization:true})})).status).toBe(403)
 f.h.config.sources[0]!.allowedActors=[]
 const revoked=await fetch(url+path,{headers:{Authorization:'Bearer '+readFileSync(server.tokenPath,'utf8').trim()}});expect((await revoked.json() as any).permissions.reason).toBe('member_not_admitted')
 const foreign=await fetch(url+'/entry-workspace/task/missing',{headers:{Authorization:'Bearer '+readFileSync(server.tokenPath,'utf8').trim()}});expect(foreign.status).toBe(404)
 expect(f.model.run).not.toHaveBeenCalled()
})
it('distinguishes a requester/manager restriction from missing request scope',async()=>{
 const f=await fixture(),scope=f.h.scopes.scope('team');f.h.store.put('management-scope','team',{...scope,managers:[JSON.stringify(['local','bob'])]})
 const ticket=f.h.store.tickets.get(f.id)!;f.h.store.tickets.save({...ticket,mandate:{...ticket.mandate,actor:{...ticket.mandate.actor,id:'bob'}}})
 expect(taskPermissionsView(f.h,f.id)?.reason).toBe('requester_or_manager_required')
})
it('never repairs a missing route and never returns cleaned or foreign-key records',async()=>{
 const f=await fixture();f.h.store.db.prepare("DELETE FROM records WHERE kind='router-route'").run()
 const before=db(f.h);expect(taskPermissionsView(f.h,f.id)?.reason).toBe('task_unavailable');expect(db(f.h)).toBe(before)
 f.h.store.put('ticket',f.id,{...f.h.store.tickets.get(f.id),id:'foreign'});expect(taskPermissionsView(f.h,f.id)).toBeUndefined()
})

it('does not claim management availability when the same production hard switch denies send',async()=>{
 const f=await fixture();f.h.config.execution.management!.enabled=false
 expect(taskPermissionsView(f.h,f.id)?.reason).toBe('management_disabled')
 await expect(f.h.manager.call({action:'send',ticketId:f.id,revision:f.h.settings.current().revision,requestId:'off',text:'Continue'},{discussion:f.initial.context.route.discussion,trigger:f.initial.trigger,scoped:f.initial.context,manifest:f.initial.packet.manifest})).rejects.toThrow()
})
it('uses producer authority instead of misclassifying a legitimate scheduled producer as an unlisted member',async()=>{
 const f=await fixture(),t=f.initial.trigger;f.h.store.triggers.save({...t,human:false})
 f.h.routerIngress.scheduledAuthority=id=>id===t.id?f.h.routerIngress.get(id)!.mandate:undefined
 expect(f.h.routerIngress.explain(t.id,f.initial.context.route.discussion)).toBe('current')
 f.h.routerIngress.scheduledAuthority=()=>undefined
 expect(f.h.routerIngress.explain(t.id,f.initial.context.route.discussion)).toBe('member_not_admitted')
})

it.each(['current','disabled','revoked','missing'])('omits private or unknown current follow-up audience before %s reasons',async mode=>{
 const f=await fixture(),entry=f.h.scopes.bindings().find(b=>b.nativeId==='other')!
 f.h.store.put('entry-binding',entry.id,{...entry,privateActor:'alice'})
 f.h.scopes.command({action:'task.channel',operationId:'private-share',ticketId:f.id,entryId:entry.id,expectedRevision:0,context:true,request:true,result:true,active:true})
 const input=f.receive('Private follow-up','alice','other')
 f.h.scopes.noteInput(f.id,input.context)
 expect(f.h.taskAuthority(f.id)?.parentTrigger).toBe(input.trigger.id)
 if(mode==='disabled')f.h.config.execution.management!.enabled=false
 if(mode==='revoked')f.h.config.sources[0]!.allowedActors=[]
 if(mode==='missing')f.h.store.db.prepare("DELETE FROM records WHERE kind='entry-binding' AND id=?").run(entry.id)
 const before=db(f.h)
 expect(taskPermissionsView(f.h,f.id)).toBeUndefined()
 expect(db(f.h)).toBe(before)
})

it('revalidates retained requester authority after a different admitted manager follows up',async()=>{
 const f=await fixture(true),input=f.receive('Continue','bob')
 f.h.scopes.noteInput(f.id,input.context)
 f.h.memory.moveTaskContext(f.id,input.context)
 expect(taskPermissionsView(f.h,f.id)?.reason).toBe('current')
 f.h.config.sources[0]!.allowedActors=['bob']
 expect(taskPermissionsView(f.h,f.id)?.reason).toBe('authority_unavailable')
 await expect(f.h.manager.call({action:'send',ticketId:f.id,revision:f.h.settings.current().revision,requestId:'retained-revoked',text:'Continue'},{discussion:input.context.route.discussion,trigger:input.trigger,scoped:input.context,manifest:input.packet.manifest})).rejects.toThrow()
})
