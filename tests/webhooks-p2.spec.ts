import {it,expect,afterEach} from 'vitest'
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createServer,type IncomingMessage,type ServerResponse} from 'node:http'
import {createHmac,randomBytes} from 'node:crypto'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
import type {Model} from '../src/model.ts'
import type {RouterGoal} from '../src/router-goals.ts'
import {serveWebhooks} from '../src/webhook-http.ts'
import {serve} from '../src/server.ts'
import {callbackURL,publicAddress,secretFromEnv,signWebhook,verifyWebhook} from '../src/webhook-protocol.ts'
import {backupState,verifyBackup,restoreState} from '../src/backup.ts'
import {prepareManagedFiles,recoverManagedFiles,managedFiles} from '../src/managed-config.ts'
import {existsSync} from 'node:fs'

const cleanups:(()=>Promise<void>)[]=[]
afterEach(async()=>{for(const cleanup of cleanups.splice(0).reverse())await cleanup()})
async function receiver(handler:(req:IncomingMessage,res:ServerResponse)=>void){const server=createServer(handler);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+(server.address() as any).port;cleanups.push(async()=>{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()))});return url}
function fixture(url='https://example.com/callback',wait=false,failFirst=false,replan=false){
 const root=mkdtempSync(join(tmpdir(),'webhook-test-')),suffix=randomBytes(5).toString('hex'),inEnv='WH_IN_'+suffix,outEnv='WH_OUT_'+suffix
 process.env[inEnv]='whsec_'+randomBytes(32).toString('base64');process.env[outEnv]='whsec_'+randomBytes(32).toString('base64')
 let now=Date.now(),count=0,workerCalls=0,h:Runtime,closed=false
 const config=configSchema.parse({stateDir:join(root,'state'),webhooks:{port:0,loopbackCallbackOrigins:url.startsWith('http:')?[new URL(url).origin]:[]},work:{sandboxDriver:'disabled'},execution:{router:{mode:'host'},management:{enabled:true,maxWorkers:1},workers:[{id:'one',backend:'codex'}]},sources:[{id:'local',kind:'local',cwd:root,sandbox:'workspace-write',workspace:{mode:'source'},allowedActors:['alice']}]})
 const model:Model={async run(r){const input=JSON.parse(r.input);let output:any={reply:''}
  if(input.kind==='goal_replanning'||input.kind==='goal_plan_review'){
   for(const e of input.evidence)await r.onTool!('goal_evidence',{id:e.id},'read-'+e.id)
   const evidenceIds=input.evidence.map((e:any)=>e.id)
   output=input.kind==='goal_replanning'?{reason:'Recompute from the original accepted contract',evidenceIds,changes:[{id:'compute',instruction:'Write result.json with total 42 after checking retained release evidence',dependsOn:[]}],additions:[]}:{approved:true,explanation:'Same original goal, scope and acceptance; retained release remains required',evidenceIds}
  }else if(input.kind==='goal_verification'){
   for(const e of input.evidence)await r.onTool!('goal_evidence',{id:e.id},'read-'+e.id)
   output={checks:input.criteria.map((c:any)=>({criterionId:c.id,verdict:'passed',explanation:'Checked all retained evidence',evidenceIds:input.evidence.filter((e:any)=>c.id==='__goal__'||e.criterionIds.includes(c.id)).map((e:any)=>e.id)}))}
  }else if(r.role==='worker'){workerCalls++;if(wait){const result=await r.onTool!('superagent_event',{action:'wait',ruleId:'release',requestId:'release-wait'},'event-wait');const data=JSON.parse((result.contentItems[0] as any).text);if(data.state==='waiting'){const threadId='wait-thread';r.onThread?.(threadId);r.onTurn?.('wait-turn');return {threadId,turnId:'wait-turn',text:JSON.stringify({state:'waiting',summary:'Waiting for signed external release',reply:'',question:null,askedBy:null,handbacks:[]})}}}writeFileSync(join(r.cwd,'result.json'),JSON.stringify({total:failFirst&&workerCalls===2?41:42}));output={state:'ready',summary:'All correct, total 42',reply:'All correct',question:null,askedBy:null,handbacks:[]}}
  const threadId=r.threadId??'thread-'+(++count),turnId='turn-'+(++count);r.onThread?.(threadId);r.onTurn?.(turnId);return {threadId,turnId,text:JSON.stringify(output)}
 }}
 const open=()=>{h=new Runtime(config,{model,clock:()=>now});closed=false};open()
 cleanups.push(async()=>{if(!closed)await h.close();rmSync(root,{recursive:true,force:true});delete process.env[inEnv];delete process.env[outEnv]})
 h!.scopes.command({action:'scope.put',operationId:'scope',expectedRevision:0,scope:{id:'team',tenantId:'test',name:'Team',managers:[JSON.stringify(['local','alice'])],workerIds:['one'],sourceIds:['local'],backendIds:['codex']}})
 h!.scopes.command({action:'entry.bind',operationId:'entry',expectedRevision:0,scopeId:'team',sourceId:'local',accountNamespace:'local',nativeId:'test',history:'group'})
 h!.receive('local','alice',{id:'approval',thread:'test',scope:'test',text:'Authorize this event automation to compute and verify the requested total. Never deploy.',addressed:true})
 const spec={protocolVersion:2,continuations:wait?[{id:'release',nodeId:'compute',eventType:'test.release',correlationParameter:'batch',timeoutSeconds:120,earlyEventSeconds:180}]:[],operationId:'approve',triggerId:'local:approval',authorizationQuote:'Authorize this event automation',namespace:'test-events',eventSource:'https://producer.example/events',eventTypes:['test.request'],secretEnvs:[inEnv],parameters:{batch:{type:'string',maxLength:50}},template:{title:'Compute',objective:'Write result.json whose total is 42. Never deploy.',criteria:[{id:'total',description:'Total is 42',check:{kind:'json_equals',path:'result.json',pointer:'/total',expected:42}}],nodes:[{id:'compute',title:'Compute',instruction:'Write result.json for the event batch',workerId:'one',criterionIds:['total']}],maxRepairs:replan?0:2,maxReplans:replan?1:0},expiresAt:now+3600000,maxEvents:100,callback:{url,secretEnv:outEnv,idempotent:true,events:['goal.completed'],maxAttempts:4}}
 const grant=h!.webhooks.create(spec)
 const event=(id='event-1')=>({specversion:'1.0',id,source:spec.eventSource,type:'test.request',data:{batch:'batch-1'}})
 const signed=(value:any=event(),transportId='transport-1')=>{const body=Buffer.from(JSON.stringify(value)),timestamp=String(Math.floor(now/1000));return {body,headers:{'content-type':'application/cloudevents+json','webhook-id':transportId,'webhook-timestamp':timestamp,'webhook-signature':signWebhook(secretFromEnv(inEnv),transportId,timestamp,body)}}}
 const receive=(value:any=event())=>{const s=signed(value);return h.webhooks.receive(grant.id,s.headers,s.body)}
 return {get h(){return h!},root,config,spec,grant,event,signed,receive,inEnv,outEnv,advance:(ms=10000)=>{now+=ms},get workerCalls(){return workerCalls},restart:async()=>{await h.close();closed=true;open()},offline:async(action:()=>Promise<unknown>)=>{await h.close();closed=true;try{return await action()}finally{open()}},goal:()=>h.store.list<RouterGoal>('router-goal')[0]!}
}
async function until(f:ReturnType<typeof fixture>,predicate:()=>boolean){for(let n=0;n<1200;n++){await f.h.tick();await new Promise(r=>setTimeout(r,3));if(predicate())return}throw Error('Not settled '+JSON.stringify({webhook:f.h.webhooks.snapshot(),goals:f.h.store.list('router-goal'),jobs:f.h.store.db.prepare('SELECT id,state,error FROM jobs').all()}))}


