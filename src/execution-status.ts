import type {Runtime} from './runtime.ts'
import type {Run,Delivery} from './store.ts'
import type {Ticket} from './vendor/dsh-core/index.ts'
import type {RouterGoal} from './router-goals.ts'
import type {VerificationRound} from './goal-verification.ts'

export type ExecutionStatus='not_started'|'queued'|'running'|'waiting_input'|'interrupted'|'failed'|'cancelled'|'finished'
export type EffectStatus='not_recorded'|'in_progress'|'recorded'|'unknown'
export type AcceptanceStatus='not_recorded'|'pending'|'running'|'passed'|'failed'|'insufficient'|'errored'|'stale'
export type DeliveryStatus='not_recorded'|'pending'|'retry_wait'|'sending'|'uncertain'|'held'|'dropped'|'recorded'|'partial'
export interface TaskStatusProjection {
 schema:1
 observedAt:number
 execution:{state:ExecutionStatus}
 effects:{state:EffectStatus;receiptCount:number}
 acceptance:{state:AcceptanceStatus;freshness:'current'|'stale'|'unknown'|'not_recorded'}
 delivery:{state:DeliveryStatus;counts:{total:number;pending:number;retry_wait:number;sending:number;uncertain:number;held:number;dropped:number;recorded:number};evidence:'none'|'host_record';scope:'local'|'external'|'mixed'|'not_recorded'}
}

