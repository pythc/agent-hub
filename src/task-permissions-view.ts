import type {Runtime} from './runtime.ts'
import type {ContextManifest} from './router-memory.ts'
export type PermissionReason='management_disabled'|'source_disabled'|'scope_not_listened'|'member_not_admitted'|'entry_unavailable'|'input_changed'|'authority_unavailable'|'task_unavailable'|'request_scope_missing'|'requester_or_manager_required'|'current'
export interface TaskPermissionsView {schema:1;readOnly:true;authorization:false;observedAt:number;subject:{kind:'task';id:string};reason:PermissionReason;action:'task_followup';execution:'not_assessed'}
/** Fixed codes only. No actor, resource, account, configuration or exception text leaves this view. */
export function taskPermissionsView(h:Runtime,id:string,now=Date.now()):TaskPermissionsView|undefined {
 return h.scopes.readOnly(()=>h.memory.readOnly(()=>{
  const ticket=h.store.tickets.get(id)
  if(!ticket||ticket.id!==id||h.memory.cleanup.blocked('ticket',id,ticket)||!Number.isSafeInteger(now)||now<0)return
  const owner=h.scopes.ownership(id)
  // Private/unknown audiences cannot be diagnosed via the global operator drawer.
  if(h.scopes.enabled()){
   if(!owner||owner.ticketId!==id)return
   try{if(h.scopes.binding(owner.originEntry).privateActor)return}catch{return}
  }
  const authority=h.taskAuthority(id),parent=authority?.parentTrigger??ticket.origin.triggerId,trigger=h.store.triggers.get(parent)
  if(!trigger||trigger.id!==parent||h.memory.cleanup.blocked('trigger',parent,trigger))return
  if(h.scopes.enabled()){
   const currentEntry=h.scopes.entry(trigger)
   if(!currentEntry||currentEntry.privateActor)return
  }
  const discussion=authority?.discussion??trigger.source+':'+trigger.threads[0]?.id
  const result=(reason:PermissionReason):TaskPermissionsView=>({schema:1,readOnly:true,authorization:false,observedAt:now,subject:{kind:'task',id},reason,action:'task_followup',execution:'not_assessed'})
  if(ticket.ended)return result('task_unavailable')
  if(!h.config.execution.management?.enabled)return result('management_disabled')
  const ingress=h.routerIngress.explain(parent,discussion)
  if(ingress!=='current')return result(ingress)
  try{
   const c=h.scopes.context(trigger,discussion)
   if(c){
    h.scopes.assertCurrent(c);h.scopes.checkTask(id,c)
    try{h.scopes.checkTaskEntry(h.scopes.ownership(id)!,c.route.entryId,'request')}catch{return result('request_scope_missing')}
    try{h.scopes.checkTask(id,c,true)}catch{return result('requester_or_manager_required')}
   }
   // WorkerManager also retains the assignment/continuation authority after a newer input.
   const assignment=h.store.get<{parentTrigger?:string;discussion:string}>('worker-assignment',id)
   const continuation=h.store.get<{triggerId:string;discussion:string}>('task-continuation',id)
   const retained=continuation?{id:continuation.triggerId,discussion:continuation.discussion}:assignment?.parentTrigger?{id:assignment.parentTrigger,discussion:assignment.discussion}:undefined
   if(retained){
    if(h.scopes.enabled()){const t=h.store.triggers.get(retained.id),entry=t&&h.scopes.entry(t);if(!entry||entry.privateActor)return}
    try{h.routerIngress.authority(retained.id,retained.discussion)}catch{return result('authority_unavailable')}
   }
   if(!h.scopes.taskRunnable(id))return result('task_unavailable')
   const saved=h.store.get<{manifest:ContextManifest}>('task-context',id)
   if(saved)h.memory.validate(saved.manifest)
  }catch{return result('task_unavailable')}
  return result('current')
 }))
}
