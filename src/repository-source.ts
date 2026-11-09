import {z} from 'zod'
import {createHash} from 'node:crypto'
import type {Source} from './sources.ts'
import type {Store} from './store.ts'
import type {Engine} from './vendor/dsh-core/index.ts'
import type {Runtime} from './runtime.ts'
import type {Trigger} from './vendor/dsh-core/index.ts'

export interface RepositoryAccess {
 id:string
 remotes:string[]
 threadPrefix:string
 pushCredential:{kind:'environment';variable:string;username:string}|{kind:'helper';command:string;args:string[]}
}
/** Provider-independent code-host contract. Platform packages normalize their
 * API snapshots to this contract; only the host decides whether to act. */
export interface RepositoryMethods {
 readonly code:RepositoryAccess
 repositoryPull(number:number):Promise<any>
 mergeSnapshot(number:number):Promise<any>
 reviewGraph(number:number):Promise<any>
 resolveReview(number:number,threadId:string,mayAct?:()=>boolean):Promise<void>
 draft(branch:string,title:string,body:string,mayAct?:()=>boolean):Promise<any>
 mergeIdentity(identityHint?:string):Promise<{login:string}>
 merge(number:number,head:string,method:'squash'|'merge'|'rebase',identityHint?:string,mayAct?:()=>boolean):Promise<{merged:boolean;sha?:string}>
}
export type RepositorySource=Source&RepositoryMethods
export function repositoryEffectsSettled(store:Store,ticketId:string){
 const prefix=ticketId+':'
 if(store.db.prepare("SELECT 1 FROM records WHERE kind='pr-delivery' AND substr(id,1,?)=? AND json_extract(body,'$.phase') IN ('pushing','creating','uncertain') LIMIT 1").get(prefix.length,prefix))return false
 if(store.list<any>('review-action').some(r=>r.ticketId===ticketId&&r.phase==='pending'))return false
 return !store.list<any>('merge-attempt').some(r=>['submitting','uncertain'].includes(r.phase)&&store.get<any>('merge-grant',r.id)?.ticketId===ticketId)
}
export function isRepositorySource(source:Source|undefined):source is RepositorySource {
 return !!source?.code&&['repositoryPull','mergeSnapshot','reviewGraph','resolveReview','draft','mergeIdentity','merge'].every(m=>typeof (source as any)[m]==='function')
}
export function repositoryNumber(source:RepositorySource,thread:string){
 if(!thread.startsWith(source.code.threadPrefix)||!source.validThread?.(thread))throw Error('Thread is outside the repository')
 const number=Number(thread.slice(source.code.threadPrefix.length))
 if(!Number.isSafeInteger(number)||number<1||String(number)!==thread.slice(source.code.threadPrefix.length))throw Error('Invalid repository thread number')
 return number
}
export function canContinueRepositoryTask(host:Runtime,trigger:Trigger,ticketId:string){
 const source=host.sources.get(trigger.source),ticket=host.store.tickets.get(ticketId),owner=host.taskAuthority(ticketId)
 if(!isRepositorySource(source)||!ticket||ticket.ended||owner?.mode!=='host'||!owner.parentTrigger||owner.source!==trigger.source)return false
 if(!(trigger.human?source.config.allowedActors:source.config.allowedBots).includes(trigger.actor.id))return false
 if(!trigger.threads.some(ref=>ref.source===trigger.source&&source.validThread?.(ref.id)&&ticket.follows?.some(f=>f.own&&f.thread===ref.source+':'+ref.id)))return false
 try{
  host.routerIngress.authority(owner.parentTrigger,owner.discussion)
  if(trigger.human){const c=host.scopes.context(trigger,trigger.source+':'+trigger.threads[0]!.id);if(!c)return false;host.scopes.checkTask(ticketId,c,true)}
  return true
 }catch{return false}
}
export const repositoryUpdateSchema=z.object({thread:z.string().min(1).max(300),repository:z.string().min(1).max(300),state:z.enum(['open','closed','merged']),at:z.string().datetime({offset:true}),pull:z.boolean(),branch:z.string().max(300).optional(),head:z.string().regex(/^[a-f0-9]{40,64}$/).optional()}).strict()
export type RepositoryUpdate=z.infer<typeof repositoryUpdateSchema>
/** A verified provider observation can bind an already-owned branch, never
 * create work, alter its mandate, or mark a goal's acceptance as passed. */
export function observeRepository(source:Source,store:Store,engine:Engine,value:unknown){
 const update=repositoryUpdateSchema.parse(value)
 if(!isRepositorySource(source)||!source.config.enabled||!source.config.capabilities.events||source.code.id!==update.repository)throw Error('Repository observation is outside its connection')
 repositoryNumber(source,update.thread)
 if(update.pull&&update.branch){
  const ticket=store.tickets.open().find(t=>t.mandate.actor.source===source.config.id&&update.branch==='superagent/'+createHash('sha256').update(t.id).digest('hex').slice(0,20))
  if(ticket&&!ticket.follows?.some(f=>f.thread===source.config.id+':'+update.thread))engine.bindThread(ticket.id,{source:source.config.id,id:update.thread},true)
 }
 if(update.state!=='open')engine.threadClosed({source:source.config.id,id:update.thread},update.state,update.at)
}
