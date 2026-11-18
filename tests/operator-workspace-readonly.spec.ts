import {appendFileSync,mkdtempSync,readFileSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {afterEach,expect,it,vi} from 'vitest'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
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
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'operator-workspace-readonly-'));roots.push(root)
 const config=configSchema.parse({stateDir:join(root,'state'),port:0,acceptMode:'auto',work:{sandboxDriver:'disabled',autoRecover:false},execution:{router:{mode:'host'},management:{enabled:true,maxWorkers:1},workers:[{id:'one',backend:'codex'}]},sources:[{id:'local',kind:'local',cwd:root,workspace:{mode:'source'},allowedActors:['operator']}]})
 const model=vi.fn(async()=>{throw Error('No model permitted')}),history=vi.fn(async()=>{throw Error('No history read permitted')})
 const host=new Runtime(config,{model:{describe:()=>({id:'codex',kind:'codex',resume:true,tools:true,images:false,nativeTakeover:false,steering:false,promptRefresh:false}),run:model,history}});hosts.push(host);host.pause(true)
 const deliver=vi.spyOn(host.sources.get('local')!,'deliver')
 host.scopes.command({action:'scope.put',operationId:'scope',expectedRevision:0,scope:{id:'team',tenantId:'org',name:'Team',contextBytes:128000,managers:[JSON.stringify(['local','operator'])],workerIds:['one'],sourceIds:['local'],backendIds:['codex']}})
 host.scopes.command({action:'entry.bind',operationId:'entry',expectedRevision:0,scopeId:'team',sourceId:'local',accountNamespace:'local',nativeId:'topic',history:'group'})
 const receive=(id:string,thread:string)=>{
  const result=host.receive('local','operator',{id,thread,scope:'topic',text:'Continuously inspect this project and report findings',addressed:true}) as {triggerId:string}
  const trigger=host.store.triggers.get(result.triggerId)!
  return {trigger,context:host.scopes.context(trigger,'local:'+thread)!}
 }
 return {root,host,model,history,deliver,receive,original:receive('original','topic')}
}
type Fixture=ReturnType<typeof fixture>
function goalWake(f:Fixture,anchor=f.original){
 const goal=f.host.goals.command({action:'start',operationId:'wake-goal',expectedRevision:0,title:'Inspection',objective:'Inspect the requested result',authorizationQuote:'Continuously inspect',criteria:[{id:'result',description:'Report findings',files:[],documents:[]}]},anchor.context) as RouterGoal
 f.host.store.db.prepare("UPDATE jobs SET state='done' WHERE kind='router'").run()
 f.host.store.put('router-goal',goal.id,{...goal,nextAt:Date.now()-1});f.host.goals.tick()
 const wake=f.host.store.list<{goalId:string;triggerId:string}>('goal-wake').find(r=>r.goalId===goal.id)!
 expect(wake).toBeDefined();const trigger=f.host.store.triggers.get(wake.triggerId)!
 return {goal,anchor:{trigger,context:f.host.scopes.context(trigger,goal.discussion)!}}
}
function scheduledSkill(f:Fixture){
 const skill={id:'local-readonly-fixture',version:1},entryId=f.original.context.route.entryId
 // Synthetic local saved-method metadata; actual host scheduling creates the
 // derived trigger and goal. No model, remote provider or message is involved.
 f.host.store.put('skill-version',stableDigest([skill.id,skill.version]),{...skill,scopeId:'team',entryId,goalId:'fixture-seed',acceptanceId:'fixture-seed',template:{title:'Inspection',objective:'Inspect and report findings',criteria:[{id:'result',description:'Report findings',files:[],documents:[]}],nodes:[{id:'build',title:'Inspect',instruction:'Inspect and report',workerId:'one',criterionIds:['result'],dependsOn:[]}]}})
 const plan=f.host.proactive.command({action:'schedule.put',scopeId:'team',operationId:'plan',expectedRevision:0,schedule:{id:'daily',name:'Check',triggerId:f.original.trigger.id,prompt:'Inspect scheduled work',skill,mode:'standalone',notification:'silent',timing:{kind:'once',startAt:new Date(Date.now()+60_000).toISOString(),timezone:'UTC'}}}) as {revision:number}
 const run=f.host.proactive.command({action:'schedule.run',scopeId:'team',operationId:'launch',expectedRevision:plan.revision,id:'daily'}) as ScheduledRun
 f.host.proactive.runSkill(run.id)
 const goalId=f.host.store.get<{goalId:string}>('router-schedule-run',run.id)!.goalId,goal=f.host.goals.get(goalId)!,trigger=f.host.store.triggers.get(run.triggerId!)!
 return {goal,anchor:{trigger,context:f.host.scopes.context(trigger,'local:'+trigger.threads[0]!.id)!}}
}
async function task(f:Fixture,derived?:ReturnType<typeof goalWake>){
 const anchor=derived?.anchor??f.original
 const result=await f.host.manager.call({action:'assign',id:'one',revision:f.host.settings.current().revision,requestId:'assign',text:'Inspect the local fixture'},{discussion:anchor.context.route.discussion,trigger:anchor.trigger,scoped:anchor.context})
 const ticket=f.host.store.tickets.get(result.ticketId)!,assignment=ticket.assignments.at(-1)!
 f.host.engine.assignmentStarted(ticket.id,assignment.id)
 f.host.store.put('run',ticket.id,{ticketId:ticket.id,assignmentId:assignment.id,cwd:f.root,phase:'human',threadId:'fixture-session',turnId:'fixture-turn',backendId:'codex',workerId:'one'} satisfies Run)
 f.host.engine.report(ticket.id,{state:'blocked',summary:'Local progress',question:'Which local document?'})
 if(derived){const goal=derived.goal;goal.taskIds=[ticket.id];if(goal.nodes?.[0]){goal.nodes[0].ticketId=ticket.id;goal.nodes[0].state='running'}f.host.store.put('router-goal',goal.id,goal)}
 const promise=f.host.approvals.request(ticket.id,{id:'local-native-request',method:'item/commandExecution/requestApproval',params:{threadId:'fixture-session',turnId:'fixture-turn',command:'local fixture metadata'}});void promise.catch(()=>{})
 return f.host.store.tickets.get(ticket.id)!
}
async function listen(f:Fixture){
 const server=await serve(f.host);servers.push(server)
 clearInterval((f.host as unknown as {timer:ReturnType<typeof setInterval>}).timer)
 const headers={Authorization:'Bearer '+readFileSync(server.tokenPath,'utf8').trim()}
 return {server,headers,get:(path:string)=>fetch(server.url+path,{headers})}
}
function state(f:Fixture){
 const rows:Record<string,unknown>={}
 for(const row of f.host.store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()){
  const name=String(row.name);if(/^[a-z_0-9]+$/.test(name))rows[name]=f.host.store.db.prepare('SELECT * FROM '+name).all()
 }
 const pending=(f.host.approvals as unknown as {pending:Map<string,unknown>}).pending
 return {rows:JSON.stringify(rows,(_,v)=>typeof v==='bigint'?String(v):v instanceof Uint8Array?Array.from(v):v),changes:Number(f.host.store.db.prepare('SELECT total_changes() AS count').get()!.count),pending,waiters:new Map(pending)}
}
function unchanged(f:Fixture,before:ReturnType<typeof state>){
 const after=state(f);expect(after.rows).toBe(before.rows);expect(after.changes).toBe(before.changes);expect(after.pending).toBe(before.pending);expect([...after.pending.keys()]).toEqual([...before.waiters.keys()])
 for(const [id,waiter] of before.waiters)expect(after.pending.get(id)).toBe(waiter)
 expect(f.model).not.toHaveBeenCalled();expect(f.history).not.toHaveBeenCalled();expect(f.deliver).not.toHaveBeenCalled()
}

