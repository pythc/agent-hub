import {afterEach,expect,it} from 'vitest'
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Runtime} from '../src/runtime.ts'
import {serve} from '../src/server.ts'
import {configSchema,type Config} from '../src/config.ts'
import type {Model,ModelRequest} from '../src/model.ts'
import type {RouterGoal} from '../src/router-goals.ts'
import type {VerificationRound} from '../src/goal-verification.ts'
import type {OutboundTask} from '../src/delegation/manager.ts'
import {backupState,restoreState,verifyBackup} from '../src/backup.ts'
import {DelegationError} from '../src/delegation/contract.ts'

const roots:string[]=[],servers:Awaited<ReturnType<typeof serve>>[]=[]
afterEach(async()=>{
 for(const server of servers.splice(0)){server.server.closeAllConnections();await new Promise<void>(r=>server.server.close(()=>r()));await server.closeRuntime()}
 for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true})
})
const ready={state:'ready',summary:'Checked the actual declared JSON file',reply:'Value checked',question:null,askedBy:null,handbacks:[]}
const decode=(v:any)=>{if(!v.success)throw Error(JSON.stringify(v));return JSON.parse(v.contentItems[0].text)}
function config(value=42){
 const root=mkdtempSync(join(tmpdir(),'roppo-goal-team-'));roots.push(root);mkdirSync(join(root,'files'))
 writeFileSync(join(root,'files','result.json'),JSON.stringify({total:value}))
 writeFileSync(join(root,'files','local.json'),'{"used":42}')
 return configSchema.parse({stateDir:join(root,'state'),port:0,delegation:{enabled:true,pollMs:100,leaseMs:6000},work:{sandboxDriver:'disabled',network:false},execution:{router:{mode:'host'},management:{enabled:true},workers:[{id:'one',backend:'codex'}]},sources:[{id:'local',kind:'local',cwd:join(root,'files'),allowedActors:['alice'],sandbox:'read-only',workspace:{mode:'source'}},{id:'delegation',kind:'delegation',cwd:join(root,'files'),sandbox:'read-only',workspace:{mode:'directory'}}]})
}
async function start(c:Config,m:Model){const h=new Runtime(c,{model:m});const s=await serve(h);servers.push(s);return h}
async function stop(h:Runtime){const i=servers.findIndex(s=>s.runtime===h),s=servers.splice(i,1)[0]!;s.server.closeAllConnections();await new Promise<void>(r=>s.server.close(()=>r()));await s.closeRuntime()}
function gate(){let release!:()=>void;const promise=new Promise<void>(r=>release=r);return {promise,release}}
async function waitGate(g:ReturnType<typeof gate>,r:ModelRequest){await Promise.race([g.promise,new Promise<never>((_,reject)=>{if(r.signal?.aborted)reject(r.signal.reason);else r.signal?.addEventListener('abort',()=>reject(r.signal?.reason),{once:true})})])}
async function readAll(r:ModelRequest,input:any){
 const contents:any[]=[]
 for(const e of input.evidence){let offset=0;for(;;){const page=decode(await r.onTool!('goal_evidence',{id:e.id,offset},'read-'+e.id+'-'+offset));contents.push({...e,content:page.content});if(page.nextOffset===null)break;offset=page.nextOffset}}
 return contents
}
function passed(input:any){return {checks:input.criteria.map((cr:any)=>({criterionId:cr.id,verdict:'passed',explanation:'Independently inspected the actual file and signed peer provenance',evidenceIds:input.evidence.filter((e:any)=>cr.id==='__goal__'||e.criterionIds.includes(cr.id)).map((e:any)=>e.id)}))}}
async function fixture(options:{value?:number;legacy?:boolean;workerGate?:ReturnType<typeof gate>;verify?:(r:ModelRequest,input:any)=>Promise<any>}={}){
 const aConfig=config(),bConfig=config(options.value),callsA:ModelRequest[]=[],callsB:ModelRequest[]=[]
 let serial=0
 const parent:Model={async run(r){
  callsA.push(r);const threadId=r.threadId??'parent-'+(++serial),turnId='turn-'+serial;r.onThread?.(threadId);r.onTurn?.(turnId)
  const input=JSON.parse(r.input)
  if(input.kind==='goal_verification'){
   expect(r.threadId).toBeUndefined();expect(r.sandbox).toBe('read-only');expect(r.tools?.map(t=>t.name)).toEqual(['goal_evidence'])
   return {threadId,turnId,text:JSON.stringify(options.verify?await options.verify(r,input):(await readAll(r,input),passed(input)))}
  }
  if(r.role==='worker'){
   r.onCapabilities?.({managed:true,mcpServers:[],disabledPlugins:[]})
   expect(r.input).toContain('prerequisiteEvidence')
   decode(await r.onTool!('superagent_read',{resource:'files/local.json'},'read-local'))
   return {threadId,turnId,text:JSON.stringify(ready)}
  }
  return {threadId,turnId,text:JSON.stringify({reply:''})}
 }}
 const child:Model={async run(r){
  callsB.push(r);const threadId=r.threadId??'child-'+(++serial),turnId='turn-'+serial;r.onThread?.(threadId);r.onTurn?.(turnId)
  const input=JSON.parse(r.input)
  if(r.role==='worker'){
   if(options.workerGate)await waitGate(options.workerGate,r)
   decode(await r.onTool!('superagent_read',{resource:'files/result.json'},'read-result'))
   decode(await r.onTool!('superagent_artifact',{path:'result.json'},'capture-result'))
   return {threadId,turnId,text:JSON.stringify(ready)}
  }
  if(input.kind==='worker_result'){
   decode(await r.onTool!('worker_manage',{action:'result',ticketId:input.messages[0].ticketId},'worker-report'))
   return {threadId,turnId,text:JSON.stringify({reply:'The Worker checked the file; the parent must verify its bytes.'})}
  }
  const list=decode(await r.onTool!('worker_manage',{action:'list'},'workers'))
  decode(await r.onTool!('worker_manage',{action:'assign',id:'one',requestId:'child-step',revision:list.revision,text:'Read result.json and capture the declared file',acceptance:'Return actual file evidence'},'assign-worker'))
  return {threadId,turnId,text:JSON.stringify({reply:''})}
 }}
 let a=await start(aConfig,parent);const b=await start(bConfig,child)
 if(options.legacy){const receive=b.delegation.receive.bind(b.delegation);b.delegation.receive=async(value:any)=>{if(value.operation==='capabilities')throw new DelegationError('unsupported_operation',404);return receive(value)}}
 const ticket=b.delegation.pairing({expectedRevision:b.settings.current().revision,policy:{workerIds:['one']}})
 await a.delegation.connect({ticket,label:'Child',expectedRevision:a.settings.current().revision})
 a.scopes.command({action:'scope.put',operationId:'scope',expectedRevision:0,scope:{id:'team',tenantId:'owner',name:'Team',managers:[JSON.stringify(['local','alice'])],workerIds:['one'],teamTargetIds:[b.delegation.identity.id],sourceIds:['local'],backendIds:['codex']}})
 a.scopes.command({action:'entry.bind',operationId:'entry',expectedRevision:0,scopeId:'team',sourceId:'local',accountNamespace:'local',nativeId:'request',history:'group'})
 const root=a.receive('local','alice',{id:'root',thread:'request',text:'Build and independently verify the requested file with the connected team.',addressed:true}) as any
 const context=(id=root.triggerId)=>a.scopes.context(a.store.triggers.get(id)!,'local:request')!
 const startGoal=(extra:any={})=>a.goals.command({action:'start',operationId:'goal-start',expectedRevision:0,title:'Verified child result',objective:'The returned result.json total must be 42',authorizationQuote:'Build and independently verify',maxReplans:0,criteria:[{id:'answer',description:'Actual JSON total equals 42',files:['result.json'],check:{kind:'json_equals',path:'result.json',pointer:'/total',expected:42}}],nodes:[{id:'remote',title:'Child file',instruction:'Check the actual JSON file and return it',teamTargetId:b.delegation.identity.id,criterionIds:['answer']}],...extra},context()) as RouterGoal
 const result={get a(){return a},b,aConfig,parent,callsA,callsB,context,startGoal,goal:()=>a.store.list<RouterGoal>('router-goal')[0]!,task:()=>a.store.list<OutboundTask>('delegation-outbound')[0]!,rounds:()=>a.store.list<VerificationRound>('goal-verification'),restart:async()=>{await stop(a);a=await start(aConfig,parent)}}
 return result
}
async function until(f:Awaited<ReturnType<typeof fixture>>,predicate:()=>boolean,timeout=6500){
 const deadline=Date.now()+timeout
 while(Date.now()<deadline){if(predicate())return;await new Promise(r=>setTimeout(r,15))}
 throw Error('Goal did not settle: '+JSON.stringify({goal:f.goal(),outbound:f.a.delegation.snapshot().outbound,rounds:f.rounds().map(({snapshot,...r})=>r),routerErrors:f.a.store.list('router-error')}))
}

