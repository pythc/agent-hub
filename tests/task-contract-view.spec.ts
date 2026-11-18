import {mkdtempSync,mkdirSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach,expect,it,vi} from 'vitest'
import {Runtime} from '../src/runtime.ts'
import {Store} from '../src/store.ts'
import {configSchema} from '../src/config.ts'
import {stableDigest} from '../src/sources.ts'
import {taskContractView} from '../src/task-contract-view.ts'
import {operatorTask} from '../src/operator-workspace.ts'
import {serve} from '../src/server.ts'
import type {RouterGoal} from '../src/router-goals.ts'
import type {TaskContinuation} from '../src/task-context.ts'
import type {RouterRoute} from '../src/router-scope.ts'
const roots:string[]=[],hosts:Runtime[]=[],observers:Store[]=[],servers:Awaited<ReturnType<typeof serve>>[]=[]
afterEach(async()=>{vi.restoreAllMocks();vi.unstubAllGlobals();for(const s of servers.splice(0)){s.server.closeAllConnections();await new Promise<void>(done=>s.server.close(()=>done()))}for(const h of hosts.splice(0))await h.close();for(const s of observers.splice(0))s.close();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true})})
async function fixture(managed=true,details?:{nonGoals?:string[];inputs?:string[];deadline?:string}){
 const root=mkdtempSync(join(tmpdir(),'task-contract-'));roots.push(root)
 const config=configSchema.parse({stateDir:join(root,'state'),port:0,acceptMode:'auto',work:{sandboxDriver:'disabled',autoRecover:false},execution:{router:{mode:'host'},management:{enabled:true,maxWorkers:1},workers:[{id:'one',backend:'codex'}]},sources:[{id:'local',kind:'local',cwd:root,workspace:{mode:'source'},allowedActors:['alice']}]})
 const model={run:vi.fn(async()=>{throw Error('No model calls permitted')}),history:vi.fn(async()=>{throw Error('No history calls permitted')})},host=new Runtime(config,{model});hosts.push(host)
 host.scopes.command({action:'scope.put',operationId:'scope',expectedRevision:0,scope:{id:'team',tenantId:'org',name:'Team',contextBytes:128000,managers:[JSON.stringify(['local','alice'])],workerIds:['one'],sourceIds:['local'],backendIds:['codex']}})
 host.scopes.command({action:'entry.bind',operationId:'entry',expectedRevision:0,scopeId:'team',sourceId:'local',accountNamespace:'local',nativeId:'topic',history:'group'})
 const received=host.receive('local','alice',{id:'human',thread:'topic',scope:'topic',text:'Continuously analyze and verify a result. Never deploy. Use report.txt. By Friday. SECRET_RAW_PROMPT',addressed:true}) as {triggerId:string}
 const trigger=host.store.triggers.get(received.triggerId)!,context=host.scopes.context(trigger,'local:topic')!
 const result=await host.manager.call({action:'assign',id:'one',revision:0,requestId:'task',text:JSON.stringify({kind:'goal_node',instruction:'SECRET_MACHINE_INSTRUCTION',authorizationScope:'SECRET_RAW_SCOPE'})},{discussion:'local:topic',trigger,scoped:context})
 const ticket=host.store.tickets.get(result.ticketId)!
 let goal:RouterGoal|undefined
 if(managed){goal=host.goals.command({action:'start',operationId:'goal',expectedRevision:0,...(details?{details}:{}),objective:'Produce a concise analysis',authorizationQuote:'Continuously analyze and verify',criteria:[{id:'analysis',description:'Explain the relevant findings',files:['analysis.md'],documents:['document-1'],check:{kind:'text_contains',path:'analysis.md',text:'SECRET_EXPECTED_CONTENT'}}],nodes:[{id:'analyze',title:'Analyze',instruction:'SECRET_NODE_INSTRUCTION',workerId:'one',criterionIds:['analysis']}]},context)as RouterGoal;goal.taskIds=[ticket.id];goal.nodes![0]!.ticketId=ticket.id;host.store.put('router-goal',goal.id,goal)}
 const read=()=>taskContractView(host,ticket.id,1000),save=(next:RouterGoal)=>host.store.put('router-goal',next.id,next)
 return {root,host,model,trigger,context,ticket,goal,read,save}
}
function db(store:Store){return store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row=>{const name=String(row.name);return [name,store.db.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'"').all().sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))]})}
function creation(f:Awaited<ReturnType<typeof fixture>>){return f.host.store.get<{goalId:string;result:RouterGoal}>('goal-receipt',f.goal!.id.slice(5))!}
function syntheticReviewedPlan(f:Awaited<ReturnType<typeof fixture>>,extra:Record<string,unknown>={}){
 const g={...f.goal!,planRevision:1};f.save(g)
 const round={id:'reviewed-1',goalId:g.id,state:'applied',review:{approved:true},proposal:{},snapshot:{planRevision:0,contract:g.contract},contextIds:[],...extra}
 f.host.store.put('goal-replan',round.id,round);return round
}
it('projects the original managed contract and separate recorded versions, without raw prompts or machine instructions',async()=>{
 const f=await fixture(),view=f.read(),owner=f.host.scopes.ownership(f.ticket.id)!
 expect(view).toMatchObject({schema:1,readOnly:true,observedAt:1000,subject:{kind:'task',id:f.ticket.id},availability:'available',contentSource:'router_saved_goal',objective:'Produce a concise analysis',scope:null,criteria:[{id:'analysis',description:'Explain the relevant findings'}],deliverables:{files:['analysis.md'],documents:['document-1']},budget:null,basis:{contract:{kind:'goal_contract',digest:stableDigest(f.goal!.contract)},goalId:f.goal!.id,goalRevision:f.goal!.revision,planRevision:0,assignmentId:f.ticket.assignments.at(-1)!.id,ownerEpoch:owner.ownerEpoch,dataRevision:null,bindingRevision:1}})
 const text=JSON.stringify(view);for(const secret of ['SECRET','authorizationQuote','instruction','policyVersion','workerIds','backendIds','scopeId'])expect(text).not.toContain(secret)
 expect(f.model.run).not.toHaveBeenCalled()
})
it('does not interpret ordinary human or JSON mandate scopes as a structured user contract',async()=>{
 const f=await fixture(false),view=f.read();expect(view).toMatchObject({availability:'not_captured',objective:null,scope:null,criteria:[],budget:null,basis:{contract:{kind:'mandate',digest:stableDigest(f.ticket.mandate)},goalId:null,goalRevision:null,planRevision:null}});expect(JSON.stringify(view)).not.toContain('SECRET')
 f.host.store.tickets.save({...f.ticket,mandate:{...f.ticket.mandate,scope:'Human-looking text cannot prove a captured structured objective'}})
 expect(f.read()).toMatchObject({availability:'not_captured',objective:null,scope:null})
})
it('quarantines a continuation without returning its former goal, original mandate digest or arbitrary continuation text',async()=>{
 const f=await fixture(),next=f.host.receive('local','alice',{id:'continuation',thread:'topic',scope:'topic',text:'Use a fresh analysis context',addressed:true})as {triggerId:string},t=f.host.store.triggers.get(next.triggerId)!
 f.host.scopes.context(t,'local:topic')
 const continuation:TaskContinuation={ticketId:f.ticket.id,triggerId:t.id,discussion:'local:topic',text:'SECRET_CONTINUATION_TEXT',at:1,inputIds:[],priorAssignments:[],priorReports:[],priorJobs:[],priorMessages:[],priorToolCalls:[],workspaceReviewed:true}
 f.host.store.put('task-continuation',f.ticket.id,continuation)
 const view=f.read();expect(view).toMatchObject({availability:'not_captured',objective:null,criteria:[],basis:{contract:null,goalId:null,goalRevision:null,planRevision:null}});expect(JSON.stringify(view)).not.toContain('SECRET');expect(JSON.stringify(view)).not.toContain(stableDigest(f.ticket.mandate))
})
it('uses the current task routing rather than the continuation anchor when a later admitted follow-up owns the route',async()=>{
 const f=await fixture(false),next=f.host.receive('local','alice',{id:'later',thread:'topic',scope:'topic',text:'A later admitted follow-up',addressed:true})as {triggerId:string},t=f.host.store.triggers.get(next.triggerId)!
 f.host.scopes.context(t,'local:topic');f.host.store.put('task-continuation',f.ticket.id,{ticketId:f.ticket.id,triggerId:'missing-old-trigger',discussion:'missing',text:'SECRET_OLD',inputIds:[],priorReports:[]});f.host.store.put('task-routing',f.ticket.id,{parentTrigger:t.id,discussion:'local:topic'})
 expect(f.read()).toMatchObject({availability:'not_captured',basis:{contract:null}})
})
for(const mutation of ['missing route','private entry','stale binding','stale epoch','source disabled','requester revoked','owner held','missing owner','missing context','history erased','goal history erased','duplicate goal','contract changed','current objective changed','creation receipt missing','original trigger changed'])it('fails closed for '+mutation+' without writes or exposing content',async()=>{
 const f=await fixture(),g=f.goal!,owner=f.host.scopes.ownership(f.ticket.id)!,binding=f.host.scopes.binding(owner.originEntry),store=f.host.store
 if(mutation==='missing route')store.db.prepare("DELETE FROM records WHERE kind='router-route' AND id=?").run(f.trigger.id)
 if(mutation==='private entry')store.put('entry-binding',binding.id,{...binding,privateActor:'alice'})
 if(mutation==='stale binding')store.put('entry-binding',binding.id,{...binding,revision:binding.revision+1})
 if(mutation==='stale epoch'){const route=store.get<RouterRoute>('router-route',f.trigger.id)!;store.put('router-route',f.trigger.id,{...route,epoch:route.epoch-1})}
 if(mutation==='source disabled')f.host.config.sources[0]!.enabled=false
 if(mutation==='requester revoked')f.host.config.sources[0]!.allowedActors=[]
 if(mutation==='owner held')store.put('task-ownership',f.ticket.id,{...owner,state:'held'})
 if(mutation==='missing owner')store.db.prepare("DELETE FROM records WHERE kind='task-ownership' AND id=?").run(f.ticket.id)
 if(mutation==='missing context')store.put('task-context',f.ticket.id,{manifest:{id:'missing-manifest'}})
 if(mutation==='history erased')store.put('history-plan','erase',{tickets:[f.ticket.id],triggers:[]})
 if(mutation==='goal history erased')vi.spyOn(f.host.memory.cleanup,'blocked').mockImplementation((kind,id)=>kind==='router-goal'&&id===g.id)
 if(mutation==='duplicate goal')f.save({...g,id:'another-goal'})
 if(mutation==='contract changed')f.save({...g,objective:'SECRET_CHANGED',contract:{...g.contract!,objective:'SECRET_CHANGED'}})
 if(mutation==='current objective changed')f.save({...g,objective:'SECRET_CHANGED'})
 if(mutation==='creation receipt missing')store.db.prepare("DELETE FROM records WHERE kind='goal-receipt' AND id=?").run(g.id.slice(5))
 if(mutation==='original trigger changed')store.triggers.save({...f.trigger,text:'SECRET_CHANGED_TRIGGER'})
 const before=db(store),changes=store.db.prepare('SELECT total_changes() AS n').get()!.n,view=f.read()
 expect(view.availability).toBe('unavailable');expect(view.objective).toBeNull();expect(view.basis.contract).toBeNull();expect(view.basis.goalId).toBeNull();expect(JSON.stringify(view)).not.toContain('SECRET')
 expect(db(store)).toEqual(before);expect(store.db.prepare('SELECT total_changes() AS n').get()!.n).toBe(changes)
})
it('keeps the original contract digest while independently changing control, input and reviewed plan versions',async()=>{
 const f=await fixture(),first=f.read(),owner=f.host.scopes.ownership(f.ticket.id)!
 f.save({...f.goal!,revision:f.goal!.revision+4});f.host.store.put('task-ownership',f.ticket.id,{...owner,dataRevision:8})
 const changed=f.read();expect(changed.basis.contract).toEqual(first.basis.contract);expect(changed.basis.goalRevision).toBe(first.basis.goalRevision!+4);expect(changed.basis.dataRevision).toBe(8);expect(changed.basis.planRevision).toBe(0)
 syntheticReviewedPlan(f);expect(f.read().basis.planRevision).toBe(1);expect(f.read().objective).toBe(first.objective)
})
for(const invalid of ['no round','not applied','not approved','different contract','different base','duplicate applied'])it('does not label a positive plan revision as reviewed for '+invalid,async()=>{
 const f=await fixture(),round=syntheticReviewedPlan(f)
 if(invalid==='no round')f.host.store.db.prepare("DELETE FROM records WHERE kind='goal-replan'").run()
 if(invalid==='not applied')f.host.store.put('goal-replan',round.id,{...round,state:'approved'})
 if(invalid==='not approved')f.host.store.put('goal-replan',round.id,{...round,review:{approved:false}})
 if(invalid==='different contract')f.host.store.put('goal-replan',round.id,{...round,snapshot:{...round.snapshot,contract:{...f.goal!.contract,objective:'Different original'}}})
 if(invalid==='different base')f.host.store.put('goal-replan',round.id,{...round,snapshot:{...round.snapshot,planRevision:3}})
 if(invalid==='duplicate applied')f.host.store.put('goal-replan','reviewed-2',{...round,id:'reviewed-2'})
 expect(f.read()).toMatchObject({availability:'available',objective:'Produce a concise analysis',basis:{planRevision:null}})
})
it('leaves absent legacy versions null instead of fabricating captured zero or default-one values',async()=>{
 const f=await fixture(),g={...f.goal!};delete g.planRevision;delete (g as any).revision;f.save(g);const owner=f.host.scopes.ownership(f.ticket.id)!;f.host.store.put('task-ownership',f.ticket.id,{...owner,ownerEpoch:undefined,dataRevision:undefined})
 expect(f.read()).toMatchObject({basis:{goalRevision:null,planRevision:null,ownerEpoch:null,dataRevision:null}})
})
it('returns detached typed content and declared deliverables, never checks or raw instructions',async()=>{
 const f=await fixture(),first=f.read();first.criteria[0]!.description='Changed in browser';first.deliverables.files.push('invented')
 expect(f.read().criteria[0]!.description).toBe('Explain the relevant findings');expect(f.read().deliverables.files).toEqual(['analysis.md']);expect(f.read().criteria[0]).not.toHaveProperty('check')
})
it('only projects a retained code-project budget as an estimate, without prices, balances or invented deadlines',async()=>{
 const f=await fixture(),receipt=creation(f),project={base:'SECRET_COMMIT',sourceId:'local',integration:'SECRET_NODE',policy:{testCommand:'SECRET_COMMAND',budget:{maxMinutes:30,cost:{maxUsd:5,inputUsdPerMillion:7,outputUsdPerMillion:10}}},reviewWaitMs:0,triggerIds:[f.trigger.id]}
 f.save({...f.goal!,project});f.host.store.put('goal-receipt',f.goal!.id.slice(5),{...receipt,result:{...receipt.result,project}})
 const view=f.read();expect(view.budget).toEqual({scope:'code_project',basis:'configured_estimate',maxMinutes:30,maxUsd:5});expect(JSON.stringify(view)).not.toMatch(/SECRET|inputUsdPerMillion|outputUsdPerMillion|deadline|remaining|balance/)
 f.save({...f.goal!,project:{...project,policy:{...project.policy,budget:{maxMinutes:60,cost:project.policy.budget.cost}}}});expect(f.read().budget).toBeNull()
})
it('leaves all host/observer tables, running records, callbacks and total_changes untouched across repeated reads',async()=>{
 const f=await fixture(),directory=join(f.root,'state','watchdog');mkdirSync(directory,{recursive:true});const observer=new Store(join(directory,'state.sqlite'));observers.push(observer);observer.put('model-usage','running',{state:'running'});f.host.store.put('model-usage','running',{state:'running'})
 const promise=f.host.approvals.request(f.ticket.id,{id:'native',method:'item/commandExecution/requestApproval',params:{command:'SECRET_COMMAND'}});void promise.catch(()=>{})
 const pending=(f.host.approvals as any).pending,callbacks=[...pending.entries()],before=db(f.host.store),other=db(observer),changes=f.host.store.db.prepare('SELECT total_changes() AS n').get()!.n
 const fetch=vi.fn(()=>{throw Error('No network permitted')});vi.stubGlobal('fetch',fetch)
 const probe=vi.spyOn(f.host.toolConnections,'catalog'),call=vi.spyOn(f.host.toolConnections,'call'),create=vi.spyOn(f.host.sourceRegistry,'create'),start=vi.spyOn(f.host.goals,'command')
 for(let i=0;i<3;i++)expect(f.read().availability).toBe('available')
 expect(db(f.host.store)).toEqual(before);expect(db(observer)).toEqual(other);expect(f.host.store.db.prepare('SELECT total_changes() AS n').get()!.n).toBe(changes);expect([...pending.entries()]).toEqual(callbacks)
 for(const fn of [f.model.run,f.model.history,fetch,probe,call,create,start])expect(fn).not.toHaveBeenCalled()
})
it('adds exactly one field to existing operator task output without replacing original fields',async()=>{
 const f=await fixture(),view=operatorTask(f.host,f.ticket.id)!
 expect(view).toMatchObject({id:f.ticket.id,message:f.trigger.text,resultResource:'ticket/'+f.ticket.id+'/result',contractView:{availability:'available'}});expect(view).toHaveProperty('canStop');expect(view).toHaveProperty('approvals');expect(view).toHaveProperty('artifacts')
})
it('serves the additive field on the existing protected GET with retained routes and no database changes',async()=>{
 const f=await fixture();f.host.pause(true);const s=await serve(f.host);servers.push(s);clearInterval((f.host as any).timer)
 const headers={authorization:'Bearer '+readFileSync(s.tokenPath,'utf8').trim()},path=s.url+'/entry-workspace/task/'+encodeURIComponent(f.ticket.id),before=db(f.host.store),changes=f.host.store.db.prepare('SELECT total_changes() AS n').get()!.n
 expect((await fetch(path)).status).toBe(401);const response=await fetch(path,{headers});expect(response.status).toBe(200);expect(await response.json()).toMatchObject({id:f.ticket.id,contractView:{schema:1,readOnly:true,availability:'available'}})
 expect(db(f.host.store)).toEqual(before);expect(f.host.store.db.prepare('SELECT total_changes() AS n').get()!.n).toBe(changes)
})

