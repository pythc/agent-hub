import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {afterEach,expect,it,vi} from 'vitest'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
import {workspaceViewData} from '../src/workspace-view-data.ts'
import {buildViewPackage} from '../src/workspace-view-package.ts'
import {operatorWorkspace} from '../src/operator-workspace.ts'
import {serve} from '../src/server.ts'
import {stableDigest} from '../src/sources.ts'
import type {RouterGoal} from '../src/router-goals.ts'
import type {ScheduledRun} from '../src/router-proactive.ts'
import type {Run} from '../src/store.ts'

const roots:string[]=[],hosts:Runtime[]=[],servers:Awaited<ReturnType<typeof serve>>[]=[]
afterEach(async()=>{
 vi.restoreAllMocks()
 for(const server of servers.splice(0)){server.server.closeAllConnections();await new Promise<void>(resolve=>server.server.close(()=>resolve()));await server.closeRuntime();hosts.splice(hosts.indexOf(server.runtime),1)}
 for(const host of hosts.splice(0))await host.close()
 for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true})
})
async function fixture(mode:'goal'|'ordinary'|'scheduled'='goal'){
 const root=mkdtempSync(join(tmpdir(),'workspace-view-title-'));roots.push(root)
 const model=vi.fn(async()=>{throw Error('No model permitted')}),history=vi.fn(async()=>{throw Error('No history read permitted')})
 const host=new Runtime(configSchema.parse({stateDir:join(root,'state'),port:0,work:{sandboxDriver:'disabled',autoRecover:false},execution:{router:{mode:'host'},management:{enabled:true,maxWorkers:1},workers:[{id:'one',backend:'codex'}]},sources:[{id:'local',kind:'local',cwd:root,workspace:{mode:'source'},allowedActors:['alice']}]}),{model:{describe:()=>({id:'codex',kind:'codex',resume:true,tools:true,images:false,nativeTakeover:false,steering:false,promptRefresh:false}),run:model,history}});hosts.push(host)
 const deliver=vi.spyOn(host.sources.get('local')!,'deliver')
 host.scopes.command({action:'scope.put',operationId:'scope',expectedRevision:0,scope:{id:'team',tenantId:'org',name:'Team',contextBytes:128000,managers:[JSON.stringify(['local','alice'])],workerIds:['one'],sourceIds:['local'],backendIds:['codex']}})
 host.scopes.command({action:'entry.bind',operationId:'entry',expectedRevision:0,scopeId:'team',sourceId:'local',accountNamespace:'local',nativeId:'topic',history:'group'})
 const received=host.receive('local','alice',{id:'request',thread:'topic',scope:'topic',text:'Continuously inspect and verify a local result. Never deploy.',addressed:true}) as {triggerId:string}
 const original=host.store.triggers.get(received.triggerId)!,context=host.scopes.context(original,'local:topic')!
 const template={title:'Readable project review',objective:'PRIVATE_ORIGINAL_SEARCH_MARKER',criteria:[{id:'findings',description:'Explain the findings',files:[],documents:[]}],nodes:[{id:'review',title:'Review the workspace view',instruction:'PRIVATE_NODE_INSTRUCTION',workerId:'one',criterionIds:['findings'],dependsOn:[]}]}
 let goal:RouterGoal|undefined,ticketId:string,derivedTriggerId=original.id
 if(mode==='ordinary')ticketId=(await host.manager.call({action:'assign',id:'one',revision:host.settings.current().revision,requestId:'ordinary',text:'[Bug] Review the local issue'},{discussion:'local:topic',trigger:original,scoped:context})).ticketId
 else{
  if(mode==='scheduled'){
   const skill={id:'view-local-method',version:1};host.store.put('skill-version',stableDigest([skill.id,skill.version]),{...skill,scopeId:'team',entryId:context.route.entryId,goalId:'local-seed',acceptanceId:'local-seed',template})
   const plan=host.proactive.command({action:'schedule.put',scopeId:'team',operationId:'plan',expectedRevision:0,schedule:{id:'daily',name:'View check',triggerId:original.id,prompt:'Inspect the local view',skill,mode:'standalone',notification:'silent',timing:{kind:'once',startAt:new Date(Date.now()+60_000).toISOString(),timezone:'UTC'}}}) as {revision:number}
   const run=host.proactive.command({action:'schedule.run',scopeId:'team',operationId:'launch',expectedRevision:plan.revision,id:'daily'}) as ScheduledRun
   host.proactive.runSkill(run.id);goal=host.goals.get(host.store.get<{goalId:string}>('router-schedule-run',run.id)!.goalId)!;derivedTriggerId=run.triggerId!
  }else goal=host.goals.command({...template,action:'start',operationId:'goal',expectedRevision:0,authorizationQuote:'Continuously inspect and verify'},context) as RouterGoal
  await host.goals.advance();goal=host.goals.get(goal.id)!;ticketId=goal.taskIds[0]!
 }
 expect(ticketId).toBeTruthy();let ticket=host.store.tickets.get(ticketId)!,assignment=ticket.assignments.at(-1)!
 host.engine.assignmentStarted(ticket.id,assignment.id)
 host.store.put('run',ticket.id,{ticketId:ticket.id,assignmentId:assignment.id,cwd:root,phase:'human',threadId:'local-view-session',turnId:'local-view-turn',backendId:'codex',workerId:'one'} satisfies Run)
 host.engine.report(ticket.id,{state:'blocked',summary:'Local review pending',question:'Which local document?'})
 ticket=host.store.tickets.get(ticket.id)!;host.pause(true)
 return {root,host,goal,ticket,original,derivedTriggerId,model,history,deliver}
}
function state(host:Runtime){
 const tables:Record<string,unknown>={}
 for(const row of host.store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()){
  const name=String(row.name);if(/^[a-z_0-9]+$/.test(name))tables[name]=host.store.db.prepare('SELECT * FROM '+name).all()
 }
 return {rows:JSON.stringify(tables,(_,value)=>typeof value==='bigint'?String(value):value instanceof Uint8Array?Array.from(value):value),changes:Number(host.store.db.prepare('SELECT total_changes() AS n').get()!.n)}
}
function unchanged(f:Awaited<ReturnType<typeof fixture>>,before:ReturnType<typeof state>){
 expect(state(f.host)).toEqual(before);expect(f.model).not.toHaveBeenCalled();expect(f.history).not.toHaveBeenCalled();expect(f.deliver).not.toHaveBeenCalled()
}
it('feeds readable titles into the unchanged view task/attention contract while preserving original-title search',async()=>{
 const f=await fixture(),before=state(f.host),raw=JSON.stringify(f.host.store.tickets.get(f.ticket.id)),snapshot=vi.spyOn(f.host.goals,'snapshot')
 const view=workspaceViewData(f.host,{})
 expect(snapshot).toHaveBeenCalledTimes(1);expect(f.ticket.title).toMatch(/^\{"objective"/)
 expect(view.tasks.items[0]).toMatchObject({id:f.ticket.id,title:'Review the workspace view',state:'attention'})
 expect(view.attention.items[0]?.title).toBe('Review the workspace view')
 expect(Object.keys(view.tasks.items[0]!)).not.toContain('displayTitle');expect(Object.keys(view.tasks.items[0]!)).not.toContain('originalTitle')
 expect(JSON.stringify(view)).not.toMatch(/PRIVATE_|\{"objective"/)
 expect(workspaceViewData(f.host,{search:'PRIVATE_ORIGINAL_SEARCH_MARKER'}).tasks.items[0]?.title).toBe('Review the workspace view')
 expect(workspaceViewData(f.host,{search:'workspace view',state:'attention',source:'local'}).tasks.total).toBe(1)
 expect(workspaceViewData(f.host,{search:'unmatched value'}).tasks.total).toBe(0)
 expect(JSON.stringify(f.host.store.tickets.get(f.ticket.id))).toBe(raw);unchanged(f,before)
})
it('retains ordinary tagged task labels and their existing filters and pagination',async()=>{
 const f=await fixture('ordinary'),before=state(f.host),title=operatorWorkspace(f.host).tasks[0]!.title
 expect(title).toContain('[Bug]');expect(workspaceViewData(f.host,{}).tasks.items[0]?.title).toBe(title)
 expect(workspaceViewData(f.host,{search:'[bug]',source:'local',state:'attention'}).tasks.total).toBe(1)
 expect(workspaceViewData(f.host,{offset:25})).toMatchObject({tasks:{items:[],total:1,offset:25,limit:25,more:false}});unchanged(f,before)
})
it.each(['private','ambiguous'] as const)('inherits the existing generic fallback for a %s goal without exposing its label',async mode=>{
 const f=await fixture()
 if(mode==='private'){const entry=f.host.scopes.binding(f.goal!.entryId);f.host.store.put('entry-binding',entry.id,{...entry,privateActor:'alice'})}
 else f.host.store.put('router-goal','second-owner',{...f.goal!,id:'second-owner',title:'PRIVATE_OTHER_GOAL',nodes:f.goal!.nodes?.map(n=>({...n,title:'PRIVATE_OTHER_NODE'}))})
 const before=state(f.host),view=workspaceViewData(f.host,{})
 expect(view.tasks.items[0]?.title).toBe('Task');expect(view.attention.items[0]?.title).toBe('Task');expect(JSON.stringify(view)).not.toMatch(/PRIVATE_|Review the workspace view/)
 expect(workspaceViewData(f.host,{search:'PRIVATE_ORIGINAL_SEARCH_MARKER'}).tasks.total).toBe(1);unchanged(f,before)
})
it('keeps direct and actual protected mounted-view GET reads at zero writes across a missing scheduled inner anchor',async()=>{
 const f=await fixture('scheduled'),entry=join(f.root,'view-entry.ts');writeFileSync(entry,'document.body.textContent="Local view fixture";')
 const pkg=await buildViewPackage(entry,{category:'workspace-view',id:'title-view',version:'1.0.0',label:{en:'Local title view','zh-CN':'本地标题视图'},capabilities:['workspace.runtime.read']},join(f.root,'view-package'))
 f.host.config.viewPlugins=[{id:pkg.manifest.id,directory:pkg.directory,digest:pkg.digest,enabled:true}]
 const server=await serve(f.host);servers.push(server);clearInterval((f.host as unknown as {timer:ReturnType<typeof setInterval>}).timer)
 const headers={authorization:'Bearer '+readFileSync(server.tokenPath,'utf8').trim()},path=server.url+'/api/workspace-views/title-view/runtime?digest='+pkg.digest
 expect((await fetch(path)).status).toBe(401)
 for(const missing of [false,true]){
  if(missing)f.host.store.db.prepare("DELETE FROM records WHERE kind='router-route' AND id=?").run(f.original.id)
  expect(f.host.store.get('router-route',f.derivedTriggerId)).toBeDefined()
  const before=state(f.host),expected=missing?'Task':'Review the workspace view',direct=workspaceViewData(f.host,{})
  expect(direct.tasks.items[0]?.title).toBe(expected);expect(direct.attention.items[0]?.title).toBe(expected);unchanged(f,before)
  const response=await fetch(path,{headers});expect(response.status).toBe(200);const body=await response.json()
  expect(body.tasks.items[0].title).toBe(expected);expect(body.attention.items[0].title).toBe(expected);expect(JSON.stringify(body)).not.toMatch(/PRIVATE_|\{"objective"/)
  const search=await fetch(path+'&search=PRIVATE_ORIGINAL_SEARCH_MARKER',{headers});expect(search.status).toBe(200);expect((await search.json()).tasks.items[0].title).toBe(expected)
  unchanged(f,before);if(missing)expect(f.host.store.get('router-route',f.original.id)).toBeUndefined()
 }
 // Default execution is intentionally unchanged; restoring a normal route
 // does not migrate or rewrite the task's generated title or immutable goal.
 f.host.scopes.context(f.original,'local:topic');expect(f.host.store.get('router-route',f.original.id)).toBeDefined()
 const restored=state(f.host);expect(workspaceViewData(f.host,{}).tasks.items[0]?.title).toBe('Review the workspace view');unchanged(f,restored)
})
