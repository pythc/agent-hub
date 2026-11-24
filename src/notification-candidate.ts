import {stableDigest} from './sources.ts'
import type {ChannelRef} from './vendor/dsh-core/index.ts'

export type GoalHoldCause='turn-allowance'|'repeated-failure'
type CandidateKind='project-review-pending'|'goal-execution-held'

/** Host fact, not model-authored copy. Each producer defines its own current-fact resolver. */
export interface NotificationCandidate {
 readonly schema:1
 readonly kind:CandidateKind
 readonly topicKey:string
 readonly factRevision:string
}

interface CandidateAudience {scopeId:string;entryId:string;bindingRevision:number;actor:string;goalId:string;channel:ChannelRef}

export const candidateNoticePrefix='goal-notice:candidate:'

function makeCandidate(kind:CandidateKind,input:CandidateAudience,revision:unknown):NotificationCandidate{
 return {
  schema:1,kind,
  topicKey:stableDigest([kind,input.scopeId,input.entryId,input.bindingRevision,input.actor,input.goalId,input.channel]),
  factRevision:stableDigest(revision),
 }
}

export function projectReviewCandidate(input:CandidateAudience&{reviewId:string;roundId:string;deliveryId:string;head:string}):NotificationCandidate {
 // Keep schema-one review keys unchanged so upgrades do not duplicate prior notices.
 return makeCandidate('project-review-pending',input,[input.reviewId,input.roundId,input.deliveryId,input.head])
}

export function goalExecutionHeldCandidate(input:CandidateAudience&{cause:GoalHoldCause}):NotificationCandidate{
 // Counters and wording are not new facts; a higher-impact failure can supersede the allowance notice.
 return makeCandidate('goal-execution-held',input,[input.cause])
}

export const notificationCandidateId=(candidate:NotificationCandidate)=>candidateNoticePrefix+stableDigest([candidate.schema,candidate.kind,candidate.topicKey,candidate.factRevision])
