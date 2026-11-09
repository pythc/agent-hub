import {it,expect,afterEach} from 'vitest'
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {Runtime} from '../src/runtime.ts'
import {Store} from '../src/store.ts'
import {configSchema} from '../src/config.ts'
import {backendsSchema} from '../src/backend-config.ts'
import {apiOptions} from '../src/agent-options.ts'
import {WatchdogMonitor} from '../src/watchdog-monitor.ts'
import type {WatchdogSnapshot,WatchdogTarget,WatchdogRecovery,WatchdogDirective} from '../src/watchdog-contract.ts'
import type {Model,ModelRequest} from '../src/model.ts'
import type {RouterGoal} from '../src/router-goals.ts'

const roots:string[]=[],hosts:Runtime[]=[],stores:Store[]=[]
afterEach(async()=>{for(const h of hosts.splice(0))await h.close();for(const s of stores.splice(0))s.close();for(const p of roots.splice(0))rmSync(p,{recursive:true,force:true})})
const judgment={verdict:'stalled' as const,reason:'Repeated inspections without correcting the failed result or advancing the dependency.',evidenceIds:['artifacts','calls']}
async function readAll(r:ModelRequest,input:any){for(const e of input.evidence){let offset:number|null=0;do{const result:any=await r.onTool!('goal_evidence',{id:e.id,offset},e.id+':'+offset);offset=JSON.parse(result.contentItems[0].text).nextOffset}while(offset!==null)}}
function fixture(options:{hangFirst?:boolean}={}){
 const root=mkdtempSync(join(tmpdir(),'watchdog-'));roots.push(root)
 const config=configSchema.parse({stateDir:join(root,'state'),watchdog:{staleMs:1000,intervalMs:1000,reviewIntervalMs:1000},acceptMode:'auto',work:{sandboxDriver:'disabled'},execution:{router:{mode:'host'},management:{enabled:true,maxWorkers:1},workers:[{id:'one',backend:'codex'}]},sources:[{id:'local',kind:'local',cwd:root,workspace:{mode:'source'},allowedActors:['alice']}]})
 let h!:Runtime,workers=0,seq=0
 const model:Model={async run(r){const threadId=r.threadId??'thread-'+(++seq);r.onThread?.(threadId);r.onTurn?.('t-'+seq);const p=JSON.parse(r.input);let out:any
  if(p.kind==='goal_replanning'||p.kind==='goal_plan_review'){await readAll(r,p);const evidenceIds=p.evidence.map((e:any)=>e.id);out=p.kind==='goal_replanning'?{reason:'Replace repetitive inspection with deterministic calculation',evidenceIds,changes:[{id:'build',instruction:'CALCULATE 21 plus 21 and write result.json',dependsOn:[]}],additions:[]}:{approved:true,explanation:'The strategy implements the original contract',evidenceIds}}
  else if(p.kind==='goal_verification'){await readAll(r,p);out={checks:p.criteria.map((c:any)=>({criterionId:c.id,verdict:'passed',explanation:'Inspected current evidence',evidenceIds:p.evidence.filter((e:any)=>c.id==='__goal__'||e.criterionIds.includes(c.id)).map((e:any)=>e.id)}))}}
  else if(r.role==='worker'){
   workers++;const goal=h.store.list<RouterGoal>('router-goal')[0]!,node=goal.nodes!.find(n=>n.ticketId===r.activity?.ticketId)!
   if(node.id==='build')writeFileSync(join(root,'result.json'),JSON.stringify({total:workers===1?0:42}));else writeFileSync(join(root,'report.txt'),'Total 42')
   if(options.hangFirst&&workers===1)await new Promise<void>((_,reject)=>{const stop=()=>reject(Error('Injected interrupted Worker'));if(r.signal?.aborted)stop();else r.signal?.addEventListener('abort',stop,{once:true})})
   out={state:workers===1?'waiting':'ready',summary:workers===1?'Inspecting the same failed calculation again':'Artifact written',reply:'',question:null,askedBy:null,handbacks:[]}
  }else out={reply:''}
  return {threadId,turnId:'t',text:JSON.stringify(out)}
 }}
 const open=()=>{h=new Runtime(config,{model});hosts.push(h)};open()
 h.scopes.command({action:'scope.put',operationId:'scope',expectedRevision:0,scope:{id:'team',tenantId:'org',name:'Team',managers:[JSON.stringify(['local','alice'])],workerIds:['one'],sourceIds:['local'],backendIds:['codex']}})
 h.scopes.command({action:'entry.bind',operationId:'entry',expectedRevision:0,scopeId:'team',sourceId:'local',accountNamespace:'local',nativeId:'test',history:'group'})
 const received=h.receive('local','alice',{id:'request',thread:'test',scope:'test',addressed:true,text:'Continuously produce verified total 42 and report. Never deploy.'}) as any
 const c=h.scopes.context(h.store.triggers.get(received.triggerId)!,'local:test')!
 h.goals.command({action:'start',operationId:'start',expectedRevision:0,title:'Watchdog recovery',objective:'Produce total 42 and report. Never deploy.',authorizationQuote:'Continuously produce verified total 42 and report',maxReplans:2,criteria:[{id:'sum',description:'Total equals 42',check:{kind:'json_equals',path:'result.json',pointer:'/total',expected:42}},{id:'report',description:'Report total',check:{kind:'text_contains',path:'report.txt',text:'42'}}],nodes:[{id:'build',title:'Build',instruction:'Inspect result repeatedly',workerId:'one',criterionIds:['sum']},{id:'report',title:'Report',instruction:'Write report after calculation',workerId:'one',dependsOn:['build'],criterionIds:['report']}]},c)
 return {root,config,get h(){return h},get workers(){return workers},goal:()=>h.store.list<RouterGoal>('router-goal')[0]!,restart:async()=>{hosts.splice(hosts.indexOf(h),1);await h.close();open()}}
}
async function until(f:ReturnType<typeof fixture>,condition:()=>boolean){for(let i=0;i<1500;i++){await f.h.tick();await new Promise(r=>setTimeout(r,2));if(condition())return}throw Error(JSON.stringify({goal:f.goal(),recoveries:f.h.store.list('watchdog-recovery'),jobs:f.h.store.db.prepare('SELECT id,state,error FROM jobs').all()}))}
async function stalled(f:ReturnType<typeof fixture>){await until(f,()=>f.workers===1&&!f.h.activity.list().some(c=>c.state==='running')&&f.h.store.deliveries().every(d=>!['pending','sending'].includes(d.status)));return f.h.watchdog.snapshot().targets[0]!}
const directive=(target:WatchdogTarget,id='operation-1')=>({id,targetId:target.id,fence:target.fence,judgment})
function observer(root:string){const store=new Store(join(root,'observer.sqlite'));stores.push(store);return {store,monitor:new WatchdogMonitor(store)}}

