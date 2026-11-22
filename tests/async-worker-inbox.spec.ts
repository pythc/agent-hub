import {ExecutionTrace} from '../src/execution-trace.ts'
import {currentTaskAssignment,reviseTaskAssignment,type AssignmentSpec} from '../src/task-assignment-contract.ts'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach,expect,it,vi} from 'vitest'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
import {begin,observe,isCurrent,isDeliverable} from '../src/async-worker-inbox.ts'
import type {RouterGoal} from '../src/router-goals.ts'
const roots:string[]=[],hosts:Runtime[]=[]
afterEach(async()=>{vi.restoreAllMocks();for(const host of hosts.splice(0))await host.close();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true})})
async function fixture(managed=false,legacyAssignment=false,assignment?:AssignmentSpec){
 const root=mkdtempSync(join(tmpdir(),'async-worker-'));roots.push(root)
 const config=configSchema.parse({stateDir:join(root,'state'),acceptMode:'auto',work:{sandboxDriver:'disabled',autoRecover:false},execution:{router:{mode:'host'},management:{enabled:true,maxWorkers:1},workers:[{id:'one',backend:'codex'}]},sources:[{id:'local',kind:'local',cwd:root,workspace:{mode:'source'},allowedActors:['alice']}]})
 const model={run:vi.fn(async()=>{throw Error('No model call permitted by unit fixture')})}
 const host=new Runtime(config,{model});hosts.push(host)
 host.scopes.command({action:'scope.put',operationId:'scope',expectedRevision:0,scope:{id:'team',tenantId:'org',name:'Team',managers:[JSON.stringify(['local','alice'])],workerIds:['one'],sourceIds:['local'],backendIds:['codex']}})
 host.scopes.command({action:'entry.bind',operationId:'entry',expectedRevision:0,scopeId:'team',sourceId:'local',accountNamespace:'local',nativeId:'topic',history:'group'})
 const incoming=host.receive('local','alice',{id:'human',thread:'topic',scope:'topic',text:'Continuously analyze the supplied material. Never deploy.',addressed:true})as {triggerId:string}
 const context=host.scopes.context(host.store.triggers.get(incoming.triggerId)!,'local:topic')!
 let ticketId:string
 if(legacyAssignment){
  // Recreate the pre-contract Engine delegation path, rather than downgrading
  // a current manager assignment or deleting its schema-19 authority records.
  const id='delegation:legacy-work',trigger={...context.trigger,id,threads:[{source:'local',id}],meta:{...context.trigger.meta,delegatedBy:'router',parentTrigger:context.trigger.id},channel:{source:'local',thread:id,address:{routerInbox:'local:topic'}}}
  host.store.put('router-delegation',id,{parentTrigger:context.trigger.id,discussion:'local:topic'})
  host.engine.receive(trigger)
  const decision=host.engine.decide(id,{kind:'accept',title:'Analyze material',scope:'Analyze material',reason:'Legacy Router delegation'})
  if(!decision.ticketId)throw Error('Legacy task was not accepted')
  ticketId=decision.ticketId
  host.store.put('worker-assignment',ticketId,{ticketId,workerId:'one',discussion:'local:topic',source:'local',actor:'alice',parentTrigger:context.trigger.id,mode:'host'})
  host.scopes.own(ticketId,context,'codex')
 }else{
  const assigned=await host.manager.call({action:'assign',id:'one',revision:0,requestId:'work',text:'Analyze material',assignment},{discussion:'local:topic',trigger:context.trigger,scoped:context})
  ticketId=assigned.ticketId
 }
 const assignmentId=host.store.tickets.get(ticketId)!.assignments.at(-1)!.id
 host.engine.assignmentStarted(ticketId,assignmentId)
 let goal:RouterGoal|undefined
 if(managed){goal=host.goals.command({action:'start',operationId:'goal',expectedRevision:0,objective:'Analyze material',authorizationQuote:'Continuously analyze',criteria:[{id:'a',description:'Analysis',files:['analysis.md']}],nodes:[{id:'work',title:'Analyze',instruction:'Analyze material',workerId:'one',criterionIds:['a']}]},context)as RouterGoal;goal.taskIds=[ticketId];goal.nodes![0]!.ticketId=ticketId;host.store.put('router-goal',goal.id,goal)}
 return {host,config,model,ticketId,assignmentId,goal,context}
}
it('captures true assignment/goal/version basis and causal job without inventing missing metadata',async()=>{
 const f=await fixture(true),jobId='start:'+f.assignmentId,a=begin(f.host,f.ticketId,f.assignmentId,jobId),owner=f.host.scopes.ownership(f.ticketId)!
 expect(a).toMatchObject({schema:1,source:'host_activation',causeJobId:jobId,basis:{taskId:f.ticketId,assignmentId:f.assignmentId,goalId:f.goal!.id,goalRevision:f.goal!.revision,planRevision:0,ownerEpoch:owner.ownerEpoch,dataRevision:null,bindingRevision:1}})
 expect(a.basis.contractDigest).toMatch(/^[a-f0-9]{64}$/);expect(isCurrent(f.host,a)).toBe(true)
 expect(()=>begin(f.host,f.ticketId,f.assignmentId,'invented-job')).toThrow('cause_unavailable')
 expect(f.model.run).not.toHaveBeenCalled()
})
it('deduplicates result ten times and across restart without repeating its transactional effect',async()=>{
 const f=await fixture(),a=begin(f.host,f.ticketId,f.assignmentId),effect=vi.fn(()=>f.host.store.put('test-effect',a.id,{ticketId:f.ticketId,value:1})),event={kind:'result' as const,payload:{summary:'SECRET_RESULT'},nativeTurnId:'turn-1'}
 const first=observe(f.host,a,event,e=>{expect(e.disposition).toBe('applied');effect()})
 for(let i=0;i<10;i++)expect(observe(f.host,a,event,effect)).toMatchObject({id:first.id,replayed:true})
 expect(effect).toHaveBeenCalledTimes(1);expect(f.host.store.list('async-worker-event')).toHaveLength(1)
 expect(JSON.stringify(f.host.store.list('async-worker-event'))).not.toContain('SECRET_RESULT')
 hosts.splice(hosts.indexOf(f.host),1);await f.host.close();const reopened=new Runtime(f.config,{model:f.model});hosts.push(reopened)
 for(let i=0;i<10;i++)expect(observe(reopened,a,event,effect).replayed).toBe(true)
 expect(effect).toHaveBeenCalledTimes(1)
})
it('folds progress labels as host observations, terminal result prevents late progress or blocked advancement',async()=>{
 const f=await fixture(),a=begin(f.host,f.ticketId,f.assignmentId),effect=vi.fn()
 const progress=observe(f.host,a,{kind:'progress',payload:'backend/tool/private-name'},effect)
 expect(progress).toMatchObject({source:'host_progress_observation',occurredAt:null,sourceSequence:null})
 expect(JSON.stringify(progress)).not.toContain('private-name')
 for(let i=0;i<10;i++)expect(observe(f.host,a,{kind:'progress',payload:'backend/tool/private-name'},effect).replayed).toBe(true)
 observe(f.host,a,{kind:'result',payload:'Done',nativeTurnId:'turn'},effect)
 expect(observe(f.host,a,{kind:'progress',payload:'backend/request'},effect)).toMatchObject({disposition:'archived',reason:'terminal_observed'})
 expect(observe(f.host,a,{kind:'blocked',payload:'Late error'},effect)).toMatchObject({disposition:'archived',reason:'terminal_observed'})
 expect(effect).toHaveBeenCalledTimes(2)
})
it('rejects same event identity with conflicting payload without overwriting the receipt',async()=>{
 const f=await fixture(),a=begin(f.host,f.ticketId,f.assignmentId),effect=vi.fn()
 const first=observe(f.host,a,{kind:'result',payload:'first',nativeTurnId:'turn'},effect)
 expect(()=>observe(f.host,a,{kind:'result',payload:'changed',nativeTurnId:'turn'},effect)).toThrow('conflict')
 expect(f.host.store.get('async-worker-event',first.id)).toEqual({...first,replayed:undefined})
 expect(effect).toHaveBeenCalledTimes(1)
})
it('rolls back application writes and receipt atomically when the callback throws',async()=>{
 const f=await fixture(),a=begin(f.host,f.ticketId,f.assignmentId),event={kind:'result' as const,payload:'answer'}
 expect(()=>observe(f.host,a,event,()=>{f.host.store.put('test-effect','failed',{ticketId:f.ticketId});throw Error('injected')})).toThrow('injected')
 expect(f.host.store.get('test-effect','failed')).toBeUndefined();expect(f.host.store.list('async-worker-event')).toEqual([]);expect(f.host.store.list('async-worker-terminal')).toEqual([])
 expect(observe(f.host,a,event,()=>{}).disposition).toBe('applied')
})
it('archives older activation results and immutable plan changes but not benign goal control revision',async()=>{
 const f=await fixture(true),old=begin(f.host,f.ticketId,f.assignmentId),current=begin(f.host,f.ticketId,f.assignmentId),effect=vi.fn()
 expect(observe(f.host,old,{kind:'result',payload:'old'},effect).reason).toBe('attempt_superseded')
 f.host.store.put('router-goal',f.goal!.id,{...f.goal!,revision:f.goal!.revision+1,nextAction:'New progress description'})
 expect(isCurrent(f.host,current)).toBe(true)
 expect(observe(f.host,current,{kind:'progress',payload:'stage'},effect).disposition).toBe('applied')
 f.host.store.put('router-goal',f.goal!.id,{...f.goal!,planRevision:1})
 expect(observe(f.host,current,{kind:'result',payload:'wrong plan'},effect)).toMatchObject({disposition:'archived',reason:'basis_changed'})
 expect(effect).toHaveBeenCalledTimes(1)
})
it.each(['human','worker'] as const)('archives completed results after task ends by %s',async by=>{
 const f=await fixture(),a=begin(f.host,f.ticketId,f.assignmentId),task=f.host.store.tickets.get(f.ticketId)!,effect=vi.fn()
 if(by==='human')f.host.engine.stopTicket(f.ticketId,'User cancellation')
 else f.host.store.tickets.save({...task,ended:{at:new Date().toISOString(),by:'executor',outcome:'completed'}})
 expect(isCurrent(f.host,a)).toBe(false)
 expect(observe(f.host,a,{kind:'result',payload:'late completed'},effect)).toMatchObject({disposition:'archived',reason:'authority_changed'})
 expect(effect).not.toHaveBeenCalled()
})
it('fences source disablement, ownership change and spoofed attempt objects',async()=>{
 const f=await fixture(),a=begin(f.host,f.ticketId,f.assignmentId),effect=vi.fn(),owner=f.host.scopes.ownership(f.ticketId)!
 expect(()=>observe(f.host,{...a,basis:{...a.basis,assignmentId:'spoof'}},{kind:'result',payload:'spoof'},effect)).toThrow('attempt_unavailable')
 f.host.store.put('task-ownership',f.ticketId,{...owner,dataRevision:1})
 expect(observe(f.host,a,{kind:'progress',payload:'stale owner'},effect).reason).toBe('basis_changed')
 f.host.config.sources[0]!.enabled=false
 expect(observe(f.host,a,{kind:'result',payload:'disabled'},effect).reason).toBe('authority_changed')
 expect(effect).not.toHaveBeenCalled()
})
it('does not resurrect receipt metadata after history cleanup',async()=>{
 const f=await fixture(),a=begin(f.host,f.ticketId,f.assignmentId),effect=vi.fn()
 const blocked=f.host.memory.cleanup.blocked.bind(f.host.memory.cleanup)
 vi.spyOn(f.host.memory.cleanup,'blocked').mockImplementation((kind,id,value)=>kind==='ticket'&&id===f.ticketId||blocked(kind,id,value))
 expect(()=>observe(f.host,a,{kind:'result',payload:'deleted'},effect)).toThrow('task_unavailable')
 expect(f.host.store.list('async-worker-event')).toEqual([]);expect(effect).not.toHaveBeenCalled()
})
it('rolls back an applied callback if receipt persistence fails and rejects forged causation',async()=>{
 const f=await fixture(),a=begin(f.host,f.ticketId,f.assignmentId),original=f.host.store.put.bind(f.host.store)
 const spy=vi.spyOn(f.host.store,'put').mockImplementation((kind,id,value)=>{if(kind==='async-worker-event')throw Error('disk failure');return original(kind,id,value)})
 expect(()=>observe(f.host,a,{kind:'result',payload:'done'},()=>f.host.store.put('test-effect','partial',{ticketId:f.ticketId}))).toThrow('disk failure')
 expect(f.host.store.get('test-effect','partial')).toBeUndefined();expect(f.host.store.list('async-worker-event')).toEqual([])
 spy.mockRestore();f.host.store.enqueue('wrong-cause','start',{ticketId:f.ticketId,assignmentId:'older-assignment'})
 expect(()=>begin(f.host,f.ticketId,f.assignmentId,'wrong-cause')).toThrow('cause_unavailable')
})
it('archives results after goal cancellation and prevents reopening with an old attempt',async()=>{
 const f=await fixture(true),a=begin(f.host,f.ticketId,f.assignmentId),effect=vi.fn()
 f.host.goals.command({action:'cancel',id:f.goal!.id,operationId:'cancel',expectedRevision:f.goal!.revision},f.context)
 const result=observe(f.host,a,{kind:'result',payload:{state:'ready'}},effect)
 expect(result.disposition).toBe('archived');expect(effect).not.toHaveBeenCalled()
 expect(()=>begin(f.host,f.ticketId,f.assignmentId)).toThrow('authority_unavailable')
})
it('does not let current-pointer advancement alter immutable old receipts or source sequence claims',async()=>{
 const f=await fixture(),first=begin(f.host,f.ticketId,f.assignmentId),event={kind:'progress' as const,payload:'backend/request'},effect=vi.fn()
 const receipt=observe(f.host,first,event,effect),second=begin(f.host,f.ticketId,f.assignmentId)
 expect(isCurrent(f.host,first)).toBe(false);expect(isCurrent(f.host,second)).toBe(true)
 expect(observe(f.host,first,event,effect)).toMatchObject({...receipt,replayed:true})
 expect(effect).toHaveBeenCalledTimes(1)
 expect(receipt).toMatchObject({occurredAt:null,sourceSequence:null,source:'host_progress_observation'})
})
it('rolls schema 18 activation barrier back if begin fails to persist its current pointer',async()=>{
 const f=await fixture(false,true),version=()=>Number(f.host.store.db.prepare('PRAGMA user_version').get()!.user_version),before=version()
 expect(f.host.store.get('task-assignment-contract',f.ticketId)).toBeUndefined()
 expect(before).toBeLessThan(18)
 const original=f.host.store.put.bind(f.host.store),failure=vi.spyOn(f.host.store,'put').mockImplementation((kind,id,value)=>{if(kind==='async-worker-current')throw Error('pointer write failed');return original(kind,id,value)})
 expect(()=>begin(f.host,f.ticketId,f.assignmentId)).toThrow('pointer write failed')
 expect(version()).toBe(before);expect(f.host.store.list('async-worker-attempt')).toEqual([]);expect(f.host.store.list('async-worker-current')).toEqual([])
 failure.mockRestore();begin(f.host,f.ticketId,f.assignmentId);expect(version()).toBe(18)
})
it('permits settled result delivery but fences data revision, new attempt and human cancellation',async()=>{
 const f=await fixture(),a=begin(f.host,f.ticketId,f.assignmentId),result=observe(f.host,a,{kind:'result',payload:'ready'},()=>{})
 const receipt=f.host.store.get<import('../src/async-worker-inbox.ts').WorkerEventReceipt>('async-worker-event',result.id)!
 expect(isCurrent(f.host,a)).toBe(false);expect(isDeliverable(f.host,receipt)).toBe(true)
 const task=f.host.store.tickets.get(f.ticketId)!
 f.host.store.tickets.save({...task,ended:{at:new Date().toISOString(),by:'executor',outcome:'completed'}})
 expect(isDeliverable(f.host,receipt)).toBe(true)
 const owner=f.host.scopes.ownership(f.ticketId)!
 f.host.store.put('task-ownership',f.ticketId,{...owner,dataRevision:1})
 expect(isDeliverable(f.host,receipt)).toBe(false)
 f.host.store.put('task-ownership',f.ticketId,owner);f.host.store.tickets.save(task)
 begin(f.host,f.ticketId,f.assignmentId);expect(isDeliverable(f.host,receipt)).toBe(false)
 f.host.store.put('async-worker-current',f.ticketId,{ticketId:f.ticketId,assignmentId:f.assignmentId,attemptId:a.id})
 f.host.engine.stopTicket(f.ticketId,'cancel');expect(isDeliverable(f.host,receipt)).toBe(false)
})
it('allows completed goal evidence delivery, rejects changed plan or forged receipt',async()=>{
 const f=await fixture(true),a=begin(f.host,f.ticketId,f.assignmentId),r=observe(f.host,a,{kind:'result',payload:'ready'},()=>{})
 const receipt=f.host.store.get<import('../src/async-worker-inbox.ts').WorkerEventReceipt>('async-worker-event',r.id)!
 f.host.store.put('router-goal',f.goal!.id,{...f.goal!,state:'completed',revision:f.goal!.revision+3})
 expect(isDeliverable(f.host,receipt)).toBe(true)
 expect(isDeliverable(f.host,{...receipt,payloadDigest:'f'.repeat(64)})).toBe(false)
 f.host.store.put('router-goal',f.goal!.id,{...f.goal!,state:'completed',planRevision:1})
 expect(isDeliverable(f.host,receipt)).toBe(false)
})

