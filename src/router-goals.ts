import {z} from 'zod'
import type {Runtime} from './runtime.ts'
import type {ScopeContext} from './router-scope.ts'
import type {Trigger,Mandate} from './vendor/dsh-core/index.ts'
import type {RouterAdmission} from './router-ingress.ts'
import type {ToolSpec} from './model.ts'
import type {ContextManifest} from './router-memory.ts'
import {stableDigest} from './sources.ts'
import {repositoryEffectsSettled} from './repository-source.ts'
import {criterionSchema,nodeSchema,validateGraph,classifyGoalFailure,classifyVerificationFailure,type GoalNode,type GoalFailure} from './goal-contract.ts'
import type {GoalDelivery,VerificationRound} from './goal-verification.ts'
import type {Run} from './store.ts'
import {DELEGATED_GOALS_DB_SCHEMA} from './store.ts'
import {allowNewTaskInputs} from './task-context.ts'
import type {GoalContract} from './goal-replanning.ts'

const id=z.string().min(1).max(300)
const criterion=criterionSchema
const verification=z.object({criterionId:id,ticketId:id.optional(),delegationId:id.optional(),reportAt:id,explanation:z.string().min(1).max(4000)}).strict().refine(v=>!!v.ticketId!==!!v.delegationId,'A check needs its actual task or delegation reference')
export const goalCommandSchema=z.object({action:z.enum(['list','inspect','start','update','wait','complete','pause','resume','cancel']),id:id.optional(),operationId:id.optional(),expectedRevision:z.number().int().min(0).optional(),title:z.string().min(1).max(300).optional(),objective:z.string().min(1).max(16000).optional(),authorizationQuote:z.string().min(1).max(16000).optional(),criteria:z.array(criterion).min(1).max(50).optional(),plan:z.array(z.string().min(1).max(4000)).max(100).optional(),nextAction:z.string().min(1).max(4000).optional(),reason:z.string().min(1).max(4000).optional(),wakeAfterSeconds:z.number().int().min(10).max(86400).optional(),needsHuman:z.boolean().optional(),checks:z.array(verification).max(50).optional(),maxTurns:z.number().int().min(1).max(10000).optional(),nodes:z.array(nodeSchema).min(1).max(100).optional(),maxParallel:z.number().int().min(1).max(10).optional(),maxRepairs:z.number().int().min(0).max(10).optional(),maxReplans:z.number().int().min(0).max(5).optional()}).strict()
export interface RouterGoal {id:string;scopeId:string;entryId:string;discussion:string;actor:string;triggerId:string;bindingRevision:number;revision:number;title:string;objective:string;criteria:z.infer<typeof criterion>[];plan:string[];state:'active'|'waiting'|'needs_input'|'paused'|'held'|'completed'|'cancelled';taskIds:string[];delegationIds?:string[];contextIds?:string[];nextAction:string;reason?:string;nextAt?:number;turns:number;maxTurns:number;failures:number;lastFingerprint?:string;checks?:z.infer<typeof verification>[];at:number;nodes?:GoalNode[];maxParallel?:number;maxRepairs?:number;finalRoundId?:string;recovery?:GoalFailure;recoveryAttempts?:number;managed?:boolean;contract?:GoalContract;planRevision?:number;replans?:number;maxReplans?:number;replanId?:string}
interface Wake {id:string;goalId:string;scopeId:string;entryId:string;triggerId:string;triggerHash:string;goalRevision:number;state:'queued'|'running'|'done'|'failed';at:number}
const terminal=new Set(['completed','cancelled'])
export const goalSpecs:ToolSpec[]=[{type:'function',name:'router_goal',description:'Own a long-running user goal across turns and restarts. Prefer nodes with exactly one of workerId (local Worker) or teamTargetId (authorized independent team), dependsOn and criterionIds for host scheduling. Remote nodes retain delegation handles and are independently verified; the host never invents a local Worker. Failed remote contracts are held for review rather than repeated. Do not call team_delegate assign or accept for a managed node. Each criterion may declare files, documents and a deterministic check (file_exists, text_contains, json_equals with JSON pointer and expected value). The host intercepts ready reports, independently verifies immutable artifacts, repairs failed checks on the same open task and completes the goal only after overall acceptance. inspect returns verification rounds and versioned replanning records. After a settled strategy failure the host may request a new execution graph from the Router model and independently review it. Original objective, authority and acceptance criteria are immutable; replanning cannot change them. Do not manually assign tasks already declared in nodes. Start only when the user asks for sustained/multistep work, with an exact authorizationQuote from the current human message, objective and acceptance criteria. Mutations require operationId and expectedRevision. Keep plan/nextAction current. wait with needsHuman=false retains a durable wake; needsHuman=true requires a concrete question/reason. Worker completion does not complete the goal. The host completes accepted goals automatically; complete cannot bypass independent verification. pause/resume/cancel and raising maxTurns require a current explicit human. Reaching the turn allowance holds an unresolved goal; never claim success.',inputSchema:{type:'object',properties:{action:{type:'string',enum:goalCommandSchema.shape.action.options},id:{type:'string'},operationId:{type:'string'},expectedRevision:{type:'integer'},title:{type:'string'},objective:{type:'string'},authorizationQuote:{type:'string'},criteria:{type:'array',items:{type:'object',properties:{id:{type:'string'},description:{type:'string'},files:{type:'array',items:{type:'string'}},documents:{type:'array',items:{type:'string'}},check:{type:'object',properties:{kind:{type:'string',enum:['file_exists','text_contains','json_equals']},path:{type:'string'},text:{type:'string'},pointer:{type:'string'},expected:{}},required:['kind','path'],additionalProperties:false}},required:['id','description'],additionalProperties:false}},plan:{type:'array',items:{type:'string'}},nextAction:{type:'string'},reason:{type:'string'},wakeAfterSeconds:{type:'integer'},needsHuman:{type:'boolean'},checks:{type:'array',items:{type:'object',properties:{criterionId:{type:'string'},ticketId:{type:'string'},delegationId:{type:'string'},reportAt:{type:'string'},explanation:{type:'string'}},required:['criterionId','reportAt','explanation'],additionalProperties:false}},maxTurns:{type:'integer'},maxParallel:{type:'integer'},maxRepairs:{type:'integer'},maxReplans:{type:'integer'},nodes:{type:'array',items:{type:'object',properties:{id:{type:'string'},title:{type:'string'},instruction:{type:'string'},workerId:{type:'string'},teamTargetId:{type:'string'},dependsOn:{type:'array',items:{type:'string'}},criterionIds:{type:'array',items:{type:'string'}}},required:['id','title','instruction','criterionIds'],additionalProperties:false}}},required:['action'],additionalProperties:false}}]

