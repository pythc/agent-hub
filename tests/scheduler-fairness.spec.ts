import {taskQueueSummary} from '../src/scheduler-status.ts'
import {afterEach,it,expect} from 'vitest'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
import type {Model,ModelRequest} from '../src/model.ts'
import {orderSchedulerJobs,observeSchedulerJob,recordSchedulerAdmission} from '../src/scheduler-order.ts'
import type {Job} from '../src/store.ts'
const hosts:Runtime[]=[],roots:string[]=[]
afterEach(async()=>{for(const h of hosts.splice(0))await h.close();for(const r of roots.splice(0))rmSync(r,{recursive:true,force:true})})
function fixture(run:Model['run']){
 const root=mkdtempSync(join(tmpdir(),'scheduler-fairness-'));roots.push(root)
 const host=new Runtime(configSchema.parse({stateDir:join(root,'state'),concurrency:1,scheduler:{interactiveBurst:2},work:{sandboxDriver:'disabled',autoRecover:false},sources:[{id:'local',kind:'local',cwd:root,workspace:{mode:'source'},allowedActors:['alice']}]}),{model:{run}});hosts.push(host)
 let sequence=0
 function task(interactive:boolean){
  const id='input-'+(++sequence),received=host.receive('local','alice',{id,thread:id,text:'Bounded work',addressed:true}) as {triggerId:string}
  const decision=host.engine.decide(received.triggerId,{kind:'accept',title:id,scope:'Bounded work',reason:'Explicit fixture task',rules:[]}),ticket=host.store.tickets.get(decision.ticketId!)!,assignment=ticket.assignments.at(-1)!
  host.engine.assignmentStarted(ticket.id,assignment.id)
  // Legacy task fixture: low-priority material is machine input, not a fabricated human continuation.
  if(interactive){const fresh=host.store.tickets.get(ticket.id)!,inputId='human-'+id;host.store.tickets.save({...fresh,inputs:[...fresh.inputs,{id:inputId,kind:'trigger',triggerId:received.triggerId,human:true,at:new Date().toISOString()}],undelivered:[...fresh.undelivered,inputId]})}
  for(const j of host.store.jobs())if((j.payload as any)?.ticketId===ticket.id)host.store.jobState(j.id,'done')
  host.store.enqueue('execute:'+assignment.id+':fixture','execute',{ticketId:ticket.id,assignmentId:assignment.id})
  return ticket.id
 }
 return {host,task}
}
const completed=(r:ModelRequest)=>({threadId:r.threadId??'native-'+r.activity?.ticketId,turnId:'turn-'+r.activity?.ticketId,text:JSON.stringify({state:'ready',summary:'Done',reply:'Done',question:null,askedBy:null,handbacks:[]})})
async function until(h:Runtime,ready:()=>boolean){for(let i=0;i<300;i++){await h.tick();await new Promise(r=>setTimeout(r,3));if(ready())return}throw Error('Scheduler did not make progress')}
it('starts ordinary work within the declared interactive burst while fresh high-priority work keeps arriving',async()=>{
 const starts:string[]=[];let low='',high=0
 const f=fixture(async r=>{if(r.role==='worker'){starts.push(r.activity!.ticketId!);if(r.activity!.ticketId!==low&&high++<15)f.task(true)}return completed(r)})
 for(let i=0;i<6;i++)f.task(true);low=f.task(false)
 await until(f.host,()=>starts.includes(low))
 expect(starts.indexOf(low)).toBeLessThanOrEqual(f.host.config.scheduler.interactiveBurst)
 expect(high).toBeGreaterThan(0)
 expect(f.host.store.jobs().some(j=>j.kind==='execute')).toBe(true)
})
it('keeps state and cancel/cleanup responsive while worker and workspace capacity are occupied and scheduling is paused',async()=>{
 let active:string|undefined
 const f=fixture(async r=>{active=r.activity?.ticketId;await new Promise<void>(resolve=>r.signal!.addEventListener('abort',()=>resolve(),{once:true}));return completed(r)})
 f.host.config.scheduler.workspaceConcurrency=1
 const first=f.task(false);await until(f.host,()=>active===first)
 f.task(false);await f.host.tick();expect(f.host.schedulerStatus().queue.ready).toBeGreaterThan(0)
 const t=f.host.store.tickets.get(first)!,assignment=t.assignments.at(-1)!
 f.host.pause(true);f.host.store.enqueue('cancel:fixture','cancel',{ticketId:first,assignmentId:assignment.id})
 f.host.store.enqueue('cleanup:fixture','cleanup',{ticketId:first,assignmentId:assignment.id})
 const start=performance.now();const status=f.host.schedulerStatus();expect(performance.now()-start).toBeLessThan(500)
 expect(status.paused).toBe(true)
 await f.host.tick()
 expect(f.host.store.db.prepare("SELECT state FROM jobs WHERE id='cancel:fixture'").get()!.state).toBe('done')
 expect(f.host.store.db.prepare("SELECT state FROM jobs WHERE id='cleanup:fixture'").get()!.state).toBe('done')
 await until(f.host,()=>!f.host.executionActive(first))
})
it('records real enqueue/start times once, leaves legacy origin unknown, and previews order without writes',()=>{
 const f=fixture(async r=>completed(r)),h=f.host
 h.store.enqueue('normal','fixture',{})
 const row=h.store.get<any>('scheduler-job','normal')!,j:Job={id:'normal',kind:'fixture',payload:{},state:'pending',attempts:0,nextAt:0}
 const before=JSON.stringify(h.store.list('scheduler-job'))
 orderSchedulerJobs(h.store,[j],2,{routing:0,worker:2});expect(JSON.stringify(h.store.list('scheduler-job'))).toBe(before)
 observeSchedulerJob(h.store,j,'paused',row.enqueuedAt+1);expect(h.store.get<any>('scheduler-job',j.id).eligibleAt).toBeUndefined()
 recordSchedulerAdmission(h.store,j,2,row.enqueuedAt+10);recordSchedulerAdmission(h.store,j,2,row.enqueuedAt+50)
 expect(h.store.get<any>('scheduler-job',j.id)).toMatchObject({enqueuedAt:row.enqueuedAt,eligibleAt:row.enqueuedAt+10,startedAt:row.enqueuedAt+10})
 const legacy={...j,id:'legacy'};recordSchedulerAdmission(h.store,legacy,2,Date.now())
 expect(h.store.get<any>('scheduler-job','legacy').enqueuedAt).toBeNull()
})
it('enforces backend and canonical workspace limits at real model admission, then resumes only when both limits permit',async()=>{
 const started:string[]=[],stopped:string[]=[]
 const f=fixture(async r=>{const id=r.activity!.ticketId!;started.push(id);await new Promise<void>(resolve=>r.signal!.addEventListener('abort',()=>{stopped.push(id);resolve()},{once:true}));return completed(r)})
 const h=f.host;h.config.concurrency=2;h.config.scheduler.backendConcurrency={codex:1};h.config.scheduler.workspaceConcurrency=1
 const first=f.task(false),second=f.task(false)
 await until(h,()=>started.length===1)
 for(let i=0;i<5;i++)await h.tick()
 expect(started).toEqual([first]);expect(h.schedulerStatus().admission!.reasons).toContainEqual({code:'resource_quota',count:1})
 const waiting=taskQueueSummary(h,second)!;expect(waiting.reason).toBe('resource_quota');expect(waiting.waitMs).toBeGreaterThanOrEqual(0);expect(waiting.resources.filter(r=>r.blocker).map(r=>r.kind).sort()).toEqual(['backend','workspace']);expect(waiting.resources.every(r=>/^resource-[a-f0-9]{12}$/.test(r.ref))).toBe(true);expect(JSON.stringify(waiting)).not.toContain(h.config.stateDir)
 const snapshot=JSON.stringify(h.store.db.prepare('SELECT kind,id,body FROM records ORDER BY kind,id').all());h.schedulerStatus();expect(JSON.stringify(h.store.db.prepare('SELECT kind,id,body FROM records ORDER BY kind,id').all())).toBe(snapshot)
 h.updateSettings(0,{scheduler:{...h.config.scheduler,backendConcurrency:{codex:2}}});await h.tick();expect(started).toEqual([first])
 h.updateSettings(1,{scheduler:{...h.config.scheduler,workspaceConcurrency:2}});await until(h,()=>started.includes(second))
 h.updateSettings(2,{scheduler:{...h.config.scheduler,backendConcurrency:{codex:1},workspaceConcurrency:1}})
 const third=f.task(false);await h.tick();expect(started).toHaveLength(2);expect(stopped).toEqual([])
 await h.stop(first);await h.stop(second);await until(h,()=>started.includes(third))
 expect(started).toEqual([first,second,third])
})
it('does not let fairness dispatch a queued task after authority is withdrawn',async()=>{
 let called=false
 const f=fixture(async r=>{called=true;return completed(r)}),id=f.task(false)
 f.host.store.put('scheduler-fairness','current',{routing:2,worker:2})
 f.host.config.sources[0]!.allowedActors=[]
 for(let i=0;i<4;i++)await f.host.tick()
 expect(called).toBe(false)
 expect(f.host.store.tickets.get(id)?.assignments.at(-1)?.report?.state).not.toBe('ready')
})

