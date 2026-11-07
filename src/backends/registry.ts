import type {Config} from '../config.ts'
import {validateBackendSelection,type BackendDefinition,type AgentOptions} from '../backend-config.ts'
import {mergeOptions,apiOptions} from '../agent-options.ts'
import {SubscriptionAccounts} from './subscription.ts'
import {CodexModel,nativeContextProfile} from '../codex.ts'
import type {BackendDescription,Model,ModelRequest,ModelResult} from '../model.ts'
import {ApiModel,type ThreadStore} from './api.ts'
interface Binding {id:string;kind:string;endpoint?:string;identity?:string}
/** New work follows role settings; existing conversations stay bound to their original backend. */
export class BackendRegistry implements Model {
 private writers=new Set<string>()
 constructor(private config:Config,private store:ThreadStore){validateBackendSelection(config)}
 selected(role:'router'|'worker'|'subagent'='worker'){return (role==='router'?this.config.execution.router?.backend:undefined)??this.config.execution.roles[role]??this.config.execution.backend}
 definition(id:string):BackendDefinition{
  const d=this.config.backends[id]??(id==='codex'?{kind:'codex' as const}:undefined)
  if(!d)throw Error('Backend '+id+' is no longer configured; existing threads cannot migrate implicitly')
  return d
 }
 private binding(id:string):Binding{const d=this.definition(id);return {id,kind:d.kind,identity:JSON.stringify(d.kind==='codex'?{command:d.command??this.config.codex,args:d.args??[],env:d.env??{}}:{account:d.subscription?.account,owner:d.subscription?.owner,apiKeyEnv:d.apiKeyEnv,headerEnv:d.headerEnv??{}}),...(d.kind!=='codex'?{endpoint:d.baseUrl.replace(/\/+$/,'')}:{})}}
 private forThread(threadId:string,deleting=false):string{
  if(!deleting&&this.store.get('context-session-fence',threadId))throw Error('Context permissions changed; this history is quarantined')
  if(!deleting&&(this.store.get('backend-deleted',threadId)||this.store.get('backend-delete-pending',threadId)))throw Error('Backend history deletion fence is active; explicit fresh context required')
  const saved=this.store.get<Binding>('backend-binding',threadId)
  if(saved){if(saved.kind!==this.binding(saved.id).kind||saved.endpoint!==this.binding(saved.id).endpoint||saved.identity!==undefined&&saved.identity!==this.binding(saved.id).identity)throw Error('Thread backend identity or endpoint changed; explicit migration is required');return saved.id}
  if(threadId.startsWith('api:'))throw Error('API thread has no backend binding')
  return 'codex' // Pre-registry native Codex conversations retain their original executor.
 }
 private model(id:string,options:AgentOptions={}):Model{
  const d=this.definition(id)
  if(d.kind==='codex')return new CodexModel({...this.config,model:d.model??this.config.model,codex:d.command??this.config.codex,turnTimeoutMs:options.timeoutMs??this.config.turnTimeoutMs},d.args??[],d.env)
  const definition=apiOptions(d,options)
  return new ApiModel(id,definition,this.store,options.timeoutMs??this.config.turnTimeoutMs,d.subscription?()=>new SubscriptionAccounts(this.config.stateDir).credential(d.subscription!.account):undefined)
 }
 describe(threadId?:string,role:'router'|'worker'|'subagent'='worker'):BackendDescription{const id=threadId?this.forThread(threadId):this.selected(role);return {...this.model(id).describe!(),id}}
 configured(){return [...new Set([...Object.keys(this.config.backends),this.selected('router'),this.selected('worker'),this.selected('subagent'),...(this.config.execution.workers??[]).map(w=>w.backend)])].map(id=>({...this.model(id).describe!(),id,...(this.definition(id).label?{label:this.definition(id).label}:{})}))}
 async run(r:ModelRequest):Promise<ModelResult>{
  const id=r.threadId?this.forThread(r.threadId):r.backendId??this.selected(r.role??(r.ephemeral?'router':'worker'))
  const definition=structuredClone(this.definition(id)),role=r.role??(r.ephemeral?'router':'worker')
  const options=mergeOptions(definition.defaults,r.options??(role==='router'?this.config.execution.router:undefined))
  if(definition.kind!=='codex'&&definition.subscription){
   const sub=definition.subscription
   if(!sub.backgroundAuthorized||!r.principal||r.principal.source!==sub.owner.source||r.principal.actor!==sub.owner.actor)throw Error('Subscription requires its owner and authorized background activity')
  }
  if(r.threadId&&this.writers.has(r.threadId))throw Error('Backend thread already has an active writer')
  let locked=r.threadId;if(locked)this.writers.add(locked)
  const binding=this.binding(id)
  const legacyContext=definition.kind==='codex'&&r.managed&&!!r.threadId&&this.store.get<{version:number}>('native-context',r.threadId)?.version!==nativeContextProfile
  const compact=legacyContext&&!r.skipContextCompaction
  let nativeThread=r.threadId
  r.onBackend?.(id)
  try{return await this.model(id,options).run({...r,options,compactBeforeTurn:!!compact,onContextReady:()=>{if(definition.kind==='codex'&&r.managed&&nativeThread&&(!legacyContext||compact))this.store.put('native-context',nativeThread,{version:nativeContextProfile,at:Date.now(),compacted:!!compact});r.onContextReady?.()},instructions:r.instructions+(options.prompt?'\nAgent instructions:\n'+options.prompt:''),model:r.model??(!r.threadId&&role==='router'?this.config.execution.router?.model:undefined),onThread:threadId=>{nativeThread=threadId;if(!locked){locked=threadId;this.writers.add(threadId)}this.store.put('backend-binding',threadId,binding);r.onThread?.(threadId)}})}
  finally{if(locked)this.writers.delete(locked)}
 }
 async history(threadId:string,cwd:string){return this.model(this.forThread(threadId)).history!(threadId,cwd)}
 async purge(threadId:string,cwd:string){if(this.writers.has(threadId))throw Error('Thread writer must stop before deletion');const model=this.model(this.forThread(threadId,true));if(!model.purge)throw Error('Backend cannot verify local history deletion');const result=await model.purge(threadId,cwd);this.store.put('backend-deleted',threadId,{threadId,at:Date.now()});return result}
 async expose(threadId:string,cwd:string){const model=this.model(this.forThread(threadId));if(!model.describe?.().nativeTakeover)throw Error('This backend has no native desktop chat; inspect its history in the AgentHub resource panel');await model.expose!(threadId,cwd)}
 async catalog(provider?:string){
  // Preserve the pre-registry models/<native-provider> resource in Codex setups.
  const legacy=provider&&provider!=='codex'&&!this.config.backends[provider]&&this.definition(this.selected()).kind==='codex'
  const id=legacy?this.selected():provider??this.selected(),catalog=await this.model(id).catalog?.(legacy?provider:this.definition(id).kind==='codex'?undefined:id)
  return {...catalog,backendId:id,roles:{router:this.selected('router'),worker:this.selected('worker'),subagent:this.selected('subagent')},backends:this.configured()}
 }
}