function eventReceipt(f:ReturnType<typeof fixture>,id='release-1'){return {...f.event(id),type:'test.release'}}
it('waits durably, resumes the same assignment exactly once after restart, and exposes Watchdog waiting evidence',async()=>{
 const f=fixture(undefined,true);f.receive();await until(f,()=>!!f.h.webhooks.continuations.pending(f.goal()?.taskIds[0]??''))
 const wait=f.h.webhooks.continuations.list()[0]!,target=f.h.watchdog.snapshot(true).targets[0]!
 expect(target.waiting).toBe('external_event');expect(target.notBefore).toBe(wait.deadline)
 expect(()=>f.h.watchdog.accept({id:'wrong-recovery',targetId:target.id,fence:target.fence,judgment:{verdict:'stalled',reason:'must not restart a legitimate wait',evidenceIds:['external-event']}})).toThrow('waiting')
 await until(f,()=>f.h.store.get<any>('run',wait.ticketId)?.phase==='idle');await f.restart()
 f.receive(eventReceipt(f));f.receive(eventReceipt(f));await until(f,()=>f.goal().state==='completed')
 expect(f.h.webhooks.continuations.list()[0]?.assignmentId).toBe(wait.assignmentId)
 expect(f.h.webhooks.receipts().filter(r=>r.state==='consumed')).toHaveLength(1)
 expect(f.h.store.tickets.get(wait.ticketId)?.inputs.filter(i=>i.kind==='note'&&i.text?.includes('external_event'))).toHaveLength(1)
 expect(f.h.store.list('router-goal')).toHaveLength(1)
})
it('accepts early events before the start and does not let them starve dispatch',async()=>{
 const f=fixture(undefined,true);f.receive(eventReceipt(f));f.receive();await f.restart();await until(f,()=>f.goal()?.state==='completed')
 expect(f.h.webhooks.receipts().filter(r=>r.state==='consumed')).toHaveLength(1);expect(f.h.store.list('router-goal')).toHaveLength(1)
})
it('retains a paused wait without waking it and rejects late events after cancellation',async()=>{
 const f=fixture(undefined,true);f.receive();await until(f,()=>!!f.h.webhooks.continuations.list().length&&f.h.store.get<any>('run',f.goal().taskIds[0]!)?.phase==='idle')
 f.h.webhooks.goalControl({id:f.goal().id,action:'pause',expectedRevision:f.goal().revision,operationId:'pause'});f.receive(eventReceipt(f));f.h.webhooks.reconcile(true)
 expect(f.h.webhooks.continuations.list()[0]?.state).toBe('waiting')
 f.h.webhooks.goalControl({id:f.goal().id,action:'cancel',expectedRevision:f.goal().revision,operationId:'cancel'});await f.restart();f.h.webhooks.reconcile(true)
 expect(f.h.webhooks.continuations.list()[0]?.state).toBe('stale');expect(f.h.webhooks.receipts().find(r=>r.event.type==='test.release')?.state).toBe('ignored');expect(f.workerCalls).toBe(1)
})
it('resumes a paused goal with queued evidence and preserves original contract',async()=>{
 const f=fixture(undefined,true);f.receive();await until(f,()=>!!f.h.webhooks.continuations.list().length&&f.h.store.get<any>('run',f.goal().taskIds[0]!)?.phase==='idle');const contract=JSON.stringify(f.goal().contract)
 f.h.webhooks.goalControl({id:f.goal().id,action:'pause',expectedRevision:f.goal().revision,operationId:'pause'});f.receive(eventReceipt(f));await f.restart();f.h.webhooks.reconcile(true)
 expect(f.h.webhooks.continuations.list()[0]?.state).toBe('waiting');f.h.webhooks.goalControl({id:f.goal().id,action:'resume',expectedRevision:f.goal().revision,operationId:'resume'});await until(f,()=>f.goal().state==='completed');expect(JSON.stringify(f.goal().contract)).toBe(contract)
})
it('fences changed assignment and rejects correlation reuse after completion',async()=>{
 const f=fixture(undefined,true);f.receive();await until(f,()=>!!f.h.webhooks.continuations.list().length&&f.h.store.get<any>('run',f.goal().taskIds[0]!)?.phase==='idle')
 const w=f.h.webhooks.continuations.list()[0]!,t=f.h.store.tickets.get(w.ticketId)!;t.assignments.at(-1)!.id='different-assignment';f.h.store.tickets.save(t)
 f.receive(eventReceipt(f));f.h.webhooks.reconcile(true);expect(f.h.webhooks.continuations.list()[0]?.state).toBe('stale');expect(f.h.webhooks.receipts().find(r=>r.event.type==='test.release')?.state).toBe('ignored')
 f.receive(f.event('second-start'));f.h.webhooks.dispatch();expect(f.h.webhooks.receipts().find(r=>r.event.id==='second-start')?.error).toBe('correlation_already_used')
})
it('expires unmatched events, times out waits without fabricated evidence, and does not revive revoked grants',async()=>{
 const f=fixture(undefined,true);f.receive({...eventReceipt(f),data:{batch:'unmatched'}});f.advance(181000);f.h.webhooks.reconcile(true);expect(f.h.webhooks.receipts()[0]?.state).toBe('expired')
 f.receive();await until(f,()=>!!f.h.webhooks.continuations.list().length&&f.h.store.get<any>('run',f.goal().taskIds[0]!)?.phase==='idle');f.advance(121000);f.h.webhooks.reconcile(true);expect(f.h.webhooks.continuations.list()[0]?.state).toBe('expired')
 f.h.webhooks.control({id:f.grant.id,action:'revoke',operationId:'revoke'});expect(()=>f.receive(eventReceipt(f))).toThrow('revoked');await f.restart();expect(f.h.webhooks.continuations.list()[0]?.state).toBe('expired')
})
it('rolls back consumption and wake together when note persistence fails, then reconciles once',async()=>{
 const f=fixture(undefined,true);f.receive();await until(f,()=>!!f.h.webhooks.continuations.list().length&&f.h.store.get<any>('run',f.goal().taskIds[0]!)?.phase==='idle');f.receive(eventReceipt(f));
 f.h.store.db.exec("CREATE TRIGGER fail_wait BEFORE INSERT ON records WHEN NEW.kind='webhook-wait' AND json_extract(NEW.body,'$.state')='delivered' BEGIN SELECT RAISE(ABORT,'injected disk failure'); END")
 expect(()=>f.h.webhooks.reconcile(true)).toThrow('disk failure');expect(f.h.webhooks.continuations.list()[0]?.state).toBe('waiting');expect(f.h.webhooks.receipts().find(r=>r.event.type==='test.release')?.state).toBe('received');f.h.store.db.exec('DROP TRIGGER fail_wait');await f.restart();await until(f,()=>f.goal().state==='completed');expect(f.h.webhooks.receipts().filter(r=>r.state==='consumed')).toHaveLength(1)
})
it('dry run has no storage or task effects and rejects event instructions masquerading as parameters',()=>{
 const f=fixture(),before=f.h.store.db.prepare('SELECT COUNT(*) n FROM records').get()!.n
 expect(f.h.webhooks.dryRun({id:f.grant.id,event:f.event()})).toMatchObject({valid:true,effects:'none'})
 expect(f.h.store.db.prepare('SELECT COUNT(*) n FROM records').get()!.n).toBe(before);expect(f.h.webhooks.receipts()).toHaveLength(0);expect(()=>f.h.webhooks.dryRun({id:f.grant.id,event:{...f.event(),data:{batch:'1',goalId:'override'}}})).toThrow('parameters')
})
it('rotates keys with bounded overlap, revision fencing and restart persistence',async()=>{
 const f=fixture();process.env.WH_ROTATE_IN='whsec_'+randomBytes(32).toString('base64');process.env.WH_ROTATE_OUT='whsec_'+randomBytes(32).toString('base64');cleanups.push(async()=>{delete process.env.WH_ROTATE_IN;delete process.env.WH_ROTATE_OUT})
 const x={id:f.grant.id,operationId:'rotate',expectedRevision:0,inbound:'WH_ROTATE_IN',outbound:'WH_ROTATE_OUT',overlapSeconds:30};const result=f.h.webhooks.rotate(x);expect(f.h.webhooks.rotate(x)).toEqual(result);f.receive();await f.restart();expect(f.h.webhooks.snapshot().grants[0]?.keys).toEqual(result);f.advance(31000);expect(()=>f.receive(f.event('old-key'))).toThrow('invalid_signature')
 expect(()=>f.h.webhooks.rotate({...x,operationId:'stale'})).toThrow('key_revision_conflict')
 const raw=JSON.stringify(f.event('new-key')),timestamp=String(Math.floor((Date.now()+31000)/1000));expect(f.h.webhooks.receive(f.grant.id,{'webhook-id':'new','webhook-timestamp':timestamp,'webhook-signature':signWebhook(secretFromEnv('WH_ROTATE_IN'),'new',timestamp,raw)},Buffer.from(raw)).duplicate).toBe(false)
})
it('retries only an undispatched transient failure with the same inbox identity',()=>{
 const f=fixture();f.receive();f.h.store.db.exec("CREATE TRIGGER fail_start BEFORE INSERT ON records WHEN NEW.kind='router-goal' BEGIN SELECT RAISE(ABORT,'disk failure'); END");f.h.webhooks.dispatch();const receipt=f.h.webhooks.receipts()[0]!;expect(receipt.error).toBe('dispatch_failed');f.h.store.db.exec('DROP TRIGGER fail_start');const x={receiptId:receipt.id,operationId:'retry'};f.h.webhooks.replay(x);f.h.webhooks.replay(x);f.h.webhooks.dispatch();expect(f.h.store.list('router-goal')).toHaveLength(1);expect(()=>f.h.webhooks.replay({...x,operationId:'retry-again'})).toThrow('not_replayable')
})
it('reconciles a missing callback row from retained acceptance without rerunning workers',async()=>{
 const f=fixture();f.receive();await until(f,()=>f.goal()?.state==='completed');const calls=f.workerCalls,delivery=f.h.webhooks.snapshot().deliveries[0]!;f.h.store.db.prepare('DELETE FROM webhook_deliveries WHERE id=?').run(String(delivery.id));f.h.webhooks.reconcile(true);expect(f.h.webhooks.snapshot().deliveries[0]?.id).toBe(delivery.id);expect(f.workerCalls).toBe(calls)
})

