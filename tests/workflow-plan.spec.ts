import {afterEach,expect,it,vi} from 'vitest'
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {stableDigest} from '../src/sources.ts'
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

async function planFixture(){
 const f=await fixture(),source=f.h.config.sources[0]!,owner=f.h.scopes.ownership(f.id)!,assignment=f.h.store.tickets.get(f.id)!.assignments.at(-1)!
 const target={key:'local-issue',entryId:owner.originEntry,teamId:'local',issueId:'local-issue'}
 source.capabilities.resources=true;source.capabilities.replies=true;source.options={...source.options,statusTargets:[target]}
 const view={account:'local',issue:'local-issue',label:'Local issue',revision:'1',current:{id:'todo',name:'Todo'},states:[{id:'todo',name:'Todo'},{id:'done',name:'Done'}]}
 let writes=0,afterRead=()=>{}
 const adapter=f.h.sources.get(source.id)!
 adapter.workflowState=vi.fn(async()=>{const result=structuredClone(view);afterRead();return result})
 adapter.applyWorkflowState=vi.fn(async(_target,_view,next,valid)=>{if(valid&&!valid())throw Error('revoked');writes++;view.current=view.states.find(s=>s.id===next)!;view.revision='2';return 'updated' as const})
 f.h.engine.assignmentStarted(f.id,assignment.id)
 const work={ticketId:f.id,assignmentId:assignment.id,cwd:f.root,sandbox:'read-only' as const,depth:0}
 const request={sourceId:'local',target:target.key,stateId:'done'}
 const plan=()=>f.h.workflows.request(work,{action:'plan',...request}) as Promise<any>
 const propose=(planDigest?:string,requestId='same')=>f.h.workflows.request(work,{action:'propose',...request,requestId,...(planDigest?{planDigest}:{})}) as Promise<any>
 return {...f,view,source,target,adapter,work,plan,propose,get writes(){return writes},afterRead(fn:()=>void){afterRead=fn}}
}
it('plans through the real active task path, with no local writes or outgoing effects',async()=>{
 const f=await planFixture(),before=db(f.h),changes=f.h.store.db.prepare('SELECT total_changes() AS n').get()!.n
 const p=await f.plan();expect(p).toMatchObject({schema:1,kind:'workflow_status',readOnly:true,authorizesExecution:false,affectedCount:1,target:'local-issue',next:{id:'done',name:'Done'}})
 expect(p.actionDigest).toMatch(/^[a-f0-9]{64}$/);expect((await f.plan()).actionDigest).toBe(p.actionDigest)
 expect(db(f.h)).toBe(before);expect(f.h.store.db.prepare('SELECT total_changes() AS n').get()!.n).toBe(changes)
 expect(f.adapter.applyWorkflowState).not.toHaveBeenCalled();expect(f.model.run).not.toHaveBeenCalled();expect(f.h.workflows.list()).toHaveLength(0)
})
it('requires an independent approval after a matching plan and retains the actual readback',async()=>{
 const f=await planFixture(),plan=await f.plan(),p=await f.propose(plan.actionDigest)
 expect(p.state).toBe('pending');expect(f.writes).toBe(0);expect(p.planDigest).toBe(plan.actionDigest)
 expect((await f.propose(plan.actionDigest)).id).toBe(p.id)
 const result=await f.h.workflows.decide({id:p.id,decision:'approve'})
 expect(result.state).toBe('applied');expect(f.writes).toBe(1)
 expect(f.read()!.operations.items).toMatchObject([{execution:'applied_readback'}])
})
it.each(['revision','account','issue','label','state name','states','target'])('rejects %s drift between plan and proposal without messages or proposal writes',async change=>{
 const f=await planFixture(),p=await f.plan()
 if(change==='revision')f.view.revision='next'
 if(change==='account')f.view.account='other'
 if(change==='issue')f.view.issue='other'
 if(change==='label')f.view.label='other'
 if(change==='state name')f.view.states[1]!.name='Changed'
 if(change==='states')f.view.states.push({id:'extra',name:'Extra'})
 if(change==='target')f.target.issueId='other'
 const before=db(f.h);await expect(f.propose(p.actionDigest)).rejects.toThrow(/plan changed/);expect(db(f.h)).toBe(before);expect(f.writes).toBe(0)
})
it.each(['revision','state name','states'])('marks a planned proposal stale for %s drift before approval',async change=>{
 const f=await planFixture(),p=await f.propose((await f.plan()).actionDigest)
 if(change==='revision')f.view.revision='next'
 if(change==='state name')f.view.states[1]!.name='Changed'
 if(change==='states')f.view.states.push({id:'extra',name:'Extra'})
 expect((await f.h.workflows.decide({id:p.id,decision:'approve'})).state).toBe('stale');expect(f.writes).toBe(0)
})
it.each(['before plan','during plan','after plan','before approval'])('revalidates current authority %s, a digest cannot grant it',async when=>{
 const f=await planFixture(),revoke=()=>{f.source.allowedActors=[]}
 if(when==='before plan'){revoke();await expect(f.plan()).rejects.toThrow();expect(f.adapter.workflowState).not.toHaveBeenCalled()}
 if(when==='during plan'){f.afterRead(revoke);await expect(f.plan()).rejects.toThrow()}
 if(when==='after plan'){const p=await f.plan();revoke();await expect(f.propose(p.actionDigest)).rejects.toThrow()}
 if(when==='before approval'){const p=await f.propose((await f.plan()).actionDigest);revoke();await expect(f.h.workflows.decide({id:p.id,decision:'approve'})).rejects.toThrow()}
 expect(f.writes).toBe(0)
})
it('rejects forged digests and requestId rebinding, preserving legacy proposals',async()=>{
 const f=await planFixture();await expect(f.propose('0'.repeat(64))).rejects.toThrow(/plan changed/)
 const p=await f.propose();expect(p.planDigest).toBeUndefined()
 await expect(f.propose((await f.plan()).actionDigest)).rejects.toThrow(/different plan/)
 expect((await f.h.workflows.decide({id:p.id,decision:'approve'})).state).toBe('applied')
})
it('rejects non-root and invalid work before any remote read, with no guessed generic preview',async()=>{
 const f=await planFixture()
 for(const work of [{...f.work,agentId:'child'},{...f.work,assignmentId:'missing'}])await expect(f.h.workflows.request(work,{action:'plan',sourceId:'local',target:'local-issue',stateId:'done'})).rejects.toThrow()
 await expect(f.h.workflows.request(f.work,{action:'planOperation',operation:'send'})).rejects.toThrow()
 expect(f.adapter.workflowState).not.toHaveBeenCalled();expect(f.writes).toBe(0)
})
it('ignores mere state-choice order but not target removal or missing adapter support',async()=>{
 const f=await planFixture(),p=await f.plan();f.view.states.reverse();expect((await f.plan()).actionDigest).toBe(p.actionDigest)
 f.adapter.applyWorkflowState=undefined;await expect(f.plan()).rejects.toThrow(/unavailable/)
 expect(f.writes).toBe(0)
})

