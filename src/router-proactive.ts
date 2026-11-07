import {z} from 'zod'
import type {Runtime} from './runtime.ts'
import type {Trigger,Mandate} from './vendor/dsh-core/index.ts'
import type {ScopeContext} from './router-scope.ts'
import type {RouterAdmission} from './router-ingress.ts'
import type {ContextManifest} from './router-memory.ts'
import type {ToolSpec} from './model.ts'
import {assessment,type Assessment} from './schemas.ts'
import {stableDigest,bodyDigest} from './sources.ts'
import {taskView} from './task-context.ts'
import {timingSchema,nextTime,latestDue,type Timing} from './schedule-time.ts'

const id=z.string().min(1).max(300)
const dutySchema=z.object({id,name:id,entryIds:z.array(id).min(1),instruction:z.string().min(1).max(16000),mode:z.enum(['off','observe','auto']).default('observe')}).strict()
const settingsSchema=z.object({enabled:z.boolean(),debounceMs:z.number().int().min(0).max(30000).default(1500),maxWaitMs:z.number().int().min(1).max(60000).default(5000),cooldownMs:z.number().int().min(0).max(3600000).default(60000)}).strict().refine(x=>x.maxWaitMs>=x.debounceMs,'maxWaitMs must cover debounceMs')
const scheduleSchema=z.object({id,name:id,triggerId:id,prompt:z.string().min(1).max(16000),timing:timingSchema,mode:z.enum(['standalone','continue']),ticketId:id.optional(),notification:z.enum(['always','findings','silent']).default('findings'),active:z.boolean().default(true)}).strict().refine(x=>x.mode!=='continue'||!!x.ticketId,'Continuation requires ticketId')
export const proactiveCommandSchema=z.object({action:z.enum(['list','settings.put','duty.put','schedule.put','schedule.pause','schedule.resume','schedule.run','run.cancel']),scopeId:id,operationId:id.optional(),expectedRevision:z.number().int().min(0).optional(),id:id.optional(),settings:settingsSchema.optional(),duty:dutySchema.optional(),schedule:scheduleSchema.optional()}).strict()
type Command=z.infer<typeof proactiveCommandSchema>
type Duty=z.infer<typeof dutySchema>&{scopeId:string;revision:number}
type Controls=z.infer<typeof settingsSchema>&{scopeId:string;revision:number}
type Schedule=z.infer<typeof scheduleSchema>&{scopeId:string;revision:number;entryId:string;bindingRevision:number;nextAt?:number;createdAt:number}
export interface ScheduledRun {id:string;scheduleId:string;scopeId:string;revision:number;scheduledAt:number;createdAt:number;triggerId?:string;triggerHash?:string;spec:Schedule;state:'queued'|'running'|'waiting'|'completed'|'failed'|'cancelled'|'skipped';taskIds:string[];delivery:'none'|'pending'|'sent'|'failed';reason?:string;finishedAt?:number}
export interface MessageBatch {id:string;scopeId:string;entryId:string;discussion:string;actor:string;strength:'explicit'|'inferred';policyVersion:string;settingsRevision:number;triggerIds:string[];firstAt:number;dueAt:number;state:'pending'|'evaluating'|'decided'|'failed';decision?:Intervention;manifest?:ContextManifest;reason?:string}
export type Intervention=Assessment|{action:'clarify';reason:string;question:string}
const terminal=new Set(['completed','failed','cancelled','skipped'])
const defaults={enabled:false,debounceMs:1500,maxWaitMs:5000,cooldownMs:60000,revision:0}
export const proactiveSpecs:ToolSpec[]=[{type:'function',name:'router_manage',description:'Manage this Router scope: list duties, batch settings, schedules and run receipts. Mutations require an explicit human scope manager, operationId and current expectedRevision. A schedule requires a real explicit triggerId, prompt, mode standalone or continue, notification always/findings/silent, and timing {kind:once/interval/daily/weekly,timezone:IANA,startAt:ISO with offset,endAt?,intervalSeconds?,time:HH:mm,weekdays?:0=Sunday}. Continue requires ticketId and never restarts ended work. Pausing a schedule only affects future runs; run.cancel stops the selected run. Duties are scoped written instructions, mode off/observe/auto; global observe/off remains a ceiling.',inputSchema:{type:'object',properties:{action:{type:'string',enum:proactiveCommandSchema.shape.action.options},scopeId:{type:'string'},operationId:{type:'string'},expectedRevision:{type:'integer'},id:{type:'string'},settings:{type:'object'},duty:{type:'object'},schedule:{type:'object'}},required:['action','scopeId'],additionalProperties:false}}]

