import {it,expect,afterEach} from 'vitest'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createServer} from 'node:http'
import {Runtime} from '../src/runtime.ts'
import {serve} from '../src/server.ts'
import {configSchema} from '../src/config.ts'
import type {Model,ModelRequest} from '../src/model.ts'
import type {RouterAdmission} from '../src/router-ingress.ts'
import type {Assessment} from '../src/schemas.ts'
import {bodyDigest} from '../src/sources.ts'

const roots:string[]=[],hosts:Runtime[]=[]
afterEach(async()=>{for(const h of hosts.splice(0))await h.close();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true})})
const rules=[{id:'build',instruction:'Investigate failed builds and report evidence.'},{id:'docs',instruction:'Update docs when an API changes.'}]
const accept:Assessment={action:'accept',title:'Investigate build',scope:'Investigate the failed build only',reason:'Build failure matches build rule',rules:['build'],targetTicketId:null,ruleAssessments:[{id:'build',matched:true,reason:'Build failed'},{id:'docs',matched:false,reason:'No API change'}]}
const report={state:'ready',summary:'Checked build',reply:'Worker evidence',question:null,askedBy:null,handbacks:[]}
function config(extra:Record<string,unknown>={}){
 const root=mkdtempSync(join(tmpdir(),'router-ingress-'));roots.push(root)
 return configSchema.parse({stateDir:join(root,'state'),work:{sandboxDriver:'disabled'},acceptMode:'auto',rules,execution:{router:{mode:'host',model:'terra',effort:'medium'},management:{enabled:true},workers:[{id:'one',backend:'codex',model:'sol',effort:'high'}]},sources:[{id:'local',kind:'local',cwd:root,allowedActors:['operator'],allowedBots:['build-bot'],observed:true,workspace:{mode:'source'}}],...extra})
}
function host(c=config(),model:Model=fixture([])){const h=new Runtime(c,{model});hosts.push(h);return h}
async function until(h:Runtime,predicate:()=>boolean){for(let i=0;i<400;i++){await h.tick();await new Promise(r=>setTimeout(r,3));if(predicate())return}throw Error('Did not settle: '+JSON.stringify(h.store.list('router-admission')))}
function fixture(calls:ModelRequest[],decision:unknown=accept):Model{return {async run(r){
 calls.push(r);const threadId=r.threadId??'thread-'+calls.length,turnId='turn-'+calls.length;r.onThread?.(threadId);r.onTurn?.(turnId)
 if(r.schema===undefined)throw Error('Missing schema')
 const input=JSON.parse(r.input)
 if(r.ephemeral)return {threadId,turnId,text:JSON.stringify(decision)}
 if(r.role==='router'){
  if(input.kind!=='worker_result'){
   const list=await r.onTool!('worker_manage',{action:'list'},'list')
   const revision=JSON.parse((list.contentItems[0] as any).text).revision
   const response=await r.onTool!('worker_manage',{action:'assign',id:'one',revision,requestId:'task-'+input.trigger.id,text:input.mandate.scope},'assign')
   if(!response.success)throw Error(JSON.stringify(response))
  }
  return {threadId,turnId,text:JSON.stringify({reply:input.kind==='worker_result'?'Router summary':''})}
 }
 return {threadId,turnId,text:JSON.stringify(report)}
}}}
const receive=(h:Runtime,id='event',human=false,addressed=true,actor=human?'operator':'build-bot')=>h.receive('local',actor,{id,thread:'discussion',text:'Build failed',addressed},human) as any
const admission=(h:Runtime,id='event')=>h.store.list<RouterAdmission>('router-admission').find(r=>r.triggerId.endsWith(id))!