it.each(['scheduled_skill','goal_wake','scheduled_dependency_goal_wake'] as const)('keeps both legacy GETs read-only across a missing %s inner anchor without removing live approval display',async scenario=>{
 const f=fixture();let missing=f.original.trigger
 let derived:ReturnType<typeof goalWake>
 if(scenario==='goal_wake')derived=goalWake(f)
 else{
  if(scenario==='scheduled_dependency_goal_wake'){
   const human=f.receive('nested-human','other'),wake=goalWake(f,human);missing=human.trigger
   f.host.store.put('router-input-set',f.original.trigger.id,{triggerIds:[wake.anchor.trigger.id]})
  }
  derived=scheduledSkill(f)
 }
 const ticket=await task(f,derived),http=await listen(f),detail='/entry-workspace/task/'+encodeURIComponent(ticket.id)
 const verify=async(contractAvailability=scenario==='goal_wake'?'not_captured':'available')=>{
  const before=state(f);expect(before.waiters.size).toBe(1)
  const list=await http.get('/entry-workspace');expect(list.status).toBe(200)
  const work=await list.json();expect(work.tasks).toContainEqual(expect.objectContaining({id:ticket.id,state:'attention',question:'Which local document?',approvalIds:[...before.waiters.keys()]}))
  unchanged(f,before)
  const response=await http.get(detail);expect(response.status).toBe(200)
  const body=await response.json();expect(body).toMatchObject({id:ticket.id,question:'Which local document?',approvals:[{id:[...before.waiters.keys()][0],method:'item/commandExecution/requestApproval',request:{threadId:'fixture-session',turnId:'fixture-turn',command:'local fixture metadata'}}]})
  expect(body.contractView).toMatchObject({schema:1,readOnly:true,availability:contractAvailability})
  if(contractAvailability==='unavailable')expect(body.contractView).toMatchObject({objective:null,scope:null,criteria:[],basis:{contract:null,goalId:null}})
  unchanged(f,before)
 }
 await verify()
 f.host.store.db.prepare("DELETE FROM records WHERE kind='router-route' AND id=?").run(missing.id)
 expect(f.host.store.get('router-route',derived.anchor.trigger.id)).toBeDefined()
 await verify('unavailable');expect(f.host.store.get('router-route',missing.id)).toBeUndefined()
 // Neither the HTTP read scope nor its caught nested lookup can leak into
 // ordinary execution. Default goal observation still derives normal routes.
 expect(f.host.goals.snapshot().some(g=>g.id===derived.goal.id)).toBe(true)
 expect(f.host.store.get('router-route',missing.id)).toBeDefined()
 await verify()
})

