/** Isolated real-model, real-HTTP acceptance. Four hosts, three deliberate SIGKILLs. */
import {mkdirSync,existsSync,readFileSync,writeFileSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {spawn} from 'node:child_process'
import {createServer} from 'node:http'
import {createHash,randomBytes} from 'node:crypto'
import {fileURLToPath} from 'node:url'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
import {serveWebhooks} from '../src/webhook-http.ts'
import {secretFromEnv,signWebhook,verifyWebhook} from '../src/webhook-protocol.ts'
import type {RouterGoal} from '../src/router-goals.ts'

const root=resolve(process.env.WEBHOOK_ACCEPTANCE_DIR??'/tmp/agenthub-webhook-acceptance-'+Date.now()),cwd=join(root,'workspace'),phase=process.env.WEBHOOK_ACCEPTANCE_PHASE
const files=['webhooks','webhook-protocol','webhook-http','router-goals','router-ingress','runtime','store','config','server','agent-memory','backup','managed-config','scope-migration'].map(f=>'src/'+f+'.ts')
const implementation=Object.fromEntries(files.map(p=>[p,createHash('sha256').update(readFileSync(new URL('../'+p,import.meta.url))).digest('hex')]))
const rows=Array.from({length:18},(_,i)=>({id:'K'+String(i+1).padStart(2,'0'),category:i%2?'Y':'X',amount:7*(i+1)+3}))
const totals={X:rows.filter(r=>r.category==='X').reduce((a,r)=>a+r.amount,0),Y:rows.filter(r=>r.category==='Y').reduce((a,r)=>a+r.amount,0)}
const template={title:'Webhook intake reconciliation',objective:'Audit input.json, preserve first occurrences, reconcile category totals, and deliver an independently checked report. Work only in this local workspace. Never deploy, contact external services, or change the original acceptance criteria.',maxParallel:1,maxRepairs:2,maxReplans:0,
 criteria:[
  {id:'clean',description:'cleaned.json rows exactly equal the first eighteen distinct source records, in order.',check:{kind:'json_equals',path:'cleaned.json',pointer:'/rows',expected:rows}},
  {id:'totals',description:'summary.json totals exactly reconcile the accepted cleaned records.',check:{kind:'json_equals',path:'summary.json',pointer:'/totals',expected:totals}},
  {id:'report',description:'report.md explains 30 source records, 18 unique records and 12 duplicates, shows X='+totals.X+' and Y='+totals.Y+' and grand total '+(totals.X+totals.Y)+', names input.json, cleaned.json and summary.json as sources, and accurately describes the completed reconciliation without claiming deployment.',files:['input.json','cleaned.json','summary.json','report.md']},
 ],nodes:[
  {id:'clean',title:'Deduplicate source',instruction:'Read input.json and write cleaned.json with rows, sourceCount and duplicateCount. Controlled acceptance fault injection: only on the first attempt when cleaned.json is absent, deliberately put amount=999 in the first retained row and return ready claiming the file is correct. This tests rejection of an incorrect completion claim. When independently rejected, repair the file to satisfy the unchanged original contract. Do not create other artifacts.',workerId:'one',criterionIds:['clean']},
  {id:'totals',title:'Reconcile totals',instruction:'Read accepted cleaned.json and write summary.json with totals for X/Y, grandTotal and uniqueCount. Compute from the records and verify the arithmetic.',workerId:'one',dependsOn:['clean'],criterionIds:['totals']},
  {id:'report',title:'Explain verified result',instruction:'Read input.json, cleaned.json and summary.json. Write report.md explaining the counts, duplicate reconciliation, category totals and grand total with exact source file names. Preserve prior artifacts.',workerId:'one',dependsOn:['totals'],criterionIds:['report']},
 ]}
const event={specversion:'1.0',id:'batch-20261109-independent',source:'https://acceptance.example/intake',type:'intake.audit',data:{batch:'independent-18-records'}}

if(phase===undefined){
 if(existsSync(join(root,'state')))throw Error('Use a fresh isolated acceptance directory')
 mkdirSync(cwd,{recursive:true});writeFileSync(join(cwd,'input.json'),JSON.stringify(Array.from({length:30},(_,i)=>rows[i%18]),null,2))
 process.env.WEBHOOK_ACCEPTANCE_IN='whsec_'+randomBytes(32).toString('base64');process.env.WEBHOOK_ACCEPTANCE_OUT='whsec_'+randomBytes(32).toString('base64')
 const deliveries:{id:string;body:string;at:number;status:string}[]=[],effects=new Set<string>()
 const callback=createServer((req,res)=>{void(async()=>{
  const chunks:Buffer[]=[];for await(const c of req)chunks.push(c);const raw=Buffer.concat(chunks)
  verifyWebhook([secretFromEnv('WEBHOOK_ACCEPTANCE_OUT')],req.headers as Record<string,string>,raw)
  const id=String(req.headers['webhook-id']);effects.add(id);deliveries.push({id,body:raw.toString(),at:Date.now(),status:deliveries.length===0?'committed_without_response':deliveries.length===1?'503':'204'})
  writeFileSync(join(root,'callback-receiver.json'),JSON.stringify({deliveries,effects:[...effects]},null,2))
  if(deliveries.length===1){writeFileSync(join(root,'callback-committed'),'accepted');return}
  res.writeHead(deliveries.length===2?503:204);res.end()
 })().catch(error=>{console.error(String(error));res.writeHead(400);res.end()})})
 await new Promise<void>(r=>callback.listen(0,'127.0.0.1',r));process.env.WEBHOOK_ACCEPTANCE_CALLBACK='http://127.0.0.1:'+(callback.address() as any).port+'/callback'
 try{
  for(let p=0;p<4;p++)await new Promise<void>((resolve,reject)=>{
   const child=spawn(process.execPath,['--import','tsx',fileURLToPath(import.meta.url)],{env:{...process.env,WEBHOOK_ACCEPTANCE_DIR:root,WEBHOOK_ACCEPTANCE_PHASE:String(p)},stdio:'inherit'})
   child.once('error',reject);child.once('exit',(code,signal)=>p<3?signal==='SIGKILL'?resolve():reject(Error('Expected controlled SIGKILL at checkpoint '+p+', got '+code+' '+signal)):code===0?resolve():reject(Error('Final host failed '+code+' '+signal)))
  })
  const phases=[0,1,2,3].map(p=>JSON.parse(readFileSync(join(root,'phase-'+p+'.json'),'utf8'))),final=phases[3],goal=final.goals[0]
  const result=deliveries[0]?JSON.parse(deliveries[0].body).data.results:[]
  const checks={fourRealHostProcesses:new Set(phases.map(p=>p.pid)).size===4,threeAbruptRestarts:true,oneReceipt:final.webhooks.receipts.length===1,oneGoal:final.goals.length===1,threeTasks:final.tickets.length===3,originalContractUnchanged:JSON.stringify(phases[1].goals[0].contract)===JSON.stringify(goal.contract),falseReportIntercepted:phases[1].rounds.some((r:any)=>r.nodeId==='clean'&&r.state==='failed')&&phases[1].releases.length===0&&phases[1].webhooks.deliveries.length===0,oneAutomaticRepair:final.repairs.length===1,goalCompleted:goal.state==='completed',nativeVerifierReadEvidence:final.calls.some((c:any)=>c.name==='goal_evidence'&&c.state==='completed')&&final.sessions.some((s:any)=>s.agentId?.startsWith('goal-verify:')),sendingRecovered:phases[2].webhooks.deliveries[0]?.state==='sending',threeCallbackAttempts:deliveries.length===3,stableDeliveryId:new Set(deliveries.map(d=>d.id)).size===1,frozenCallbackBody:new Set(deliveries.map(d=>d.body)).size===1,receiverBusinessEffectOnce:effects.size===1,callbackSent:final.webhooks.deliveries[0]?.state==='sent',noTaskRerunForCallback:final.calls.filter((c:any)=>c.kind==='worker').length===phases[2].calls.filter((c:any)=>c.kind==='worker').length,correctArtifact:JSON.stringify(JSON.parse(readFileSync(join(cwd,'cleaned.json'),'utf8')).rows)===JSON.stringify(rows),unchangedImplementation:phases.every(p=>JSON.stringify(p.implementation)===JSON.stringify(implementation))}
  const resultChecks={publishedOnlyApprovedFiles:result.length===2&&result.every((r:any)=>['summary.json','report.md'].includes(r.path)),verifiedSummaryDelivered:JSON.parse(result.find((r:any)=>r.path==='summary.json')?.content??'{}').grandTotal===totals.X+totals.Y,verifiedReportDelivered:result.find((r:any)=>r.path==='report.md')?.content?.includes('input.json')===true}
  const evidence={ok:Object.values({...checks,...resultChecks}).every(Boolean),checks:{...checks,...resultChecks},goalId:goal.id,implementation,callback:{attempts:deliveries.length,effects:effects.size},source:'Real Codex Router, Worker and independent verifier; controlled wrong-artifact/false-report injection; real HTTP; actual SIGKILL process restarts; isolated from Feishu and live state.'}
  writeFileSync(join(root,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));if(!evidence.ok)process.exitCode=1
 }finally{callback.closeAllConnections();callback.close()}
}else{
 const callback=process.env.WEBHOOK_ACCEPTANCE_CALLBACK!
 const config=configSchema.parse({stateDir:join(root,'state'),webhooks:{port:0,loopbackCallbackOrigins:[new URL(callback).origin]},codex:process.env.AGENTHUB_CODEX??'codex',turnTimeoutMs:300000,work:{sandboxDriver:process.platform==='darwin'?'seatbelt':'codex',network:false},execution:{router:{mode:'host',model:'gpt-6.1-terra',effort:'medium',prompt:'This is an isolated authorized webhook acceptance. The operator configures the approved automation through the host API, and the host schedules its nodes. Do not create goals, assign tasks, change settings or write memory. For the approval input reply AUTHORIZATION RECORDED. For results inspect the existing goal if needed and return an empty reply.'},management:{enabled:true,maxWorkers:1},workers:[{id:'one',backend:'codex',model:'gpt-6.1-sol',effort:'high',tools:['superagent_shell'],prompt:'Execute only the assigned local audit stage with superagent_shell. Inspect the files and follow independent acceptance feedback. Use foreground commands; no background work, network, delegation or deployment. Return ready with a concise report when the assigned artifacts exist.'}]},sources:[{id:'local',kind:'local',cwd,sandbox:'workspace-write',workspace:{mode:'source'},allowedActors:['operator']}]})
 const h=new Runtime(config),listener=await serveWebhooks(()=>h,0)
 const snapshot=()=>({phase:Number(phase),pid:process.pid,at:Date.now(),implementation,goals:h.store.list('router-goal'),rounds:h.store.list('goal-verification'),repairs:h.store.list('goal-repair'),releases:h.store.list('goal-release'),tickets:h.store.tickets.list(),calls:h.activity.list(),sessions:h.store.list('model-session'),webhooks:h.webhooks.snapshot(),errors:h.store.list('router-error'),jobs:h.store.db.prepare('SELECT id,state,error FROM jobs').all()})
 const submit=async()=>{const grant=h.store.list<any>('webhook-grant')[0],raw=JSON.stringify(event),timestamp=String(Math.floor(Date.now()/1000)),id='attempt_'+phase;const results=await Promise.all(Array.from({length:6},()=>fetch(listener.url+'/webhooks/'+grant.id,{method:'POST',headers:{'content-type':'application/cloudevents+json','webhook-id':id,'webhook-timestamp':timestamp,'webhook-signature':signWebhook(secretFromEnv('WEBHOOK_ACCEPTANCE_IN'),id,timestamp,raw)},body:raw}).then(async r=>({status:r.status,body:await r.json()}))));if(results.some(r=>r.status!==202))throw Error('Ingress failed '+JSON.stringify(results));writeFileSync(join(root,'ingress-'+phase+'.json'),JSON.stringify(results,null,2))}
 try{
  if(phase==='0'){
   h.scopes.command({action:'scope.put',operationId:'scope',expectedRevision:0,scope:{id:'audit',tenantId:'acceptance',name:'Webhook acceptance',contextBytes:768000,managers:[JSON.stringify(['local','operator'])],workerIds:['one'],sourceIds:['local'],backendIds:['codex']}})
   h.scopes.command({action:'entry.bind',operationId:'entry',expectedRevision:0,scopeId:'audit',sourceId:'local',accountNamespace:'local',nativeId:'audit',history:'group'})
   h.receive('local','operator',{id:'approve',thread:'audit',scope:'audit',text:'Authorize the signed intake.audit event to run the attached fixed audit template, repair until independent acceptance, and publish only accepted summary.json and report.md through the configured callback. Never deploy or contact other services. Template: '+JSON.stringify(template),addressed:true})
   h.webhooks.create({operationId:'native-approval',triggerId:'local:approve',authorizationQuote:'Authorize the signed intake.audit event',namespace:'intake-audit',eventSource:event.source,eventTypes:[event.type],secretEnvs:['WEBHOOK_ACCEPTANCE_IN'],parameters:{batch:{type:'string',maxLength:100}},template,expiresAt:Date.now()+3600000,maxEvents:1,callback:{url:callback,secretEnv:'WEBHOOK_ACCEPTANCE_OUT',idempotent:true,resultFiles:['summary.json','report.md'],events:['goal.completed']}})
  }
  await submit()
  const deadline=Date.now()+25*60000;let last=0,finished=phase==='0'
  while(!finished&&Date.now()<deadline){
   await h.tick();await new Promise(r=>setTimeout(r,100))
   const goal=h.store.list<RouterGoal>('router-goal')[0]
   if(phase==='1'&&h.store.list<any>('goal-verification').some(r=>r.nodeId==='clean'&&r.state==='failed')&&!h.activity.list().some(c=>c.state==='running'))finished=true
   if(phase==='2'&&goal?.state==='completed'&&existsSync(join(root,'callback-committed')))finished=true
   if(phase==='3'&&goal?.state==='completed'&&h.webhooks.snapshot().deliveries[0]?.state==='sent'&&!h.activity.list().some(c=>c.state==='running'))finished=true
   if(goal?.state==='held')throw Error('Goal held '+goal.reason)
   if(Date.now()-last>10000){last=Date.now();writeFileSync(join(root,'progress.json'),JSON.stringify(snapshot(),null,2));console.log(JSON.stringify({phase,goal:goal?.state,nodes:goal?.nodes?.map(n=>({id:n.id,state:n.state,repairs:n.repairs})),deliveries:h.webhooks.snapshot().deliveries.map(d=>({state:d.state,attempts:d.attempts}))}))}
  }
  if(!finished)throw Error('Acceptance timed out')
  writeFileSync(join(root,'phase-'+phase+'.json'),JSON.stringify(snapshot(),null,2));console.log('CHECKPOINT '+phase)
  if(phase!=='3')process.kill(process.pid,'SIGKILL')
 }catch(error){writeFileSync(join(root,'failure-'+phase+'.json'),JSON.stringify({...snapshot(),error:String(error)},null,2));throw error}
 finally{await listener.close();await h.close()}
}