it('routes a rule-admitted bot through Router and preserves inferred authority in the Worker mandate',async()=>{
 const calls:ModelRequest[]=[],h=host(config(),fixture(calls));receive(h)
 await until(h,()=>h.store.deliveries().some(d=>d.text==='Router summary'&&d.status==='sent'))
 expect(calls.map(r=>r.ephemeral?'admission':r.role)).toEqual(['admission','router','worker','router'])
 expect(calls.filter(r=>r.role==='router').every(r=>r.options?.effort==='medium')).toBe(true)
 expect(calls.find(r=>r.role==='worker')?.options?.effort).toBe('high')
 const ticket=h.store.tickets.list()[0]!
 expect(ticket.mandate).toMatchObject({strength:'inferred',actor:{id:'build-bot'},basis:{via:'bot',rules:['build']}})
 expect(h.store.list<any>('worker-assignment')[0]).toMatchObject({mode:'host',discussion:'local:discussion'})
 expect(h.store.deliveries().filter(d=>!d.channel.address.routerInbox).map(d=>d.text)).toEqual(['Router summary'])
 expect(admission(h)).toMatchObject({state:'accepted',assessment:accept})
})

it.each(['off','observe'] as const)('never dispatches inferred work in %s mode',async mode=>{
 const calls:ModelRequest[]=[],h=host(config({acceptMode:mode}),fixture(calls));receive(h)
 if(mode==='observe')await until(h,()=>admission(h).state==='observed');else await h.tick()
 expect(calls.map(r=>r.ephemeral)).toEqual(mode==='observe'?[true]:[])
 expect(h.store.tickets.list()).toHaveLength(0);expect(h.store.list('router-result')).toHaveLength(0)
})

it.each([
 ['no match',{...accept,rules:[],ruleAssessments:accept.ruleAssessments!.map(a=>({...a,matched:false}))},'ignored'],
 ['missing rule',{...accept,ruleAssessments:accept.ruleAssessments!.slice(0,1)},'unavailable'],
 ['inconsistent rules',{...accept,rules:['docs']},'unavailable'],
 ['duplicate rule',{...accept,ruleAssessments:[accept.ruleAssessments![0],accept.ruleAssessments![0]]},'unavailable'],
 ['stop',{...accept,action:'stop'},'ignored'],
 ['unknown attachment',{...accept,action:'attach',targetTicketId:'foreign'},'unavailable'],
 ['empty scope',{...accept,scope:'   '},'unavailable'],
] as const)('blocks %s without Worker execution',async(_name,decision,state)=>{
 const calls:ModelRequest[]=[],h=host(config(),fixture(calls,decision));receive(h)
 await until(h,()=>admission(h).state===state)
 expect(calls).toHaveLength(1);expect(h.store.tickets.list()).toHaveLength(0)
})

it('honors explicit admission for an unlisted human and does not require allowedActors membership',async()=>{
 const calls:ModelRequest[]=[],c=config({acceptMode:'off'});c.sources[0]!.admission.default={listedUnaddressed:'inferred',unlistedAddressed:'explicit',unlistedUnaddressed:'ignore'}
 const h=host(c,fixture(calls));receive(h,'human',true,true,'guest')
 await until(h,()=>h.store.deliveries().some(d=>d.text==='Router summary'&&d.status==='sent'))
 expect(calls.some(r=>r.ephemeral)).toBe(false)
 expect(h.store.tickets.list()[0]!.mandate).toMatchObject({strength:'explicit',actor:{id:'guest'},basis:{via:'admission',cell:'unlistedAddressed'}})
})

it('uses a valid conversation anchor for unaddressed follow-ups and never fans user messages out to Workers',async()=>{
 const calls:ModelRequest[]=[],h=host(config(),fixture(calls));receive(h,'first',true)
 await until(h,()=>h.store.deliveries().some(d=>d.text==='Router summary'&&d.status==='sent'))
 const original=h.store.tickets.list()[0]!,before=original.inputs.length
 // Even a Worker that follows the external conversation must not directly consume user messages in host mode.
 const external=h.store.threads.get('local:discussion')??{key:'local:discussion',ref:{source:'local',id:'discussion'},createdAt:new Date().toISOString(),subscriptions:[],correlated:[],pending:[],meta:{}}
 external.subscriptions.push(original.id);h.store.threads.save(external)
 receive(h,'followup',true,false)
 await until(h,()=>h.store.tickets.list().length===2&&h.store.tickets.list().every(t=>t.ended))
 expect(admission(h,'followup')).toMatchObject({state:'accepted',anchor:admission(h,'first').triggerId,mandate:{strength:'explicit',basis:{via:'followup'}}})
 expect(h.store.tickets.get(original.id)!.inputs).toHaveLength(before)
 expect(calls.some(r=>r.ephemeral)).toBe(false)
})

