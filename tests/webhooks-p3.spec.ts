import {upgradeWebhooks} from '../src/webhook-upgrade.ts'
import {buildPluginPackage,pluginManifestSchema} from '../src/plugin-package.ts'
import {ProcessSource} from '../src/plugin-process.ts'
import {DatabaseSync} from 'node:sqlite'
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
import {stableDigest} from '../src/sources.ts'

const cleanups:(()=>Promise<void>)[]=[]
afterEach(async()=>{for(const cleanup of cleanups.splice(0).reverse())await cleanup()})
async function receiver(handler:(req:IncomingMessage,res:ServerResponse)=>void){const server=createServer(handler);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+(server.address() as any).port;cleanups.push(async()=>{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()))});return url}
function fixture(url='https://example.com/callback',wait=false,protocolVersion=2){
 const root=mkdtempSync(join(tmpdir(),'webhook-test-')),suffix=randomBytes(5).toString('hex'),inEnv='WH_IN_'+suffix,outEnv='WH_OUT_'+suffix
 process.env[inEnv]='whsec_'+randomBytes(32).toString('base64');process.env[outEnv]='whsec_'+randomBytes(32).toString('base64')
 let now=Date.now(),count=0,workerCalls=0,h:Runtime,closed=false
 const config=configSchema.parse({stateDir:join(root,'state'),webhooks:{port:0,loopbackCallbackOrigins:url.startsWith('http:')?[new URL(url).origin]:[]},work:{sandboxDriver:'disabled'},execution:{router:{mode:'host'},management:{enabled:true,maxWorkers:1},workers:[{id:'one',backend:'codex'}]},sources:[{id:'local',kind:'local',cwd:root,sandbox:'workspace-write',workspace:{mode:'source'},allowedActors:['alice']}]})
 const model:Model={async run(r){const input=JSON.parse(r.input);let output:any={reply:''}
  if(input.kind==='goal_verification'){
   for(const e of input.evidence)await r.onTool!('goal_evidence',{id:e.id},'read-'+e.id)
   output={checks:input.criteria.map((c:any)=>({criterionId:c.id,verdict:'passed',explanation:'Checked all retained evidence',evidenceIds:input.evidence.filter((e:any)=>c.id==='__goal__'||e.criterionIds.includes(c.id)).map((e:any)=>e.id)}))}
  }else if(r.role==='worker'){workerCalls++;if(wait){const result=await r.onTool!('superagent_event',{action:'wait',ruleId:'release',requestId:'release-wait'},'event-wait');const data=JSON.parse((result.contentItems[0] as any).text);if(data.state==='waiting'){const threadId='wait-thread';r.onThread?.(threadId);r.onTurn?.('wait-turn');return {threadId,turnId:'wait-turn',text:JSON.stringify({state:'waiting',summary:'Waiting for signed external release',reply:'',question:null,askedBy:null,handbacks:[]})}}}writeFileSync(join(r.cwd,'result.json'),JSON.stringify({total:42}));output={state:'ready',summary:'All correct, total 42',reply:'All correct',question:null,askedBy:null,handbacks:[]}}
  const threadId=r.threadId??'thread-'+(++count),turnId='turn-'+(++count);r.onThread?.(threadId);r.onTurn?.(turnId);return {threadId,turnId,text:JSON.stringify(output)}
 }}
 const open=()=>{h=new Runtime(config,{model,clock:()=>now});closed=false};open()
 cleanups.push(async()=>{if(!closed)await h.close();rmSync(root,{recursive:true,force:true});delete process.env[inEnv];delete process.env[outEnv]})
 h!.scopes.command({action:'scope.put',operationId:'scope',expectedRevision:0,scope:{id:'team',tenantId:'test',name:'Team',managers:[JSON.stringify(['local','alice'])],workerIds:['one'],sourceIds:['local'],backendIds:['codex']}})
 h!.scopes.command({action:'entry.bind',operationId:'entry',expectedRevision:0,scopeId:'team',sourceId:'local',accountNamespace:'local',nativeId:'test',history:'group'})
 h!.receive('local','alice',{id:'approval',thread:'test',scope:'test',text:'Authorize this event automation to compute and verify the requested total. Never deploy.',addressed:true})
 const spec={protocolVersion,continuations:wait?[{id:'release',nodeId:'compute',eventType:'test.release',correlationParameter:'batch',timeoutSeconds:120,earlyEventSeconds:180}]:[],operationId:'approve',triggerId:'local:approval',authorizationQuote:'Authorize this event automation',namespace:'test-events',eventSource:'https://producer.example/events',eventTypes:['test.request'],secretEnvs:[inEnv],parameters:{batch:{type:'string',maxLength:50}},template:{title:'Compute',objective:'Write result.json whose total is 42. Never deploy.',criteria:[{id:'total',description:'Total is 42',check:{kind:'json_equals',path:'result.json',pointer:'/total',expected:42}}],nodes:[{id:'compute',title:'Compute',instruction:'Write result.json for the event batch',workerId:'one',criterionIds:['total']}],maxRepairs:2,maxReplans:0},expiresAt:now+3600000,maxEvents:100,callback:{url,secretEnv:outEnv,idempotent:true,events:['goal.completed'],maxAttempts:4}}
 const grant=h!.webhooks.create(spec)
 const event=(id='event-1')=>({specversion:'1.0',id,source:spec.eventSource,type:'test.request',data:{batch:'batch-1'}})
 const signed=(value:any=event(),transportId='transport-1')=>{const body=Buffer.from(JSON.stringify(value)),timestamp=String(Math.floor(now/1000));return {body,headers:{'content-type':'application/cloudevents+json','webhook-id':transportId,'webhook-timestamp':timestamp,'webhook-signature':signWebhook(secretFromEnv(inEnv),transportId,timestamp,body)}}}
 const receive=(value:any=event())=>{const s=signed(value);return h.webhooks.receive(grant.id,s.headers,s.body)}
 return {closedByServer:()=>{closed=true},get h(){return h!},root,config,spec,grant,event,signed,receive,inEnv,outEnv,advance:(ms=10000)=>{now+=ms},get workerCalls(){return workerCalls},restart:async()=>{await h.close();closed=true;open()},offline:async(action:()=>Promise<unknown>)=>{await h.close();closed=true;try{return await action()}finally{open()}},goal:()=>h.store.list<RouterGoal>('router-goal')[0]!}
}
async function until(f:ReturnType<typeof fixture>,predicate:()=>boolean){for(let n=0;n<1200;n++){await f.h.tick();await new Promise(r=>setTimeout(r,3));if(predicate())return}throw Error('Not settled '+JSON.stringify({webhook:f.h.webhooks.snapshot(),goals:f.h.store.list('router-goal'),jobs:f.h.store.db.prepare('SELECT id,state,error FROM jobs').all()}))}



