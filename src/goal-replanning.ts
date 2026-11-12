import {z} from 'zod'
import type {Runtime} from './runtime.ts'
import type {RouterGoal} from './router-goals.ts'
import type {Mandate,Ticket} from './vendor/dsh-core/index.ts'
import {checkProjectGraph} from './project-code.ts'
import {validateGraph,classifyGoalFailure,evidencePath,type GoalCriterion,type GoalNode} from './goal-contract.ts'
import {stableDigest} from './sources.ts'
import {scopeBudget} from './context-budget.ts'
import {inlineEvidenceBudget,evidenceAccess,type GoalEvidence} from './goal-evidence.ts'
import {allowNewTaskInputs} from './task-context.ts'
import {workerProfiles} from './worker-pool.ts'
import type {ContextManifest} from './router-memory.ts'
import {BackendRegistry} from './backends/registry.ts'
import {agentOptionsSchema} from './backend-config.ts'
import {mergeOptions} from './agent-options.ts'
import {workerSpecs} from './worker-tools.ts'

export interface GoalContract {skill?:{id:string;version:number};objective:string;criteria:GoalCriterion[];triggerId:string;triggerHash:string;mandate:Mandate;workerIds:string[];backendIds:string[];teamTargets?:{id:string;policyHash:string}[]}
export class ReplanningInterrupted extends Error {}
const id=z.string().min(1).max(200),instruction=z.string().min(1).max(16000)
const change=z.object({id,instruction,dependsOn:z.array(id).max(100)}).strict()
const addition=z.object({id,title:z.string().min(1).max(300),instruction,workerId:id,dependsOn:z.array(id).max(100),derivedFrom:id,supports:z.array(id).min(1).max(50),outputs:z.array(evidencePath).min(1).max(20)}).strict()
export const replanProposalSchema=z.object({reason:z.string().min(1).max(4000),evidenceIds:z.array(id).min(1).max(200),changes:z.array(change).min(1).max(100),additions:z.array(addition).max(20)}).strict()
type Proposal=z.infer<typeof replanProposalSchema>
const reviewSchema=z.object({approved:z.boolean(),explanation:z.string().min(1).max(4000),evidenceIds:z.array(id).min(1).max(200)}).strict()
interface WorkerCapability {id:string;backend:string;tools:string[];sandboxDriver:string;network:boolean;sourceSandbox:string}
interface ReplanSnapshot {contract:GoalContract;goalRevision:number;planRevision:number;nodes:GoalNode[];failureNodeIds:string[];evidence:GoalEvidence[];workerCapabilities?:WorkerCapability[]}
export interface ReplanRound {id:string;goalId:string;scopeId:string;entryId:string;triggerId:string;state:'pending'|'planning'|'reviewing'|'approved'|'applied'|'rejected'|'errored'|'stale';snapshot:ReplanSnapshot;snapshotHash:string;proposal?:Proposal;review?:z.infer<typeof reviewSchema>;error?:string;plannerThread?:string;reviewerThread?:string;contextIds?:string[];at:number;appliedAt?:number}
const activeStates=new Set(['pending','planning','reviewing','approved'])
const strings={type:'array',items:{type:'string'}}
const proposalOutput={type:'object',properties:{reason:{type:'string'},evidenceIds:strings,changes:{type:'array',items:{type:'object',properties:{id:{type:'string'},instruction:{type:'string'},dependsOn:strings},required:['id','instruction','dependsOn'],additionalProperties:false}},additions:{type:'array',items:{type:'object',properties:{id:{type:'string'},title:{type:'string'},instruction:{type:'string'},workerId:{type:'string'},dependsOn:strings,derivedFrom:{type:'string'},supports:strings,outputs:strings},required:['id','title','instruction','workerId','dependsOn','derivedFrom','supports','outputs'],additionalProperties:false}}},required:['reason','evidenceIds','changes','additions'],additionalProperties:false}
const reviewOutput={type:'object',properties:{approved:{type:'boolean'},explanation:{type:'string'},evidenceIds:strings},required:['approved','explanation','evidenceIds'],additionalProperties:false}