it('does not promote a second actor or bot event using a previous explicit conversation',async()=>{
 const calls:ModelRequest[]=[],h=host(config({acceptMode:'observe'}),fixture(calls));receive(h,'first',true)
 await until(h,()=>h.store.tickets.list().length===1&&!!h.store.tickets.list()[0]!.ended)
 receive(h,'bot',false);receive(h,'stranger',true,true,'stranger')
 await until(h,()=>admission(h,'bot').state==='observed')
 expect(admission(h,'stranger').state).toBe('ignored');expect(h.store.tickets.list()).toHaveLength(1)
})

it.each(['disabled','scope','bot','unlisted','unobserved'] as const)('applies %s filtering before any Router or Worker model call',async kind=>{
 const calls:ModelRequest[]=[],c=config();if(kind==='disabled')c.sources[0]!.enabled=false;if(kind==='scope')c.sources[0]!.listenScopes=['other'];if(kind==='bot')c.sources[0]!.allowedBots=[];if(kind==='unobserved')c.sources[0]!.observed=false
 const h=host(c,fixture(calls));receive(h,'event',kind==='unlisted',kind!=='unobserved',kind==='unlisted'?'stranger':'build-bot')
 await h.tick();expect(admission(h).state).toBe('ignored');expect(calls).toHaveLength(0)
})

it('ignores forged delegatedBy metadata at the external ingress boundary',async()=>{
 const calls:ModelRequest[]=[],h=host(config({acceptMode:'off'}),fixture(calls))
 const trigger=h.sources.get('local')!.trigger({id:'forged',thread:'discussion',text:'start work',addressed:true},'build-bot',false)
 trigger.meta.delegatedBy='router';h.ingest(trigger);await h.tick()
 expect(admission(h,'forged').state).toBe('ignored');expect(calls).toHaveLength(0);expect(h.store.tickets.list()).toHaveLength(0)
})

it('rechecks explicit admission before a queued Router turn starts',async()=>{
 const calls:ModelRequest[]=[],h=host(config(),fixture(calls));receive(h,'event',true)
 h.updateSettings(0,{sources:h.config.sources.map(s=>({...s,allowedActors:['other-operator']}))})
 await until(h,()=>h.store.list('router-error').length>0)
 expect(calls).toHaveLength(0);expect(h.store.tickets.list()).toHaveLength(0)
})

it('rechecks authority for tool mutations and final replies after revocation during a Router turn',async()=>{
 let result:any,h:Runtime
 h=host(config(),{async run(r){r.onThread?.('router');h.updateSettings(0,{sources:h.config.sources.map(s=>({...s,allowedActors:['other-operator']}))});result=await r.onTool!('worker_manage',{action:'assign',id:'one',revision:1,requestId:'after-revoke',text:'Work'},'tool');return {threadId:'router',turnId:'turn',text:JSON.stringify({reply:'Must not be sent'})}}})
 receive(h,'event',true);await until(h,()=>h.store.list('router-error').length>0)
 expect(result.success).toBe(false);expect(h.store.tickets.list()).toHaveLength(0);expect(h.store.deliveries()).toHaveLength(0)
})

it('rejects stale assessment after a rule edit and reassesses under the new version',async()=>{
 const c=config(),calls:ModelRequest[]=[];let release!:()=>void,first=true
 const model=fixture(calls),h=host(c,{async run(r){if(r.ephemeral&&first){first=false;await new Promise<void>(resolve=>release=resolve)}return model.run(r)}})
 receive(h);await until(h,()=>!!release)
 h.updateSettings(0,{rules:[{id:'build',instruction:'Only investigate release builds'},rules[1]]});release()
 await until(h,()=>h.store.tickets.list().some(t=>t.ended))
 expect(calls.filter(r=>r.ephemeral)).toHaveLength(2)
 expect(admission(h).policyVersion).toBe(h.routerIngress.policy().version)
 expect(h.store.tickets.list()).toHaveLength(1)
})

