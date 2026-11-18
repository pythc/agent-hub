import {createRecoveryPackage} from './recovery-package.ts'
import {recoveryManifest,type RecoveryManifest} from './recovery-manifest.ts'
import {createHash} from 'node:crypto'
import {z} from 'zod'
import type {Runtime} from './runtime.ts'
import type {Run,Store} from './store.ts'
import {canRetry,type Ticket} from './vendor/dsh-core/index.ts'
import {stableDigest} from './sources.ts'
import {executionProblem,projectExecutionBlocker,type ExecutionBlocker} from './execution-blocker.ts'
import {projectTaskStatus,type TaskStatusProjection} from './execution-status.ts'

const stages=['task','assignment','run','approval','tool','result','acceptance','job','delivery','recovery','commit','test','deployment'] as const
const states=['queued','running','waiting','ready','blocked','failed','cancelled','completed','interrupted','uncertain','pending','resolved','expired','passed','insufficient','errored','stale','sent','held','dropped','idle','starting','background','human','delivering','merging','complete','ended','observed','sending','applying','applied','declined'] as const
export type TraceStage=typeof stages[number]
export type TraceState=typeof states[number]
export interface TraceEvent {id:string;cursor:number;at:string;stage:TraceStage;state:TraceState;ticketId?:string;entity:string;entityId:string;baseline:boolean;hasResult?:boolean}
export class TraceError extends Error {
 constructor(readonly code:string,readonly status=409){super(code);this.name='TraceError'}
}
const id=z.string().min(1).max(400)
export const traceQuerySchema=z.object({cursor:z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),ticketId:id.optional(),limit:z.coerce.number().int().min(1).max(200).default(80)}).strict()
export const traceSnapshotSchema=z.object({ticketId:id.optional(),offset:z.coerce.number().int().min(0).max(1000000).default(0),limit:z.coerce.number().int().min(1).max(100).default(50)}).strict()
export const traceRecoverySchema=z.object({ticketId:id,action:z.enum(['inspect','read_history','resume_session','cancel']),revision:z.number().int().nonnegative(),requestId:z.string().min(1).max(200),observed:z.string().regex(/^[a-f0-9]{64}$/),repairConfirmed:z.boolean().optional()}).strict()
type RecoveryInput=z.infer<typeof traceRecoverySchema>
type RecoveryResult={status:'inspected'|'history_verified'|'history_unavailable'|'resumed'|'cancelled';ticketId:string;replayed:false;at:number;task?:TraceTask}
interface RecoveryReceipt {fingerprint:string;state:'started'|'completed'|'uncertain';action:RecoveryInput['action'];ticketId:string;at:number;result?:RecoveryResult}
export interface AsyncInboxSummary {schema:1;received:number;applied:number;archived:number;latest:{kind:'progress'|'blocked'|'result';disposition:'applied'|'archived';observedAt:number}|null}
export interface TraceTask {
 asyncInbox?:AsyncInboxSummary
 recovery?:RecoveryManifest
 blocker?:ExecutionBlocker|null
 status:TaskStatusProjection
 id:string;label:string;state:TraceState;phase?:TraceState;updatedAt:string;workerId?:string;backendId?:string;sessionRef?:string;hasResult:boolean;
 revision:number;observed:string;problem:string;unknownEffects:boolean;pendingApprovals:number;acceptance:{state:TraceState;passed:number;failed:number;insufficient:number}|null;
 evidence:{commit:'recorded'|'unverified';commitRef?:string;tests:'passed'|'failed'|'unverified';deployment:'unverified';external:'uncertain'|'receipts_present'|'none'};
 actions:('inspect'|'read_history'|'resume_session'|'cancel')[];next:'reconcile'|'answer_approval'|'reconnect'|'review_context'|'follow_up'|'none';
}
const opaque=(value:string)=>createHash('sha256').update(value).digest('hex').slice(0,16)
const enumState=(value:unknown,fallback:TraceState='observed'):TraceState=>typeof value==='string'&&(states as readonly string[]).includes(value)?value as TraceState:fallback
const sqlString=(value:string)=>"'"+value.replaceAll("'","''")+"'"
const stateSQL=(expression:string,fallback='observed')=>`CASE WHEN ${expression} IN (${states.map(sqlString).join(',')}) THEN ${expression} ELSE ${sqlString(fallback)} END`
const field=(alias:string,path:string)=>`json_extract(${alias}.body,${sqlString(path)})`
interface Projection {key?:string;kind:string;stage:TraceStage;state:(alias:string)=>string;ticket:(alias:string)=>string;extra?:(alias:string)=>string;many?:string}
const projections:Projection[]=[
 {kind:'ticket',stage:'task',ticket:a=>`${a}.id`,state:a=>`CASE WHEN ${field(a,'$.ended')} IS NOT NULL THEN CASE WHEN ${field(a,'$.ended.outcome')}='stopped' THEN 'cancelled' ELSE 'ended' END WHEN ${field(a,'$.attention')} IS NOT NULL THEN 'waiting' ELSE ${stateSQL(field(a,'$.assignments[#-1].report.state'),'queued')} END`,extra:a=>`,'assignmentId',${field(a,'$.assignments[#-1].id')}`},
 {kind:'worker-assignment',stage:'assignment',ticket:a=>`${a}.id`,state:()=>"'queued'",extra:a=>`,'workerId',${field(a,'$.workerId')}`},
 {kind:'run',stage:'run',ticket:a=>`${a}.id`,state:a=>stateSQL(field(a,'$.phase')),extra:a=>`,'hasResult',CASE WHEN json_type(${a}.body,'$.result')='text' AND length(${field(a,'$.result')})>0 THEN 1 ELSE 0 END,'assignmentId',${field(a,'$.assignmentId')}`},
 {kind:'approval',stage:'approval',ticket:a=>field(a,'$.ticketId'),state:a=>stateSQL(field(a,'$.status')),extra:a=>`,'expiresAt',${field(a,'$.expiresAt')}`},
 {kind:'execution-call',stage:'tool',ticket:a=>field(a,'$.ticketId'),state:a=>stateSQL(field(a,'$.state')),extra:a=>`,'callKind',CASE WHEN ${field(a,'$.kind')} IN ('router','worker','subagent','tool') THEN ${field(a,'$.kind')} ELSE 'tool' END`},
 {kind:'work',stage:'tool',ticket:a=>field(a,'$.ticketId'),state:a=>stateSQL(field(a,'$.state'))},
 {kind:'tool-receipt',stage:'tool',ticket:a=>field(a,'$.ticketId'),state:a=>stateSQL(field(a,'$.state'))},
 {kind:'browser-receipt',stage:'tool',ticket:a=>field(a,'$.ticketId'),state:a=>stateSQL(field(a,'$.state'))},
 {kind:'workflow-action',stage:'tool',ticket:a=>field(a,'$.ticketId'),state:a=>stateSQL(field(a,'$.state'))},
 {key:'project_commit',kind:'project-commit',stage:'commit',ticket:a=>field(a,'$.ticketId'),state:a=>`CASE WHEN length(${field(a,'$.head')}) IN (40,64) AND ${field(a,'$.head')} NOT GLOB '*[^a-f0-9]*' THEN 'completed' WHEN ${field(a,'$.error')} IS NOT NULL THEN 'failed' ELSE 'observed' END`},
 {key:'project_test',kind:'project-commit',stage:'test',ticket:a=>field(a,'$.ticketId'),state:a=>`CASE WHEN ${field(a,'$.test.exit')}=0 THEN 'passed' WHEN typeof(${field(a,'$.test.exit')})='integer' THEN 'failed' ELSE 'observed' END`},
 {kind:'goal-delivery',stage:'result',ticket:a=>field(a,'$.ticketId'),state:()=>"'ready'"},
 {kind:'goal-verification',stage:'acceptance',ticket:()=>`task.value`,state:a=>stateSQL(field(a,'$.state')),many:'$.ticketIds'},
]
const projectionSQL=(p:Projection,a:string,baseline=false)=>`json_object('type','execution.trace','schema',1,'entity',${sqlString(p.kind)},'entityId',${a}.id,'ticketId',${p.ticket(a)},'stage',${sqlString(p.stage)},'state',${p.state(a)},'baseline',${baseline?1:0}${p.extra?.(a)??''})`
const legacy={
 'ticket.created':{stage:'task',state:'queued'},'ticket.resumed':{stage:'task',state:'queued'},'ticket.ended':{stage:'task',state:'ended'},
 'assignment.started':{stage:'assignment',state:'running'},'assignment.ended':{stage:'assignment',state:'ended'},
} as const
const eventTypes=['execution.trace',...Object.keys(legacy)]
const eventPredicate=`json_valid(body) AND json_extract(body,'$.type') IN (${eventTypes.map(sqlString).join(',')})`
/** Observation hooks append safe metadata in the authoritative write's transaction.
 * They never decide or mutate task, job or outbox state. */