interface RecordValue {ticketId?:string;assignmentId?:string;state?:string;phase?:string;id?:string}
interface RecordRow {key:string;value:RecordValue}
function recordRows(host:Runtime,kind:string):RecordRow[]{
 return host.store.db.prepare('SELECT id,body FROM records WHERE kind=? ORDER BY rowid').all(kind).map(r=>({key:String(r.id),value:JSON.parse(String(r.body)) as RecordValue}))
}
function associatedDeliveries(host:Runtime,ticketId:string){
 return host.store.deliveries().filter(d=>d.ticketId===ticketId||host.store.get<{taskIds?:string[]}>('router-reply-owner',d.id)?.taskIds?.includes(ticketId))
}
function execution(host:Runtime,ticket:Ticket,observedAt:number):ExecutionStatus {
 const assignment=ticket.assignments.at(-1),saved=host.store.get<Run>('run',ticket.id),run=assignment&&saved?.assignmentId===assignment.id?saved:undefined
 if(ticket.ended?.outcome==='stopped')return 'cancelled'
 const work=host.work.list(ticket.id).filter(w=>w.assignmentId===assignment?.id)
 const jobs=host.store.db.prepare("SELECT state FROM jobs WHERE kind IN ('start','execute') AND json_extract(payload,'$.ticketId')=? AND json_extract(payload,'$.assignmentId')=?").all(ticket.id,assignment?.id??'')
 if(run?.phase==='uncertain'||run?.phase==='interrupted'||jobs.some(j=>j.state==='uncertain')||work.some(w=>w.state==='interrupted'))return 'interrupted'
 if(run?.phase==='human'||ticket.attention||host.store.list<{ticketId:string;status:string;expiresAt:number}>('approval').some(a=>a.ticketId===ticket.id&&a.status==='pending'&&a.expiresAt>observedAt))return 'waiting_input'
 if(run&&(['starting','running','background','delivering','merging'].includes(run.phase)||host.executionActive(ticket.id))||work.some(w=>['starting','running'].includes(w.state)))return 'running'
 if(ticket.ended)return 'finished'
 if(!assignment)return 'not_started'
 if(assignment.state==='pending'||jobs.some(j=>j.state==='pending'||j.state==='running'))return 'queued'
 const report=assignment.report?.state
 if(report==='failed'||jobs.some(j=>j.state==='failed'))return 'failed'
 if(report==='blocked')return 'waiting_input'
 const retained=host.store.get<{assignmentId:string;report?:{state:string}}>('goal-delivery',ticket.id)
 if(report==='ready'||retained?.assignmentId===assignment.id&&retained.report?.state==='ready')return 'finished'
 // Idle and waiting are observations of a paused turn, never inferred success.
 return 'waiting_input'
}
function effects(host:Runtime,ticket:Ticket,deliveries:Delivery[]):TaskStatusProjection['effects'] {
 let receiptCount=0,active=false,unknown=false
 const observe=(state:string|undefined,open:readonly string[],closed:readonly string[])=>{
  receiptCount++
  if(open.includes(state??''))active=true
  else if(!closed.includes(state??''))unknown=true
 }
 for(const kind of ['tool-receipt','browser-receipt'])for(const {value:r} of recordRows(host,kind))if(r.ticketId===ticket.id)observe(r.state,['running'],['complete'])
 for(const r of host.work.list(ticket.id))observe(r.state,['starting','running'],['completed','failed','cancelled'])
 for(const {value:r} of recordRows(host,'workflow-action'))if(r.ticketId===ticket.id)observe(r.state,['pending','applying'],['applied','declined','stale','observed'])
 for(const {key,value:r} of recordRows(host,'pr-delivery'))if(r.ticketId===ticket.id||r.id===ticket.id||key.startsWith(ticket.id+':'))observe(r.phase,['pushing','creating'],['pushed','draft'])
 for(const {value:r} of recordRows(host,'review-action'))if(r.ticketId===ticket.id)observe(r.phase,[],['resolved','stale'])
 for(const {key,value:r} of recordRows(host,'merge-attempt'))if(host.store.get<{ticketId:string}>('merge-grant',key)?.ticketId===ticket.id)observe(r.phase,['waiting','submitting'],['merged','revoked'])
 for(const r of deliveries)observe(r.status,['pending','sending','held'],['sent','dropped'])
 // Retained uncertainty belongs to its original operation, including an older
 // assignment. A new assignment or cancellation cannot turn it into success.
 if(host.store.get<Run>('run',ticket.id)?.phase==='uncertain'||host.store.db.prepare("SELECT 1 FROM jobs WHERE json_extract(payload,'$.ticketId')=? AND state='uncertain' LIMIT 1").get(ticket.id))unknown=true
 return {state:unknown?'unknown':active?'in_progress':receiptCount?'recorded':'not_recorded',receiptCount}
}
const noAcceptance:TaskStatusProjection['acceptance']={state:'not_recorded',freshness:'not_recorded'}
const unknownAcceptance:TaskStatusProjection['acceptance']={state:'stale',freshness:'unknown'}
const acceptanceStates:readonly string[]=['pending','running','passed','failed','insufficient','errored','stale']
function acceptance(host:Runtime,ticket:Ticket):TaskStatusProjection['acceptance'] {
 const history=host.store.list<VerificationRound>('goal-verification').filter(r=>Array.isArray(r.ticketIds)&&r.ticketIds.includes(ticket.id))
 const owner=host.scopes.ownership(ticket.id)
 const goals=host.store.list<RouterGoal>('router-goal').filter(g=>g.taskIds?.includes(ticket.id)&&g.nodes?.some(n=>n.ticketId===ticket.id)&&(!owner||g.scopeId===owner.scopeId&&g.entryId===owner.originEntry))
 if(goals.length!==1)return history.length?{...unknownAcceptance}:{...noAcceptance}
 const goal=goals[0]!,nodes=goal.nodes!.filter(n=>n.ticketId===ticket.id)
 if(nodes.length!==1)return {...unknownAcceptance}
 const node=nodes[0]!,roundId=goal.finalRoundId??node.roundId
 if(!roundId)return history.length?{...unknownAcceptance}:{...noAcceptance}
 const round=host.store.get<VerificationRound>('goal-verification',roundId)
 if(!round||round.goalId!==goal.id||round.scopeId!==goal.scopeId||round.entryId!==goal.entryId||!Array.isArray(round.ticketIds)||!round.ticketIds.includes(ticket.id)||(goal.finalRoundId?!!round.nodeId:round.nodeId!==node.id))return {...unknownAcceptance}
 if(!acceptanceStates.includes(round.state))return {...unknownAcceptance}
 const snapshot=round.snapshot,assignment=ticket.assignments.at(-1)
 if(!goal.contract||!snapshot||typeof snapshot.contract!=='string'||!/^[a-f0-9]{64}$/.test(snapshot.contract)||!Array.isArray(snapshot.tasks)||!Array.isArray(snapshot.evidence)||!snapshot.tasks.every(t=>!!t&&typeof t==='object'&&typeof t.ticketId==='string'&&typeof t.assignmentId==='string'&&typeof t.reportHash==='string'&&/^[a-f0-9]{64}$/.test(t.reportHash)&&Number.isInteger(t.inputRevision)&&t.inputRevision>=1))return {...unknownAcceptance}
 const taskRefs=snapshot.tasks.filter(t=>t.ticketId===ticket.id)
 if(taskRefs.length!==1)return {...unknownAcceptance}
 if(taskRefs[0]!.assignmentId!==assignment?.id||taskRefs[0]!.inputRevision!==(owner?.dataRevision??1)||round.state==='stale')return {state:'stale',freshness:'stale'}
 // The existing verifier owns freshness. Its explicit read-only mode neither
 // registers artifacts nor repairs memory/revocation state on a GET request.
 try{return host.verification.current(round,goal,{readOnly:true})?{state:round.state as AcceptanceStatus,freshness:'current'}:{state:'stale',freshness:'stale'}}catch{return {...unknownAcceptance}}
}
function delivery(host:Runtime,ticket:Ticket,all:Delivery[]):TaskStatusProjection['delivery'] {
 const assignment=ticket.assignments.at(-1),saved=host.store.get<Run>('run',ticket.id),run=saved?.assignmentId===assignment?.id?saved:undefined
 const retained=host.store.get<{assignmentId:string;report?:{state:string};reply?:string}>('goal-delivery',ticket.id)
 const ready=assignment?.report?.state==='ready'||retained?.assignmentId===assignment?.id&&retained?.report?.state==='ready'||ticket.ended?.outcome==='completed'
 const text=run?.result||(retained?.assignmentId===assignment?.id?retained?.reply:undefined)
 const currentReceipt=(d:Delivery)=>{
  if(!assignment)return false
  // Content-derived reply IDs and millisecond timestamps can both be reused.
  // Require causal host events for this assignment and its latest ready report.
  const started=host.store.db.prepare("SELECT MAX(seq) AS seq FROM audit WHERE json_valid(body) AND json_extract(body,'$.type')='assignment.started' AND json_extract(body,'$.data.ticketId')=? AND json_extract(body,'$.data.assignmentId')=?").get(ticket.id,assignment.id)
  const reported=host.store.db.prepare("SELECT MAX(seq) AS seq FROM audit WHERE json_valid(body) AND json_extract(body,'$.type')='execution.trace' AND json_extract(body,'$.entity')='ticket' AND json_extract(body,'$.entityId')=? AND json_extract(body,'$.ticketId')=? AND json_extract(body,'$.assignmentId')=? AND json_extract(body,'$.state')='ready' AND json_extract(body,'$.baseline')=0").get(ticket.id,ticket.id,assignment.id)
  const first=host.store.db.prepare("SELECT seq,at,body FROM audit WHERE json_valid(body) AND json_extract(body,'$.type')='execution.trace' AND json_extract(body,'$.entity')='outbox' AND json_extract(body,'$.entityId')=? ORDER BY seq LIMIT 1").get(d.id)
  if(!started?.seq||!reported?.seq||!first||Number(first.seq)<=Math.max(Number(started.seq),Number(reported.seq))||JSON.parse(String(first.body)).baseline!==0)return false
  const reportAt=Date.parse(assignment.report?.at??'')
  // Equal millisecond timestamps cannot bind an earlier receipt to the latest
  // report when repeated ready states produce no new projection event.
  return Number.isFinite(reportAt)&&Date.parse(String(first.at))>reportAt
 }
 const result=(d:Delivery)=>{
  if(d.kind!=='reply'||d.id.startsWith('attention-reply:')||!ready)return false
  if(d.ticketId===ticket.id)return typeof text==='string'&&text.length>0&&d.text===text&&currentReceipt(d)
  const owner=host.store.get<{reportReads?:Record<string,string>}>('router-reply-owner',d.id)
  return !!assignment?.report?.at&&owner?.reportReads?.[ticket.id]===assignment.report.at&&currentReceipt(d)
 }
 // Completed acknowledgements/notices and old reply bodies are not evidence
 // that this result was delivered. Unsettled messages remain visible regardless.
 const rows=all.filter(d=>result(d)||!['sent','dropped'].includes(d.status))
 const counts:TaskStatusProjection['delivery']['counts']={total:rows.length,pending:0,retry_wait:0,sending:0,uncertain:0,held:0,dropped:0,recorded:0}
 let local=false,external=false
 for(const d of rows){
  if(d.status==='sent')counts.recorded++
  else if(d.status==='pending')counts[d.attempts>0?'retry_wait':'pending']++
  else if(d.status==='sending'||d.status==='uncertain'||d.status==='held'||d.status==='dropped')counts[d.status]++
  else counts.uncertain++
  if(d.channel.address.routerInbox||host.config.sources.find(s=>s.id===d.channel.source)?.kind==='local')local=true
  else external=true
 }
 let state:DeliveryStatus='not_recorded'
 if(counts.uncertain)state='uncertain'
 else if(counts.sending)state='sending'
 else if(counts.held)state='held'
 else if(counts.recorded&&(counts.pending||counts.retry_wait||counts.dropped))state='partial'
 else if(counts.pending)state='pending'
 else if(counts.retry_wait)state='retry_wait'
 else if(counts.recorded)state='recorded'
 else if(counts.dropped)state='dropped'
 return {state,counts,evidence:counts.recorded?'host_record':'none',scope:local&&external?'mixed':local?'local':external?'external':'not_recorded'}
}
/** Read-only facets of existing authoritative facts. No write, scheduling,
 * reconciliation, provider query or new state source is introduced here. */
export function projectTaskStatus(host:Runtime,ticket:Ticket,observedAt=Date.now()):TaskStatusProjection {
 if(host.memory.cleanup.blocked('ticket',ticket.id,ticket))throw Error('status_task_unavailable')
 const deliveries=associatedDeliveries(host,ticket.id)
 return {schema:1,observedAt,execution:{state:execution(host,ticket,observedAt)},effects:effects(host,ticket,deliveries),acceptance:acceptance(host,ticket),delivery:delivery(host,ticket,deliveries)}
}