it('attributes parent knowledge documents to the parent instance in remote acceptance',async()=>{
 const f=await fixture()
 const doc=f.a.knowledge.command({action:'put',operationId:'parent-doc',expectedRevision:0,title:'Parent evidence',content:'Only the parent knowledge store contains this text'},f.context())
 f.startGoal({criteria:[{id:'answer',description:'Actual JSON total equals 42',files:['result.json'],documents:[doc.id],check:{kind:'json_equals',path:'result.json',pointer:'/total',expected:42}}]})
 await until(f,()=>f.goal().state==='completed')
 const evidence=f.rounds().flatMap(r=>r.snapshot.evidence).filter(e=>e.kind==='document')
 expect(evidence.length).toBeGreaterThan(0)
 expect(evidence.every(e=>e.sourceInstance===f.a.delegation.identity.id&&e.sourceInstance!==f.b.delegation.identity.id&&e.content==='Only the parent knowledge store contains this text'&&e.revision===doc.revision)).toBe(true)
})

it('schedules a real remote node, independently verifies its bytes, and completes without a fake local ticket',async()=>{
 const f=await fixture(),foreign=f.b.activity.begin('tool','unrelated-private-call',{ticketId:'other-ticket'});f.b.activity.finish(foreign,'completed');f.startGoal()
 await until(f,()=>f.goal().state==='completed')
 expect(f.a.store.tickets.list()).toHaveLength(0)
 expect(f.b.store.tickets.list()).toHaveLength(1)
 expect(f.goal().taskIds).toEqual([]);expect(f.goal().delegationIds).toEqual([f.task().id])
 expect(f.task()).toMatchObject({acceptance:'passed',acceptedBy:'goal-verification',verificationRoundId:f.goal().finalRoundId})
 expect(f.rounds()).toHaveLength(2);expect(f.rounds().every(r=>r.state==='passed')).toBe(true)
 const remoteEvidence=f.rounds()[0]!.snapshot.evidence
 expect(remoteEvidence.filter(e=>e.key!=='goal-controller').every(e=>!e.ticketId&&e.delegationId===f.task().id&&e.sourceInstance===f.b.delegation.identity.id)).toBe(true)
 expect(JSON.parse(remoteEvidence.find(e=>e.key==='goal-controller')!.content).creation.action).toBe('router_goal.start')
 expect(remoteEvidence.find(e=>e.kind==='file')?.content).toBe('{"total":42}')
 expect(f.task().remote?.execution?.toolCalls.map(c=>c.name)).toEqual(['superagent_read','superagent_artifact'])
 expect(JSON.stringify(f.task().remote?.execution)).not.toContain('unrelated-private-call')
 expect(f.a.delegation.snapshot().goals[0]?.nodes[0]).toMatchObject({kind:'team',delegationId:f.task().id,state:'passed'})
 expect(f.callsA.filter(r=>JSON.parse(r.input).kind==='goal_verification')).toHaveLength(1)
 expect(f.a.store.db.prepare('PRAGMA user_version').get()!.user_version).toBe(11)
 await until(f,()=>f.a.store.deliveries().some(m=>m.status==='sent'&&m.text.includes('已通过独立验收')))
})

