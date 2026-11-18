import {request as httpRequest} from 'node:http'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {afterEach,expect,it,vi} from 'vitest'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
import {ExecutionTrace,uninstallExecutionTrace,traceQuerySchema} from '../src/execution-trace.ts'
import type {Model} from '../src/model.ts'
import type {Run} from '../src/store.ts'
import {planHistory} from '../src/history-cleanup.ts'
import {serve} from '../src/server.ts'
import type {RouterGoal} from '../src/router-goals.ts'
import type {ScheduledRun} from '../src/router-proactive.ts'

const roots:string[]=[],hosts:Runtime[]=[]
afterEach(async()=>{for(const host of hosts.splice(0))await host.close();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true})})
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'agenthub-trace-'));roots.push(root)
 const config=configSchema.parse({stateDir:join(root,'state'),work:{sandboxDriver:'disabled',autoRecover:false},sources:[{id:'local',kind:'local',cwd:root,allowedActors:['operator']}]})
 const history=vi.fn(async()=>({turns:[{text:'SECRET_PROVIDER_PAYLOAD',reasoning:'PRIVATE_REASONING'}]}))
 const model:Model={describe:()=>({id:'codex',kind:'codex',nativeTakeover:false,images:false,resume:true,tools:true,steering:false,promptRefresh:false}),history,async run(){throw Error('No inference is authorized by this fixture')}}
 const host=new Runtime(config,{model});hosts.push(host)
 return {root,config,model,history,host,trace:new ExecutionTrace(()=>host)}
}
function task(host:Runtime,key='fixture'){
 const {triggerId}=host.receive('local','operator',{id:key,thread:key,text:'SECRET_USER_INPUT',addressed:true}) as {triggerId:string}
 const decision=host.engine.decide(triggerId,{kind:'accept',title:'SECRET_TITLE',scope:'SECRET_SCOPE',reason:'Fixture request',rules:[]})
 const ticket=host.store.tickets.get(decision.ticketId!)!,assignment=ticket.assignments.at(-1)!
 host.engine.assignmentStarted(ticket.id,assignment.id)
 host.store.put('run',ticket.id,{ticketId:ticket.id,assignmentId:assignment.id,cwd:host.config.sources[0]!.cwd,phase:'idle',threadId:'fixture-session',backendId:'codex',workerId:'worker-1'} satisfies Run)
 host.engine.report(ticket.id,{state:'blocked',summary:'SECRET_REPORT',question:null})
 return host.store.tickets.get(ticket.id)!
}
function command(trace:ExecutionTrace,ticketId:string,action:'inspect'|'read_history'|'resume_session'|'cancel',requestId='request'){
 const current=trace.snapshot({ticketId}).tasks[0]!
 return {ticketId,action,requestId,revision:current.revision,observed:current.observed}
}
it('projects actual lifecycle, dispatch, approvals, tools, results and acceptance without arbitrary payloads',()=>{
 const {host,trace}=fixture(),ticket=task(host)
 host.store.put('worker-assignment',ticket.id,{ticketId:ticket.id,workerId:'worker-1',discussion:'fixture',source:'local',actor:'operator',mode:'client'})
 const run=host.store.get<Run>('run',ticket.id)!
 host.store.put('run',ticket.id,{...run,phase:'running',error:'SECRET_ERROR',instructions:'SECRET_PROMPT'})
 host.store.put('approval','approval-1',{id:'approval-1',ticketId:ticket.id,status:'pending',expiresAt:Date.now()+20000,native:{params:{token:'SECRET_TOKEN',command:'SECRET_COMMAND'}}})
 host.store.put('tool-receipt','tool-1',{id:'tool-1',ticketId:ticket.id,state:'complete',connection:'fixture',tool:'fixture',result:{secret:'SECRET_RAW_RESPONSE'},fingerprint:'fixture'})
 host.store.put('run',ticket.id,{...run,result:'SECRET_RESULT'})
 host.store.put('goal-delivery','result-1',{id:'result-1',ticketId:ticket.id,reply:'SECRET_REPLY'})
 host.store.put('goal-verification','round-1',{id:'round-1',ticketIds:[ticket.id],state:'passed',checks:[{verdict:'passed',explanation:'SECRET_ACCEPTANCE_EXPLANATION'}]})
 const data=trace.events({ticketId:ticket.id,limit:200}),kinds=new Set(data.events.map(e=>e.stage))
 for(const stage of ['task','assignment','run','approval','tool','result','acceptance'])expect(kinds.has(stage as any)).toBe(true)
 expect(data.events.some(e=>e.state==='passed')).toBe(true)
 const projected=host.store.db.prepare("SELECT body FROM audit WHERE json_extract(body,'$.type')='execution.trace'").all()
 expect(JSON.stringify(projected)+JSON.stringify(trace.snapshot())+JSON.stringify(data)).not.toMatch(/SECRET_|PRIVATE_REASONING/)
 expect(trace.snapshot({ticketId:ticket.id}).tasks[0]).toMatchObject({pendingApprovals:1,hasResult:true,acceptance:{state:'passed',passed:1},evidence:{commit:'unverified',tests:'unverified',deployment:'unverified'}})
})
it('appends durable job and outbox transitions even when authoritative updates use direct SQL',()=>{
 const {host,trace}=fixture(),ticket=task(host),cursor=trace.events().cursor
 host.store.enqueue('job-1','execute',{ticketId:ticket.id,token:'SECRET_JOB_TOKEN'})
 host.store.jobState('job-1','running')
 host.store.db.prepare("UPDATE jobs SET state='uncertain',error='SECRET_STDERR' WHERE id='job-1'").run()
 const trigger=host.store.triggers.get(ticket.origin.triggerId)!
 host.store.outbox.send({id:'delivery-1',ticketId:ticket.id,kind:'reply',channel:trigger.channel!,text:'SECRET_DELIVERY'})
 host.store.deliveryStarted('delivery-1');host.store.deliveryFailed('delivery-1',1,'SECRET_PROVIDER_ERROR',true)
 const page=trace.events({cursor,ticketId:ticket.id,limit:200})
 expect(page.events.filter(e=>e.stage==='job').map(e=>e.state)).toEqual(['pending','running','uncertain'])
 expect(page.events.filter(e=>e.stage==='delivery').map(e=>e.state)).toEqual(['pending','sending','uncertain'])
 expect(JSON.stringify(page)).not.toContain('SECRET_')
 expect(trace.snapshot({ticketId:ticket.id}).tasks[0]).toMatchObject({unknownEffects:true,next:'reconcile'})
})
it('uses stable audit IDs and cursors with bounded catch-up, unrelated events and task filters',()=>{
 const {host,trace}=fixture(),first=task(host,'first'),second=task(host,'second')
 for(let n=0;n<15;n++){host.store.audit({type:'unrelated',payload:'SECRET_UNRELATED'});host.store.put('run',first.id,{...host.store.get<Run>('run',first.id)!,phase:n%2?'running':'idle'})}
 const seen:string[]=[],selected:string[]=[];let cursor=0,more=true
 while(more){const page=trace.events({cursor,limit:3});expect(page.events.length).toBeLessThanOrEqual(3);seen.push(...page.events.map(e=>e.id));expect(page.cursor).toBeGreaterThanOrEqual(cursor);cursor=page.cursor;more=page.more}
 expect(new Set(seen).size).toBe(seen.length);expect(seen.length).toBeGreaterThan(15)
 const end=trace.events({cursor});expect(end.events).toEqual([]);expect(end.cursor).toBe(cursor)
 let taskCursor=0
 do{const page=trace.events({cursor:taskCursor,ticketId:second.id,limit:2});selected.push(...page.events.map(e=>e.ticketId!));taskCursor=page.cursor;more=page.more}while(more)
 expect(selected.length).toBeGreaterThan(0);expect(selected.every(id=>id===second.id)).toBe(true)
 expect(trace.events({cursor:0,limit:3}).events.map(e=>e.id)).toEqual(seen.slice(0,3))
 expect(()=>trace.events({cursor:cursor+1})).toThrow('trace_cursor_ahead')
 expect(()=>traceQuerySchema.parse({limit:201})).toThrow()
})
it('rolls trace events back atomically with failed authoritative transactions and deduplicates unchanged state',()=>{
 const {host,trace}=fixture(),ticket=task(host),cursor=trace.events().cursor,run=host.store.get<Run>('run',ticket.id)!
 host.store.put('run',ticket.id,run);expect(trace.events({cursor}).events).toEqual([])
 expect(()=>host.store.atomic(()=>{host.store.put('run',ticket.id,{...run,phase:'running'});throw Error('synthetic rollback')})).toThrow('synthetic rollback')
 expect(trace.events({cursor}).events).toEqual([]);expect(host.store.get<Run>('run',ticket.id)!.phase).toBe('idle')
})
it('preserves events across a real host restart without duplicating installation snapshots',async()=>{
 const {host,trace,config,model}=fixture(),ticket=task(host),original=trace.events({limit:200}),at=original.cursor,session=trace.snapshot({ticketId:ticket.id}).tasks[0]!.sessionRef
 await host.close();hosts.splice(hosts.indexOf(host),1)
 const restored=new Runtime(config,{model});hosts.push(restored);const resumedTrace=new ExecutionTrace(()=>restored)
 expect(resumedTrace.events({limit:200}).events.slice(0,original.events.length)).toEqual(original.events)
 expect(resumedTrace.events({cursor:at}).events.every(e=>!e.baseline)).toBe(true)
 expect(resumedTrace.snapshot({ticketId:ticket.id}).tasks[0]!.sessionRef).toBe(session)
})
it('labels an initial current-state capture separately from historical domain audit events',()=>{
 const {host}=fixture();uninstallExecutionTrace(host.store);host.store.db.prepare("DELETE FROM records WHERE kind='execution-trace-meta'").run()
 const ticket=task(host),trace=new ExecutionTrace(()=>host),events=trace.events({ticketId:ticket.id,limit:200}).events
 expect(events.some(e=>e.entity==='domain'&&!e.baseline)).toBe(true)
 expect(events.some(e=>e.entity==='run'&&e.baseline)).toBe(true)
})
it('keeps commit, tests and deployment separate and does not promote completed tools into evidence',()=>{
 const {host,trace}=fixture(),ticket=task(host)
 const call=host.activity.begin('tool','git commit && npm test && deploy',{ticketId:ticket.id});host.activity.finish(call,'completed')
 expect(trace.snapshot({ticketId:ticket.id}).tasks[0]!.evidence).toMatchObject({commit:'unverified',tests:'unverified',deployment:'unverified'})
 host.store.put('project-commit','commit-1',{ticketId:ticket.id,head:'a'.repeat(40),test:{exit:1,command:'SECRET_TEST_COMMAND',output:'SECRET_TEST_OUTPUT'}})
 expect(trace.snapshot({ticketId:ticket.id}).tasks[0]!.evidence).toMatchObject({commit:'recorded',commitRef:'a'.repeat(40),tests:'failed',deployment:'unverified'})
 host.store.put('project-commit','commit-1',{ticketId:ticket.id,head:'a'.repeat(40),test:{exit:0,command:'SECRET_TEST_COMMAND',output:'SECRET_TEST_OUTPUT'}})
 const events=trace.events({ticketId:ticket.id,limit:200}).events
 expect(events.some(e=>e.stage==='commit'&&e.state==='completed')).toBe(true)
 expect(events.filter(e=>e.stage==='test').map(e=>e.state)).toEqual(['failed','passed'])
 expect(JSON.stringify(events)).not.toContain('SECRET_')
})
it('performs only a read-only session check and never returns provider history or reasoning',async()=>{
 const {host,trace,history}=fixture(),ticket=task(host),run=vi.spyOn(host.model,'run')
 const input=command(trace,ticket.id,'read_history'),result=await trace.recover(input)
 expect(result).toMatchObject({status:'history_verified',replayed:false});expect(history).toHaveBeenCalledExactlyOnceWith('fixture-session',host.config.sources[0]!.cwd)
 expect(JSON.stringify(result)).not.toMatch(/SECRET_|PRIVATE_REASONING/);expect(run).not.toHaveBeenCalled()
 expect(await trace.recover(input)).toEqual(result);expect(history).toHaveBeenCalledTimes(1)
})
it('rejects stale settings, stale task state and conflicting request IDs without executing recovery',async()=>{
 const {host,trace,history}=fixture(),ticket=task(host),input=command(trace,ticket.id,'read_history')
 await expect(trace.recover({...input,revision:99})).rejects.toThrow('trace_settings_conflict')
 host.store.put('run',ticket.id,{...host.store.get<Run>('run',ticket.id)!,phase:'running'})
 await expect(trace.recover(input)).rejects.toThrow('trace_changed');expect(history).not.toHaveBeenCalled()
 host.store.put('run',ticket.id,{...host.store.get<Run>('run',ticket.id)!,phase:'idle'})
 const next=command(trace,ticket.id,'read_history');await trace.recover(next)
 await expect(trace.recover({...next,action:'inspect'})).rejects.toThrow('trace_request_conflict')
})
it('rejects a stale late session check and does not overwrite changed task state',async()=>{
 const {host,trace,history}=fixture(),ticket=task(host);let release!:(value:unknown)=>void
 history.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve as any}))
 const input=command(trace,ticket.id,'read_history'),pending=trace.recover(input)
 await expect(trace.recover(input)).rejects.toThrow('trace_recovery_pending')
 host.store.put('run',ticket.id,{...host.store.get<Run>('run',ticket.id)!,phase:'uncertain'})
 release({text:'SECRET_LATE_HISTORY'})
 await expect(pending).rejects.toThrow('trace_changed')
 expect(host.store.get<Run>('run',ticket.id)!.phase).toBe('uncertain')
})
it('resumes using the existing runtime and exact original session with an atomic idempotent receipt',async()=>{
 const {host,trace}=fixture(),ticket=task(host),retry=vi.spyOn(host,'retry'),input=command(trace,ticket.id,'resume_session')
 expect(trace.snapshot({ticketId:ticket.id}).tasks[0]!.actions).toContain('resume_session')
 const result=await trace.recover(input);expect(result.status).toBe('resumed');expect(retry).toHaveBeenCalledExactlyOnceWith(ticket.id)
 expect(host.store.get<Run>('run',ticket.id)!.threadId).toBe('fixture-session');expect(host.store.tickets.get(ticket.id)!.assignments).toHaveLength(2)
 expect(await trace.recover(input)).toEqual(result);expect(retry).toHaveBeenCalledTimes(1)
})
it.each(['run','tool','work','delivery','workflow'])('requires reconciliation for unknown %s effects and never calls retry',async kind=>{
 const {host,trace}=fixture(),ticket=task(host),retry=vi.spyOn(host,'retry')
 if(kind==='run')host.store.put('run',ticket.id,{...host.store.get<Run>('run',ticket.id)!,phase:'uncertain',error:'SECRET_OUTCOME_ERROR'})
 if(kind==='tool')host.store.put('tool-receipt','uncertain-tool',{id:'uncertain-tool',ticketId:ticket.id,state:'uncertain',connection:'fixture',tool:'fixture'})
 if(kind==='work')host.store.put('work','interrupted-work',{id:'interrupted-work',ticketId:ticket.id,state:'interrupted',kind:'shell'})
 if(kind==='delivery'){host.store.outbox.send({id:'uncertain-delivery',ticketId:ticket.id,kind:'reply',channel:host.store.triggers.get(ticket.origin.triggerId)!.channel!,text:'fixture'});host.store.deliveryFailed('uncertain-delivery',1,'secret',true)}
 if(kind==='workflow')host.store.put('workflow-action','uncertain-workflow',{id:'uncertain-workflow',ticketId:ticket.id,state:'uncertain'})
 const current=trace.snapshot({ticketId:ticket.id}).tasks[0]!
 expect(current).toMatchObject({unknownEffects:true,next:'reconcile'});expect(current.actions).not.toContain('resume_session')
 await expect(trace.recover(command(trace,ticket.id,'resume_session'))).rejects.toThrow('trace_reconcile_required');expect(retry).not.toHaveBeenCalled()
})
it('blocks recovery after permission revocation, pending approval and session identity changes',async()=>{
 const {host,trace}=fixture(),ticket=task(host)
 host.config.sources[0]!.enabled=false
 expect(trace.snapshot({ticketId:ticket.id}).tasks[0]!.actions).not.toContain('resume_session')
 expect(trace.snapshot({ticketId:ticket.id}).tasks[0]!.actions).not.toContain('read_history')
 host.config.sources[0]!.enabled=true
 host.store.put('approval','pending',{id:'pending',ticketId:ticket.id,status:'pending',expiresAt:Date.now()+20000})
 expect(trace.snapshot({ticketId:ticket.id}).tasks[0]!).toMatchObject({pendingApprovals:1,next:'answer_approval'})
 expect(trace.snapshot({ticketId:ticket.id}).tasks[0]!.actions).not.toContain('resume_session')
 host.store.put('approval','pending',{id:'pending',ticketId:ticket.id,status:'expired'})
 vi.spyOn(host.model,'describe').mockImplementation(()=>{throw Error('SECRET_CHANGED_IDENTITY')})
 expect(trace.snapshot({ticketId:ticket.id}).tasks[0]!.actions).not.toContain('resume_session')
})
it('cancels through the existing runtime and cannot resurrect a stopped task with stale or fresh requests',async()=>{
 const {host,trace}=fixture(),ticket=task(host),resume=command(trace,ticket.id,'resume_session','stale-resume'),input=command(trace,ticket.id,'cancel'),stop=vi.spyOn(host,'stop')
 const result=await trace.recover(input);expect(result.status).toBe('cancelled');expect(stop).toHaveBeenCalledExactlyOnceWith(ticket.id)
 expect(host.store.tickets.get(ticket.id)!.ended?.outcome).toBe('stopped');expect(await trace.recover(input)).toEqual(result)
 expect(trace.snapshot({ticketId:ticket.id}).tasks[0]!.actions).not.toContain('resume_session')
 await expect(trace.recover(resume)).rejects.toThrow('trace_changed')
 await expect(trace.recover(command(trace,ticket.id,'resume_session','fresh-resume'))).rejects.toThrow('trace_action_unavailable')
})
it('invalidates a recovery observation when host commit or test evidence changes',async()=>{
 const {host,trace,history}=fixture(),ticket=task(host),input=command(trace,ticket.id,'read_history')
 host.store.put('project-commit','new-evidence',{ticketId:ticket.id,head:'b'.repeat(40),test:{exit:0}})
 await expect(trace.recover(input)).rejects.toThrow('trace_changed');expect(history).not.toHaveBeenCalled()
})
it('does not retry an uncertain cancellation and reconciles an already stopped outcome',async()=>{
 const {host,trace}=fixture(),ticket=task(host),stop=vi.spyOn(host,'stop').mockRejectedValueOnce(Error('SECRET_STOP_FAILURE')),input=command(trace,ticket.id,'cancel')
 await expect(trace.recover(input)).rejects.toThrow('trace_recovery_uncertain')
 await expect(trace.recover(input)).rejects.toThrow('trace_recovery_uncertain');expect(stop).toHaveBeenCalledTimes(1)
 host.engine.stopTicket(ticket.id,'Fixture outcome reconciled')
 expect((await trace.recover(input)).status).toBe('cancelled');expect(stop).toHaveBeenCalledTimes(1)
})
it('hides cleaned history and rejects direct trace access and cached receipts after a cleanup fence',async()=>{
 const {host,trace}=fixture(),ticket=task(host),call=host.activity.begin('tool','fixture tool',{ticketId:ticket.id}),visibility=trace.events().visibility,history=command(trace,ticket.id,'read_history')
 await trace.recover(history)
 host.store.put('memory-evidence','cleanup-evidence',{id:'cleanup-evidence',scopeId:'cleanup-scope',locator:'trigger:'+ticket.origin.triggerId})
 host.memory.cleanup.apply(planHistory(host.store,host.config.stateDir,'cleanup-scope','trace-cleanup',Date.now(),'cleanup-evidence'))
 host.store.put('run',ticket.id,{...host.store.get<Run>('run',ticket.id)!,phase:'running'})
 expect(trace.snapshot().tasks).toEqual([]);expect(trace.events({limit:200}).events.some(e=>e.ticketId===ticket.id)).toBe(false)
 expect(()=>trace.events({ticketId:ticket.id})).toThrow('trace_task_missing');expect(()=>trace.snapshot({ticketId:ticket.id})).toThrow('trace_task_missing')
 expect(trace.events().visibility).not.toBe(visibility);await expect(trace.recover(history)).rejects.toThrow('trace_task_missing')
 expect(()=>trace.exportRecoveryPackage({ticketId:ticket.id,revision:history.revision,observed:history.observed})).toThrow('trace_task_missing')
 expect(host.activity.list().find(a=>a.id===call)).toBeDefined()
})
it('supports an offline hook rollback without deleting authoritative state or retained evidence',()=>{
 const {host,trace}=fixture(),ticket=task(host),before=trace.events({limit:200}).events.length,cursor=trace.events().cursor
 uninstallExecutionTrace(host.store)
 host.store.put('run',ticket.id,{...host.store.get<Run>('run',ticket.id)!,phase:'running'})
 expect(trace.events({cursor}).events).toEqual([])
 expect(host.store.get<Run>('run',ticket.id)!.phase).toBe('running')
 expect(trace.events({limit:200}).events.length).toBe(before)
})