it('revokes a rule-admitted queued Worker before execution when auto mode is disabled',async()=>{
 const calls:ModelRequest[]=[],h=host(config(),fixture(calls));receive(h)
 await until(h,()=>h.store.tickets.list().length===1)
 h.updateSettings(0,{acceptMode:'off'})
 await until(h,()=>h.store.tickets.list()[0]!.assignments.at(-1)?.report?.state==='blocked')
 expect(calls.some(r=>r.role==='worker')).toBe(false)
})

it('keeps rule-triggered management within task execution and forbids stopping or reconfiguring Workers',async()=>{
 const h=host();receive(h)
 const a=admission(h);h.store.atomic(()=>h.routerIngress.decide(a.triggerId,a.policyVersion,accept))
 const context={discussion:a.discussion,trigger:h.store.triggers.get(a.triggerId)!}
 for(const action of ['configure','cancel','destroy'])await expect(h.manager.call({action,id:'one',requestId:action,revision:0},context)).rejects.toThrow('Inferred work')
 expect(h.manager.list().workers[0]!.state).toBeUndefined()
})

it('recovers pending admissions once across restart and does not repeat Router delegation on event replay',async()=>{
 const c=config(),calls:ModelRequest[]=[],h=host(c,fixture(calls));receive(h);await h.close();hosts.splice(hosts.indexOf(h),1)
 const restored=host(configSchema.parse(c),fixture(calls));expect(receive(restored).disposition).toBe('duplicate')
 await until(restored,()=>restored.store.deliveries().some(d=>d.text==='Router summary'&&d.status==='sent'))
 const count=calls.length;expect(receive(restored).disposition).toBe('duplicate');await restored.tick()
 expect(calls).toHaveLength(count);expect(restored.store.tickets.list()).toHaveLength(1)
})

it('moves old queued Engine evaluations into Router admission without direct Worker dispatch',async()=>{
 const c=config(),calls:ModelRequest[]=[],h=host(c,fixture(calls))
 const trigger=h.sources.get('local')!.trigger({id:'old',thread:'discussion',text:'Build failed',addressed:true},'build-bot',false)
 h.engine.receive(trigger);h.engine.evaluateDue()
 await until(h,()=>h.store.deliveries().some(d=>d.text==='Router summary'&&d.status==='sent'))
 expect(calls.map(r=>r.ephemeral?'admission':r.role)).toEqual(['admission','router','worker','router'])
 expect(h.store.tickets.list()).toHaveLength(1)
})

it('admits unaddressed human work by rules without promoting it to explicit authority',async()=>{
 const calls:ModelRequest[]=[],h=host(config(),fixture(calls));receive(h,'event',true,false)
 await until(h,()=>h.store.tickets.list().some(t=>t.ended))
 expect(calls.filter(r=>r.ephemeral)).toHaveLength(1)
 expect(h.store.tickets.list()[0]!.mandate).toMatchObject({strength:'inferred',basis:{via:'admission',cell:'listedUnaddressed',rules:['build']}})
})

it('retains the original receiving scope when delivering a Router reply',async()=>{
 const c=config();c.sources[0]!.listenScopes=['engineering']
 const h=host(c,{async run(){return {threadId:'router',turnId:'turn',text:JSON.stringify({reply:'Scoped Router reply'})}}})
 h.receive('local','operator',{id:'scoped',thread:'discussion',text:'Hello',scope:'engineering',addressed:true})
 await until(h,()=>h.store.deliveries().some(d=>d.text==='Scoped Router reply'&&d.status==='sent'))
})

it('withdraws a queued Router reply if its authority is revoked before delivery',async()=>{
 const c=config();c.sources[0]!.capabilities.replies=false
 const h=host(c,{async run(){return {threadId:'router',turnId:'turn',text:JSON.stringify({reply:'Pending reply'})}}})
 receive(h,'event',true);await until(h,()=>h.store.deliveries().some(d=>d.status==='pending'))
 h.updateSettings(0,{sources:h.config.sources.map(s=>({...s,allowedActors:['other-operator']}))});await h.flush()
 expect(h.store.deliveries().map(d=>d.status)).toEqual(['dropped'])
})

