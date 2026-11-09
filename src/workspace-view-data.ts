import {z} from 'zod'
import type {Runtime} from './runtime.ts'
import type {Run} from './store.ts'
import type {RouterAdmission} from './router-ingress.ts'
import type {ViewSnapshot,ViewTask,TaskState} from './workspace-view-contract.ts'
import {operatorWorkspace} from './operator-workspace.ts'

export const viewQuerySchema=z.object({source:z.string().min(1).max(100).optional(),state:z.enum(['queued','running','attention','ready','replied','closed']).optional(),search:z.string().max(100).optional(),offset:z.coerce.number().int().min(0).max(1_000_000).default(0)}).strict()
const clip=(value:string|undefined,max=100)=>value?.slice(0,max)??''
/** Deliberate whitelist: do not spread configuration profiles, raw records, errors or approval payloads. */
export function workspaceViewData(host:Runtime,input:unknown,user='local-operator'):ViewSnapshot{
  const query=viewQuerySchema.parse(input),sources=host.config.sources
  if(query.source&&!sources.some(s=>s.id===query.source))throw Error('Unknown workspace source')
  const tickets=host.store.tickets.list(),workspace=operatorWorkspace(host,0,tickets.length),runs=host.store.list<Run>('run')
  const ticketById=new Map(tickets.map(t=>[t.id,t])),runById=new Map(runs.map(r=>[r.ticketId,r]))
  const sourceById=new Map(sources.map(s=>[s.id,s]))
  const sourceFor=(id:string)=>host.store.triggers.get(id)?.source??''
  const selected=(source:string|undefined)=>!query.source||query.source===source
  const all:ViewTask[]=workspace.tasks.map(t=>{
    const ticket=ticketById.get(t.id)!,sourceId=sourceFor(ticket.origin.triggerId)
    return {id:t.id,title:t.title,state:t.state as TaskState,sourceId,sourceLabel:clip(sourceById.get(sourceId)?.label??sourceId),updatedAt:t.updatedAt,summary:t.summary,workerId:runById.get(t.id)?.workerId,replySent:t.replySent,replyRead:t.replyRead,deliveryUncertain:t.deliveryUncertain,approvals:t.approvalIds.length}
  }).filter(t=>selected(t.sourceId))
  const search=query.search?.trim().toLowerCase(),filtered=all.filter(t=>(!query.state||query.state===t.state)&&(!search||[t.title,t.summary,t.sourceLabel].some(v=>v.toLowerCase().includes(search))))
  const counts:ViewSnapshot['counts']={queued:0,running:0,attention:0,ready:0,replied:0,closed:0}
  for(const task of all)counts[task.state]++
  const activity=host.activity.list().filter(c=>selected(c.sourceId??(c.triggerId?sourceFor(c.triggerId):c.ticketId?all.find(t=>t.id===c.ticketId)?.sourceId:undefined))).sort((a,b)=>b.startedAt-a.startedAt)
  const calls=activity.slice(0,100).map(c=>({id:c.id,kind:c.kind,name:clip(c.name),state:c.state,workerId:c.workerId,ticketId:c.ticketId,sourceId:c.sourceId,model:c.model,startedAt:c.startedAt,endedAt:c.endedAt}))
  const activeRuns=runs.filter(r=>['starting','running','background'].includes(r.phase)&&(!query.source||all.some(t=>t.id===r.ticketId)))
  const workers=workspace.architecture.workers.slice(0,64).map(w=>({id:w.id,label:clip(w.label??w.id),model:w.model?clip(w.model,300):null,backend:clip(w.backend),state:w.state??'enabled',active:activeRuns.filter(r=>r.workerId===w.id).length,taskIds:activeRuns.filter(r=>r.workerId===w.id).slice(0,20).map(r=>r.ticketId)}))
  const router=workspace.architecture.router
  const health=new Map(host.store.list<{source:string;status:string;at:number}>('source-health').map(s=>[s.source,s]))
  // Bound observation windows independently. They are not funnel conversion rates or lifetime accounting.
  const admissions=host.store.list<RouterAdmission>('router-admission').filter(a=>selected(sourceFor(a.triggerId))).sort((a,b)=>b.at.localeCompare(a.at)).slice(0,100)
  const batches=host.store.list<{id:string;primary:string;triggerIds:string[];phase:string}>('router-candidate').reverse().filter(b=>selected(sourceFor(b.primary))).slice(0,50)
  const retained=host.decision.records(),decisions=retained.filter(r=>r.purpose==='routing')
  const usage=(field:'inputTokens'|'outputTokens')=>{
    const reported=decisions.flatMap(r=>typeof r.usage?.[field]==='number'?[r.usage[field]!]:[])
    return {reported:reported.length,tokens:reported.length?reported.reduce((a,b)=>a+b,0):null}
  }
  const inputUsage=usage('inputTokens'),outputUsage=usage('outputTokens'),attention=all.filter(t=>t.state==='attention')
  return {at:Date.now(),paused:host.isPaused,query,
    sources:sources.slice(0,200).map(s=>{const h=health.get(s.id);return {id:s.id,label:clip(s.label??s.id),kind:clip(s.kind),enabled:s.enabled,status:h&&['ok','retrying','error'].includes(h.status)?h.status as 'ok'|'retrying'|'error':'unknown',at:h?.at??null}}),
    team:{router:{id:'router',label:'Router',model:router.model?clip(router.model,300):null,backend:clip(router.backend),state:'enabled',active:activity.filter(c=>c.kind==='router'&&c.state==='running').length,taskIds:[]},workers,totalWorkers:workspace.architecture.workers.length},counts,
    tasks:{items:filtered.slice(query.offset,query.offset+25),total:filtered.length,offset:query.offset,limit:25,more:query.offset+25<filtered.length},
    attention:{items:attention.slice(0,20),total:attention.length},calls:{items:calls,totalRetained:activity.length,limit:100},
    browsers:host.browser.controlSummary(user),
    listening:{limit:100,admissions:admissions.map(a=>({id:a.triggerId,sourceId:sourceFor(a.triggerId),at:a.at,state:a.state,basis:a.mandate?.strength??'none'})),batches:batches.map(b=>({id:b.id,messages:b.triggerIds.length,phase:clip(b.phase)}))},
    decision:{mode:host.config.decision.mode,scope:'workspace',retained:decisions.length,probesExcluded:retained.length-decisions.length,inputTokens:inputUsage.tokens,outputTokens:outputUsage.tokens,inputReported:inputUsage.reported,outputReported:outputUsage.reported,records:decisions.slice(0,30).map(r=>({id:r.id,at:r.at,mode:r.mode,model:clip(r.model),status:r.status,latencyMs:r.latencyMs,actions:[...new Set(r.decisions?.map(d=>d.action)??[])]}))},
  }
}