it.each(['scheduled','goal_wake','scheduled_dependency_goal_wake'] as const)('keeps snapshot and protected GET read-only for a missing inner %s anchor',async scenario=>{
 const root=mkdtempSync(join(tmpdir(),'trace-inner-route-'));roots.push(root)
 const config=configSchema.parse({stateDir:join(root,'state'),port:0,acceptMode:'auto',work:{sandboxDriver:'disabled',autoRecover:false},execution:{router:{mode:'host'},management:{enabled:true,maxWorkers:1},workers:[{id:'one',backend:'codex'}]},sources:[{id:'local',kind:'local',cwd:root,workspace:{mode:'source'},allowedActors:['operator']}]})
 const modelRun=vi.fn(async()=>{throw Error('No inference permitted')}),history=vi.fn(async()=>{throw Error('No history read permitted')})
 const host=new Runtime(config,{model:{describe:()=>({id:'codex',kind:'codex',resume:true,tools:true,images:false,nativeTakeover:false,steering:false,promptRefresh:false}),run:modelRun,history}});hosts.push(host);host.pause(true)
 const deliver=vi.spyOn(host.sources.get('local')!,'deliver')
 host.scopes.command({action:'scope.put',operationId:'scope',expectedRevision:0,scope:{id:'team',tenantId:'org',name:'Team',contextBytes:128000,managers:[JSON.stringify(['local','operator'])],workerIds:['one'],sourceIds:['local'],backendIds:['codex']}})
 host.scopes.command({action:'entry.bind',operationId:'entry',expectedRevision:0,scopeId:'team',sourceId:'local',accountNamespace:'local',nativeId:'topic',history:'group'})
 const receive=(key:string,thread:string)=>{
  const {triggerId}=host.receive('local','operator',{id:key,thread,scope:'topic',text:'Continuously inspect this project and report findings',addressed:true}) as {triggerId:string}
  const trigger=host.store.triggers.get(triggerId)!
  return {trigger,context:host.scopes.context(trigger,'local:'+thread)!}
 }
 const original=receive('original','topic');let missing=original.trigger,anchor=original
 const wake=(input:typeof original)=>{
  const goal=host.goals.command({action:'start',operationId:'wake-goal',expectedRevision:0,title:'Inspection',objective:'Inspect the requested result',authorizationQuote:'Continuously inspect',criteria:[{id:'result',description:'Report findings',files:[],documents:[]}]},input.context) as RouterGoal
  host.store.db.prepare("UPDATE jobs SET state='done' WHERE kind='router'").run()
  host.store.put('router-goal',goal.id,{...goal,nextAt:Date.now()-1});host.goals.tick()
  const record=host.store.list<{goalId:string;triggerId:string}>('goal-wake').find(r=>r.goalId===goal.id)!
  expect(record).toBeDefined();const trigger=host.store.triggers.get(record.triggerId)!
  return {trigger,context:host.scopes.context(trigger,goal.discussion)!}
 }
 if(scenario==='goal_wake')anchor=wake(original)
 if(scenario==='scheduled_dependency_goal_wake'){
  const human=receive('nested-human','other'),inner=wake(human);missing=human.trigger
  host.store.put('router-input-set',original.trigger.id,{triggerIds:[inner.trigger.id]})
 }
 if(scenario!=='goal_wake'){
  const plan=host.proactive.command({action:'schedule.put',scopeId:'team',operationId:'plan',expectedRevision:0,schedule:{id:'daily',name:'Check',triggerId:original.trigger.id,prompt:'Inspect scheduled work',mode:'standalone',notification:'silent',timing:{kind:'once',startAt:new Date(Date.now()+60_000).toISOString(),timezone:'UTC'}}}) as {revision:number}
  const scheduled=host.proactive.command({action:'schedule.run',scopeId:'team',operationId:'launch',expectedRevision:plan.revision,id:'daily'}) as ScheduledRun
  expect(scheduled.triggerId).toBeDefined();const trigger=host.store.triggers.get(scheduled.triggerId!)!
  anchor={trigger,context:host.scopes.context(trigger,'local:'+trigger.threads[0]!.id)!}
 }
 const result=await host.manager.call({action:'assign',id:'one',revision:host.settings.current().revision,requestId:'assign',text:'Inspect local fixture'},{discussion:anchor.context.route.discussion,trigger:anchor.trigger,scoped:anchor.context})
 const ticket=host.store.tickets.get(result.ticketId)!,assignment=ticket.assignments.at(-1)!
 host.engine.assignmentStarted(ticket.id,assignment.id)
 host.store.put('run',ticket.id,{ticketId:ticket.id,assignmentId:assignment.id,cwd:root,phase:'human',threadId:'fixture-session',turnId:'fixture-turn',backendId:'codex',workerId:'one'} satisfies Run)
 const waiting=host.approvals.request(ticket.id,{id:'local-fixture-approval',method:'item/commandExecution/requestApproval',params:{threadId:'fixture-session',turnId:'fixture-turn'}});void waiting.catch(()=>{})
 const trace=new ExecutionTrace(()=>host),server=await serve(host)
 try{
  clearInterval((host as unknown as {timer:ReturnType<typeof setInterval>}).timer)
  const dbState=()=>{
   const rows:Record<string,unknown>={}
   for(const row of host.store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()){
    const name=String(row.name);if(/^[a-z_0-9]+$/.test(name))rows[name]=host.store.db.prepare('SELECT * FROM '+name).all()
   }
   return JSON.stringify(rows,(_,value)=>typeof value==='bigint'?String(value):value instanceof Uint8Array?Array.from(value):value)
  }
  const totalChanges=()=>Number(host.store.db.prepare('SELECT total_changes() AS count').get()!.count)
  const positive=dbState(),positiveChanges=totalChanges()
  expect(trace.snapshot({ticketId:ticket.id}).tasks[0]!.actions).toContain('read_history');expect(dbState()).toBe(positive);expect(totalChanges()).toBe(positiveChanges)
  host.store.db.prepare("DELETE FROM records WHERE kind='router-route' AND id=?").run(missing.id)
  expect(host.store.get('router-route',anchor.trigger.id)).toBeDefined()
  const before=dbState(),beforeChanges=totalChanges(),pending=(host.approvals as unknown as {pending:Map<string,unknown>}).pending,waiters=new Map(pending)
  expect(waiters.size).toBe(1)
  expect(trace.snapshot({ticketId:ticket.id}).tasks[0]!.actions).not.toContain('read_history');expect(dbState()).toBe(before);expect(totalChanges()).toBe(beforeChanges)
  const token=readFileSync(server.tokenPath,'utf8').trim(),response=await fetch(server.url+'/api/execution-trace?ticketId='+encodeURIComponent(ticket.id),{headers:{Authorization:'Bearer '+token}})
  expect(response.status).toBe(200);expect((await response.json()).tasks[0].actions).not.toContain('read_history')
  expect(dbState()).toBe(before);expect(totalChanges()).toBe(beforeChanges);expect(host.store.get('router-route',missing.id)).toBeUndefined()
  expect((host.approvals as unknown as {pending:Map<string,unknown>}).pending).toBe(pending);expect([...pending.keys()]).toEqual([...waiters.keys()]);for(const [id,waiter] of waiters)expect(pending.get(id)).toBe(waiter)
  host.scopes.context(missing,'local:'+missing.threads[0]!.id)
  expect(host.store.get('router-route',missing.id)).toBeDefined()
  const restored=dbState(),restoredChanges=totalChanges();expect(trace.snapshot({ticketId:ticket.id}).tasks[0]!.actions).toContain('read_history');expect(dbState()).toBe(restored);expect(totalChanges()).toBe(restoredChanges)
  expect(modelRun).not.toHaveBeenCalled();expect(history).not.toHaveBeenCalled();expect(deliver).not.toHaveBeenCalled()
 }finally{
  server.server.closeAllConnections();await new Promise<void>(resolve=>server.server.close(()=>resolve()));await server.closeRuntime();hosts.splice(hosts.indexOf(host),1)
 }
})
it.each(['auth_required','quota_exhausted','rate_limited','HTTP 429 insufficient_quota'])('projects a bounded blocker and requires explicit repair confirmation for %s',async error=>{
 const {host,trace}=fixture(),ticket=task(host),retry=vi.spyOn(host,'retry'),run=host.store.get<Run>('run',ticket.id)!
 const old=command(trace,ticket.id,'resume_session')
 host.store.put('run',ticket.id,{...run,error:error+' SECRET_PROVIDER_DETAIL'})
 const current=trace.snapshot({ticketId:ticket.id}).tasks[0]!
 expect(current.blocker).toMatchObject({version:1,retryPolicy:{automatic:false}})
 expect(current.actions).toContain('resume_session')
 expect(JSON.stringify(current.blocker)).not.toContain('SECRET_')
 await expect(trace.recover(old)).rejects.toThrow('trace_changed')
 await expect(trace.recover(command(trace,ticket.id,'resume_session'))).rejects.toThrow('trace_repair_confirmation_required')
 expect(retry).not.toHaveBeenCalled()
})
it('retains unknown delivery precedence and projects only existing future execute schedule',()=>{
 const {host,trace}=fixture(),ticket=task(host),run=host.store.get<Run>('run',ticket.id)!
 host.store.put('run',ticket.id,{...run,error:'rate_limited'})
 host.store.enqueue('scheduled','execute',{ticketId:ticket.id})
 const future=Date.now()+60000
 host.store.db.prepare("UPDATE jobs SET next_at=? WHERE id='scheduled'").run(future)
 const before=host.store.db.prepare('SELECT * FROM jobs').all()
 expect(trace.snapshot({ticketId:ticket.id}).tasks[0]!.blocker?.retryPolicy.notBefore).toBe(future)
 expect(host.store.db.prepare('SELECT * FROM jobs').all()).toEqual(before)
 host.store.put('tool-receipt','uncertain',{id:'uncertain',ticketId:ticket.id,state:'uncertain'})
 expect(trace.snapshot({ticketId:ticket.id}).tasks[0]!.blocker).toMatchObject({kind:'outcomeUnknown',retryPolicy:{mode:'never'}})
})