it('releases the conversation after an orphaned Worker-result job fails',async()=>{
 let turns=0
 const h=host(config(),{async run(){turns++;return {threadId:'router',turnId:'turn',text:JSON.stringify({reply:''})}}})
 receive(h,'first',true);await until(h,()=>h.store.list('router-result').length===1)
 h.store.enqueue('router:result:missing','router',{discussion:'local:discussion',triggerId:admission(h,'first').triggerId,messageId:'missing'})
 await until(h,()=>h.store.list('router-error').length===1)
 expect(h.status().active).toBe(0)
 receive(h,'second',true);await until(h,()=>turns===2)
})

it('rechecks a report read through inspect before returning it under a different admitted input',async()=>{
 const calls:ModelRequest[]=[],model=fixture(calls);let h:Runtime,inspected=false
 h=host(config(),{async run(r){
  const input=JSON.parse(r.input)
  if(r.role==='router'&&!r.ephemeral&&input.kind==='user_message'){
   const result=await r.onTool!('worker_manage',{action:'inspect',ticketId:h.store.tickets.list()[0]!.id},'inspect')
   expect(result.success).toBe(true);inspected=true
   h.updateSettings(0,{acceptMode:'off'})
   return {threadId:'router',turnId:'inspection',text:JSON.stringify({reply:'Revoked report must not be forwarded'})}
  }
  return model.run(r)
 }})
 receive(h,'bot',false);await until(h,()=>h.store.deliveries().some(d=>d.text==='Router summary'&&d.status==='sent'))
 receive(h,'human',true);await until(h,()=>h.store.list('router-error').length>0)
 expect(inspected).toBe(true)
 expect(h.store.deliveries().some(d=>d.text==='Revoked report must not be forwarded')).toBe(false)
})

it('does not strand an admission when a changed policy is later restored',async()=>{
 const c=config(),h=host(c),aVersion=h.routerIngress.policy().version;receive(h)
 const id=admission(h).triggerId,firstJob=h.store.jobs()[0]!
 h.store.jobState(firstJob.id,'done')
 h.updateSettings(0,{rules:[{id:'build',instruction:'Changed rule'},rules[1]]})
 h.store.atomic(()=>h.routerIngress.refresh(id,aVersion))
 const bVersion=admission(h).policyVersion
 h.updateSettings(1,{rules});h.store.atomic(()=>h.routerIngress.refresh(id,bVersion))
 expect(admission(h).policyVersion).toBe(aVersion)
 expect(admission(h).generation).toBe(3)
 expect(h.store.jobs().some(j=>(j.payload as any).policyVersion===aVersion)).toBe(true)
 await until(h,()=>h.store.tickets.list().some(t=>t.ended))
 expect(h.store.tickets.list()).toHaveLength(1)
})

it('restores a pre-admission explicit delegation on restart without repeating its Router turn',async()=>{
 const c=config(),calls:ModelRequest[]=[],h=host(c,fixture(calls));receive(h,'event',true)
 await until(h,()=>h.store.tickets.list().length===1)
 // Simulate the previous host version, whose delegation and Router result existed without admission records.
 h.store.db.prepare("DELETE FROM records WHERE kind IN ('router-admission','router-delegation')").run()
 await h.close();hosts.splice(hosts.indexOf(h),1)
 const count=calls.filter(r=>r.role==='router').length,restored=host(configSchema.parse(c),fixture(calls))
 expect(admission(restored)).toMatchObject({state:'accepted',reason:'Restored legacy explicit Router input'})
 await until(restored,()=>restored.store.deliveries().some(d=>d.text==='Router summary'&&d.status==='sent'))
 expect(calls.filter(r=>r.role==='router')).toHaveLength(count+1) // result aggregation only
 expect(restored.store.tickets.list()).toHaveLength(1)
})

