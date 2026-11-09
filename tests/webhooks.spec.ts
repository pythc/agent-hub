import {it,expect,afterEach} from 'vitest'
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createServer,type IncomingMessage,type ServerResponse} from 'node:http'
import {randomBytes} from 'node:crypto'
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
function fixture(url='https://example.com/callback',failFirst=false){
 const root=mkdtempSync(join(tmpdir(),'webhook-test-')),suffix=randomBytes(5).toString('hex'),inEnv='WH_IN_'+suffix,outEnv='WH_OUT_'+suffix
 process.env[inEnv]='whsec_'+randomBytes(32).toString('base64');process.env[outEnv]='whsec_'+randomBytes(32).toString('base64')
 let now=Date.now(),count=0,workerCalls=0,h:Runtime,closed=false
 const config=configSchema.parse({stateDir:join(root,'state'),webhooks:{port:0,loopbackCallbackOrigins:url.startsWith('http:')?[new URL(url).origin]:[]},work:{sandboxDriver:'disabled'},execution:{router:{mode:'host'},management:{enabled:true,maxWorkers:1},workers:[{id:'one',backend:'codex'}]},sources:[{id:'local',kind:'local',cwd:root,sandbox:'workspace-write',workspace:{mode:'source'},allowedActors:['alice']}]})
 const model:Model={async run(r){const input=JSON.parse(r.input);let output:any={reply:''}
  if(input.kind==='goal_verification'){
   for(const e of input.evidence)await r.onTool!('goal_evidence',{id:e.id},'read-'+e.id)
   output={checks:input.criteria.map((c:any)=>({criterionId:c.id,verdict:'passed',explanation:'Checked all retained evidence',evidenceIds:input.evidence.filter((e:any)=>c.id==='__goal__'||e.criterionIds.includes(c.id)).map((e:any)=>e.id)}))}
  }else if(r.role==='worker'){workerCalls++;writeFileSync(join(r.cwd,'result.json'),JSON.stringify({total:failFirst&&workerCalls===1?41:42}));output={state:'ready',summary:'All correct, total 42',reply:'All correct',question:null,askedBy:null,handbacks:[]}}
  const threadId=r.threadId??'thread-'+(++count),turnId='turn-'+(++count);r.onThread?.(threadId);r.onTurn?.(turnId);return {threadId,turnId,text:JSON.stringify(output)}
 }}
 const open=()=>{h=new Runtime(config,{model,clock:()=>now});closed=false};open()
 cleanups.push(async()=>{if(!closed)await h.close();rmSync(root,{recursive:true,force:true});delete process.env[inEnv];delete process.env[outEnv]})
 h!.scopes.command({action:'scope.put',operationId:'scope',expectedRevision:0,scope:{id:'team',tenantId:'test',name:'Team',managers:[JSON.stringify(['local','alice'])],workerIds:['one'],sourceIds:['local'],backendIds:['codex']}})
 h!.scopes.command({action:'entry.bind',operationId:'entry',expectedRevision:0,scopeId:'team',sourceId:'local',accountNamespace:'local',nativeId:'test',history:'group'})
 h!.receive('local','alice',{id:'approval',thread:'test',scope:'test',text:'Authorize this event automation to compute and verify the requested total. Never deploy.',addressed:true})
 const spec={operationId:'approve',triggerId:'local:approval',authorizationQuote:'Authorize this event automation',namespace:'test-events',eventSource:'https://producer.example/events',eventTypes:['test.request'],secretEnvs:[inEnv],parameters:{batch:{type:'string',maxLength:50}},template:{title:'Compute',objective:'Write result.json whose total is 42. Never deploy.',criteria:[{id:'total',description:'Total is 42',check:{kind:'json_equals',path:'result.json',pointer:'/total',expected:42}}],nodes:[{id:'compute',title:'Compute',instruction:'Write result.json for the event batch',workerId:'one',criterionIds:['total']}],maxRepairs:2,maxReplans:0},expiresAt:now+3600000,maxEvents:100,callback:{url,secretEnv:outEnv,idempotent:true,events:['goal.completed'],maxAttempts:4}}
 const grant=h!.webhooks.create(spec)
 const event=(id='event-1')=>({specversion:'1.0',id,source:spec.eventSource,type:'test.request',data:{batch:'batch-1'}})
 const signed=(value:any=event(),transportId='transport-1')=>{const body=Buffer.from(JSON.stringify(value)),timestamp=String(Math.floor(now/1000));return {body,headers:{'content-type':'application/cloudevents+json','webhook-id':transportId,'webhook-timestamp':timestamp,'webhook-signature':signWebhook(secretFromEnv(inEnv),transportId,timestamp,body)}}}
 const receive=(value:any=event())=>{const s=signed(value);return h.webhooks.receive(grant.id,s.headers,s.body)}
 return {get h(){return h!},root,config,spec,grant,event,signed,receive,inEnv,outEnv,advance:(ms=10000)=>{now+=ms},get workerCalls(){return workerCalls},restart:async()=>{await h.close();closed=true;open()},offline:async(action:()=>Promise<unknown>)=>{await h.close();closed=true;try{return await action()}finally{open()}},goal:()=>h.store.list<RouterGoal>('router-goal')[0]!}
}
async function until(f:ReturnType<typeof fixture>,predicate:()=>boolean){for(let n=0;n<1200;n++){await f.h.tick();await new Promise(r=>setTimeout(r,3));if(predicate())return}throw Error('Not settled '+JSON.stringify({webhook:f.h.webhooks.snapshot(),goals:f.h.store.list('router-goal'),jobs:f.h.store.db.prepare('SELECT id,state,error FROM jobs').all()}))}