it('retains the original v1 projection for a peer without the optional execution-ledger capability',async()=>{
 const f=await fixture({legacy:true});f.startGoal();await until(f,()=>f.goal().state==='completed')
 expect(f.task().remote?.execution).toBeUndefined()
 expect(f.a.store.get<any>('delegation-connection',f.b.delegation.identity.id).features).toEqual([])
 const execution=f.rounds()[0]!.snapshot.evidence.find(e=>e.key==='peer-execution')!
 expect(JSON.parse(execution.content).complete).toBe(false)
 expect(JSON.parse(execution.content).execution).toBeNull()
})

it('holds false ready evidence and prevents manual review from bypassing independent acceptance',async()=>{
 const f=await fixture({value:41});f.startGoal();await until(f,()=>f.goal().state==='held')
 expect(f.task().remote?.state).toBe('ready');expect(f.task().acceptance).toBe('pending')
 expect(f.rounds()[0]?.checks[0]?.verdict).toBe('failed')
 const read=await f.a.delegation.command({action:'inspect',id:f.task().id}) as any
 await expect(f.a.delegation.command({action:'accept',id:f.task().id,operationId:'manual-bypass',expectedRevision:f.a.settings.current().revision,evidence:read.evidence.map((e:any)=>e.id)})).rejects.toThrow('managed_goal_requires_independent_acceptance')
 await new Promise(r=>setTimeout(r,250))
 expect(f.callsB.filter(r=>r.role==='worker')).toHaveLength(1)
 expect(f.a.store.list('goal-repair')).toHaveLength(0)
})

