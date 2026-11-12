import type {Runtime} from './runtime.ts'
import {ticketStage,canRetry,type Ticket,type Trigger} from './vendor/dsh-core/index.ts'
import type {ArtifactVersion} from './goal-artifacts.ts'
import type {Approval} from './approvals.ts'
import {workerProfiles} from './worker-pool.ts'
import type {Run} from './store.ts'
import {workerSpecs} from './worker-tools.ts'

const text=(value:unknown,limit=1800)=>typeof value==='string'?value.slice(0,limit):''
/** Operator-only projections. No configuration, credentials or native protocol history are copied into the work list. */
export function operatorWorkspace(host:Runtime,offset=0,limit=25,filter:{state?:string;search?:string}={}){
 const status={paused:host.isPaused,active:host.activeExecutions},tickets=host.store.tickets.list(),deliveries=host.store.deliveries(),approvals=host.store.list<Approval>('approval').filter(a=>a.status==='pending'&&a.expiresAt>Date.now())
 const runs=host.store.list<Run>('run'),model=(id:string)=>host.config.backends[id]?.model??host.config.model,router=host.config.execution.router?.backend??host.config.execution.roles.router??host.config.execution.backend
 const activity=host.activity.list().reverse().sort((a,b)=>b.startedAt-a.startedAt).map(call=>{
  const source=host.config.sources.find(s=>s.id===call.sourceId),client=call.triggerId&&host.store.get<{client:string}>('entry-client-event',call.triggerId)?.client
  const parent=call.parentId?host.store.get<import('./execution-activity.ts').ExecutionCall>('execution-call',call.parentId):undefined,backendId=call.backend??parent?.backend,backend=backendId?host.config.backends[backendId]:undefined
  return {id:call.id,parentId:call.parentId,kind:call.kind,name:call.name,workerId:call.workerId,subagent:!!call.agentId,ticketId:call.ticketId,entryId:client||source?.kind||'generic',backend:backend?.label??backendId,model:call.model??parent?.model,state:call.state,startedAt:call.startedAt,endedAt:call.endedAt,configurationResource:call.kind==='tool'?undefined:'agent-configuration/'+call.id}
 })
 const architecture={router:{backend:router,model:host.config.execution.router?.model??host.config.models.router??model(router)},workers:workerProfiles(host.config).map(w=>({...w,model:w.model??model(w.backend),active:runs.filter(r=>r.workerId===w.id&&['starting','running','background'].includes(r.phase)).map(r=>({ticketId:r.ticketId,title:tickets.find(t=>t.id===r.ticketId)?.title??'',model:r.model,backend:r.backendId,reserve:r.interactiveReserve??false}))})),interactiveReserve:1,activity,tools:workerSpecs.filter(s=>host.config.work.sandboxDriver!=='disabled'||s.name!=='superagent_shell').map(s=>s.name)}
 const project=(ticket:Ticket)=>{
  const trigger=host.store.triggers.get(ticket.origin.triggerId),source=host.config.sources.find(s=>s.id===trigger?.source),client=host.store.get<{client:string}>('entry-client-event',ticket.origin.triggerId)?.client
  const run=host.store.get<any>('run',ticket.id),stage=ticketStage(ticket),last=ticket.assignments.at(-1),report=last?.report
  const sent=deliveries.some(d=>d.ticketId===ticket.id&&d.kind==='reply'&&d.status==='sent'),uncertain=deliveries.some(d=>d.ticketId===ticket.id&&d.status==='uncertain'),read=!!host.store.get('entry-client-receipt',ticket.id)
  const pending=approvals.filter(a=>a.ticketId===ticket.id)
  const state=uncertain||pending.length||ticket.attention||stage.stage==='person'?'attention':run?.phase==='running'||run?.phase==='background'?'running':report?.state==='ready'?(sent&&(!client||read)?'replied':'ready'):ticket.ended?'closed':'queued'
  const label=host.store.get<any>('entry-label',trigger?.source??'')
  return {id:ticket.id,title:text(ticket.title,200),state,createdAt:ticket.createdAt,updatedAt:ticket.updatedAt,entryId:client??source?.kind??'generic',context:text(label?.location??source?.repository??'',180),summary:text(ticket.attention?.question??report?.summary,400),question:text(ticket.attention?.question),replySent:sent,replyRead:read,deliveryUncertain:uncertain,approvalIds:pending.map(a=>a.id)}
 }
 const workflowActions=host.workflows.forOperator()
 const all=tickets.map(project).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)),attention=all.filter(t=>t.state==='attention')
 const represented=new Set(tickets.flatMap(t=>t.origin.triggerIds)),evaluating=new Set(host.store.threads.list().flatMap(t=>t.evaluating?.triggerIds??[]))
 const understanding=host.store.list<Trigger>('trigger').filter(t=>evaluating.has(t.id)&&!represented.has(t.id)).map(t=>({id:t.id,title:text(t.text,140),state:'understanding',entryId:host.store.get<{client:string}>('entry-client-event',t.id)?.client??host.config.sources.find(s=>s.id===t.source)?.kind??'generic',updatedAt:t.at}))
 const activeTasks=all.filter(task=>['running','queued','ready'].includes(task.state))
 const query=filter.search?.trim().toLowerCase()
 const filtered=all.filter(task=>(!filter.state||task.state===filter.state)&&
  (!query||[task.title,task.context,task.entryId,task.summary].some(value=>value.toLowerCase().includes(query))))
 return {at:Date.now(),architecture,paused:status.paused,active:status.active,total:filtered.length,offset,limit,more:offset+limit<filtered.length,
  workflowActions,tasks:filtered.slice(offset,offset+limit),activeTasks:activeTasks.slice(0,100),activeTotal:activeTasks.length,attention:attention.slice(0,50),attentionTotal:attention.length+workflowActions.length,understanding:understanding.slice(0,25),counts:{running:all.filter(t=>t.state==='running').length,replied:all.filter(t=>t.state==='replied').length,attention:attention.length+workflowActions.length},sources:host.store.list('source-health'),liveSources:host.store.list('source-live')}
}
export function operatorTask(host:Runtime,id:string){
 const ticket=host.store.tickets.get(id);if(!ticket)return undefined
 const trigger=host.store.triggers.get(ticket.origin.triggerId),source=host.config.sources.find(s=>s.id===trigger?.source),run=host.store.get<any>('run',id)
 const summary=operatorWorkspace(host,0,host.store.tickets.list().length).tasks.find(t=>t.id===id)!
 const rawUrl=trigger?.meta?.url
 let sourceUrl:string|undefined
 // Never turn a source-supplied arbitrary URL or protocol into a privileged action link.
 if(source?.kind==='github'&&typeof rawUrl==='string')try{const url=new URL(rawUrl);if(url.origin==='https://github.com'&&url.pathname.startsWith('/'+source.repository+'/')&&!url.username&&!url.password)sourceUrl=url.href}catch{}
 const goal=host.goals.snapshot().find(g=>g.taskIds.includes(id))
 const acceptedGoal=goal?.state==='completed'&&goal.finalRoundId&&goal.nodes?.every(n=>n.workerId)?goal:undefined
 const artifacts=goal?host.store.list<ArtifactVersion>('goal-artifact').filter(a=>a.mime&&a.ticketId===id&&a.goalId===goal.id):[]
 return {...summary,artifacts,workflowActions:host.workflows.forOperator(id),...(acceptedGoal?{acceptedGoal:{id:acceptedGoal.id,scopeId:acceptedGoal.scopeId}}:{}),workerId:run?.workerId,model:run?.model,canStop:!ticket.ended,canRetry:!ticket.ended&&(canRetry(ticket)||run?.phase==='uncertain'),message:text(trigger?.text,8000),result:text(run?.result,12000),resultTruncated:typeof run?.result==='string'&&run.result.length>12000,resultResource:'ticket/'+id+'/result',...(sourceUrl?{sourceUrl}:{}),approvals:host.store.list<Approval>('approval').filter(a=>a.ticketId===id&&a.status==='pending'&&a.expiresAt>Date.now()).map(a=>({id:a.id,method:a.native.method,expiresAt:a.expiresAt,request:a.native.params}))}
}