it('verifies raw bytes, timestamps, header syntax and overlapping rotation keys',()=>{
 const key=randomBytes(32),raw=Buffer.from('{"x":1}'),timestamp=String(Math.floor(Date.now()/1000)),headers={'webhook-id':'id_1','webhook-timestamp':timestamp,'webhook-signature':signWebhook(key,'id_1',timestamp,raw)}
 expect(verifyWebhook([randomBytes(32),key],headers,raw)).toBe('id_1')
 expect(()=>verifyWebhook([key],headers,Buffer.from('{ "x":1}'))).toThrow('invalid_signature')
 expect(()=>verifyWebhook([key],headers,raw,Date.now()+301000)).toThrow('invalid_signature')
 expect(()=>verifyWebhook([key],{...headers,'webhook-id':'a.b'},raw)).toThrow('invalid_signature')
})
it('deduplicates concurrent HTTP deliveries, semantic JSON formatting, transport changes and restarts',async()=>{
 const f=fixture(),listener=await serveWebhooks(()=>f.h,0);cleanups.push(listener.close)
 const s=f.signed(),url=listener.url+'/webhooks/'+f.grant.id
 const results=await Promise.all(Array.from({length:8},()=>fetch(url,{method:'POST',headers:s.headers,body:s.body}).then(async r=>({status:r.status,body:await r.json() as any}))))
 expect(results.every(r=>r.status===202)).toBe(true);expect(new Set(results.map(r=>r.body.receiptId)).size).toBe(1)
 await f.restart();const r=f.receive({...f.event(),data:{batch:'batch-1'}});expect(r.duplicate).toBe(true)
 f.h.webhooks.dispatch();expect(f.h.store.list('router-goal')).toHaveLength(1)
 const machine=f.h.store.triggers.get(f.goal().triggerId)!;expect(machine.human).toBe(false);expect(machine.actor.id).toContain('automation:')
 expect(f.h.store.list('memory-fact')).toHaveLength(0)
 expect(()=>f.receive({...f.event(),data:{batch:'changed'}})).toThrow('event_identity_conflict')
 expect(f.receive().goalId).toBe(f.goal().id)
 expect((await fetch(listener.url+'/settings')).status).toBe(404)
})
it('does not ACK a storage failure, does not dispatch before commit, and recovers one inbox item',async()=>{
 const f=fixture(),listener=await serveWebhooks(()=>f.h,0);cleanups.push(listener.close)
 f.h.store.db.exec("CREATE TRIGGER fail_inbox BEFORE INSERT ON webhook_inbox BEGIN SELECT RAISE(ABORT,'injected disk failure'); END")
 const s=f.signed(),url=listener.url+'/webhooks/'+f.grant.id
 expect((await fetch(url,{method:'POST',headers:s.headers,body:s.body})).status).toBe(503)
 expect(f.h.webhooks.receipts()).toHaveLength(0);expect(f.h.store.list('router-goal')).toHaveLength(0)
 f.h.store.db.exec('DROP TRIGGER fail_inbox');expect((await fetch(url,{method:'POST',headers:s.headers,body:s.body})).status).toBe(202)
 await f.restart();f.h.webhooks.dispatch();f.h.webhooks.dispatch();expect(f.h.store.list('router-goal')).toHaveLength(1)
})
it('does not expose a rolled-back Goal id if inbox linkage fails at the final dispatch write',()=>{
 const f=fixture();f.receive()
 f.h.store.db.exec("CREATE TRIGGER fail_link BEFORE UPDATE ON webhook_inbox WHEN NEW.state='dispatched' BEGIN SELECT RAISE(ABORT,'injected link failure'); END")
 f.h.webhooks.dispatch();const receipt=f.h.webhooks.receipts()[0]!
 expect(receipt.state).toBe('held');expect(receipt.goalId).toBeUndefined();expect(receipt.triggerId).toBeUndefined()
 expect(f.h.store.list('router-goal')).toHaveLength(0);expect(f.h.store.list('webhook-input')).toHaveLength(0)
})
it('rejects caller supplied authority, destinations, changed templates and revoked approvals',async()=>{
 const f=fixture()
 expect(()=>f.receive({...f.event(),human:true})).toThrow()
 expect(()=>f.receive({...f.event(),data:{batch:'x',callbackUrl:'https://attacker.example'}})).toThrow('event_parameters_mismatch')
 expect(()=>f.receive({...f.event(),source:'https://other.example'})).toThrow('event_outside_grant')
 f.receive();f.h.webhooks.dispatch()
 const goal=f.goal(),t=f.h.store.triggers.get(goal.triggerId)!,c=f.h.scopes.context(t,goal.discussion)!
 expect(()=>f.h.goals.command({action:'start',operationId:'different',expectedRevision:0,authorizationQuote:f.spec.authorizationQuote,...f.spec.template,objective:'Changed goal'},c)).toThrow('automation_template_changed')
 const original=f.h.store.triggers.get('local:approval')!;f.h.store.triggers.save({...original,text:'withdrawn'})
 expect(()=>f.h.routerIngress.authority(t.id)).toThrow('authorization_source_changed')
 expect(()=>f.receive(f.event('another'))).toThrow('authorization_source_changed')
})
it('intercepts a false ready report, repairs after restart, and retries the callback without rerunning work',async()=>{
 const seen:string[]=[],bodies:string[]=[],effects=new Set<string>();let outKey:Buffer
 const url=await receiver(async(req,res)=>{const chunks:Buffer[]=[];for await(const c of req)chunks.push(c);const body=Buffer.concat(chunks),id=String(req.headers['webhook-id']);verifyWebhook([outKey],req.headers as Record<string,string>,body);seen.push(id);bodies.push(body.toString());effects.add(id);if(seen.length===1)req.socket.destroy();else if(seen.length===2){res.writeHead(503);res.end()}else{res.writeHead(204);res.end()}})
 const f=fixture(url,true);outKey=secretFromEnv(f.outEnv);f.receive()
 await until(f,()=>f.h.store.list<any>('goal-verification').some(r=>r.state==='failed'))
 expect(f.h.store.tickets.list()[0]?.ended).toBeUndefined();expect(f.h.webhooks.snapshot().deliveries).toHaveLength(0)
 const id=f.goal().id,contract=stableContract(f.goal());await f.restart()
 await until(f,()=>f.goal().state==='completed'&&f.h.webhooks.snapshot().deliveries.some(d=>d.state==='pending'))
 expect(f.goal().id).toBe(id);expect(stableContract(f.goal())).toBe(contract);expect(f.workerCalls).toBe(2);expect(f.h.store.list('goal-repair')).toHaveLength(1)
 await f.restart();f.advance();await until(f,()=>seen.length===2&&f.h.webhooks.snapshot().deliveries[0]?.state==='pending')
 f.advance();await until(f,()=>f.h.webhooks.snapshot().deliveries[0]?.state==='sent')
 expect(seen).toHaveLength(3);expect(new Set(seen).size).toBe(1);expect(new Set(bodies).size).toBe(1);expect(effects.size).toBe(1);expect(f.workerCalls).toBe(2)
 expect(JSON.parse(bodies[0]!).data.acceptance.state).toBe('passed');expect(bodies[0]).not.toContain('batch-1')
 expect(()=>f.h.goals.toolAllowed(f.goal().triggerId,'router_manage',{action:'create'})).toThrow('Completed goal only permits inspection')
 expect(()=>f.h.goals.toolAllowed(f.goal().triggerId,'worker_manage',{action:'assign'})).toThrow('Completed goal only permits inspection')
})
function stableContract(g:RouterGoal){return JSON.stringify(g.contract)}
it('atomically rolls back completion when event outbox persistence fails',async()=>{
 const f=fixture();f.receive()
 f.h.store.db.exec("CREATE TRIGGER fail_domain BEFORE INSERT ON webhook_events WHEN json_extract(NEW.body,'$.type')='goal.completed' BEGIN SELECT RAISE(ABORT,'disk failure'); END")
 await until(f,()=>f.goal()?.state==='held')
 expect(f.goal().reason).toContain('disk failure');expect(f.h.webhooks.snapshot().deliveries).toHaveLength(0)
 expect(f.h.store.db.prepare("SELECT COUNT(*) n FROM webhook_events WHERE json_extract(body,'$.type')='goal.completed'").get()!.n).toBe(0)
 f.h.store.db.exec('DROP TRIGGER fail_domain')
 const c=f.h.scopes.context(f.h.store.triggers.get('local:approval')!,'local:test')!
 f.h.goals.command({action:'resume',id:f.goal().id,operationId:'storage-recovered',expectedRevision:f.goal().revision},c)
 await f.h.goals.advance();expect(f.goal().state).toBe('completed');expect(f.h.webhooks.snapshot().deliveries).toHaveLength(1);expect(f.workerCalls).toBe(1)
})
it('stops reception independently of accepted work and fences revoked work on restart',async()=>{
 const f=fixture();f.receive()
 f.h.webhooks.control({id:f.grant.id,action:'stop_receiving',operationId:'stop'})
 expect(()=>f.receive(f.event('second'))).toThrow('endpoint_not_receiving')
 f.h.webhooks.dispatch();expect(f.goal().state).toBe('active')
 f.h.webhooks.control({id:f.grant.id,action:'revoke',operationId:'revoke'})
 await f.restart();await f.h.tick();expect(f.goal().state).toBe('held');expect(f.workerCalls).toBe(0)
 expect(()=>f.h.routerIngress.authority(f.goal().triggerId)).toThrow('automation_grant_revoked_or_expired')
})
it.each(['127.0.0.1','10.0.0.1','172.16.0.1','192.168.1.1','169.254.169.254','100.64.0.1','::1','::ffff:127.0.0.1','fc00::1','fe80::1','2001:db8::1','2002:7f00:1::1'])('blocks private and special-use callback address %s',address=>expect(publicAddress(address)).toBe(false))
it.each(['8.8.8.8','192.2.0.1','2001:4860:4860::8888','2606:4700:4700::1111'])('accepts public address %s without misclassifying whole allocated ranges',address=>expect(publicAddress(address)).toBe(true))
it('requires an exact, explicit loopback callback exception; denies credentials and query tokens',()=>{
 expect(()=>callbackURL('http://127.0.0.1:8080/callback')).toThrow()
 expect(callbackURL('http://127.0.0.1:8080/callback',['http://127.0.0.1:8080']).local).toBe(true)
 expect(()=>callbackURL('http://127.0.0.1:8081/callback',['http://127.0.0.1:8080'])).toThrow()
 expect(()=>callbackURL('https://user:pass@example.com')).toThrow()
 expect(()=>callbackURL('https://example.com?secret=123')).toThrow()
})
it('does not resurrect a cancelled automation when duplicate events arrive after restart',async()=>{
 const f=fixture();f.receive();f.h.webhooks.dispatch();const goal=f.goal(),approval=f.h.store.triggers.get('local:approval')!,c=f.h.scopes.context(approval,'local:test')!
 f.h.goals.command({action:'cancel',id:goal.id,operationId:'cancel',expectedRevision:goal.revision},c)
 await f.restart();expect(f.receive().duplicate).toBe(true);await f.h.tick()
 expect(f.goal().state).toBe('cancelled');expect(f.h.store.list('router-goal')).toHaveLength(1);expect(f.workerCalls).toBe(0)
})
it('keeps manual pause effective across restart and resumes the same automation goal',async()=>{
 const url=await receiver((_req,res)=>{res.writeHead(204);res.end()}),f=fixture(url);f.receive();f.h.webhooks.dispatch();const goal=f.goal()
 const context=()=>f.h.scopes.context(f.h.store.triggers.get('local:approval')!,'local:test')!
 f.h.goals.command({action:'pause',id:goal.id,operationId:'pause',expectedRevision:goal.revision},context())
 await f.restart();await f.h.tick();expect(f.goal().state).toBe('paused');expect(f.workerCalls).toBe(0)
 f.h.goals.command({action:'resume',id:goal.id,operationId:'resume',expectedRevision:f.goal().revision},context())
 await until(f,()=>f.goal().state==='completed');expect(f.h.store.list('router-goal')).toHaveLength(1)
})
it('holds 401 callbacks and retries the same delivery only after explicit operator recovery',async()=>{
 let count=0;const ids:string[]=[],url=await receiver((req,res)=>{count++;ids.push(String(req.headers['webhook-id']));res.writeHead(count===1?401:204);res.end()}),f=fixture(url);f.receive()
 await until(f,()=>f.h.webhooks.snapshot().deliveries[0]?.state==='held')
 f.advance(120000);for(let i=0;i<5;i++)await f.h.tick();expect(count).toBe(1)
 const d=f.h.webhooks.snapshot().deliveries[0]!
 f.h.webhooks.control({id:f.grant.id,operationId:'retry',action:'retry_delivery',deliveryId:d.id})
 await until(f,()=>f.h.webhooks.snapshot().deliveries[0]?.state==='sent');expect(ids[0]).toBe(ids[1]);expect(f.workerCalls).toBe(1)
})
it('bounds inbox traffic and concurrent goals while allowing deduplicated retries beyond the budget',()=>{
 const f=fixture(),g={...f.grant,maxEvents:2,perMinute:2,maxConcurrent:1};f.h.store.put('webhook-grant',g.id,g)
 f.receive();f.receive(f.event('second'));expect(f.receive().duplicate).toBe(true)
 expect(()=>f.receive(f.event('third'))).toThrow('grant_event_budget_exhausted')
 f.h.webhooks.dispatch();expect(f.h.store.list('router-goal')).toHaveLength(1);expect(f.h.webhooks.receipts().filter(r=>r.state==='received')).toHaveLength(1)
})
it('retains deduplication identity across endpoint and signing-key rotation',()=>{
 const f=fixture(),first=f.receive(),rotated=f.h.webhooks.create({...f.spec,operationId:'rotated'})
 const s=f.signed(f.event(),'new_transport');expect(f.h.webhooks.receive(rotated.id,s.headers,s.body).receiptId).toBe(first.receiptId)
 f.h.webhooks.dispatch();expect(f.h.store.list('router-goal')).toHaveLength(1)
})
it('requires a human manager approval and freezes worker, tool and network permissions',()=>{
 const f=fixture();expect(()=>f.h.webhooks.create({...f.spec,operationId:'fake',triggerId:'nonexistent'})).toThrow('real_human_authorization_required')
 f.receive();f.h.webhooks.dispatch();const trigger=f.goal().triggerId
 f.config.work.network=!f.config.work.network
 expect(()=>f.h.routerIngress.authority(trigger)).toThrow('automation_permissions_changed')
 expect(f.h.routerIngress.policy().revalidate(f.goal().contract!.mandate)).toBe(false)
})
it('fences already queued worker execution when a human pauses the goal',async()=>{
 const f=fixture();f.receive();f.h.webhooks.dispatch();await f.h.goals.advance();expect(f.goal().taskIds).toHaveLength(1)
 const c=f.h.scopes.context(f.h.store.triggers.get('local:approval')!,'local:test')!
 f.h.goals.command({action:'pause',id:f.goal().id,operationId:'pause-queued',expectedRevision:f.goal().revision},c)
 await f.restart();await f.h.tick();expect(f.workerCalls).toBe(0);expect(f.goal().state).toBe('paused')
})
it('publishes only explicitly selected independently verified artifacts, with a stable SHA-256 digest',async()=>{
 let body:any;const url=await receiver(async(req,res)=>{const chunks:Buffer[]=[];for await(const c of req)chunks.push(c);body=JSON.parse(Buffer.concat(chunks).toString());res.writeHead(204);res.end()}),f=fixture(url)
 const grant=f.h.webhooks.create({...f.spec,operationId:'with-result',callback:{...f.spec.callback,resultFiles:['result.json']}}),s=f.signed()
 f.h.webhooks.receive(grant.id,s.headers,s.body);await until(f,()=>f.h.webhooks.snapshot().deliveries[0]?.state==='sent')
 expect(body.data.results).toHaveLength(1);expect(body.data.results[0]).toMatchObject({path:'result.json',content:'{"total":42}',bytes:12,sha256:expect.stringMatching(/^[a-f0-9]{64}$/)})
 expect(JSON.stringify(body)).not.toContain('All correct');expect(JSON.stringify(body)).not.toContain('batch-1')
 expect(()=>f.h.webhooks.create({...f.spec,operationId:'private-result',callback:{...f.spec.callback,resultFiles:['secret.txt']}})).toThrow('callback_result_requires_declared_acceptance_file')
})
it('marks permanent callback failure dead and never reruns the completed goal',async()=>{
 let calls=0;const url=await receiver((_req,res)=>{calls++;res.writeHead(422);res.end()}),f=fixture(url);f.receive()
 await until(f,()=>f.h.webhooks.snapshot().deliveries[0]?.state==='dead');f.advance(600000)
 for(let i=0;i<4;i++)await f.h.tick();expect(calls).toBe(1);expect(f.workerCalls).toBe(1);expect(f.goal().state).toBe('completed')
})
it('does not starve another grant behind a full grant inbox',()=>{
 const f=fixture();for(let i=0;i<24;i++)f.receive(f.event('queued-'+i));f.h.webhooks.dispatch()
 const other=f.h.webhooks.create({...f.spec,operationId:'other',namespace:'other'}),s=f.signed(f.event('other'))
 f.h.webhooks.receive(other.id,s.headers,s.body);f.h.webhooks.dispatch()
 expect(f.h.store.list('router-goal')).toHaveLength(2)
})
it('preserves schema 8 through memory startup, backup verification and an identical offline restore',async()=>{
 const f=fixture();expect(f.h.store.db.prepare('PRAGMA user_version').get()!.user_version).toBe(8)
 await f.restart();expect(f.h.store.db.prepare('PRAGMA user_version').get()!.user_version).toBe(8)
 const destination=join(f.root,'backup');await backupState(f.config,destination);expect(verifyBackup(destination).schema).toBe(8)
 await f.offline(()=>restoreState(f.config,destination));expect(f.h.store.db.prepare('PRAGMA user_version').get()!.user_version).toBe(8)
 expect(f.h.store.list('webhook-grant')).toHaveLength(1)
})
it.each(['receipt','revoke','callback'])('rejects restoring a backup after Webhook %s history advances',async kind=>{
 const f=fixture(),destination=join(f.root,'backup');await backupState(f.config,destination)
 if(kind==='receipt')f.receive()
 if(kind==='revoke')f.h.webhooks.control({id:f.grant.id,operationId:'revoke',action:'revoke'})
 if(kind==='callback')f.h.store.db.prepare('INSERT INTO webhook_events VALUES(?,?,?,?)').run('after-backup','goal-after-backup',1,'{}')
 await f.offline(()=>expect(restoreState(f.config,destination)).rejects.toThrow(/Webhook .*advanced/))
 if(kind==='receipt')expect(f.h.webhooks.receipts()).toHaveLength(1)
 if(kind==='revoke')expect(f.h.store.get<any>('webhook-grant',f.grant.id).active).toBe(false)
})
it('recovers a managed configuration journal without rejecting an enabled Webhook database',()=>{
 const f=fixture();prepareManagedFiles(f.config.stateDir,'schema-eight-journal',{})
 expect(existsSync(managedFiles(f.config.stateDir).journal)).toBe(true)
 expect(()=>recoverManagedFiles(f.config.stateDir)).not.toThrow();expect(existsSync(managedFiles(f.config.stateDir).journal)).toBe(false)
})
it('wires the operator APIs and separate ingress listener without exposing management on ingress',async()=>{
 const url=await receiver((_req,res)=>{res.writeHead(204);res.end()}),f=fixture(url);f.config.port=0;const api=await serve(f.h)
 cleanups.push(async()=>{api.server.closeAllConnections();await new Promise<void>(r=>api.server.close(()=>r()))})
 const headers={'content-type':'application/json',authorization:'Bearer '+readFileSync(api.tokenPath,'utf8').trim()}
 expect((await fetch(api.url+'/webhooks')).status).toBe(401)
 expect((await fetch(api.url+'/webhooks',{headers:{authorization:'Bearer '+process.env[f.inEnv]}})).status).toBe(401)
 const granted=await fetch(api.url+'/webhooks/grants',{method:'POST',headers,body:JSON.stringify(f.spec)})
 expect(granted.status).toBe(201);expect((await granted.json() as any).id).toBe(f.grant.id)
 expect((await fetch(api.webhookUrl+'/settings',{headers})).status).toBe(404)
 const signature=f.signed();expect((await fetch(api.webhookUrl+'/webhooks/'+f.grant.id,{method:'POST',headers:signature.headers,body:signature.body})).status).toBe(202)
 const state=await fetch(api.url+'/webhooks',{headers});expect(state.status).toBe(200);expect((await state.json() as any).receipts).toHaveLength(1)
})
