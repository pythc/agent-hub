import {it,expect,afterEach} from 'vitest'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {configSchema} from '../src/config.ts'
import {Runtime} from '../src/runtime.ts'
import type {Model,ModelRequest} from '../src/model.ts'
import type {MessageBatch,ScheduledRun} from '../src/router-proactive.ts'
import {stableDigest} from '../src/sources.ts'
import {readFileSync} from 'node:fs'
import {serve} from '../src/server.ts'
const roots:string[]=[],hosts:Runtime[]=[]
afterEach(async()=>{for(const h of hosts.splice(0))await h.close();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true})})
async function until(h:Runtime,p:()=>boolean){for(let n=0;n<400;n++){await h.tick();await new Promise(r=>setTimeout(r,2));if(p())return}throw Error('Did not settle: '+JSON.stringify({b:h.store.list('router-batch'),runs:h.store.list('router-schedule-run'),jobs:h.store.db.prepare('SELECT id,state,error FROM jobs').all()}))}
function fixture(custom?:(r:ModelRequest,input:any)=>Promise<any>){
 const root=mkdtempSync(join(tmpdir(),'router-proactive-'));roots.push(root)
 let now=Date.parse('2026-11-07T00:00:00Z'),seq=0
 const calls:ModelRequest[]=[]
 const config=configSchema.parse({stateDir:join(root,'state'),acceptMode:'auto',rules:[],work:{sandboxDriver:'disabled'},execution:{router:{mode:'host',model:'terra',effort:'medium'},management:{enabled:true},workers:[{id:'one',backend:'codex',model:'sol',effort:'high'}]},sources:[{id:'local',kind:'local',cwd:root,workspace:{mode:'source'},allowedActors:['alice','bob'],allowedBots:['build-bot'],observed:true}]})
 const model:Model={async run(r){
  calls.push(r);const input=JSON.parse(r.input),threadId=r.threadId??'native-'+calls.length,turnId='turn-'+calls.length;r.onThread?.(threadId);r.onTurn?.(turnId)
  const override=await custom?.(r,input);if(override!==undefined)return {threadId,turnId,text:JSON.stringify(override)}
  if(r.ephemeral){const text=input.triggers.map((t:any)=>t.text).join('\n'),action=text.includes('ambiguous')?'clarify':text.includes('continue')?'attach':text.includes('ignore')?'ignore':'accept';return {threadId,turnId,text:JSON.stringify({action,title:'Work',scope:text,reason:'Matched explicit input or written duty',question:'请选择要继续的任务。',rules:input.rules.map((r:any)=>r.id),ruleAssessments:input.rules.map((r:any)=>({id:r.id,matched:true,reason:'matched'})),targetTicketId:action==='attach'?input.existing[0]?.id??null:null})}}
  if(r.role==='router'){
   if(input.kind!=='worker_result'&&(input.mandate.scope.includes('start')||input.schedule)){
    const result=await r.onTool!('worker_manage',{action:'assign',id:'one',text:input.mandate.scope,requestId:'assign-'+input.trigger.id,revision:0},'assign')
    if(!result.success)throw Error(JSON.stringify(result))
   }
   return {threadId,turnId,text:JSON.stringify({reply:input.kind==='worker_result'?'Router verified result':''})}
  }
  return {threadId,turnId,text:JSON.stringify({state:'ready',summary:'Verified 2',reply:'Worker-only result',question:null,askedBy:null,handbacks:[]})}
 }}
 const h=new Runtime(config,{model,clock:()=>now});hosts.push(h)
 h.scopes.command({action:'scope.put',operationId:'scope',expectedRevision:0,scope:{id:'team',tenantId:'org',name:'Team',managers:[JSON.stringify(['local','alice'])],workerIds:['one'],sourceIds:['local'],backendIds:['codex']}})
 for(const nativeId of ['g1','g2'])h.scopes.command({action:'entry.bind',operationId:nativeId,expectedRevision:0,scopeId:'team',sourceId:'local',accountNamespace:'account',nativeId,history:'group'})
 const command=(action:string,body:any={},expectedRevision=0)=>h.proactive.command({action,scopeId:'team',operationId:'op-'+(++seq),expectedRevision,...body}) as any
 const receive=(text:string,{group='g1',actor='alice',human=true,event='event-'+(++seq),thread=group+'-topic',addressed=true}:{group?:string;actor?:string;human?:boolean;event?:string;thread?:string;addressed?:boolean}={})=>h.receive('local',actor,{id:event,thread,scope:group,text,addressed},human) as any
 const context=(result:any)=>{const t=h.store.triggers.get(result.triggerId)!;return h.scopes.context(t,'local:'+t.threads[0]!.id)!}
 const enable=(extra={})=>command('settings.put',{settings:{enabled:true,debounceMs:100,maxWaitMs:500,cooldownMs:0,...extra}},h.proactive.controls('team').revision)
 const duty=(mode='auto',group='g1',revision=0)=>command('duty.put',{duty:{id:'build',name:'Build',entryIds:[h.scopes.bindings().find(e=>e.nativeId===group)!.id],instruction:'Investigate build failures',mode}},revision)
 const plan=(triggerId:string,extra:any={})=>command('schedule.put',{schedule:{id:'daily',name:'Daily check',triggerId,prompt:'start inspect scheduled work',mode:'standalone',notification:'always',timing:{kind:'once',startAt:new Date(now+1000).toISOString(),timezone:'Asia/Shanghai'},...extra}})
 return {h,config,model,calls,command,receive,context,enable,duty,plan,advance:(ms:number)=>{now+=ms},now:()=>now}
}
const batches=(h:Runtime)=>h.store.list<MessageBatch>('router-batch')
const runs=(h:Runtime)=>h.store.list<ScheduledRun>('router-schedule-run')