it('allows a single confirmed continuation after repair without clearing historical error',async()=>{
 const {host,trace}=fixture(),ticket=task(host),retry=vi.spyOn(host,'retry'),run=host.store.get<Run>('run',ticket.id)!
 host.store.put('run',ticket.id,{...run,error:'quota_exhausted'})
 const input={...command(trace,ticket.id,'resume_session'),repairConfirmed:true}
 const result=await trace.recover(input)
 expect(result.status).toBe('resumed');expect(retry).toHaveBeenCalledTimes(1)
 expect(await trace.recover(input)).toEqual(result);expect(retry).toHaveBeenCalledTimes(1)
})
it('waits while a rate-limit job is scheduled and permits confirmed manual recovery after expiry',async()=>{
 const {host,trace}=fixture(),ticket=task(host),run=host.store.get<Run>('run',ticket.id)!
 host.store.put('run',ticket.id,{...run,error:'rate_limited'})
 host.store.enqueue('scheduled','execute',{ticketId:ticket.id})
 host.store.db.prepare("UPDATE jobs SET next_at=? WHERE id='scheduled'").run(Date.now()+60000)
 expect(trace.snapshot({ticketId:ticket.id}).tasks[0]!.actions).not.toContain('resume_session')
 host.store.db.prepare("UPDATE jobs SET next_at=0 WHERE id='scheduled'").run()
 expect(trace.snapshot({ticketId:ticket.id}).tasks[0]!.blocker).toMatchObject({owner:'runtime',retryPolicy:{mode:'scheduled'}})
 expect(trace.snapshot({ticketId:ticket.id}).tasks[0]!.actions).not.toContain('resume_session')
 host.store.db.prepare("UPDATE jobs SET state='done' WHERE id='scheduled'").run()
 expect(trace.snapshot({ticketId:ticket.id}).tasks[0]!.blocker).toMatchObject({owner:'operator',resolution:'review_rate_limit'})
 await expect(trace.recover({...command(trace,ticket.id,'resume_session'),repairConfirmed:true})).resolves.toMatchObject({status:'resumed'})
})

