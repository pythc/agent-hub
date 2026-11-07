import {pathToFileURL} from 'node:url'
import {isAbsolute} from 'node:path'
import type {Config,SourceConfig} from './config.ts'
import {MessageSource,type Source} from './sources.ts'
import {GithubSource} from './connectors/github.ts'
import {FeishuSource} from './connectors/feishu.ts'
import {WecomSource} from './connectors/wecom.ts'
import type {Ticket} from './vendor/dsh-core/index.ts'

/** Plugins are trusted local code, loaded only from explicitly configured files. */
export interface SourcePlugin {
  apiVersion:1
  kind:string
  label:string
  validate?(config:SourceConfig):void
  create(config:SourceConfig):Source
  observed?(config:SourceConfig):boolean
  authorizeRead?(config:SourceConfig,ticket:Ticket,resource:string):void
}
export class SourceRegistry {
  private readonly plugins=new Map<string,SourcePlugin>()
  constructor(){
    for(const [kind,label,create] of [
      ['local','Local operator',(c:SourceConfig)=>new MessageSource(c)],
      ['webhook','HTTP events',(c:SourceConfig)=>new MessageSource(c)],
      ['github','GitHub',(c:SourceConfig)=>new GithubSource(c)],
      ['feishu','Feishu',(c:SourceConfig)=>new FeishuSource(c)],
      ['wecom','WeCom',(c:SourceConfig)=>new WecomSource(c)],
    ] as const)this.register({apiVersion:1,kind,label,create,...(kind==='github'?{observed:(c:SourceConfig)=>!!c.github?.receiveAll,authorizeRead:GithubSource.authorizeRead}:{})})
  }
  register(plugin:SourcePlugin){
    if(!plugin||plugin.apiVersion!==1||!/^[a-z][a-z0-9_-]*$/.test(plugin.kind)||typeof plugin.label!=='string'||typeof plugin.create!=='function')throw Error('Invalid source plugin; expected API version 1')
    if(this.plugins.has(plugin.kind))throw Error('Duplicate source plugin: '+plugin.kind)
    this.plugins.set(plugin.kind,plugin)
  }
  create(config:SourceConfig){
    const plugin=this.plugins.get(config.kind)
    if(!plugin)throw Error('Unknown source kind '+config.kind+'; register its sourcePlugins module or use kind webhook')
    plugin.validate?.(config)
    const source=plugin.create(config)
    if(source.config!==config||typeof source.trigger!=='function'||typeof source.deliver!=='function')throw Error('Invalid source implementation: '+config.kind)
    return source
  }
  catalog(){return [...this.plugins.values()].map(({kind,label,apiVersion})=>({kind,label,apiVersion}))}
  observed(config:SourceConfig){return config.observed??this.plugins.get(config.kind)?.observed?.(config)??true}
  authorizeRead(config:SourceConfig,ticket:Ticket,resource:string){this.plugins.get(config.kind)?.authorizeRead?.(config,ticket,resource)}
  static async load(config:Config){
    const registry=new SourceRegistry()
    for(const entry of config.sourcePlugins){
      if(!isAbsolute(entry.module))throw Error('Source plugin module must be absolute; loadConfig resolves paths relative to the configuration file')
      const module=await import(pathToFileURL(entry.module).href)
      registry.register(module.default)
    }
    return registry
  }
}
export const builtinSources=new SourceRegistry()