/** Durable host extension. Time creates source events; Eval itself never schedules a wake. */
export class RouterProactive {
 constructor(readonly host:Runtime,readonly now:()=>number=Date.now){
  host.routerIngress.rulesFor=t=>this.rules(t)
  host.routerIngress.ruleExecutionAllowed=ids=>ids.every(id=>host.config.rules.some(r=>r.id===id)||this.duties().some(d=>this.ruleId(d)===id&&d.mode==='auto'))
  host.routerIngress.defer=(a,t)=>this.collect(a,t)
  host.routerIngress.scheduledAuthority=id=>this.authority(id)
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
 snapshot(scopeId:string,context?:ScopeContext){
  this.host.scopes.scope(scopeId)
  const inScope=(v:{scopeId:string})=>v.scopeId===scopeId
  const visible=(entryId:string)=>context?entryId===context.route.entryId:!this.host.scopes.bindings().find(e=>e.id===entryId)?.privateActor
  return {settings:this.controls(scopeId),duties:this.duties().filter(d=>inScope(d)&&d.entryIds.every(visible)),schedules:this.host.store.list<Schedule>('router-schedule').filter(p=>inScope(p)&&visible(p.entryId)),runs:this.host.store.list<ScheduledRun>('router-schedule-run').filter(r=>inScope(r)&&r.spec&&visible(r.spec.entryId)).slice(-100).map(r=>({...r,activeWork:this.unsettled(r)})),decisions:this.host.store.list<MessageBatch>('router-batch').filter(b=>inScope(b)&&visible(b.entryId)).slice(-100)}
 }
 private requireManager(scopeId:string,context?:ScopeContext){
  this.host.scopes.scope(scopeId)
  if(!context)return // HTTP/MCP operator control plane; never reachable from model tool without context.
  const m=this.host.routerIngress.authority(context.trigger.id)
  if(context.route.scopeId!==scopeId||!context.trigger.human||m.strength!=='explicit'||!this.host.scopes.canManage(context))throw Error('An explicit human scope manager is required')
 }
 command(value:unknown,context?:ScopeContext){
  const x=proactiveCommandSchema.parse(value)
  if(context){this.host.scopes.assertCurrent(context);if(context.route.scopeId!==x.scopeId)throw Error('Outside Router scope')}
  if(x.action==='list')return this.snapshot(x.scopeId,context)
  this.requireManager(x.scopeId,context)
  if(!x.operationId||x.expectedRevision===undefined)throw Error('Mutation requires operationId and expectedRevision')
  const key=stableDigest([x.scopeId,context?.actor??'operator',context?.route.entryId??'operator',x.operationId]),fingerprint=stableDigest(x)
  return this.host.store.atomic(()=>{
   const old=this.host.store.get<any>('proactive-receipt',key)
   if(old){if(old.fingerprint!==fingerprint)throw Error('operationId reused with different content');return old.result}
   const result=this.apply(x,context)
   this.host.store.put('proactive-receipt',key,{fingerprint,scopeId:x.scopeId,result});this.host.store.audit({type:'router.proactive.command',action:x.action,scopeId:x.scopeId,operationId:x.operationId});return result
  })
 }
 private revision(actual:number,expected:number|undefined){if(actual!==expected)throw Error('Revision conflict; refresh before retrying')}
 private apply(x:Command,context?:ScopeContext):unknown{
  const store=this.host.store
  if(x.action==='settings.put'){
   if(!x.settings)throw Error('settings required');const previous=this.controls(x.scopeId);this.revision(previous.revision,x.expectedRevision)
   const next={...x.settings,scopeId:x.scopeId,revision:previous.revision+1};store.put('router-proactive-settings',x.scopeId,next);return next
  }
  if(x.action==='duty.put'){
   if(!x.duty)throw Error('duty required');const key=stableDigest([x.scopeId,x.duty.id]),old=store.get<Duty>('router-duty',key);this.revision(old?.revision??0,x.expectedRevision)
   for(const entry of old?.entryIds??[])this.checkControlEntry(entry,context)
   for(const id of x.duty.entryIds){const e=this.host.scopes.binding(id);if(e.scopeId!==x.scopeId||!this.host.scopes.sourceActive(e))throw Error('Duty entry is outside active scope');if(e.privateActor&&(!context||context.actor!==e.privateActor))throw Error('Private duties require the actual member')}
   const next={...x.duty,scopeId:x.scopeId,revision:(old?.revision??0)+1};store.put('router-duty',key,next);return next
  }
  if(x.action==='run.cancel'){
   const run=store.get<ScheduledRun>('router-schedule-run',x.id??'');if(!run||run.scopeId!==x.scopeId)throw Error('Unknown run');this.revision(run.revision,x.expectedRevision)
   this.checkControlEntry(run.spec.entryId,context)
   if(terminal.has(run.state)&&!this.unsettled(run))return run
   const taskIds=this.ownedTasks(run)
   for(const id of taskIds){const t=store.tickets.get(id);if(t&&!t.ended)this.host.engine.stopTicket(id,'Scheduled run stopped by a person')}
   const next={...run,taskIds,state:'cancelled' as const,finishedAt:this.now()};store.put('router-schedule-run',run.id,next);if(run.triggerId)this.host.abortScheduledRun(run.triggerId);return next
  }
  const planId=x.schedule?.id??x.id??'',key=stableDigest([x.scopeId,planId]),old=store.get<Schedule>('router-schedule',key)
  if(old)this.checkControlEntry(old.entryId,context)
  this.revision(old?.revision??0,x.expectedRevision)
  if(x.action==='schedule.put'){
   if(!x.schedule)throw Error('schedule required')
   const spec=x.schedule,anchor=store.triggers.get(spec.triggerId)
   if(!anchor||!anchor.human||this.runForTrigger(anchor.id))throw Error('Schedule needs an original human authorization')
   const a=this.host.routerIngress.get(anchor.id),c=a&&this.host.scopes.context(anchor,a.discussion)
   if(!c||c.route.scopeId!==x.scopeId||this.host.routerIngress.authority(anchor.id).strength!=='explicit'||!this.host.scopes.canManage(c))throw Error('Schedule anchor requires a current explicit scope manager')
   if(context&&context.trigger.id!==anchor.id)throw Error('Use the current human authorization as schedule anchor')
   const entry=this.host.scopes.binding(c.route.entryId)
   if(entry.privateActor&&!context)throw Error('Operator cannot impersonate a private message author')
   if(spec.ticketId){this.host.scopes.checkTask(spec.ticketId,c,true);this.host.scopes.checkTaskEntry(this.host.scopes.ownership(spec.ticketId)!,entry.id,'result')}
   const next:Schedule={...spec,scopeId:x.scopeId,entryId:entry.id,bindingRevision:entry.revision,revision:(old?.revision??0)+1,createdAt:old?.createdAt??this.now(),nextAt:nextTime(spec.timing,Math.max(this.now(),Date.parse(spec.timing.startAt)))}
   if(next.active&&next.nextAt===undefined)throw Error('No future occurrence in the selected time range')
   store.put('router-schedule',key,next);return next
  }
  if(!old)throw Error('Unknown schedule')
  if(x.action==='schedule.run'){if(!old.active)throw Error('Resume this schedule before running');this.validatePlan(old);return this.launch(old,this.now(),'manual:'+x.operationId)}
  if(!['schedule.pause','schedule.resume'].includes(x.action))throw Error('Unknown action')
  const active=x.action==='schedule.resume'
  if(active)this.validatePlan(old)
  const next={...old,active,revision:old.revision+1,...(active?{nextAt:nextTime(old.timing,this.now())}:{})}
  if(active&&next.nextAt===undefined)throw Error('Schedule has no future occurrence')
  store.put('router-schedule',key,next);return next
 }
 private checkControlEntry(entryId:string,context?:ScopeContext){
  const e=this.host.scopes.binding(entryId)
  if(context&&context.route.entryId!==entryId||!context&&e.privateActor)throw Error('Use the authorized entry to manage this object')
 }
 private validatePlan(p:Schedule){
  scheduleSchema.parse(Object.fromEntries(Object.entries(p).filter(([k])=>['id','name','triggerId','prompt','timing','mode','ticketId','notification','active'].includes(k))))
  const trigger=this.host.store.triggers.get(p.triggerId)
  if(!trigger?.human||this.runForTrigger(p.triggerId))throw Error('Schedule authority unavailable')
  this.host.routerIngress.authority(p.triggerId)
  const a=this.host.routerIngress.get(p.triggerId)!,c=this.host.scopes.context(trigger,a.discussion)
  if(!c||c.route.scopeId!==p.scopeId||c.route.entryId!==p.entryId||this.host.scopes.binding(p.entryId).revision!==p.bindingRevision||!this.host.scopes.canManage(c))throw Error('Schedule ownership or entry authority changed')
  return {trigger,context:c,mandate:this.host.routerIngress.authority(trigger.id)}
 }
 runForTrigger(id:string){return this.host.store.list<ScheduledRun>('router-schedule-run').find(r=>r.triggerId===id)}
 private authority(id:string):Mandate|undefined{
  const run=this.runForTrigger(id);if(!run)return
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
 beforeTurn(id:string){const r=this.runForTrigger(id);if(r?.state==='queued'){this.authority(id);this.host.store.put('router-schedule-run',r.id,{...r,state:'running'})}}
 toolAllowed(triggerId:string,name:string,args:any){
  const run=this.runForTrigger(triggerId);if(!run)return
  if(name==='router_manage')throw Error('Scheduled work cannot create or change standing instructions')
  if(name==='worker_manage'&&!['list','inspect','result','assign','send'].includes(args.action))throw Error('Scheduled work cannot reconfigure or stop Workers')
  if(name==='worker_manage'&&run.spec.mode==='continue'&&(args.action==='assign'||args.ticketId&&args.ticketId!==run.spec.ticketId))throw Error('Scheduled follow-up is restricted to the existing task')
 }
 noteTask(triggerId:string,ticketId:string){const run=this.runForTrigger(triggerId);if(run&&!run.taskIds.includes(ticketId)){this.host.store.put('router-schedule-run',run.id,{...run,taskIds:[...run.taskIds,ticketId]});if(run.state==='cancelled'&&!this.host.store.tickets.get(ticketId)?.ended)this.host.engine.stopTicket(ticketId,'Scheduled run already cancelled')}}
 notify(triggerId:string){return this.runForTrigger(triggerId)?.spec.notification!=='silent'}
 private collect(a:RouterAdmission,t:Trigger){
  const c=this.host.scopes.context(t,a.discussion);if(!c)return false
  const settings=this.controls(c.route.scopeId);if(!settings.enabled)return false
  const now=this.now(),strength=a.mandate!.strength,key=stableDigest([c.route.scopeId,c.route.entryId,a.discussion,c.actor,strength,a.policyVersion,settings.revision])
  const existing=this.host.store.list<MessageBatch>('router-batch').find(b=>b.state==='pending'&&b.id.startsWith(key+':')&&b.triggerIds.length<20&&now<b.firstAt+settings.maxWaitMs)
  if(existing){existing.triggerIds.push(t.id);existing.dueAt=Math.min(now+settings.debounceMs,existing.firstAt+settings.maxWaitMs);this.host.store.put('router-batch',existing.id,existing)}
  else{const id=key+':'+stableDigest(t.id);this.host.store.put('router-batch',id,{id,scopeId:c.route.scopeId,entryId:c.route.entryId,discussion:a.discussion,actor:c.actor,strength,policyVersion:a.policyVersion,settingsRevision:settings.revision,triggerIds:[t.id],firstAt:now,dueAt:now+settings.debounceMs,state:'pending'} satisfies MessageBatch)}
  return true
 }
 tick(){
  const store=this.host.store,now=this.now()
  for(const b of store.list<MessageBatch>('router-batch'))if(b.state==='pending'&&b.dueAt<=now){
   const settings=this.controls(b.scopeId),last=store.get<number>('router-intervention-clock',stableDigest([b.scopeId,b.entryId,b.discussion]))??0
   if(b.strength==='inferred'&&last+settings.cooldownMs>now)continue
   store.enqueue('router-batch:'+b.id+':'+b.dueAt,'router-batch',{batchId:b.id,discussion:b.discussion})
  }
  for(const p of store.list<Schedule>('router-schedule'))if(p.active&&p.nextAt!==undefined&&p.nextAt<=now){
   store.atomic(()=>{
    const due=latestDue(p.timing,p.nextAt!,Math.min(now,p.timing.endAt?Date.parse(p.timing.endAt):now))
    const next={...p,nextAt:nextTime(p.timing,Math.max(now,due)+1)}
    // Consume the occurrence before dispatch, in the same transaction as its receipt and job.
    this.launch(p,due)
    store.put('router-schedule',stableDigest([p.scopeId,p.id]),next)
   })
  }
  this.settleRuns()
 }
 private launch(p:Schedule,scheduledAt:number,suffix=''){
  const store=this.host.store,id=stableDigest([p.scopeId,p.id,p.revision,scheduledAt,suffix]),previous=store.get<ScheduledRun>('router-schedule-run',id);if(previous)return previous
  const run:ScheduledRun={id,scheduleId:p.id,scopeId:p.scopeId,revision:p.revision,scheduledAt,createdAt:this.now(),spec:p,state:'queued',taskIds:[],delivery:'none'}
  const skip=(reason:string)=>{run.state='skipped';run.reason=reason;run.finishedAt=this.now();store.put('router-schedule-run',id,run);return run}
  if(store.list<ScheduledRun>('router-schedule-run').some(r=>r.scopeId===p.scopeId&&r.scheduleId===p.id&&this.unsettled(r)))return skip('Previous run is still active')
  if(p.timing.endAt&&this.now()>Date.parse(p.timing.endAt))return skip('Schedule end time passed')
  try{
   const {trigger:anchor,mandate}=this.validatePlan(p)
   if(p.mode==='continue'){
    const task=store.tickets.get(p.ticketId!)
    if(!task||task.ended)return skip('Existing task is ended or unavailable; only a new human input can resume it')
   }
   const thread=p.mode==='continue'?anchor.threads[0]!.id:'schedule-'+id
   const trigger:Trigger={...anchor,id:'scheduled:'+id,human:false,addressed:undefined,at:new Date(this.now()).toISOString(),text:p.prompt,threads:[{...anchor.threads[0]!,id:thread}],meta:{...anchor.meta,scope:this.host.scopes.binding(p.entryId).nativeId,scheduledRun:id,origin:'scheduler'}}
   const discussion=trigger.source+':'+thread
   store.triggers.save(trigger)
   this.host.scopes.context(trigger,discussion)
   run.triggerId=trigger.id;run.triggerHash=stableDigest(trigger)
   store.put('router-schedule-run',id,run)
   store.put('router-admission',trigger.id,{triggerId:trigger.id,discussion,policyVersion:mandate.policyVersion,state:'accepted',reason:'Standing schedule authorization',at:trigger.at,mandate:{...mandate,scope:p.prompt}} satisfies RouterAdmission)
   store.enqueue('router:schedule:'+id,p.mode==='continue'?'router-scheduled-followup':'router',{discussion,triggerId:trigger.id,runId:id})
   return run
  }catch(error){return skip(String(error))}
 }
 private ownedTasks(run:ScheduledRun){
  return [...new Set([...(run.taskIds??[]),...[...this.host.store.list<any>('worker-assignment'),...this.host.store.list<any>('task-routing')].filter(a=>run.triggerId&&a.parentTrigger===run.triggerId).map(a=>String(a.ticketId))])]
 }
 private unsettled(run:ScheduledRun){
  if(!terminal.has(run.state))return true
  const ids=this.ownedTasks(run)
  return ids.some(id=>{const t=this.host.store.tickets.get(id);return !!t&&!t.ended||this.host.toolConnections.receipts(id).some(r=>r.state!=='complete')})||this.host.work.list().some(w=>ids.includes(w.ticketId)&&['starting','running','uncertain'].includes(w.state))
 }
 async followSchedule(runId:string){
  const r=this.host.store.get<ScheduledRun>('router-schedule-run',runId);if(!r?.triggerId)throw Error('Missing scheduled source')
  this.beforeTurn(r.triggerId)
  const t=this.host.store.triggers.get(r.triggerId)!,a=this.host.routerIngress.get(t.id)!,context=this.host.scopes.contextForTask(t,a.discussion,r.spec.ticketId!)!
  const task=this.host.store.tickets.get(r.spec.ticketId!)
  if(!task||task.ended){this.host.store.put('router-schedule-run',r.id,{...r,state:'skipped',reason:'Task ended before scheduled follow-up',finishedAt:this.now()});return}
  await this.continueTask(r.spec.ticketId!,[t],a.discussion,context,'schedule:'+r.id)
  this.noteTask(t.id,r.spec.ticketId!)
 }
 private settleRuns(){
  const store=this.host.store
  for(const r of store.list<ScheduledRun>('router-schedule-run')){
   if(!r.triggerId||!r.spec||!Array.isArray(r.taskIds)||['cancelled','skipped'].includes(r.state))continue
   r.taskIds=this.ownedTasks(r)
   const jobs=store.db.prepare('SELECT id,kind,state,payload,error FROM jobs').all().filter(j=>{try{return JSON.parse(String(j.payload)).triggerId===r.triggerId}catch{return false}})
   const messages=store.deliveries().filter(d=>(store.get<any>('router-reply-owner',d.id)?.inputs??[]).includes(r.triggerId!))
   const delivery=messages.some(m=>['failed','uncertain','held','dropped'].includes(m.status))?'failed':messages.some(m=>m.status!=='sent')?'pending':messages.length?'sent':'none'
   const pendingReports=store.deliveries().some(d=>d.ticketId&&r.taskIds.includes(d.ticketId)&&!['sent','dropped'].includes(d.status))||store.list<any>('router-inbox').some(m=>r.taskIds.includes(m.ticketId)&&!store.get('router-read',m.id))
   const tasks=r.taskIds.map(id=>store.tickets.get(id)),failed=jobs.some(j=>['failed','blocked','uncertain'].includes(String(j.state))),busy=pendingReports||jobs.some(j=>['pending','running'].includes(String(j.state)))
   let state=r.state
   if(failed)state='failed'
   else if(!busy&&jobs.length&&tasks.every(t=>!!t?.ended))state='completed'
   else if(tasks.some(t=>!t?.ended&&t?.attention))state='waiting'
   store.put('router-schedule-run',r.id,{...r,state,delivery,...(failed?{reason:String(jobs.find(j=>['failed','blocked','uncertain'].includes(String(j.state)))?.error??'Router execution requires review').slice(0,500)}:{}),...(terminal.has(state)?{finishedAt:r.finishedAt??this.now()}:{})})
  }
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
  await this.host.manager.call({action:'send',ticketId,text:triggers.map(t=>t.text).join('\n\n'),requestId,revision:this.host.settings.current().revision},{discussion,trigger:last,scoped:context,manifest:packet.manifest})
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
