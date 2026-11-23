import {stableDigest} from './sources.ts'
import type {ChannelRef} from './vendor/dsh-core/index.ts'

/** Host fact, not model-authored copy. Each producer defines its own current-fact resolver. */
export interface NotificationCandidate {
 readonly schema:1
 readonly kind:'project-review-pending'
 readonly topicKey:string
 readonly factRevision:string
}

export const candidateNoticePrefix='goal-notice:candidate:'

export function projectReviewCandidate(input:{scopeId:string;entryId:string;bindingRevision:number;actor:string;goalId:string;channel:ChannelRef;reviewId:string;roundId:string;deliveryId:string;head:string}):NotificationCandidate {
 return {
  schema:1,kind:'project-review-pending',
  topicKey:stableDigest(['project-review-pending',input.scopeId,input.entryId,input.bindingRevision,input.actor,input.goalId,input.channel]),
  factRevision:stableDigest([input.reviewId,input.roundId,input.deliveryId,input.head]),
 }
}

export const notificationCandidateId=(candidate:NotificationCandidate)=>candidateNoticePrefix+stableDigest([candidate.schema,candidate.kind,candidate.topicKey,candidate.factRevision])
