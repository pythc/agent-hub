import {mkdtempSync,rmSync,readFileSync,mkdirSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {afterEach,expect,it,vi} from 'vitest'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
import {operatorWorkspace,operatorTask} from '../src/operator-workspace.ts'
import {serve} from '../src/server.ts'
import {Store} from '../src/store.ts'
import {stableDigest} from '../src/sources.ts'
import type {RouterGoal} from '../src/router-goals.ts'
import type {Run} from '../src/store.ts'
const roots:string[]=[],hosts:Runtime[]=[],observers:Store[]=[],servers:Awaited<ReturnType<typeof serve>>[]=[]
afterEach(async()=>{vi.restoreAllMocks();vi.unstubAllGlobals();for(const s of servers.splice(0)){s.server.closeAllConnections();await new Promise<void>(done=>s.server.close(()=>done()))}for(const h of hosts.splice(0))await h.close();for(const s of observers.splice(0))s.close();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true})})
async function fixture(managed=true,taskText='Summarize the meeting notes'){
 const root=mkdtempSync(join(tmpdir(),'display-title-'));roots.push(root)
 const host=new Runtime(configSchema.parse({stateDir:join(root,'state'),port:0,work:{sandboxDriver:'disabled',autoRecover:false},execution:{router:{mode:'host'},management:{enabled:true,maxWorkers:1},workers:[{id:'one',backend:'codex'}]},sources:[{id:'local',kind:'local',cwd:root,workspace:{mode:'source'},allowedActors:['alice']}]}),{model:{run:vi.fn(async()=>{throw Error('No model calls permitted')})}});hosts.push(host)
 host.scopes.command({action:'scope.put',operationId:'scope',expectedRevision:0,scope:{id:'team',tenantId:'org',name:'Team',contextBytes:128000,managers:[JSON.stringify(['local','alice'])],workerIds:['one'],sourceIds:['local'],backendIds:['codex']}})
 host.scopes.command({action:'entry.bind',operationId:'entry',expectedRevision:0,scopeId:'team',sourceId:'local',accountNamespace:'local',nativeId:'topic',history:'group'})
 const result=host.receive('local','alice',{id:'request',thread:'topic',scope:'topic',text:'Continuously analyze and verify a local result. Never deploy.',addressed:true})as {triggerId:string},trigger=host.store.triggers.get(result.triggerId)!,context=host.scopes.context(trigger,'local:topic')!
 let goal:RouterGoal|undefined,ticketId:string
 if(managed){goal=host.goals.command({action:'start',operationId:'goal',expectedRevision:0,title:'Project review',objective:'PRIVATE_GOAL_OBJECTIVE',authorizationQuote:'Continuously analyze and verify',criteria:[{id:'findings',description:'Explain the findings'}],nodes:[{id:'analyze',title:'Review the local project',instruction:'PRIVATE_NODE_INSTRUCTION',workerId:'one',criterionIds:['findings']}]},context)as RouterGoal;await host.goals.advance();goal=host.goals.get(goal.id)!;ticketId=goal.taskIds[0]!}
 else ticketId=(await host.manager.call({action:'assign',id:'one',revision:host.settings.current().revision,requestId:'ordinary',text:taskText},{discussion:'local:topic',trigger,scoped:context})).ticketId
 const ticket=host.store.tickets.get(ticketId)!,workspace=()=>operatorWorkspace(host),detail=()=>operatorTask(host,ticketId)!,save=(g:RouterGoal)=>host.store.put('router-goal',g.id,g)
 return {root,host,trigger,context,ticket,goal,workspace,detail,save}
}
function db(store:Store){return store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row=>{const name=String(row.name);return [name,store.db.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'"').all().sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))]})}
it('uses the real goal scheduler node label while retaining original title, task and mandate bytes',async()=>{
 const f=await fixture(),before=db(f.host.store),raw=JSON.stringify(f.host.store.tickets.get(f.ticket.id)),contract=stableDigest(f.goal!.contract),snapshot=vi.spyOn(f.host.goals,'snapshot')
 const result=f.workspace(),task=result.tasks.find(t=>t.id===f.ticket.id)!
 expect(task).toMatchObject({title:f.ticket.title,displayTitle:'Review the local project'});expect(task.title).toMatch(/^\{"objective"/);expect(result.activeTasks.find(t=>t.id===f.ticket.id)?.displayTitle).toBe(task.displayTitle);expect(snapshot).toHaveBeenCalledTimes(1)
 expect(JSON.stringify(f.host.store.tickets.get(f.ticket.id))).toBe(raw);expect(stableDigest(f.host.goals.get(f.goal!.id)!.contract)).toBe(contract);expect(db(f.host.store)).toEqual(before)
})
it('reuses one readable goal snapshot for task detail, including its legacy artifact/review selection',async()=>{
 const f=await fixture(),snapshot=vi.spyOn(f.host.goals,'snapshot'),detail=f.detail()
 expect(snapshot).toHaveBeenCalledTimes(1);expect(detail).toMatchObject({title:f.ticket.title,displayTitle:'Review the local project',contractView:{availability:'available'}});expect(detail.message).toBe(f.host.store.triggers.get(f.ticket.origin.triggerId)!.text);expect(detail).toHaveProperty('approvals')
})
it('falls back to a readable goal label only when its task and node association is unambiguous',async()=>{
 const f=await fixture(),g={...f.goal!,nodes:undefined};f.save(g);expect(f.workspace().tasks[0]?.displayTitle).toBe('Project review')
 f.save({...g,title:'{"objective":"PRIVATE_MACHINE_LABEL"}'});expect(f.workspace().tasks[0]?.displayTitle).toBe('Task')
})
for(const label of ['[Bug] Fix the result','[分析] 检查输入','[Bug]','{Notes} Review the result'])it('retains an ordinary tagged node title: '+label,async()=>{
 const f=await fixture(),goal={...f.goal!,nodes:f.goal!.nodes!.map(n=>({...n,title:label}))};f.save(goal)
 const before=db(f.host.store),contract=stableDigest(goal.contract);expect(f.workspace().tasks[0]?.displayTitle).toBe(label);expect(f.detail().displayTitle).toBe(label);expect(f.host.goals.get(goal.id)!.nodes![0]!.title).toBe(label);expect(stableDigest(f.host.goals.get(goal.id)!.contract)).toBe(contract);expect(db(f.host.store)).toEqual(before)
})
for(const label of ['[Bug] Fix the result','[分析] 检查输入'])it('retains a tagged goal fallback label: '+label,async()=>{
 const f=await fixture();f.save({...f.goal!,title:label,nodes:undefined});expect(f.workspace().tasks[0]?.displayTitle).toBe(label)
})
for(const label of ['{}','[]','{"label":"PRIVATE_JSON"}','["PRIVATE_JSON"]','{"objective":"PRIVATE_TRUNCATED'])it('still rejects a complete JSON container or known wrapper label: '+label.slice(0,25),async()=>{
 const f=await fixture();f.save({...f.goal!,title:label,nodes:f.goal!.nodes!.map(n=>({...n,title:label}))});expect(f.workspace().tasks[0]?.displayTitle).toBe('Task')
})
it('uses no goal/node label if two nodes claim the same task',async()=>{
 const f=await fixture(),g=f.goal!,n=g.nodes![0]!;f.save({...g,nodes:[n,{...n,id:'duplicate',title:'PRIVATE_OTHER_NODE'}]});expect(f.workspace().tasks[0]?.displayTitle).toBe('Task')
})
it('does not choose a visible goal when a second hidden goal also claims the task',async()=>{
 const f=await fixture(),g=f.goal!;f.save({...g,id:'hidden-other-goal',title:'PRIVATE_OTHER_GOAL',bindingRevision:g.bindingRevision+50,nodes:g.nodes?.map(n=>({...n,title:'PRIVATE_OTHER_NODE'}))})
 const visible=f.host.goals.snapshot();expect(visible.map(g=>g.id)).toEqual([g.id]);expect(f.workspace().tasks[0]?.displayTitle).toBe('Task')
})
it('does not choose between multiple readable goals that claim the task',async()=>{
 const f=await fixture(),g=f.goal!;f.save({...g,id:'another-goal',title:'PRIVATE_OTHER_GOAL'});expect(f.workspace().tasks[0]?.displayTitle).toBe('Task')
})
for(const state of ['missing route','source revoked','source disabled','private entry','stale binding','goal cleaned','context unavailable'])it('does not reveal hidden labels or establish authorization for '+state,async()=>{
 const f=await fixture(),store=f.host.store,binding=f.host.scopes.binding(f.context.route.entryId)
 if(state==='missing route')store.db.prepare("DELETE FROM records WHERE kind='router-route' AND id=?").run(f.trigger.id)
 if(state==='source revoked')f.host.config.sources[0]!.allowedActors=[]
 if(state==='source disabled')f.host.config.sources[0]!.enabled=false
 if(state==='private entry')store.put('entry-binding',binding.id,{...binding,privateActor:'alice'})
 if(state==='stale binding')store.put('entry-binding',binding.id,{...binding,revision:binding.revision+1})
 if(state==='goal cleaned')vi.spyOn(f.host.memory.cleanup,'blocked').mockImplementation((kind,id)=>kind==='router-goal'&&id===f.goal!.id)
 if(state==='context unavailable')f.save({...f.goal!,contextIds:['missing-context']})
 const before=db(store),changes=store.db.prepare('SELECT total_changes() AS n').get()!.n,result=f.workspace(),label=result.tasks.find(t=>t.id===f.ticket.id)!.displayTitle
 expect(label).toBe('Task');expect(label).not.toMatch(/PRIVATE|Review|Project/);expect(db(store)).toEqual(before);expect(store.db.prepare('SELECT total_changes() AS n').get()!.n).toBe(changes)
})
it('keeps ordinary human titles byte-for-byte as in the existing bounded field, ignoring machine scope content',async()=>{
 const f=await fixture(false,'  Summarize the meeting notes — 请保留中文  '),ticket={...f.ticket,mandate:{...f.ticket.mandate,scope:'{"objective":"PRIVATE_IN_SCOPE","node":{"title":"Wrong label"}}'}};f.host.store.tickets.save(ticket)
 expect(f.workspace().tasks[0]).toMatchObject({title:ticket.title,displayTitle:ticket.title});expect(f.detail().displayTitle).toBe(ticket.title)
})
for(const title of ['{"objective":"PRIVATE_TRUNCATED','{"kind":"goal_node","instruction":"PRIVATE"}','{"kind":"reviewed_goal_step","instruction":"PRIVATE"}'])it('uses a generic label for a recognized generated packet without an associated readable goal: '+title.slice(0,25),async()=>{
 const f=await fixture(false,title),row=f.workspace().tasks[0]!;expect(row.title).toBe(title);expect(row.displayTitle).toBe('Task')
})
it('does not parse arbitrary JSON or infer business intent from otherwise ordinary titles',async()=>{
 const f=await fixture(false,'Discuss the objective and node design');expect(f.workspace().tasks[0]?.displayTitle).toBe(f.ticket.title)
})
it('quarantines former goal labels for continuations instead of mining their text',async()=>{
 const f=await fixture();f.host.store.put('task-continuation',f.ticket.id,{ticketId:f.ticket.id,text:'PRIVATE_NEW_TEXT',triggerId:f.trigger.id,discussion:'local:topic',inputIds:[],priorReports:[]});expect(f.workspace().tasks[0]?.displayTitle).toBe('Task')
})
it('uses the actual continuation record key even when its body has missing or mismatched identity metadata',async()=>{
 const f=await fixture();for(const body of [{text:'PRIVATE_OLD_TEXT'},{ticketId:'another-task',text:'PRIVATE_OLD_TEXT'}]){f.host.store.put('task-continuation',f.ticket.id,body);expect(f.workspace().tasks[0]?.displayTitle).toBe('Task')}
})
it('adds the same label to retained active-worker rows without changing their original title or run',async()=>{
 const f=await fixture(),run:Run={ticketId:f.ticket.id,assignmentId:f.ticket.assignments.at(-1)!.id,cwd:f.root,phase:'running',workerId:'one',backendId:'codex'};f.host.store.put('run',f.ticket.id,run);const before=db(f.host.store),active=f.workspace().architecture.workers[0]!.active[0]!
 expect(active).toMatchObject({ticketId:f.ticket.id,title:f.ticket.title,displayTitle:'Review the local project'});expect(db(f.host.store)).toEqual(before)
})
it('refreshes labels without using revisions as a cache or rewriting the contract',async()=>{
 const f=await fixture(),first=f.workspace().tasks[0]!.displayTitle;f.save({...f.goal!,nodes:f.goal!.nodes!.map(n=>({...n,title:'Review the findings'}))});expect(f.workspace().tasks[0]?.displayTitle).not.toBe(first);expect(f.host.goals.get(f.goal!.id)!.revision).toBe(f.goal!.revision)
})
it('searches the newly displayed goal label while retaining existing search fields',async()=>{
 const f=await fixture(),g={...f.goal!,nodes:undefined,title:'Readable review label'};f.save(g);expect(operatorWorkspace(f.host,0,25,{search:'Readable review label'}).tasks[0]?.displayTitle).toBe(g.title);expect(operatorWorkspace(f.host,0,25,{search:'PRIVATE_GOAL_OBJECTIVE'}).tasks[0]?.title).toBe(f.ticket.title)
})
it('does not copy malformed typed labels or object coercion into the new field',async()=>{
 const f=await fixture();f.save({...f.goal!,title:{secret:'PRIVATE'}as any,nodes:f.goal!.nodes?.map(n=>({...n,title:{secret:'PRIVATE'}as any}))});expect(f.workspace().tasks[0]?.displayTitle).toBe('Task')
})
it('leaves all host/observer tables and total_changes unchanged without additional contract, model, tool or source work',async()=>{
 const f=await fixture(),directory=join(f.root,'state','watchdog');mkdirSync(directory,{recursive:true});const observer=new Store(join(directory,'state.sqlite'));observers.push(observer);observer.put('model-usage','running',{state:'running'});const before=db(f.host.store),other=db(observer),changes=f.host.store.db.prepare('SELECT total_changes() AS n').get()!.n
 const model=vi.spyOn(f.host.model,'run'),tools=vi.spyOn(f.host.toolConnections,'catalog'),create=vi.spyOn(f.host.sourceRegistry,'create'),verify=vi.spyOn(f.host.verification,'current'),fetch=vi.fn(()=>{throw Error('No network calls permitted')});vi.stubGlobal('fetch',fetch)
 for(let i=0;i<3;i++)expect(f.workspace().tasks[0]?.displayTitle).toBe('Review the local project')
 for(const fn of [model,tools,create,verify,fetch])expect(fn).not.toHaveBeenCalled();expect(db(f.host.store)).toEqual(before);expect(db(observer)).toEqual(other);expect(f.host.store.db.prepare('SELECT total_changes() AS n').get()!.n).toBe(changes)
})
it('exposes the additive label on existing protected GETs, including a missing-route generic fallback, with zero writes',async()=>{
 const f=await fixture();f.host.pause(true);const server=await serve(f.host);servers.push(server);clearInterval((f.host as any).timer);const headers={authorization:'Bearer '+readFileSync(server.tokenPath,'utf8').trim()},path=server.url+'/entry-workspace/task/'+encodeURIComponent(f.ticket.id)
 for(const missing of [false,true]){if(missing)f.host.store.db.prepare("DELETE FROM records WHERE kind='router-route' AND id=?").run(f.trigger.id);const before=db(f.host.store),changes=f.host.store.db.prepare('SELECT total_changes() AS n').get()!.n,response=await fetch(path,{headers});expect(response.status).toBe(200);const body=await response.json()as any;expect(body.title).toBe(f.ticket.title);expect(body.displayTitle).toBe(missing?'Task':'Review the local project');expect(db(f.host.store)).toEqual(before);expect(f.host.store.db.prepare('SELECT total_changes() AS n').get()!.n).toBe(changes)}
})