it('preserves existing authentication, methods, query validation and missing-task responses without writes',async()=>{
 const f=fixture(),ticket=await task(f),http=await listen(f),detail='/entry-workspace/task/'+encodeURIComponent(ticket.id),before=state(f)
 for(const path of ['/entry-workspace',detail]){
  expect((await fetch(http.server.url+path)).status).toBe(401)
  expect((await fetch(http.server.url+path,{method:'POST',headers:http.headers})).status).toBe(404)
 }
 for(const query of ['?limit=101','?offset=-1','?state=invalid'])expect((await http.get('/entry-workspace'+query)).status).toBe(400)
 expect((await http.get('/entry-workspace?offset=0&limit=1&state=attention')).status).toBe(200)
 expect((await http.get('/entry-workspace/task/missing')).status).toBe(404)
 unchanged(f,before)
})

it('returns a fixed sanitized unavailable response and restores both scopes after a projection throws',async()=>{
 const f=fixture(),derived=scheduledSkill(f),ticket=await task(f,derived),http=await listen(f),before=state(f)
 const fail=vi.spyOn(f.host.goals,'snapshot').mockImplementation(()=>{throw Error('SECRET_INTERNAL_FAILURE')})
 for(const path of ['/entry-workspace','/entry-workspace/task/'+encodeURIComponent(ticket.id)]){
  const response=await http.get(path);expect(response.status).toBe(503);expect(await response.json()).toEqual({code:'operator_workspace_unavailable'});unchanged(f,before)
 }
 fail.mockRestore()
 f.host.store.db.prepare("DELETE FROM records WHERE kind='router-route' AND id=?").run(f.original.trigger.id)
 expect(f.host.goals.snapshot().some(g=>g.id===derived.goal.id)).toBe(true);expect(f.host.store.get('router-route',f.original.trigger.id)).toBeDefined()
 const restored=state(f);expect((await http.get('/entry-workspace')).status).toBe(200);unchanged(f,restored)
})

it('does not apply or repair an unreconciled real revocation ledger on either GET',async()=>{
 const f=fixture(),ticket=await task(f),http=await listen(f),body={seq:1,previous:'',tenantId:'org',scopeId:'team',action:'forget',generation:0,id:'absent-fact',at:Date.now()}
 const ledger=join(f.host.config.stateDir,'memory-revocations.jsonl');appendFileSync(ledger,JSON.stringify({...body,hash:stableDigest(body)})+'\n')
 const bytes=readFileSync(ledger,'utf8'),before=state(f),goals=vi.spyOn(f.host.goals,'snapshot')
 for(const path of ['/entry-workspace','/entry-workspace/task/'+encodeURIComponent(ticket.id)]){
  const response=await http.get(path);expect(response.status).toBe(503);expect(await response.json()).toEqual({code:'operator_workspace_unavailable'});unchanged(f,before)
 }
 expect(goals).not.toHaveBeenCalled();expect(readFileSync(ledger,'utf8')).toBe(bytes);expect(f.host.store.get('memory-revocation-head','current')).toBeUndefined()
})
