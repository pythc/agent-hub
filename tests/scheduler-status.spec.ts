import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach,expect,it,vi} from 'vitest'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
import {serve} from '../src/server.ts'
import {schedulerRoutingKind,schedulerRoutingKey,schedulerInteractiveJob,schedulerFollowupSlot} from '../src/scheduler-status.ts'
import type {Job,Run} from '../src/store.ts'
import type {Model} from '../src/model.ts'
const roots:string[]=[],hosts:Runtime[]=[],releases:(()=>void)[]=[],servers:Awaited<ReturnType<typeof serve>>[]=[]
afterEach(async()=>{releases.splice(0).forEach(r=>r());for(const s of servers.splice(0))await new Promise<void>(r=>s.server.close(()=>r()));for(const h of hosts.splice(0))await h.close();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});vi.restoreAllMocks()})
function fixture(explicit=true,model?:Model){
 const root=mkdtempSync(join(tmpdir(),'agenthub-scheduler-'));roots.push(root)
 const config=configSchema.parse({port:0,stateDir:join(root,'state'),concurrency:2,execution:explicit?{workers:[{id:'one',backend:'codex'},{id:'two',backend:'codex'}]}:{},work:{sandboxDriver:'disabled',autoRecover:false},sources:[{id:'local',kind:'local',cwd:root,allowedActors:['operator']}]})
 const host=new Runtime(config,{model:model??{async run(){throw Error('No provider call authorized')}}});hosts.push(host);return host
}
function heldPerform(host:Runtime){return vi.spyOn(host as any,'perform').mockImplementation(()=>new Promise<void>(resolve=>releases.push(resolve)))}
function enqueue(host:Runtime,id:string,kind='fixture',payload:unknown={}){host.store.enqueue(id,kind,payload)}
function job(kind:string,ticketId?:string):Job{return {id:kind+':fixture',kind,payload:{ticketId},state:'pending',attempts:0,nextAt:0}}
function task(host:Runtime){const {triggerId}=host.receive('local','operator',{id:'human',thread:'human',text:'SECRET_PROMPT',addressed:true}) as {triggerId:string};const d=host.engine.decide(triggerId,{kind:'accept',title:'SECRET_TITLE',scope:'SECRET_SCOPE',reason:'Fixture',rules:[]});return host.store.tickets.get(d.ticketId!)!}
function db(host:Runtime){return ['records','jobs','outbox','audit'].map(table=>host.store.db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all())}
it('shares the exact routing predicates, including both admission/counting exceptions',()=>{
 for(const kind of ['assess','followup','router','router-admit','router-followup','router-batch','workflow-decision','goal-verify','goal-replan']){expect(schedulerRoutingKind(kind)).toBe(true);expect(schedulerRoutingKey(kind+':test')).toBe(true)}
 for(const kind of ['router-scheduled-followup','router-skill-run']){expect(schedulerRoutingKind(kind)).toBe(true);expect(schedulerRoutingKey(kind+':test')).toBe(false)}
 for(const kind of ['execute','start','fixture']){expect(schedulerRoutingKind(kind)).toBe(false);expect(schedulerRoutingKey(kind+':test')).toBe(false)}
})
it('observes actual tick worker saturation and queued work without advancing the pool cursor',async()=>{
 const h=fixture(),perform=heldPerform(h);for(let i=0;i<3;i++)enqueue(h,'fixture:'+i)
 await h.tick();expect(perform).toHaveBeenCalledTimes(2);const before=db(h),s=h.schedulerStatus()
 expect(s.occupancy).toMatchObject({jobs:2,workerJobs:2,routingJobs:0});expect(s.queue.ready).toBe(1);expect(db(h)).toEqual(before);expect(h.store.get('worker-pool','cursor')).toBeUndefined()
})
it('observes four counted routing jobs while preserving the two routing-count exceptions',async()=>{
 const h=fixture(),perform=heldPerform(h);for(let i=0;i<5;i++)enqueue(h,'router:'+i,'router')
 await h.tick();expect(perform).toHaveBeenCalledTimes(4);expect(h.schedulerStatus()).toMatchObject({occupancy:{routingJobs:4},routing:{countedLimit:4,admittedButWorkerCountedJobs:0},queue:{ready:1}})
})
it.each(['router-scheduled-followup','router-skill-run'])('does not falsely apply the counted routing cap to %s',async kind=>{
 const h=fixture();heldPerform(h);for(let i=0;i<5;i++)enqueue(h,kind+':'+i,kind)
 await h.tick();expect(h.schedulerStatus()).toMatchObject({occupancy:{routingJobs:0,workerJobs:5},routing:{admittedButWorkerCountedJobs:5}})
})
it('reports paused admission without treating waiting jobs as live occupancy',async()=>{
 const h=fixture(),perform=heldPerform(h);h.pause(true);enqueue(h,'fixture:queued');await h.tick()
 expect(perform).not.toHaveBeenCalled();expect(h.schedulerStatus()).toMatchObject({paused:true,occupancy:{jobs:0,controllers:0},queue:{ready:1}})
})
it('counts paused and retiring profiles separately from idle enabled profiles',()=>{
 const h=fixture();h.config.execution.workers=[{id:'one',backend:'codex',state:'paused'},{id:'two',backend:'codex',state:'retiring'},{id:'three',backend:'codex'}]
 h.store.put('run','not-actually-running',{ticketId:'not-actually-running',assignmentId:'a',cwd:'SECRET_PATH',phase:'running',workerId:'three'} satisfies Run)
 // A phase is only dispatch's busy hint, never proof of an actual live job/controller.
 expect(h.schedulerStatus()).toMatchObject({workers:{configured:3,enabled:1,paused:1,retiring:1,idleEnabled:0},occupancy:{jobs:0,controllers:0}})
})
it('counts background reservations only with assignment-owned automatic live work and no controller',()=>{
 const h=fixture(),run:Run={ticketId:'background',assignmentId:'current',cwd:'SECRET_PATH',phase:'background',workerId:'one',interactiveReserve:true};h.store.put('run',run.ticketId,run)
 const work={ticketId:run.ticketId,assignmentId:'old',cwd:'SECRET_PATH',sandbox:'read-only',depth:0,id:'work',kind:'agent',state:'running',createdAt:Date.now(),notify:'auto',prompt:'SECRET_WORK'}
 h.store.put('work',work.id,work);expect(h.schedulerStatus().occupancy.backgroundReservations).toBe(0)
 h.store.put('work',work.id,{...work,assignmentId:'current'});expect(h.schedulerStatus()).toMatchObject({occupancy:{backgroundReservations:1,activeManagedWork:1},interactive:{activeReservedExecutions:1},workers:{idleEnabled:1}})
 h.store.put('work',work.id,{...work,assignmentId:'current',notify:'held'});expect(h.schedulerStatus().occupancy.backgroundReservations).toBe(0)
})
it('explains the existing-session condition without granting a fresh explicit-pool reserve',()=>{
 const h=fixture(),t=task(h),j=job('execute',t.id)
 h.store.tickets.save({...t,inputs:[...t.inputs,{id:'human-input',kind:'trigger',triggerId:t.origin.triggerId,at:new Date().toISOString(),human:true}],undelivered:[...t.undelivered,'human-input']})
 expect(schedulerInteractiveJob(h.store,j)).toBe(true);expect(schedulerFollowupSlot(h,j)).toBe(false)
 const a=t.assignments.at(-1)!;h.store.put('run',t.id,{ticketId:t.id,assignmentId:a.id,cwd:'SECRET_PATH',phase:'idle',threadId:'SECRET_SESSION'} satisfies Run)
 expect(schedulerFollowupSlot(h,j)).toBe(true);expect(h.schedulerStatus().interactive).toMatchObject({mode:'existing_session',additionalLimit:1})
 const legacy=fixture(false);expect(schedulerFollowupSlot(legacy,job('followup'))).toBe(true);expect(legacy.schedulerStatus().interactive.mode).toBe('legacy_pool')
})
it('keeps routing followups separate from the additional Worker slot',async()=>{
 const h=fixture(false),perform=heldPerform(h);enqueue(h,'fixture:one');enqueue(h,'fixture:two');await h.tick()
 enqueue(h,'followup:one','followup');enqueue(h,'followup:two','followup');await h.tick()
 // followup uses routing admission and routing counters; it does not consume a Worker extra slot.
 expect(perform).toHaveBeenCalledTimes(4);expect(h.schedulerStatus()).toMatchObject({occupancy:{workerJobs:2,routingJobs:2},interactive:{additionalLimit:1}})
})
it('only returns aggregate whitelisted data and does not mutate persistent state',()=>{
 const h=fixture();enqueue(h,'SECRET_ID','fixture',{prompt:'SECRET_PAYLOAD',actor:'SECRET_ACTOR'});enqueue(h,'SECRET_DELAY','fixture');h.store.db.prepare("UPDATE jobs SET next_at=? WHERE id='SECRET_DELAY'").run(Date.now()+60000)
 enqueue(h,'SECRET_BLOCKED');h.store.jobState('SECRET_BLOCKED','blocked','SECRET_ERROR');enqueue(h,'SECRET_UNCERTAIN');h.store.jobState('SECRET_UNCERTAIN','uncertain','SECRET_ERROR')
 h.store.put('worker-pool','cursor',1);const before=db(h),s=h.schedulerStatus();expect(s.queue).toEqual({ready:1,delayed:1,blocked:1,uncertain:1});expect(JSON.stringify(s)).not.toContain('SECRET');expect(db(h)).toEqual(before);expect(h.store.get('worker-pool','cursor')).toBe(1)
})
it('requires current operator access for the read-only API, rejects mutation, and leaves the database unchanged',async()=>{
 const h=fixture();h.pause(true);const server=await serve(h);servers.push(server);clearInterval((h as any).timer)
 const endpoint=server.url+'/api/scheduler-status',headers={authorization:'Bearer '+readFileSync(server.tokenPath,'utf8').trim()}
 expect((await fetch(endpoint)).status).toBe(401);expect((await fetch(endpoint,{headers:{authorization:'Bearer wrong'}})).status).toBe(401)
 const before=db(h),response=await fetch(endpoint,{headers});expect(response.status).toBe(200);expect(await response.json()).toMatchObject({schema:1,paused:true,occupancy:{jobs:0}});expect(db(h)).toEqual(before)
 expect((await fetch(endpoint,{headers,method:'POST'})).status).toBe(405);expect(db(h)).toEqual(before)
 vi.spyOn(h,'schedulerStatus').mockImplementation(()=>{throw Error('SECRET_INTERNAL_EXCEPTION')})
 const corruptBefore=db(h),unavailable=await fetch(endpoint,{headers});expect(unavailable.status).toBe(503);expect(await unavailable.json()).toEqual({code:'scheduler_status_unavailable'});expect(db(h)).toEqual(corruptBefore)
})

