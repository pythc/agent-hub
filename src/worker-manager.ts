import {z} from 'zod'
import {taskView,allowNewTaskInputs,type TaskContinuation} from './task-context.ts'
import type {ScopeContext} from './router-scope.ts'
import type {ContextManifest} from './router-memory.ts'
import type {Runtime} from './runtime.ts'
import {workerProfiles} from './worker-pool.ts'
import {workerProfileSchema} from './backend-config.ts'
import type {Run} from './store.ts'
import type {Trigger} from './vendor/dsh-core/index.ts'
import {bodyDigest} from './sources.ts'
import type {ToolSpec} from './model.ts'
const actions=['list','inspect','create','clone','configure','set_prompt','assign','send','pause','resume','cancel','retire','destroy','result','migrate','rebuild'] as const
export const workerCommandSchema=z.object({action:z.enum(actions),requestId:z.string().min(1).max(200).optional(),revision:z.number().int().min(0).optional(),id:z.string().optional(),from:z.string().optional(),profile:workerProfileSchema.optional(),patch:z.record(z.unknown()).optional(),unset:z.array(z.string()).optional(),prompt:z.string().max(64000).optional(),text:z.string().min(1).max(100000).optional(),discussion:z.string().min(1).max(300).optional(),ticketId:z.string().optional(),acceptance:z.string().max(10000).optional(),cancelRunning:z.boolean().optional(),workspaceReviewed:z.boolean().optional(),waitMs:z.number().int().min(0).max(5000).optional()}).strict()
export const managementSpecs:ToolSpec[]=[{type:'function',name:'worker_manage',description:'Manage Workers within the configured policy. Read list for the current revision; mutations require revision and a stable requestId. assign delegates a task; inspect/result return actual state. pause stops future scheduling; retire drains existing work; destroy requires cancelRunning for active tasks. New backend/model applies to new tasks; migrate explicitly hands an idle task to the new backend. rebuild prepares a budget or permission-held task. Permission rebuild requires a current scope manager, fresh task text and workspaceReviewed=true only after reviewing retained artifacts under current permissions. It quarantines old text and starts a new session on the same task/backend/workspace. It never runs until a new authorized follow-up.',inputSchema:{type:'object',properties:{action:{type:'string',enum:actions},requestId:{type:'string'},revision:{type:'integer'},id:{type:'string'},from:{type:'string'},profile:{type:'object'},patch:{type:'object'},unset:{type:'array',items:{type:'string'}},prompt:{type:'string'},text:{type:'string'},discussion:{type:'string'},ticketId:{type:'string'},acceptance:{type:'string'},cancelRunning:{type:'boolean'},workspaceReviewed:{type:'boolean'},waitMs:{type:'integer',minimum:0,maximum:5000}},required:['action'],additionalProperties:false}}]
export interface RouterContext {discussion:string;trigger?:Trigger;scoped?:ScopeContext;manifest?:ContextManifest}
interface Delegation {ticketId:string;workerId:string;discussion:string;source:string;actor:string;parentTrigger?:string;mode:'client'|'host'}
export class WorkerManager {
 private inFlight=new Set<string>()
 constructor(private host:Runtime){}
 private runs(id:string){return this.host.store.list<Run>('run').filter(r=>r.workerId===id)}
 private tasks(id:string){return this.host.store.list<Delegation>('worker-assignment').filter(a=>a.workerId===id&& !this.host.store.tickets.get(a.ticketId)?.ended)}
 private active(id:string){return this.runs(id).filter(r=>['starting','running','background','human','delivering','merging'].includes(r.phase))}
 list(context?:RouterContext){
  const c=context?.scoped,allowed=(ticketId:string)=>{try{if(c)this.host.scopes.checkTask(ticketId,c);else if(context)this.checkContext(this.host.store.get<Delegation>('worker-assignment',ticketId),context);return true}catch{return false}}
  const workers=workerProfiles(this.host.config).filter(w=>!c||this.host.scopes.scope(c.route.scopeId).workerIds.includes(w.id)).map(w=>({...w,status:w.state??'idle',active:this.active(w.id).filter(r=>allowed(r.ticketId)).map(r=>r.ticketId),tasks:this.tasks(w.id).filter(t=>allowed(t.ticketId)).map(t=>t.ticketId)}))
  return {revision:this.host.settings.current().revision,policy:this.host.config.execution.management??{enabled:false},workers}
 }
 validateSettings(patch:unknown){
  const next=(patch as any)?.execution?.workers
  if(next)for(const w of workerProfiles(this.host.config))if(!next.some((n:any)=>n.id===w.id)&&this.tasks(w.id).length)throw Error('Worker '+w.id+' still owns tasks; retire or cancel before removing it')
 }
 private checkContext(a:Delegation|undefined,c?:RouterContext,mutate=false,allowHeld=false){
  if(c?.scoped){if(!a)throw Error('Task unavailable');this.host.scopes.checkTask(a.ticketId,c.scoped,mutate,allowHeld);if(!mutate)this.host.scopes.checkTaskEntry(this.host.scopes.ownership(a.ticketId)!,c.scoped.route.entryId,'result',allowHeld);if(!allowHeld){const anchor=this.host.store.get<TaskContinuation>('task-continuation',a.ticketId);if(anchor)this.host.routerIngress.authority(anchor.triggerId,anchor.discussion);else if(a.parentTrigger)this.host.routerIngress.authority(a.parentTrigger,a.discussion);const saved=this.host.store.get<{manifest:ContextManifest}>('task-context',a.ticketId);if(saved)this.host.memory.validate(saved.manifest)}return}
  if(c&&(!a||a.discussion!==c.discussion||c.trigger&&a.source!==c.trigger.source))throw Error('Task is outside this Router discussion')
  if(c&&a?.mode==='host'&&a.parentTrigger)this.host.routerIngress.authority(a.parentTrigger,a.discussion)
 }
 async call(value:unknown,context?:RouterContext):Promise<any>{
  const input=workerCommandSchema.parse(value),host=this.host
  const mandate=context?.trigger?host.routerIngress.authority(context.trigger.id,context.discussion):undefined
  if(mandate?.strength==='inferred'&&!['list','inspect','result','assign','send'].includes(input.action))throw Error('Inferred work cannot change Worker configuration or stop tasks')
  if(input.action==='list')return this.list(context)
  if(input.action==='inspect'||input.action==='result'){
   if(input.ticketId){const a=host.store.get<Delegation>('worker-assignment',input.ticketId);this.checkContext(a,context);const until=Date.now()+(input.waitMs??0);while(Date.now()<until&&!host.store.tickets.get(input.ticketId)?.ended&&!['blocked','failed'].includes(host.store.tickets.get(input.ticketId)?.assignments.at(-1)?.report?.state??''))await new Promise(r=>setTimeout(r,Math.min(100,until-Date.now())));this.checkContext(a,context);const raw=host.store.tickets.get(input.ticketId);if(!raw)throw Error('Unknown task');const ticket=taskView(host.store,raw);return {assignment:a,run:host.store.get('run',input.ticketId),report:ticket.assignments.at(-1)?.report,attention:ticket.attention,ended:ticket.ended}}
   const w=this.list(context).workers.find(w=>w.id===input.id);if(!w)throw Error('Unknown Worker');return w
  }
  if(context?.scoped&&!['assign','send'].includes(input.action)&&!host.scopes.canManage(context.scoped))throw Error('Worker configuration requires a scope manager')
  const policy=host.config.execution.management
  if(!policy?.enabled)throw Error('Router Worker management is disabled in execution.management')
  if(input.revision===undefined||!input.requestId)throw Error('Mutation requires revision and requestId')
  const key=bodyDigest([context?.discussion??'operator',input.requestId]),fingerprint=bodyDigest(input),receipt=host.store.get<any>('worker-command',key)
  if(receipt){if(receipt.fingerprint!==fingerprint)throw Error('requestId reused with different content');if(receipt.status==='completed'){if(context?.scoped){if(receipt.result?.ticketId)this.checkContext(host.store.get<Delegation>('worker-assignment',receipt.result.ticketId),context, false,input.action==='rebuild'&&host.scopes.ownership(receipt.result.ticketId)?.state==='held');if(input.id&&!host.scopes.scope(context.scoped.route.scopeId).workerIds.includes(input.id))throw Error('Worker receipt is outside this scope')}return receipt.result};if(this.inFlight.has(key))throw Error('Operation is still running');if(!['cancel','destroy'].includes(input.action))throw Error('Previous operation outcome requires reconciliation')}
  if(!receipt&&input.revision!==host.settings.current().revision)throw Error('Settings conflict; read current revision')
  let profiles=workerProfiles(host.config).map(w=>structuredClone(w))
  const worker=profiles.find(w=>w.id===input.id)
  if(context?.scoped){const scope=host.scopes.scope(context.scoped.route.scopeId);if(input.id&&!scope.workerIds.includes(input.id))throw Error('Worker is outside this scope');if(input.id&&!['assign','send','cancel','migrate'].includes(input.action)&&host.store.list<any>('management-scope').some(s=>s.id!==scope.id&&s.workerIds.includes(input.id)))throw Error('Shared Worker configuration requires the platform operator')}
  if(receipt?.expected&&JSON.stringify(worker)!==JSON.stringify(receipt.expected))throw Error('Worker changed after this operation began; inspect it and use a new request')
  const save=()=>host.updateSettings(host.settings.current().revision,{execution:{...host.config.execution,workers:profiles}})
  const verifyBackend=(backend:string)=>{if(policy.backends&&!policy.backends.includes(backend)||context?.scoped&&!host.scopes.scope(context.scoped.route.scopeId).backendIds.includes(backend))throw Error('Backend is outside Router management policy')}
  const complete=(result:any)=>{host.store.put('worker-command',key,{fingerprint,status:'completed',result});return result}
  if(['create','clone','configure','set_prompt','pause','resume','retire'].includes(input.action))return host.store.atomic(()=>{
   if(input.action==='create'||input.action==='clone'){
    const base=input.action==='clone'?profiles.find(w=>w.id===input.from):undefined
    if(input.action==='clone'&&(!base||context?.scoped&&!host.scopes.scope(context.scoped.route.scopeId).workerIds.includes(base.id)))throw Error('Unknown Worker template')
    const candidate=workerProfileSchema.parse(input.profile??{...base,...input.patch,id:input.id})
    if(profiles.some(w=>w.id===candidate.id))throw Error('Duplicate Worker id')
    if(profiles.length>=policy.maxWorkers)throw Error('Worker limit reached')
    if(host.store.get('retired-worker',candidate.id))throw Error('Retired Worker identity cannot be reused')
    verifyBackend(candidate.backend);profiles.push(candidate);if(context?.scoped)host.scopes.addWorker(context.scoped.route.scopeId,candidate.id)
   }else{
    if(!worker)throw Error('Unknown Worker')
    let candidate:any={...worker,...(input.action==='configure'?input.patch:{})}
    if(input.action==='configure')for(const k of input.unset??[]){if(['id','backend'].includes(k))throw Error('Cannot unset Worker identity');delete candidate[k]}
    if(candidate.id!==worker.id)throw Error('Cannot rename Worker identity')
    if(input.action==='set_prompt'){if(input.prompt===undefined)throw Error('prompt required');candidate.prompt=input.prompt}
    if(['pause','resume','retire'].includes(input.action))candidate.state=input.action==='pause'?'paused':input.action==='retire'?'retiring':'enabled'
    candidate=workerProfileSchema.parse(candidate);verifyBackend(candidate.backend)
    profiles=profiles.map(w=>w.id===worker.id?candidate:w)
   }
   const saved=save();return complete({revision:saved.revision,applied:true,effective:'next activation; backend/model changes require migration for existing tasks',worker:profiles.find(w=>w.id===(input.profile?.id??input.id))})
  })
  if(input.action==='assign')return host.store.atomic(()=>{
   if(!worker||worker.state&&worker.state!=='enabled')throw Error('Select an enabled Worker')
   verifyBackend(worker.backend)
   if(!input.text)throw Error('Task text required')
   const discussion=context?.discussion??input.discussion;if(!discussion)throw Error('Router discussion required')
   const source=context?.trigger?host.sources.get(context.trigger.source)?.config:host.config.sources.find(s=>s.kind==='local'&&s.enabled)
   if(!source)throw Error('Local operator source required')
   const actor=context?.trigger?.actor.id??source.allowedActors[0]!
   const id='delegation:'+key,thread='delegation:'+key
   const origin=context?.trigger??host.sources.get(source.id)!.trigger({id,thread,text:input.text,addressed:true},actor)
   const trigger:Trigger={...origin,id,threads:[{source:source.id,id:thread}],at:new Date().toISOString(),text:input.text,meta:{...origin.meta,delegatedBy:'router',parentTrigger:context?.trigger?.id??null},channel:{source:source.id,thread,address:{routerInbox:discussion}}}
   if(context?.trigger)host.store.put('router-delegation',id,{parentTrigger:context.trigger.id,discussion})
   host.engine.receive(trigger)
   const decision=host.engine.decide(id,{kind:'accept',title:input.text.slice(0,100),scope:input.text+(input.acceptance?'\nAcceptance: '+input.acceptance:''),reason:'Router delegation within admitted scope',rules:mandate?.basis.rules??[]})
   if(!decision.ticketId)throw Error('Delegation was not accepted')
   const assignment:Delegation={ticketId:decision.ticketId,workerId:worker.id,discussion,source:source.id,actor,parentTrigger:context?.trigger?.id,mode:context?.trigger?'host':'client'}
   host.store.put('worker-assignment',decision.ticketId,assignment)
   if(context?.scoped){const owner=host.scopes.own(decision.ticketId,context.scoped,worker.backend);if(context.manifest)host.store.put('task-context',decision.ticketId,{manifest:{...context.manifest,taskOwners:[...context.manifest.taskOwners,{id:decision.ticketId,epoch:owner.ownerEpoch,dataRevision:owner.dataRevision??1}]}})}
   return complete({...assignment,status:'queued',revision:host.settings.current().revision})
  })
  if(input.action==='send')return host.store.atomic(()=>{
   if(!input.ticketId||!input.text)throw Error('Task and text required')
   const a=host.store.get<Delegation>('worker-assignment',input.ticketId);if(!a)throw Error('Unknown delegated task');this.checkContext(a,context,true)
   const ticket=host.store.tickets.get(input.ticketId)!,origin=host.store.triggers.get(ticket.origin.triggerId)!,previousInputs=ticket.inputs.map(i=>i.id)
   if(context?.scoped){
    if(host.store.deliveries().some(d=>d.ticketId===input.ticketId&&!['sent','dropped'].includes(d.status)))throw Error('Reconcile pending task deliveries before changing the reply entry')
    host.scopes.noteInput(input.ticketId,context.scoped);host.memory.moveTaskContext(input.ticketId,context.scoped)
    if(context.manifest){const owner=host.scopes.ownership(input.ticketId)!;context.manifest.taskOwners=[...context.manifest.taskOwners.filter(t=>t.id!==input.ticketId),{id:input.ticketId,epoch:owner.ownerEpoch,dataRevision:owner.dataRevision??1}];host.store.put('context-manifest',context.manifest.id,context.manifest)}
   }
   if(context?.trigger){
    if(ticket.ended){
     if(!context.trigger.human)throw Error('A bot event cannot resume completed work')
     if(context.trigger.id===origin.id||context.trigger.meta.delegatedBy)throw Error('A new user follow-up is required to resume completed work')
     // Preserve the user's original event, but attach an internal Router instruction to the Worker.
     // Attaching the external event directly would add its user-facing reply channel to the task.
     const followup:Trigger={...context.trigger,id:'router-followup:'+key,threads:origin.threads,channel:origin.channel,text:input.text,meta:{...context.trigger.meta,delegatedBy:'router',parentTrigger:context.trigger.id}}
     host.store.triggers.save(followup)
     host.engine.attach(input.ticketId,followup.id,input.text)
    }
    else host.engine.note(input.ticketId,input.text)
   }else{
    const followup=host.sources.get(a.source)!.trigger({id:'router-followup-'+key,thread:origin.threads[0]!.id,text:input.text,addressed:true},a.actor)
    followup.channel=origin.channel
    host.engine.receive(followup)
   }
   allowNewTaskInputs(host.store,input.ticketId,previousInputs)
   return complete({ticketId:input.ticketId,status:'queued',revision:host.settings.current().revision})
  })
  if(input.action==='rebuild')return host.store.atomic(()=>{
   if(!input.ticketId)throw Error('Task required')
   const a=host.store.get<Delegation>('worker-assignment',input.ticketId),run=host.store.get<Run>('run',input.ticketId),held=host.store.get<any>('context-rebuild',input.ticketId),saved=host.store.get<{manifest:ContextManifest}>('task-context',input.ticketId)
   const narrowed=held?.reason==='context_permissions_changed'
   this.checkContext(a,context,true,narrowed)
   if(!run||!held||!['context_budget_exceeded','context_permissions_changed'].includes(held.reason)||!['idle','uncertain','interrupted'].includes(run.phase))throw Error('Rebuild requires a stopped task held by context validation')
   if(narrowed&&(!context?.scoped||!host.scopes.canManage(context.scoped)||!input.text||!input.workspaceReviewed))throw Error('Permission rebuild requires a current manager, fresh task text and reviewed workspace artifacts')
   if(!narrowed&&saved)host.memory.validate(saved.manifest)
   if(run.threadId)host.model.describe?.(run.threadId)
   if(host.memory.cleanup.blocked('run',input.ticketId,run))throw Error('Deleted task history cannot be rebuilt')
   if(host.activity.list().some(c=>c.ticketId===input.ticketId&&c.state==='running')||host.work.list(input.ticketId).some(w=>['starting','running'].includes(w.state))||host.toolConnections.receipts(input.ticketId).some(r=>r.state!=='complete')||host.store.deliveries().some(d=>d.ticketId===input.ticketId&&['sending','uncertain'].includes(d.status)))throw Error('Reconcile running or uncertain effects before rebuilding')
   const handoff={ticketId:input.ticketId,previousThread:run.threadId,backendId:run.backendId,model:run.model,reason:held.reason,effects:host.work.list(input.ticketId).map(w=>({id:w.id,kind:w.kind,state:w.state,exitCode:w.exitCode})),toolReceipts:host.toolConnections.receipts(input.ticketId),at:Date.now()}
   host.store.put('context-handoff',key,handoff)
   if(narrowed){
    const c=context!.scoped!,owner=host.scopes.ownership(input.ticketId)!,ticket=host.store.tickets.get(input.ticketId)!
    host.store.put('task-ownership',input.ticketId,{...owner,state:'active',reason:undefined})
    const fresh=host.memory.build(c,{task:input.ticketId,request:input.text},run.backendId??owner.backendId).manifest
    fresh.taskOwners=[...fresh.taskOwners.filter(t=>t.id!==ticket.id),{id:ticket.id,epoch:owner.ownerEpoch,dataRevision:owner.dataRevision??1}]
    host.memory.validate(fresh);host.store.put('task-context',ticket.id,{manifest:fresh});host.store.put('context-manifest',fresh.id,fresh)
    host.store.put('task-continuation',ticket.id,{ticketId:ticket.id,triggerId:c.trigger.id,discussion:c.route.discussion,text:input.text!,at:Date.now(),inputIds:[],priorAssignments:ticket.assignments.map(a=>a.id),priorReports:ticket.assignments.map(a=>({id:a.id,at:a.report?.at})),priorJobs:host.work.list(ticket.id).map(w=>w.id),priorMessages:host.store.list<any>('router-inbox').filter(m=>m.ticketId===ticket.id).map(m=>m.id),priorToolCalls:host.toolConnections.receipts(ticket.id).map(r=>r.id),previousThread:run.threadId,workspaceReviewed:true} satisfies TaskContinuation)
    for(const d of host.store.deliveries())if(d.ticketId===ticket.id&&['pending','held'].includes(d.status))host.store.db.prepare("UPDATE outbox SET status='dropped' WHERE id=?").run(d.id)
    if(run.threadId)host.store.put('context-session-fence',run.threadId,{threadId:run.threadId,ticketId:ticket.id,reason:held.reason,at:Date.now()})
   }
   const {threadId,turnId,result,error,toolsDigest,toolsVersion,...remaining}=run
   host.store.put('run',input.ticketId,{...remaining,phase:'idle',rebuild:key})
   host.store.put('context-rebuild',input.ticketId,{...held,state:'awaiting_followup',handoff:key})
   return complete({ticketId:input.ticketId,status:'awaiting_followup',previousThread:threadId,handoff:key})
  })
  if(input.action==='migrate')return host.store.atomic(()=>{
   if(!input.ticketId)throw Error('Task required')
   const a=host.store.get<Delegation>('worker-assignment',input.ticketId);if(!a)throw Error('Unknown delegated task');this.checkContext(a,context)
   const run=host.store.get<Run>('run',input.ticketId),target=profiles.find(w=>w.id===a.workerId)
   if(!run||run.phase!=='idle'||!target)throw Error('Migration requires an idle task and its configured Worker')
   verifyBackend(target.backend)
   host.store.put('worker-migration',key,{...a,from:run,to:target,at:Date.now()})
   const {threadId,turnId,model,backendId,backendKind,toolsDigest,toolsVersion,...remaining}=run
   host.store.put('run',input.ticketId,{...remaining,migration:key})
   // The next explicit follow-up reopens the existing logical task. Never silently rerun it.
   return complete({ticketId:input.ticketId,migration:key,status:'awaiting_followup',previousThread:threadId})
  })
  if(input.action==='cancel'||input.action==='destroy'){
   const ids=input.action==='cancel'?(input.ticketId?[input.ticketId]:[]):[...new Set([...this.tasks(input.id??'').map(t=>t.ticketId),...this.active(input.id??'').map(r=>r.ticketId)])]
   if(input.action==='destroy'){if(!worker){if(receipt&&host.store.get('retired-worker',input.id!))return complete({status:'destroyed',revision:host.settings.current().revision,tasks:[]});throw Error('Unknown Worker')};if(profiles.length===1)throw Error('Keep at least one Worker');if(ids.length&&!input.cancelRunning)throw Error('Worker still owns tasks; cancelRunning required')}
   if(!ids.length&&input.action==='cancel')throw Error('Task required')
   for(const id of ids)this.checkContext(host.store.get<Delegation>('worker-assignment',id),context,true)
   this.inFlight.add(key)
   try{
    host.store.atomic(()=>{
     // Block new dispatch before awaiting cancellation. A crash retains this draining state.
     if(input.action==='destroy'){profiles=profiles.map(w=>w.id===worker!.id?{...w,state:'paused'}:w);save()}
     host.store.put('worker-command',key,{fingerprint,status:'started',expected:input.action==='destroy'?profiles.find(w=>w.id===input.id):undefined})
    })
    const expected=profiles.find(w=>w.id===input.id)
    for(const id of ids)await host.stop(id)
    return host.store.atomic(()=>{
     if(input.action==='destroy'){
      const current=workerProfiles(host.config).find(w=>w.id===input.id)
      if(JSON.stringify(current)!==JSON.stringify(expected))throw Error('Worker changed during cancellation; inspect it before a new destroy request')
      profiles=workerProfiles(host.config).filter(w=>w.id!==input.id);save();host.store.put('retired-worker',input.id!,{profile:worker,at:Date.now()})
     }
     return complete({status:input.action==='destroy'?'destroyed':'cancelled',revision:host.settings.current().revision,tasks:ids})
    })
   }finally{this.inFlight.delete(key)}
  }
  throw Error('Unsupported Worker action')
 }
}
