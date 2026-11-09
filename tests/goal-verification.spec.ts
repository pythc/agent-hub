import {it,expect,afterEach} from 'vitest'
import {mkdtempSync,writeFileSync,rmSync,symlinkSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
import type {Model,ModelRequest} from '../src/model.ts'
import type {RouterGoal} from '../src/router-goals.ts'
import type {VerificationRound} from '../src/goal-verification.ts'
import {classifyGoalFailure} from '../src/goal-contract.ts'
import {protocolBytes} from '../src/context-budget.ts'

const roots:string[]=[],hosts:Runtime[]=[]
afterEach(async()=>{for(const h of hosts.splice(0))await h.close();for(const r of roots.splice(0))rmSync(r,{recursive:true,force:true})})
const ready=(summary='All checks passed')=>({state:'ready',summary,reply:summary,question:null,askedBy:null,handbacks:[]})
async function until(f:ReturnType<typeof fixture>,predicate:()=>boolean){for(let i=0;i<1500;i++){await f.h.tick();await new Promise(r=>setTimeout(r,2));if(predicate())return}throw Error('Did not settle: '+JSON.stringify({goals:f.h.store.list('router-goal'),rounds:f.h.store.list('goal-verification'),jobs:f.h.store.db.prepare('SELECT id,state,error FROM jobs').all()}))}
function fixture(worker?:(r:ModelRequest,attempt:number)=>any,verify?:(r:ModelRequest,input:any)=>Promise<any>){
 const root=mkdtempSync(join(tmpdir(),'goal-verify-'));roots.push(root);let now=Date.now(),h!:Runtime,count=0,seq=0
 const calls:ModelRequest[]=[],attempts=new Map<string,number>()
 const config=configSchema.parse({stateDir:join(root,'state'),acceptMode:'auto',work:{sandboxDriver:'disabled'},execution:{router:{mode:'host'},management:{enabled:true,maxWorkers:2},workers:[{id:'one',backend:'codex'},{id:'two',backend:'codex'}]},sources:[{id:'local',kind:'local',cwd:root,workspace:{mode:'source'},allowedActors:['alice']}]})
 const model:Model={async run(r){calls.push(r);const threadId=r.threadId??'native-'+(++count),turnId='turn-'+(++seq);r.onThread?.(threadId);r.onTurn?.(turnId);const input=JSON.parse(r.input);let output:any
  if(input.kind==='goal_verification'){
   if(verify)output=await verify(r,input)
   else{for(const e of input.evidence)await r.onTool!('goal_evidence',{id:e.id},'read-'+e.id);output={checks:input.criteria.map((cr:any)=>({criterionId:cr.id,verdict:'passed',explanation:'Inspected the retained artifact independently',evidenceIds:input.evidence.filter((e:any)=>cr.id==='__goal__'||e.criterionIds.includes(cr.id)).map((e:any)=>e.id)}))}}
  }else if(r.role==='worker'){const key=r.activity!.ticketId!,attempt=(attempts.get(key)??0)+1;attempts.set(key,attempt);output=await worker?.(r,attempt)??ready()}
  else output={reply:''}
  return {threadId,turnId,text:JSON.stringify(output)}
 }}
 const open=()=>{h=new Runtime(config,{model,clock:()=>now});hosts.push(h)};open()
 h.scopes.command({action:'scope.put',operationId:'scope',expectedRevision:0,scope:{id:'team',tenantId:'org',name:'Team',managers:[JSON.stringify(['local','alice'])],workerIds:['one','two'],sourceIds:['local'],backendIds:['codex']}})
 h.scopes.command({action:'entry.bind',operationId:'entry',expectedRevision:0,scopeId:'team',sourceId:'local',accountNamespace:'local',nativeId:'test',history:'group'})
 const input=h.receive('local','alice',{id:'request',thread:'test',scope:'test',text:'Continuously build, verify and repair the requested deliverable. Never deploy.',addressed:true}) as any
 const context=()=>{const t=h.store.triggers.get(input.triggerId)!;return h.scopes.context(t,'local:test')!}
 const start=(extra:any={})=>h.goals.command({action:'start',operationId:'start',expectedRevision:0,title:'Verified delivery',objective:'Produce a result whose total is 42. Never deploy.',authorizationQuote:'Continuously build, verify and repair',maxReplans:0,criteria:[{id:'sum',description:'result.json total equals 42',check:{kind:'json_equals',path:'result.json',pointer:'/total',expected:42}}],nodes:[{id:'build',title:'Build',instruction:'Produce result.json',workerId:'one',criterionIds:['sum']}],...extra},context()) as RouterGoal
 return {get h(){return h},root,config,calls,attempts,start,context,advance:(ms:number)=>{now+=ms},goal:()=>h.store.list<RouterGoal>('router-goal')[0]!,rounds:()=>h.store.list<VerificationRound>('goal-verification'),restart:async()=>{hosts.splice(hosts.indexOf(h),1);await h.close();open()}}
}

it('intercepts a false ready report, repairs the same task, and publishes only independently accepted evidence',async()=>{
 const f=fixture((r,n)=>{writeFileSync(join(r.cwd,'result.json'),JSON.stringify({total:n===1?41:42}));return ready(n===1?'Everything is correct: total is 42':'Corrected total is 42')});f.start()
 await until(f,()=>f.rounds().some(r=>r.state==='failed'))
 expect(f.h.store.tickets.list()[0]!.ended).toBeUndefined();expect(f.h.store.deliveries().some(d=>d.text.includes('Everything is correct'))).toBe(false)
 await until(f,()=>f.goal().state==='completed')
 expect(f.h.store.tickets.list()).toHaveLength(1);expect([...f.attempts.values()]).toEqual([2]);expect(f.h.store.list('goal-repair')).toHaveLength(1)
 expect(f.rounds().filter(r=>r.state==='passed')).toHaveLength(2)
 const verifier=f.calls.filter(r=>JSON.parse(r.input).kind==='goal_verification');expect(verifier).toHaveLength(1);expect(verifier[0]!.threadId).toBeUndefined();expect(verifier[0]!.tools!.map(t=>t.name)).toEqual(['goal_evidence'])
})
it('exposes scoped host publication receipts to independent acceptance without trusting tool completion or another task',async()=>{
 const seen:any[]=[]
 const f=fixture(r=>{
  const id=r.activity!.ticketId!;writeFileSync(join(r.cwd,'result.json'),'{"total":42}')
  f.h.store.put('pr-delivery',id+':superagent/owned',{phase:'draft',ticketId:id,sourceId:'local',repository:'owner/repo',number:7,url:'https://github.com/owner/repo/pull/7',sha:'a'.repeat(40),draft:true,confirmedAt:42,secret:'must never be exposed'})
  f.h.store.put('pr-delivery','other:superagent/foreign',{phase:'draft',number:999})
  return ready()
 },async(r,input)=>{
  for(const e of input.evidence){const value:any=await r.onTool!('goal_evidence',{id:e.id},e.id);if(e.kind==='execution'){const envelope=JSON.parse(value.contentItems[0].text);seen.push(JSON.parse(envelope.content))}}
  return {checks:input.criteria.map((cr:any)=>({criterionId:cr.id,verdict:'passed',explanation:'Read the provider receipt retained by the host',evidenceIds:input.evidence.filter((e:any)=>cr.id==='__goal__'||e.criterionIds.includes(cr.id)).map((e:any)=>e.id)}))}
 })
 f.start();await until(f,()=>f.goal().state==='completed')
 expect(seen.length).toBeGreaterThan(0);expect(JSON.stringify(seen)).not.toContain('must never be exposed');expect(JSON.stringify(seen)).not.toContain('999')
 expect(seen[0].repositoryPublications).toEqual([expect.objectContaining({phase:'draft',number:7,head:'a'.repeat(40),draft:true,confirmedAt:42})])
})
it('does not verify or automatically repair unknown repository effects, even after the run becomes idle',()=>{
 const f=fixture(),id='retained-task';f.h.store.put('run',id,{phase:'idle'})
 f.h.store.put('pr-delivery','other:branch',{phase:'uncertain'});expect(f.h.goals.effectsSettled(id)).toBe(true)
 for(const phase of ['pushing','creating','uncertain']){f.h.store.put('pr-delivery',id+':branch',{phase});expect(f.h.goals.effectsSettled(id)).toBe(false)}
 f.h.store.put('pr-delivery',id+':branch',{phase:'draft'});expect(f.h.goals.effectsSettled(id)).toBe(true)
 f.h.store.put('merge-grant','repo:1',{ticketId:id});f.h.store.put('merge-attempt','repo:1',{id:'repo:1',phase:'uncertain'});expect(f.h.goals.effectsSettled(id)).toBe(false)
 f.h.store.put('merge-attempt','repo:1',{id:'repo:1',phase:'merged'});f.h.store.put('review-action','review',{ticketId:id,phase:'pending'});expect(f.h.goals.effectsSettled(id)).toBe(false)
})
it('recovers a failed acceptance and automatic repair across a runtime restart without duplicate effects',async()=>{
 const f=fixture((r,n)=>{writeFileSync(join(r.cwd,'result.json'),JSON.stringify({total:n===1?0:42}));return ready()});f.start()
 await until(f,()=>f.rounds().some(r=>r.state==='failed'));const ticket=f.h.store.tickets.list()[0]!.id
 await f.restart();await until(f,()=>f.goal().state==='completed')
 expect(f.h.store.tickets.list().map(t=>t.id)).toEqual([ticket]);expect(f.h.store.list('goal-repair')).toHaveLength(1)
 expect(f.rounds().filter(r=>r.state==='failed')).toHaveLength(1)
})
it.each(['repair-note','parent','foreign'])('rejects a %s handback without inventing an uncertain execution outcome or accepting the delivery',async reference=>{
 const f=fixture((r,n)=>{
  writeFileSync(join(r.cwd,'result.json'),JSON.stringify({total:n===1?0:42}))
  if(n===1)return ready()
  const input=JSON.parse(r.input),task=f.h.store.tickets.get(r.activity!.ticketId!)!
  const id=reference==='repair-note'?input.inputs[0].id:reference==='parent'?task.origin.triggerId:'router-context:another-task'
  return {...ready('Cannot finish the requested integration in this node'),handbacks:[{triggerId:id,reason:'Router must arrange an integration step'}]}
 });const original=f.start()
 await until(f,()=>f.goal().state==='held')
 const task=f.h.store.tickets.list()[0]!,run=f.h.store.get<any>('run',task.id)
 expect(run.phase).toBe('idle');expect(run.error).toBeUndefined()
 expect(task.assignments.at(-1)?.report).toMatchObject({state:'blocked',summary:expect.stringContaining('Worker handback rejected')})
 expect(task.undelivered).toHaveLength(0);expect(task.ended).toBeUndefined()
 expect(f.goal().nodes![0]?.failure?.kind).toBe('quality');expect(f.goal().contract).toEqual(original.contract)
 expect(f.h.store.list('router-handback')).toHaveLength(0);expect(f.h.store.list('goal-release')).toHaveLength(0)
 expect(f.h.store.list<any>('transcript').some(t=>t.text.includes('Router must arrange an integration step'))).toBe(true)
 await f.restart();expect(f.h.store.get<any>('run',task.id).phase).toBe('idle')
})
it('rechecks changed artifacts instead of accepting a verifier result for an older version',async()=>{
 let release!:()=>void,entered=false,first=true
 const f=fixture(r=>{writeFileSync(join(r.cwd,'result.json'),'{"total":42}');return ready()},async(r,input)=>{
  for(const e of input.evidence)await r.onTool!('goal_evidence',{id:e.id},e.id)
  if(first){first=false;entered=true;await new Promise<void>(resolve=>{release=resolve})}
  return {checks:input.criteria.map((c:any)=>({criterionId:c.id,verdict:'passed',explanation:'Snapshot checked',evidenceIds:input.evidence.map((e:any)=>e.id)}))}
 });f.start();await until(f,()=>entered);writeFileSync(join(f.root,'result.json'),'{"total":0}');release()
 await until(f,()=>f.rounds().some(r=>r.state==='stale'))
 expect(f.goal().state).not.toBe('completed');expect(f.h.store.tickets.list()[0]!.ended).toBeUndefined()
})
it('rejects a verifier verdict which cites evidence it never read',async()=>{
 const f=fixture(r=>{writeFileSync(join(r.cwd,'result.json'),'{"total":42}');return ready()},async(_r,input)=>({checks:input.criteria.map((c:any)=>({criterionId:c.id,verdict:'passed',explanation:'Trust me',evidenceIds:input.evidence.map((e:any)=>e.id)}))}));f.start()
 await until(f,()=>f.goal().state==='held');expect(f.rounds().some(r=>r.error?.includes('did not inspect'))).toBe(true);expect(f.h.store.list('goal-release')).toHaveLength(0)
})
it('holds unresolved work after the configured repair limit',async()=>{
 const f=fixture(r=>{writeFileSync(join(r.cwd,'result.json'),'{"total":0}');return ready('All correct')});f.start({maxRepairs:1})
 await until(f,()=>f.goal().state==='held');expect([...f.attempts.values()]).toEqual([2]);expect(f.goal().reason).toContain('allowance');expect(f.h.store.list('goal-release')).toHaveLength(0)
})
it('checks declared dependencies and lets independent work proceed while another node waits',async()=>{
 const order:string[]=[],f=fixture(r=>{const text=r.input;const stage=text.includes('NODE_A')?'a':text.includes('NODE_B')?'b':'c';order.push(stage);writeFileSync(join(r.cwd,stage+'.txt'),stage);return ready(stage)})
 f.start({criteria:['a','b','c'].map(id=>({id,description:id,check:{kind:'text_contains',path:id+'.txt',text:id}})),nodes:[{id:'a',title:'A',instruction:'NODE_A',workerId:'one',criterionIds:['a']},{id:'b',title:'B',instruction:'NODE_B',workerId:'two',criterionIds:['b']},{id:'c',title:'C',instruction:'NODE_C',workerId:'one',dependsOn:['a','b'],criterionIds:['c']}]})
 await until(f,()=>f.goal().state==='completed');expect(order.slice(0,2).sort()).toEqual(['a','b']);expect(order[2]).toBe('c');expect(f.goal().taskIds).toHaveLength(3)
})
it('rejects missing dependencies, cycles, uncovered criteria and out-of-scope Workers before dispatch',()=>{
 for(const nodes of [[{id:'a',dependsOn:['missing'],workerId:'one',criterionIds:['sum']}],[{id:'a',dependsOn:['b'],workerId:'one',criterionIds:['sum']},{id:'b',dependsOn:['a'],workerId:'two',criterionIds:['sum']}],[{id:'a',dependsOn:[],workerId:'one',criterionIds:['other']}],[{id:'a',dependsOn:[],workerId:'outside',criterionIds:['sum']}]] ){
  const f=fixture();expect(()=>f.start({nodes:nodes.map(n=>({...n,title:n.id,instruction:'Work'}))})).toThrow();expect(f.h.store.tickets.list()).toHaveLength(0)
 }
})
it('does not read evidence through symlinks or parent paths',async()=>{
 for(const path of ['../outside.txt','alias.txt']){
  const f=fixture(r=>{writeFileSync(join(r.cwd,'private.txt'),'secret');symlinkSync('private.txt',join(r.cwd,'alias.txt'));return ready()});f.start({criteria:[{id:'sum',description:'Evidence',check:{kind:'file_exists',path}}]})
  await until(f,()=>f.goal().state==='held');expect(f.rounds()).toHaveLength(0);expect(f.goal().reason).toMatch(/workspace|symlink/)
 }
})
it('classifies recoverable provider faults separately from uncertain effects and environment problems',()=>{
 expect(classifyGoalFailure('HTTP 503 temporarily unavailable',1000,0)).toMatchObject({kind:'transient',retryAt:121000})
 expect(classifyGoalFailure('HTTP 429 quota exceeded',1000,0)).toMatchObject({kind:'quota',retryAt:1801000})
 expect(classifyGoalFailure('Execution uncertain after HTTP 503',1000,0).kind).toBe('uncertain')
 expect(classifyGoalFailure('Invalid credentials',1000,0).kind).toBe('environment')
})
it('automatically retries a settled transient failure after its durable recovery time',async()=>{
 const f=fixture((r,n)=>{if(n===1)return {...ready(),state:'blocked',summary:'HTTP 503 temporarily unavailable; no action performed',reply:''};writeFileSync(join(r.cwd,'result.json'),'{"total":42}');return ready()});f.start()
 await until(f,()=>!!f.goal().nodes![0]!.retryAt);const ticket=f.goal().taskIds[0]
 await f.restart();f.advance(121000);await until(f,()=>f.goal().state==='completed')
 expect(f.goal().taskIds).toEqual([ticket]);expect(f.goal().nodes![0]!.recoveries).toBe(1)
})
it('does not retry an uncertain outcome as a transient provider failure',async()=>{
 const f=fixture(()=>({...ready(),state:'blocked',summary:'Execution uncertain after HTTP 503',reply:''}));f.start();await until(f,()=>f.goal().state==='held')
 f.advance(99999999);for(let i=0;i<4;i++)await f.h.tick();expect([...f.attempts.values()]).toEqual([1]);expect(f.goal().nodes![0]!.failure?.kind).toBe('uncertain')
})
it('keeps paused acceptance results unpublished until an explicit resume',async()=>{
 let release!:()=>void,entered=false
 const f=fixture(r=>{writeFileSync(join(r.cwd,'result.json'),'{"total":42}');return ready()},async(r,input)=>{for(const e of input.evidence)await r.onTool!('goal_evidence',{id:e.id},e.id);entered=true;await new Promise<void>(resolve=>{release=resolve});return {checks:input.criteria.map((c:any)=>({criterionId:c.id,verdict:'passed',explanation:'Checked',evidenceIds:input.evidence.map((e:any)=>e.id)}))}})
 f.start();await until(f,()=>entered);let g=f.goal();f.h.goals.command({action:'pause',id:g.id,operationId:'pause',expectedRevision:g.revision},f.context());release()
 await until(f,()=>f.rounds().some(r=>!r.nodeId&&r.state==='passed'));expect(f.h.store.list('goal-release')).toHaveLength(0)
 g=f.goal();f.h.goals.command({action:'resume',id:g.id,operationId:'resume',expectedRevision:g.revision},f.context());await until(f,()=>f.goal().state==='completed')
})

it('requires a passed semantic verdict to inspect every declared artifact, not just the report',async()=>{
 const f=fixture(r=>{writeFileSync(join(r.cwd,'result.json'),'{"total":0}');return ready('Total 42')},async(r,input)=>{
  const report=input.evidence.find((e:any)=>e.kind==='report');await r.onTool!('goal_evidence',{id:report.id},'read-report')
  return {checks:input.criteria.map((c:any)=>({criterionId:c.id,verdict:'passed',explanation:'Trusted report',evidenceIds:[report.id]}))}
 });f.start({criteria:[{id:'sum',description:'The total is 42',files:['result.json']}]});await until(f,()=>f.goal().state==='held')
 expect(f.rounds().some(r=>r.error?.includes('skipped required artifact'))).toBe(true);expect(f.h.store.list('goal-release')).toHaveLength(0)
})
it('retries an errored final verifier after explicit resume',async()=>{
 let broken=true
 const f=fixture(r=>{writeFileSync(join(r.cwd,'result.json'),'{"total":42}');return ready()},async(r,input)=>{
  if(broken)throw Error('Malformed verifier response')
  for(const e of input.evidence)await r.onTool!('goal_evidence',{id:e.id},e.id)
  return {checks:input.criteria.map((c:any)=>({criterionId:c.id,verdict:'passed',explanation:'Checked after recovery',evidenceIds:input.evidence.map((e:any)=>e.id)}))}
 });f.start();await until(f,()=>f.goal().state==='held');broken=false
 const g=f.goal();f.h.goals.command({action:'resume',id:g.id,operationId:'resume-error',expectedRevision:g.revision},f.context())
 await until(f,()=>f.goal().state==='completed');expect(f.rounds().find(r=>!r.nodeId)?.attempts).toBe(2)
})
it('refreshes an accepted dependent after overall acceptance sends its prerequisite back for repair',async()=>{
 let finalChecks=0
 const f=fixture((r,n)=>{const key=r.input.includes('NODE_A')?'a':'b';writeFileSync(join(r.cwd,key+'.txt'),key+'-'+n);return ready(key)},async(r,input)=>{
  for(const e of input.evidence)await r.onTool!('goal_evidence',{id:e.id},e.id)
  const firstFinal=input.criteria.some((c:any)=>c.id==='__goal__')&&++finalChecks===1
  return {checks:input.criteria.map((c:any)=>({criterionId:c.id,verdict:firstFinal?'failed':'passed',explanation:firstFinal?'Upstream integration requires repair':'Checked refreshed outputs',evidenceIds:input.evidence.filter((e:any)=>c.id==='__goal__'||e.criterionIds.includes(c.id)).map((e:any)=>e.id)}))}
 });f.start({criteria:[{id:'a',description:'A integrates correctly with B',files:['a.txt']},{id:'b',description:'B',check:{kind:'text_contains',path:'b.txt',text:'b'}}],nodes:[{id:'a',title:'A',instruction:'NODE_A',workerId:'one',criterionIds:['a']},{id:'b',title:'B',instruction:'NODE_B',workerId:'two',dependsOn:['a'],criterionIds:['b']}]})
 await until(f,()=>f.goal().state==='completed')
 expect(f.goal().nodes!.map(n=>n.repairs)).toEqual([1,1]);expect([...f.attempts.values()]).toEqual([2,2]);expect(readFileSync(join(f.root,'b.txt'),'utf8')).toBe('b-2')
 expect(f.rounds().some(r=>!r.nodeId&&r.state==='failed'&&r.checks.some(c=>c.criterionId==='a'&&c.verdict==='failed'))).toBe(true)
})
it('holds legacy ended tasks which have no retained acceptance proposal instead of waiting forever',async()=>{
 const f=fixture(r=>{writeFileSync(join(r.cwd,'result.json'),'{"total":42}');return ready()});f.start()
 await until(f,()=>f.h.store.list('goal-delivery').length>0)
 const ticket=f.goal().taskIds[0]!,proposal=f.h.store.get<any>('goal-delivery',ticket)!
 f.h.acceptGoalDelivery(proposal);f.h.store.db.prepare("DELETE FROM records WHERE kind='goal-delivery' AND id=?").run(ticket)
 await until(f,()=>f.goal().state==='held');expect(f.goal().reason).toContain('Legacy task ended')
})

it('tracks source documents through dependent tasks and verifier sessions so revocation invalidates both',async()=>{
 const f=fixture(r=>{writeFileSync(join(r.cwd,r.input.includes('NODE_B')?'b.txt':'a.txt'),'evidence');return ready()})
 const doc=f.h.knowledge.command({action:'put',operationId:'doc',expectedRevision:0,kind:'document',title:'Requirement',content:'Retain evidence for review'},f.context())
 f.start({criteria:[{id:'a',description:'A',documents:[doc.id],check:{kind:'file_exists',path:'a.txt'}},{id:'b',description:'B',check:{kind:'file_exists',path:'b.txt'}}],nodes:[{id:'a',title:'A',instruction:'NODE_A',workerId:'one',criterionIds:['a']},{id:'b',title:'B',instruction:'NODE_B',workerId:'two',dependsOn:['a'],criterionIds:['b']}]})
 await until(f,()=>f.goal().state==='completed')
 const child=f.h.store.get<any>('task-context',f.goal().nodes![1]!.ticketId!)!.manifest
 const verification=f.calls.find(r=>JSON.parse(r.input).kind==='goal_verification')!,manifest=f.h.store.get<any>('context-manifest',verification.contextId!)!
 expect(child.knowledge).toContainEqual({documentId:doc.id,revision:1});expect(manifest.knowledge).toContainEqual({documentId:doc.id,revision:1})
 f.h.knowledge.command({action:'delete',id:doc.id,operationId:'delete',expectedRevision:1},f.context())
 expect(()=>f.h.memory.validate(child)).toThrow();expect(()=>f.h.memory.validate(manifest)).toThrow()
})
it('recovers a transient final verification failure with durable backoff after restart',async()=>{
 const f=fixture(r=>{writeFileSync(join(r.cwd,'result.json'),'{"total":42}');return ready()})
 f.h.runGoalVerifier=async()=>{throw Error('HTTP 503 temporarily unavailable after backend retries')}
 f.start();await until(f,()=>!!f.goal().recovery?.retryAt);expect(f.h.store.list('goal-release')).toHaveLength(0)
 await f.restart();f.advance(121000);await until(f,()=>f.goal().state==='completed');expect(f.rounds().find(r=>!r.nodeId)?.attempts).toBe(2)
})

it('exposes host command receipts and launch restrictions to the independent final verifier',async()=>{
 const jobId='12345678-1234-1234-1234-123456789abc',command='node -e "if (21*2!==42) process.exit(1)"'
 let inspected=false
 const f=fixture(r=>{
  writeFileSync(join(r.cwd,'result.json'),'{"total":42}')
  const task=f.h.store.tickets.get(r.activity!.ticketId!)!,assignmentId=task.assignments.at(-1)!.id
  f.h.store.put('work',jobId,{id:jobId,ticketId:task.id,assignmentId,cwd:r.cwd,sandbox:'workspace-write',depth:0,kind:'shell',command,state:'completed',exitCode:0,notify:'collected',createdAt:1,endedAt:2})
  writeFileSync(join(f.h.work.directory,jobId+'.spec.json'),JSON.stringify({id:jobId,cwd:r.cwd,command,sandboxDriver:'seatbelt',sandbox:'workspace-write',network:false,privateState:'must-not-be-exposed'}))
  writeFileSync(join(f.h.work.directory,jobId+'.output'),'calculation verified: 42\n')
  return ready()
 },async(r,input)=>{
  for(const e of input.evidence){const result=await r.onTool!('goal_evidence',{id:e.id},e.id);if(e.kind==='execution'){
   const envelope=JSON.parse((result as any).contentItems[0].text),ledger=JSON.parse(envelope.content)
   expect(ledger.jobs[0]).toMatchObject({command,exitCode:0,recordedPolicy:{network:false,sandboxDriver:'seatbelt'}})
   expect(ledger.jobs[0].output).toMatchObject({text:'calculation verified: 42\n',complete:true,hash:expect.any(String)})
   expect(envelope.content).not.toContain('must-not-be-exposed');inspected=true
  }}
  return {checks:input.criteria.map((c:any)=>({criterionId:c.id,verdict:'passed',explanation:'Checked host receipts and artifact',evidenceIds:input.evidence.map((e:any)=>e.id)}))}
 });f.start();await until(f,()=>f.goal().state==='completed');expect(inspected).toBe(true)
})
it('marks truncated command output incomplete and never follows an output symlink',()=>{
 const f=fixture(),id='12345678-1234-1234-1234-123456789abc'
 f.h.store.put('work',id,{id,ticketId:'bounded-output',kind:'shell',state:'completed',createdAt:1})
 const log=join(f.h.work.directory,id+'.output')
 writeFileSync(log,'a'.repeat(8001));let ledger=JSON.parse((f.h.verification as any).execution('bounded-output'))
 expect(ledger.jobs[0].output.complete).toBe(false);expect(ledger.jobs[0].output.text).toHaveLength(8000)
 rmSync(log);const secret=join(f.root,'private');writeFileSync(secret,'DO-NOT-READ-OTHER-FILE');symlinkSync(secret,log)
 ledger=JSON.parse((f.h.verification as any).execution('bounded-output'))
 expect(ledger.jobs[0].output.complete).toBe(false);expect(JSON.stringify(ledger)).not.toContain('DO-NOT-READ-OTHER-FILE')
})
it('omits quarantined execution history from a rebuilt task evidence ledger',()=>{
 const f=fixture(),ticket='quarantined-task'
 f.h.store.put('task-continuation',ticket,{ticketId:ticket,priorJobs:['old-job']})
 f.h.store.put('work','old-job',{id:'old-job',ticketId:ticket,command:'OLD_PRIVATE_COMMAND',kind:'shell',state:'completed'})
 const ledger=JSON.parse((f.h.verification as any).execution(ticket))
 expect(ledger.complete).toBe(false);expect(ledger.jobs).toEqual([]);expect(JSON.stringify(ledger)).not.toContain('OLD_PRIVATE_COMMAND')
})
it('redacts invalid goal node instructions and refuses to reuse them under fresh authority',()=>{
 const f=fixture(),doc=f.h.knowledge.command({action:'put',operationId:'doc',expectedRevision:0,kind:'document',title:'Private input',content:'Private source detail'},f.context())
 const packet=f.h.memory.build(f.context(),{request:'Continue'},'test');packet.manifest.knowledge=[{documentId:doc.id,revision:1}];f.h.store.put('context-manifest',packet.manifest.id,packet.manifest)
 const g=f.start({nodes:[{id:'build',title:'Derived task',instruction:'Private source detail',workerId:'one',criterionIds:['sum']}]});f.h.store.put('router-goal',g.id,{...g,contextIds:[packet.manifest.id]})
 f.h.knowledge.command({action:'delete',id:doc.id,operationId:'delete',expectedRevision:1},f.context())
 expect(f.h.goals.list(f.context())[0]?.nodes).toBeUndefined()
 expect(()=>f.h.goals.command({action:'resume',id:g.id,operationId:'resume',expectedRevision:g.revision,title:'Fresh task',objective:'Fresh objective',criteria:[{id:'sum',description:'New requirement'}],authorizationQuote:'Continuously build'},f.context())).toThrow('new explicitly authorized goal')
})
it('automatically rechecks an invalid verifier protocol without rerunning the Worker or relaxing criteria',async()=>{
 let tries=0
 const f=fixture(r=>{writeFileSync(join(r.cwd,'result.json'),'{"total":42}');return ready()},async(r,input)=>{
  for(const e of input.evidence)await r.onTool!('goal_evidence',{id:e.id},e.id)
  const checks=input.criteria.map((c:any)=>({criterionId:c.id,verdict:'passed',explanation:'Inspected',evidenceIds:input.evidence.map((e:any)=>e.id)}))
  return {checks:++tries===1?[...checks,{...checks[0],criterionId:'extra'}]:checks}
 });f.start();await until(f,()=>f.goal().state==='completed')
 expect(tries).toBe(2);expect([...f.attempts.values()]).toEqual([1]);expect(f.h.store.list('goal-repair')).toHaveLength(0)
 expect(f.rounds().find(r=>!r.nodeId)?.attempts).toBe(2);expect(f.h.store.list('goal-release')).toHaveLength(1)
})
it('delivers complete Unicode evidence in pages below the native and API tool receipt limit',async()=>{
 const content='引号"\\\n😀'.repeat(2000);let pages=0
 const f=fixture(r=>{writeFileSync(join(r.cwd,'result.txt'),content);return ready()},async(r,input)=>{
  for(const e of input.evidence){let offset:number|null=0,joined='';do{
   const result=await r.onTool!('goal_evidence',{id:e.id,offset},e.id+':'+offset)
   expect(protocolBytes(result)).toBeLessThanOrEqual(r.contextBudget!.toolReserveBytes)
   const page=JSON.parse((result as any).contentItems[0].text);joined+=page.content;offset=page.nextOffset;pages++
  }while(offset!==null);if(e.key==='result.txt')expect(joined).toBe(content)}
  return {checks:input.criteria.map((c:any)=>({criterionId:c.id,verdict:'passed',explanation:'Read all pages',evidenceIds:input.evidence.filter((e:any)=>c.id==='__goal__'||e.criterionIds.includes(c.id)).map((e:any)=>e.id)}))}
 });f.start({criteria:[{id:'sum',description:'Inspect all Unicode content',files:['result.txt']}]});await until(f,()=>f.goal().state==='completed');expect(pages).toBeGreaterThan(10)
})
it('rejects skipped or partial evidence pages without publishing or repeating the Worker',async()=>{
 const f=fixture(r=>{writeFileSync(join(r.cwd,'result.txt'),'large evidence '.repeat(2000));return ready()},async(r,input)=>{
  for(const e of input.evidence){const result:any=await r.onTool!('goal_evidence',{id:e.id},e.id),page=JSON.parse(result.contentItems[0].text)
   if(page.nextOffset!==null)await expect(r.onTool!('goal_evidence',{id:e.id,offset:page.totalCharacters},'skip')).rejects.toThrow('without gaps')
  }
  return {checks:input.criteria.map((c:any)=>({criterionId:c.id,verdict:'passed',explanation:'Only the first page',evidenceIds:input.evidence.map((e:any)=>e.id)}))}
 });f.start({criteria:[{id:'sum',description:'Read the full file',files:['result.txt']}]});await until(f,()=>f.goal().state==='held')
 expect(f.h.store.list('goal-release')).toHaveLength(0);expect([...f.attempts.values()]).toEqual([1]);expect(f.rounds()[0]?.attempts).toBe(3)
})

it('retries a truncated overall evidence review without repeating work or changing acceptance',async()=>{
 let tries=0
 const f=fixture(r=>{writeFileSync(join(r.cwd,'result.json'),'{"total":42}');return ready()},async(r,input)=>{
  for(const e of input.evidence){let offset:number|null=0;do{const result:any=await r.onTool!('goal_evidence',{id:e.id,offset},e.id+':'+offset);offset=JSON.parse(result.contentItems[0].text).nextOffset}while(offset!==null)}
  const truncated=++tries===1
  return {checks:input.criteria.map((c:any)=>({criterionId:c.id,verdict:truncated?'insufficient':'passed',explanation:truncated?'Combined evidence output was truncated':'Inspected complete evidence',evidenceIds:input.evidence.filter((e:any)=>c.id==='__goal__'||e.criterionIds.includes(c.id)).map((e:any)=>e.id)}))}
 })
 const original=f.start();await until(f,()=>f.goal().state==='completed')
 expect(tries).toBe(2);expect([...f.attempts.values()]).toEqual([1]);expect(f.h.store.list('goal-repair')).toHaveLength(0)
 expect(f.goal().contract).toEqual(original.contract);expect(f.rounds().find(r=>!r.nodeId)?.attempts).toBe(2)
 expect(f.h.store.list<any>('goal-verification-attempt').some(a=>a.state==='errored'&&a.checks.some((c:any)=>c.verdict==='insufficient'))).toBe(true)
 expect(f.h.goals.command({action:'inspect',id:f.goal().id},f.context()).attempts).toHaveLength(1)
})

it('retains insufficient verification after bounded retries instead of releasing or looping',async()=>{
 let tries=0
 const f=fixture(r=>{writeFileSync(join(r.cwd,'result.json'),'{"total":42}');return ready()},async(r,input)=>{
  tries++;for(const e of input.evidence)await r.onTool!('goal_evidence',{id:e.id},e.id)
  return {checks:input.criteria.map((c:any)=>({criterionId:c.id,verdict:'insufficient',explanation:'The evidence output was truncated',evidenceIds:input.evidence.filter((e:any)=>c.id==='__goal__'||e.criterionIds.includes(c.id)).map((e:any)=>e.id)}))}
 })
 f.start({maxRepairs:0,criteria:[{id:'sum',description:'Review the result',files:['result.json']}]})
 await until(f,()=>f.goal().state==='held')
 expect(tries).toBe(3);expect(f.rounds()[0]).toMatchObject({state:'insufficient',attempts:3})
 expect(f.h.store.list('goal-verification-attempt')).toHaveLength(2);expect(f.h.store.list('goal-release')).toHaveLength(0)
 expect([...f.attempts.values()]).toEqual([1])
})

it('retries an incomplete evidence read before repairing or replanning the work',async()=>{
 let tries=0
 const f=fixture(r=>{writeFileSync(join(r.cwd,'result.json'),'full evidence');return ready()},async(r,input)=>{
  tries++
  const evidence=input.evidence.filter((e:any)=>tries!==1||e.kind!=='execution')
  for(const e of evidence)await r.onTool!('goal_evidence',{id:e.id},e.id)
  return {checks:input.criteria.map((c:any)=>({criterionId:c.id,verdict:tries===1?'insufficient':'passed',explanation:tries===1?'Execution records were not inspected':'All evidence inspected',evidenceIds:evidence.filter((e:any)=>c.id==='__goal__'||e.criterionIds.includes(c.id)).map((e:any)=>e.id)}))}
 })
 const original=f.start({maxRepairs:0,criteria:[{id:'sum',description:'Inspect the artifact and execution',files:['result.json']}]})
 await until(f,()=>f.goal().state==='completed')
 expect(tries).toBe(3);expect(f.rounds().find(r=>r.nodeId)?.attempts).toBe(2)
 expect([...f.attempts.values()]).toEqual([1]);expect(f.h.store.list('goal-repair')).toHaveLength(0);expect(f.goal().contract).toEqual(original.contract)
})

it('does not retry genuine insufficient evidence after all available evidence was read',async()=>{
 let tries=0
 const f=fixture(r=>{writeFileSync(join(r.cwd,'result.json'),'inconclusive');return ready()},async(r,input)=>{
  tries++;for(const e of input.evidence)await r.onTool!('goal_evidence',{id:e.id},e.id)
  return {checks:input.criteria.map((c:any)=>({criterionId:c.id,verdict:'insufficient',explanation:'The inspected artifact does not establish the claim',evidenceIds:input.evidence.filter((e:any)=>c.id==='__goal__'||e.criterionIds.includes(c.id)).map((e:any)=>e.id)}))}
 })
 f.start({maxRepairs:0,criteria:[{id:'sum',description:'Evidence proves the claim',files:['result.json']}]})
 await until(f,()=>f.goal().state==='held')
 expect(tries).toBe(1);expect(f.rounds()[0]).toMatchObject({state:'insufficient',attempts:1});expect(f.h.store.list('goal-release')).toHaveLength(0)
})

it('does not hide a failed criterion when another has unread evidence',async()=>{
 let tries=0
 const f=fixture(r=>{writeFileSync(join(r.cwd,'result.json'),'wrong');return ready()},async(r,input)=>{
  tries++;const evidence=input.evidence.filter((e:any)=>e.kind!=='execution')
  for(const e of evidence)await r.onTool!('goal_evidence',{id:e.id},e.id)
  return {checks:input.criteria.map((c:any)=>({criterionId:c.id,verdict:c.id==='first'?'failed':'insufficient',explanation:'The result is incorrect or evidence was not read',evidenceIds:evidence.filter((e:any)=>e.criterionIds.includes(c.id)).map((e:any)=>e.id)}))}
 })
 f.start({maxRepairs:0,criteria:[{id:'first',description:'First claim',files:['result.json']},{id:'second',description:'Second claim',files:['result.json']}],nodes:[{id:'build',title:'Build',instruction:'Produce result',workerId:'one',criterionIds:['first','second']}]})
 await until(f,()=>f.goal().state==='held')
 expect(tries).toBe(1);expect(f.rounds()[0]).toMatchObject({state:'failed',attempts:1});expect(f.h.store.list('goal-release')).toHaveLength(0)
})

it('resumes an interrupted read-only verification after restart without spending another attempt',async()=>{
 let tries=0,interrupted=false
 const f=fixture(r=>{writeFileSync(join(r.cwd,'result.json'),'{"total":42}');return ready()},async(r,input)=>{
  tries++
  if(tries===2){interrupted=true;await new Promise<void>((_resolve,reject)=>r.signal!.addEventListener('abort',()=>reject(Error('Host stopped')),{once:true}))}
  for(const e of input.evidence){let offset:number|null=0;do{const result:any=await r.onTool!('goal_evidence',{id:e.id,offset},e.id+':'+offset);offset=JSON.parse(result.contentItems[0].text).nextOffset}while(offset!==null)}
  return {checks:input.criteria.map((c:any)=>({criterionId:c.id,verdict:tries===1?'insufficient':'passed',explanation:tries===1?'Combined evidence output was truncated':'Inspected every page',evidenceIds:input.evidence.filter((e:any)=>c.id==='__goal__'||e.criterionIds.includes(c.id)).map((e:any)=>e.id)}))}
 })
 f.start();await until(f,()=>interrupted)
 expect(f.h.store.list('goal-verification-attempt')).toHaveLength(1)
 await f.restart();await until(f,()=>f.goal().state==='completed')
 expect(tries).toBe(3);expect(f.rounds().find(r=>!r.nodeId)?.attempts).toBe(2)
 expect(f.h.store.list('goal-verification-attempt')).toHaveLength(1);expect([...f.attempts.values()]).toEqual([1]);expect(f.h.store.list('goal-release')).toHaveLength(1)
})