it('exports a redacted read-only recovery manifest from durable local checkpoints',()=>{
 const {host,trace}=fixture(),ticket=task(host)
 host.store.put('tool-receipt','checkpoint-secret',{id:'checkpoint-secret',ticketId:ticket.id,state:'complete',token:'SECRET_TOKEN',result:'SECRET_RESULT'})
 const before=host.store.db.prepare('SELECT * FROM records ORDER BY kind,id').all(),audit=host.store.db.prepare('SELECT * FROM audit ORDER BY seq').all()
 const current=trace.snapshot({ticketId:ticket.id}).tasks[0]!,manifest=current.recovery!
 expect(manifest).toMatchObject({schema:1,ticketId:ticket.id,settingsRevision:current.revision,observation:current.observed,replayAllowed:false,checkpointScope:'retained_ticket_history'})
 expect(manifest.checkpoints).toEqual([{stage:'tool',cursor:expect.any(Number),origin:'transition'}])
 expect(JSON.stringify(manifest)).not.toMatch(/SECRET_|fixture-session|checkpoint-secret/)
 expect(host.store.db.prepare('SELECT * FROM records ORDER BY kind,id').all()).toEqual(before)
 expect(host.store.db.prepare('SELECT * FROM audit ORDER BY seq').all()).toEqual(audit)
})
it('requires reconciliation even for retained effects not covered by legacy trace uncertainty',()=>{
 const {host,trace}=fixture(),ticket=task(host)
 host.store.put('pr-delivery',ticket.id+':old',{ticketId:ticket.id,phase:'unknown',token:'SECRET_TOKEN'})
 const current=trace.snapshot({ticketId:ticket.id}).tasks[0]!
 expect(current.status.effects.state).toBe('unknown')
 expect(current.recovery).toMatchObject({nextSafeAction:'reconcile_effects',replayAllowed:false})
})
it('keeps completed external effects separate from waiting delivery and does not propose replay',()=>{
 const {host,trace}=fixture(),ticket=task(host),trigger=host.store.triggers.get(ticket.origin.triggerId)!
 host.store.outbox.send({id:'pending-delivery',ticketId:ticket.id,kind:'reply',channel:trigger.channel!,text:'SECRET_DELIVERY'})
 expect(trace.snapshot({ticketId:ticket.id}).tasks[0]!.recovery).toMatchObject({nextSafeAction:'wait_for_current_work',replayAllowed:false})
 host.store.deliveryStarted('pending-delivery')
 expect(trace.snapshot({ticketId:ticket.id}).tasks[0]!.recovery!.nextSafeAction).toBe('reconcile_effects')
})
it('retains checkpoint references and conservative recovery guidance across restart',async()=>{
 const {host,trace,config,model}=fixture(),ticket=task(host)
 host.store.put('tool-receipt','unfinished',{id:'unfinished',ticketId:ticket.id,state:'uncertain'})
 const manifest=trace.snapshot({ticketId:ticket.id}).tasks[0]!.recovery!
 await host.close();hosts.splice(hosts.indexOf(host),1)
 const restored=new Runtime(config,{model});hosts.push(restored)
 const after=new ExecutionTrace(()=>restored).snapshot({ticketId:ticket.id}).tasks[0]!.recovery!
 expect(after.checkpoints).toEqual(manifest.checkpoints)
 expect(after.nextSafeAction).toBe('reconcile_effects');expect(after.replayAllowed).toBe(false)
})
it('does not hide pending approval or held delivery behind an in-progress effect',()=>{
 const {host,trace}=fixture(),ticket=task(host),trigger=host.store.triggers.get(ticket.origin.triggerId)!
 host.store.outbox.send({id:'held-delivery',ticketId:ticket.id,kind:'reply',channel:trigger.channel!,text:'SECRET_DELIVERY'})
 host.store.db.prepare("UPDATE outbox SET status='held' WHERE id='held-delivery'").run()
 host.store.put('approval','approval-mixed',{id:'approval-mixed',ticketId:ticket.id,status:'pending',expiresAt:Date.now()+60000})
 expect(trace.snapshot({ticketId:ticket.id}).tasks[0]!.recovery!.nextSafeAction).toBe('answer_approval')
 host.store.put('approval','approval-mixed',{id:'approval-mixed',ticketId:ticket.id,status:'expired',expiresAt:0})
 expect(trace.snapshot({ticketId:ticket.id}).tasks[0]!.recovery!.nextSafeAction).not.toBe('wait_for_current_work')
})