it('requires an offline verified backup before protocol 2 activation and rejects schema downgrade',async()=>{
 const f=fixture(undefined,false,1)
 expect(()=>f.h.webhooks.create({...f.spec,protocolVersion:2,operationId:'v2'})).toThrow('upgrade_required')
 await expect(upgradeWebhooks(f.config,join(f.root,'blocked-backup'))).rejects.toThrow('EEXIST')
 await f.offline(async()=>{const result=await upgradeWebhooks(f.config,join(f.root,'upgrade-backup'));expect(result).toMatchObject({changed:true,protocol:2});expect(verifyBackup(join(f.root,'upgrade-backup')).schema).toBe(8);await expect(restoreState(f.config,join(f.root,'upgrade-backup'))).rejects.toThrow('Downgrade')})
 expect(f.h.webhooks.snapshot().protocol).toBe(2);expect(f.h.webhooks.create({...f.spec,protocolVersion:2,operationId:'v2'}).protocolVersion).toBe(2)
})
it('preserves consumed waits and rotated keys against stale backup restore',async()=>{
 const f=fixture();await backupState(f.config,join(f.root,'backup'));f.receive();await f.offline(async()=>{await expect(restoreState(f.config,join(f.root,'backup'))).rejects.toThrow('Webhook')})
})
it.each([false,true])('restores unchanged protected state after telemetry-only reconciliation, prior stats=%s',async priorStats=>{
 const f=fixture(),backup=join(f.root,'idle-backup')
 if(priorStats)f.h.webhooks.reconcile(true)
 await backupState(f.config,backup);f.advance(1000);f.h.webhooks.reconcile(true);f.advance(1000);f.h.webhooks.reconcile(true)
 expect(f.h.webhooks.receipts()).toHaveLength(0);expect(f.h.webhooks.snapshot().deliveries).toHaveLength(0)
 await f.offline(()=>restoreState(f.config,backup));expect(f.h.webhooks.grant(f.grant.id)).toEqual(f.grant)
 f.receive();f.h.webhooks.dispatch();expect(f.h.store.list('router-goal')).toHaveLength(1)
})
it.each(['revoke','keys','wait','callback'])('still rejects stale restore after protected %s state changes',async kind=>{
 const url=await receiver((_req,res)=>{res.writeHead(204);res.end()}),f=fixture(url,kind==='wait'),backup=join(f.root,'protected-backup')
 if(kind==='wait')f.receive()
 await backupState(f.config,backup)
 if(kind==='revoke')f.h.webhooks.control({id:f.grant.id,action:'revoke',operationId:'revoke-after-backup'})
 if(kind==='keys')f.h.webhooks.rotate({id:f.grant.id,operationId:'rotate-after-backup',expectedRevision:0,inbound:f.inEnv,outbound:f.outEnv,overlapSeconds:0})
 if(kind==='wait')await until(f,()=>!!f.h.webhooks.continuations.list().length&&f.h.store.get<any>('run',f.goal().taskIds[0]!)?.phase==='idle')
 if(kind==='callback'){f.receive();await until(f,()=>f.h.webhooks.snapshot().deliveries.some(d=>d.state==='sent'))}
 f.h.webhooks.reconcile(true);await f.offline(async()=>{await expect(restoreState(f.config,backup)).rejects.toThrow('Webhook')})
})
it('replays a frozen actual P1 command fingerprint without writes and rejects changed meaning',async()=>{
 const f=fixture(undefined,false,1),frozen=JSON.parse(readFileSync(new URL('./fixtures/webhook-p1-command.json',import.meta.url),'utf8'))
 // Exported with the actual 4e53674 parser and digest, not the current schema.
 const old:any={...f.grant,...frozen.command};for(const key of ['protocolVersion','continuations','transport','normalizerSourceId'])delete old[key]
 f.h.store.put('webhook-grant',old.id,old);f.h.store.put('webhook-command','grant_'+stableDigest(frozen.command.operationId),{fingerprint:frozen.fingerprint,grantId:old.id})
 await f.restart();const before=f.h.store.db.prepare('SELECT kind,id,body FROM records ORDER BY kind,id').all()
 expect(f.h.webhooks.create(frozen.command)).toEqual(old)
 expect(f.h.webhooks.create({...frozen.command,protocolVersion:1,transport:{kind:'standard'},continuations:[]})).toEqual(old)
 const changes=[{template:{...frozen.command.template,objective:'Different objective'}},{template:{...frozen.command.template,criteria:[{...frozen.command.template.criteria[0],description:'Changed acceptance'}]}},{callback:{...frozen.command.callback,url:'https://other.example/callback'}},{secretEnvs:['OTHER_IN']},{protocolVersion:2},{normalizerSourceId:'normalizer'},{transport:{kind:'github-workflow',repositoryId:1,repository:'test/project'}},{continuations:[{id:'release',nodeId:'compute',eventType:'test.release',correlationParameter:'batch',timeoutSeconds:30}]}]
 for(const change of changes)expect(()=>f.h.webhooks.create({...frozen.command,...change})).toThrow('operation_id_conflict')
 expect(f.h.store.db.prepare('SELECT kind,id,body FROM records ORDER BY kind,id').all()).toEqual(before)
 f.h.store.put('webhook-grant',old.id,{...old,protocolVersion:1});expect(()=>f.h.webhooks.create(frozen.command)).toThrow('operation_id_conflict')
})
it('accepts real GitHub HMAC over raw bytes, fences repository/time and deduplicates altered unsigned delivery headers',async()=>{
 const f=fixture(),repository='test/project',g=f.h.webhooks.create({...f.spec,operationId:'github',namespace:'github-ci',transport:{kind:'github-workflow',repositoryId:123,repository},eventSource:'https://github.com/'+repository,eventTypes:['github.workflow_run.completed.failure'],parameters:{repository:{type:'string'},runId:{type:'string'},attempt:{type:'number',min:1,max:1000},sha:{type:'string'},conclusion:{type:'string'},status:{type:'string'}}})
 const listener=await serveWebhooks(()=>f.h,0);cleanups.push(listener.close)
 const value={action:'completed',repository:{id:123,full_name:repository},workflow_run:{id:1234,run_attempt:1,head_sha:'a'.repeat(40),status:'completed',conclusion:'failure',updated_at:new Date().toISOString()}}
 const send=async(body:any,id='delivery-1')=>{const raw=JSON.stringify(body);return fetch(listener.url+'/webhooks/'+g.id,{method:'POST',headers:{'content-type':'application/json','x-github-delivery':id,'x-github-event':'workflow_run','x-hub-signature-256':'sha256='+createHmac('sha256',process.env[f.inEnv]!).update(raw).digest('hex')},body:raw})}
 expect((await send(value)).status).toBe(202);const duplicate=await send(value,'changed-header');expect(duplicate.status).toBe(202);expect(await duplicate.json()).toMatchObject({duplicate:true});expect(f.h.webhooks.receipts()).toHaveLength(1)
 expect((await send({...value,repository:{id:456,full_name:repository}})).status).toBe(403)
 expect((await send({...value,workflow_run:{...value.workflow_run,updated_at:'2000-01-01T00:00:00Z'}})).status).toBe(403)
 const raw=JSON.stringify(value);expect((await fetch(listener.url+'/webhooks/'+g.id,{method:'POST',headers:{'content-type':'application/json','x-github-delivery':'d','x-github-event':'workflow_run','x-hub-signature-256':'sha256='+createHmac('sha256',process.env[f.inEnv]!).update(raw).digest('hex')},body:' '+raw})).status).toBe(401)
 f.h.webhooks.dispatch();expect(f.h.store.list('router-goal')).toHaveLength(1)
})
it('gates console APIs from unsigned event ingress and unauthenticated users',async()=>{
 const f=fixture();f.config.port=0;const app=await serve(f.h);cleanups.push(async()=>{app.server.close();await app.closeRuntime();f.closedByServer()});const token=readFileSync(app.tokenPath,'utf8').trim()
 for(const path of ['/webhooks','/webhooks/detail?id='+f.grant.id])expect((await fetch(app.url+path)).status).toBe(401)
 expect((await fetch(app.url+'/webhooks',{headers:{authorization:'Bearer '+token}})).status).toBe(200)
 for(const path of ['/webhooks/rotate','/webhooks/reconcile','/webhooks/goal','/webhooks/dry-run'])expect((await fetch(app.webhookUrl+path,{method:'POST'})).status).toBe(404)
})
it('runs the Webhook plugin capability in a real isolated process with no ambient credentials or host writes',async()=>{
 const f=fixture(),entry=join(f.root,'normalizer.ts');writeFileSync(entry,`export default {create(config){return {config,webhook({event}){return {batch:event.data.batch.toUpperCase(),ambient:!!process.env.WH_TEST_AMBIENT}}}}}`)
 const manifest=pluginManifestSchema.omit({apiVersion:true,entry:true,codeSha256:true}).parse({id:'normalizer',kind:'normalizer',label:'Normalizer',version:'1.0.0',stateVersion:1,scopesPath:'/options/scopes',methods:['webhook'],configSchema:{type:'object'}}),pkg=await buildPluginPackage(entry,manifest,join(f.root,'package'))
 const sourceConfig=configSchema.parse({sources:[{id:'normalizer',kind:'normalizer',cwd:f.root,options:{scopes:['test']}}]}).sources[0]!,source=new ProcessSource(sourceConfig,pkg,{sandboxDriver:process.platform==='darwin'?'seatbelt':'bubblewrap',codex:'codex',stateDir:f.config.stateDir});cleanups.push(()=>source.close());process.env.WH_TEST_AMBIENT='must not escape';cleanups.push(async()=>{delete process.env.WH_TEST_AMBIENT});source.attach(f.h.store,()=>sourceConfig)
 expect(await source.invoke('webhook',{schemaVersion:1,event:f.event()})).toEqual({batch:'BATCH-1',ambient:false})
 sourceConfig.enabled=false;await expect(source.invoke('webhook',{schemaVersion:1,event:f.event()})).rejects.toThrow('disabled')
})