it('batches rapid messages once and only Router delivers Worker results',async()=>{
 const f=fixture();f.enable();f.receive('start calculate 1+1',{event:'one'});f.advance(50);f.receive('Also verify the arithmetic',{event:'two'});expect(batches(f.h)).toHaveLength(1)
 await f.h.tick();expect(f.calls).toHaveLength(0);f.advance(101)
 await until(f.h,()=>f.h.store.deliveries().some(d=>d.text==='Router verified result'&&d.status==='sent'))
 expect(f.calls.filter(r=>r.ephemeral)).toHaveLength(1);expect(f.h.store.tickets.list()).toHaveLength(1)
 const router=f.calls.find(r=>r.role==='router'&&!r.ephemeral)!;expect(JSON.parse(router.input).messages.map((t:any)=>t.text)).toEqual(['start calculate 1+1','Also verify the arithmetic'])
 expect(f.calls.filter(r=>r.role==='router').every(r=>r.options?.effort==='medium')).toBe(true);expect(f.calls.find(r=>r.role==='worker')?.options?.effort).toBe('high')
 expect(f.h.store.deliveries().filter(d=>!d.channel.address.routerInbox).map(d=>d.text)).toEqual(['Router verified result'])
 expect(f.receive('start calculate 1+1',{event:'one'}).disposition).toBe('duplicate');expect(batches(f.h)).toHaveLength(1)
})
it('partitions members, groups, topics and policy versions, bounding continuous input wait',()=>{
 const f=fixture();f.enable();f.receive('ignore');f.receive('ignore',{actor:'bob'});f.receive('ignore',{group:'g2'});f.receive('ignore',{thread:'other'});expect(batches(f.h)).toHaveLength(4)
 for(let i=0;i<5;i++){f.advance(90);f.receive('ignore')}
 expect(batches(f.h)[0]!.dueAt).toBe(batches(f.h)[0]!.firstAt+500)
 f.advance(60);f.receive('ignore');expect(batches(f.h)).toHaveLength(5)
 f.duty();f.receive('ignore');expect(batches(f.h)).toHaveLength(6)
})
it.each(['observe','auto'] as const)('honors scoped duty %s without promoting subscriptions into authority',async mode=>{
 const f=fixture();f.enable();f.duty(mode)
 f.receive('start build investigation',{actor:'build-bot',human:false});f.receive('start build investigation',{group:'g2',actor:'build-bot',human:false})
 f.advance(101);await until(f.h,()=>batches(f.h)[0]?.state==='decided')
 if(mode==='auto')await until(f.h,()=>f.h.store.tickets.list().some(t=>t.ended))
 expect(f.h.store.tickets.list()).toHaveLength(mode==='auto'?1:0);expect(batches(f.h)).toHaveLength(1)
 expect(f.h.store.list<any>('router-admission').find(a=>a.discussion==='local:g2-topic').state).toBe('ignored')
})
it('rejects duty/schedule management by ordinary members and inferred inputs',()=>{
 const f=fixture(),human=f.receive('request',{actor:'bob'})
 expect(()=>f.h.proactive.command({action:'settings.put',scopeId:'team',operationId:'bad',expectedRevision:0,settings:{enabled:true}},f.context(human))).toThrow('scope manager')
 expect(()=>f.plan(human.triggerId)).toThrow('scope manager')
 f.duty();const bot=f.receive('build failure',{actor:'build-bot',human:false})
 expect(()=>f.plan(bot.triggerId)).toThrow('human authorization')
})
it('invalidates an in-flight decision after rule changes and freezes inputs during evaluation',async()=>{
 let release!:()=>void;const f=fixture(async r=>{if(r.ephemeral)await new Promise<void>(r=>release=r)})
 f.enable();f.duty();f.receive('start build',{actor:'build-bot',human:false});f.advance(101)
 await until(f.h,()=>!!release);f.receive('start another build',{actor:'build-bot',human:false});expect(batches(f.h)).toHaveLength(2)
 f.duty('observe','g1',1);release();await until(f.h,()=>batches(f.h)[0]!.state==='failed');expect(f.h.store.tickets.list()).toHaveLength(0)
})
it('continues the same task and native thread, asks for ambiguity and never resumes human-stopped work',async()=>{
 let hold=false;const f=fixture(async r=>{if(r.role==='worker'&&hold)return {state:'waiting',summary:'Waiting',reply:'Waiting for clarification',question:null,askedBy:null,handbacks:[]}});f.enable();f.receive('start work');f.advance(101)
 await until(f.h,()=>f.h.store.deliveries().some(d=>d.text==='Router verified result'&&d.status==='sent'))
 const ticket=f.h.store.tickets.list()[0]!,thread=f.h.store.get<any>('run',ticket.id).threadId
 hold=true;f.receive('continue '+ticket.id);f.advance(101)
 await until(f.h,()=>f.calls.filter(r=>r.role==='worker').length===2&&f.h.store.tickets.get(ticket.id)?.assignments.at(-1)?.report?.state==='waiting')
 expect(f.h.store.tickets.list()).toHaveLength(1);expect(f.h.store.get<any>('run',ticket.id).threadId).toBe(thread)
 await until(f.h,()=>f.h.store.deliveries().filter(d=>!d.channel.address.routerInbox).every(d=>d.status==='sent'))
 f.receive('ambiguous continuation');f.advance(101);await until(f.h,()=>batches(f.h).at(-1)?.state==='decided')
 expect(f.h.store.deliveries().some(d=>d.text==='请选择要继续的任务。')).toBe(true);expect(f.h.store.tickets.list()).toHaveLength(1)
 f.h.engine.stopTicket(ticket.id,'Human stop');f.receive('continue '+ticket.id);f.advance(101);await until(f.h,()=>batches(f.h).at(-1)?.state==='failed')
 expect(f.calls.filter(r=>r.role==='worker')).toHaveLength(2)
})
it('schedules a real durable source event without impersonating a human and distinguishes delivery',async()=>{
 const f=fixture(),anchor=f.receive('Authorize daily check');await until(f.h,()=>f.calls.length===1)
 f.plan(anchor.triggerId);f.advance(1001)
 await until(f.h,()=>runs(f.h)[0]?.state==='completed'&&runs(f.h)[0]?.delivery==='sent')
 const run=runs(f.h)[0]!,trigger=f.h.store.triggers.get(run.triggerId!)!
 expect(trigger.human).toBe(false);expect(trigger.meta.origin).toBe('scheduler');expect(f.h.store.list<any>('source-native-proof').some(p=>p.triggerId===trigger.id)).toBe(false)
 expect(run.taskIds).toHaveLength(1);expect(f.h.store.tickets.list()).toHaveLength(1)
 for(let i=0;i<4;i++)await f.h.tick();expect(runs(f.h)).toHaveLength(1)
 expect(f.h.store.deliveries().filter(d=>!d.channel.address.routerInbox).every(d=>d.text==='Router verified result')).toBe(true)
})
it('coalesces downtime, skips overlaps, pauses future runs separately and fences queued dispatch',async()=>{
 let release!:()=>void;const f=fixture(async(r,input)=>{if(input.schedule)await new Promise<void>(r=>release=r)})
 const anchor=f.receive('Authorize checks');await until(f.h,()=>f.calls.length===1)
 const p=f.plan(anchor.triggerId,{timing:{kind:'interval',startAt:new Date(f.now()+1000).toISOString(),intervalSeconds:60}})
 f.advance(181001);await until(f.h,()=>!!release);expect(runs(f.h)).toHaveLength(1);expect(runs(f.h)[0]!.scheduledAt).toBe(Date.parse(p.timing.startAt)+180000)
 f.advance(60000);await f.h.tick();expect(runs(f.h)[1]?.reason).toBe('Previous run is still active')
 f.command('schedule.pause',{id:p.id},p.revision);release()
 await until(f.h,()=>runs(f.h)[0]?.state==='completed');expect(runs(f.h)[0]?.state).toBe('completed')
 f.advance(120000);await f.h.tick();expect(runs(f.h)).toHaveLength(2)
 const paused=f.h.proactive.snapshot('team').schedules[0]!;f.command('schedule.resume',{id:p.id},paused.revision);f.advance(60000);f.h.proactive.tick()
 const current=f.h.proactive.snapshot('team').schedules[0]!;f.command('schedule.pause',{id:p.id},current.revision)
 await until(f.h,()=>runs(f.h).at(-1)?.state==='failed');expect(f.calls.filter(r=>JSON.parse(r.input).schedule)).toHaveLength(1)
})
it('does not let a forged scheduled marker bypass bot policy',()=>{
 const f=fixture(),t=f.h.sources.get('local')!.trigger({id:'fake',scope:'g1',thread:'g1-topic',text:'start work',addressed:true},'build-bot',false)
 t.meta.scheduledRun='forged';f.h.ingest(t);expect(f.h.routerIngress.get(t.id)?.state).toBe('ignored');expect(()=>f.h.routerIngress.authority(t.id)).toThrow()
})
it('revokes a queued schedule when its source authority or entry ownership is removed',async()=>{
 const f=fixture(),anchor=f.receive('Authorize check');await until(f.h,()=>f.calls.length===1);f.plan(anchor.triggerId)
 f.h.config.sources[0]!.allowedActors=['bob'];f.advance(1001);await f.h.tick()
 expect(runs(f.h)[0]?.state).toBe('skipped');expect(f.h.store.tickets.list()).toHaveLength(0)
})
it('recovers a queued occurrence once after restart, retains its identity and suppresses silent delivery',async()=>{
 const f=fixture(),anchor=f.receive('Authorize silent check');await until(f.h,()=>f.calls.length===1);f.plan(anchor.triggerId,{notification:'silent'});f.advance(1001);f.h.proactive.tick();const id=runs(f.h)[0]!.id
 await f.h.close();hosts.splice(hosts.indexOf(f.h),1)
 const h=new Runtime(configSchema.parse(f.config),{model:f.model,clock:f.now});hosts.push(h)
 await until(h,()=>runs(h)[0]?.state==='completed');expect(runs(h)).toHaveLength(1);expect(runs(h)[0]!.id).toBe(id);expect(runs(h)[0]!.delivery).toBe('none');expect(h.store.deliveries().filter(d=>!d.channel.address.routerInbox)).toHaveLength(0)
})
it('skips scheduled follow-up of completed work and keeps history deletion from reviving schedules',async()=>{
 const f=fixture(),anchor=f.receive('start work');await until(f.h,()=>f.h.store.deliveries().some(d=>d.text==='Router verified result'&&d.status==='sent'))
 const ticket=f.h.store.tickets.list()[0]!
 f.plan(anchor.triggerId,{mode:'continue',ticketId:ticket.id});f.advance(1001);await f.h.tick();expect(runs(f.h)[0]?.state).toBe('skipped');expect(f.h.store.tickets.list()).toHaveLength(1)
 f.duty();const c=f.context(anchor);f.h.memory.ingest(c);f.h.memory.command(c,{action:'history.delete',operationId:'delete-proactive',expectedRevision:0})
 expect(f.h.store.get<any>('router-schedule',stableDigest(['team','daily'])).prompt).toBe('');expect(f.h.store.list<any>('router-duty')[0].instruction).toBe('Investigate build failures')
 f.advance(600000);await f.h.tick();expect(f.h.store.tickets.list()).toHaveLength(1)
})