it('shows only captured exact-source contract detail and never invents legacy deadline or inputs',async()=>{
 const f=await fixture(true,{nonGoals:['Never deploy.'],inputs:['Use report.txt.'],deadline:'By Friday.'})
 expect(f.read().details).toEqual({nonGoals:['Never deploy.'],inputs:['Use report.txt.'],deadline:'By Friday.'})
 const before=db(f.host.store);f.read();expect(db(f.host.store)).toEqual(before)
 const g=f.host.store.get<RouterGoal>('router-goal',f.goal!.id)!
 g.contract!.details={nonGoals:['invented permission']};f.save(g)
 expect(f.read().availability).toBe('unavailable')
 const legacy=await fixture();expect(legacy.read().details).toBeUndefined()
 const partial=await fixture(true,{nonGoals:[]});expect(partial.read().details).toEqual({nonGoals:[],inputs:null,deadline:null})
})
it('separately authenticates replacement history and redacts mismatched, deleted or altered predecessors',async()=>{
 const f=await fixture(),original=f.goal!,current={...original,supersedes:'goal-previous'}
 const old={...original,id:'goal-previous',state:'cancelled' as const,supersededBy:original.id,objective:'Earlier implementation',contract:{...original.contract!,objective:'Earlier implementation'},taskIds:[]}
 f.host.store.put('router-goal',old.id,old)
 f.host.store.put('goal-receipt','previous',{goalId:old.id,result:old})
 f.save(current)
 const receipt=creation(f);f.host.store.put('goal-receipt',original.id.slice(5),{...receipt,result:{...receipt.result,supersedes:old.id}})
 expect(f.read().lineage).toMatchObject({state:'current',previousState:'available',previous:{objective:'Earlier implementation'}})
 f.host.store.put('router-goal',old.id,{...old,actor:'other'})
 expect(f.read().lineage).toEqual({state:'current',previousState:'unavailable',previous:null})
 f.host.store.put('router-goal',old.id,{...old,contract:{...old.contract,objective:'FORGED'}})
 expect(JSON.stringify(f.read())).not.toContain('FORGED');expect(f.read().lineage?.previousState).toBe('unavailable')
 f.host.store.db.prepare('DELETE FROM records WHERE kind=? AND id=?').run('router-goal',old.id)
 expect(f.read().lineage?.previousState).toBe('unavailable')
})
