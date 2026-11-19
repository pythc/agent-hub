import {expect,it} from 'vitest'
import {effectReceiptSchema,effectReceiptSummary,workflowEffectState,validateWorkflowEffect,type WorkflowEffectBinding,type EffectReceipt} from '../src/effect-receipt.ts'
import {stableDigest} from '../src/sources.ts'
function fixture(){
 const action:WorkflowEffectBinding={id:'op',ticketId:'ticket',sourceId:'linear',originTriggerId:'human',entryRevision:1,ownerEpoch:2,dataRevision:3,target:{issueId:'issue'},view:{account:'account',issue:'issue',label:'Issue',revision:'rev',current:{id:'todo',name:'Todo'},states:[{id:'done',name:'Done'}]},next:{id:'done',name:'Done'},state:'pending',effectReceiptVersion:1}
 const receipt:EffectReceipt={schema:1,producer:'workflow_status',localOperationId:action.id,requestDigest:stableDigest({schema:1,kind:'workflow_status',ticketId:action.ticketId,binding:{sourceId:action.sourceId,target:action.target,entryRevision:1,ownerEpoch:2,dataRevision:3},view:action.view,next:action.next}),target:{sourceId:'linear',accountId:'account',issueId:'issue'},authorization:{originTriggerId:'human',entryRevision:1,ownerEpoch:2,dataRevision:3,sourceIdentityDigest:'a'.repeat(64)},query:{kind:'workflow_state',supported:true},state:'prepared',remoteOperationId:null}
 action.effectReceipt=receipt;return{action,receipt}
}
it('requires actual attempt/readback evidence and strictly separates observed from confirmed',()=>{
 const {receipt}=fixture()
 for(const state of ['unknown','confirmed','observed'] as const)expect(effectReceiptSchema.safeParse({...receipt,state}).success).toBe(false)
 const observed={...receipt,state:'observed',attemptedAt:1,observedAt:2,remote:{objectId:'issue',revision:'2',stateId:'done'}}
 expect(effectReceiptSchema.parse(observed).state).toBe('observed');expect(effectReceiptSummary(observed).state).toBe('observed')
 for(const state of ['prepared','unknown','not_executed'])expect(effectReceiptSchema.safeParse({...observed,state}).success).toBe(false)
 expect(effectReceiptSchema.safeParse({...observed,observedAt:0}).success).toBe(false)
})
it('fails closed for missing receipt/version, wrong operation and authorization, state mismatch, and changed target',()=>{
 const {action,receipt}=fixture();expect(validateWorkflowEffect(action)).toEqual(receipt);expect(workflowEffectState(action)).toBe('pending')
 for(const patch of [{effectReceipt:undefined},{effectReceiptVersion:undefined},{id:'other'},{sourceId:'other'},{dataRevision:4},{state:'applied'},{view:{...action.view,issue:'other'}}])expect(workflowEffectState({...action,...patch})).toBe('uncertain')
 expect(effectReceiptSummary(undefined,'applied',1)).toMatchObject({state:'unknown',legacy:false})
})
it('preserves legacy raw-state compatibility without inventing captured evidence',()=>{
 const {action}=fixture();delete action.effectReceipt;delete action.effectReceiptVersion;action.state='applied'
 expect(workflowEffectState(action)).toBe('applied');expect(effectReceiptSummary(undefined,'applied')).toMatchObject({legacy:true,state:'unknown',querySupported:false})
})
import {WorkflowActions} from '../src/workflow-actions.ts'
it('does not release an unknown remote target when its original source alias was removed',()=>{
 const {action,receipt}=fixture();action.state='uncertain';action.effectReceipt={...receipt,state:'unknown',attemptedAt:1}
 const host={config:{sources:[{id:'new-linear',kind:'linear'}]},store:{list:()=>[action]}}
 const workflows=new WorkflowActions(host as never)
 expect(()=>(workflows as any).unresolvedTarget({id:'new',sourceId:'new-linear',target:{issueId:'different-config-alias'},view:{account:'account',issue:'issue'}})).toThrow('unknown effect')
})
