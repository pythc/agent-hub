import {expect,it} from 'vitest'
import {readTaskStatus} from '../web/chat/execution-status-view.ts'
import type {TaskStatusProjection} from '../src/execution-status.ts'

const counts=(patch:Partial<TaskStatusProjection['delivery']['counts']>={})=>({total:0,pending:0,retry_wait:0,sending:0,uncertain:0,held:0,dropped:0,recorded:0,...patch})
const projection=():TaskStatusProjection=>({schema:1,observedAt:0,execution:{state:'finished'},effects:{state:'unknown',receiptCount:1},acceptance:{state:'pending',freshness:'current'},delivery:{state:'retry_wait',counts:counts({total:1,retry_wait:1}),evidence:'none',scope:'external'}})
function delivery(value:unknown){return readTaskStatus({...projection(),delivery:value})}
function unknownDelivery(value:unknown){const actual=delivery(value);expect(actual).toMatchObject({execution:'finished',effects:'unknown',acceptance:'pending',delivery:'unknown',counts:null,scope:'unknown',hostRecord:false});return actual}

it.each([undefined,null,{}, {state:'completed',hasResult:true}, {...projection(),schema:2}, {...projection(),observedAt:'today'}])('does not infer four-state evidence from an old or unsupported response (%#)',value=>{
 const actual=readTaskStatus(value);expect(actual.available).toBe(false);for(const axis of ['execution','effects','acceptance','delivery'] as const)expect(actual[axis]).toBe('unknown')
})
it('keeps execution completion independent of unknown effects, pending acceptance and delivery retry',()=>{
 expect(readTaskStatus(projection())).toMatchObject({available:true,observedAt:0,execution:'finished',effects:'unknown',acceptance:'pending',delivery:'retry_wait',scope:'external',hostRecord:false})
})
it.each(['stale','unknown',undefined])('does not display an old passed acceptance as current (%s)',freshness=>{
 expect(readTaskStatus({...projection(),acceptance:{state:'passed',freshness}}).acceptance).toBe('stale')
})
it('renders current acceptance without implying any other axis is complete',()=>{
 expect(readTaskStatus({...projection(),acceptance:{state:'passed',freshness:'current'}})).toMatchObject({acceptance:'passed',effects:'unknown',delivery:'retry_wait'})
 expect(readTaskStatus({...projection(),acceptance:undefined}).acceptance).toBe('unknown')
})
it('does not claim retained effect receipts without a positive valid receipt count',()=>{
 for(const receiptCount of [0,-1,undefined,1.5,Number.NaN])expect(readTaskStatus({...projection(),effects:{state:'recorded',receiptCount}}).effects).toBe('unknown')
})
it.each([
 ['missing counts',undefined],
 ['zero total and zero recorded',counts()],
 ['overlapping total',counts({total:1,recorded:1,uncertain:1})],
])('rejects the reviewed malformed recorded-delivery case: %s',(_name,value)=>{
 unknownDelivery({state:'recorded',counts:value,evidence:'host_record',scope:'external'})
})
it.each(['pending','retry_wait','sending','uncertain','held','dropped','recorded','partial','not_recorded'])('checks bucket sums for every delivery state, including %s',state=>{
 unknownDelivery({state,counts:counts({total:2,pending:1}),evidence:'none',scope:'external'})
})
it.each([-1,1.5,Number.NaN,Number.POSITIVE_INFINITY,Number.MAX_SAFE_INTEGER+1])('rejects invalid bucket values (%s)',value=>{
 unknownDelivery({state:'recorded',counts:counts({total:value,recorded:value}),evidence:'host_record',scope:'external'})
})
it('rejects bucket sums that exceed safe integer precision',()=>{
 unknownDelivery({state:'partial',counts:counts({total:Number.MAX_SAFE_INTEGER,recorded:Number.MAX_SAFE_INTEGER,pending:1}),evidence:'host_record',scope:'external'})
})
it.each(['local','external','mixed'] as const)('retains only host-record evidence for a valid recorded %s delivery',scope=>{
 const total=scope==='mixed'?2:1
 expect(delivery({state:'recorded',counts:counts({total,recorded:total}),evidence:'host_record',scope,remoteConfirmed:true,read:true})).toMatchObject({delivery:'recorded',hostRecord:true,scope})
 const view=delivery({state:'recorded',counts:counts({total,recorded:total}),evidence:'host_record',scope,remoteConfirmed:true,read:true})
 expect(view).not.toHaveProperty('remoteConfirmed');expect(view).not.toHaveProperty('read')
})
it('does not promote a missing host record, missing scope or contradictory scope',()=>{
 const base={state:'recorded',counts:counts({total:1,recorded:1}),evidence:'host_record',scope:'external'}
 for(const patch of [{evidence:'none'},{evidence:undefined},{scope:undefined},{scope:'not_recorded'},{scope:'mixed'}])unknownDelivery({...base,...patch})
})
it('preserves a genuinely mixed delivery without promoting it to overall delivery completion',()=>{
 const actual=delivery({state:'partial',counts:counts({total:2,recorded:1,pending:1}),evidence:'host_record',scope:'external'})
 expect(actual).toMatchObject({delivery:'partial',hostRecord:true,scope:'external',counts:{total:2,recorded:1,pending:1}})
})
it('rejects a partial claim with no mix, no recorded bucket, or hidden uncertainty',()=>{
 for(const value of [counts({total:1,recorded:1}),counts({total:2,pending:1,retry_wait:1}),counts({total:2,recorded:1,uncertain:1})])unknownDelivery({state:'partial',counts:value,evidence:value.recorded?'host_record':'none',scope:'external'})
})
it('preserves unknown delivery even when another delivery has a local host record',()=>{
 expect(delivery({state:'uncertain',counts:counts({total:2,uncertain:1,recorded:1}),evidence:'host_record',scope:'mixed'})).toMatchObject({delivery:'uncertain',hostRecord:true,counts:{uncertain:1,recorded:1}})
 unknownDelivery({state:'pending',counts:counts({total:2,pending:1,uncertain:1}),evidence:'none',scope:'external'})
})
it('does not describe a pending operation as wholly dropped or recorded',()=>{
 const mixed=counts({total:2,pending:1,dropped:1});unknownDelivery({state:'dropped',counts:mixed,evidence:'none',scope:'external'})
 unknownDelivery({state:'recorded',counts:counts({total:2,pending:1,recorded:1}),evidence:'host_record',scope:'external'})
})
it('retains a truly empty delivery projection without claiming effects did not occur',()=>{
 expect(delivery({state:'not_recorded',counts:counts(),evidence:'none',scope:'not_recorded'})).toMatchObject({delivery:'not_recorded',hostRecord:false,scope:'not_recorded',effects:'unknown'})
 unknownDelivery({state:'not_recorded',counts:counts(),evidence:'none',scope:'local'})
})
it('never renders provider enum strings or unexpected delivery metadata',()=>{
 const view=readTaskStatus({...projection(),execution:{state:'SECRET_PROVIDER_OUTPUT'},delivery:{state:'PRIVATE_PROVIDER_STATUS',counts:{...counts(),PRIVATE_TOKEN:'SECRET_TOKEN'},evidence:'PRIVATE_PROOF',scope:'PRIVATE_SCOPE'}})
 expect(view.execution).toBe('unknown');expect(view.delivery).toBe('unknown');expect(JSON.stringify(view)).not.toMatch(/SECRET|PRIVATE/)
})
