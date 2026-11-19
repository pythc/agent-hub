import {z} from 'zod'
const key=z.string().min(1).max(300),digest=z.string().regex(/^[a-f0-9]{64}$/),revision=z.number().int().nonnegative().safe()
export const effectReceiptSchema=z.object({
 schema:z.literal(1),producer:z.literal('workflow_status'),localOperationId:key,requestDigest:digest,
 target:z.object({sourceId:key,accountId:key,issueId:key}).strict(),
 authorization:z.object({originTriggerId:key,entryRevision:revision,ownerEpoch:revision,dataRevision:revision,sourceIdentityDigest:digest}).strict(),
 query:z.object({kind:z.literal('workflow_state'),supported:z.literal(true)}).strict(),
 state:z.enum(['prepared','unknown','confirmed','observed','not_executed']),remoteOperationId:z.null(),
 remote:z.object({objectId:key,revision:key,stateId:key}).strict().optional(),attemptedAt:revision.optional(),observedAt:revision.optional(),
}).strict().superRefine((r,c)=>{
 if(['unknown','confirmed','observed'].includes(r.state)&&r.attemptedAt===undefined)c.addIssue({code:'custom',message:'Attempt evidence required'})
 if(!['confirmed','observed'].includes(r.state)&&(r.remote!==undefined||r.observedAt!==undefined))c.addIssue({code:'custom',message:'Unconfirmed state cannot carry observed remote evidence'})
 if(r.state==='prepared'&&r.attemptedAt!==undefined)c.addIssue({code:'custom',message:'Prepared operation has not attempted a write'})
 if(['confirmed','observed'].includes(r.state)&&(!r.remote||r.observedAt===undefined))c.addIssue({code:'custom',message:'Confirmed observation requires remote evidence'})
 if(r.remote&&r.remote.objectId!==r.target.issueId)c.addIssue({code:'custom',message:'Remote object differs from target'})
 if(r.observedAt!==undefined&&r.attemptedAt!==undefined&&r.observedAt<r.attemptedAt)c.addIssue({code:'custom',message:'Observation precedes attempt'})
})
export type EffectReceipt=z.infer<typeof effectReceiptSchema>
export const parseEffectReceipt=(value:unknown):EffectReceipt=>effectReceiptSchema.parse(value)
export function effectReceiptSummary(value:unknown,legacyState?:string,version?:number){
 if(value===undefined&&version!==undefined)return {schema:null,state:'unknown' as const,legacy:false,querySupported:false,reason:'invalid_effect_receipt'}
 if(value===undefined)return {schema:null,state:'unknown' as const,legacy:true,querySupported:false,reason:'legacy_receipt_not_captured',legacyState}
 const result=effectReceiptSchema.safeParse(value)
 if(!result.success)return {schema:null,state:'unknown' as const,legacy:false,querySupported:false,reason:'invalid_effect_receipt'}
 const r=result.data
 return {schema:r.schema,state:r.state,legacy:false,querySupported:true,remoteOperationId:null,remoteObjectId:r.remote?.objectId??r.target.issueId,observedAt:r.observedAt,attemptedAt:r.attemptedAt}
}

export interface WorkflowEffectBinding {
 id:string;ticketId:string;sourceId:string;originTriggerId:string;entryRevision:number;ownerEpoch:number;dataRevision:number;
 target:unknown;view:{account:string;issue:string;current:{id:string;name:string};states:{id:string;name:string}[];[key:string]:unknown};next:{id:string;name:string};state:string;effectReceiptVersion?:number;effectReceipt?:unknown;
}
import {stableDigest} from './sources.ts'
export function validateWorkflowEffect(action:WorkflowEffectBinding):EffectReceipt|undefined{
 if(action.effectReceipt===undefined){if(action.effectReceiptVersion!==undefined)throw Error('Workflow effect receipt missing');return}
 if(action.effectReceiptVersion!==1)throw Error('Workflow effect receipt version missing')
 const r=parseEffectReceipt(action.effectReceipt)
 const requestDigest=stableDigest({schema:1,kind:'workflow_status',ticketId:action.ticketId,binding:{sourceId:action.sourceId,target:action.target,entryRevision:action.entryRevision,ownerEpoch:action.ownerEpoch,dataRevision:action.dataRevision},view:{...action.view,states:[...action.view.states].sort((a,b)=>a.id.localeCompare(b.id)||a.name.localeCompare(b.name))},next:action.next})
 const state={pending:'prepared',applying:'unknown',uncertain:'unknown',applied:'confirmed',observed:'observed',declined:'not_executed',stale:'not_executed'}[action.state]
 if(r.state!==state||r.localOperationId!==action.id||r.requestDigest!==requestDigest||r.target.sourceId!==action.sourceId||r.target.accountId!==action.view.account||r.target.issueId!==action.view.issue||r.authorization.originTriggerId!==action.originTriggerId||r.authorization.entryRevision!==action.entryRevision||r.authorization.ownerEpoch!==action.ownerEpoch||r.authorization.dataRevision!==action.dataRevision||r.remote&&r.remote.stateId!==action.next.id)throw Error('Workflow effect receipt identity changed')
 return r
}
export function workflowEffectState(action:WorkflowEffectBinding):'pending'|'applying'|'applied'|'declined'|'stale'|'uncertain'|'observed'{
 try{validateWorkflowEffect(action);return ['pending','applying','applied','declined','stale','uncertain','observed'].includes(action.state)?action.state as ReturnType<typeof workflowEffectState>:'uncertain'}catch{return 'uncertain'}
}
export function workflowEffectSummary(action:WorkflowEffectBinding):{schema:1;kind:'legacy'|'unknown'|'prepared'|'confirmed'|'observed'|'not_executed';attemptedAt?:number;observedAt?:number}{
 try{const receipt=validateWorkflowEffect(action);return receipt?{schema:1,kind:receipt.state,...(receipt.attemptedAt!==undefined?{attemptedAt:receipt.attemptedAt}:{}),...(receipt.observedAt!==undefined?{observedAt:receipt.observedAt}:{})}:{schema:1,kind:'legacy'}}catch{return {schema:1,kind:'unknown'}}
}