it.each(['off','observe'] as const)('retains the global %s ceiling over an auto duty',async mode=>{
 const f=fixture();f.enable();f.duty();f.h.config.acceptMode=mode
 f.receive('start build',{actor:'build-bot',human:false});f.advance(101)
 if(mode==='observe')await until(f.h,()=>batches(f.h)[0]?.state==='decided');else await f.h.tick()
 expect(f.h.store.tickets.list()).toHaveLength(0);expect(f.calls.filter(r=>!r.ephemeral)).toHaveLength(0)
})
it('enforces inferred cooldown on queued batches without delaying explicit requests',async()=>{
 const f=fixture();f.enable({cooldownMs:1000});f.duty();f.receive('build failed',{actor:'build-bot',human:false});f.advance(101)
 await until(f.h,()=>batches(f.h)[0]?.state==='decided')
 f.receive('build failed again',{actor:'build-bot',human:false});f.receive('ignore human request');f.advance(101)
 await until(f.h,()=>batches(f.h).find(b=>b.strength==='explicit')?.state==='decided')
 expect(batches(f.h).filter(b=>b.state==='pending')).toHaveLength(1);expect(f.calls.filter(r=>r.ephemeral)).toHaveLength(2)
 f.advance(1000);await until(f.h,()=>batches(f.h).every(b=>b.state==='decided'));expect(f.calls.filter(r=>r.ephemeral)).toHaveLength(3)
})
it('cancels a running occurrence, fences late output and preserves the recurring schedule',async()=>{
 let release!:()=>void;const f=fixture(async(r,input)=>{if(input.schedule){await new Promise<void>(r=>release=r);return {reply:'Do not publish cancelled output'}}})
 const anchor=f.receive('Authorize periodic check');await until(f.h,()=>f.calls.length===1)
 const p=f.plan(anchor.triggerId,{timing:{kind:'interval',intervalSeconds:60,startAt:new Date(f.now()+1000).toISOString()}})
 f.advance(1001);await until(f.h,()=>!!release)
 const r=runs(f.h)[0]!;f.command('run.cancel',{id:r.id},r.revision);release()
 await until(f.h,()=>f.h.store.list('router-error').length>0)
 expect(runs(f.h)[0]?.state).toBe('cancelled');expect(f.h.proactive.snapshot('team').schedules[0]?.active).toBe(true)
 expect(f.h.store.deliveries().some(d=>d.text.includes('cancelled output'))).toBe(false);expect(f.h.proactive.snapshot('team').schedules[0]?.id).toBe(p.id)
})
it('follows an open task through the scheduler without changing its ID, backend or native thread',async()=>{
 let workerCalls=0;const f=fixture(async r=>{if(r.role==='worker'&&++workerCalls===1)return {state:'waiting',summary:'Awaiting follow-up',reply:'Need follow-up',question:null,askedBy:null,handbacks:[]}})
 const anchor=f.receive('start original work');await until(f.h,()=>f.h.store.tickets.list()[0]?.assignments.at(-1)?.report?.state==='waiting')
 const ticket=f.h.store.tickets.list()[0]!,before=f.h.store.get<any>('run',ticket.id)
 f.plan(anchor.triggerId,{mode:'continue',ticketId:ticket.id,prompt:'Continue the original investigation with current evidence'});f.advance(1001)
 await until(f.h,()=>runs(f.h)[0]?.state==='completed'&&runs(f.h)[0]?.delivery==='sent')
 expect(f.h.store.tickets.list()).toHaveLength(1);expect(runs(f.h)[0]?.taskIds).toEqual([ticket.id]);expect(f.h.store.get<any>('run',ticket.id).threadId).toBe(before.threadId);expect(f.h.store.get<any>('run',ticket.id).backendId??'codex').toBe(before.backendId??'codex');expect(workerCalls).toBe(2)
})
it('binds legacy admission attach to the original task instead of invoking a free Router delegation',async()=>{
 let calls=0;const f=fixture(async(r,input)=>{
  if(r.role==='worker'&&++calls===1)return {state:'waiting',summary:'Waiting',reply:'Waiting',question:null,askedBy:null,handbacks:[]}
  if(r.ephemeral)return {action:input.existing.length?'attach':'accept',title:'Continue',scope:'start or continue the build investigation',reason:'Same discussion follow-up',rules:input.rules.map((r:any)=>r.id),ruleAssessments:input.rules.map((r:any)=>({id:r.id,matched:true,reason:'Build failure'})),targetTicketId:input.existing[0]?.id??null}
 })
 f.duty();f.receive('start build',{actor:'build-bot',human:false});await until(f.h,()=>f.h.store.tickets.list()[0]?.assignments.at(-1)?.report?.state==='waiting')
 const original=f.h.store.tickets.list()[0]!,routers=f.calls.filter(r=>r.role==='router'&&!r.ephemeral).length
 f.receive('continue build',{actor:'build-bot',human:false});await until(f.h,()=>calls===2&&!!f.h.store.tickets.get(original.id)?.ended)
 expect(f.h.store.tickets.list()).toHaveLength(1);expect(f.calls.filter(r=>r.role==='router'&&!r.ephemeral).length).toBeLessThanOrEqual(routers+1)
})
it('keeps all batch inputs authoritative after delegation, including a later withdrawal of the first message',async()=>{
 const f=fixture();f.enable();const first=f.receive('start calculation');f.receive('verify it');f.advance(101)
 await until(f.h,()=>f.h.store.tickets.list().length===1)
 f.h.store.put('source-invalid-trigger',first.triggerId,{reason:'recalled'})
 await until(f.h,()=>f.h.store.tickets.list()[0]?.assignments.at(-1)?.report?.state==='blocked')
 expect(f.calls.filter(r=>r.role==='worker')).toHaveLength(0);expect(f.h.store.deliveries().filter(d=>!d.channel.address.routerInbox)).toHaveLength(0)
})
it('blocks overlapping work after a failed Router turn and still permits stopping its surviving task',async()=>{
 const f=fixture(async(r,input)=>{
  if(input.schedule){const result=await r.onTool!('worker_manage',{action:'assign',id:'one',revision:0,requestId:'partial-schedule',text:'start waiting task'},'assign');expect(result.success).toBe(true);throw Error('Router failed after delegation')}
  if(r.role==='worker')return {state:'waiting',summary:'Waiting',reply:'',question:null,askedBy:null,handbacks:[]}
 })
 const anchor=f.receive('Authorize check');await until(f.h,()=>f.calls.length===1)
 f.plan(anchor.triggerId,{timing:{kind:'interval',intervalSeconds:60,startAt:new Date(f.now()+1000).toISOString()}});f.advance(1001)
 await until(f.h,()=>runs(f.h)[0]?.state==='failed'&&f.h.store.tickets.list().length===1)
 f.advance(60000);await f.h.tick();expect(runs(f.h)[1]?.state).toBe('skipped');expect(f.h.store.tickets.list()).toHaveLength(1)
 const r=runs(f.h)[0]!;f.h.store.put('router-schedule-run',r.id,{...r,taskIds:[]}) // Simulate crash between task commit and secondary tracking.
 f.command('run.cancel',{id:r.id},r.revision)
 expect(runs(f.h)[0]?.taskIds).toHaveLength(1);expect(f.h.store.tickets.list()[0]?.ended?.by).toBe('human')
})
it('does not let scheduled inference manufacture more schedules or reconfigure Workers',async()=>{
 const denied:boolean[]=[];const f=fixture(async(r,input)=>{if(input.schedule){for(const [name,args] of [['router_manage',{action:'list',scopeId:'team'}],['worker_manage',{action:'configure',id:'one',revision:0,requestId:'forbidden',patch:{model:'other'}}]] as const){const response=await r.onTool!(name,args,'denied');denied.push(!response.success)}return {reply:'Scheduled read-only result'}}})
 const anchor=f.receive('Authorize check');await until(f.h,()=>f.calls.length===1);f.plan(anchor.triggerId);f.advance(1001)
 await until(f.h,()=>runs(f.h)[0]?.state==='completed');expect(denied).toEqual([true,true]);expect(f.h.settings.current().revision).toBe(0);expect(f.h.store.list('router-schedule')).toHaveLength(1)
})
it('exposes operator APIs with authentication and keeps model views within the current entry',async()=>{
 const f=fixture(),one=f.receive('request'),two=f.receive('request',{group:'g2'});f.duty('observe','g1');f.plan(one.triggerId)
 expect((f.h.proactive.command({action:'list',scopeId:'team'},f.context(two)) as any).schedules).toHaveLength(0)
 f.h.config.port=0;const server=await serve(f.h),headers={authorization:'Bearer '+readFileSync(server.tokenPath,'utf8').trim(),'content-type':'application/json'}
 try{
  expect((await fetch(server.url+'/router-proactive/state?scopeId=team')).status).toBe(401)
  expect((await fetch(server.url+'/router-proactive',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'list',scopeId:'team'})})).status).toBe(401)
  const response=await fetch(server.url+'/router-proactive',{method:'POST',headers,body:JSON.stringify({action:'list',scopeId:'team'})})
  expect(response.ok).toBe(true);expect((await response.json() as any).schedules).toHaveLength(1)
  const html=await (await fetch(server.url+'/router-proactive')).text();expect(html).toContain('职责与定时任务');expect(html).not.toContain(one.triggerId)
 }finally{await new Promise<void>(resolve=>server.server.close(()=>resolve()))}
})
it('rejects an oversized batch within the full scoped context budget before inference or delegation',async()=>{
 const f=fixture(),scope=f.h.scopes.scope('team'),{routerId,revision,epoch,...input}=scope
 f.h.scopes.command({action:'scope.put',operationId:'small-budget',expectedRevision:revision,scope:{...input,contextBytes:4096}})
 f.enable();f.receive('start '+('x'.repeat(12000)));f.advance(101)
 await until(f.h,()=>batches(f.h)[0]?.state==='failed')
 expect(f.calls).toHaveLength(0);expect(f.h.store.tickets.list()).toHaveLength(0);expect(batches(f.h)[0]?.reason).toMatch(/budget|context/i)
})
it('does not carry the former Router duties across a task ownership transfer',async()=>{
 const f=fixture(),entry=f.h.scopes.bindings().find(e=>e.nativeId==='g1')!
 f.h.scopes.command({action:'scope.put',operationId:'other-owner',expectedRevision:0,scope:{id:'other',tenantId:'org',name:'Other',managers:[JSON.stringify(['local','alice'])],workerIds:['one'],sourceIds:['local'],backendIds:['codex'],dataEntryIds:[entry.id]}})
 f.duty();f.receive('start original work');await until(f.h,()=>f.h.store.deliveries().some(d=>d.text==='Router verified result'&&d.status==='sent'))
 const ticket=f.h.store.tickets.list()[0]!
 f.h.scopes.command({action:'task.transfer',operationId:'move',expectedRevision:1,ticketId:ticket.id,scopeId:'other'})
 const next=f.receive('continue build',{actor:'build-bot',human:false})
 expect(f.h.proactive.rules(f.h.store.triggers.get(next.triggerId))).toEqual([]);expect(f.h.routerIngress.get(next.triggerId)?.state).toBe('ignored')
})
it('invalidates a decision when any task read during evaluation changes, including multi-task discussions',async()=>{
 let release:undefined|(()=>void),hold=false
 const f=fixture(async r=>{if(r.ephemeral&&hold)await new Promise<void>(resolve=>release=resolve)})
 f.receive('start first');await until(f.h,()=>f.h.store.tickets.list().length===1&&!!f.h.store.tickets.list()[0]?.ended)
 await until(f.h,()=>f.h.store.deliveries().filter(d=>!d.channel.address.routerInbox).some(d=>d.status==='sent'))
 f.receive('start second');await until(f.h,()=>f.h.store.tickets.list().length===2&&f.h.store.tickets.list().every(t=>t.ended))
 f.enable();hold=true;const request=f.receive('ambiguous task followup');f.advance(101);await until(f.h,()=>!!release)
 const c=f.context(request);expect(c.route.taskId).toBeUndefined()
 f.h.scopes.noteInput(f.h.store.tickets.list()[1]!.id,c);release!()
 await until(f.h,()=>batches(f.h)[0]?.state==='failed');expect(batches(f.h)[0]?.reason).toMatch(/input changed/i)
 expect(f.h.store.deliveries().some(d=>d.text==='请选择要继续的任务。')).toBe(false)
})
it('preserves arbitrary existing global rule IDs instead of reserving a new prefix',async()=>{
 const f=fixture();f.h.config.rules=[{id:'duty:legacy',instruction:'Investigate build failures'}];f.enable()
 f.receive('start build check',{actor:'build-bot',human:false});f.advance(101)
 await until(f.h,()=>f.h.store.tickets.list().some(t=>t.ended));expect(f.h.store.tickets.list()).toHaveLength(1)
})
