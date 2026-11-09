/** Browser-only fixture: model responses are stubs; native acceptance is separate. */
import {mkdirSync,mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs'
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

async function receiver(handler:(req:IncomingMessage,res:ServerResponse)=>void){const server=createServer(handler);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+(server.address() as any).port;cleanups.push(async()=>{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()))});return url}
function fixture(url='https://example.com/callback',wait=false){
 const root=process.env.WEBHOOK_UI_DIR!;mkdirSync(root,{recursive:true});const inEnv='WEBHOOK_UI_IN',outEnv='WEBHOOK_UI_OUT'
 const keysFile=join(root,'test-keys.json');if(!existsSync(keysFile))writeFileSync(keysFile,JSON.stringify({[inEnv]:'whsec_'+randomBytes(32).toString('base64'),[outEnv]:'whsec_'+randomBytes(32).toString('base64'),WEBHOOK_UI_IN_NEXT:'whsec_'+randomBytes(32).toString('base64'),WEBHOOK_UI_OUT_NEXT:'whsec_'+randomBytes(32).toString('base64')}),{mode:0o600});Object.assign(process.env,JSON.parse(readFileSync(keysFile,'utf8')))
 let now=Date.now(),count=0,workerCalls=0,h:Runtime,closed=false
 const config=configSchema.parse({port:0,stateDir:join(root,'state'),webhooks:{port:0,loopbackCallbackOrigins:url.startsWith('http:')?[new URL(url).origin]:[]},work:{sandboxDriver:'disabled'},execution:{router:{mode:'host'},management:{enabled:true,maxWorkers:1},workers:[{id:'one',backend:'codex'}]},sources:[{id:'local',kind:'local',cwd:root,sandbox:'workspace-write',workspace:{mode:'source'},allowedActors:['alice']}]})
 const model:Model={async run(r){const input=JSON.parse(r.input);let output:any={reply:''}
  if(input.kind==='goal_verification'){
   for(const e of input.evidence)await r.onTool!('goal_evidence',{id:e.id},'read-'+e.id)
   output={checks:input.criteria.map((c:any)=>({criterionId:c.id,verdict:'passed',explanation:'Checked all retained evidence',evidenceIds:input.evidence.filter((e:any)=>c.id==='__goal__'||e.criterionIds.includes(c.id)).map((e:any)=>e.id)}))}
  }else if(r.role==='worker'){workerCalls++;if(wait){const result=await r.onTool!('superagent_event',{action:'wait',ruleId:'release',requestId:'release-wait'},'event-wait');const data=JSON.parse((result.contentItems[0] as any).text);if(data.state==='waiting'){const threadId='wait-thread';r.onThread?.(threadId);r.onTurn?.('wait-turn');return {threadId,turnId:'wait-turn',text:JSON.stringify({state:'waiting',summary:'Waiting for signed external release',reply:'',question:null,askedBy:null,handbacks:[]})}}}writeFileSync(join(r.cwd,'result.json'),JSON.stringify({total:42}));output={state:'ready',summary:'All correct, total 42',reply:'All correct',question:null,askedBy:null,handbacks:[]}}
  const threadId=r.threadId??'thread-'+(++count),turnId='turn-'+(++count);r.onThread?.(threadId);r.onTurn?.(turnId);return {threadId,turnId,text:JSON.stringify(output)}
 }}
 const open=()=>{h=new Runtime(config,{model,clock:Date.now});closed=false};open()
 cleanups.push(async()=>{if(!closed)await h.close();rmSync(root,{recursive:true,force:true});delete process.env[inEnv];delete process.env[outEnv]})
 h!.scopes.command({action:'scope.put',operationId:'scope',expectedRevision:0,scope:{id:'team',tenantId:'test',name:'Team',managers:[JSON.stringify(['local','alice'])],workerIds:['one'],sourceIds:['local'],backendIds:['codex']}})
 h!.scopes.command({action:'entry.bind',operationId:'entry',expectedRevision:0,scopeId:'team',sourceId:'local',accountNamespace:'local',nativeId:'test',history:'group'})
 if(!h!.store.triggers.get('local:approval'))h!.receive('local','alice',{id:'approval',thread:'test',scope:'test',text:'Authorize this event automation to compute and verify the requested total. Never deploy.',addressed:true})
 const spec={protocolVersion:2,continuations:wait?[{id:'release',nodeId:'compute',eventType:'test.release',correlationParameter:'batch',timeoutSeconds:120,earlyEventSeconds:180}]:[],operationId:'approve',triggerId:'local:approval',authorizationQuote:'Authorize this event automation',namespace:'test-events',eventSource:'https://producer.example/events',eventTypes:['test.request'],secretEnvs:[inEnv],parameters:{batch:{type:'string',maxLength:50}},template:{title:'Compute',objective:'Write result.json whose total is 42. Never deploy.',criteria:[{id:'total',description:'Total is 42',check:{kind:'json_equals',path:'result.json',pointer:'/total',expected:42}}],nodes:[{id:'compute',title:'Compute',instruction:'Write result.json for the event batch',workerId:'one',criterionIds:['total']}],maxRepairs:2,maxReplans:0},expiresAt:now+3600000,maxEvents:100,callback:{url,secretEnv:outEnv,idempotent:true,events:['goal.completed'],maxAttempts:4}}
 const grant=h!.store.list<any>('webhook-grant')[0]??h!.webhooks.create(spec)
 const event=(id='event-1')=>({specversion:'1.0',id,source:spec.eventSource,type:'test.request',data:{batch:'batch-1'}})
 const signed=(value:any=event(),transportId='transport-1')=>{const body=Buffer.from(JSON.stringify(value)),timestamp=String(Math.floor(now/1000));return {body,headers:{'content-type':'application/cloudevents+json','webhook-id':transportId,'webhook-timestamp':timestamp,'webhook-signature':signWebhook(secretFromEnv(inEnv),transportId,timestamp,body)}}}
 const receive=(value:any=event())=>{const s=signed(value);return h.webhooks.receive(grant.id,s.headers,s.body)}
 return {get h(){return h!},root,config,spec,grant,event,signed,receive,inEnv,outEnv,advance:(ms=10000)=>{now+=ms},get workerCalls(){return workerCalls},restart:async()=>{await h.close();closed=true;open()},offline:async(action:()=>Promise<unknown>)=>{await h.close();closed=true;try{return await action()}finally{open()}},goal:()=>h.store.list<RouterGoal>('router-goal')[0]!}
}

const directory=process.env.WEBHOOK_UI_DIR!;mkdirSync(directory,{recursive:true});let callbackCount=0;
const callback=createServer((req,res)=>{req.resume();res.writeHead(++callbackCount===1?503:204);res.end()});
const old=existsSync(join(directory,'browser-info.json'))?JSON.parse(readFileSync(join(directory,'browser-info.json'),'utf8')):undefined;
await new Promise<void>(r=>callback.listen(old?.callbackPort??0,'127.0.0.1',r));const callbackPort=(callback.address() as any).port;
const f=fixture('http://127.0.0.1:'+callbackPort+'/callback',process.env.WEBHOOK_UI_WAIT!=='0'),app=await serve(f.h);
writeFileSync(join(directory,'browser-info.json'),JSON.stringify({url:app.url,webhookUrl:app.webhookUrl,token:readFileSync(app.tokenPath,'utf8').trim(),callbackPort,grantId:f.grant.id,root:directory}),{mode:0o600});
console.log('Fixture ready '+app.url);
const close=async()=>{app.server.close();await app.closeRuntime();callback.closeAllConnections();callback.close()};process.once('SIGTERM',()=>void close());process.once('SIGINT',()=>void close());
