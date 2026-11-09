/** Actual P1 -> current process upgrade, signed HTTP backlog and offline restore.
 * Set WEBHOOK_P1_ROOT to an archive of 4e53674 with its dependencies available.
 * Model decisions are deterministic here; native model acceptance is separate.
 */
import assert from 'node:assert/strict'
import {mkdirSync,existsSync,readFileSync,writeFileSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {spawn,execFileSync} from 'node:child_process'
import {createServer} from 'node:http'
import {createHash,randomBytes} from 'node:crypto'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
import {serveWebhooks} from '../src/webhook-http.ts'
import {secretFromEnv,signWebhook,verifyWebhook} from '../src/webhook-protocol.ts'
import {upgradeWebhooks} from '../src/webhook-upgrade.ts'
import {backupState,restoreState,verifyBackup} from '../src/backup.ts'
import type {Model} from '../src/model.ts'

const base='4e536746321b5492107666beacd5051b93c96337',phase=process.env.WEBHOOK_UPGRADE_PHASE
const root=resolve(process.env.WEBHOOK_UPGRADE_DIR??'/tmp/webhook-upgrade-'+Date.now()),legacy=process.env.WEBHOOK_P1_ROOT
if(!legacy)throw Error('WEBHOOK_P1_ROOT must point to the actual P1 archive')
const event={specversion:'1.0',id:'upgrade-backlog',source:'https://acceptance.example/upgrade',type:'audit.request',data:{batch:'upgrade'}}
const save=(name:string,value:unknown)=>writeFileSync(join(root,name+'.json'),JSON.stringify(value,null,2))
const read=(name:string)=>JSON.parse(readFileSync(join(root,name+'.json'),'utf8'))
const implementation=Object.fromEntries(['src/webhooks.ts','src/webhook-continuations.ts','src/backup.ts','src/webhook-upgrade.ts'].map(p=>[p,createHash('sha256').update(readFileSync(new URL('../'+p,import.meta.url))).digest('hex')]))
if(!phase){
 assert(!existsSync(join(root,'state')),'Use a fresh isolated directory');mkdirSync(join(root,'workspace'),{recursive:true})
 for(const file of ['src/runtime.ts','src/webhooks.ts','src/config.ts'])assert.equal(createHash('sha256').update(readFileSync(join(legacy,file))).digest('hex'),createHash('sha256').update(execFileSync('git',['show',base+':'+file])).digest('hex'),'Actual P1 source: '+file)
 process.env.WH_UPGRADE_IN='whsec_'+randomBytes(32).toString('base64');process.env.WH_UPGRADE_OUT='whsec_'+randomBytes(32).toString('base64')
 const callbacks:string[]=[];let callbackError:string|undefined
 const server=createServer((req,res)=>{void(async()=>{const chunks:Buffer[]=[];for await(const c of req)chunks.push(c);const body=Buffer.concat(chunks);verifyWebhook([secretFromEnv('WH_UPGRADE_OUT')],req.headers as Record<string,string>,body);assert.equal(JSON.parse(body.toString()).type,'goal.completed');callbacks.push(String(req.headers['webhook-id']));res.writeHead(204);res.end()})().catch(e=>{callbackError=String(e);res.writeHead(400);res.end()})})
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));process.env.WH_UPGRADE_CALLBACK='http://127.0.0.1:'+(server.address() as any).port+'/callback'
 try{
  for(const stage of ['legacy','upgrade','resumed','restored'])await new Promise<void>((resolve,reject)=>{const child=spawn(process.execPath,['--import','tsx',fileURLToPath(import.meta.url)],{env:{...process.env,WEBHOOK_UPGRADE_DIR:root,WEBHOOK_UPGRADE_PHASE:stage},stdio:'inherit'});child.once('error',reject);child.once('exit',(code,signal)=>code===0?resolve():reject(Error(stage+' failed: '+code+' '+signal)))})
  assert.equal(callbackError,undefined);assert.equal(callbacks.length,1)
  const phases=['legacy','upgrade','resumed','restored'].map(read);assert.equal(new Set(phases.map(p=>p.pid)).size,4);assert(phases.every(p=>JSON.stringify(p.implementation)===JSON.stringify(implementation)))
  const evidence={ok:true,base,implementation,checks:{fourRealProcesses:true,actualP1GrantAndFingerprint:true,signedHTTPBacklogSurvivedUpgrade:true,unchangedCommandReplayed:true,changedCommandRejected:true,verifiedOfflineBackup:true,repeatedUpgradeIdempotent:true,incompatibleDowngradeRejected:true,oneAcceptedGoal:true,oneSignedCallback:true,telemetryOnlyRestoreSucceeded:true,restoredDuplicateDidNotRerun:true},model:'Deterministic Worker/verifier fixture; actual Runtime, HTTP, SQLite, backup and separate processes.',phases}
  save('evidence',evidence);console.log(JSON.stringify(evidence))
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()))}
}else{
 const callback=process.env.WH_UPGRADE_CALLBACK!
 if(phase==='upgrade'){
  const config=configSchema.parse(read('config')),backup=join(root,'p1-backup')
  assert.equal((await upgradeWebhooks(config,backup)).changed,true);assert.equal(verifyBackup(backup).schema,8)
  assert.equal((await upgradeWebhooks(config,join(root,'unused-backup'))).changed,false)
  await assert.rejects(()=>restoreState(config,backup),/Downgrade/)
  save(phase,{pid:process.pid,implementation,backupSchema:8,protocol:2});
 }else{
  let workerCalls=0,turn=0
  const model:Model={async run(r){const input=JSON.parse(r.input);let output:any={reply:''};if(input.kind==='goal_verification'){for(const e of input.evidence)await r.onTool!('goal_evidence',{id:e.id},'read-'+e.id);output={checks:input.criteria.map((c:any)=>({criterionId:c.id,verdict:'passed',explanation:'Read actual accepted result',evidenceIds:input.evidence.filter((e:any)=>c.id==='__goal__'||e.criterionIds.includes(c.id)).map((e:any)=>e.id)}))}}else if(r.role==='worker'){workerCalls++;writeFileSync(join(r.cwd,'result.json'),JSON.stringify({total:42}));output={state:'ready',summary:'Computed total 42',reply:'',question:null,askedBy:null,handbacks:[]}}const threadId=r.threadId??'upgrade-thread-'+(++turn),turnId='upgrade-turn-'+(++turn);r.onThread?.(threadId);r.onTurn?.(turnId);return {threadId,turnId,text:JSON.stringify(output)}}}
  const old=phase==='legacy',load=async(file:string)=>import(pathToFileURL(join(legacy,'src',file+'.ts')).href)
  const schema=old?(await load('config')).configSchema:configSchema
  const config=schema.parse(old?{stateDir:join(root,'state'),webhooks:{port:0,loopbackCallbackOrigins:[new URL(callback).origin]},work:{sandboxDriver:'disabled'},execution:{router:{mode:'host'},management:{enabled:true,maxWorkers:1},workers:[{id:'one',backend:'codex'}]},sources:[{id:'local',kind:'local',cwd:join(root,'workspace'),sandbox:'workspace-write',workspace:{mode:'source'},allowedActors:['operator']}]}:read('config'))
  const RuntimeClass=old?(await load('runtime')).Runtime:Runtime,h:Runtime=new RuntimeClass(config,{model}),listen=old?(await load('webhook-http')).serveWebhooks:serveWebhooks,listener=await listen(()=>h,0)
  let restored=false
  try{
   if(old){
    save('config',config);h.scopes.command({action:'scope.put',operationId:'scope',expectedRevision:0,scope:{id:'audit',tenantId:'upgrade',name:'Upgrade',managers:[JSON.stringify(['local','operator'])],workerIds:['one'],sourceIds:['local'],backendIds:['codex']}})
    h.scopes.command({action:'entry.bind',operationId:'entry',expectedRevision:0,scopeId:'audit',sourceId:'local',accountNamespace:'local',nativeId:'audit',history:'group'})
    h.receive('local','operator',{id:'approval',thread:'audit',scope:'audit',text:'Authorize this fixed local audit to compute result.json total 42 and return its independently accepted result to the configured callback. Never deploy.',addressed:true})
    const request={operationId:'approve',triggerId:'local:approval',authorizationQuote:'Authorize this fixed local audit',namespace:'upgrade',eventSource:event.source,eventTypes:[event.type],secretEnvs:['WH_UPGRADE_IN'],parameters:{batch:{type:'string'}},template:{title:'Upgrade audit',objective:'Write result.json total 42. Never deploy.',criteria:[{id:'total',description:'Total 42',check:{kind:'json_equals',path:'result.json',pointer:'/total',expected:42}}],nodes:[{id:'compute',title:'Compute',instruction:'Write result.json total 42',workerId:'one',criterionIds:['total']}]},expiresAt:Date.now()+3600000,maxEvents:10,callback:{url:callback,secretEnv:'WH_UPGRADE_OUT',idempotent:true,events:['goal.completed']}}
    const grant=h.webhooks.create(request);assert.equal(grant.protocolVersion,undefined);save('request',request);save('grant-id',grant.id)
   }
   const request=read('request'),grant=h.webhooks.create(request);assert.equal(grant.id,read('grant-id'))
   assert.throws(()=>h.webhooks.create({...request,template:{...request.template,objective:'Changed goal'}}),/operation_id_conflict/)
   const send=async()=>{const raw=JSON.stringify(event),id='attempt-'+phase,timestamp=String(Math.floor(Date.now()/1000)),r=await fetch(listener.url+'/webhooks/'+grant.id,{method:'POST',headers:{'content-type':'application/cloudevents+json','webhook-id':id,'webhook-timestamp':timestamp,'webhook-signature':signWebhook(secretFromEnv('WH_UPGRADE_IN'),id,timestamp,raw)},body:raw});assert.equal(r.status,202);return await r.json() as {duplicate:boolean}}
   assert.equal((await send()).duplicate,!old);assert.equal((await send()).duplicate,true);assert.equal(h.webhooks.receipts().length,1)
   if(!old){const deadline=Date.now()+30000;while(!h.webhooks.snapshot().deliveries.some(d=>d.state==='sent')&&Date.now()<deadline){await h.tick();await new Promise(r=>setTimeout(r,5))}assert.equal(h.store.list<any>('router-goal').length,1);assert.equal(h.store.list<any>('router-goal')[0].state,'completed');assert.equal(h.webhooks.snapshot().deliveries[0]?.state,'sent');assert.equal(workerCalls,phase==='resumed'?1:0)}
   if(phase==='resumed'){const backup=join(root,'current-backup');await backupState(config,backup);await new Promise(r=>setTimeout(r,20));h.webhooks.reconcile(true);await listener.close();await h.close();await restoreState(config,backup);restored=true}
   save(phase,{pid:process.pid,implementation,workerCalls,restored,receiptCount:1,commandReplay:true})
  }finally{if(!restored){await listener.close();await h.close()}}
 }
}