it.each(['pr-delivery','review-action','merge-attempt'])('fences recovery with authoritative %s uncertainty and fresh observations',async kind=>{
 const {host,trace}=fixture(),ticket=task(host),retry=vi.spyOn(host,'retry')
 const before=command(trace,ticket.id,'resume_session','before-effect')
 const key=kind==='pr-delivery'?ticket.id+':pr':'repository-effect'
 if(kind==='merge-attempt')host.store.put('merge-grant',key,{ticketId:ticket.id,head:'SECRET_HEAD'})
 const record={...(kind==='review-action'?{ticketId:ticket.id}:{}),phase:'uncertain',detail:'SECRET_EFFECT_DETAIL'}
 host.store.put(kind,key,record)
 const current=trace.snapshot({ticketId:ticket.id}).tasks[0]!
 expect(current).toMatchObject({unknownEffects:true,next:'reconcile',status:{effects:{state:'unknown'}},recovery:{nextSafeAction:'reconcile_effects'}})
 expect(current.actions).not.toContain('resume_session');expect(current.actions).toEqual(expect.arrayContaining(['inspect','read_history','cancel']))
 expect(JSON.stringify(current)).not.toContain('SECRET_')
 await expect(trace.recover(before)).rejects.toThrow('trace_changed')
 const uncertain=command(trace,ticket.id,'resume_session','uncertain-effect')
 await expect(trace.recover(uncertain)).rejects.toThrow('trace_reconcile_required')
 // Aggregate state/count remain unchanged, but the evidence basis changed.
 host.store.put(kind,key,{...record,detail:'changed private evidence'})
 await expect(trace.recover(uncertain)).rejects.toThrow('trace_changed')
 const stillUnknown=command(trace,ticket.id,'resume_session','before-resolution')
 const phase=kind==='pr-delivery'?'draft':kind==='review-action'?'resolved':'merged'
 host.store.put(kind,key,{...record,phase})
 await expect(trace.recover(stillUnknown)).rejects.toThrow('trace_changed')
 expect(trace.snapshot({ticketId:ticket.id}).tasks[0]!.actions).toContain('resume_session')
 const resolved=command(trace,ticket.id,'resume_session','before-clear')
 host.store.db.prepare('DELETE FROM records WHERE kind=? AND id=?').run(kind,key)
 await expect(trace.recover(resolved)).rejects.toThrow('trace_changed')
 expect(retry).not.toHaveBeenCalled()
 await expect(trace.recover(command(trace,ticket.id,'resume_session','fresh-clear'))).resolves.toMatchObject({status:'resumed'})
 expect(retry).toHaveBeenCalledExactlyOnceWith(ticket.id)
})
it('binds merge ownership changes without invalidating observations for unrelated receipts or reads',async()=>{
 const {host,trace}=fixture(),ticket=task(host),retry=vi.spyOn(host,'retry')
 host.store.put('merge-grant','merge',{ticketId:ticket.id,head:'head-one'})
 host.store.put('merge-attempt','merge',{phase:'merged'})
 const before=command(trace,ticket.id,'resume_session','ownership')
 const state=()=>JSON.stringify(host.store.db.prepare('SELECT * FROM records ORDER BY kind,id').all())
 const saved=state()
 expect(command(trace,ticket.id,'resume_session').observed).toBe(before.observed);expect(state()).toBe(saved)
 host.store.put('review-action','other',{ticketId:'unrelated',phase:'uncertain'})
 expect(command(trace,ticket.id,'resume_session').observed).toBe(before.observed)
 host.store.put('merge-grant','merge',{ticketId:ticket.id,head:'head-two'})
 await expect(trace.recover(before)).rejects.toThrow('trace_changed')
 const changed=command(trace,ticket.id,'resume_session','relinked')
 host.store.put('merge-grant','merge',{ticketId:'unrelated',head:'head-two'})
 await expect(trace.recover(changed)).rejects.toThrow('trace_changed');expect(retry).not.toHaveBeenCalled()
})