it('consumes a timely committed event after a restart beyond the wait deadline',async()=>{
 const f=fixture(undefined,true);f.receive();await until(f,()=>!!f.h.webhooks.continuations.list().length&&f.h.store.get<any>('run',f.goal().taskIds[0]!)?.phase==='idle');f.receive(eventReceipt(f));f.advance(300000);await f.restart();await until(f,()=>f.goal().state==='completed');expect(f.h.webhooks.continuations.list()[0]?.state).toBe('delivered')
})
it('does not allow expired or missing external event evidence to satisfy ready',async()=>{
 const f=fixture(undefined,true);f.receive();await until(f,()=>!!f.h.webhooks.continuations.list().length&&f.h.store.get<any>('run',f.goal().taskIds[0]!)?.phase==='idle');f.advance(121000);await until(f,()=>f.goal().state==='held');expect(f.h.webhooks.snapshot().deliveries).toHaveLength(0);expect(f.goal().reason).toContain('event')
})

it('retains consumed event evidence across same-node automatic repair and a restart',async()=>{
 const f=fixture(undefined,true,true);f.receive();await until(f,()=>!!f.h.webhooks.continuations.list().length&&f.h.store.get<any>('run',f.goal().taskIds[0]!)?.phase==='idle');f.receive(eventReceipt(f));await until(f,()=>f.h.store.list<any>('goal-verification').some(r=>r.state==='failed'));await f.restart();await until(f,()=>f.goal().state==='completed');expect(f.h.store.list('goal-repair')).toHaveLength(1);expect(f.h.webhooks.continuations.list()).toHaveLength(1);expect(f.h.webhooks.continuations.list()[0]?.state).toBe('delivered');expect(f.workerCalls).toBe(3)
})