it('holds unowned legacy tasks and deliveries on host-mode upgrade and ignores their source replay',async()=>{
 const calls:ModelRequest[]=[],h=host(config(),fixture(calls))
 const trigger=h.sources.get('local')!.trigger({id:'old',thread:'discussion',text:'Old accepted work',addressed:true},'operator',true)
 h.engine.receive(trigger)
 const d=h.engine.decide(trigger.id,{kind:'accept',title:'Old task',scope:'Old work',reason:'Before host mode',rules:[],acknowledgement:'Old acknowledgement'})
 await h.tick()
 expect(calls).toHaveLength(0);expect(h.status().routerMigrations).toHaveLength(1)
 expect(h.store.deliveries().every(d=>d.status==='pending')).toBe(true)
 expect((h.ingest(trigger) as any).disposition).toBe('duplicate')
 expect(h.store.tickets.list().map(t=>t.id)).toEqual([d.ticketId])
})

it('blocks managed Worker tools if the rule authority is withdrawn during execution',async()=>{
 const calls:ModelRequest[]=[],delegate=fixture(calls);let h:Runtime,denied=false
 h=host(config(),{async run(r){
  if(r.role==='worker'){
   h.updateSettings(0,{acceptMode:'off'})
   try{const result=await r.onTool!('superagent_progress',{summary:'Must not run'},'progress');denied=!result.success}catch{denied=true}
  }
  return delegate.run(r)
 }})
 receive(h);await until(h,()=>denied)
 expect(denied).toBe(true)
})

it.each(['auto','observe'] as const)('routes a bot update of existing human-owned work through Router in %s mode',async mode=>{
 let task='',workerRuns=0,sent=false,h:Runtime
 h=host(config({acceptMode:mode}),{async run(r){
  const threadId=r.threadId??'thread-'+r.role,turnId='turn';r.onThread?.(threadId);r.onTurn?.(turnId)
  if(r.ephemeral){expect(JSON.parse(r.input).existing.map((t:any)=>t.id)).toContain(task);return {threadId,turnId,text:JSON.stringify({...accept,action:'attach',targetTicketId:task})}}
  if(r.role==='worker'){workerRuns++;return {threadId,turnId,text:JSON.stringify(workerRuns===1?{...report,state:'waiting',reply:''}:report)}}
  const input=JSON.parse(r.input)
  if(input.kind==='user_message'){
   const result=await r.onTool!('worker_manage',{action:'assign',id:'one',revision:0,requestId:'initial',text:'Investigate and wait for build results'},'assign')
   task=JSON.parse((result.contentItems[0] as any).text).ticketId
  }
  if(input.kind==='event'){
   const result=await r.onTool!('worker_manage',{action:'send',ticketId:task,revision:0,requestId:'bot-update',text:'The build failed; inspect the new evidence within the existing task'},'send')
   expect(result.success).toBe(true);sent=true
  }
  return {threadId,turnId,text:JSON.stringify({reply:''})}
 }})
 receive(h,'human',true);await until(h,()=>workerRuns===1&&h.store.tickets.get(task)?.assignments.at(-1)?.report?.state==='waiting')
 receive(h,'bot',false)
 await until(h,()=>mode==='observe'?admission(h,'bot').state==='observed':workerRuns===2&&!!h.store.tickets.get(task)?.ended)
 // The admission attach is now bound directly to the original task, not another free Router turn.
 expect(sent).toBe(false);expect(workerRuns).toBe(mode==='auto'?2:1)
 const attached=h.store.get<any>('worker-command',bodyDigest([admission(h,'bot').discussion,'admit:'+admission(h,'bot').triggerId]))
 if(mode==='auto')expect(attached).toMatchObject({status:'completed',result:{ticketId:task,status:'queued'}});else expect(attached).toBeUndefined()
 expect(h.store.tickets.list()).toHaveLength(1)
 expect(h.store.tickets.get(task)!.mandate.strength).toBe('explicit') // original task mandate never changes
 expect(h.store.tickets.get(task)!.inputs.some(i=>i.kind==='trigger'&&i.triggerId===admission(h,'bot').triggerId)).toBe(false)
})