it('does not turn an in-progress repository receipt into a blanket recovery ban',()=>{
 const {host,trace}=fixture(),ticket=task(host)
 host.store.put('pr-delivery',ticket.id+':pr',{phase:'creating'})
 const current=trace.snapshot({ticketId:ticket.id}).tasks[0]!
 expect(current.status.effects.state).toBe('in_progress');expect(current.unknownEffects).toBe(false)
 expect(current.actions).toContain('resume_session')
})

it('exports only a fresh authorized redacted diagnostic package without reading sessions or writing state',()=>{
 const {host,trace,history}=fixture(),ticket=task(host),current=trace.snapshot({ticketId:ticket.id}).tasks[0]!
 const input={ticketId:ticket.id,revision:current.revision,observed:current.observed}
 const changes=()=>Number(host.store.db.prepare('SELECT total_changes() AS count').get()!.count),before=changes()
 const database=()=>JSON.stringify(host.store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row=>{
  const name=String(row.name);if(!/^[a-z_0-9]+$/.test(name))throw Error('Unexpected fixture table')
  return [name,host.store.db.prepare('SELECT * FROM '+name).all()]
 }),(_,value)=>typeof value==='bigint'?String(value):value instanceof Uint8Array?Array.from(value):value)
 const baseline=database()
 const data=trace.exportRecoveryPackage(input),text=JSON.stringify(data)
 expect(text).not.toMatch(/SECRET_|fixture-session|worker-1|sessionRef|cursor|observed|revision/)
 expect(text).not.toContain(ticket.id);expect(text).not.toContain(host.config.stateDir)
 expect(changes()).toBe(before);expect(database()).toBe(baseline);expect(history).not.toHaveBeenCalled()
 expect(trace.exportRecoveryPackage(input).payload.taskAlias).not.toBe(data.payload.taskAlias)
 expect(()=>trace.exportRecoveryPackage({...input,revision:input.revision+1})).toThrow('trace_settings_conflict')
 host.store.put('pr-delivery',ticket.id+':branch',{id:ticket.id,phase:'uncertain'})
 expect(()=>trace.exportRecoveryPackage(input)).toThrow('trace_changed')
 const latest=trace.snapshot({ticketId:ticket.id}).tasks[0]!
 expect(trace.exportRecoveryPackage({...input,observed:latest.observed}).payload).toMatchObject({unknownEffects:true,nextSafeAction:'reconcile_effects'})
 host.config.sources[0]!.allowedActors=[]
 expect(()=>trace.exportRecoveryPackage({...input,observed:latest.observed})).toThrow('trace_action_unavailable')
})
it('protects diagnostic export HTTP with operator, origin and strict selector/body checks',async()=>{
 const {host,trace}=fixture(),ticket=task(host),server=await serve(host)
 try{
  clearInterval((host as unknown as {timer:ReturnType<typeof setInterval>}).timer)
  const current=trace.snapshot({ticketId:ticket.id}).tasks[0]!,input={ticketId:ticket.id,revision:current.revision,observed:current.observed}
  const endpoint=server.url+'/api/execution-trace/recovery-package',token=readFileSync(server.tokenPath,'utf8').trim(),headers={'content-type':'application/json',authorization:'Bearer '+token}
  expect((await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)})).status).toBe(401)
  expect((await fetch(endpoint,{method:'POST',headers:{...headers,origin:'https://untrusted.invalid'},body:JSON.stringify(input)})).status).toBe(403)
  for(const query of ['workspace=other','source=other','unknown=true'])expect((await fetch(endpoint+'?'+query,{method:'POST',headers,body:JSON.stringify(input)})).status).toBe(400)
  expect((await fetch(endpoint,{method:'POST',headers,body:JSON.stringify({...input,workspace:'other'})})).status).toBe(400)
  const result=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify(input)})
  expect(result.status).toBe(200);expect(await result.json()).toMatchObject({payload:{format:'agent-hub-recovery-diagnostic',replayAllowed:false}})
 }finally{server.server.closeAllConnections();await new Promise<void>(resolve=>server.server.close(()=>resolve()));await server.closeRuntime();hosts.splice(hosts.indexOf(host),1)}
})