it('does not spend the ordinary fairness opportunity on an earlier blocked ordinary task',async()=>{
 const starts:string[]=[],f=fixture(async r=>{starts.push(r.activity!.ticketId!);return completed(r)})
 const blocked=f.task(false),low=f.task(false),task=f.host.store.tickets.get(blocked)!
 f.host.store.put('run',blocked,{ticketId:blocked,assignmentId:task.assignments.at(-1)!.id,phase:'human',cwd:f.host.config.sources[0]!.cwd})
 for(let i=0;i<6;i++)f.task(true)
 f.host.store.put('scheduler-fairness','current',{routing:2,worker:2})
 await until(f.host,()=>starts.includes(low));expect(starts[0]).toBe(low);expect(starts).not.toContain(blocked)
})
it('checks the actual subagent backend before provider activation rather than counting an over-limit child afterwards',async()=>{
 const calls:{ticket:string;role:string;backend:string|undefined}[]=[];let occupied='',parent=''
 const f=fixture(async r=>{
  const id=r.activity!.ticketId!;calls.push({ticket:id,role:r.role!,backend:r.backendId});r.onBackend?.(r.backendId!)
  if(id===occupied){await new Promise<void>(resolve=>r.signal!.addEventListener('abort',()=>resolve(),{once:true}));return completed(r)}
  if(r.role==='worker'&&id===parent){await r.onTool!('superagent_spawn',{prompt:'Use the separately configured backend',requestId:'child'},'spawn');return {...completed(r),text:JSON.stringify({state:'waiting',summary:'Waiting on child',reply:'',question:null,askedBy:null,handbacks:[]})}}
  return completed(r)
 })
 const h=f.host;h.config.concurrency=2;h.config.backends=configSchema.parse({...h.config,backends:{...h.config.backends,other:{kind:'codex'}}}).backends
 h.config.execution.roles.worker='other';h.config.execution.roles.subagent='other';h.config.scheduler.backendConcurrency={other:1}
 occupied=f.task(false);await until(h,()=>calls.some(c=>c.ticket===occupied))
 h.config.execution.roles.worker='codex';parent=f.task(false)
 await until(h,()=>h.work.list(parent).some(w=>w.state==='failed'))
 expect(calls.some(c=>c.role==='subagent')).toBe(false)
 expect(h.work.list(parent)[0]!.error).toContain('backend:limit_reached')
})