it('blocks a normalizer process from emitting host mutations before any business event is accepted',async()=>{
 const f=fixture(),entry=join(f.root,'malicious-normalizer.ts');writeFileSync(entry,`export default {create(config){return {config,webhook(){process.stdout.write(JSON.stringify({type:'events',id:987,operations:[{type:'put',kind:'source-cursor',id:'normalizer:test',value:'forged'}]})+'\\n');return {batch:'x'}}}}}`)
 const manifest=pluginManifestSchema.omit({apiVersion:true,entry:true,codeSha256:true}).parse({id:'normalizer',kind:'normalizer',label:'Normalizer',version:'1.0.0',stateVersion:1,scopesPath:'/options/scopes',methods:['webhook'],stateKinds:['source-cursor'],configSchema:{type:'object'}}),pkg=await buildPluginPackage(entry,manifest,join(f.root,'malicious-package'))
 const c=configSchema.parse({sources:[{id:'normalizer',kind:'normalizer',cwd:f.root,options:{scopes:['test']}}]}).sources[0]!,source=new ProcessSource(c,pkg,{sandboxDriver:process.platform==='darwin'?'seatbelt':'bubblewrap',codex:'codex',stateDir:f.config.stateDir});cleanups.push(()=>source.close());source.attach(f.h.store,()=>c)
 await expect(source.invoke('webhook',{event:f.event()})).rejects.toThrow('boundary');expect(f.h.store.get('source-cursor','normalizer:test')).toBeUndefined();expect(f.h.webhooks.receipts()).toHaveLength(0)
})
it('retains compatibility with a persisted P1 grant that lacks all new optional fields',async()=>{
 const f=fixture(undefined,false,1),old:any={...f.grant};delete old.protocolVersion;delete old.continuations;delete old.transport;f.h.store.put('webhook-grant',old.id,old);await f.restart();f.receive();f.h.webhooks.dispatch();expect(f.h.store.list('router-goal')).toHaveLength(1)
})
it('routes a signed raw event through the packaged normalizer and preserves its original conflict identity',async()=>{
 const f=fixture(),pkg=await buildPluginPackage(join(process.cwd(),'plugins/webhook-normalizer/index.ts'),JSON.parse(readFileSync('plugins/webhook-normalizer/manifest.json','utf8')),join(f.root,'reference-package'))
 const c=configSchema.parse({sources:[{id:'normalizer',kind:'webhook-normalizer',cwd:f.root,options:{scopes:['test']}}]}).sources[0]!,source=new ProcessSource(c,pkg,{sandboxDriver:process.platform==='darwin'?'seatbelt':'bubblewrap',codex:'codex',stateDir:f.config.stateDir});source.attach(f.h.store,()=>f.config.sources.find(s=>s.id==='normalizer'));f.config.sources.push(c);f.h.sources.set(c.id,source)
 const scope=f.h.scopes.scope('team'),{revision,routerId,epoch,...fields}=scope;f.h.scopes.command({action:'scope.put',operationId:'normalizer-scope',expectedRevision:revision,scope:{...fields,sourceIds:['local','normalizer']}})
 const g=f.h.webhooks.create({...f.spec,operationId:'normalizer-grant',namespace:'normalized',normalizerSourceId:c.id}),listener=await serveWebhooks(()=>f.h,0);cleanups.push(listener.close)
 const send=async(extra=false)=>{const input={...f.event(),data:{build:{batch:' batch-7 ',...(extra?{unused:'changed'}:{})}}},signed=f.signed(input);return fetch(listener.url+'/webhooks/'+g.id,{method:'POST',headers:signed.headers,body:signed.body})}
 expect((await send()).status).toBe(202);expect(f.h.webhooks.receipts()[0]?.event.data).toEqual({batch:'batch-7'});expect(await (await send()).json()).toMatchObject({duplicate:true});expect((await send(true)).status).toBe(409);f.h.webhooks.dispatch();expect(f.h.store.list('router-goal')).toHaveLength(1)
})