it('observes real model controllers and one reserved continuation of an existing session',async()=>{
 let calls=0
 const model:Model={async run(r){
  if(r.ephemeral){const input=JSON.parse(r.input);return {threadId:'router-fixture',turnId:'router-turn',text:JSON.stringify({action:input.trigger?'ignore':'accept',title:input.triggers?.[0]?.text??'',scope:'Reply',reason:'Explicit request',rules:[],ruleAssessments:[],targetTicketId:null})}}
  calls++;const threadId=r.threadId??'worker-thread-'+calls;r.onThread?.(threadId);r.onTurn?.('turn-'+calls)
  if(calls>1)await new Promise<void>(resolve=>{releases.push(resolve);r.signal?.addEventListener('abort',()=>resolve(),{once:true})})
  return {threadId,turnId:'turn-'+calls,text:JSON.stringify({state:calls===1?'blocked':'ready',summary:'Done',reply:'Result',question:calls===1?'More input?':null,handbacks:[]})}
 }}
 const h=fixture(true,model);h.config.execution.workers=h.config.execution.workers!.slice(0,1);h.config.concurrency=1
 async function until(predicate:()=>boolean){for(let i=0;i<150;i++){await h.tick();await new Promise(r=>setTimeout(r,2));if(predicate())return}throw Error('Fixture did not settle')}
 h.receive('local','operator',{id:'initial',thread:'existing',text:'Start',addressed:true});await until(()=>calls===1&&h.store.list<Run>('run')[0]?.phase==='idle')
 h.receive('local','operator',{id:'new',thread:'new',text:'New work',addressed:true});await until(()=>calls===2)
 expect(h.schedulerStatus()).toMatchObject({occupancy:{workerJobs:1,controllers:1},interactive:{activeReservedExecutions:0}})
 const previous=h.store.list<Run>('run').find(r=>r.threadId==='worker-thread-1')!,ticket=h.store.tickets.get(previous.ticketId)!
 h.store.tickets.save({...ticket,inputs:[...ticket.inputs,{id:'continuation-input',kind:'trigger',triggerId:ticket.origin.triggerId,at:new Date().toISOString(),human:true}],undelivered:[...ticket.undelivered,'continuation-input']})
 enqueue(h,'execute:continuation','execute',{ticketId:ticket.id,assignmentId:previous.assignmentId});await until(()=>calls===3)
 expect(h.schedulerStatus()).toMatchObject({occupancy:{workerJobs:2,controllers:2},interactive:{activeReservedExecutions:1,additionalLimit:1}})
 h.receive('local','operator',{id:'queued',thread:'queued',text:'More new work',addressed:true});for(let i=0;i<8;i++)await h.tick();expect(calls).toBe(3)
 const before=db(h);h.schedulerStatus();expect(db(h)).toEqual(before)
})
