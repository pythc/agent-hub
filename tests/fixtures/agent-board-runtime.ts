/** Synthetic acceptance records in an isolated REAL Runtime. No external model or application calls. */
import {join} from 'node:path'
import {configSchema} from '../../src/config.ts'
import {Runtime} from '../../src/runtime.ts'
import type {Ticket} from '../../src/vendor/dsh-core/index.ts'

export function boardRuntime(root:string){
  const config=configSchema.parse({stateDir:join(root,'state'),port:0,work:{sandboxDriver:'disabled'},
    execution:{workers:[{id:'research',label:'Research',backend:'codex',model:'gpt-6.1-sol',prompt:'PRIVATE_WORKER_PROMPT'},{id:'planning',label:'Planning',backend:'codex',model:'gpt-6.1-sol'},{id:'review',label:'Review',backend:'codex',model:'gpt-6.1-sol'},{id:'build',label:'Build',backend:'codex',model:'gpt-6.1-sol'}]},models:{router:'gpt-6.1-terra'},
    sources:[{id:'product',label:'#product',kind:'local',cwd:root,allowedActors:['operator']},{id:'personal',label:'Personal workspace',kind:'local',cwd:root,allowedActors:['operator']}]})
  return new Runtime(config,{model:{async run(){throw Error('Board acceptance must not call a model')}}})
}
export function seedBoard(host:Runtime,count=32){
  const titles=['Investigate the sign-in redirect','Prepare the release checklist','Review the onboarding changes','Research the integration API','Fix the notification retry','Summarize this week’s feedback']
  for(let i=0;i<count;i++){
    const source=i%3===0?'personal':'product'
    const {triggerId}=host.receive(source,'operator',{id:'board-event-'+i,thread:'board-fixture',text:'Acceptance fixture message '+i,addressed:true}) as {triggerId:string}
    const trigger=host.store.triggers.get(triggerId)!,at=new Date(Date.now()-i*60000).toISOString()
    const ticket:Ticket={id:'board-task-'+i,title:(titles[i%titles.length]??'Task')+(i>=6?' '+i:''),decisionId:'fixture-decision-'+i,mandate:{strength:'explicit',policyVersion:'fixture',basis:{via:'addressed',addressed:'mention'},actor:trigger.actor,scope:'Acceptance fixture only'},channels:[],assignments:[],inputs:[],undelivered:[],createdAt:at,updatedAt:at,origin:{triggerId,triggerIds:[triggerId]}}
    if(i===2||i===4)ticket.attention={id:'attention-'+i,question:i===2?'Choose the onboarding scope.':'Confirm the notification destination.'}
    if(i>5)ticket.ended={at,by:'human',outcome:'closed'}
    host.store.tickets.save(ticket)
    const workerId=['research','planning','review','build'][i%4]!
    if(i<2)host.store.put('run',ticket.id,{ticketId:ticket.id,assignmentId:'fixture-assignment',cwd:'/private/fixture',phase:'running',workerId,model:'gpt-6.1-sol',backendId:'codex',agentOptions:{prompt:'PRIVATE_RUN_PROMPT'}})
    host.store.put('router-admission',triggerId,{triggerId,discussion:'fixture',policyVersion:'fixture',state:i%4===0?'ignored':'accepted',reason:'PRIVATE_ADMISSION_EVIDENCE',mandate:{strength:i%2?'inferred':'explicit'},at})
    if(i%3===0)host.store.put('router-candidate','batch-'+i,{id:'batch-'+i,primary:triggerId,triggerIds:[triggerId],phase:'complete',result:'PRIVATE_CANDIDATE_RESULT'})
  }
  const router=host.activity.begin('router','Router assessment',{sourceId:'product'});host.activity.update(router,{model:'gpt-6.1-terra'})
  for(const [i,workerId] of ['research','planning','review'].entries()){
    const call=host.activity.begin('worker','Review workspace changes',{workerId,ticketId:'board-task-'+i,sourceId:i===0?'personal':'product'});host.activity.update(call,{model:'gpt-6.1-sol'})
    if(i===2)host.activity.finish(call,'completed')
  }
  const failed=host.activity.begin('tool','read_document',{ticketId:'board-task-2',workerId:'review',sourceId:'product'});host.activity.finish(failed,'failed')
  const recovered=host.activity.begin('tool','read_document',{ticketId:'board-task-2',workerId:'review',sourceId:'product'});host.activity.finish(recovered,'completed')
  for(const source of host.config.sources)host.store.put('source-health',source.id,{source:source.id,at:Date.now(),status:'ok',error:'PRIVATE_SOURCE_ERROR'})
  host.store.put('decision-call','routing-1',{id:'routing-1',at:Date.now(),revision:1,mode:'advisory',purpose:'routing',provider:'local',model:'local-classifier',status:'ok',latencyMs:42,usage:{inputTokens:360,outputTokens:18},decisions:[{id:'event',action:'REVIEW'}]})
  host.store.put('decision-call','routing-2',{id:'routing-2',at:Date.now(),revision:1,mode:'shadow',purpose:'routing',provider:'local',model:'local-classifier',status:'ok',latencyMs:37,decisions:[{id:'event',action:'IGNORE'}]})
  host.store.put('decision-call','probe',{id:'probe',at:Date.now(),revision:1,mode:'shadow',purpose:'probe',provider:'local',model:'local-classifier',status:'ok',latencyMs:40,usage:{inputTokens:99999,outputTokens:99999}})
  // Seeded records are display fixtures, not executable jobs. Serving this host must not call a model.
  host.store.db.prepare('DELETE FROM jobs').run()
  for(const thread of host.store.threads.list())host.store.threads.save({...thread,pending:[],evaluating:undefined})
}