it('fences a pending applied result when a real second assignment advances the shared interface version',async()=>{
 const shared={key:'delivery',version:1,inputs:['material'],outputs:['analysis'],acceptance:['supported by evidence']},f=await fixture(false,false,{interface:shared}),attempt=begin(f.host,f.ticketId,f.assignmentId)
 const receipt=observe(f.host,attempt,{kind:'result',payload:'pending result'},()=>{})
 expect(receipt.basis.taskAssignmentDigest).toBe(currentTaskAssignment(f.host,f.ticketId)!.digest);expect(isDeliverable(f.host,receipt)).toBe(true)
 await f.host.manager.call({action:'assign',id:'one',revision:0,requestId:'version-two',text:'Analyze material',assignment:{interface:{...shared,version:2}}},{discussion:'local:topic',trigger:f.context.trigger,scoped:f.context})
 expect(isDeliverable(f.host,receipt)).toBe(false)
})
it('fences a pending result after an explicit immutable assignment revision, while retaining the old receipt',async()=>{
 const f=await fixture(),attempt=begin(f.host,f.ticketId,f.assignmentId),receipt=observe(f.host,attempt,{kind:'result',payload:'old accepted result'},()=>{}),old=currentTaskAssignment(f.host,f.ticketId)!
 expect(isDeliverable(f.host,receipt)).toBe(true)
 reviseTaskAssignment(f.host,f.ticketId,'one',{discussion:'local:topic',trigger:f.context.trigger,scoped:f.context},{kind:'migration',commandId:'migration-receipt-fence',fingerprint:'retained-operation-fingerprint',expectedDigest:old.digest})
 expect(isDeliverable(f.host,receipt)).toBe(false)
 expect(f.host.store.get('async-worker-event',receipt.id)).toMatchObject({id:receipt.id,disposition:'applied',basis:{taskAssignmentDigest:old.digest}})
})
it('normalizes missing legacy assignment digest only when no assignment contract exists',async()=>{
 const f=await fixture(false,true)
 const attempt=begin(f.host,f.ticketId,f.assignmentId);delete attempt.basis.taskAssignmentDigest;f.host.store.put('async-worker-attempt',attempt.id,attempt)
 const receipt=observe(f.host,attempt,{kind:'result',payload:'legacy completed result'},()=>{})
 expect(receipt.disposition).toBe('applied');expect(isDeliverable(f.host,receipt)).toBe(true)
})

