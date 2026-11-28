import {schedulePlanState,scheduledRunLifecycle} from './schedule-lifecycle.ts'
import {z} from 'zod'
import {quietHoursSchema,quietUntil} from './notification-quiet-hours.ts'
import type {Delivery} from './store.ts'
import type {Runtime} from './runtime.ts'
import type {Trigger,Mandate} from './vendor/dsh-core/index.ts'
import type {ScopeContext} from './router-scope.ts'
import type {ChatScheduleChange} from './chat-schedules.ts'
import type {RouterAdmission} from './router-ingress.ts'
import type {ContextManifest} from './router-memory.ts'
import type {ToolSpec} from './model.ts'
import {assessment,type Assessment} from './schemas.ts'
import {stableDigest,bodyDigest} from './sources.ts'
import {taskView} from './task-context.ts'
import {skillRefSchema} from './goal-contract.ts'
import {goalCommandSchema} from './router-goals.ts'
import {timingSchema,nextTime,latestDue,type Timing} from './schedule-time.ts'

const id=z.string().min(1).max(300)
const dutySchema=z.object({id,name:id,entryIds:z.array(id).min(1),instruction:z.string().min(1).max(16000),mode:z.enum(['off','observe','auto']).default('observe')}).strict()
const settingsSchema=z.object({quietHours:quietHoursSchema.nullable().optional(),enabled:z.boolean(),debounceMs:z.number().int().min(0).max(30000).default(1500),maxWaitMs:z.number().int().min(1).max(60000).default(5000),cooldownMs:z.number().int().min(0).max(3600000).default(60000)}).strict().refine(x=>x.maxWaitMs>=x.debounceMs,'maxWaitMs must cover debounceMs')
const reminderSchema=z.object({id,name:id,triggerId:id,timezone:z.string(),startAt:z.string()}).strict()
const commitmentSchema=reminderSchema.extend({time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)}).strict()
const isRecurringReminder=(plan:{reminder?:true;timing:Timing})=>plan.reminder===true&&plan.timing.kind!=='once'
const scheduleSchema=z.object({id,name:id,triggerId:id,skill:skillRefSchema.optional(),prompt:z.string().min(1).max(16000),timing:timingSchema,mode:z.enum(['standalone','continue']),ticketId:id.optional(),notification:z.enum(['always','findings','silent']).default('findings'),active:z.boolean().default(true)}).strict().refine(x=>x.mode!=='continue'||!!x.ticketId,'Continuation requires ticketId')
export const proactiveCommandSchema=z.object({action:z.enum(['list','settings.put','duty.put','schedule.put','schedule.retime','schedule.pause','schedule.resume','schedule.run','schedule.cancel','reminder.put','commitment.put','run.cancel']),scopeId:id,operationId:id.optional(),expectedRevision:z.number().int().min(0).optional(),id:id.optional(),settings:settingsSchema.optional(),duty:dutySchema.optional(),schedule:scheduleSchema.optional(),reminder:reminderSchema.optional(),commitment:commitmentSchema.optional(),timing:timingSchema.optional()}).strict()
type Command=z.infer<typeof proactiveCommandSchema>
type Duty=z.infer<typeof dutySchema>&{scopeId:string;revision:number}
type Controls=z.infer<typeof settingsSchema>&{scopeId:string;revision:number}
type Schedule=z.infer<typeof scheduleSchema>&{scopeId:string;revision:number;entryId:string;bindingRevision:number;nextAt?:number;createdAt:number;reminder?:true;cancelledAt?:number;promotion?:{goalId:string;at:number}}
export interface CommitmentOrigin {scheduleId:string;scopeId:string;entryId:string;discussion:string;owner:string;stopCondition:'explicit_cancel_or_authority_revoked'}
export interface ScheduledRun {queuedAt?:number;startedAt?:number;firstDueAt?:number;triggerKind?:'scheduled'|'manual';goalId?:string;id:string;scheduleId:string;scopeId:string;revision:number;scheduledAt:number;createdAt:number;triggerId?:string;triggerHash?:string;spec:Schedule;state:'queued'|'running'|'waiting'|'completed'|'failed'|'cancelled'|'skipped';taskIds:string[];delivery:'none'|'pending'|'sent'|'failed';reason?:string;finishedAt?:number}
export interface MessageBatch {id:string;scopeId:string;entryId:string;discussion:string;actor:string;strength:'explicit'|'inferred';policyVersion:string;settingsRevision:number;triggerIds:string[];firstAt:number;dueAt:number;state:'pending'|'evaluating'|'decided'|'failed';decision?:Intervention;manifest?:ContextManifest;reason?:string}
export type Intervention=Assessment|{action:'clarify';reason:string;question:string}
const terminal=new Set(['completed','failed','cancelled','skipped'])
const defaults={enabled:false,debounceMs:1500,maxWaitMs:5000,cooldownMs:60000,revision:0}
export const proactiveSpecs:ToolSpec[]=[{type:'function',name:'router_manage',description:'Manage this Router scope: list duties, batch settings, schedules and run receipts. Mutations require an explicit human scope manager, operationId and current expectedRevision. Create a simple one-time reminder only after an unambiguous request by the current human, using reminder.put with {id,name,triggerId,timezone,startAt} from exact /remind <ISO time with offset> <IANA zone> <text>, with no model turn on delivery. Create a daily lightweight commitment using commitment.put with {id,name,triggerId,timezone,startAt,time} only from exact /commit-daily <ISO start with offset> <IANA zone> <HH:mm local> <text>. Its notices repeat in the same conversation without Worker or Goal execution. For this kind, the original conversation uses /pause-commitment, /resume-commitment or /cancel-commitment followed by the encoded ID. Hypothetical requests are not reminders or commitments. schedule.cancel retires an unpromoted plan, unlike pause. A schedule requires a real explicit triggerId, prompt, mode standalone or continue, notification always/findings/silent, and timing {kind:once/interval/daily/weekly,timezone:IANA,startAt:ISO with offset,endAt?,intervalSeconds?,time:HH:mm,weekdays?:0=Sunday}. Use schedule.retime with id and timing to change only the recurrence. Continue requires ticketId and never restarts ended work. Pausing a schedule only affects future runs; run.cancel stops the selected run. settings.quietHours optionally sets {timezone:IANA,start:HH:mm,end:HH:mm} for scheduled external notifications only; null disables it. Work and direct replies are not delayed. Duties are scoped written instructions, mode off/observe/auto; global observe/off remains a ceiling.',inputSchema:{type:'object',properties:{action:{type:'string',enum:proactiveCommandSchema.shape.action.options},scopeId:{type:'string'},operationId:{type:'string'},expectedRevision:{type:'integer'},id:{type:'string'},settings:{type:'object'},duty:{type:'object'},schedule:{type:'object'},reminder:{type:'object'},commitment:{type:'object'},timing:{type:'object'}},required:['action','scopeId'],additionalProperties:false}}]

/** Durable host extension. Time creates source events; Eval itself never schedules a wake. */
export class RouterProactive {
 private quietCache=new Map<string,{minute:number;until:number|undefined}>()
 private settledVersion=-1
 private readonly dueBatches
 private readonly dueSchedules
 private readonly scheduledRun
 private readonly settlementJobs
 private readonly settlementReplies
 private readonly pendingTaskReports
 private readonly assignedTasks