function installProjection(store:Store){
 store.atomic(()=>{
  const version=store.get<{version:number}>('execution-trace-meta','current')?.version
  if(version!==undefined&&version!==1)throw new TraceError('trace_version_unsupported')
  for(const p of projections){
   const suffix=(p.key??p.kind).replaceAll('-','_'),many=(alias:string)=>p.many?`,json_each(${alias}.body,${sqlString(p.many)}) AS task`:''
   for(const operation of ['INSERT','UPDATE'] as const){
    const changed=operation==='UPDATE'?p.many?`(${field('new','$.state')} IS NOT ${field('old','$.state')} OR ${field('new',p.many)} IS NOT ${field('old',p.many)})`:`${projectionSQL(p,'new')} IS NOT ${projectionSQL(p,'old')}`:''
    store.db.exec(`CREATE TRIGGER IF NOT EXISTS execution_trace_v1_${suffix}_${operation.toLowerCase()} AFTER ${operation} ON records WHEN new.kind=${sqlString(p.kind)}${changed?' AND ('+changed+')':''} BEGIN INSERT INTO audit(at,body) SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now'),${projectionSQL(p,'new')} FROM (SELECT 1)${many('new')}; END`)
   }
   if(version===undefined)store.db.exec(`INSERT INTO audit(at,body) SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now'),${projectionSQL(p,'r',true)} FROM records AS r${many('r')} WHERE r.kind=${sqlString(p.kind)}`)
  }
  for(const table of ['jobs','outbox'] as const){
   const state=table==='jobs'?'state':'status',body=table==='jobs'?'payload':'body',stage=table==='jobs'?'job':'delivery'
   const projectedState=(prefix:string)=>table==='jobs'?`CASE WHEN ${prefix}state='done' THEN 'completed' ELSE ${stateSQL(prefix+state)} END`:stateSQL(prefix+state)
   for(const operation of ['INSERT','UPDATE'] as const)store.db.exec(`CREATE TRIGGER IF NOT EXISTS execution_trace_v1_${table}_${operation.toLowerCase()} AFTER ${operation} ON ${table}${operation==='UPDATE'?` WHEN new.${state} IS NOT old.${state}`:''} BEGIN INSERT INTO audit(at,body) VALUES(strftime('%Y-%m-%dT%H:%M:%fZ','now'),json_object('type','execution.trace','schema',1,'entity','${table}','entityId',new.id,'ticketId',json_extract(new.${body},'$.ticketId'),'stage','${stage}','state',${projectedState('new.')},'baseline',0)); END`)
   if(version===undefined)store.db.exec(`INSERT INTO audit(at,body) SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now'),json_object('type','execution.trace','schema',1,'entity','${table}','entityId',id,'ticketId',json_extract(${body},'$.ticketId'),'stage','${stage}','state',${projectedState('')},'baseline',1) FROM ${table}`)
  }
  if(version===undefined)store.put('execution-trace-meta','current',{version:1,installedAt:Date.now()})
 })
}
/** Offline rollback: remove hooks, retaining all authoritative state and evidence. */
export function uninstallExecutionTrace(store:Store){
 store.atomic(()=>{
  const triggers=store.db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name GLOB 'execution_trace_v1_*'").all()
  for(const row of triggers){const name=String(row.name);if(/^execution_trace_v1_[a-z_]+$/.test(name))store.db.exec('DROP TRIGGER '+name)}
 })
}
function visible(host:Runtime,ticketId:string){const ticket=host.store.tickets.get(ticketId);return !!ticket&&!host.memory.cleanup.blocked('ticket',ticketId,ticket)}
function classify(run:Run|undefined,ticket:Ticket){
 const problem=executionProblem(run?.error??'',run?.phase==='uncertain')
 if(problem!=='none')return problem
 if(ticket.ended?.outcome==='stopped')return 'cancelled'
 if(run?.phase==='interrupted')return 'interrupted'
 return ticket.assignments.at(-1)?.report?.state==='failed'?'failed':'none'
}
export class ExecutionTrace {
 private bound?:Store
 private readonly inFlight=new Set<string>()
 constructor(private readonly host:()=>Runtime){this.current()}
 private current(){const host=this.host();if(host.store!==this.bound){installProjection(host.store);this.bound=host.store}return host}
 private visibility(host:Runtime){return stableDigest(host.store.db.prepare("SELECT id,body FROM records WHERE kind='history-plan' ORDER BY id").all())}
 private head(host:Runtime){return Number(host.store.db.prepare('SELECT COALESCE(MAX(seq),0) AS seq FROM audit').get()!.seq)}
 events(value:unknown={}){
  const query=traceQuerySchema.parse(value),host=this.current(),head=this.head(host)
  if(query.cursor>head)throw new TraceError('trace_cursor_ahead')
  if(query.ticketId&&!visible(host,query.ticketId))throw new TraceError('trace_task_missing',404)
  const rows=host.store.db.prepare(`SELECT seq,at,body FROM audit WHERE seq>? AND ${eventPredicate}${query.ticketId?" AND COALESCE(json_extract(body,'$.ticketId'),json_extract(body,'$.data.ticketId'))=?":''} ORDER BY seq LIMIT ?`).all(query.cursor,...(query.ticketId?[query.ticketId]:[]),query.limit+1)
  const page=rows.slice(0,query.limit),events:TraceEvent[]=[]
  for(const row of page){
   const body=JSON.parse(String(row.body)),old=legacy[body.type as keyof typeof legacy],ticketId=old?body.data?.ticketId:body.ticketId
   if(typeof ticketId==='string'&&!visible(host,ticketId))continue
   if(!old&&(body.schema!==1||!(stages as readonly unknown[]).includes(body.stage)))continue
   const stage:TraceStage=old?.stage??(body.stage==='tool'&&body.callKind&&body.callKind!=='tool'?'run':body.stage)
   const state=old?body.type==='ticket.ended'&&body.data?.outcome==='stopped'?'cancelled':old.state:enumState(body.state)
   events.push({id:'event:'+row.seq,cursor:Number(row.seq),at:String(row.at),stage,state:enumState(state),...(typeof ticketId==='string'?{ticketId}:{}),entity:old?'domain':String(body.entity),entityId:opaque(String(body.entity??body.type)+':'+String(body.entityId??row.seq)),baseline:body.baseline===1,...(body.hasResult?{hasResult:true}:{})})
  }
  return {events,visibility:this.visibility(host),cursor:rows.length>query.limit?Number(page.at(-1)!.seq):head,head,more:rows.length>query.limit,at:Date.now()}
 }
 // Bind repository receipts and their ownership links, not the wall-clock
 // observedAt or aggregate counts. Kept private: raw receipt contents never leave
 // this projection. This is a current-state fence, not a monotonic ABA journal.
 private effectObservation(host:Runtime,ticketId:string){
  const rows=(kind:string)=>host.store.db.prepare('SELECT id,body FROM records WHERE kind=? ORDER BY id').all(kind).map(r=>({id:String(r.id),value:JSON.parse(String(r.body))}))
  const grants=rows('merge-grant').filter(r=>r.value.ticketId===ticketId),grantIds=new Set(grants.map(r=>r.id))
  return {
   pr:rows('pr-delivery').filter(r=>r.value.ticketId===ticketId||r.value.id===ticketId||r.id.startsWith(ticketId+':')),
   review:rows('review-action').filter(r=>r.value.ticketId===ticketId),
   grants,merges:rows('merge-attempt').filter(r=>grantIds.has(r.id)),
   replyOwners:rows('router-reply-owner').filter(r=>r.value.taskIds?.includes(ticketId)),
  }
 }
 private task(host:Runtime,ticket:Ticket):TraceTask {
  const run=host.store.get<Run>('run',ticket.id),approvals=host.store.list<any>('approval').filter(a=>a.ticketId===ticket.id&&a.status==='pending'&&a.expiresAt>Date.now())
  const jobs=host.store.db.prepare("SELECT id,state,kind,attempts,next_at FROM jobs WHERE json_extract(payload,'$.ticketId')=? ORDER BY id").all(ticket.id)
  const deliveries=host.store.deliveries().filter(d=>d.ticketId===ticket.id||host.store.get<{taskIds?:string[]}>('router-reply-owner',d.id)?.taskIds?.includes(ticket.id)),receipts=host.toolConnections.receipts(ticket.id),work=host.work.list(ticket.id),browser=host.store.list<any>('browser-receipt').filter(r=>r.ticketId===ticket.id)
  const workflow=host.store.list<any>('workflow-action').filter(r=>r.ticketId===ticket.id),problem=classify(run,ticket)
  const status=projectTaskStatus(host,ticket)
  const unknown=status.effects.state==='unknown'||status.delivery.state==='uncertain'||run?.phase==='uncertain'||problem==='outcome_unknown'||jobs.some(j=>j.state==='uncertain')||deliveries.some(d=>d.status==='uncertain'||d.status==='sending')||receipts.some(r=>r.state==='uncertain'||r.state==='running')||work.some(w=>w.state==='interrupted')||browser.some(r=>r.state!=='complete')||workflow.some(r=>['uncertain','applying'].includes(r.state))
  const round=host.store.list<any>('goal-verification').filter(v=>v.ticketIds?.includes(ticket.id)).at(-1)
  const acceptance=round?{state:enumState(round.state),passed:round.checks?.filter((c:any)=>c.verdict==='passed').length??0,failed:round.checks?.filter((c:any)=>c.verdict==='failed').length??0,insufficient:round.checks?.filter((c:any)=>c.verdict==='insufficient').length??0}:null
  const state=ticket.ended?ticket.ended.outcome==='stopped'?'cancelled':'ended':unknown?'uncertain':approvals.length?'waiting':ticket.attention?'waiting':run&&['running','starting','background','human','merging','delivering'].includes(run.phase)?run.phase:enumState(ticket.assignments.at(-1)?.report?.state,'queued')
  const code=host.store.list<any>('project-commit').filter(r=>r.ticketId===ticket.id).at(-1),commitRef=typeof code?.head==='string'&&/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(code.head)?code.head:undefined
  const evidence:TraceTask['evidence']={commit:commitRef?'recorded':'unverified',...(commitRef?{commitRef}:{}),tests:typeof code?.test?.exit==='number'?code.test.exit===0?'passed':'failed':'unverified',deployment:'unverified',external:unknown?'uncertain':receipts.length||browser.length||deliveries.some(d=>d.status==='sent')?'receipts_present':'none'}
  const held=!!host.store.get('context-rebuild',ticket.id)||!!host.store.get('router-migration',ticket.id)||host.scopes.ownership(ticket.id)?.state==='held'
  const observed=stableDigest({effectObservation:this.effectObservation(host,ticket.id),ticket,run,approvals:approvals.map(({id,status,expiresAt})=>({id,status,expiresAt})),jobs,deliveries:deliveries.map(({id,status,attempts})=>({id,status,attempts})),receipts:receipts.map(({id,state})=>({id,state})),work:work.map(({id,state})=>({id,state})),browser:browser.map(({id,state})=>({id,state})),workflow:workflow.map(({id,state})=>({id,state})),held,code,ownership:host.scopes.ownership(ticket.id),routing:host.store.get('task-routing',ticket.id),context:host.store.get('task-context',ticket.id),continuation:host.store.get('task-continuation',ticket.id),round:round&&{id:round.id,state:round.state,checks:round.checks}})
  const scheduled=jobs.filter(j=>j.kind==='execute'&&j.state==='pending'&&Number.isSafeInteger(j.next_at)&&Number(j.next_at)>Date.now()).map(j=>Number(j.next_at))
  const blocker=projectExecutionBlocker(problem,unknown,scheduled.length?Math.min(...scheduled):undefined,jobs.some(j=>j.kind==='execute'&&j.state==='pending'))
  const actions:TraceTask['actions']=['inspect']
  const sessionReadable=!!run?.threadId&&!!host.model.history&&!host.store.get('context-session-fence',run.threadId)&&!host.store.get('backend-deleted',run.threadId)&&!host.store.get('backend-delete-pending',run.threadId)
  if(sessionReadable){try{if(this.readAllowed(host,ticket)&&host.model.describe?.(run!.threadId).resume)actions.push('read_history')}catch{/* Changed identity or revoked context cannot be probed. */}}
  if(!ticket.ended&&run?.phase!=='merging')actions.push('cancel')
  if((!blocker||['manual','after_repair'].includes(blocker.retryPolicy.mode))&&!ticket.ended&&!unknown&&!held&&!approvals.length&&!ticket.attention&&run?.threadId&&['idle','interrupted'].includes(run.phase)&&canRetry(ticket)&&!host.executionActive(ticket.id)&&!jobs.some(j=>j.state==='running')&&!work.some(w=>['running','starting'].includes(w.state))&&!workflow.some(w=>!['applied','declined','stale','observed'].includes(w.state))&&!host.workflows.unsettled(ticket.id)){
   try{if(host.model.describe?.(run.threadId).resume&&this.authorized(host,ticket,run))actions.push('resume_session')}catch{/* Preserve backend and session identity fences. */}
  }
  const events=host.store.list<{schema:number;ticketId:string;kind:'progress'|'blocked'|'result';disposition:'applied'|'archived';observedAt:number}>('async-worker-event').filter(e=>e.ticketId===ticket.id)
  const verifiedEvents=events.every(e=>e.schema===1&&['progress','blocked','result'].includes(e.kind)&&['applied','archived'].includes(e.disposition)&&Number.isSafeInteger(e.observedAt)&&e.observedAt>=0&&e.observedAt<=8640000000000000)
  const last=verifiedEvents?[...events].sort((a,b)=>b.observedAt-a.observedAt)[0]:undefined
  const asyncInbox:AsyncInboxSummary|undefined=events.length&&verifiedEvents?{schema:1,received:events.length,applied:events.filter(e=>e.disposition==='applied').length,archived:events.filter(e=>e.disposition==='archived').length,latest:last?{kind:last.kind,disposition:last.disposition,observedAt:last.observedAt}:null}:undefined
  const projected:TraceTask={...(asyncInbox?{asyncInbox}:{}),blocker,status,id:ticket.id,label:'Task '+opaque(ticket.id).slice(0,8),state:enumState(state),...(run?{phase:enumState(run.phase)}:{}),updatedAt:ticket.updatedAt,...(run?.workerId?{workerId:run.workerId}:{}),...(run?.backendId?{backendId:run.backendId}:{}),...(run?.threadId?{sessionRef:opaque(run.threadId)}:{}),hasResult:!!run?.result,evidence,revision:host.settings.current().revision,observed,problem,unknownEffects:unknown,pendingApprovals:approvals.length,acceptance,actions,next:unknown?'reconcile':approvals.length?'answer_approval':held?'review_context':['auth_required','configuration_invalid'].includes(problem)?'reconnect':ticket.attention?'follow_up':'none'}
  return {...projected,recovery:recoveryManifest(host.store,projected)}
 }
 private readAllowed(host:Runtime,ticket:Ticket){
  const source=host.config.sources.find(s=>s.id===ticket.mandate.actor.source)
  if(!source?.enabled||!source.allowedActors.includes(ticket.mandate.actor.id)||!host.scopes.taskRunnable(ticket.id))return false
  const saved=host.store.get<{manifest:import('./router-memory.ts').ContextManifest}>('task-context',ticket.id)
  try{return host.memory.readOnly(()=>{if(saved)host.memory.validate(saved.manifest);const authority=host.taskAuthority(ticket.id);if(authority?.parentTrigger){if(host.scopes.enabled()&&!host.store.get('router-route',authority.parentTrigger))return false;host.routerIngress.authority(authority.parentTrigger,authority.discussion)}return true})}catch{return false}
 }
 private authorized(host:Runtime,ticket:Ticket,run:Run){
  const source=host.config.sources.find(s=>s.id===ticket.mandate.actor.source)
  if(!source?.enabled||!source.allowedActors.includes(ticket.mandate.actor.id))return false
  return host.memory.readOnly(()=>host.validWork({ticketId:ticket.id,assignmentId:run.assignmentId,cwd:run.cwd,sandbox:source.sandbox,depth:0}))
 }
 snapshot(value:unknown={}){
  const query=traceSnapshotSchema.parse(value),host=this.current()
  if(query.ticketId&&!visible(host,query.ticketId))throw new TraceError('trace_task_missing',404)
  const all=host.store.tickets.list().filter(t=>visible(host,t.id)&&(!query.ticketId||t.id===query.ticketId)).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))
  // GET observation must not materialize missing routes through nested authority checks.
  // Recovery calls task() directly and retains its existing execution semantics.
  return host.scopes.readOnly(()=>({at:Date.now(),revision:host.settings.current().revision,visibility:this.visibility(host),cursor:this.head(host),total:all.length,offset:query.offset,more:query.offset+query.limit<all.length,tasks:all.slice(query.offset,query.offset+query.limit).map(t=>this.task(host,t))}))
 }
 exportRecoveryPackage(value:unknown){
  const input=z.object({ticketId:id,revision:z.number().int().nonnegative(),observed:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(value),host=this.host()
  return host.scopes.readOnly(()=>{
   if(!visible(host,input.ticketId))throw new TraceError('trace_task_missing',404)
   const ticket=host.store.tickets.get(input.ticketId)!
   if(!this.readAllowed(host,ticket))throw new TraceError('trace_action_unavailable',403)
   const current=this.task(host,ticket)
   if(input.revision!==current.revision)throw new TraceError('trace_settings_conflict')
   if(input.observed!==current.observed)throw new TraceError('trace_changed')
   return createRecoveryPackage(current)
  })
 }
 async recover(value:unknown):Promise<RecoveryResult>{
  const input=traceRecoverySchema.parse(value),host=this.current(),key=stableDigest(['execution-trace',input.requestId]),fingerprint=stableDigest(input)
  if(!visible(host,input.ticketId))throw new TraceError('trace_task_missing',404)
  const receipt=host.store.get<RecoveryReceipt>('execution-trace-command',key)
  if(receipt){
   if(receipt.fingerprint!==fingerprint)throw new TraceError('trace_request_conflict')
   if(receipt.state==='completed')return receipt.result!
   if(this.inFlight.has(key))throw new TraceError('trace_recovery_pending')
   if(receipt.action==='cancel'&&host.store.tickets.get(input.ticketId)?.ended?.outcome==='stopped'){
    const result:RecoveryResult={status:'cancelled',ticketId:input.ticketId,replayed:false,at:Date.now()}
    host.store.put('execution-trace-command',key,{...receipt,state:'completed',result});return result
   }
   if(receipt.action!=='read_history')throw new TraceError('trace_recovery_uncertain')
  }
  const task=host.store.tickets.get(input.ticketId)!
  const current=this.task(host,task)
  if(input.revision!==host.settings.current().revision)throw new TraceError('trace_settings_conflict')
  if(input.observed!==current.observed)throw new TraceError('trace_changed')
  if(!current.actions.includes(input.action))throw new TraceError(current.unknownEffects&&input.action==='resume_session'?'trace_reconcile_required':'trace_action_unavailable')
  if(input.action==='resume_session'&&current.blocker?.retryPolicy.mode==='after_repair'&&!input.repairConfirmed)throw new TraceError('trace_repair_confirmation_required')
  if(input.action==='inspect')return {status:'inspected',ticketId:input.ticketId,replayed:false,at:Date.now(),task:current}
  const started:RecoveryReceipt={fingerprint,state:'started',action:input.action,ticketId:input.ticketId,at:Date.now()}
  const complete=(status:RecoveryResult['status'])=>{
   const result:RecoveryResult={status,ticketId:input.ticketId,replayed:false,at:Date.now()}
   host.store.put('execution-trace-command',key,{...started,state:'completed',result});return result
  }
  if(input.action==='resume_session')return host.store.atomic(()=>{
   // Runtime.retry retains the thread and delegates scheduling to the Engine.
   // This layer implements no run/job/outbox mutation or effect replay.
   try{host.retry(input.ticketId)}catch{throw new TraceError('trace_recovery_failed')}
   return complete('resumed')
  })
  host.store.put('execution-trace-command',key,started);this.inFlight.add(key)
  try{
   if(input.action==='read_history'){
    const run=host.store.get<Run>('run',input.ticketId)!
    let verified=false,timer:ReturnType<typeof setTimeout>|undefined
    try{const history=await Promise.race([host.model.history!(run.threadId!,run.cwd),new Promise<undefined>(resolve=>{timer=setTimeout(()=>resolve(undefined),15000)})]);verified=history!==undefined&&history!==null}catch{/* Never expose a raw provider exception or history. */}finally{if(timer)clearTimeout(timer)}
    if(this.host()!==host)throw new TraceError('trace_host_changed')
    const fresh=host.store.tickets.get(input.ticketId)
    if(!fresh||!visible(host,input.ticketId)||input.revision!==host.settings.current().revision||this.task(host,fresh).observed!==input.observed||!this.readAllowed(host,fresh))throw new TraceError('trace_changed')
    return complete(verified?'history_verified':'history_unavailable')
   }
   try{await host.stop(input.ticketId)}catch{
    if(this.host()===host)try{host.store.put('execution-trace-command',key,{...started,state:'uncertain'})}catch{/* The durable started receipt fences a closed host. */}
    throw new TraceError('trace_recovery_uncertain')
   }
   if(this.host()!==host)throw new TraceError('trace_host_changed')
   return complete('cancelled')
  }finally{this.inFlight.delete(key)}
 }
}