it('rejects unread verifier citations within a bounded retry allowance without repeating remote execution',async()=>{
 const f=await fixture({verify:async(_r,input)=>passed(input)})
 f.startGoal({criteria:[{id:'answer',description:'Independently inspect the actual returned total',files:['result.json']}]})
 await until(f,()=>f.goal().state==='held')
 expect(f.task().acceptance).toBe('pending')
 expect(f.callsA.filter(r=>JSON.parse(r.input).kind==='goal_verification')).toHaveLength(3)
 expect(f.callsB.filter(r=>r.role==='worker')).toHaveLength(1)
})

it('waits for remote acceptance before a dependent local Worker and verifies the combined goal',async()=>{
 const worker=gate(),review=gate();let reviewing=false
 const f=await fixture({workerGate:worker,verify:async(r,input)=>{await readAll(r,input);if(input.criteria.some((c:any)=>c.id==='answer')){reviewing=true;await waitGate(review,r)}return passed(input)}})
 f.startGoal({criteria:[{id:'answer',description:'Inspect total 42 in the child file',files:['result.json']},{id:'combined',description:'Local result retains the accepted value',check:{kind:'json_equals',path:'local.json',pointer:'/used',expected:42}}],nodes:[{id:'remote',title:'Remote prerequisite',instruction:'Read the actual JSON file',teamTargetId:f.b.delegation.identity.id,criterionIds:['answer']},{id:'local',title:'Local dependent',instruction:'Use the accepted remote evidence and read local.json',workerId:'one',dependsOn:['remote'],criterionIds:['combined']}]})
 await until(f,()=>f.callsB.some(r=>r.role==='worker'));expect(f.callsA.some(r=>r.role==='worker')).toBe(false)
 worker.release();await until(f,()=>reviewing);expect(f.callsA.some(r=>r.role==='worker')).toBe(false)
 review.release();await until(f,()=>f.goal().state==='completed')
 expect(f.a.store.tickets.list()).toHaveLength(1);expect(f.goal().delegationIds).toHaveLength(1)
 expect(f.rounds().find(r=>!r.nodeId)?.snapshot.delegations).toHaveLength(1)
 expect(f.callsA.find(r=>r.role==='worker')?.input).toContain('sourceInstance')
})

