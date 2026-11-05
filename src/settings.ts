import {builtins} from './prompts.ts'
import { z } from 'zod'
import { configSchema, type Config } from './config.ts'
import type { Store } from './store.ts'
import {validateBackendSelection} from './backend-config.ts'
import {normalizeWorkerCount} from './worker-pool.ts'

export const patchSchema = configSchema.pick({execution:true,models:true,model:true,effort:true,concurrency:true,acceptMode:true,rules:true,prompts:true,sources:true,watchdog:true,work:true,delivery:true}).partial()
export interface SettingsVersion { revision:number; at:string; config:Config }
export class SettingsError extends Error {
 constructor(readonly code:'settings_conflict'|'restart_required',message:string,readonly status=400){super(message)}
}
export class Settings {
  constructor(private readonly store:Store, readonly config:Config) {
    normalizeWorkerCount(config)
    const saved=store.get<SettingsVersion>('settings','current')
    if(saved){
      const dynamic=Object.fromEntries(Object.keys(patchSchema.shape).filter(k=>k!=='sources'&&k in saved.config).map(k=>[k,(saved.config as any)[k]]))
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
      for(const [key,override] of Object.entries(config.prompts.overrides))if(override.text===builtins[key as keyof typeof builtins])delete config.prompts.overrides[key]
      if(new Set(config.sources.map(s=>s.id)).size!==config.sources.length)throw Error('Duplicate source id')
      const deployment=(s:Config['sources'][number])=>({id:s.id,kind:s.kind,cwd:s.cwd,workspace:s.workspace,sandbox:s.sandbox,repository:s.repository,feishu:s.feishu,wecom:s.wecom,github:s.github,replyUrl:s.replyUrl,tokenEnv:s.tokenEnv})
      if(update.sources && JSON.stringify(update.sources.map(deployment))!==JSON.stringify(this.config.sources.map(deployment)))throw new SettingsError('restart_required','Source deployment changes require a controlled restart')
      const next={revision:expected+1,at:new Date().toISOString(),config}
      this.store.put('settings-history',String(previous.revision),previous)
      this.store.put('settings','current',next)
      return next
    })
    Object.assign(this.config,next.config)
    return next
  }
  history():SettingsVersion[]{return [...this.store.list<SettingsVersion>('settings-history'),this.current()]}
}