it('projects only committed worker receipts into the timeline, distinguishing adopted results from archived events',async()=>{
 const f=await fixture(),trace=new ExecutionTrace(()=>f.host),cursor=trace.events().cursor,a=begin(f.host,f.ticketId,f.assignmentId),event={kind:'result' as const,payload:'PRIVATE_RESULT_DETAIL',nativeTurnId:'PRIVATE_NATIVE_TURN'}
 expect(()=>observe(f.host,a,event,()=>{throw Error('effect rollback')})).toThrow('effect rollback')
 expect(trace.events({cursor,ticketId:f.ticketId}).events.filter(e=>e.workerEvent)).toEqual([])
 const applied=observe(f.host,a,event,()=>{})
 expect(observe(f.host,a,event,()=>{throw Error('duplicate effect')})).toMatchObject({replayed:true})
 observe(f.host,a,{kind:'blocked',payload:'PRIVATE_BLOCKER_DETAIL'},()=>{throw Error('late effect')})
 const page=trace.events({cursor,ticketId:f.ticketId}),receipts=page.events.filter(e=>e.workerEvent)
 expect(receipts.map(({state,workerEvent})=>({state,workerEvent}))).toEqual([{state:'applied',workerEvent:{kind:'result',disposition:'applied'}},{state:'observed',workerEvent:{kind:'blocked',disposition:'archived'}}])
 expect(receipts.every(e=>e.stage==='run'&&!e.hasResult&&!e.baseline)).toBe(true)
 expect(JSON.stringify(page)).not.toMatch(/PRIVATE_|payloadDigest|nativeTurnDigest|attemptId|worker-event:/)
 expect(trace.events({cursor:page.cursor,ticketId:f.ticketId}).events).toEqual([])
 const first=trace.events({cursor,ticketId:f.ticketId,limit:1})
 expect(first.more).toBe(true)
 expect([...first.events,...trace.events({cursor:first.cursor,ticketId:f.ticketId}).events]).toEqual(page.events)
 const blocked=f.host.memory.cleanup.blocked.bind(f.host.memory.cleanup)
 vi.spyOn(f.host.memory.cleanup,'blocked').mockImplementation((kind,id,value)=>kind==='async-worker-event'&&id===applied.id||blocked(kind,id,value))
 expect(trace.events({cursor,ticketId:f.ticketId}).events.filter(e=>e.workerEvent).map(e=>e.workerEvent?.kind)).toEqual(['blocked'])
 expect(trace.snapshot({ticketId:f.ticketId}).tasks[0]?.asyncInbox).toMatchObject({received:1,applied:0,archived:1})
})