it('bounds the offline inbox at 1000 accepted events without acknowledging overflow',()=>{
 const f=fixture(),g=f.h.webhooks.create({...f.spec,operationId:'capacity',namespace:'capacity',maxEvents:2000,perMinute:600})
 for(let n=0;n<1000;n++){if(n===500)f.advance(61000);const signed=f.signed(f.event('capacity-'+n));f.h.webhooks.receive(g.id,signed.headers,signed.body)}
 const signed=f.signed(f.event('overflow'));expect(()=>f.h.webhooks.receive(g.id,signed.headers,signed.body)).toThrow('inbox_overloaded');expect(f.h.webhooks.receipts()).toHaveLength(1000);expect(f.h.store.list('router-goal')).toHaveLength(0)
})

it('retains consumed evidence through independently reviewed replanning and restart',async()=>{
 const f=fixture(undefined,true,true,true);f.receive();await until(f,()=>!!f.h.webhooks.continuations.pending(f.goal()?.taskIds[0]??'')&&f.h.store.get<any>('run',f.goal().taskIds[0]!)?.phase==='idle');f.receive(eventReceipt(f))
 await until(f,()=>f.h.store.list<any>('goal-replan').some(r=>r.state==='applied'));await f.restart();await until(f,()=>f.goal().state==='completed')
 expect(f.goal().planRevision).toBe(1);expect(f.h.webhooks.continuations.list()).toHaveLength(1);expect(f.h.webhooks.receipts().filter(r=>r.state==='consumed')).toHaveLength(1);expect(f.workerCalls).toBe(3)
})
it('does not stale a pending wait when only another plan revision changes',async()=>{
 const f=fixture(undefined,true);f.receive();await until(f,()=>!!f.h.webhooks.continuations.pending(f.goal()?.taskIds[0]??'')&&f.h.store.get<any>('run',f.goal().taskIds[0]!)?.phase==='idle')
 const g=f.goal();f.h.store.put('router-goal',g.id,{...g,planRevision:1});await f.restart();f.receive(eventReceipt(f));await until(f,()=>f.goal().state==='completed');expect(f.h.webhooks.continuations.list()[0]?.state).toBe('delivered')
})
it('guards completion against missing original event prerequisites even if a future planner replaces their node',async()=>{
 const f=fixture(undefined,true);f.receive();f.h.webhooks.dispatch();const g=f.goal()
 expect(()=>f.h.store.put('router-goal',g.id,{...g,state:'completed',nodes:g.nodes!.map(n=>({...n,id:'replacement'}))})).toThrow('consumed external event evidence')
 expect(f.goal().state).not.toBe('completed');expect(f.h.webhooks.snapshot().deliveries).toHaveLength(0)
})
