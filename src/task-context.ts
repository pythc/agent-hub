import type {Store} from './store.ts'
import type {Ticket} from './vendor/dsh-core/index.ts'

/** A projection for a fresh session. The core ticket and its immutable Mandate
 * remain the audit record; quarantined text is never silently re-authorized. */
export interface TaskContinuation {
 ticketId:string;triggerId:string;discussion:string;text:string;at:number;
 inputIds:string[];priorAssignments:string[];priorReports:{id:string;at?:string}[];priorJobs:string[];priorMessages:string[];priorToolCalls:string[];
 previousThread?:string;workspaceReviewed:boolean
}
export function taskView(store:Store,ticket:Ticket):Ticket {
 const c=store.get<TaskContinuation>('task-continuation',ticket.id)
 if(!c)return ticket
 return {...ticket,title:c.text.slice(0,100),attention:undefined,execution:undefined,delivery:undefined,answers:[],ended:ticket.ended?{...ticket.ended,reason:undefined}:undefined,mandate:{...ticket.mandate,scope:c.text},
  origin:{...ticket.origin,triggerId:c.triggerId,triggerIds:[c.triggerId]},follows:[],
  inputs:ticket.inputs.filter(i=>c.inputIds.includes(i.id)),undelivered:ticket.undelivered.filter(id=>c.inputIds.includes(id)),
  assignments:ticket.assignments.map(a=>({...a,endedReason:undefined,report:c.priorReports.some(p=>p.id===a.id&&p.at===a.report?.at)?undefined:a.report}))}
}
export function allowNewTaskInputs(store:Store,ticketId:string,previous:string[]){
 const c=store.get<TaskContinuation>('task-continuation',ticketId),ticket=store.tickets.get(ticketId)
 if(c&&ticket)store.put('task-continuation',ticketId,{...c,inputIds:[...new Set([...c.inputIds,...ticket.inputs.filter(i=>!previous.includes(i.id)).map(i=>i.id)])]})
}
