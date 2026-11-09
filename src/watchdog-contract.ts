import {z} from 'zod'
import type {BackendDefinition,AgentOptions} from './backend-config.ts'

export const watchdogConfigSchema=z.object({
 enabled:z.boolean().default(true),
 staleMs:z.number().min(1000).default(600000),
 intervalMs:z.number().min(1000).default(30000),
 reviewIntervalMs:z.number().int().min(1000).default(600000),
 modelTimeoutMs:z.number().int().min(1000).max(300000).default(60000),
 maxReviewsPerHour:z.number().int().min(1).max(100).default(12),
 maxRecoveries:z.number().int().min(1).max(10).default(3),
 backend:z.string().min(1).optional(),
}).strict().prefault({})
export interface WatchdogEvidence {id:string;kind:string;value:unknown}
export interface WatchdogTarget {
 id:string;goalId:string;nodeId:string;ticketId:string;assignmentId:string;fence:string;basisHash:string;
 goalRevision:number;contractHash:string;objective:string;criteria:unknown;principal:{source:string;actor:string};
 backendId:string;backendIds:string[];contextBytes:number;
 /** Control-plane only. Must never enter model input or observer persistence. */
 inference:{backend:BackendDefinition;options:AgentOptions;model?:string};
 phase:string;activityAt:number;progressHash:string;verifiedHash:string;notBefore?:number;waiting?:string;
 evidence:WatchdogEvidence[];recoveryId?:string;
}
export interface WatchdogSnapshot {
 instanceId:string;at:number;tickAt:number;paused:boolean;
 config:z.infer<typeof watchdogConfigSchema>;targets:WatchdogTarget[];
 webhooks?:{waiting:number;overdue:number;heldReceipts:number;pendingDeliveries:number;lastReconciliation?:number};
 unavailable:{goalId:string;reason:string}[];
}
export const watchdogJudgmentSchema=z.object({
 verdict:z.enum(['progressing','waiting','stalled','drifted','uncertain']),
 reason:z.string().min(1).max(2000),
 evidenceIds:z.array(z.string().min(1)).min(1).max(100),
}).strict()
export type WatchdogJudgment=z.infer<typeof watchdogJudgmentSchema>
export const watchdogDirectiveSchema=z.object({
 id:z.string().min(1).max(200),targetId:z.string().min(1).max(400),fence:z.string().min(1).max(100),
 judgment:watchdogJudgmentSchema,
}).strict()
export type WatchdogDirective=z.infer<typeof watchdogDirectiveSchema>
export interface WatchdogRecovery extends WatchdogDirective {
 goalId:string;ticketId:string;assignmentId:string;contractHash:string;goalRevision:number;
 progressHash:string;verifiedHash:string;basisHash:string;state:'interrupting'|'watching'|'resolved'|'held'|'stale';
 at:number;updatedAt:number;reason?:string;
 observation?:{phase:string;activityAt:number;evidence:WatchdogEvidence[]};
}