export class RouterGoals {
 constructor(private host:Runtime,private now:()=>number=Date.now){
  const previous=host.routerIngress.scheduledAuthority
  host.routerIngress.scheduledAuthority=id=>this.authority(id)??previous?.(id)
 }
 private belongs(g:RouterGoal,c:ScopeContext){return g.scopeId===c.route.scopeId&&g.entryId===c.route.entryId&&(g.discussion===c.route.discussion&&g.actor===c.actor||this.host.webhooks?.ownsTrigger(g.contract?.triggerId??g.triggerId)&&c.trigger.human&&this.host.scopes.canManage(c))}
 private sourcesValid(g:RouterGoal){return [...(g.contextIds??[]),...this.host.replanning.contexts(g.id)].every(id=>this.host.continuity.validContext(id))}
 private retryVerification(round:VerificationRound){
  const store=this.host.store,id=round.id+':'+round.attempts
  store.atomic(()=>{
   store.put('goal-verification-attempt',id,{id,roundId:round.id,goalId:round.goalId,scopeId:round.scopeId,entryId:round.entryId,attempt:round.attempts,state:round.state,error:round.error,checks:round.checks,threadId:round.threadId,finishedAt:round.finishedAt,snapshotHash:stableDigest(round.snapshot)})
   store.put('goal-verification',round.id,{...round,state:'pending',error:undefined})
   store.jobState('goal-verify:'+round.id,'pending')
  })
 }
 private rawList(c:ScopeContext){this.host.scopes.assertCurrent(c);return this.host.store.list<RouterGoal>('router-goal').filter(g=>this.belongs(g,c)&&g.objective&&!this.host.memory.cleanup.blocked('router-goal',g.id,g))}
 list(c:ScopeContext){return this.rawList(c).map(g=>this.sourcesValid(g)?g:{...g,state:terminal.has(g.state)?g.state:'held' as const,title:'Goal needs source review',objective:'Prior derived goal content is unavailable',criteria:[],nodes:undefined,contract:undefined,plan:[],checks:undefined,nextAction:'Resume with a current explicitly authorized objective, criteria and plan',reason:'Goal sources changed or were revoked',nextAt:undefined})}
 snapshot(){return this.host.store.list<RouterGoal>('router-goal').flatMap(g=>{
  try{if(this.host.scopes.binding(g.entryId).privateActor)return [];const t=this.host.store.triggers.get(g.triggerId);if(!t)return [];this.host.routerIngress.authority(t.id);const c=this.host.scopes.context(t,g.discussion);const visible=c&&this.list(c).find(item=>item.id===g.id);return visible?[visible]:[]}catch{return []}
 })}
 private anchor(g:RouterGoal){
  const t=this.host.store.triggers.get(g.triggerId);if(!t||!t.human&&!this.host.webhooks?.ownsTrigger(t.id))throw Error('Goal authorization source unavailable')
  const mandate=this.host.routerIngress.authority(t.id),c=this.host.scopes.context(t,g.discussion)
  if(!c||!this.belongs(g,c)||this.host.scopes.binding(g.entryId).revision!==g.bindingRevision)throw Error('Goal entry or ownership changed')
  if(mandate.strength!=='explicit')throw Error('Goal needs explicit standing authority')
  if(this.host.memory.cleanup.blocked('router-goal',g.id,g))throw Error('Goal history was deleted')
  if(!this.sourcesValid(g))throw Error('Goal sources changed; explicit goal reauthorization is required')
  return {trigger:t,mandate,context:c}
 }
 private wake(triggerId:string){return this.host.store.get<Wake>('goal-wake',triggerId)}
 forInput(triggerId:string){const wake=this.wake(triggerId);return wake?this.host.store.get<RouterGoal>('router-goal',wake.goalId):this.host.store.list<RouterGoal>('router-goal').find(g=>g.triggerId===triggerId&&(!terminal.has(g.state)||this.host.webhooks?.ownsTrigger(triggerId)||g.state==='completed'&&g.nodes?.some(n=>n.teamTargetId)))}
 private authority(triggerId:string):Mandate|undefined{
  const wake=this.wake(triggerId);if(!wake)return
  const g=this.host.store.get<RouterGoal>('router-goal',wake.goalId),t=this.host.store.triggers.get(triggerId)
  if(!g||g.state==='cancelled'||!t||stableDigest(t)!==wake.triggerHash)throw Error('Goal wake no longer authorized')
  // A running turn may settle its final reply after complete/needs_input. New
  // effects are fenced separately; queued wakes cannot start a settled goal.
  if(wake.state==='queued'&&(!['active','waiting'].includes(g.state)||wake.goalRevision!==g.revision))throw Error('Goal changed before wake dispatch')
  const {mandate}=this.anchor(g);this.host.scopes.assertTrigger(t)
  return {...mandate,scope:g.objective}
 }
 private pending(g:RouterGoal){return this.host.store.db.prepare("SELECT payload FROM jobs WHERE state IN ('pending','running') AND kind='router'").all().some(row=>{const p=JSON.parse(String(row.payload));return p.triggerId===g.triggerId||this.wake(p.triggerId)?.goalId===g.id})}
 beforeTurn(triggerId:string,receipt=false){const w=this.wake(triggerId);if(w){const g=this.host.store.get<RouterGoal>('router-goal',w.goalId);if(!g||!['active','waiting'].includes(g.state)&&!(receipt&&g.state==='completed'))throw Error('Goal continuation is not running');this.authority(triggerId);if(w.state==='queued')this.host.store.put('goal-wake',triggerId,{...w,state:'running'})}}
 toolAllowed(triggerId:string,name:string,args:any){
  const w=this.wake(triggerId),g=this.forInput(triggerId);if(!g)return
  if(name==='team_delegate'){
   if(args.action!=='list'&&args.action!=='assign'&&!g.delegationIds?.includes(args.id))throw Error('Goal can only inspect its own delegations')
   if(g.managed&&!['list','inspect'].includes(args.action))throw Error('Managed goal delegations are scheduled and accepted by the host; use router_goal for goal control')
  }
  if(g.state==='completed'){if(name==='router_goal'&&['list','inspect','complete'].includes(args.action)||name==='worker_manage'&&['list','inspect','result'].includes(args.action)&&(args.action==='list'||g.taskIds.includes(args.ticketId))||name==='team_delegate'&&['list','inspect'].includes(args.action)&&(args.action==='list'||g.delegationIds?.includes(args.id)))return;throw Error('Completed goal only permits inspection of its accepted results')}
  if(!['active','waiting'].includes(g.state))throw Error('Goal no longer accepts work in this turn')
  if(g.managed&&name==='worker_manage'&&['assign','send'].includes(args.action))throw Error('Goal tasks are scheduled and repaired by the host; inspect existing nodes')
  if(!w&&!this.host.webhooks.ownsTrigger(triggerId))return
  if(name==='router_memory'&&!['search','read','inspect'].includes(args.action))throw Error('Autonomous goal input cannot mutate Agent memory')
  if(name==='router_journal'&&args.action!=='read')throw Error('Autonomous goal input cannot change original requirements or commitments')
  if(name==='worker_manage'&&!['list','inspect','result','assign','send'].includes(args.action))throw Error('Goal wake cannot reconfigure Workers or change unrelated authority')
  if(name==='worker_manage'&&args.action!=='list'&&args.action!=='assign'&&!g.taskIds.includes(args.ticketId))throw Error('Goal wake can only use tasks owned by this goal')
  if(name==='router_manage')throw Error('Goal wake cannot change standing schedules or duties')
  if(name==='router_goal'&&(!['list','inspect'].includes(args.action)&&args.id!==g.id||!['list','inspect','update','wait','complete'].includes(args.action)))throw Error('Goal wake is restricted to its existing goal')
 }
 noteTask(triggerId:string,ticketId:string){const g=this.forInput(triggerId);if(g&&!g.taskIds.includes(ticketId)){const c=this.anchor(g).context;this.host.scopes.checkTask(ticketId,c,true);const assignment=this.host.store.get<any>('worker-assignment',ticketId);this.host.store.put('router-goal',g.id,{...g,taskIds:[...g.taskIds,ticketId],nodes:[...(g.nodes??[]),{id:ticketId,title:'Delegated task',instruction:this.host.store.tickets.get(ticketId)!.mandate.scope,workerId:assignment.workerId,dependsOn:[],criterionIds:g.criteria.map(cr=>cr.id),ticketId,state:'running',repairs:0,recoveries:0}]})}}
 finishTurn(triggerId:string,error?:unknown){
  const w=this.wake(triggerId),g=this.forInput(triggerId);if(!g)return
  if(w)this.host.store.put('goal-wake',triggerId,{...w,state:error?'failed':'done'})
  const latest=this.host.store.get<RouterGoal>('router-goal',g.id)!
  if(terminal.has(latest.state)||['paused','held','needs_input'].includes(latest.state))return
  const failures=error?latest.failures+1:0,turns=latest.turns+1
  const recovery=error?classifyGoalFailure(String(error),this.now(),latest.recoveryAttempts??0):undefined
  const retriable=recovery&&['transient','quota'].includes(recovery.kind)&&(latest.recoveryAttempts??0)<5
  const state=turns>=latest.maxTurns||error&&!retriable&&failures>=3?'held':latest.state
  const reason=state==='held'?(failures>=3?'Three goal turns failed; inspect retained effects before resuming':'Autonomous turn allowance reached; goal remains unresolved'):latest.reason
  this.host.store.put('router-goal',g.id,{...latest,turns,failures,state,reason,recovery,recoveryAttempts:error?(latest.recoveryAttempts??0)+1:0,nextAt:state==='held'?undefined:retriable?recovery.retryAt:latest.nextAt??this.now()+60000})
  if(state==='held')this.notice({...latest,state,reason},reason!)
 }
 notice(g:RouterGoal,text:string){
  try{const {trigger}=this.anchor(g);if(!trigger.channel)return;const ids=[...new Set([...(g.contextIds??[]),...this.host.replanning.contexts(g.id)])],manifests=ids.map(id=>{const manifest=this.host.store.get<ContextManifest>('context-manifest',id);if(!manifest)throw Error('Goal context unavailable');this.host.memory.validate(manifest);return manifest});const id='goal-notice:'+stableDigest([g.id,g.revision,text]);this.host.store.put('router-reply-owner',id,{discussion:g.discussion,triggerId:g.triggerId,inputs:[g.triggerId],manifests});this.host.store.outbox.send({id,channel:trigger.channel,kind:'reply',text:'目标「'+g.title+'」尚未完成：'+text})}catch{}
 }
 tick(){
  for(let g of this.host.store.list<RouterGoal>('router-goal')){
   if(!['active','waiting'].includes(g.state)||!g.objective||this.pending(g)||g.nodes?.length)continue
   try{
    const {trigger,context}=this.anchor(g)
    // Recover a task committed immediately before a host crash in noteTask.
    const assigned=this.host.store.list<any>('worker-assignment').filter(a=>a.parentTrigger===g.triggerId||this.wake(a.parentTrigger)?.goalId===g.id).map(a=>a.ticketId as string)
    if(assigned.some(id=>!g.taskIds.includes(id))){for(const id of assigned)this.host.scopes.checkTask(id,context);g={...g,taskIds:[...new Set([...g.taskIds,...assigned])]};this.host.store.put('router-goal',g.id,g)}
    const tasks=g.taskIds.map(id=>{this.host.scopes.checkTask(id,context);return this.host.store.tickets.get(id)})
    const fingerprint=stableDigest(tasks.map(t=>({id:t?.id,ended:t?.ended,report:t?.assignments.at(-1)?.report})))
    const busy=tasks.some(t=>t&&!t.ended&&!['blocked','failed'].includes(t.assignments.at(-1)?.report?.state??''))||g.taskIds.some(id=>this.host.store.list<any>('work').some(w=>w.ticketId===id&&['starting','running'].includes(w.state))||this.host.activity.list().some(a=>a.ticketId===id&&a.state==='running'))
    if(busy)continue
    if(g.nextAt!==undefined&&g.nextAt>this.now()&&fingerprint===g.lastFingerprint)continue
    this.host.store.atomic(()=>{
     const sequence=this.host.store.list<Wake>('goal-wake').filter(w=>w.goalId===g.id).length+1,id='goal:'+g.id+':'+sequence
     const t:Trigger={...trigger,id,human:false,addressed:undefined,text:g.objective+'\nNext action: '+g.nextAction,at:new Date(this.now()).toISOString(),meta:{...trigger.meta,origin:'goal-controller',goalId:g.id}}
     this.host.store.triggers.save(t);this.host.scopes.context(t,g.discussion)
     const wake:Wake={id,goalId:g.id,scopeId:g.scopeId,entryId:g.entryId,triggerId:id,triggerHash:stableDigest(t),goalRevision:g.revision,state:'queued',at:this.now()}
     this.host.store.put('goal-wake',id,wake)
     const {mandate}=this.anchor(g)
     this.host.store.put('router-admission',id,{triggerId:id,discussion:g.discussion,policyVersion:mandate.policyVersion,state:'accepted',reason:'Authorized goal continuation',at:t.at,mandate:{...mandate,scope:g.objective}} satisfies RouterAdmission)
     this.host.store.enqueue('router:goal:'+g.id+':'+sequence,'router',{discussion:g.discussion,triggerId:id,goalId:g.id})
     this.host.store.put('router-goal',g.id,{...g,lastFingerprint:fingerprint,nextAt:this.now()+60000})
    })
   }catch(error){this.host.store.put('router-goal',g.id,{...g,state:'held',reason:String(error),nextAt:undefined})}
  }
 }
 get(id:string){return this.host.store.get<RouterGoal>('router-goal',id)}
 context(g:RouterGoal){return this.anchor(g).context}
 forTask(ticketId:string){return this.host.store.list<RouterGoal>('router-goal').find(g=>!terminal.has(g.state)&&g.taskIds?.includes(ticketId))}
 effectsSettled(ticketId:string){
  if(!repositoryEffectsSettled(this.host.store,ticketId))return false
  const run=this.host.store.get<Run>('run',ticketId)
  return !run||run.phase==='idle'&&!this.host.activity.list().some(a=>a.ticketId===ticketId&&a.state==='running')&&!this.host.work.list(ticketId).some(w=>['starting','running'].includes(w.state))&&!this.host.toolConnections.receipts(ticketId).some(r=>r.state!=='complete')&&!this.host.store.deliveries().some(d=>d.ticketId===ticketId&&!['sent','dropped'].includes(d.status))
 }
 recoverFromWatchdog(g:RouterGoal,ticketId:string,recoveryId:string,reason:string){
  const c=this.context(g),n=g.nodes?.find(n=>n.ticketId===ticketId),task=this.host.store.tickets.get(ticketId)
  this.host.scopes.checkTask(ticketId,c,true)
  if(!g.managed||!['active','waiting'].includes(g.state)||!n||!task||task.ended||!this.effectsSettled(ticketId))throw Error('Watchdog recovery requires authorized settled work')
  if(this.host.store.get('goal-delivery',ticketId))throw Error('Retained deliverable must go through independent acceptance')
  const summary='Watchdog detected a stalled execution strategy. Inspect retained workspace and effects before changing implementation. Original objective, authorization and acceptance remain immutable. Evidence: '+recoveryId+'; '+reason
  this.host.engine.report(ticketId,{state:'failed',summary})
  n.state='held';n.reason=summary;n.failure={kind:'quality',reason:summary}
  this.save(g)
 }
 private save(g:RouterGoal){this.host.store.put('router-goal',g.id,g)}
 private advanceRemote(g:RouterGoal,n:GoalNode){
  if(!n.delegationId||n.state==='passed'||n.state==='held')return
  if(n.state==='waiting_dependency'){
   n.state='held';n.reason='Remote prerequisites changed; reconcile the retained contract before creating a new explicitly authorized goal'
   this.host.delegation.cancelWhere(t=>t.goal?.goalId===g.id&&t.goal.nodeId===n.id);return
  }
  const task=this.host.delegation.goalTasks.task(g,n)
  if(task.desired==='cancelled'||['blocked','cancelled'].includes(task.remote?.state??'')){
   n.state='held';n.reason=task.remote?.reason??'Remote work stopped or requires attention';return
  }
  if(task.contract.deadline<=Date.now()&&task.remote?.state!=='ready'){
   n.state='held';n.reason='Remote execution deadline reached; cancellation remains subject to remote confirmation'
   this.host.delegation.cancelWhere(t=>t.id===task.id);return
  }
  if(task.remote?.state!=='ready'||task.error){if(task.error)n.reason='Waiting for a fresh signed remote observation: '+task.error;return}
  n.reason=undefined
  const round=this.host.verification.ensure(g,n);n.roundId=round.id;n.state='verifying'
  if(round.state==='passed')n.state='passed'
  else if(['failed','insufficient'].includes(round.state)){
   n.state='held';n.reason='Independent acceptance did not pass. Remote work will not be repeated automatically.'
  }else if(round.state==='errored'){
   const failure=classifyVerificationFailure(round.error??'Verifier failed',this.now(),n.recoveries)
   if(['transient','quota','protocol'].includes(failure.kind)&&(failure.kind==='protocol'?round.attempts<=2:n.recoveries<5)){
    n.failure??=failure;n.retryAt??=failure.retryAt
    if((n.retryAt??0)<=this.now()){this.retryVerification(round);n.recoveries++;n.retryAt=undefined;n.failure=undefined}
   }else{n.state='held';n.reason='Remote acceptance needs review: '+round.error}
  }else if(round.state==='stale'){n.state='held';n.reason='Remote acceptance evidence or authority changed'}
 }
 private repair(g:RouterGoal,n:GoalNode,round:Pick<VerificationRound,'id'|'checks'>){
  if(n.teamTargetId){n.state='held';n.reason='Remote acceptance needs a reviewed new contract; automatic replay is disabled';this.save(g);return}
  const c=this.context(g),task=this.host.store.tickets.get(n.ticketId!)!
  this.host.scopes.checkTask(task.id,c,true)
  if(task.ended||!this.effectsSettled(task.id))throw Error('Repair requires a retained open task with settled effects')
  const repairKey=stableDigest([round.id,n.id])
  const failed=round.checks.filter(ch=>ch.verdict!=='passed')
  const instruction='Independent acceptance did not pass. Repair only the listed failures while preserving all original constraints. Inspect retained workspace and effects before acting. Do not change acceptance criteria.\n'+JSON.stringify({failed,prerequisites:n.dependsOn.flatMap(id=>{const dep=g.nodes!.find(d=>d.id===id)!;return dep.roundId?this.host.store.get<VerificationRound>('goal-verification',dep.roundId)?.snapshot.evidence.filter(e=>e.kind!=='execution')??[]:[]})})
  if(Buffer.byteLength(instruction)>this.host.scopes.scope(g.scopeId).contextBytes)throw Error('Repair evidence exceeds context budget')
  this.host.store.atomic(()=>{
   if(this.host.store.get('goal-repair',repairKey))return
   const prior=task.inputs.map(i=>i.id)
   this.host.scopes.noteInput(task.id,c);this.host.memory.moveTaskContext(task.id,c)
   this.host.engine.note(task.id,instruction);allowNewTaskInputs(this.host.store,task.id,prior)
   this.host.store.db.prepare("DELETE FROM records WHERE kind='goal-delivery' AND id=?").run(task.id)
   this.host.store.put('goal-repair',repairKey,{id:repairKey,roundId:round.id,goalId:g.id,triggerId:g.triggerId,ticketId:task.id,failed,at:this.now()})
   n.repairs++;n.state='running';n.roundId=undefined;n.refreshFrom=undefined;g.finalRoundId=undefined
   const affected=new Set([n.id]);let grew=true
   while(grew){grew=false;for(const d of g.nodes??[])if(!affected.has(d.id)&&d.dependsOn.some(id=>affected.has(id))){affected.add(d.id);grew=true;if(d.ticketId||d.delegationId){d.state='waiting_dependency';d.refreshFrom=round.id;d.roundId=undefined;d.reason='Prerequisite repair requires refreshing this result'}}}
   this.save(g)
  })
 }
 /** Host-controlled graph scheduling and acceptance; no model decides these transitions. */
 async advance(){
  for(let saved of this.host.store.list<RouterGoal>('router-goal')){
   if(!saved.nodes?.length&&saved.taskIds?.length){saved={...saved,nodes:saved.taskIds.map(ticketId=>({id:ticketId,title:'Retained task',instruction:this.host.store.tickets.get(ticketId)?.mandate.scope??'',workerId:this.host.store.get<any>('worker-assignment',ticketId)?.workerId??'',criterionIds:saved.criteria.map(c=>c.id),dependsOn:[],ticketId,state:'running' as const,repairs:0,recoveries:0}))};this.save(saved)}
   if(!['active','waiting'].includes(saved.state)||!saved.objective||!saved.nodes?.length)continue
   if(this.host.replanning.active(saved))continue
   let g=saved
   try{
    const c=this.context(g)
    if(g.state==='waiting'&&g.nextAt&&g.nextAt>this.now()&&!g.nodes!.some(n=>n.ticketId||n.delegationId))continue
    const nodes=g.nodes!
    // A previously accepted upstream artifact changing invalidates downstream acceptance.
    for(const n of nodes)if(n.state==='passed'){
     const round=n.roundId?this.host.store.get<VerificationRound>('goal-verification',n.roundId):undefined
     if(!round||!this.host.verification.current(round,g)){
      n.state='verifying';n.roundId=undefined;g.finalRoundId=undefined
      const affected=new Set([n.id]);let grew=true
      while(grew){grew=false;for(const d of nodes)if(!affected.has(d.id)&&d.dependsOn.some(id=>affected.has(id))){affected.add(d.id);grew=true;d.state='held';d.reason='A prerequisite changed after acceptance; reconcile downstream work before resuming'}}
     }
    }
    for(const n of nodes){
     if(n.teamTargetId){this.advanceRemote(g,n);continue}
     if(!n.ticketId||n.state==='passed'||n.state==='held')continue
     if(n.state==='waiting_dependency'){
      if(n.dependsOn.every(id=>nodes.find(d=>d.id===id)?.state==='passed')&&this.effectsSettled(n.ticketId)){
       if(this.host.replanning.resumeNode(g,n))continue
       if((n.repairs-(n.repairStart??0))>=(g.maxRepairs??2)){n.state='held';n.reason='Dependent refresh allowance reached'}
       else this.repair(g,n,{id:n.refreshFrom!,checks:n.criterionIds.map(criterionId=>({criterionId,verdict:'failed',explanation:'A prerequisite was repaired. Re-read its accepted evidence and refresh this dependent deliverable.',evidenceIds:[],method:'program'}))})
      }
      continue
     }
     this.host.scopes.checkTask(n.ticketId,c,true)
     const task=this.host.store.tickets.get(n.ticketId),run=this.host.store.get<Run>('run',n.ticketId)
     if(!task)throw Error('Goal task is unavailable')
     if(task.ended&&task.ended.by==='human'){n.state='held';n.reason='Task stopped by a human';continue}
     const proposal=this.host.store.get<GoalDelivery>('goal-delivery',n.ticketId)
     if(task.ended&&!proposal){n.state='held';n.reason='Legacy task ended without retained acceptance evidence; start a new authorized goal to verify or repair it';continue}
     if(proposal&&this.effectsSettled(n.ticketId)){
      const round=this.host.verification.ensure(g,n);n.roundId=round.id;n.state='verifying'
      if(round.state==='passed')n.state='passed'
      else if(['failed','insufficient'].includes(round.state)){
       if((n.repairs-(n.repairStart??0))>=(g.maxRepairs??2)){n.state='held';n.reason='Acceptance repair allowance reached; unresolved checks remain'}
       else this.repair(g,n,round)
      }else if(round.state==='errored'){
       const failure=classifyVerificationFailure(round.error??'Verifier failed',this.now(),n.recoveries)
       if(['transient','quota','protocol'].includes(failure.kind)&&(failure.kind==='protocol'?round.attempts<=2:n.recoveries<5)){
        n.failure??=failure;n.retryAt??=failure.retryAt
        if((n.retryAt??0)<=this.now()){this.retryVerification(round);n.recoveries++;n.retryAt=undefined;n.failure=undefined}
       }else if(failure.kind==='protocol'&&round.checks.some(ch=>ch.verdict==='insufficient')){
        this.host.store.put('goal-verification',round.id,{...round,state:'insufficient'});n.failure=undefined;n.retryAt=undefined
       }else{n.state='held';n.reason='Verification could not be completed: '+round.error}
      }else if(round.state==='stale'){n.state='held';n.reason='Acceptance input changed; reconcile and resume with current requirements'}
      continue
     }
     const report=task.assignments.at(-1)?.report
     if(['blocked','failed'].includes(report?.state??'')){
      if(task.undelivered.length)continue // A queued replacement strategy has not executed yet.
      // A just-finished Worker can still have a Router-inbox report awaiting flush.
      // Let that bounded delivery/turn settle before deciding that replanning is unavailable.
      if(run?.phase==='idle'&&(this.host.activity.list().some(a=>a.ticketId===n.ticketId&&a.state==='running')||this.host.store.deliveries().some(d=>d.ticketId===n.ticketId&&['pending','sending'].includes(d.status))))continue
      const failure=run?.phase==='uncertain'?{kind:'uncertain' as const,reason:run.error??'Execution outcome uncertain'}:classifyGoalFailure(report!.summary,this.now(),n.recoveries)
      n.failure??=failure
      if(['transient','quota'].includes(failure.kind)&&n.recoveries<5){
       if(!this.effectsSettled(n.ticketId))continue
       n.retryAt??=failure.retryAt
       if((n.retryAt??0)<=this.now()){this.host.retry(n.ticketId);n.recoveries++;n.failure=undefined;n.retryAt=undefined}
      }else{n.state='held';n.reason=failure.reason}
     }
    }
    this.save(g)
    let occupied=nodes.filter(n=>['running','verifying'].includes(n.state)).length
    for(const n of nodes){
     if(n.state!=='pending'||occupied>=(g.maxParallel??2)||n.dependsOn.some(id=>nodes.find(d=>d.id===id)?.state!=='passed'))continue
     if(n.teamTargetId){
      if(this.host.delegation.goalTasks.assertTarget(g,n).target.state==='paused'){n.reason='Waiting for the child team to resume intake';this.save(g);continue}
      n.reason=undefined
     }else this.host.replanning.assertWorker(g,n.workerId)
     const dependencies=n.dependsOn.flatMap(id=>{const dep=nodes.find(d=>d.id===id)!;const round=this.host.store.get<VerificationRound>('goal-verification',dep.roundId!)!;return round.snapshot.evidence.filter(e=>e.kind!=='execution')})
     const text=JSON.stringify({objective:g.objective,node:{title:n.title,instruction:n.instruction},criteria:this.host.verification.criteria(g,n),originalAcceptance:g.criteria,authorizationScope:g.contract?.mandate.scope,automationData:this.host.webhooks.inputData(g.triggerId),requirements:this.host.continuity.command({action:'read'},c).requirements,prerequisiteEvidence:dependencies})
     const packet=this.host.memory.build(c,{goalId:g.id,instruction:text},'goal-worker')
     const documentIds=[...new Set([...dependencies.filter(e=>e.kind==='document').map(e=>e.key),...g.criteria.flatMap(cr=>cr.documents??[])])]
     packet.manifest.knowledge=documentIds.flatMap(id=>this.host.knowledge.references(this.host.knowledge.command({action:'read',id},c),c))
     this.host.store.put('context-manifest',packet.manifest.id,packet.manifest);this.host.memory.validate(packet.manifest)
     const result=n.teamTargetId?await this.host.delegation.goalTasks.assign(g,n,c,packet.manifest,text):await this.host.manager.call({action:'assign',id:n.workerId,text,requestId:'goal-node:'+g.id+':'+n.id,revision:this.host.settings.current().revision},{discussion:g.discussion,trigger:c.trigger,scoped:c,manifest:packet.manifest})
     // The command is idempotent and its assignment is durable before this pointer.
     const current=this.get(g.id);if(!current)throw Error('Goal disappeared during dispatch');g=current
     const target=g.nodes!.find(d=>d.id===n.id)!;target.state='running';target.reason=undefined
     if(n.teamTargetId){target.delegationId=result.id;g.delegationIds=[...new Set([...(g.delegationIds??[]),result.id])]}
     else{target.ticketId=result.ticketId;if(!g.taskIds.includes(result.ticketId))g.taskIds.push(result.ticketId)}
     this.save(g);occupied++
    }
    if(!['active','waiting'].includes(g.state))continue
    if(g.nodes!.every(n=>n.state==='passed')){
     const round=this.host.verification.ensure(g);g.finalRoundId=round.id;this.save(g)
     if(round.state==='passed'&&this.host.verification.current(round,g)){
      this.host.store.atomic(()=>{
       this.context(g)
       const latest=this.get(g.id)!;if(!['active','waiting'].includes(latest.state))return
       for(const n of g.nodes!){if(n.teamTargetId)this.host.delegation.goalTasks.accept(g,n,round);else{const d=this.host.store.get<GoalDelivery>('goal-delivery',n.ticketId!)!;this.host.acceptGoalDelivery(d)}}
       if(g.nodes!.some(n=>!n.teamTargetId&&(!this.host.store.tickets.get(n.ticketId!)?.ended||!this.effectsSettled(n.ticketId!))))return
       g.state='completed';g.nextAt=undefined;g.reason=undefined;g.recovery=undefined
       g.checks=g.criteria.map(cr=>{const n=g.nodes!.find(n=>n.criterionIds.includes(cr.id))!;return {criterionId:cr.id,...(n.teamTargetId?{delegationId:n.delegationId!,reportAt:String(round.finishedAt)}:{ticketId:n.ticketId!,reportAt:this.host.store.tickets.get(n.ticketId!)!.assignments.at(-1)!.report!.at}),explanation:'Independent acceptance '+round.id}})
       this.save(g)
       if(g.nodes!.every(n=>n.teamTargetId)){
        const {trigger}=this.anchor(g),id='goal-complete:'+g.id
        if(trigger.channel){this.host.store.put('router-reply-owner',id,{discussion:g.discussion,triggerId:g.triggerId,inputs:[g.triggerId]});this.host.store.outbox.send({id,channel:trigger.channel,kind:'reply',text:'目标「'+g.title+'」已通过独立验收。'})}
       }
      })
     }else if(['failed','insufficient'].includes(round.state)){
      const failedIds=new Set(round.checks.filter(ch=>ch.verdict!=='passed').map(ch=>ch.criterionId))
      const target=g.nodes!.find(n=>n.criterionIds.some(id=>failedIds.has(id)))??g.nodes!.at(-1)!
      if((target.repairs-(target.repairStart??0))<(g.maxRepairs??2))this.repair(g,target,round)
      else{target.state='held';target.reason='Overall goal acceptance did not pass within the repair allowance';target.failure={kind:'quality',reason:target.reason};target.roundId=round.id;this.save(g);if(!this.host.replanning.consider(g)){g.state='held';g.reason=target.reason;this.save(g);this.notice(g,g.reason)}}
     }else if(round.state==='errored'){
      const failure=classifyVerificationFailure(round.error??'Verifier failed',this.now(),g.recoveryAttempts??0)
      if(['transient','quota','protocol'].includes(failure.kind)&&(failure.kind==='protocol'?round.attempts<=2:(g.recoveryAttempts??0)<5)){
       g.recovery??=failure
       if((g.recovery.retryAt??0)<=this.now()){this.retryVerification(round);g.recoveryAttempts=(g.recoveryAttempts??0)+1;g.recovery=undefined}
       this.save(g)
      }else if(failure.kind==='protocol'&&round.checks.some(ch=>ch.verdict==='insufficient')){
       this.host.store.put('goal-verification',round.id,{...round,state:'insufficient'});g.recovery=undefined;this.save(g)
      }else{g.state='held';g.reason='Overall verification requires recovery: '+round.error;this.save(g);this.notice(g,g.reason)}
     }else if(round.state==='stale'){g.state='held';g.reason='Overall verification requires recovery: stale evidence';this.save(g);this.notice(g,g.reason)}
    }else if(g.nodes!.some(n=>n.state==='held')&&!g.nodes!.some(n=>['running','verifying'].includes(n.state)||n.state==='pending'&&n.dependsOn.every(id=>g.nodes!.find(d=>d.id===id)?.state==='passed'))){
     if(this.host.replanning.consider(g))continue
     g.state='held';g.reason=g.nodes!.filter(n=>n.state==='held').map(n=>n.title+': '+n.reason).join('; ');this.save(g);this.notice(g,g.reason)
    }
   }catch(error){const latest=this.get(g.id);if(latest&&['active','waiting'].includes(latest.state)){g={...latest,state:'held',reason:String(error),nextAt:undefined};this.save(g);this.notice(g,g.reason!)}}
  }
 }
 command(value:unknown,c:ScopeContext,manifest?:ContextManifest):any{
  this.host.scopes.assertCurrent(c);const x=goalCommandSchema.parse(value)
  if(x.action==='list')return {items:this.list(c)}
  if(x.action==='inspect'){const goal=this.list(c).find(g=>g.id===x.id);if(!goal||!this.sourcesValid(goal))throw Error('Goal unavailable');return {goal,replanning:this.host.replanning.list(goal),attempts:this.host.store.list<{goalId:string}>('goal-verification-attempt').filter(a=>a.goalId===goal.id),rounds:this.host.store.list<VerificationRound>('goal-verification').filter(r=>r.goalId===goal.id).map(({snapshot,...round})=>({...round,evidence:snapshot.evidence.map(({content,...e})=>e)}))}}
  if(x.action!=='start'&&(x.objective!==undefined||x.criteria!==undefined)&&this.rawList(c).find(g=>g.id===x.id)?.contract)throw Error('Original goal objective and acceptance criteria are immutable; use a new explicitly authorized goal')
  if(x.nodes&&x.action!=='start')throw Error('Direct graph replacement is not allowed; failure-driven plans require independent review')
  if(!x.operationId||x.expectedRevision===undefined)throw Error('Goal mutation requires operationId and expectedRevision')
  const human=c.trigger.human&&this.host.routerIngress.authority(c.trigger.id).strength==='explicit'
  const automation=x.action==='start'&&this.host.webhooks?.approvedStart(x,c)
  if(!human&&!automation&&this.wake(c.trigger.id)?.goalId!==x.id)throw Error('Autonomous input may only change its own goal')
  if(['start','pause','resume','cancel'].includes(x.action)||x.maxTurns!==undefined||x.maxParallel!==undefined||x.maxRepairs!==undefined||x.maxReplans!==undefined||x.nodes!==undefined)if(!human&&!automation)throw Error('This goal change requires a current explicit human input')
  const store=this.host.store,key=stableDigest([c.route.scopeId,c.route.entryId,c.actor,x.operationId]),fingerprint=stableDigest(x)
  return store.atomic(()=>{
   const receipt=store.get<any>('goal-receipt',key)
   if(receipt){if(receipt.fingerprint!==fingerprint)throw Error('operationId reused with different content');const current=this.list(c).find(g=>g.id===receipt.goalId);if(!current)throw Error('Goal receipt unavailable');return current}
   let g=x.id?this.rawList(c).find(g=>g.id===x.id):undefined
   if((g?.revision??0)!==x.expectedRevision)throw Error('Goal revision conflict')
   if(x.action==='start'){
    if(g||!x.title||!x.objective||!x.criteria||!x.authorizationQuote||!c.trigger.text.includes(x.authorizationQuote))throw Error('New goal needs explicit source quote, objective and acceptance criteria')
    if(this.forInput(c.trigger.id))throw Error('This input already owns a goal; update it instead')
    if(new Set(x.criteria.map(c=>c.id)).size!==x.criteria.length||x.criteria.some(c=>c.id==='__goal__'))throw Error('Criterion IDs must be unique and not reserved')
    validateGraph(x.nodes??[],x.criteria)
    for(const n of x.nodes??[])if(n.workerId&&!this.host.scopes.scope(c.route.scopeId).workerIds.includes(n.workerId))throw Error('Goal Worker is outside scope')
    const remoteIds=(x.nodes??[]).flatMap(n=>n.teamTargetId?[n.teamTargetId]:[]),teamTargets=this.host.delegation.goalTasks.capture(c,remoteIds)
    for(const n of x.nodes??[])if(n.teamTargetId)this.host.delegation.goalTasks.artifacts({criteria:x.criteria},{...n,state:'pending',repairs:0,recoveries:0})
    if(remoteIds.length)store.db.exec('PRAGMA user_version='+Math.max(DELEGATED_GOALS_DB_SCHEMA,Number(store.db.prepare('PRAGMA user_version').get()!.user_version)))
    g={id:'goal-'+key,scopeId:c.route.scopeId,entryId:c.route.entryId,discussion:c.route.discussion,actor:c.actor,triggerId:c.trigger.id,bindingRevision:this.host.scopes.binding(c.route.entryId).revision,revision:0,title:x.title,objective:x.objective,criteria:x.criteria,plan:x.plan??[],state:'active',taskIds:[],nextAction:x.nextAction??'Plan and execute the next unfinished step',nextAt:this.now()+60000,turns:0,maxTurns:x.maxTurns??200,failures:0,lastFingerprint:stableDigest([]),at:this.now(),nodes:x.nodes?.map(n=>({...n,state:'pending',repairs:0,recoveries:0})),maxParallel:x.maxParallel??2,maxRepairs:x.maxRepairs??2,managed:!!x.nodes,maxReplans:x.maxReplans??2,replans:0,planRevision:0,contract:{objective:x.objective,criteria:x.criteria,triggerId:c.trigger.id,triggerHash:stableDigest(c.trigger),mandate:this.host.routerIngress.authority(c.trigger.id),workerIds:[...this.host.scopes.scope(c.route.scopeId).workerIds],backendIds:[...this.host.scopes.scope(c.route.scopeId).backendIds],...this.host.webhooks?.permissions(c.trigger.id),...(teamTargets.length?{teamTargets}:{})}}
   }else if(!g)throw Error('Goal unavailable')
   if(!this.sourcesValid(g)&&!['pause','cancel'].includes(x.action)){
    if(g.nodes?.length)throw Error('Changed structured goal sources require a new explicitly authorized goal; prior node instructions cannot be reused')
    if(x.action!=='resume'||!x.objective||!x.title||!x.criteria||!x.authorizationQuote||!c.trigger.text.includes(x.authorizationQuote))throw Error('Changed goal sources require resume with a fresh explicit objective, title and criteria')
    g={...g,title:x.title,objective:x.objective,criteria:x.criteria,plan:x.plan??[],checks:undefined,contextIds:[]}
   }
   if(g.state==='completed'&&x.action==='complete')return this.list(c).find(item=>item.id===g!.id)
   if(terminal.has(g.state))throw Error('Ended goal requires a new explicit goal')
   if(x.action==='complete'){
    if(!x.checks||g.criteria.some(cr=>x.checks!.filter(ch=>ch.criterionId===cr.id).length!==1)||x.checks.length!==g.criteria.length)throw Error('Every acceptance criterion needs one verification')
    const round=g.finalRoundId?store.get<VerificationRound>('goal-verification',g.finalRoundId):undefined
    if(!round||round.state!=='passed'||!this.host.verification.current(round,g))throw Error('Independent goal acceptance has not passed; Worker ready reports cannot complete this goal')
    throw Error('The host settles verified goals automatically')
   }else if(x.action==='pause'||x.action==='cancel'){
    g={...g,state:x.action==='pause'?'paused':'cancelled',nextAt:undefined,reason:x.reason??'User requested '+x.action}
    if(x.action==='pause'&&store.list<import('./delegation/manager.ts').OutboundTask>('delegation-outbound').some(t=>t.goal?.goalId===g!.id&&t.desired==='running'&&!['ready','cancelled'].includes(t.remote?.state??'unknown')))throw Error('Remote execution pause is unsupported; cancel the goal or wait for the candidate before pausing verification')
    if(x.action==='cancel')this.host.delegation.goalTasks.cancel(g.id)
    if(x.action==='cancel')for(const ticketId of g.taskIds)if(!store.tickets.get(ticketId)?.ended){this.host.scopes.checkTask(ticketId,c,true);this.host.engine.stopTicket(ticketId,'Goal cancelled by user')}
   }else if(x.action==='wait'){
    if(!x.reason)throw Error('Waiting needs a concrete reason')
    g={...g,state:x.needsHuman?'needs_input':'waiting',reason:x.reason,nextAt:x.needsHuman?undefined:this.now()+(x.wakeAfterSeconds??60)*1000}
   }else{
    if(x.action==='resume'){
     // A human may resume an automation, but cannot silently turn its machine
     // identity into a new human anchor or bypass an expired/revoked grant.
     const automationOrigin=g.contract?.triggerId&&this.host.webhooks.ownsTrigger(g.contract.triggerId)?g.contract.triggerId:undefined
     if(automationOrigin)this.host.routerIngress.authority(automationOrigin)
     g.replanId=undefined
     for(const id of [g.finalRoundId,...(g.nodes??[]).map(n=>n.roundId)].filter((id):id is string=>!!id)){const round=store.get<VerificationRound>('goal-verification',id);if(round?.state==='errored'){store.put('goal-verification',id,{...round,state:'pending',error:undefined,finishedAt:undefined});store.jobState('goal-verify:'+id,'pending')}}
     g={...g,triggerId:automationOrigin??c.trigger.id,bindingRevision:this.host.scopes.binding(c.route.entryId).revision,failures:0,turns:0,recovery:undefined,recoveryAttempts:0,nodes:g.nodes?.map(n=>n.state==='held'?{...n,state:n.ticketId||n.delegationId?'running' as const:'pending' as const,reason:undefined,retryAt:undefined,recoveries:0,failure:undefined}:n)}
    }
    g={...g,state:'active',reason:undefined,nextAt:this.now()+(x.wakeAfterSeconds??60)*1000}
   }
   g={...g,revision:g.revision+1,plan:x.plan??g.plan,nextAction:x.nextAction??g.nextAction,maxTurns:x.maxTurns??g.maxTurns,maxParallel:x.maxParallel??g.maxParallel,maxRepairs:x.maxRepairs??g.maxRepairs,maxReplans:x.maxReplans??g.maxReplans,contextIds:[...new Set([...(g.contextIds??[]),...(manifest?[manifest.id]:[])])]}
   store.put('router-goal',g.id,g);store.put('goal-receipt',key,{scopeId:g.scopeId,entryId:g.entryId,triggerId:c.trigger.id,goalId:g.id,fingerprint,result:g})
   return this.list(c).find(item=>item.id===g.id)!
  })
 }
}