it('accepts a real HTTP bot event, runs four Workers under one Router, and sends only the Router summary to the callback',async()=>{
 const delivered:any[]=[],calls:ModelRequest[]=[],callback=createServer(async(req,res)=>{let body='';for await(const part of req)body+=part;delivered.push(JSON.parse(body));res.end('ok')})
 await new Promise<void>(r=>callback.listen(0,'127.0.0.1',r))
 const previous=process.env.AGENTHUB_ROUTER_INGRESS_TOKEN;process.env.AGENTHUB_ROUTER_INGRESS_TOKEN='router-ingress-test'
 let endpoint:Awaited<ReturnType<typeof serve>>|undefined,summarized=false
 try{
  const c=config();c.port=0
  c.sources.push({...c.sources[0]!,id:'events',kind:'webhook',replyUrl:'http://127.0.0.1:'+(callback.address() as any).port,tokenEnv:'AGENTHUB_ROUTER_INGRESS_TOKEN',listenScopes:['engineering']})
  c.execution.workers=Array.from({length:4},(_,i)=>({id:'worker-'+i,backend:'codex',model:'sol',effort:'high'}))
  let h:Runtime
  h=host(c,{async run(r){
   calls.push(r);const threadId=r.threadId??'http-thread-'+calls.length,turnId='turn-'+calls.length;r.onThread?.(threadId);r.onTurn?.(turnId)
   if(r.ephemeral)return {threadId,turnId,text:JSON.stringify(accept)}
   if(r.role==='worker')return {threadId,turnId,text:JSON.stringify({...report,reply:'Evidence '+r.activity?.workerId})}
   const input=JSON.parse(r.input)
   if(input.kind==='event')for(let i=0;i<4;i++){
    const response=await r.onTool!('worker_manage',{action:'assign',id:'worker-'+i,revision:0,requestId:'part-'+i,text:'Investigate failed build part '+i},'assign-'+i)
    if(!response.success)throw Error(JSON.stringify(response))
   }
   const complete=input.kind==='worker_result'&&!summarized&&h.store.tickets.list().length===4&&h.store.tickets.list().every(t=>t.ended)
   if(complete)summarized=true
   return {threadId,turnId,text:JSON.stringify({reply:complete?'Router checked all four results':''})}
  }})
  endpoint=await serve(h)
  const body={actor:'build-bot',human:false,event:{id:'http-event',thread:'build-42',text:'Build failed',addressed:true,scope:'engineering',message:{id:'build-message'}}}
  const post=()=>fetch(endpoint!.url+'/events/events',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer router-ingress-test'},body:JSON.stringify(body)})
  expect((await post()).status).toBe(202)
  await until(h,()=>delivered.length===1)
  expect(delivered.map(m=>m.text)).toEqual(['Router checked all four results'])
  expect(delivered[0].channel).toMatchObject({source:'events',thread:'build-42',address:{messageId:'build-message'}})
  expect(calls.filter(r=>r.role==='worker')).toHaveLength(4)
  expect(calls.filter(r=>r.role==='worker').every(r=>r.model==='sol'&&r.options?.effort==='high')).toBe(true)
  expect(calls.filter(r=>r.role==='router'&&!r.threadId).every(r=>r.model==='terra'&&r.options?.effort==='medium')).toBe(true)
  const routerTurns=calls.filter(r=>r.role==='router'&&!r.ephemeral)
  expect(routerTurns.slice(1).every(r=>r.threadId==='http-thread-2'&&r.options?.effort==='medium')).toBe(true)
  expect(h.store.list('router-session')).toHaveLength(1)
  expect(h.store.list('router-inbox')).toHaveLength(4)
  expect(h.store.tickets.list().every(t=>t.mandate.strength==='inferred'&&t.mandate.basis.rules?.includes('build'))).toBe(true)
  expect(await (await post()).json()).toMatchObject({disposition:'duplicate'})
  await h.tick();expect(delivered).toHaveLength(1)
 }finally{
  if(endpoint){endpoint.server.closeAllConnections();await new Promise<void>(r=>endpoint!.server.close(()=>r()))}
  callback.closeAllConnections();await new Promise<void>(r=>callback.close(()=>r()))
  if(previous===undefined)delete process.env.AGENTHUB_ROUTER_INGRESS_TOKEN;else process.env.AGENTHUB_ROUTER_INGRESS_TOKEN=previous
 }
})