it('does not silently downgrade a planned request when a concurrent legacy request wins the ID',async()=>{
 const f=await planFixture(),p=await f.plan(),read=f.adapter.workflowState!
 let release!:()=>void
 f.adapter.workflowState=async()=>{const v=await read(f.target);await new Promise<void>(r=>{release=r});return v}
 const planned=f.propose(p.actionDigest);await Promise.resolve();await Promise.resolve()
 f.adapter.workflowState=read
 const legacy=await f.propose();expect(legacy.planDigest).toBeUndefined()
 release();await expect(planned).rejects.toThrow(/different plan/)
 expect(f.h.workflows.list()).toHaveLength(1);expect(f.writes).toBe(0)
})

it.each(['before','during'])('does not apply an unreconciled memory revocation ledger %s provider read',async when=>{
 const f=await planFixture()
 const pending=()=>{const body={seq:1,previous:'',tenantId:'local',scopeId:'team',action:'forget',id:'missing',generation:1,at:Date.now()};writeFileSync(join(f.h.config.stateDir,'memory-revocations.jsonl'),JSON.stringify({...body,hash:stableDigest(body)})+'\n')}
 if(when==='before')pending();else f.afterRead(pending)
 const before=db(f.h),changes=f.h.store.db.prepare('SELECT total_changes() AS n').get()!.n
 await expect(f.plan()).rejects.toThrow(/reconciliation/)
 expect(db(f.h)).toBe(before);expect(f.h.store.db.prepare('SELECT total_changes() AS n').get()!.n).toBe(changes)
 if(when==='before')expect(f.adapter.workflowState).not.toHaveBeenCalled()
 expect(f.writes).toBe(0)
})