it('cancels the remote goal subtree and rejects unsupported execution pause',async()=>{
 const worker=gate(),f=await fixture({workerGate:worker});f.startGoal()
 await until(f,()=>f.callsB.some(r=>r.role==='worker'))
 expect(()=>f.a.goals.command({action:'pause',id:f.goal().id,operationId:'pause',expectedRevision:f.goal().revision},f.context())).toThrow('Remote execution pause is unsupported')
 f.a.goals.command({action:'cancel',id:f.goal().id,operationId:'cancel',expectedRevision:f.goal().revision},f.context())
 await until(f,()=>f.task().remote?.state==='cancelled')
 expect(f.goal().state).toBe('cancelled');expect(f.task().acceptance).toBe('pending')
 worker.release();await new Promise(r=>setTimeout(r,100))
 expect(f.callsB.filter(r=>r.role==='worker')).toHaveLength(1)
})

it('fences a verifier result after the team connection is revoked',async()=>{
 const review=gate();let reading=false
 const f=await fixture({verify:async(r,input)=>{await readAll(r,input);reading=true;await waitGate(review,r);return passed(input)}})
 f.startGoal();await until(f,()=>reading)
 await f.a.delegation.revoke(f.b.delegation.identity.id);review.release()
 await until(f,()=>f.goal().state==='held')
 expect(f.task().acceptance).toBe('pending')
 expect(f.a.store.deliveries().some(m=>m.text.includes('已通过独立验收'))).toBe(false)
})

it('removes delegated artifact bodies from projections after source history deletion without breaking the pump',async()=>{
 const review=gate();let reading=false
 const f=await fixture({verify:async(r,input)=>{await readAll(r,input);reading=true;await waitGate(review,r);return passed(input)}})
 f.startGoal();await until(f,()=>reading)
 const id=f.task().id
 f.a.memory.command(f.context(),{action:'history.delete',operationId:'erase-remote-goal',expectedRevision:0})
 const snapshot=f.a.delegation.snapshot()
 expect(snapshot.outbound).toEqual([]);expect(snapshot.goals).toEqual([])
 await expect(f.a.delegation.command({action:'inspect',id})).rejects.toThrow('task_not_found')
 expect(JSON.stringify(f.a.store.get('delegation-outbound',id))).not.toContain('"total":42')
 f.a.delegation.pump();review.release();await new Promise(r=>setTimeout(r,150))
 expect(f.a.store.deliveries().some(m=>m.text.includes('已通过独立验收'))).toBe(false)
 expect(f.a.store.db.prepare("SELECT body FROM audit WHERE body LIKE '%delegation.pump_failed%' LIMIT 1").get()).toBeUndefined()
})

it('freezes the originally authorized team policy before dispatch',async()=>{
 const f=await fixture();f.a.pause(true);f.startGoal()
 f.a.updateSettings(f.a.settings.current().revision,{execution:{...f.a.config.execution,teamTargets:f.a.config.execution.teamTargets!.map(t=>({...t,limits:{...t.limits,maxActivations:13}}))}})
 f.a.pause(false);await until(f,()=>f.goal().state==='held')
 expect(f.goal().reason).toContain('goal_team_policy_changed')
 expect(f.b.store.list('delegation-inbound')).toHaveLength(0)
})

