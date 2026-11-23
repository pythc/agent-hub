import type {ArtifactVersion} from './goal-artifacts.ts'
import type {VerificationRound} from './goal-verification.ts'
import type {Runtime} from './runtime.ts'
import {stableDigest} from './sources.ts'

const recordKind='goal-artifact-handoff-withdrawal'
type Acceptance={state:'draft'}|{state:'accepted';roundId:string;at:number}
interface Binding {
 artifactVersion:{id:string;version:number;sha256:string}
 destination:{kind:'operator_workspace';scopeId:string;entryId:string}
 audience:'authorized_workspace_operators'
 permissionVersion:string
}
interface Withdrawal {binding:Binding;receiptId:string;goalId:string;ticketId:string;triggerId:string;at:number}
export interface ArtifactHandoff extends Binding {
 schema:1
 acceptance:Acceptance
 delivery:{state:'not_ready'|'ready'|'withdrawn';reason:'not_accepted'|'goal_pending'|'file_unavailable'|'goal_withdrawn'|'operator_withdrew'|null;receiptId:string|null}
 // No public delivery adapter is installed for this destination. A goal release,
 // a private download, or a text outbox acknowledgement cannot confirm publication.
 publication:{state:'not_confirmed';capability:'unavailable'}
}
export class HandoffConflict extends Error {}

/** Observe and optionally withdraw this exact version's private handoff, without sending anything. */
export function artifactHandoff(host:Runtime,id:string,withdrawReceipt?:string):ArtifactHandoff {
 const {store}=host
 const observe=():ArtifactHandoff=>{
  const reference=host.artifacts.describe(id)
  const artifact=store.get<ArtifactVersion>('goal-artifact',id)
  const goal=artifact&&host.goals.get(artifact.goalId)
  if(!artifact||!goal||host.memory.cleanup.blocked('goal-artifact',id,artifact))throw Error('Artifact unavailable')
  const context=host.goals.context(goal)
  const entry=host.scopes.binding(goal.entryId),scope=host.scopes.scope(goal.scopeId)
  host.scopes.assertCurrent(context)
  if(entry.privateActor||context.route.scopeId!==scope.id||context.route.tenantId!==scope.tenantId)throw Error('Artifact unavailable')
  const owner=host.scopes.ownership(artifact.ticketId)
  if(!owner||owner.scopeId!==scope.id||owner.tenantId!==scope.tenantId)throw Error('Artifact unavailable')
  host.scopes.checkTaskEntry(owner,entry.id,'result')
  const artifactVersion={id,version:reference.version,sha256:reference.sha256}
  const policyVersion=host.routerIngress.authority(goal.triggerId).policyVersion
  const binding:Binding={artifactVersion,destination:{kind:'operator_workspace',scopeId:scope.id,entryId:entry.id},audience:'authorized_workspace_operators',permissionVersion:stableDigest([policyVersion,context.route.epoch,scope.revision,entry.revision,owner.ownerEpoch,owner.dataRevision??1])}
  const withdrawalKey=stableDigest([recordKind,artifactVersion.id,artifactVersion.version,artifactVersion.sha256])
  const prior=store.get<Withdrawal>(recordKind,withdrawalKey)
  const round=goal.finalRoundId?store.get<VerificationRound>('goal-verification',goal.finalRoundId):undefined
  // Use the immutable accepted snapshot, not current worker files, mutable title,
  // a passed intermediate round, or a report whose text happens to mention the file.
  const accepted=round?.state==='passed'&&round.id===goal.finalRoundId&&!round.nodeId&&round.goalId===goal.id&&round.scopeId===goal.scopeId&&round.entryId===goal.entryId&&typeof round.finishedAt==='number'
   &&(!goal.project||goal.project.review?.state==='approved'&&goal.project.review.roundId===round.id&&goal.project.review.head===round.snapshot.finalCommit)
   &&round.snapshot.evidence.some(({artifact:a})=>a?.id===id&&a.version===reference.version&&a.sha256===reference.sha256&&a.ticketId===artifact.ticketId&&a.goalId===goal.id&&a.nodeId===artifact.nodeId)
   &&!host.memory.cleanup.blocked('goal-verification',round.id,round)
  const acceptance:Acceptance=accepted&&round?.finishedAt!==undefined?{state:'accepted',roundId:round.id,at:round.finishedAt}:{state:'draft'}
  const receiptId=acceptance.state==='accepted'?stableDigest(['goal-artifact-private-handoff-v1',binding,acceptance.roundId]):null
  const result:ArtifactHandoff={schema:1,...binding,acceptance,delivery:{state:'not_ready',reason:acceptance.state==='accepted'?'goal_pending':'not_accepted',receiptId:null},publication:{state:'not_confirmed',capability:'unavailable'}}
  if(prior&&!host.memory.cleanup.blocked(recordKind,withdrawalKey,prior)){
   // Retries of the original withdrawal and fresh reads of the exact
   // withdrawn version return one row, including across restarts.
   const visibleReceipt=prior.binding.permissionVersion===binding.permissionVersion&&prior.receiptId===receiptId?prior.receiptId:null
   if(withdrawReceipt&&withdrawReceipt!==visibleReceipt)throw new HandoffConflict('Handoff receipt changed')
   result.delivery={state:'withdrawn',reason:'operator_withdrew',receiptId:visibleReceipt}
  }else if(goal.supersededBy||goal.state==='cancelled'){
   if(withdrawReceipt)throw new HandoffConflict('Goal handoff withdrawn')
   result.delivery={state:'withdrawn',reason:'goal_withdrawn',receiptId:null}
  }else if(reference.availability!=='retained'){
   if(withdrawReceipt)throw new HandoffConflict('Artifact is no longer retained')
   result.delivery={state:'not_ready',reason:'file_unavailable',receiptId:null}
  }else if(goal.state==='completed'&&receiptId){
   result.delivery={state:'ready',reason:null,receiptId}
   if(withdrawReceipt){
    if(withdrawReceipt!==receiptId)throw new HandoffConflict('Handoff permission or acceptance changed')
    const withdrawal:Withdrawal={binding,receiptId,goalId:goal.id,ticketId:artifact.ticketId,triggerId:goal.triggerId,at:Date.now()}
    if(host.memory.cleanup.blocked(recordKind,withdrawalKey,withdrawal))throw new HandoffConflict('Handoff history was removed')
    store.put(recordKind,withdrawalKey,withdrawal)
    result.delivery={state:'withdrawn',reason:'operator_withdrew',receiptId}
   }
  }else if(withdrawReceipt)throw new HandoffConflict('Handoff not ready')
  return result
 }
 const run=()=>host.scopes.readOnly(()=>host.memory.readOnly(observe))
 return withdrawReceipt?store.atomic(run):run()
}
