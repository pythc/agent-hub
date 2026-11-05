import type {Config} from '../config.ts'
import {validateBackendSelection,type BackendDefinition} from '../backend-config.ts'
import {CodexModel} from '../codex.ts'
import type {BackendDescription,Model,ModelRequest,ModelResult} from '../model.ts'
import {ApiModel,type ThreadStore} from './api.ts'
interface Binding {id:string;kind:string;endpoint?:string}
/** New work follows role settings; existing conversations stay bound to their original backend. */
export class BackendRegistry implements Model {
 private apis=new Map<string,ApiModel>()
 constructor(private config:Config,private store:ThreadStore){validateBackendSelection(config)}
 selected(role:'router'|'worker'|'subagent'='worker'){return this.config.execution.roles[role]??this.config.execution.backend}
 definition(id:string):BackendDefinition{
  const d=this.config.backends[id]??(id==='codex'?{kind:'codex' as const}:undefined)
  if(!d)throw Error('Backend '+id+' is no longer configured; existing threads cannot migrate implicitly')
  return d
 }
 private binding(id:string):Binding{const d=this.definition(id);return {id,kind:d.kind,...(d.kind!=='codex'?{endpoint:d.baseUrl.replace(/\/+$/,'')}:{})}}
 private forThread(threadId:string):string{
  const saved=this.store.get<Binding>('backend-binding',threadId)
  if(saved){if(JSON.stringify(saved)!==JSON.stringify(this.binding(saved.id)))throw Error('Thread backend identity or endpoint changed; explicit migration is required');return saved.id}
  if(threadId.startsWith('api:'))throw Error('API thread has no backend binding')
  return 'codex' // Pre-registry native Codex conversations retain their original executor.
 }
 private model(id:string):Model{
  const d=this.definition(id)
  if(d.kind==='codex')return new CodexModel({...this.config,codex:d.command??this.config.codex})
  let model=this.apis.get(id);if(!model){model=new ApiModel(id,d,this.store,this.config.turnTimeoutMs);this.apis.set(id,model)}
  return model
 }
 describe(threadId?:string,role:'router'|'worker'|'subagent'='worker'):BackendDescription{const id=threadId?this.forThread(threadId):this.selected(role);return {...this.model(id).describe!(),id}}
 configured(){return [...new Set([...Object.keys(this.config.backends),this.selected('router'),this.selected('worker'),this.selected('subagent'),...(this.config.execution.workers??[]).map(w=>w.backend)])].map(id=>({...this.model(id).describe!(),id,...(this.definition(id).label?{label:this.definition(id).label}:{})}))}
 async run(r:ModelRequest):Promise<ModelResult>{
  const id=r.threadId?this.forThread(r.threadId):r.backendId??this.selected(r.role??(r.ephemeral?'router':'worker'))
  r.onBackend?.(id)
  return this.model(id).run({...r,onThread:threadId=>{this.store.put('backend-binding',threadId,this.binding(id));r.onThread?.(threadId)}})
 }
 async history(threadId:string,cwd:string){return this.model(this.forThread(threadId)).history!(threadId,cwd)}
 async expose(threadId:string,cwd:string){const model=this.model(this.forThread(threadId));if(!model.describe?.().nativeTakeover)throw Error('This backend has no native desktop chat; inspect its history in the AgentHub resource panel');await model.expose!(threadId,cwd)}
 async catalog(provider?:string){
  // Preserve the pre-registry models/<native-provider> resource in Codex setups.
  const legacy=provider&&provider!=='codex'&&!this.config.backends[provider]&&this.definition(this.selected()).kind==='codex'
  const id=legacy?this.selected():provider??this.selected(),catalog=await this.model(id).catalog?.(legacy?provider:this.definition(id).kind==='codex'?undefined:id)
  return {...catalog,backendId:id,roles:{router:this.selected('router'),worker:this.selected('worker'),subagent:this.selected('subagent')},backends:this.configured()}
 }
}
