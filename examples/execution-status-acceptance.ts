/** Cloud-local real app/browser fixture. Deterministic model, no external effects. */
import {mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {randomUUID} from 'node:crypto'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
import {serve} from '../src/server.ts'
import type {Model} from '../src/model.ts'
import type {RouterGoal} from '../src/router-goals.ts'
import type {Run} from '../src/store.ts'
const root=resolve(process.argv[2]??'.local/status-acceptance'),workspace=join(root,'workspace')
mkdirSync(workspace,{recursive:true,mode:0o700})
const model:Model={async run(request){
 const threadId=request.threadId??'status-fixture-'+randomUUID(),turnId=randomUUID();request.onThread?.(threadId);request.onTurn?.(turnId)
 const input=JSON.parse(request.input)
 if(input.kind==='goal_verification'){
  for(const evidence of input.evidence)await request.onTool!('goal_evidence',{id:evidence.id},'inspect-'+evidence.id)
  return {threadId,turnId,text:JSON.stringify({checks:input.criteria.map((criterion:any)=>({criterionId:criterion.id,verdict:'passed',explanation:'Deterministic fixture inspected the retained evidence.',evidenceIds:input.evidence.filter((e:any)=>criterion.id==='__goal__'||e.criterionIds.includes(criterion.id)).map((e:any)=>e.id)}))})}
 }
 if(request.role==='worker')writeFileSync(join(request.cwd,'status-result.json'),'{"total":42}')
 return {threadId,turnId,text:JSON.stringify(request.role==='worker'?{state:'ready',summary:'Deterministic local result retained.',reply:'Local fixture result.',question:null,askedBy:null,handbacks:[]}:{reply:'Local fixture.'})}
}}
const config=configSchema.parse({stateDir:join(root,'state'),port:0,acceptMode:'auto',work:{sandboxDriver:'disabled',autoRecover:false},execution:{router:{mode:'host'},management:{enabled:true,maxWorkers:2},workers:[{id:'research',backend:'codex'},{id:'review',backend:'codex'}]},sources:[{id:'local',kind:'local',cwd:workspace,workspace:{mode:'source'},allowedActors:['operator']}]})
const runtime=new Runtime(config,{model}),host=await serve(runtime,{createRuntime:next=>new Runtime(next,{model})})
runtime.scopes.command({action:'scope.put',operationId:'status-scope',expectedRevision:0,scope:{id:'status-team',tenantId:'status-org',name:'Status fixture',contextBytes:128000,managers:[JSON.stringify(['local','operator'])],workerIds:['research','review'],sourceIds:['local'],backendIds:['codex']}})
runtime.scopes.command({action:'entry.bind',operationId:'status-entry',expectedRevision:0,scopeId:'status-team',sourceId:'local',accountNamespace:'local',nativeId:'status-review',history:'group'})
const accepted=runtime.receive('local','operator',{id:'status-request',thread:'status-review',scope:'status-review',text:'Continuously build, verify and repair the requested local JSON deliverable. Never deploy.',addressed:true}) as {triggerId:string}
const trigger=runtime.store.triggers.get(accepted.triggerId)!,context=runtime.scopes.context(trigger,'local:status-review')!
const goal=runtime.goals.command({action:'start',operationId:'status-goal',expectedRevision:0,title:'Independent status fixture',objective:'Produce status-result.json with total 42. Never deploy.',authorizationQuote:'Continuously build, verify and repair',maxReplans:0,criteria:[{id:'total',description:'JSON total equals 42',check:{kind:'json_equals',path:'status-result.json',pointer:'/total',expected:42}}],nodes:[{id:'build',title:'Build fixture',instruction:'Write the local JSON fixture.',workerId:'research',criterionIds:['total']}]},context) as RouterGoal
const deadline=Date.now()+30000
while(runtime.goals.get(goal.id)?.state!=='completed'){
 await runtime.tick();if(Date.now()>deadline)throw Error('Status fixture goal did not settle');await new Promise(done=>setTimeout(done,2))
}
const completed=runtime.goals.get(goal.id)!,verifiedTicketId=completed.nodes![0]!.ticketId!
// Synthetic held outbox fixture: no message is sent to any third party.
runtime.store.outbox.send({id:'status-held-delivery',ticketId:verifiedTicketId,kind:'reply',channel:trigger.channel!,text:'Synthetic held local notification.'})
runtime.store.db.prepare("UPDATE outbox SET status='held' WHERE id='status-held-delivery'").run()
const next=runtime.receive('local','operator',{id:'status-uncertain',thread:'status-uncertain',text:'Inspect a deterministic uncertain-effect fixture without repeating its work.',addressed:true}) as {triggerId:string}
const decision=runtime.engine.decide(next.triggerId,{kind:'accept',title:'Unknown-effect fixture',scope:'Inspect existing fixture receipts.',reason:'Local acceptance fixture',rules:[]})
const unknownTicketId=decision.ticketId!,ticket=runtime.store.tickets.get(unknownTicketId)!,assignment=ticket.assignments.at(-1)!
runtime.engine.assignmentStarted(ticket.id,assignment.id)
runtime.store.put('run',ticket.id,{ticketId:ticket.id,assignmentId:assignment.id,cwd:workspace,phase:'uncertain',threadId:'unknown-fixture-session',backendId:'codex',workerId:'review',error:'outcome_unknown'} satisfies Run)
runtime.store.put('tool-receipt','status-uncertain-tool',{id:'status-uncertain-tool',ticketId:ticket.id,state:'uncertain',connection:'fixture-only',tool:'synthetic',fingerprint:'fixture-only'})
runtime.engine.report(ticket.id,{state:'blocked',summary:'An existing synthetic effect needs reconciliation.',question:null})
const token=readFileSync(host.tokenPath,'utf8').trim(),password='Local-status-'+randomUUID()+'A!',username='status-preview'
const response=await fetch(host.url+'/account/setup',{method:'POST',headers:{authorization:'Bearer '+token,origin:host.url,'content-type':'application/json'},body:JSON.stringify({username,displayName:'Status acceptance',password,remember:true})})
if(!response.ok)throw Error('Use a fresh fixture directory: '+response.status)
const cookie=response.headers.get('set-cookie')!.split(';')[0]!
writeFileSync(join(root,'browser.json'),JSON.stringify({base:host.url,url:host.url+'/configure#execution-trace',cookie,verifiedTicketId,unknownTicketId,mode:'actual local application; synthetic model and held/unknown receipt fixtures; no provider calls'}),{mode:0o600})
let last=''
const control=setInterval(()=>{try{const path=join(root,'control.json');if(!existsSync(path))return;const raw=readFileSync(path,'utf8');if(raw===last)return;last=raw;const request=JSON.parse(raw);if(request.action==='change_artifact'){writeFileSync(join(workspace,'status-result.json'),'{"total":43}');writeFileSync(join(root,'control-result.json'),JSON.stringify({id:request.id,state:'changed'}),{mode:0o600})}}catch{/* Fixture control never echoes arbitrary input. */}},100)
runtime.start()
console.log(JSON.stringify({url:host.url+'/configure#execution-trace',info:join(root,'browser.json'),mode:'deterministic local fixtures, no real IM or ACP calls'}))
async function close(){clearInterval(control);host.server.closeAllConnections();await new Promise<void>(done=>host.server.close(()=>done()));await host.closeRuntime()}
process.once('SIGTERM',()=>void close());process.once('SIGINT',()=>void close())