/** Plans may change implementation, never the retained authorization or acceptance contract. */
export class GoalReplanning {
 constructor(private host:Runtime,private now:()=>number=Date.now){}
 /** Project an approved node strategy into execution without rewriting the audit mandate. */
 executionView(ticket:Ticket):Ticket {
  const dispatches=this.host.store.list<{ticketId:string;goalId:string;replanId:string}>('goal-plan-dispatch').filter(d=>d.ticketId===ticket.id)
  if(!dispatches.length)return ticket
  const rounds=dispatches.map(d=>({d,r:this.host.store.get<ReplanRound>('goal-replan',d.replanId)})).sort((a,b)=>(b.r?.snapshot.planRevision??-1)-(a.r?.snapshot.planRevision??-1))
  const {d,r}=rounds[0]!,g=this.host.goals.get(d.goalId),n=g?.nodes?.find(n=>n.ticketId===ticket.id)
  if(!g||!n||ticket.ended||!['active','waiting'].includes(g.state)||!r||r.goalId!==g.id||r.state!=='applied'||!r.review?.approved||!r.proposal)throw Error('Reviewed execution strategy is unavailable')
  const contract=this.contract(g),c=this.host.goals.context(g)
  this.host.scopes.checkTask(ticket.id,c,true);this.assertWorker(g,n.workerId)
  const before=r.snapshot.nodes.find(x=>x.id===n.id&&x.ticketId===ticket.id),edit=r.proposal.changes.find(x=>x.id===n.id)
  if(!before||stableDigest(contract)!==stableDigest(r.snapshot.contract)||n.instruction!==(edit?.instruction??before.instruction)||stableDigest(n.dependsOn)!==stableDigest(edit?.dependsOn??before.dependsOn)||stableDigest(n.criterionIds)!==stableDigest(before.criterionIds)||n.workerId!==before.workerId)throw Error('Reviewed execution strategy changed')
  const scope=JSON.stringify({kind:'reviewed_goal_step',goalId:g.id,replanId:r.id,planRevision:r.snapshot.planRevision+1,objective:contract.objective,node:{id:n.id,title:n.title,instruction:n.instruction},criteria:this.host.verification.criteria(g,n),originalAcceptance:contract.criteria,authorizationScope:contract.mandate.scope,requirements:this.host.continuity.command({action:'read'},c).requirements,notice:'This is the current independently approved node mandate. It supersedes earlier node implementation instructions in retained history, including file restrictions within the original authorizationScope. The original user authorization, objective, acceptance criteria and tool permissions remain binding. Inspect retained effects before acting; do not repeat completed work blindly.'})
  if(Buffer.byteLength(scope)>this.host.scopes.scope(g.scopeId).contextBytes)throw Error('Reviewed execution strategy exceeds context budget')
  return {...ticket,mandate:{...ticket.mandate,scope}}
 }
 active(g:RouterGoal){return !!g.replanId&&activeStates.has(this.host.store.get<ReplanRound>('goal-replan',g.replanId)?.state??'')}
 contexts(goalId:string){return this.host.store.list<ReplanRound>('goal-replan').filter(r=>r.goalId===goalId).flatMap(r=>r.contextIds??[])}
 list(g:RouterGoal){this.host.goals.context(g);return this.host.store.list<ReplanRound>('goal-replan').filter(r=>r.goalId===g.id).map(({snapshot,...r})=>(r.contextIds??[]).every(id=>this.host.continuity.validContext(id))?({...r,planRevision:snapshot.planRevision,contractHash:stableDigest(snapshot.contract),failureNodeIds:snapshot.failureNodeIds}):({id:r.id,goalId:r.goalId,state:'stale',at:r.at,error:'Replanning sources changed; derived content is unavailable'}))}
 assertWorker(g:RouterGoal,workerId:string|undefined){
  if(!workerId)throw Error('A local Worker target is required')
  const c=g.contract;if(!c)return
  const worker=workerProfiles(this.host.config).find(w=>w.id===workerId),scope=this.host.scopes.scope(g.scopeId)
  if(!worker||!c.workerIds.includes(workerId)||!scope.workerIds.includes(workerId)||!c.backendIds.includes(worker.backend)||!scope.backendIds.includes(worker.backend))throw Error('Plan Worker or backend exceeds original authorization')
 }
 private contract(g:RouterGoal){
  this.host.goals.context(g)
  const c=g.contract,t=c&&this.host.store.triggers.get(c.triggerId)
  if(!c||!t||stableDigest(t)!==c.triggerHash||stableDigest({objective:g.objective,criteria:g.criteria})!==stableDigest({objective:c.objective,criteria:c.criteria}))throw Error('Original goal contract changed or is unavailable')
  if(stableDigest(this.host.routerIngress.authority(c.triggerId))!==stableDigest(c.mandate))throw Error('Original goal authorization changed')
  return c
 }
 private snapshot(g:RouterGoal,includeCapabilities=true):ReplanSnapshot {
  const contract=this.contract(g)
  if(!g.managed||!g.nodes?.length||!['active','waiting'].includes(g.state))throw Error('Goal cannot autonomously replan in its current state')
  if(g.taskIds.some(id=>this.host.store.tickets.get(id)?.ended))throw Error('Stopped or ended tasks cannot be revived by replanning')
  const trigger=this.host.store.triggers.get(contract.triggerId)!,source=this.host.sources.get(trigger.source)!.config,scope=this.host.scopes.scope(g.scopeId)
  const workerCapabilities=includeCapabilities?workerProfiles(this.host.config).filter(w=>contract.workerIds.includes(w.id)&&scope.workerIds.includes(w.id)&&contract.backendIds.includes(w.backend)&&scope.backendIds.includes(w.backend)).map(w=>{
   const defaults=this.host.model instanceof BackendRegistry?this.host.model.definition(w.backend).defaults:undefined
   const profile=agentOptionsSchema.parse(Object.fromEntries(Object.entries(w).filter(([key])=>key in agentOptionsSchema.shape)))
   const options=agentOptionsSchema.parse(mergeOptions(defaults,profile))
   return {id:w.id,backend:w.backend,tools:workerSpecs.filter(t=>!options.tools||options.tools.includes(t.name)).map(t=>t.name).sort(),sandboxDriver:this.host.config.work.sandboxDriver,network:this.host.config.work.network,sourceSandbox:source.sandbox}
  }).sort((a,b)=>a.id.localeCompare(b.id)):undefined
  return {contract,goalRevision:g.revision,planRevision:g.planRevision??0,nodes:g.nodes,failureNodeIds:g.nodes.filter(n=>n.state==='held').map(n=>n.id),evidence:this.host.verification.failureEvidence(g),...(workerCapabilities?{workerCapabilities}:{})}
 }
 private current(r:ReplanRound){
  const g=this.host.goals.get(r.goalId)
  if(!g||g.replanId!==r.id||stableDigest(this.snapshot(g,r.snapshot.workerCapabilities!==undefined))!==r.snapshotHash)throw Error('Replanning input, goal state, Worker capabilities or authority changed')
  return g
 }
 consider(g:RouterGoal):boolean {
  // Remote contracts are immutable and have no safe amendment/resume protocol yet.
  // Retain a failed mixed graph for explicit review instead of duplicating effects.
  if(g.nodes?.some(n=>n.teamTargetId))return false
  if(!g.contract||(g.replans??0)>=(g.maxReplans??(g.project?.policy.budget?Infinity:0))||g.replanId)return false
  const failures=g.nodes?.filter(n=>n.state==='held')??[]
  if(!failures.length)return false
  for(const n of failures){
   const task=n.ticketId?this.host.store.tickets.get(n.ticketId):undefined
   if(!task||task.ended||!this.host.goals.effectsSettled(task.id))return false
   const delivery=n.ticketId?this.host.store.get<{id:string}>('goal-delivery',n.ticketId):undefined
   if(g.project&&delivery&&this.host.projectCode.receipt(delivery.id)?.error)continue
   const round=n.roundId?this.host.store.get<any>('goal-verification',n.roundId):undefined
   if(round&&['failed','insufficient'].includes(round.state))continue
   const report=task.assignments.at(-1)?.report
   if(!report||!['blocked','failed'].includes(report.state))return false
   const failure=classifyGoalFailure(report.summary,this.now(),0)
   if(failure.kind!=='quality'&&!(failure.kind==='environment'&&/not installed|command not found|ENOENT/i.test(report.summary)&&!/permission|credential|unauthori|forbidden|revoked/i.test(report.summary)))return false
  }
  if(g.taskIds.some(id=>!this.host.goals.effectsSettled(id)))return false
  const snapshot=this.snapshot(g),snapshotHash=stableDigest(snapshot),id='replan-'+stableDigest([g.id,snapshotHash])
  this.host.store.atomic(()=>{
   if(this.host.store.get('goal-replan',id))return
   this.host.store.put('goal-replan',id,{id,goalId:g.id,scopeId:g.scopeId,entryId:g.entryId,triggerId:g.triggerId,state:'pending',snapshot,snapshotHash,at:this.now()} satisfies ReplanRound)
   this.host.store.put('router-goal',g.id,{...g,replanId:id,nextAction:'Review failure evidence and revise the execution plan'})
   this.host.store.enqueue('goal-replan:'+id,'goal-replan',{roundId:id,goalId:g.id,triggerId:g.triggerId,discussion:g.discussion})
  })
  return true
 }
 private candidate(g:RouterGoal,r:ReplanRound,p:Proposal){
  const nodes=structuredClone(g.nodes!),byId=new Map(nodes.map(n=>[n.id,n])),affected=new Set(r.snapshot.failureNodeIds)
  let grew=true;while(grew){grew=false;for(const n of nodes)if(!affected.has(n.id)&&n.dependsOn.some(id=>affected.has(id))){affected.add(n.id);grew=true}}
  if(new Set(p.changes.map(n=>n.id)).size!==p.changes.length)throw Error('Duplicate plan change')
  for(const edit of p.changes){const n=byId.get(edit.id);if(!n||!affected.has(n.id))throw Error('Only failed work and its dependents may change');n.instruction=edit.instruction;n.dependsOn=edit.dependsOn}
  const additions=p.additions.map(a=>{
   if(byId.has(a.id)||!affected.has(a.derivedFrom))throw Error('New steps must derive from affected work and have unique IDs')
   const parent=byId.get(a.derivedFrom)!,supported=parent.criterionIds.length?parent.criterionIds:parent.supports??[]
   if(a.supports.some(id=>!supported.includes(id)))throw Error('New step exceeds its parent acceptance scope')
   this.assertWorker(g,a.workerId)
   if(a.outputs.some(path=>path.startsWith('/')||/^[a-z]:/i.test(path)||path.split(/[\\/]/).some(s=>s==='..')))throw Error('Intermediate artifacts must stay in the workspace')
   return {...a,criterionIds:[],state:'pending' as const,repairs:0,recoveries:0}
  })
  nodes.push(...additions)
  if(nodes.length>100)throw Error('Replanned graph exceeds 100 nodes')
  validateGraph(nodes,g.criteria)
  checkProjectGraph(g,nodes)
  const ancestors=(id:string,seen=new Set<string>()):Set<string>=>{for(const dep of nodes.find(n=>n.id===id)!.dependsOn)if(!seen.has(dep)){seen.add(dep);ancestors(dep,seen)}return seen}
  for(const n of additions)if(!ancestors(n.derivedFrom).has(n.id))throw Error('Intermediate step must contribute to its original parent')
  const shape=(ns:GoalNode[])=>ns.map(n=>({id:n.id,instruction:n.instruction,dependsOn:n.dependsOn,workerId:n.workerId,criterionIds:n.criterionIds,supports:n.supports,outputs:n.outputs}))
  const hash=stableDigest(shape(nodes))
  if(hash===stableDigest(shape(g.nodes!))||this.host.store.list<ReplanRound>('goal-replan').some(old=>old.goalId===g.id&&old.state==='applied'&&old.proposal&&stableDigest(shape(old.snapshot.nodes))===hash))throw Error('Replanning must change the failed strategy')
  for(const id of r.snapshot.failureNodeIds)if(!p.changes.some(n=>n.id===id))throw Error('Every failed node needs an explicit revised strategy')
  return {nodes,affected}
 }
 private requireEvidence(ids:string[],read:Set<string>,r:ReplanRound){
  if(ids.some(id=>!read.has(id))||r.snapshot.evidence.some(e=>!read.has(e.id)||!ids.includes(e.id)))throw Error('Replanning must inspect and cite all retained failure evidence')
 }
 async perform(id:string){
  let r=this.host.store.get<ReplanRound>('goal-replan',id);if(!r||!activeStates.has(r.state))return
  const save=(patch:Partial<ReplanRound>)=>{r={...r!,...patch};this.host.store.put('goal-replan',id,r)}
  try{
   let g=this.current(r)
   const run=async(mode:'plan'|'review')=>{
    // Old persisted rounds did not carry this field. Preserve their original
    // snapshot hash while checking a fresh capability view around each call.
    const capabilities=r!.snapshot.workerCapabilities??this.snapshot(g).workerCapabilities!
    const modelInput={kind:mode==='plan'?'goal_replanning':'goal_plan_review',contract:r!.snapshot.contract,originalRequest:this.host.store.triggers.get(r!.snapshot.contract.triggerId)!.text,planRevision:r!.snapshot.planRevision,replanningPolicy:{samePlanRepairsPerNode:g.maxRepairs??2,successfulReplansUsed:g.replans??0,maxSuccessfulReplans:g.maxReplans??(g.project?.policy.budget?'within project budget':0),stoppedTasksAllowed:false},workerCapabilities:capabilities,nodes:r!.snapshot.nodes,failedNodeIds:r!.snapshot.failureNodeIds,evidence:r!.snapshot.evidence.map(({content,...meta})=>meta),requiredEvidenceIds:r!.snapshot.evidence.map(e=>e.id),...(mode==='review'?{proposal:r!.proposal}:{})}
    const access=evidenceAccess(r!.snapshot.evidence,scopeBudget(this.host.scopes.scope(g.scopeId).contextBytes).toolReserveBytes,()=>{this.current(r!)},inlineEvidenceBudget(modelInput,this.host.goalEvidenceBudget(g)))
    const result=await this.host.runGoalPlanner(g,r!,mode,{input:access.input(modelInput),schema:mode==='plan'?proposalOutput:reviewOutput,tools:access.tools,onTool:access.onTool})
    this.current(r!)
    access.confirmInline()
    if(!r!.snapshot.workerCapabilities&&stableDigest(this.snapshot(g).workerCapabilities)!==stableDigest(capabilities))throw Error('Worker capabilities changed during legacy plan review')
    save({contextIds:[...new Set([...(r!.contextIds??[]),result.contextId])]})
    return {result,read:access.read}
   }
   if(!r.proposal){save({state:'planning'});const {result,read}=await run('plan'),proposal=replanProposalSchema.parse(JSON.parse(result.text));this.requireEvidence(proposal.evidenceIds,read,r);this.candidate(g,r,proposal);save({state:'reviewing',proposal,plannerThread:result.threadId})}
   if(!r.review){const {result,read}=await run('review'),review=reviewSchema.parse(JSON.parse(result.text));this.requireEvidence(review.evidenceIds,read,r);save({review,reviewerThread:result.threadId,state:review.approved?'approved':'rejected'})}
   if(!r.review!.approved){this.hold(g,'Independent plan review rejected the proposed strategy: '+r.review!.explanation);return}
   g=this.current(r)
   const {nodes,affected}=this.candidate(g,r,r.proposal!)
   this.host.store.atomic(()=>{
    this.current(r!)
    if(this.host.store.get<ReplanRound>('goal-replan',id)?.state==='applied')return
    for(const n of nodes)if(affected.has(n.id)){
     if(n.ticketId){this.host.store.db.prepare("DELETE FROM records WHERE kind='goal-delivery' AND id=?").run(n.ticketId);n.state='waiting_dependency';n.refreshFrom=id}
     else n.state='pending'
     n.roundId=undefined;n.reason=undefined;n.failure=undefined;n.retryAt=undefined;n.repairStart=n.repairs;n.recoveries=0
    }
    const next={...g,nodes,revision:g.revision+1,planRevision:(g.planRevision??0)+1,replans:(g.replans??0)+1,replanId:undefined,finalRoundId:undefined,recovery:undefined,reason:undefined,state:'active' as const,nextAction:r!.proposal!.reason,contextIds:[...new Set([...(g.contextIds??[]),...(r!.contextIds??[])])]}
    this.host.store.put('router-goal',g.id,next);save({state:'applied',appliedAt:this.now()})
   })
  }catch(error){
   if(error instanceof ReplanningInterrupted)return false // Read-only reasoning can safely resume after host restart.
   const g=this.host.goals.get(r.goalId),reason=String(error).slice(0,1500)
   save({state:/changed|unavailable|current state|revoked|cannot be revived/.test(reason)?'stale':'errored',error:reason})
   if(g?.replanId===r.id&&['active','waiting'].includes(g.state))this.hold(g,'Autonomous replanning could not be accepted: '+reason)
  }
 }
 private hold(g:RouterGoal,reason:string){const latest=this.host.goals.get(g.id);if(!latest||!['active','waiting'].includes(latest.state))return;const next={...latest,state:'held' as const,reason};this.host.store.put('router-goal',g.id,next);this.host.goals.notice(next,'Autonomous replanning is unresolved; inspect the goal and currently available evidence for details.')}
 /** Dispatch a changed existing node only after all newly required prerequisites pass. */
 resumeNode(g:RouterGoal,n:GoalNode){
  const r=n.refreshFrom?this.host.store.get<ReplanRound>('goal-replan',n.refreshFrom):undefined
  if(!r||r.state!=='applied')return false
  const c=this.host.goals.context(g),task=this.host.store.tickets.get(n.ticketId!)!
  this.host.scopes.checkTask(task.id,c,true)
  if(task.ended||!this.host.goals.effectsSettled(task.id))throw Error('Replanned task must retain settled open execution')
  const dependencies=n.dependsOn.flatMap(id=>{const dep=g.nodes!.find(d=>d.id===id)!,round=this.host.store.get<any>('goal-verification',dep.roundId!);return round.snapshot.evidence.filter((e:GoalEvidence)=>e.kind!=='execution')})
  const text=JSON.stringify({kind:'replanned_step',reason:r.proposal!.reason,instruction:n.instruction,originalObjective:g.objective,originalAcceptance:g.criteria,prerequisiteEvidence:dependencies,notice:'This host-authorized note supersedes only the earlier implementation strategy after independent review. Original objective, authorization and acceptance remain binding. Inspect previous effects before acting.'})
  if(Buffer.byteLength(text)>this.host.scopes.scope(g.scopeId).contextBytes)throw Error('Replanned task evidence exceeds context budget')
  this.host.store.atomic(()=>{
   const key=stableDigest([r.id,n.id]);if(this.host.store.get('goal-plan-dispatch',key))return
   const previous=task.inputs.map(i=>i.id);this.host.scopes.noteInput(task.id,c);this.host.memory.moveTaskContext(task.id,c)
   const saved=this.host.store.get<{manifest:ContextManifest}>('task-context',task.id)
   if(saved){
    const manifest=structuredClone(saved.manifest),documents=[...new Set([...dependencies.filter(e=>e.kind==='document').map(e=>e.key),...g.criteria.flatMap(cr=>cr.documents??[])])]
    const references=documents.flatMap(id=>this.host.knowledge.references(this.host.knowledge.command({action:'read',id},c),c))
    manifest.knowledge=[...(manifest.knowledge??[]),...references].filter((ref,i,all)=>all.findIndex(x=>x.documentId===ref.documentId&&x.revision===ref.revision)===i)
    this.host.memory.validate(manifest);this.host.store.put('task-context',task.id,{manifest})
   }
   // The core intentionally holds automated notes after a blocked report. Only this
   // independently approved, scoped recovery may release that implementation hold.
   this.host.engine.report(task.id,{state:'waiting',summary:'Independent replanning approved; continue with the revised implementation',question:null})
   this.host.engine.note(task.id,text);allowNewTaskInputs(this.host.store,task.id,previous)
   n.state='running';n.refreshFrom=undefined;this.host.store.put('router-goal',g.id,g)
   this.host.store.put('goal-plan-dispatch',key,{id:key,goalId:g.id,scopeId:g.scopeId,entryId:g.entryId,triggerId:g.triggerId,ticketId:task.id,replanId:r.id,at:this.now()})
  })
  return true
 }
}