it('does not install projection hooks on the first export after a host replacement',()=>{
 const f=fixture();let active=f.host
 const trace=new ExecutionTrace(()=>active)
 const next=new Runtime({...f.config,stateDir:join(f.root,'replacement-state')},{model:f.model});hosts.push(next)
 const ticket=task(next);active=next
 const database=()=>JSON.stringify([next.store.db.prepare('SELECT * FROM sqlite_master ORDER BY name').all(),next.store.db.prepare('SELECT kind,id,body FROM records ORDER BY kind,id').all(),next.store.db.prepare('SELECT * FROM audit ORDER BY seq').all()])
 const before=database(),changes=next.store.db.prepare('SELECT total_changes() AS n').get()!.n
 expect(()=>trace.exportRecoveryPackage({ticketId:ticket.id,revision:next.settings.current().revision,observed:'0'.repeat(64)})).toThrow('trace_changed')
 expect(database()).toBe(before);expect(next.store.db.prepare('SELECT total_changes() AS n').get()!.n).toBe(changes)
})
it('rejects a partially streamed export after the real operator session is logged out',async()=>{
 const {host,trace}=fixture(),ticket=task(host),server=await serve(host)
 try{
  clearInterval((host as unknown as {timer:ReturnType<typeof setInterval>}).timer)
  const current=trace.snapshot({ticketId:ticket.id}).tasks[0]!,text=JSON.stringify({ticketId:ticket.id,revision:current.revision,observed:current.observed})
  const post=(path:string,body:unknown,cookie?:string)=>new Promise<{status:number;cookie?:string}>((resolve,reject)=>{
   const req=httpRequest(server.url+path,{method:'POST',agent:false,headers:{origin:server.url,'content-type':'application/json',...(cookie?{cookie}:{})}},res=>{res.resume();res.on('end',()=>resolve({status:res.statusCode!,cookie:res.headers['set-cookie']?.[0]?.split(';')[0]}))});req.on('error',reject);req.end(JSON.stringify(body))
  })
  const paired=await post('/pair',{code:new URL(server.operatorUrl).hash.slice('#pair='.length)})
  expect(paired.status).toBe(200)
  const cookie=paired.cookie!
  let arrived!:()=>void;const started=new Promise<void>(resolve=>{arrived=resolve})
  server.server.on('request',req=>{if(req.url==='/api/execution-trace/recovery-package')req.once('data',arrived)})
  let request!:ReturnType<typeof httpRequest>
  const response=new Promise<{status:number;body:string}>((resolve,reject)=>{
   request=httpRequest(server.url+'/api/execution-trace/recovery-package',{method:'POST',agent:false,headers:{cookie,origin:server.url,'content-type':'application/json','content-length':Buffer.byteLength(text)}},res=>{let body='';res.on('data',chunk=>{body+=chunk});res.on('end',()=>resolve({status:res.statusCode!,body}))});request.on('error',reject)
  })
  request.write(text.slice(0,1));await started
  expect((await post('/logout',{},cookie)).status).toBe(200)
  request.end(text.slice(1))
  const result=await response;expect(result.status).toBe(401);expect(result.body).not.toContain('agent-hub-recovery-diagnostic')
 }finally{server.server.closeAllConnections();await new Promise<void>(resolve=>server.server.close(()=>resolve()));await server.closeRuntime();hosts.splice(hosts.indexOf(host),1)}
})
