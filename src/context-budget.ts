import {createHash} from 'node:crypto'

/** Bytes are UTF-8 serialized host protocol, not a tokenizer estimate. */
export interface ContextBudget {maxBytes:number;outputReserveBytes:number;toolReserveBytes:number}
export interface BudgetReceipt {basis:'api-wire'|'native-protocol';phase:string;bytes:number;maxBytes:number;reservedBytes:number;status:'within_budget'|'exceeded'}
export class ContextBudgetExceeded extends Error {
 readonly code='context_budget_exceeded'
 constructor(readonly receipt:BudgetReceipt){super('Context budget exceeded at '+receipt.phase+'; retain pending inputs and completed effects, then explicitly rebuild context')}
}
export const protocolBytes=(value:unknown)=>Buffer.byteLength(JSON.stringify(value)??'null')
export function scopeBudget(maxBytes:number):ContextBudget {return {maxBytes,outputReserveBytes:Math.min(8192,Math.floor(maxBytes/8)),toolReserveBytes:Math.min(4096,Math.floor(maxBytes/16))}}
export function checkBudget(value:unknown,budget:ContextBudget|undefined,basis:BudgetReceipt['basis'],phase:string,onReceipt?:(r:BudgetReceipt)=>void,reserveTool=false){
 if(!budget)return
 const bytes=protocolBytes(value),reservedBytes=budget.outputReserveBytes+(reserveTool?budget.toolReserveBytes:0)
 const receipt:BudgetReceipt={basis,phase,bytes,maxBytes:budget.maxBytes,reservedBytes,status:bytes+reservedBytes<=budget.maxBytes?'within_budget':'exceeded'}
 onReceipt?.(receipt)
 if(receipt.status==='exceeded')throw new ContextBudgetExceeded(receipt)
}
/** A complete tool receipt reference, never a substring of JSON or a half tool pair. */
export function receiptReference(value:unknown,id:string){const success=(value as any)?.success===true;return {success,contentItems:[{type:'inputText' as const,text:JSON.stringify({status:'retained',resultSuccess:success,receiptId:id,resource:'model-tool-receipt/'+id,bytes:protocolBytes(value),sha256:createHash('sha256').update(JSON.stringify(value)).digest('hex'),notice:'Full tool result retained by host. Do not repeat its effects. Read this resource with superagent_read using limit 800 and follow nextOffset; only the owning assignment or operator can read it.'})}]}}
