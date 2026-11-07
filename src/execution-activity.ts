import {randomUUID} from 'node:crypto'
import type {Store} from './store.ts'

export interface ExecutionContext {ticketId?:string;workerId?:string;agentId?:string;sourceId?:string;triggerId?:string}
export interface ExecutionCall extends ExecutionContext {
 id:string;kind:'router'|'worker'|'subagent'|'tool';name:string;parentId?:string
 backend?:string;model?:string;startedAt:number;endedAt?:number
 state:'running'|'completed'|'failed'|'interrupted'
 action?:string;target?:string
}
/** Metadata only: never copy prompts, tool arguments, output or provider errors. */
export class ExecutionActivity {
 private listeners=new Set<(call:ExecutionCall)=>void>()
 subscribe(listener:(call:ExecutionCall)=>void){this.listeners.add(listener);return()=>{this.listeners.delete(listener)}}
 private changed(call:ExecutionCall){for(const listener of this.listeners)listener(call)}
 constructor(private store:Store){
  for(const call of this.list())if(call.state==='running')this.finish(call.id,'interrupted')
 }
 list(){return this.store.list<ExecutionCall>('execution-call')}
 begin(kind:ExecutionCall['kind'],name:string,context:ExecutionContext={},parentId?:string,details:Pick<ExecutionCall,'action'|'target'>={}){
  const call:ExecutionCall={...context,...details,id:randomUUID(),kind,name:name.slice(0,100),parentId,startedAt:Date.now(),state:'running'}
  this.store.put('execution-call',call.id,call)
  this.changed(call)
  this.prune()
  return call.id
 }
 private prune(){
  // Open-task calls are acceptance evidence, not disposable display history.
  // Unrelated Router/verifier activity must not change a retained failure snapshot.
  const open=new Set(this.store.tickets.open().map(t=>t.id))
  const old=this.list().filter(c=>c.state!=='running'&&(!c.ticketId||!open.has(c.ticketId))).reverse().sort((a,b)=>(b.endedAt??b.startedAt)-(a.endedAt??a.startedAt)).slice(200)
  for(const item of old)this.store.db.prepare("DELETE FROM records WHERE kind='execution-call' AND id=?").run(item.id)
 }
 update(id:string,values:Pick<ExecutionCall,'backend'|'model'>){
  const call=this.store.get<ExecutionCall>('execution-call',id);if(!call)return
  const next={...call,...(values.backend?{backend:values.backend.slice(0,200)}:{}),...(values.model?{model:values.model.slice(0,200)}:{})}
  this.store.put('execution-call',id,next);this.changed(next)
 }
 finish(id:string,state:Exclude<ExecutionCall['state'],'running'>){
  const call=this.store.get<ExecutionCall>('execution-call',id);if(!call||call.state!=='running')return
  const next={...call,state,endedAt:Date.now()}
  this.store.put('execution-call',id,next);this.changed(next)
  this.prune()
 }
 parent(context:ExecutionContext){return this.list().findLast(c=>c.kind!=='tool'&&c.state==='running'&&c.ticketId===context.ticketId&&c.agentId===context.agentId)?.id}
 async tool<T extends {success:boolean}>(name:string,context:ExecutionContext,run:()=>Promise<T>,parentId=this.parent(context),details:Pick<ExecutionCall,'action'|'target'>={}){
  const id=this.begin('tool',name,context,parentId,details)
  try{const result=await run();this.finish(id,result.success?'completed':'failed');return result}
  catch(error){this.finish(id,'failed');throw error}
 }
}
