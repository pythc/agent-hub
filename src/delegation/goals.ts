import type {Runtime} from '../runtime.ts'
import type {ScopeContext} from '../router-scope.ts'
import type {ContextManifest} from '../router-memory.ts'
import type {RouterGoal} from '../router-goals.ts'
import type {GoalNode} from '../goal-contract.ts'
import type {GoalEvidence} from '../goal-evidence.ts'
import type {VerificationRound} from '../goal-verification.ts'
import {stableDigest} from '../sources.ts'
import {contractSchema,requireDelegation} from './contract.ts'
import type {Delegations,OutboundTask} from './manager.ts'

export interface GoalDelegationRef {goalId:string;nodeId:string;nodeHash:string;policyHash:string}
export interface DelegationBinding {delegationId:string;contractHash:string;candidateHash:string}

/** Remote nodes retain real delegation handles; they never create local Worker tickets. */
export class DelegatedGoals {
 constructor(private host:Runtime,private manager:Delegations){}
 private policy(id:string){
  requireDelegation(this.manager.enabled,'delegation_disabled',409)
  const target=this.host.config.execution.teamTargets?.find(t=>t.id===id)
  const connection=target&&this.host.store.get<any>('delegation-connection',target.connectionId)
  requireDelegation(target&&connection?.active,'team_target_unavailable',403)
  return {target,hash:stableDigest({id:target.id,connectionId:target.connectionId,permissions:target.permissions,limits:target.limits,grantId:connection.grantId})}
 }
 capture(c:ScopeContext,ids:string[]){
  return [...new Set(ids)].map(id=>{
   requireDelegation(this.host.scopes.scope(c.route.scopeId).teamTargetIds?.includes(id),'team_target_not_authorized',403)
   const {target,hash}=this.policy(id)
   requireDelegation(target.state==='enabled','team_target_intake_paused',409)
   return {id,policyHash:hash}
  })
 }
 artifacts(g:Pick<RouterGoal,'criteria'>,n:GoalNode){
  const criteria=n.criterionIds.length?g.criteria.filter(c=>n.criterionIds.includes(c.id)):[]
  return contractSchema.shape.artifacts.parse([...new Set([...criteria.flatMap(c=>[...c.files,...(c.check?[c.check.path]:[])]),...(n.outputs??[])])])
 }
 private nodeHash(n:GoalNode){return stableDigest({id:n.id,teamTargetId:n.teamTargetId,instruction:n.instruction,criterionIds:n.criterionIds,dependsOn:n.dependsOn,supports:n.supports,outputs:n.outputs})}
 assertTarget(g:RouterGoal,n:GoalNode){
  const context=this.host.goals.context(g),id=n.teamTargetId
  requireDelegation(id&&this.host.scopes.scope(context.route.scopeId).teamTargetIds?.includes(id),'team_target_not_authorized',403)
  const policy=this.policy(id),retained=g.contract?.teamTargets?.find(t=>t.id===id)
  requireDelegation(retained?.policyHash===policy.hash,'goal_team_policy_changed',403)
  return policy
 }
 async assign(g:RouterGoal,n:GoalNode,c:ScopeContext,manifest:ContextManifest,text:string){
  const {target,hash}=this.assertTarget(g,n)
  requireDelegation(['active','waiting'].includes(this.host.goals.get(g.id)?.state??''),'goal_no_longer_running',409)
  const acceptance=JSON.stringify(this.host.verification.criteria(g,n)),artifacts=this.artifacts(g,n)
  // Recover the durable binding even if the host stopped before saving the node
  // pointer and an explicit resume subsequently changed the Router trigger ID.
  const prior=this.host.store.db.prepare("SELECT body FROM records WHERE kind='delegation-outbound' AND json_extract(body,'$.goal.goalId')=? AND json_extract(body,'$.goal.nodeId')=? LIMIT 2").all(g.id,n.id).map(r=>JSON.parse(String(r.body)) as OutboundTask)
  requireDelegation(prior.length<=1,'ambiguous_goal_delegation_binding',409)
  if(prior[0]){
   requireDelegation(prior[0].goal?.nodeHash===this.nodeHash(n)&&prior[0].goal.policyHash===hash&&prior[0].contractHash===stableDigest({targetId:target.id,text,acceptance,artifacts}),'goal_delegation_changed',409)
   this.manager.parent(prior[0]);return {id:prior[0].id}
  }
  return this.manager.command({action:'assign',targetId:target.id,operationId:'goal-'+stableDigest([g.id,n.id]).slice(0,40),expectedRevision:this.host.settings.current().revision,text,acceptance,artifacts},
   {discussion:g.discussion,trigger:c.trigger,scoped:c,manifest},{goalId:g.id,nodeId:n.id,nodeHash:this.nodeHash(n),policyHash:hash}) as Promise<{id:string}>
 }
 task(g:RouterGoal,n:GoalNode){
  const {hash}=this.assertTarget(g,n),task=n.delegationId?this.host.store.get<OutboundTask>('delegation-outbound',n.delegationId):undefined
  requireDelegation(task&&task.goal?.goalId===g.id&&task.goal.nodeId===n.id&&task.goal.nodeHash===this.nodeHash(n)&&task.goal.policyHash===hash&&task.targetId===n.teamTargetId,'goal_delegation_changed',403)
  this.manager.parent(task)
  return task
 }
 evidence(g:RouterGoal,n:GoalNode):{binding:DelegationBinding;evidence:Omit<GoalEvidence,'id'|'hash'>[]}{
  const task=this.task(g,n),remote=task.remote
  requireDelegation(task.desired==='running'&&task.state==='acknowledged'&&remote?.state==='ready'&&remote.desired==='running','remote_candidate_required',409)
  requireDelegation(!task.error&&task.lastCheckedAt&&(task.acceptance==='passed'||Date.now()-task.lastCheckedAt<=Math.max(5000,this.manager.deploymentConfig.pollMs*3)),'remote_candidate_not_current',409)
  const criteria=this.host.verification.criteria(g,n),criterionIds=criteria.map(c=>c.id),base={delegationId:task.id,sourceInstance:task.connectionId,criterionIds}
  const evidence:Omit<GoalEvidence,'id'|'hash'>[]=[
   {...base,kind:'execution',key:'peer-execution',content:JSON.stringify({basis:'Peer-signed task snapshot; receiving host validated the service identity, immutable contract and artifact byte hashes',complete:remote.execution?.complete??false,limitations:['Only the paired host managed tool metadata for these task IDs is exported; this is not an audit of remote operating-system processes or unexported command output'],toolSemantics:{superagent_artifact:'The peer host actually reads the declared existing file bytes, computes SHA-256 and size, and captures those immutable bytes. This is a file-read operation as well as internal artifact capture; it does not publish externally.'},contract:remote.contract,remoteRevision:remote.revision,activations:remote.activations,workerReports:remote.workerReports??[],execution:remote.execution??null})},
   {...base,kind:'report',key:'peer-reports',content:JSON.stringify({router:remote.replies,workers:remote.workerReports??[]})},
  ]
  const paths=this.artifacts(g,n)
  for(const path of paths){
   const file=remote.artifacts.find(a=>a.name===path)
   requireDelegation(file&&file.size<=128*1024,'remote_artifact_exceeds_goal_evidence_limit',409)
   let content:string
   try{content=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.from(file.data,'base64'));requireDelegation(!content.includes('\0'),'remote_goal_requires_text_artifact',409)}catch{throw Error('Remote goal evidence requires bounded UTF-8 text artifacts')}
   evidence.push({...base,kind:'file',key:path,content})
  }
  // Acceptance/review receipts do not alter this immutable candidate fingerprint.
  return {binding:{delegationId:task.id,contractHash:stableDigest(task.contract),candidateHash:stableDigest(remote)},evidence}
 }
 accept(g:RouterGoal,n:GoalNode,round:VerificationRound){
  requireDelegation(round.goalId===g.id&&!round.nodeId&&g.finalRoundId===round.id&&round.state==='passed'&&this.host.verification.current(round,g),'independent_goal_acceptance_required',409)
  const task=this.task(g,n)
  requireDelegation(task.desired==='running'&&task.remote?.state==='ready','remote_candidate_required',409)
  this.host.store.put('delegation-outbound',task.id,{...task,acceptance:'passed',reviewedEvidence:this.manager.evidence(task).map(e=>e.id),acceptedBy:'goal-verification',verificationRoundId:round.id})
 }
 cancel(goalId:string){this.manager.cancelWhere(t=>t.goal?.goalId===goalId)}
 private round(id?:string){
  if(!id)return
  const row=this.host.store.db.prepare("SELECT json_remove(body,'$.snapshot') AS body FROM records WHERE kind='goal-verification' AND id=?").get(id)
  return row?JSON.parse(String(row.body)) as Omit<VerificationRound,'snapshot'>:undefined
 }
 view(task:OutboundTask){
  if(!task.goal)return {acceptanceMode:'parent-review' as const}
  const g=this.host.goals.get(task.goal.goalId),node=g?.nodes?.find(n=>n.id===task.goal!.nodeId),round=this.round(node?.roundId),final=this.round(g?.finalRoundId)
  try{if(!g)throw Error('Goal unavailable');this.host.goals.context(g)}catch{return {acceptanceMode:'goal-verification' as const,goalId:task.goal.goalId,verification:{state:'unavailable',reason:'Goal authority or source changed'}}}
  const checks=(r:typeof round)=>(r?.checks??[]).map(c=>({...c,explanation:c.explanation.slice(0,1000)}))
  return {acceptanceMode:'goal-verification' as const,goalId:g.id,nodeId:node?.id,goalState:g.state,verification:{state:round?.state??'pending',roundId:round?.id,checks:checks(round),reason:node?.reason??g.reason,finalRoundId:g.finalRoundId,finalState:final?.state,overallChecks:checks(final)}}
 }
 graph(){
  return this.host.goals.snapshot().filter(g=>g.nodes?.some(n=>n.teamTargetId)).slice(-25).map(g=>({
   id:g.id,title:g.title,state:g.state,reason:g.reason,revision:g.revision,finalRoundId:g.finalRoundId,
   nodes:g.nodes!.map(n=>({id:n.id,title:n.title,state:n.state,dependsOn:n.dependsOn,kind:n.teamTargetId?'team':'worker',targetId:n.teamTargetId??n.workerId,delegationId:n.delegationId,ticketId:n.ticketId,roundId:n.roundId,reason:n.reason})),
  }))
 }
}