it('exposes plan through WorkerTools without input delivery, refresh, proposal or outbox effects',async()=>{
 const f=await planFixture(),delivery=vi.spyOn(f.h,'deliverLiveInputs'),refresh=vi.spyOn(f.h,'refreshWork')
 const result=await f.h.workerTools.call(f.work,'superagent_workflow',{action:'plan',sourceId:'local',target:'local-issue',stateId:'done'})
 expect(result.success).toBe(true);expect(JSON.parse(result.contentItems[0]!.text!)).toMatchObject({readOnly:true,authorizesExecution:false})
 expect(delivery).not.toHaveBeenCalled();expect(refresh).not.toHaveBeenCalled();expect(f.h.workflows.list()).toHaveLength(0);expect(f.writes).toBe(0)
 expect(f.h.store.get('memory-revocation-head','current')).toBeUndefined()
})
it('does not reconcile memory through WorkerTools when planning; ordinary tool audit is retained',async()=>{
 const f=await planFixture(),body={seq:1,previous:'',tenantId:'local',scopeId:'team',action:'forget',id:'missing',generation:1,at:Date.now()}
 writeFileSync(join(f.h.config.stateDir,'memory-revocations.jsonl'),JSON.stringify({...body,hash:stableDigest(body)})+'\n')
 const reconcile=vi.spyOn(f.h.memory,'reconcile'),delivery=vi.spyOn(f.h,'deliverLiveInputs'),refresh=vi.spyOn(f.h,'refreshWork')
 await expect(f.h.workerTools.call(f.work,'superagent_workflow',{action:'plan',sourceId:'local',target:'local-issue',stateId:'done'})).rejects.toThrow(/reconciliation/)
 expect(f.h.store.get('memory-revocation-head','current')).toBeUndefined();expect(reconcile).not.toHaveBeenCalled();expect(delivery).not.toHaveBeenCalled();expect(refresh).not.toHaveBeenCalled();expect(f.adapter.workflowState).not.toHaveBeenCalled()
})

it.each([false,true])('guards HTTP worker authentication before plan reconciliation (pending ledger: %s)',async pending=>{
 const f=await planFixture(),token=readFileSync(f.h.workerTools.grant(f.work),'utf8')
 const s=await serve(f.h);servers.push(s)
 if(pending){const body={seq:1,previous:'',tenantId:'local',scopeId:'team',action:'forget',id:'missing',generation:1,at:Date.now()};writeFileSync(join(f.h.config.stateDir,'memory-revocations.jsonl'),JSON.stringify({...body,hash:stableDigest(body)})+'\n')}
 const reconcile=vi.spyOn(f.h.memory,'reconcile'),delivery=vi.spyOn(f.h,'deliverLiveInputs'),refresh=vi.spyOn(f.h,'refreshWork')
 const before=db(f.h)
 const response=await fetch(s.url+'/worker',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({name:'superagent_workflow',args:{action:'plan',sourceId:'local',target:'local-issue',stateId:'done'}})})
 const result=await response.json()
 if(pending){expect(response.ok).toBe(false);expect(db(f.h)).toBe(before);expect(result.error).toMatch(/reconciliation/);expect(f.adapter.workflowState).not.toHaveBeenCalled()}
 else{expect(response.status).toBe(200);expect(result.success).toBe(true);expect(JSON.parse(result.contentItems[0].text)).toMatchObject({readOnly:true,authorizesExecution:false})}
 expect(f.h.store.get('memory-revocation-head','current')).toBeUndefined();if(pending)expect(reconcile).not.toHaveBeenCalled();expect(delivery).not.toHaveBeenCalled();expect(refresh).not.toHaveBeenCalled();expect(f.writes).toBe(0);expect(f.h.workflows.list()).toHaveLength(0)
})

it.each(['missing','unknown','expired'])('HTTP plan cannot bypass %s Worker authentication',async kind=>{
 const f=await planFixture(),token=readFileSync(f.h.workerTools.grant(f.work),'utf8'),s=await serve(f.h);servers.push(s)
 if(kind==='expired')f.source.allowedActors=[]
 const response=await fetch(s.url+'/worker',{method:'POST',headers:{'content-type':'application/json',...(kind==='missing'?{}:{authorization:'Bearer '+(kind==='unknown'?'unknown':token)})},body:JSON.stringify({name:'superagent_workflow',args:{action:'plan',sourceId:'local',target:'local-issue',stateId:'done'}})})
 expect(response.ok).toBe(false);expect(f.adapter.workflowState).not.toHaveBeenCalled();expect(f.writes).toBe(0)
})
