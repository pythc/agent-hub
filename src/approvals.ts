import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Store } from './store.ts'
import type { NativeRequest } from './model.ts'

export interface Approval { id:string; ticketId:string; native:NativeRequest; createdAt:number; expiresAt:number; status:'pending'|'resolved'|'expired' }
export class Approvals {
  private readonly pending=new Map<string,{resolve:(value:unknown)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}>()
  constructor(private readonly store:Store){
    for(const value of store.list<Approval>('approval'))if(value.status==='pending')store.put('approval',value.id,{...value,status:'expired'})
  }
  request(ticketId:string,native:NativeRequest):Promise<unknown>{
    const id=randomUUID(),expiresAt=Date.now()+120000
    this.store.put('approval',id,{id,ticketId,native,createdAt:Date.now(),expiresAt,status:'pending'})
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>this.expire(id),120000)
      this.pending.set(id,{resolve,reject,timer})
    })
  }
  answer(id:string,value:unknown):void{
    const item=this.store.get<Approval>('approval',id),pending=this.pending.get(id)
    if(!item||item.status!=='pending'||!pending||item.expiresAt<=Date.now())throw Error('Approval is expired or no longer active')
    let result:unknown
    if(item.native.method==='item/tool/requestUserInput'){
      const answers=z.record(z.string(),z.object({answers:z.array(z.string()).max(10)}).strict()).parse(value)
      const ids=(item.native.params.questions??[]).map((q:any)=>q.id)
      if(Object.keys(answers).some(k=>!ids.includes(k)))throw Error('Unknown question id')
      if(ids.some((id:string)=>!answers[id]?.answers.length||answers[id]!.answers.some(a=>!a.trim())))throw Error('Answer each question before submitting')
      result={answers}
    }else if(item.native.method==='item/permissions/requestApproval'){
      const decision=z.enum(['accept','decline']).parse(value)
      result={permissions:decision==='accept'?item.native.params.permissions??{}:{},scope:'turn'}
    }else result={decision:z.enum(['accept','decline']).parse(value)}
    this.store.put('approval',id,{...item,status:'resolved',decision:result})
    clearTimeout(pending.timer);this.pending.delete(id);pending.resolve(result)
  }
  private expire(id:string){
    const item=this.store.get<Approval>('approval',id),pending=this.pending.get(id)
    if(item)this.store.put('approval',id,{...item,status:'expired'})
    if(pending){clearTimeout(pending.timer);this.pending.delete(id);pending.reject(Error('Approval expired'))}
  }
  cancel(ticketId:string){for(const item of this.store.list<Approval>('approval'))if(item.ticketId===ticketId&&item.status==='pending')this.expire(item.id)}
  close(){for(const id of [...this.pending.keys()])this.expire(id)}
}