it('keeps an unsubmitted node pending while team intake is paused and dispatches once after it resumes',async()=>{
 const f=await fixture();f.a.pause(true);f.startGoal()
 const intake=(state:'enabled'|'paused')=>f.a.updateSettings(f.a.settings.current().revision,{execution:{...f.a.config.execution,teamTargets:f.a.config.execution.teamTargets!.map(t=>({...t,state}))}})
 intake('paused');f.a.pause(false)
 await until(f,()=>f.goal().nodes![0]?.reason==='Waiting for the child team to resume intake')
 expect(f.goal().state).toBe('active');expect(f.b.store.list('delegation-inbound')).toHaveLength(0)
 intake('enabled');await until(f,()=>f.goal().state==='completed')
 expect(f.callsB.filter(r=>r.role==='worker')).toHaveLength(1)
})

it('resumes interrupted read-only verification after restart without creating another child task',async()=>{
 const review=gate();let reviewing=false,first=true
 const f=await fixture({verify:async(r,input)=>{await readAll(r,input);if(first){first=false;reviewing=true;await waitGate(review,r)}return passed(input)}})
 f.startGoal();await until(f,()=>reviewing);await f.restart();review.release()
 await until(f,()=>f.goal().state==='completed')
 expect(f.b.store.tickets.list()).toHaveLength(1);expect(f.callsB.filter(r=>r.role==='worker')).toHaveLength(1)
 expect(f.a.store.db.prepare('PRAGMA user_version').get()!.user_version).toBe(11)
})

it('recovers the same durable node binding after a pointer gap and an explicit resume under a new input',async()=>{
 const worker=gate(),f=await fixture({workerGate:worker});f.startGoal()
 await until(f,()=>f.callsB.some(r=>r.role==='worker'))
 f.a.pause(true)
 const previous=f.goal(),node={...previous.nodes![0]!,state:'pending' as const,delegationId:undefined}
 f.a.store.put('router-goal',previous.id,{...previous,state:'held',nodes:[node],delegationIds:[],reason:'Simulated dispatch pointer gap'})
 const next=f.a.receive('local','alice',{id:'resume-input',thread:'request',text:'Resume the same verified goal with its retained work.',addressed:true}) as any
 f.a.goals.command({action:'resume',id:previous.id,operationId:'new-input-resume',expectedRevision:previous.revision},f.context(next.triggerId))
 f.a.pause(false)
 await until(f,()=>f.goal().nodes![0]!.delegationId===f.task().id)
 worker.release();await until(f,()=>f.goal().state==='completed')
 expect(f.a.store.list('delegation-outbound')).toHaveLength(1)
 expect(f.callsB.filter(r=>r.role==='worker')).toHaveLength(1)
})

it('does not restore an active remote graph over a later human pause before any dispatch',async()=>{
 const f=await fixture();f.a.pause(true);f.startGoal()
 const directory=join(f.a.config.stateDir,'graph-backup');await backupState(f.a.config,directory)
 expect(verifyBackup(directory).schema).toBe(11)
 f.a.goals.command({action:'pause',id:f.goal().id,operationId:'pause-before-dispatch',expectedRevision:f.goal().revision},f.context())
 await stop(f.a)
 await expect(restoreState(f.aConfig,directory)).rejects.toThrow('advanced after backup')
 expect(f.b.store.list('delegation-inbound')).toHaveLength(0)
})

it('rejects ambiguous targets and unauthorized remote targets before creating any goal',async()=>{
 const f=await fixture();f.a.pause(true)
 expect(()=>f.startGoal({nodes:[{id:'ambiguous',title:'Bad target',instruction:'Do work',workerId:'one',teamTargetId:f.b.delegation.identity.id,criterionIds:['answer']}]})).toThrow('exactly one')
 const {routerId,revision,epoch,...scope}=f.a.scopes.scope('team');f.a.scopes.command({action:'scope.put',operationId:'remove-team',expectedRevision:revision,scope:{...scope,teamTargetIds:[]}})
 expect(()=>f.startGoal()).toThrow()
 expect(f.a.store.list('router-goal')).toHaveLength(0)
 expect(f.a.store.db.prepare('PRAGMA user_version').get()!.user_version).toBe(10)
})