 constructor(readonly host:Runtime,readonly now:()=>number=Date.now){
  const db=host.store.db
  db.exec(`
   CREATE INDEX IF NOT EXISTS router_batch_due ON records(json_extract(body,'$.dueAt'))
     WHERE kind='router-batch' AND json_extract(body,'$.state')='pending';
   CREATE INDEX IF NOT EXISTS router_schedule_due ON records(json_extract(body,'$.nextAt'))
     WHERE kind='router-schedule' AND json_extract(body,'$.active')=1;
   CREATE INDEX IF NOT EXISTS router_schedule_trigger ON records(json_extract(body,'$.triggerId')) WHERE kind='router-schedule-run';
   CREATE INDEX IF NOT EXISTS jobs_trigger ON jobs(json_extract(payload,'$.triggerId')) WHERE json_valid(payload);
   CREATE INDEX IF NOT EXISTS routed_task_trigger ON records(json_extract(body,'$.parentTrigger'))
     WHERE kind IN ('worker-assignment','task-routing');
   CREATE INDEX IF NOT EXISTS outbox_unsettled_ticket ON outbox(json_extract(body,'$.ticketId')) WHERE status NOT IN ('sent','dropped');
   CREATE INDEX IF NOT EXISTS router_inbox_ticket ON records(json_extract(body,'$.ticketId')) WHERE kind='router-inbox';
  `)
  this.dueBatches=db.prepare(`SELECT body FROM records WHERE kind='router-batch' AND json_extract(body,'$.state')='pending'
     AND json_extract(body,'$.dueAt')<=? ORDER BY rowid`)
  this.dueSchedules=db.prepare(`SELECT body FROM records WHERE kind='router-schedule' AND json_extract(body,'$.active')=1
     AND json_extract(body,'$.nextAt')<=? ORDER BY rowid`)
  this.scheduledRun=db.prepare("SELECT body FROM records WHERE kind='router-schedule-run' AND json_extract(body,'$.triggerId')=? ORDER BY rowid LIMIT 1")
  this.settlementJobs=db.prepare("SELECT state,error FROM jobs WHERE json_valid(payload) AND json_extract(payload,'$.triggerId')=? ORDER BY rowid")
  this.settlementReplies=db.prepare(`SELECT d.status FROM records AS r JOIN outbox AS d ON d.id=r.id
    WHERE r.kind='router-reply-owner' AND EXISTS(SELECT 1 FROM json_each(r.body,'$.inputs') WHERE value=?)`)
  this.pendingTaskReports=db.prepare(`
    SELECT 1 FROM outbox WHERE status NOT IN ('sent','dropped')
      AND json_extract(body,'$.ticketId') IN (SELECT value FROM json_each(?))
    UNION ALL
    SELECT 1 FROM records AS i WHERE i.kind='router-inbox'
      AND json_extract(i.body,'$.ticketId') IN (SELECT value FROM json_each(?))
      AND NOT EXISTS(SELECT 1 FROM records WHERE kind='router-read' AND id=json_extract(i.body,'$.id'))
    LIMIT 1`)
  this.assignedTasks=db.prepare(`SELECT json_extract(body,'$.ticketId') AS ticketId FROM records
    WHERE kind IN ('worker-assignment','task-routing') AND json_extract(body,'$.parentTrigger')=?
    ORDER BY kind='task-routing',rowid`)
  host.routerIngress.rulesFor=t=>this.rules(t)
  host.routerIngress.ruleExecutionAllowed=ids=>ids.every(id=>host.config.rules.some(r=>r.id===id)||this.duties().some(d=>this.ruleId(d)===id&&d.mode==='auto'))
  host.routerIngress.defer=(a,t)=>host.chat.planningInput(t)?false:this.collect(a,t)
  host.routerIngress.scheduledAuthority=id=>this.authority(id)
  // Older versions exhausted their eight-day search at a weekly DST gap.
  // Restore only the next future occurrence, never replay the missed week or
  // resume a paused/expired plan. Normal launch-time authority checks still apply.
  for(const p of host.store.list<Schedule>('router-schedule'))if(p.active&&p.timing.kind==='weekly'&&p.nextAt===undefined){
   const nextAt=nextTime(p.timing,this.now())
   if(nextAt!==undefined)host.store.put('router-schedule',stableDigest([p.scopeId,p.id]),{...p,nextAt})
  }
 }
 private duties(){return this.host.store.list<Duty>('router-duty')}
 private ruleId(d:Duty){return 'duty:'+stableDigest([d.scopeId,d.id,d.revision,d.mode])}
 rules(t?:Trigger){
  const entry=t?this.host.scopes.entry(t):undefined
  let scopeId=entry?.scopeId
  if(t&&entry){try{scopeId=this.host.scopes.context(t,t.source+':'+t.threads[0]!.id)?.route.scopeId}catch{return this.host.config.rules}}
  return [...this.host.config.rules,...this.duties().filter(d=>d.mode!=='off'&&(!t||entry&&scopeId===d.scopeId&&d.entryIds.includes(entry.id))).map(d=>({id:this.ruleId(d),instruction:d.instruction}))]
 }
 controls(scopeId:string):Controls{return {...defaults,scopeId,...this.host.store.get<Controls>('router-proactive-settings',scopeId)}}
 chatSchedules(scopeId:string,conversationId:string,nativeId:string,sourceId:string,actor:string){
  const entry=this.host.scopes.bindings().find(e=>e.nativeId===nativeId&&e.scopeId===scopeId&&e.sourceId===sourceId&&e.privateActor===JSON.stringify([sourceId,actor]))
  if(!entry)return []
  return this.host.store.db.prepare(`SELECT p.body FROM records p JOIN records r ON r.kind='chat-run' AND r.id=json_extract(p.body,'$.triggerId')
    WHERE p.kind='router-schedule' AND json_extract(p.body,'$.scopeId')=? AND json_extract(p.body,'$.entryId')=? AND json_extract(r.body,'$.conversationId')=? ORDER BY p.rowid DESC`)
    .all(scopeId,entry.id,conversationId).map(row=>JSON.parse(String(row.body)) as Schedule)
 }
 snapshot(scopeId:string,context?:ScopeContext){
  this.host.scopes.scope(scopeId)
  const inScope=(v:{scopeId:string})=>v.scopeId===scopeId
  const visible=(entryId:string)=>context?entryId===context.route.entryId:!this.host.scopes.bindings().find(e=>e.id===entryId)?.privateActor
  const plans=this.host.store.list<Schedule>('router-schedule').filter(inScope)
  const visiblePlan=(p:Schedule)=>{
   if(!visible(p.entryId))return false
   if(!p.reminder&&!p.promotion&&!p.cancelledAt)return true
   try{return this.host.scopes.readOnly(()=>this.layerVisible(this.validatePlan(p).context,context))}catch{return false}
  }
  const plansById=new Map(plans.map(p=>[p.id,p] as const))
  const acceptedGoals=context?[]:this.host.goals.snapshot().filter(g=>g.scopeId===scopeId&&g.state==='completed'&&g.finalRoundId&&g.nodes?.every(n=>n.workerId)).map(g=>({id:g.id,title:g.title,skill:g.contract?.skill}))
  const commitments=this.host.scopes.readOnly(()=>this.host.memory.readOnly(()=>this.commitmentLayers(scopeId,context)))
  return {commitments,skills:this.host.skills.list(scopeId,context),acceptedGoals,settings:this.controls(scopeId),duties:this.duties().filter(d=>inScope(d)&&d.entryIds.every(visible)),schedules:plans.filter(visiblePlan).map(p=>({...p,lifecycle:schedulePlanState(p,this.now())})),runs:this.host.store.list<ScheduledRun>('router-schedule-run').filter(r=>inScope(r)&&this.readableRun(r)&&visible(r.spec.entryId)&&visiblePlan(plansById.get(r.scheduleId)??r.spec)).slice(-100).map(r=>({...r,activeWork:this.unsettled(r),pendingNotifications:this.pendingNotifications(r),lifecycle:scheduledRunLifecycle(r,this.host.store.deliveries().filter(m=>!m.channel.address.routerInbox&&!!r.triggerId&&(this.host.store.get<{inputs?:string[]}>('router-reply-owner',m.id)?.inputs??[]).includes(r.triggerId)))})),decisions:this.host.store.list<MessageBatch>('router-batch').filter(b=>inScope(b)&&visible(b.entryId)).slice(-100)}
 }
 private layerVisible(owner:ScopeContext,current?:ScopeContext){
  return current?owner.route.entryId===current.route.entryId&&owner.route.discussion===current.route.discussion&&owner.actor===current.actor:!this.host.scopes.binding(owner.route.entryId).privateActor
 }
 private checkPlanOwner(plan:Schedule,current?:ScopeContext){
  if(!current)return
  const original=this.host.store.triggers.get(plan.triggerId),admission=this.host.routerIngress.get(plan.triggerId)
  if(!original||this.host.scopes.actor(original)!==current.actor||admission?.discussion!==current.route.discussion)throw Error('Use the original owner and conversation to manage this commitment')
 }
 private commitmentLayers(scopeId:string,context?:ScopeContext){
  const plans=this.host.store.list<Schedule>('router-schedule').filter(p=>p.scopeId===scopeId)
  const goals=context?this.host.goals.list(context):this.host.goals.snapshot().filter(g=>g.scopeId===scopeId)
  const rows=plans.flatMap(p=>{
   let authority:ReturnType<RouterProactive['validatePlan']>
   try{authority=this.validatePlan(p)}catch{return []}
   const owner=authority.context.actor
   if(!this.layerVisible(authority.context,context))return []
   const goal=p.promotion&&goals.find(g=>g.id===p.promotion?.goalId)
   const once=p.timing.kind==='once'&&p.mode==='standalone'&&!p.skill
   const promotable=!p.promotion&&!p.cancelledAt&&p.mode==='standalone'&&!p.skill&&!p.timing.endAt
   return [{id:p.id,revision:p.revision,title:p.name,scopeId,entryId:p.entryId,owner,kind:once?'reminder' as const:'commitment' as const,state:p.promotion?(goal?.state==='cancelled'?'cancelled':'promoted'):p.cancelledAt?'cancelled':schedulePlanState(p,this.now()).state,stopCondition:'explicit_cancel_or_authority_revoked' as const,...(p.active&&!p.promotion?{nextAt:p.nextAt}:{}),...(p.promotion?{goalId:p.promotion.goalId}:{}),...(promotable?{promoteText:'/promote-reminder '+encodeURIComponent(p.id)}:{})}]
  })
  return [...rows,...goals.map(g=>({id:g.id,revision:g.revision,title:g.title,scopeId,entryId:g.entryId,owner:g.actor,kind:'goal' as const,state:g.state,stopCondition:'explicit_cancel_or_authority_revoked' as const,...(g.commitmentOrigin?{scheduleId:g.commitmentOrigin.scheduleId}:{})}))]
 }
 /** Called inside the same transaction as insertion of the authorized Goal. */
 promotePlan(origin:NonNullable<import('./router-goals.ts').GoalCommand['promotesSchedule']>,goalId:string,current:ScopeContext):CommitmentOrigin{
  const store=this.host.store,key=stableDigest([current.route.scopeId,origin.id]),p=store.get<Schedule>('router-schedule',key)
  if(!p||p.cancelledAt||p.promotion||p.mode!=='standalone'||p.skill||p.timing.endAt)throw Error('Commitment is not available for promotion')
  this.revision(p.revision,origin.expectedRevision)
  const prior=this.validatePlan(p).context
  if(prior.actor!==current.actor||prior.route.entryId!==current.route.entryId||prior.route.discussion!==current.route.discussion)throw Error('Promotion requires the original owner and conversation')
  if(store.list<ScheduledRun>('router-schedule-run').some(r=>r.scopeId===p.scopeId&&r.scheduleId===p.id&&(this.unsettled(r)||this.unconfirmedDelivery(r))))throw Error('Settle prior runs and deliveries before promotion')
  store.requireWorkflowCommitmentsSchema()
  store.put('router-schedule',key,{...p,active:false,nextAt:undefined,revision:p.revision+1,promotion:{goalId,at:this.now()}})
  return {scheduleId:p.id,scopeId:p.scopeId,entryId:p.entryId,discussion:prior.route.discussion,owner:prior.actor,stopCondition:'explicit_cancel_or_authority_revoked'}
 }
 promotedSourceCurrent(link:CommitmentOrigin,goalId:string){
  const p=this.host.store.get<Schedule>('router-schedule',stableDigest([link.scopeId,link.scheduleId]))
  if(!p||p.promotion?.goalId!==goalId||p.active||p.cancelledAt)throw Error('Promoted commitment is no longer authorized')
  const {context}=this.validatePlan(p)
  if(context.actor!==link.owner||context.route.entryId!==link.entryId||context.route.discussion!==link.discussion)throw Error('Promoted commitment owner or conversation changed')
 }
 private requireManager(scopeId:string,context?:ScopeContext){
  this.host.scopes.scope(scopeId)
  if(!context)return // HTTP/MCP operator control plane; never reachable from model tool without context.
  const m=this.host.routerIngress.authority(context.trigger.id)
  if(context.route.scopeId!==scopeId||!context.trigger.human||m.strength!=='explicit'||!this.host.scopes.canManage(context))throw Error('An explicit human scope manager is required')
 }
 command(value:unknown,context?:ScopeContext){
  return this.execute(value,context,context?.trigger.text.trim())
 }
 editChatSchedule(input:ChatScheduleChange,context:ScopeContext){
  // The card supplies the edit. Its creation message still identifies the owner and conversation.
  const change='timing' in input?{action:'schedule.retime',timing:input.timing}:{action:input.active?'schedule.resume':'schedule.pause'}
  return this.execute({...change,scopeId:context.route.scopeId,id:input.id,expectedRevision:input.expectedRevision,operationId:input.operationId},context)
 }
 private execute(value:unknown,context?:ScopeContext,commandText?:string){
  const x=proactiveCommandSchema.parse(value)
  if(context){this.host.scopes.assertCurrent(context);if(context.route.scopeId!==x.scopeId)throw Error('Outside Router scope')}
  if(x.action==='list')return this.snapshot(x.scopeId,context)
  this.requireManager(x.scopeId,context)
  if(commandText?.startsWith('/remind ')&&x.action!=='reminder.put')throw Error('Use the reminder action for this request')
  if(commandText?.startsWith('/commit-daily ')&&x.action!=='commitment.put')throw Error('Use the commitment action for this request')
  const control=commandText?.match(/^\/(pause|resume|cancel)-commitment /)?.[1]
  if(control){
   const plan=this.host.store.get<Schedule>('router-schedule',stableDigest([x.scopeId,x.id??'']))
   if(x.action!=='schedule.'+control||!plan||!isRecurringReminder(plan)||commandText!=='/'+control+'-commitment '+encodeURIComponent(plan.id))throw Error('Use the exact command for an existing recurring commitment')
  }
  if(context&&x.action==='run.cancel'){
   const run=this.host.store.get<ScheduledRun>('router-schedule-run',x.id??'')
   if(run&&run.scopeId===x.scopeId&&isRecurringReminder(run.spec))throw Error('Use the commitment control command for recurring notices')
  }
  if(!x.operationId||x.expectedRevision===undefined)throw Error('Mutation requires operationId and expectedRevision')
  const key=stableDigest([x.scopeId,context?.actor??'operator',context?.route.entryId??'operator',x.operationId])
  return this.host.store.atomic(()=>{
   const old=this.host.store.get<any>('proactive-receipt',key)
   const supplied=value as z.input<typeof proactiveCommandSchema>
   const scheduleId=x.action==='schedule.put'?x.schedule?.id:x.action==='schedule.retime'?x.id:undefined
   const timing=x.action==='schedule.put'?x.schedule?.timing:x.timing
   if(scheduleId&&timing&&(x.action==='schedule.put'?supplied.schedule?.timing:supplied.timing)?.timezone===undefined){
    const saved=this.host.store.get<Schedule>('router-schedule',stableDigest([x.scopeId,scheduleId]))
    // Replay uses the zone recorded for this operation, even after edits or a host move.
    timing.timezone=old?.result?.timing?.timezone??saved?.timing.timezone
      ??(x.schedule?this.host.chat.clientContext(x.schedule.triggerId)?.clientTimeZone:undefined)??Intl.DateTimeFormat().resolvedOptions().timeZone
   }
   const fingerprint=stableDigest(x)
   if(old){if(old.fingerprint!==fingerprint)throw Error('operationId reused with different content');return old.result}
   const result=this.apply(x,context,commandText)
   this.host.store.put('proactive-receipt',key,{fingerprint,scopeId:x.scopeId,result});this.host.store.audit({type:'router.proactive.command',action:x.action,scopeId:x.scopeId,operationId:x.operationId});return result
  })
 }
 private revision(actual:number,expected:number|undefined){if(actual!==expected)throw Error('Revision conflict; refresh before retrying')}
 private apply(x:Command,context?:ScopeContext,commandText?:string):unknown{
  const store=this.host.store
  if(x.action==='settings.put'){
   if(!x.settings)throw Error('settings required');const previous=this.controls(x.scopeId);this.revision(previous.revision,x.expectedRevision)
   const next={...x.settings,...(x.settings.quietHours===undefined&&previous.quietHours!==undefined?{quietHours:previous.quietHours}:{}),scopeId:x.scopeId,revision:previous.revision+1};store.put('router-proactive-settings',x.scopeId,next);return next
  }
  if(x.action==='duty.put'){
   if(!x.duty)throw Error('duty required');const key=stableDigest([x.scopeId,x.duty.id]),old=store.get<Duty>('router-duty',key);this.revision(old?.revision??0,x.expectedRevision)
   for(const entry of old?.entryIds??[])this.checkControlEntry(entry,context)
   for(const id of x.duty.entryIds){const e=this.host.scopes.binding(id);if(e.scopeId!==x.scopeId||!this.host.scopes.sourceActive(e))throw Error('Duty entry is outside active scope');if(e.privateActor&&(!context||context.actor!==e.privateActor))throw Error('Private duties require the actual member')}
   const next={...x.duty,scopeId:x.scopeId,revision:(old?.revision??0)+1};store.put('router-duty',key,next);return next
  }
  if(x.action==='run.cancel'){
   const run=this.getRun(x.id??'');if(!run||run.scopeId!==x.scopeId)throw Error('Unknown run');this.revision(run.revision,x.expectedRevision)
   this.checkControlEntry(run.spec.entryId,context)
   if(run.spec.reminder){
    this.checkPlanOwner(run.spec,context)
    // A deterministic notice did not spawn Router work. Never abort a live,
    // unrelated Router turn that happens to share its original discussion.
    const messageId='schedule-reminder:'+run.id
    const row=store.db.prepare('SELECT status FROM outbox WHERE id=?').get(messageId)
    if(row?.status!=='pending')return run
    store.outbox.withdraw(messageId)
    const next={...run,state:'cancelled' as const,finishedAt:this.now()}
    store.put('router-schedule-run',run.id,next)
    return next
   }
   if(terminal.has(run.state)&&!this.unsettled(run)&&!this.pendingNotifications(run))return run
   const taskIds=this.ownedTasks(run)
   const goal=run.goalId&&this.host.goals.get(run.goalId)
   if(goal&&!['completed','cancelled'].includes(goal.state))store.put('router-goal',goal.id,{...goal,state:'cancelled',revision:goal.revision+1,reason:'Scheduled run stopped by a person',nextAt:undefined})
   for(const id of taskIds){const t=store.tickets.get(id);if(t&&!t.ended)this.host.engine.stopTicket(id,'Scheduled run stopped by a person')}
   const next={...run,taskIds,state:'cancelled' as const,finishedAt:this.now()};store.put('router-schedule-run',run.id,next);if(run.triggerId)this.host.abortScheduledRun(run.triggerId);return next
  }
  if(x.action==='reminder.put'){
   if(!x.reminder||x.schedule||x.expectedRevision!==0)throw Error('A new reminder requires reminder details and revision zero')
   const {id,name,triggerId,timezone,startAt}=x.reminder
   if(!store.triggers.get(triggerId)?.channel)throw Error('The authorized conversation has no reply channel')
   if(context&&context.trigger.text.trim()!=='/remind '+startAt+' '+timezone+' '+name)throw Error('Use /remind <ISO time with offset> <IANA zone> <text>, or create it in the management panel')
   const key=stableDigest([x.scopeId,id])
   if(store.get('router-schedule',key))throw Error('Reminder already exists')
   if(context){
    const previous=store.list<Schedule>('router-schedule').find(p=>p.scopeId===x.scopeId&&p.triggerId===triggerId&&p.reminder)
    if(previous)return previous
   }
   const result=this.apply({...x,action:'schedule.put',reminder:undefined,schedule:{id,name,triggerId,prompt:name,timing:timingSchema.parse({kind:'once',timezone,startAt}),mode:'standalone',notification:'always',active:true}},context) as Schedule
   store.requireWorkflowCommitmentsSchema()
   const next={...result,reminder:true as const}
   store.put('router-schedule',key,next)
   return next
  }
  if(x.action==='commitment.put'){
   const spec=x.commitment
   if(!spec||x.reminder||x.schedule||x.expectedRevision!==0)throw Error('A new daily commitment requires commitment details and revision zero')
   const {id,name,triggerId,timezone,startAt,time}=spec
   const anchor=store.triggers.get(triggerId)
   if(!anchor?.channel)throw Error('The authorized conversation has no reply channel')
   if(context&&(context.trigger.id!==triggerId||context.trigger.text.trim()!=='/commit-daily '+startAt+' '+timezone+' '+time+' '+name))throw Error('Use /commit-daily <ISO time with offset> <IANA zone> <HH:mm local> <text>, or create it in the management panel')
   const timing=timingSchema.parse({kind:'daily',timezone,startAt,time}),key=stableDigest([x.scopeId,id])
   const same=(p:Schedule)=>p.reminder&&p.triggerId===triggerId&&p.name===name&&stableDigest(p.timing)===stableDigest(timing)
   const existing=store.get<Schedule>('router-schedule',key)
   if(existing){this.checkControlEntry(existing.entryId,context);this.checkPlanOwner(existing,context);if(same(existing))return existing;throw Error('Commitment ID already exists')}
   if(context){
    const previous=store.list<Schedule>('router-schedule').find(p=>p.scopeId===x.scopeId&&p.triggerId===triggerId&&p.reminder)
    if(previous){if(same(previous))return previous;throw Error('This authorization already created a different commitment')}
   }
   const plan=this.apply({...x,action:'schedule.put',commitment:undefined,schedule:{id,name,triggerId,prompt:name,timing,mode:'standalone',notification:'always',active:true}},context) as Schedule
   store.requireWorkflowCommitmentsSchema()
   // Reuse the deterministic notice path, but fence older hosts that do
   // not implement the recurring plan's pause and unsettled-delivery checks.
   const next={...plan,reminder:true as const}
   store.put('router-schedule',key,next)
   return next
  }
  const planId=x.schedule?.id??x.id??'',key=stableDigest([x.scopeId,planId]),old=store.get<Schedule>('router-schedule',key)
  if(old){this.checkControlEntry(old.entryId,context);if(old.reminder||old.promotion||old.cancelledAt)this.checkPlanOwner(old,context)}
  this.revision(old?.revision??0,x.expectedRevision)
  if(old?.promotion)throw Error('The commitment was promoted; manage the goal instead')
  if(old?.cancelledAt)throw Error('The commitment is cancelled; create a new one')
  if(old?.reminder&&(x.action==='schedule.put'||x.action==='schedule.run'))throw Error('A lightweight reminder or commitment cannot be replaced or run manually')
  if(old&&isRecurringReminder(old)&&commandText!==undefined){
   const verb=x.action==='schedule.pause'?'pause':x.action==='schedule.resume'?'resume':x.action==='schedule.cancel'?'cancel':undefined
   if(verb&&commandText!=='/'+verb+'-commitment '+encodeURIComponent(old.id))throw Error('Use the exact commitment control command in the original conversation')
  }
  if(x.action==='schedule.cancel'){
   if(!old)throw Error('Unknown schedule')
   this.checkPlanOwner(old,context)
   // Cancel each settled/active receipt and withdraw queued notifications using the existing run control.
   for(const run of store.list<ScheduledRun>('router-schedule-run'))if(run.scopeId===old.scopeId&&run.scheduleId===old.id&&(this.unsettled(run)||this.pendingNotifications(run)||old.reminder&&store.outbox.status('schedule-reminder:'+run.id)==='pending')){
    this.apply({...x,action:'run.cancel',id:run.id,expectedRevision:run.revision},context)
   }
   store.requireWorkflowCommitmentsSchema()
   const stopped={...old,active:false,nextAt:undefined,revision:old.revision+1,cancelledAt:this.now()}
   store.put('router-schedule',key,stopped)
   return stopped
  }
  if(x.action==='schedule.put'){
   if(!x.schedule)throw Error('schedule required')
   const spec=x.schedule,anchor=store.triggers.get(spec.triggerId)
   if(!anchor||!anchor.human||this.runForTrigger(anchor.id))throw Error('Schedule needs an original human authorization')
   const a=this.host.routerIngress.get(anchor.id),c=a&&this.host.scopes.context(anchor,a.discussion)
   if(!c||c.route.scopeId!==x.scopeId||this.host.routerIngress.authority(anchor.id).strength!=='explicit'||!this.host.scopes.canManage(c))throw Error('Schedule anchor requires a current explicit scope manager')
   if(context&&context.trigger.id!==anchor.id)throw Error('Use the current human authorization as schedule anchor')
   const entry=this.host.scopes.binding(c.route.entryId)
   if(entry.privateActor&&!context)throw Error('Operator cannot impersonate a private message author')
   if(spec.skill){if(spec.mode!=='standalone')throw Error('Saved skills start a new goal');this.host.skills.reusable(spec.skill,x.scopeId,entry.id,c)}
   if(spec.ticketId){this.host.scopes.checkTask(spec.ticketId,c,true);this.host.scopes.checkTaskEntry(this.host.scopes.ownership(spec.ticketId)!,entry.id,'result')}
   const next:Schedule={...spec,scopeId:x.scopeId,entryId:entry.id,bindingRevision:entry.revision,revision:(old?.revision??0)+1,createdAt:old?.createdAt??this.now(),nextAt:nextTime(spec.timing,Math.max(this.now(),Date.parse(spec.timing.startAt)))}
   if(next.active&&next.nextAt===undefined)throw Error('No future occurrence in the selected time range')
   store.put('router-schedule',key,next);return next
  }
  if(!old)throw Error('Unknown schedule')
  if(x.action==='schedule.retime'){
   if(!x.timing)throw Error('timing required')
   this.validatePlan(old)
   const nextAt=nextTime(x.timing,this.now())
   if(nextAt===undefined)throw Error('No future occurrence in the selected time range')
   if(old.reminder)this.withdrawPendingReminders(old,x,context)
   const next={...old,timing:x.timing,nextAt:old.active?nextAt:undefined,revision:old.revision+1}
   store.put('router-schedule',key,next);return next
  }
  if(x.action==='schedule.run'){if(!old.active)throw Error('Resume this schedule before running');this.validatePlan(old);return this.launch(old,this.now(),'manual:'+x.operationId)}
  if(!['schedule.pause','schedule.resume'].includes(x.action))throw Error('Unknown action')
  const active=x.action==='schedule.resume'
  if(active)this.validatePlan(old)
  if(active&&old.reminder&&old.timing.kind==='once'){
   const at=Date.parse(old.timing.startAt)
   if(store.list<ScheduledRun>('router-schedule-run').some(r=>r.scopeId===old.scopeId&&r.scheduleId===old.id&&r.spec.timing.kind==='once'&&r.scheduledAt===at))throw Error('This one-time reminder has already run')
  }
  if(old.reminder&&old.active===active)return old
  if(old.reminder&&!active)this.withdrawPendingReminders(old,x,context)
  const next={...old,active,revision:old.revision+1,...(active?{nextAt:nextTime(old.timing,this.now()+(old.reminder?1:0))}:old.reminder?{nextAt:undefined}:{})}
  if(active&&next.nextAt===undefined)throw Error('Schedule has no future occurrence')
  store.put('router-schedule',key,next);return next
 }
 private withdrawPendingReminders(plan:Schedule,x:Command,context?:ScopeContext){
  for(const run of this.host.store.list<ScheduledRun>('router-schedule-run')){
   if(run.scopeId===plan.scopeId&&run.scheduleId===plan.id&&this.host.store.outbox.status('schedule-reminder:'+run.id)==='pending'){
    this.apply({...x,action:'run.cancel',id:run.id,expectedRevision:run.revision},context)
   }
  }
 }
 private checkControlEntry(entryId:string,context?:ScopeContext){
  const e=this.host.scopes.binding(entryId)
  if(context&&context.route.entryId!==entryId||!context&&e.privateActor)throw Error('Use the authorized entry to manage this object')
 }
 private validatePlan(p:Schedule){
  scheduleSchema.parse(Object.fromEntries(Object.entries(p).filter(([k])=>['id','name','triggerId','prompt','timing','mode','ticketId','notification','active','skill'].includes(k))))
  const trigger=this.host.store.triggers.get(p.triggerId)
  if(!trigger?.human||this.runForTrigger(p.triggerId))throw Error('Schedule authority unavailable')
  this.host.routerIngress.authority(p.triggerId)
  const a=this.host.routerIngress.get(p.triggerId)!,c=this.host.scopes.context(trigger,a.discussion)
  if(!c||c.route.scopeId!==p.scopeId||c.route.entryId!==p.entryId||this.host.scopes.binding(p.entryId).revision!==p.bindingRevision||!this.host.scopes.canManage(c))throw Error('Schedule ownership or entry authority changed')
  return {trigger,context:c,mandate:this.host.routerIngress.authority(trigger.id)}
 }
 private readableRun(run:Partial<ScheduledRun>|undefined):run is ScheduledRun{
  // A history reset can leave the occurrence identity for reconciliation and remove its execution spec.
  return !!run?.id&&!!run.spec?.triggerId&&Array.isArray(run.taskIds)&&
   !this.host.memory.cleanup.blocked('router-schedule-run',run.id,run)
 }
 private getRun(id:string){
  const run=this.host.store.get<Partial<ScheduledRun>>('router-schedule-run',id)
  return this.readableRun(run)?run:undefined
 }
 runForTrigger(id:string){
  const row=this.scheduledRun.get(id)
  const run=row?JSON.parse(String(row.body)) as Partial<ScheduledRun>:undefined
  return this.readableRun(run)?run:undefined
 }
 skillStart(input:unknown,context:ScopeContext){
  const run=this.runForTrigger(context.trigger.id)
  if(!run?.spec.skill)return false
  const {template}=this.host.skills.reusable(run.spec.skill,run.scopeId,run.spec.entryId,context)
  const expected=goalCommandSchema.parse({...template,action:'start',operationId:run.id,expectedRevision:0,authorizationQuote:run.spec.prompt})
  return stableDigest(input)===stableDigest(expected)
 }
 runSkill(id:string){
  const run=this.getRun(id)
  if(!run?.triggerId)throw Error('Missing scheduled source')
  if(run.state==='cancelled'||run.goalId)return
  this.host.store.atomic(()=>{
   this.beforeTurn(run.triggerId!)
   const trigger=this.host.store.triggers.get(run.triggerId!)!
   const context=this.host.scopes.context(trigger,trigger.source+':'+trigger.threads[0]!.id)!
   const goal=this.host.skills.execute(run.spec.skill!,context,run.id,run.spec.prompt)
   this.host.store.put('router-schedule-run',id,{...this.host.store.get<ScheduledRun>('router-schedule-run',id)!,state:'running',goalId:goal.id})
  })
 }
 private authority(id:string):Mandate|undefined{
  const run=this.runForTrigger(id)
  if(!run){
   if(id.startsWith('scheduled:'))throw Error('Scheduled run is no longer authorized')
   return
  }
  if(run.spec.reminder){
   const plan=this.host.store.get<Schedule>('router-schedule',stableDigest([run.scopeId,run.scheduleId]))
   if(!plan?.reminder||plan.cancelledAt||plan.promotion||!plan.active||plan.revision!==run.spec.revision)throw Error('Reminder or commitment is no longer authorized')
   this.validatePlan(plan)
  }
  if(['cancelled','skipped','failed'].includes(run.state))throw Error('Scheduled run is no longer authorized')
  if(run.state==='queued'){
   const current=this.host.store.get<Schedule>('router-schedule',stableDigest([run.scopeId,run.scheduleId]))
   if(!current?.active||current.revision!==run.spec.revision)throw Error('Schedule changed or paused before dispatch')
  }
  const {mandate}=this.validatePlan(run.spec),trigger=this.host.store.triggers.get(id)
  if(!trigger||stableDigest(trigger)!==run.triggerHash)throw Error('Scheduled source integrity mismatch')
  this.host.scopes.assertTrigger(trigger)
  return {...mandate,scope:run.spec.prompt}
 }
 assertInputs(ids:string[]){for(const id of ids)this.host.routerIngress.authority(id)}
 beforeTurn(id:string){const r=this.runForTrigger(id);if(r?.state==='queued'){this.authority(id);this.host.store.put('router-schedule-run',r.id,{...r,state:'running',startedAt:r.startedAt??this.now()})}}
 toolAllowed(triggerId:string,name:string,args:any){
  const run=this.runForTrigger(triggerId);if(!run)return
  if(name==='router_manage')throw Error('Scheduled work cannot create or change standing instructions')
  if(name==='worker_manage'&&!['list','inspect','result','assign','send'].includes(args.action))throw Error('Scheduled work cannot reconfigure or stop Workers')
  if(name==='worker_manage'&&run.spec.mode==='continue'&&(args.action==='assign'||args.ticketId&&args.ticketId!==run.spec.ticketId))throw Error('Scheduled follow-up is restricted to the existing task')
 }
 noteTask(triggerId:string,ticketId:string){const run=this.runForTrigger(triggerId);if(run&&!run.taskIds.includes(ticketId)){this.host.store.put('router-schedule-run',run.id,{...run,taskIds:[...run.taskIds,ticketId]});if(run.state==='cancelled'&&!this.host.store.tickets.get(ticketId)?.ended)this.host.engine.stopTicket(ticketId,'Scheduled run already cancelled')}}
 notify(triggerId:string){return this.runForTrigger(triggerId)?.spec.notification!=='silent'}
 private unconfirmedDelivery(run:ScheduledRun){
  return !!run.triggerId&&this.host.store.deliveries().some(m=>['pending','sending','uncertain','held','failed'].includes(m.status)&&(this.host.store.get<{inputs?:string[]}>('router-reply-owner',m.id)?.inputs??[]).includes(run.triggerId!))
 }
 private pendingNotifications(run:ScheduledRun){return !!run.triggerId&&this.host.store.deliveries().some(m=>m.status==='pending'&&!m.channel.address.routerInbox&&(this.host.store.get<{inputs?:string[]}>('router-reply-owner',m.id)?.inputs??[]).includes(run.triggerId!))}
 /** Only wholly scheduled provenance is eligible. Human/mixed input and internal
  * Worker reports never inherit notification delay from a scheduled ancestor. */
 notificationDelay(message:Delivery,owner?:{triggerId:string;inputs:string[]}){
  const store=this.host.store,old=store.get<{baseNextAt:number;until:number}>('scheduled-notification-delay',message.id)
  if(old&&!owner){store.outbox.withdraw(message.id);return {nextAt:message.nextAt,quiet:true}}
  const runs=owner?.inputs.length?owner.inputs.map(id=>this.runForTrigger(id)):[]
  const run=owner&&this.runForTrigger(owner.triggerId)
  const eligible=!message.channel.address.routerInbox&&run&&runs.length&&runs.every(r=>r&&r.scopeId===run.scopeId)
  if(!eligible&&!old)return {nextAt:message.nextAt,quiet:false}
  const now=this.now(),raw=eligible?this.controls(run.scopeId).quietHours:undefined,key=stableDigest(raw??null),minute=Math.floor(now/60000)
  let cached=this.quietCache.get(key)
  if(!cached||cached.minute!==minute){
   const parsed=quietHoursSchema.nullable().optional().safeParse(raw)
   cached={minute,until:parsed.success?quietUntil(parsed.data,now):now+60000}
   if(this.quietCache.size>=256)this.quietCache.clear()
   this.quietCache.set(key,cached)
  }
  const until=cached.until
  // An explicit retry or a new failure may have replaced next_at since our write.
  const baseNextAt=old&&message.nextAt===old.until?old.baseNextAt:message.nextAt
  const nextAt=Math.max(baseNextAt,until??0)
  const updateRecord=until!==undefined&&(!old||old.until!==nextAt||old.baseNextAt!==baseNextAt)
  const removeRecord=until===undefined&&!!old
  if(nextAt===message.nextAt&&!updateRecord&&!removeRecord)return {nextAt,quiet:until!==undefined}
  store.atomic(()=>{
   if(nextAt!==message.nextAt)store.db.prepare("UPDATE outbox SET next_at=? WHERE id=? AND status='pending'").run(nextAt,message.id)
   if(updateRecord)store.put('scheduled-notification-delay',message.id,{baseNextAt,until:nextAt})
   else if(removeRecord)store.db.prepare("DELETE FROM records WHERE kind='scheduled-notification-delay' AND id=?").run(message.id)
  })
  return {nextAt,quiet:until!==undefined}
 }
 private collect(a:RouterAdmission,t:Trigger){
  if(this.host.chat.isReactionInput(t.id)||t.meta.chatType==='p2p'&&this.host.sources.get(t.source)?.config.kind==='feishu')return false
  const c=this.host.scopes.context(t,a.discussion);if(!c)return false
  const settings=this.controls(c.route.scopeId);if(!settings.enabled)return false
  const now=this.now(),strength=a.mandate!.strength,key=stableDigest([c.route.scopeId,c.route.entryId,a.discussion,c.actor,strength,a.policyVersion,settings.revision])
  const existing=this.host.store.list<MessageBatch>('router-batch').find(b=>b.state==='pending'&&b.id.startsWith(key+':')&&b.triggerIds.length<20&&now<b.firstAt+settings.maxWaitMs&&b.triggerIds.every(id=>!this.host.store.get('router-cancelled',id)))
  if(existing){existing.triggerIds.push(t.id);existing.dueAt=Math.min(now+settings.debounceMs,existing.firstAt+settings.maxWaitMs);this.host.store.put('router-batch',existing.id,existing)}
  else{const id=key+':'+stableDigest(t.id);this.host.store.put('router-batch',id,{id,scopeId:c.route.scopeId,entryId:c.route.entryId,discussion:a.discussion,actor:c.actor,strength,policyVersion:a.policyVersion,settingsRevision:settings.revision,triggerIds:[t.id],firstAt:now,dueAt:now+settings.debounceMs,state:'pending'} satisfies MessageBatch)}
  return true
 }
 tick(){
  const store=this.host.store,now=this.now()
  for(const row of this.dueBatches.all(now)){
   const b=JSON.parse(String(row.body)) as MessageBatch
   const settings=this.controls(b.scopeId),last=store.get<number>('router-intervention-clock',stableDigest([b.scopeId,b.entryId,b.discussion]))??0
   if(b.strength==='inferred'&&last+settings.cooldownMs>now)continue
   store.enqueue('router-batch:'+b.id+':'+b.dueAt,'router-batch',{batchId:b.id,discussion:b.discussion})
  }
  for(const row of this.dueSchedules.all(now)){
   const p=JSON.parse(String(row.body)) as Schedule
   store.atomic(()=>{
    if(isRecurringReminder(p)){
     try{this.validatePlan(p)}catch{
      store.put('router-schedule',stableDigest([p.scopeId,p.id]),{...p,active:false,nextAt:undefined,revision:p.revision+1})
      store.audit({type:'router.commitment.authority_unavailable',scopeId:p.scopeId,planId:p.id})
      return
     }
    }
    const due=latestDue(p.timing,p.nextAt!,Math.min(now,p.timing.endAt?Date.parse(p.timing.endAt):now))
    const next={...p,nextAt:nextTime(p.timing,Math.max(now,due)+1)}
    // Consume the occurrence before dispatch, in the same transaction as its receipt and job.
    this.launch(p,due,'',p.nextAt)
    store.put('router-schedule',stableDigest([p.scopeId,p.id]),next)
   })
  }
  this.settleRuns()
 }
 private launch(p:Schedule,scheduledAt:number,suffix='',firstDueAt=scheduledAt){
  const store=this.host.store,id=stableDigest([p.scopeId,p.id,p.revision,scheduledAt,suffix]),previous=store.get<ScheduledRun>('router-schedule-run',id);if(previous)return previous
  const run:ScheduledRun={id,scheduleId:p.id,scopeId:p.scopeId,revision:p.revision,scheduledAt,createdAt:this.now(),firstDueAt,triggerKind:suffix.startsWith('manual:')?'manual':'scheduled',spec:p,state:'queued',taskIds:[],delivery:'none'}
  const skip=(reason:string)=>{run.state='skipped';run.reason=reason;run.finishedAt=this.now();store.put('router-schedule-run',id,run);return run}
  if(store.list<ScheduledRun>('router-schedule-run').some(r=>r.scopeId===p.scopeId&&r.scheduleId===p.id&&(this.unsettled(r)||p.reminder&&store.outbox.status('schedule-reminder:'+r.id)==='pending')))return skip(p.reminder?'Previous run or delivery is still unsettled':'Previous run is still active')
  if(p.timing.endAt&&this.now()>Date.parse(p.timing.endAt))return skip('Schedule end time passed')
  try{
   const {trigger:anchor,mandate,context}=this.validatePlan(p)
   if(p.mode==='continue'){
    const task=store.tickets.get(p.ticketId!)
    if(!task||task.ended)return skip('Existing task is ended or unavailable; only a new human input can resume it')
   }
   const thread=p.mode==='continue'?anchor.threads[0]!.id:'schedule-'+id
   const trigger:Trigger={...anchor,id:'scheduled:'+id,human:false,addressed:undefined,at:new Date(this.now()).toISOString(),text:p.prompt,threads:[{...anchor.threads[0]!,id:thread}],meta:{...anchor.meta,scope:this.host.scopes.binding(p.entryId).nativeId,scheduledRun:id,origin:'scheduler'}}
   const discussion=p.reminder?context.route.discussion:trigger.source+':'+thread
   if(p.reminder){
    if(!anchor.channel)return skip('Reminder delivery channel unavailable')
    // Keep the synthetic trigger bound to the original conversation for the
    // same dispatch/quiet-hours/revocation checks as other scheduled replies.
    trigger.threads=anchor.threads
   }
   store.triggers.save(trigger)
   this.host.scopes.context(trigger,discussion)
   run.triggerId=trigger.id;run.triggerHash=stableDigest(trigger);run.queuedAt=this.now()
   store.put('router-schedule-run',id,run)
   store.put('router-admission',trigger.id,{triggerId:trigger.id,discussion,policyVersion:mandate.policyVersion,state:'accepted',reason:'Standing schedule authorization',at:trigger.at,mandate:{...mandate,scope:p.prompt}} satisfies RouterAdmission)
   if(p.reminder){
    const messageId='schedule-reminder:'+id
    store.put('router-reply-owner',messageId,{discussion,triggerId:trigger.id,inputs:[trigger.id]})
    store.outbox.send({id:messageId,channel:anchor.channel!,kind:'notice',text:p.name})
    const next={...run,state:'completed' as const,delivery:'pending' as const,finishedAt:this.now()}
    store.put('router-schedule-run',id,next)
    return next
   }
   store.enqueue('router:schedule:'+id,p.skill?'router-skill-run':p.mode==='continue'?'router-scheduled-followup':'router',{discussion,triggerId:trigger.id,runId:id})
   return run
  }catch(error){return skip(String(error))}
 }
 private ownedTasks(run:ScheduledRun){
  const assigned=run.triggerId?this.assignedTasks.all(run.triggerId).map(row=>String(row.ticketId)):[]
  return [...new Set([...(run.taskIds??[]),...(run.goalId?this.host.goals.get(run.goalId)?.taskIds??[]:[]),...assigned])]
 }
 private unsettled(run:ScheduledRun){
  if(!terminal.has(run.state))return true
  const ids=this.ownedTasks(run)
  return ids.some(id=>{const t=this.host.store.tickets.get(id);return !!t&&!t.ended||this.host.toolConnections.receipts(id).some(r=>r.state!=='complete')})||this.host.work.list().some(w=>ids.includes(w.ticketId)&&['starting','running','uncertain'].includes(w.state))
 }
 async followSchedule(runId:string){
  const r=this.getRun(runId);if(!r?.triggerId)throw Error('Missing scheduled source')
  this.beforeTurn(r.triggerId)
  const t=this.host.store.triggers.get(r.triggerId)!,a=this.host.routerIngress.get(t.id)!,context=this.host.scopes.contextForTask(t,a.discussion,r.spec.ticketId!)!
  const task=this.host.store.tickets.get(r.spec.ticketId!)
  if(!task||task.ended){this.host.store.put('router-schedule-run',r.id,{...this.host.store.get<ScheduledRun>('router-schedule-run',r.id)!,state:'skipped',reason:'Task ended before scheduled follow-up',finishedAt:this.now()});return}
  await this.continueTask(r.spec.ticketId!,[t],a.discussion,context,'schedule:'+r.id)
  this.noteTask(t.id,r.spec.ticketId!)
 }
 private settleRuns(){
  const store=this.host.store
  if(store.revisions.version('schedule')===this.settledVersion)return
  const version=store.atomic(()=>{
   for(const r of store.list<ScheduledRun>('router-schedule-run')){
    if(!r.triggerId||!this.readableRun(r)||['cancelled','skipped'].includes(r.state))continue
    const taskIds=this.ownedTasks(r),ids=JSON.stringify(taskIds)
    const jobs=this.settlementJobs.all(r.triggerId),messages=this.settlementReplies.all(r.triggerId)
    const delivery=messages.some(m=>['failed','uncertain','held','dropped'].includes(String(m.status)))?'failed':messages.some(m=>m.status!=='sent')?'pending':messages.length?'sent':'none'
    const pendingReports=taskIds.length>0&&!!this.pendingTaskReports.get(ids,ids)
    const tasks=taskIds.map(id=>store.tickets.get(id))
    const failed=jobs.find(j=>['failed','blocked','uncertain'].includes(String(j.state)))
    const busy=pendingReports||jobs.some(j=>['pending','running'].includes(String(j.state)))
    let state=r.state
    if(failed)state='failed'
    else if(r.goalId){const goal=this.host.goals.get(r.goalId);state=goal?.state==='completed'?'completed':goal?.state==='cancelled'?'cancelled':['held','needs_input','paused'].includes(goal?.state??'')?'waiting':'running'}
    else if(!busy&&jobs.length&&tasks.every(t=>!!t?.ended))state='completed'
    else if(tasks.some(t=>!t?.ended&&t?.attention))state='waiting'
    const next={...r,taskIds,state,delivery,...(failed?{reason:String(failed.error??'Router execution requires review').slice(0,500)}:{}),...(terminal.has(state)?{finishedAt:r.finishedAt??this.now()}:{})}
    if(JSON.stringify(next)!==JSON.stringify(r))store.put('router-schedule-run',r.id,next)
   }
   return store.revisions.version('schedule')
  })
  if(!store.db.isTransaction)this.settledVersion=version
 }
 private candidates(triggers:Trigger[],discussion:string,c:ScopeContext){
  const text=triggers.map(t=>t.text).join('\n')
  return this.host.store.list<any>('worker-assignment').map(a=>({...a,...this.host.store.get<any>('task-routing',a.ticketId)})).filter(a=>a.discussion===discussion||text.includes(a.ticketId)).flatMap(a=>{
   try{
    if(a.parentTrigger)this.host.routerIngress.authority(a.parentTrigger,a.discussion)
    this.host.scopes.checkTask(a.ticketId,c,true);this.host.scopes.checkTaskEntry(this.host.scopes.ownership(a.ticketId)!,c.route.entryId,'result')
    const saved=this.host.store.get<{manifest:ContextManifest}>('task-context',a.ticketId);if(saved)this.host.memory.validate(saved.manifest)
    const t=taskView(this.host.store,this.host.store.tickets.get(a.ticketId)!)
    if(t.ended?.by==='human'||t.ended&&!triggers.every(x=>x.human))return []
    return [{id:t.id,title:t.title,scope:t.mandate.scope,ended:t.ended}]
   }catch{return []}
  })
 }
 async evaluate(batchId:string){
  const store=this.host.store,b=store.get<MessageBatch>('router-batch',batchId)
  if(!b||['decided','failed'].includes(b.state))return
  const cooldown=(store.get<number>('router-intervention-clock',stableDigest([b.scopeId,b.entryId,b.discussion]))??0)+this.controls(b.scopeId).cooldownMs
  if(b.state==='pending'&&(b.dueAt>this.now()||b.strength==='inferred'&&cooldown>this.now())){if(cooldown>b.dueAt)store.put('router-batch',b.id,{...b,dueAt:cooldown});return}
  const triggers=b.triggerIds.map(id=>store.triggers.get(id)!),last=triggers.at(-1)!
  const fail=(reason:string)=>{store.put('router-batch',b.id,{...b,state:'failed',reason});throw Error(reason)}
  if(triggers.some(t=>!t))return fail('Batch input deleted')
  const context=this.host.scopes.context(last,b.discussion)
  if(!context||context.route.scopeId!==b.scopeId||context.route.entryId!==b.entryId)return fail('Batch ownership changed')
  const check=()=>{
   this.host.scopes.assertCurrent(context)
   if(this.controls(b.scopeId).revision!==b.settingsRevision||!this.controls(b.scopeId).enabled)throw Error('Batch settings changed; fresh input required')
   for(const t of triggers){this.host.scopes.assertTrigger(t);if(this.host.routerIngress.policy(t).version!==b.policyVersion)throw Error('Duty or admission policy changed; fresh input required');if(b.strength==='explicit')this.host.routerIngress.authority(t.id);else if(!this.host.routerIngress.refresh(t.id,b.policyVersion))throw Error('Input assessment no longer current')}
  }
  try{
   check();store.put('router-batch',b.id,{...b,state:'evaluating'})
   if(b.strength==='inferred'){
    // Debounce and cooldown select when to wake the persistent Router. Admission
    // itself uses its candidate tools; it must not create a second assessor session.
    store.atomic(()=>{for(const t of triggers){const a=this.host.routerIngress.get(t.id)!;store.enqueue('router-admit:'+bodyDigest([t.id,b.policyVersion,a.revision,b.id]),'router-admit',{triggerId:t.id,policyVersion:b.policyVersion,revision:a.revision,scopeBatchId:b.id})}})
    return
   }
   const existing=this.candidates(triggers,b.discussion,context),rules=this.host.routerIngress.rules(last)
   const evaluated=b.decision?{decision:b.decision,manifest:b.manifest}:await this.host.evaluateIntervention({triggers,strength:b.strength,rules,existing,context})
   const {decision,manifest}=evaluated
   if(!manifest)throw Error('Batch decision context is unavailable; a fresh authorized input is required')
   this.host.memory.validate(manifest)
   check()
   if(decision.action!=='clarify'){
    assessment.parse(decision)
    if(['attach','stop'].includes(decision.action)&&!existing.some(t=>t.id===decision.targetTicketId))throw Error('Task target is outside the authorized continuation candidates')
   }
   const action=decision.action
   // Persist the selected action before effects. Retried continuations reuse the manager receipt.
   store.put('router-batch',b.id,{...b,state:'evaluating',decision,manifest})
   if(['accept','attach'].includes(action))store.put('router-input-set',last.id,{triggerIds:b.triggerIds})
   if(action==='attach')await this.continueTask((decision as Assessment).targetTicketId!,triggers,b.discussion,context,'batch:'+b.id,manifest)
   else if(action==='stop')await this.host.manager.call({action:'cancel',ticketId:(decision as Assessment).targetTicketId,requestId:'batch-stop:'+b.id,revision:this.host.settings.current().revision},{discussion:b.discussion,trigger:last,scoped:context})
   else if(action==='accept')store.enqueue('router:batch:'+b.id,'router',{discussion:b.discussion,triggerId:last.id,batchId:b.id})
   else if(action==='clarify'&&decision.action==='clarify'&&last.channel){
    const id='router-clarify:'+b.id
    store.put('router-reply-owner',id,{discussion:b.discussion,triggerId:last.id,inputs:b.triggerIds,manifest})
    store.outbox.send({id,channel:last.channel,kind:'reply',text:decision.question})
   }
   store.put('router-batch',b.id,{...b,state:'decided',decision,manifest,reason:action==='ignore'&&decision.action!=='ignore'?'Observed without execution':decision.reason})
   if(action!=='ignore')store.put('router-intervention-clock',stableDigest([b.scopeId,b.entryId,b.discussion]),this.now())
  }catch(error){return fail(String(error))}
 }
 validateCandidateBatch(id:string){
  const b=this.host.store.get<MessageBatch>('router-batch',id)
  if(!b||b.state!=='evaluating'||b.strength!=='inferred')throw Error('Scoped candidate batch is no longer active')
  const settings=this.controls(b.scopeId)
  if(!settings.enabled||settings.revision!==b.settingsRevision)throw Error('Batch settings changed; fresh input required')
  for(const id of b.triggerIds){const t=this.host.store.triggers.get(id);if(!t)throw Error('Batch source unavailable');this.host.scopes.assertTrigger(t);const c=this.host.scopes.context(t,b.discussion);if(!c||c.route.scopeId!==b.scopeId||c.route.entryId!==b.entryId||this.host.routerIngress.policy(t).version!==b.policyVersion)throw Error('Batch ownership or policy changed')}
  return b
 }
 finishCandidateBatch(id:string,decision:Assessment|undefined,result:string|undefined){
  const b=this.validateCandidateBatch(id)
  this.host.store.put('router-batch',id,{...b,state:'decided',decision,reason:decision?.reason??result??'Ignored by Router'})
  if(result==='accepted')this.host.store.put('router-intervention-clock',stableDigest([b.scopeId,b.entryId,b.discussion]),this.now())
 }
 failCandidateBatch(id:string,error:unknown){const b=this.host.store.get<MessageBatch>('router-batch',id);if(b&&b.state==='evaluating')this.host.store.put('router-batch',id,{...b,state:'failed',reason:String(error)})}
 private async continueTask(ticketId:string,triggers:Trigger[],discussion:string,context:ScopeContext,requestId:string,decisionManifest?:ContextManifest){
  this.assertInputs(triggers.map(t=>t.id))
  const last=triggers.at(-1)!,ticket=this.host.store.tickets.get(ticketId)
  if(!ticket||ticket.ended?.by==='human'||ticket.ended&&!last.human)throw Error('A stopped or ended task cannot be resumed by this event')
  const packet=this.host.memory.build(context,{kind:'task_followup',triggers,ticketId},'router-followup')
  if(decisionManifest)this.host.memory.inherit(packet.manifest,decisionManifest)
  this.host.memory.validate(packet.manifest)
  const result=await this.host.manager.call({action:'send',ticketId,text:triggers.map(t=>t.text).join('\n\n'),requestId,revision:this.host.settings.current().revision},{discussion,trigger:last,scoped:context,manifest:packet.manifest})
  if(result.status==='goal_blocked')throw Error(JSON.stringify(result))
 }
 async attachAdmitted(trigger:Trigger,discussion:string,ticketId:string){
  const task=this.host.store.tickets.get(ticketId)
  if(!task||task.ended?.by==='human'||task.ended&&!trigger.human)throw Error('Task cannot be resumed by this event')
  const scoped=this.host.scopes.contextForTask(trigger,discussion,ticketId)
  if(scoped)return this.continueTask(ticketId,[trigger],discussion,scoped,'admit:'+trigger.id)
  await this.host.manager.call({action:'send',ticketId,text:trigger.text,requestId:'admit:'+trigger.id,revision:this.host.settings.current().revision},{discussion,trigger})
 }
 batchInputs(id:string){const b=this.host.store.get<MessageBatch>('router-batch',id);if(!b||b.state!=='decided'||!b.manifest)throw Error('Batch decision context missing; a fresh authorized input is required');this.host.memory.validate(b.manifest);this.assertInputs(b.triggerIds);return b.triggerIds.map(id=>this.host.store.triggers.get(id)!)}
 batchManifest(id:string){const b=this.host.store.get<MessageBatch>('router-batch',id);if(!b?.manifest)throw Error('Batch decision context missing');this.host.memory.validate(b.manifest);return b.manifest}
}
