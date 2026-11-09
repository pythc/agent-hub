import {builtins} from './prompts.ts'
import { z } from 'zod'
import { configSchema, type Config } from './config.ts'
import type { Store } from './store.ts'
import {validateBackendSelection} from './backend-config.ts'
import {normalizeWorkerCount} from './worker-pool.ts'
import {sourceDeployment} from './connector-config.ts'

const editableSchema = configSchema.pick({decision:true,backends:true,execution:true,models:true,model:true,effort:true,concurrency:true,acceptMode:true,rules:true,prompts:true,sources:true,watchdog:true,work:true,delivery:true})
// Zod 4 optional/default fields materialize defaults even when omitted. A patch
// must only touch supplied keys; test undefined before entering the full schema.
type EditableShape = typeof editableSchema.shape
const patchShape = Object.fromEntries(Object.entries(editableSchema.shape).map(([key,schema])=>[key,z.union([z.undefined(),schema]).optional()])) as {
  [K in keyof EditableShape]: z.ZodOptional<z.ZodUnion<[z.ZodUndefined,EditableShape[K]]>>
}
export const patchSchema = z.object(patchShape).strict()
export interface SettingsVersion { revision:number; at:string; config:Config }
export class SettingsError extends Error {
 constructor(readonly code:'settings_conflict'|'restart_required',message:string,readonly status=400){super(message)}
}
export class Settings {
  constructor(private readonly store:Store, readonly config:Config) {
    normalizeWorkerCount(config)
    const saved=store.get<SettingsVersion>('settings','current')
    if(saved){
      const dynamic=Object.fromEntries(Object.keys(patchSchema.shape).filter(k=>k!=='sources'&&(k!=='backends'||store.get('settings-backends','managed'))&&k in saved.config).map(k=>[k,(saved.config as any)[k]]))
      if(dynamic.backends){
        const backends={...saved.config.backends}
        for(const [id,previous] of Object.entries(backends))if(previous.kind==='plugin'&&config.backends[id]?.kind!=='plugin')throw Error('Execution plugin backend cannot be silently removed or replaced')
        for(const [id,deployment] of Object.entries(config.backends))if(deployment.kind==='plugin'){
          const previous=saved.config.backends[id]
          // Code, credentials and filesystem grants come from reviewed startup
          // configuration. Only live display/model defaults survive restarts.
          backends[id]={...deployment,...(previous?.kind==='plugin'?{label:previous.label,model:previous.model,defaults:previous.defaults}:{})}
        }
        dynamic.backends=backends
      }
      const sources=config.sources.map(source=>{
        const previous=saved.config.sources.find(s=>s.id===source.id)
        if(!previous)return source
        const keys=['allowedActors','allowedBots','enabled','admission','listenScopes','pollSeconds','memberSync']
        return {...source,...Object.fromEntries(keys.filter(k=>k in previous).map(k=>[k,(previous as any)[k]]))}
      })
      Object.assign(config,configSchema.parse({...config,...dynamic,sources}));validateBackendSelection(config);normalizeWorkerCount(config)
      store.put('settings','current',{...saved,config})
    }
    else store.put('settings','current',{revision:0,at:new Date().toISOString(),config})
  }
  current():SettingsVersion{return this.store.get<SettingsVersion>('settings','current')!}
  save(expected:number,patch:unknown):SettingsVersion{
    const update=patchSchema.parse(patch)
    const next=this.store.atomic(()=>{
      const previous=this.current()
      if(previous.revision!==expected)throw new SettingsError('settings_conflict','Settings conflict. Read current revision before saving.',409)
      const config=configSchema.parse({...this.config,...update})
      validateBackendSelection(config)
      normalizeWorkerCount(config)
      const pluginDeployment=(backends:Config['backends'])=>Object.fromEntries(Object.entries(backends).filter(([,b])=>b.kind==='plugin').map(([id,b])=>{const {label,model,defaults,...deployment}=b;return [id,deployment]}))
      if(update.backends&&JSON.stringify(pluginDeployment(config.backends))!==JSON.stringify(pluginDeployment(this.config.backends)))throw new SettingsError('restart_required','Execution backend deployment changes require a controlled restart')
      for(const [key,override] of Object.entries(config.prompts.overrides))if(override.text===builtins[key as keyof typeof builtins])delete config.prompts.overrides[key]
      if(new Set(config.sources.map(s=>s.id)).size!==config.sources.length)throw Error('Duplicate source id')
      const deployment=sourceDeployment
      if(update.sources && JSON.stringify(update.sources.map(deployment))!==JSON.stringify(this.config.sources.map(deployment)))throw new SettingsError('restart_required','Source deployment changes require a controlled restart')
      const next={revision:expected+1,at:new Date().toISOString(),config}
      this.store.put('settings-history',String(previous.revision),previous)
      this.store.put('settings','current',next)
      if(update.backends)this.store.put('settings-backends','managed',true)
      return next
    })
    Object.assign(this.config,next.config)
    return next
  }
  history():SettingsVersion[]{return [...this.store.list<SettingsVersion>('settings-history'),this.current()]}
}