it('recovers a silent stalled multi-stage goal through reviewed replanning and independent acceptance after a restart',async()=>{
 const f=fixture(),original=f.goal(),target=await stalled(f)
 expect(target).toBeDefined();expect(target.waiting).toBeUndefined()
 const accepted=f.h.watchdog.accept(directive(target));expect(accepted.state).toBe('interrupting')
 await f.restart();expect(f.h.watchdog.accept(directive(target))).toEqual(accepted)
 await until(f,()=>f.goal().state==='completed');await f.h.watchdog.advance()
 expect(f.workers).toBe(3);expect(f.goal().replans).toBe(1);expect(f.goal().contract).toEqual(original.contract)
 const plan=f.h.store.list<any>('goal-replan')[0]
 const detection=plan.snapshot.evidence.find((e:any)=>e.id===accepted.id)
 expect(JSON.parse(detection.content).observation.evidence.map((e:any)=>e.id)).toContain('artifacts')
 expect(plan.proposal.evidenceIds).toContain(accepted.id);expect(plan.review.evidenceIds).toContain(accepted.id)
 expect(f.goal().criteria).toEqual(original.criteria);expect(f.goal().taskIds).toHaveLength(2)
 expect(f.h.store.list<WatchdogRecovery>('watchdog-recovery')).toMatchObject([{state:'resolved'}])
 const final=f.h.store.list<any>('goal-verification').find(r=>!r.nodeId&&r.state==='passed')
 expect(final).toBeDefined()
 const observed=final.snapshot.evidence.find((e:any)=>e.key==='watchdog-observation')
 expect(JSON.parse(observed.content)).toMatchObject(JSON.parse(JSON.stringify({id:accepted.id,observation:accepted.observation,judgment:accepted.judgment})))
 expect(JSON.parse(observed.content)).not.toHaveProperty('state')
 expect(f.h.verification.current(final,f.goal())).toBe(true)
})
it('rejects a stale judgment after artifacts change, pause, cancellation or acceptance mutation',async()=>{
 const f=fixture(),target=await stalled(f)
 writeFileSync(join(f.root,'result.json'),'{"total":42}')
 expect(()=>f.h.watchdog.accept(directive(target))).toThrow('stale')
 const fresh=f.h.watchdog.snapshot().targets[0]!;f.h.pause(true)
 expect(()=>f.h.watchdog.accept(directive(fresh))).toThrow('stale');f.h.pause(false)
 const goal=f.goal();goal.criteria[0]!.description='Modified acceptance';f.h.store.put('router-goal',goal.id,goal)
 expect(()=>f.h.watchdog.accept(directive(fresh))).toThrow('stale')
})
it('never revives a user-stopped task from a queued recovery',async()=>{
 const f=fixture(),target=await stalled(f);f.h.watchdog.accept(directive(target));await f.h.stop(target.ticketId)
 await f.h.watchdog.advance();await f.restart();await f.h.tick()
 expect(f.workers).toBe(1);expect(f.h.store.tickets.get(target.ticketId)?.ended?.by).toBe('human')
 expect(f.h.store.list<WatchdogRecovery>('watchdog-recovery')[0]?.state).toBe('stale')
})
it('does not apply an old plan failure after a new input arrives during interruption',async()=>{
 const f=fixture(),target=await stalled(f);f.h.watchdog.accept(directive(target))
 f.h.engine.note(target.ticketId,'New evidence arrived; inspect it before continuing')
 await f.h.watchdog.advance()
 expect(f.h.store.list<WatchdogRecovery>('watchdog-recovery')[0]?.state).toBe('stale')
 expect(f.h.store.list('goal-replan')).toHaveLength(0)
})
it('does not interrupt approval waits or retry unresolved external effects',async()=>{
 const f=fixture(),target=await stalled(f)
 f.h.store.put('approval','approval',{ticketId:target.ticketId,status:'pending'})
 expect(f.h.watchdog.snapshot().targets[0]?.waiting).toBe('human_approval')
 expect(()=>f.h.watchdog.accept(directive(target))).toThrow()
 f.h.store.put('approval','approval',{ticketId:target.ticketId,status:'resolved'})
 const run=f.h.store.get<any>('run',target.ticketId);f.h.store.put('run',target.ticketId,{...run,phase:'uncertain'})
 const uncertain=f.h.watchdog.snapshot().targets[0]!
 expect(uncertain.waiting).toBe('uncertain_effects')
 expect(()=>f.h.watchdog.accept(directive(uncertain))).toThrow('waiting')
})
it('rechecks authorization after the recovery was persisted',async()=>{
 const f=fixture(),target=await stalled(f);f.h.watchdog.accept(directive(target))
 const source=f.config.sources[0]!;source.allowedActors=[]
 await f.h.watchdog.advance()
 expect(f.h.store.list<WatchdogRecovery>('watchdog-recovery')[0]?.state).toBe('stale');expect(f.workers).toBe(1)
})
it('holds uncertain execution explicitly when the host restarts while interrupting a running Worker',async()=>{
 const f=fixture({hangFirst:true});await until(f,()=>f.workers===1)
 const target=f.h.watchdog.snapshot().targets[0]!
 f.h.watchdog.accept(directive(target));await f.restart();await f.h.watchdog.advance()
 expect(f.h.store.list<WatchdogRecovery>('watchdog-recovery')[0]?.state).toBe('held')
 expect(f.goal().state).toBe('held');expect(f.goal().reason).toContain('uncertain')
 await f.h.tick();expect(f.workers).toBe(1)
})
it('holds an unresolved goal once its recovery allowance is exhausted',async()=>{
 const f=fixture(),target=await stalled(f);f.config.watchdog.maxRecoveries=1
 const first=f.h.watchdog.accept(directive(f.h.watchdog.snapshot().targets[0]!))
 f.h.store.put('watchdog-recovery',first.id,{...first,state:'resolved'})
 const next=f.h.watchdog.snapshot().targets[0]!
 expect(()=>f.h.watchdog.accept(directive(next,'second'))).toThrow('allowance exhausted')
 expect(f.goal().state).toBe('held');expect(f.goal().reason).toContain('unresolved')
 expect(f.h.watchdog.snapshot().targets).toHaveLength(0)
})
it('does not retain private judgment text or raw model errors in the separate observer database',async()=>{
 const f=fixture();await stalled(f);const o=observer(f.root),s=f.h.watchdog.snapshot(),secret='PRIVATE-VALUE-7172'
 await o.monitor.step({...s,at:1000},async()=>judgment,async()=>{})
 await o.monitor.step({...s,at:2100},async()=>({...judgment,reason:secret}),async()=>{throw Error(secret)})
 const all=JSON.stringify(o.store.db.prepare('SELECT body FROM records').all())
 expect(all).not.toContain(secret);expect(all).toContain('stalled')
})
it('uses opaque observer keys and current effective native model settings',async()=>{
 const f=fixture();await stalled(f);const goal=f.goal();goal.nodes![0]!.id='PRIVATE-NODE-SENTINEL';f.h.store.put('router-goal',goal.id,goal)
 f.config.model='live-native-model';f.config.effort='high'
 const t=f.h.watchdog.snapshot().targets[0]!
 expect(t.id).not.toContain('PRIVATE-NODE');expect(t.inference.model).toBe('live-native-model');expect(t.inference.options.effort).toBe('high')
 const o=observer(f.root),s=f.h.watchdog.snapshot()
 await o.monitor.step({...s,at:1000},async()=>judgment,async()=>{})
 expect(JSON.stringify(o.store.db.prepare('SELECT body FROM records').all())).not.toContain('PRIVATE-NODE-SENTINEL')
})
it.each(['anthropic','openai-responses'] as const)('keeps native effort defaults out of %s provider options',async(kind)=>{
 const f=fixture();await stalled(f);f.config.effort='high'
 const parameters=kind==='anthropic'?{thinking:{type:'disabled'}}:{reasoning:{effort:'low'}}
 f.config.backends=backendsSchema.parse({codex:{kind,baseUrl:'https://example.test/v1',model:'provider-model',parameters}})
 const t=f.h.watchdog.snapshot().targets[0]!
 expect(t.inference.options.effort).toBeUndefined();expect(t.inference.model).toBeUndefined()
 if(t.inference.backend.kind==='codex')throw Error('Expected the current API backend')
 expect(apiOptions(t.inference.backend,t.inference.options).parameters).toEqual(parameters)
})
it('detects no progress despite fresh activity and persists observations across monitor restart',async()=>{
 const f=fixture(),target=await stalled(f),o=observer(f.root)
 let calls=0,applies=0;const judge=async()=>{calls++;return judgment},apply=async()=>{applies++}
 const snapshot=(at:number):WatchdogSnapshot=>({...f.h.watchdog.snapshot(),at,targets:[{...target,activityAt:at}]})
 await o.monitor.step(snapshot(1000),judge,apply);expect(calls).toBe(0)
 const reopened=new WatchdogMonitor(o.store);await reopened.step(snapshot(2100),judge,apply)
 expect(calls).toBe(1);expect(applies).toBe(1)
})
it('retries a lost recovery response with the identical operation id without duplicate recovery',async()=>{
 const f=fixture(),target=await stalled(f),o=observer(f.root),snapshot=f.h.watchdog.snapshot();let lost=true
 const apply=async(d:WatchdogDirective)=>{const r=f.h.watchdog.accept(d);if(lost){lost=false;throw Error('Connection lost after commit')}return r}
 await o.monitor.step({...snapshot,at:1000},async()=>judgment,apply)
 await o.monitor.step({...snapshot,at:2100},async()=>judgment,apply)
 expect(o.store.list<any>('watchdog-directive')[0]?.state).toBe('pending')
 await new WatchdogMonitor(o.store).step({...snapshot,at:2200,targets:[{...target,recoveryId:'active'}]},async()=>judgment,apply)
 expect(o.store.list<any>('watchdog-directive')[0]?.state).toBe('sent')
 expect(f.h.store.list('watchdog-recovery')).toHaveLength(1)
})
it('keeps legitimate waits quiet and bounds semantic model calls across restart',async()=>{
 const f=fixture(),target=await stalled(f),o=observer(f.root);let calls=0
 const judge=async()=>{calls++;return {...judgment,verdict:'uncertain' as const}},apply=async()=>{throw Error('must not recover')}
 const snapshot=(at:number,waiting?:string)=>({...f.h.watchdog.snapshot(),at,config:{...f.config.watchdog,maxReviewsPerHour:1},targets:[{...target,waiting}]})
 await o.monitor.step(snapshot(1000),judge,apply)
 await o.monitor.step(snapshot(3000,'background_work'),judge,apply);expect(calls).toBe(0)
 await o.monitor.step(snapshot(4000),judge,apply);await new WatchdogMonitor(o.store).step(snapshot(6000),judge,apply)
 expect(calls).toBe(1)
})
