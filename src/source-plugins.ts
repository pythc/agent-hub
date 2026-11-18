import {pathToFileURL} from 'node:url'
import {isAbsolute} from 'node:path'
import type {Config,SourceConfig} from './config.ts'
import {MessageSource,type Source} from './sources.ts'
import githubPlugin from '../plugins/github/index.ts'
import feishuPlugin from '../plugins/feishu/index.ts'
import {WecomSource} from './connectors/wecom.ts'
import type {Ticket} from './vendor/dsh-core/index.ts'
import {installPluginPackage,pointer,pluginManifestSchema,type PluginPackage} from './plugin-package.ts'
import {ProcessSource} from './plugin-process.ts'
import {Ajv2020} from 'ajv/dist/2020.js'
import type {PluginManifest} from './plugin-package.ts'

/** Plugins are trusted local code, loaded only from explicitly configured files. */
export interface SourcePlugin {
  apiVersion:1
  kind:string
  label:string
  validate?(config:SourceConfig):void
  create(config:SourceConfig):Source
  /** Optional setup metadata shares the packaged source-plugin vocabulary. */
  connection?:{setup:PluginManifest['setup'];credentials?:Record<string,string>;scopesPath?:string;validate?:(config:SourceConfig)=>void;validateFields?:(config:SourceConfig)=>{field:string;code:'required'|'invalid_format'|'invalid_environment_reference'|'credential_unavailable'|'too_many'|'unsupported_field'}[]}
  observed?(config:SourceConfig):boolean
  authorizeRead?(config:SourceConfig,ticket:Ticket,resource:string):void
  /** Platform membership facts. Host actor/tenant/mandate checks still apply. */
  scopes?(config:SourceConfig):string[]|undefined
  /** Exact durable cursor keys; absence means replay is unavailable. */
  replayCursors?(config:SourceConfig):string[]
}
export class SourceRegistry {
  private readonly plugins=new Map<string,SourcePlugin>()
  readonly packages:PluginPackage[]=[]
  constructor(){
    for(const [kind,label,create] of [
      ['local','Local operator',(c:SourceConfig)=>new MessageSource(c)],
      ['delegation','Delegated team',(c:SourceConfig)=>new MessageSource(c)],
      ['webhook','HTTP events',(c:SourceConfig)=>new MessageSource(c)],
      ['wecom','WeCom',(c:SourceConfig)=>new WecomSource(c)],
    ] as const)this.register({apiVersion:1,kind,label,create,...(kind==='wecom'?{scopes:(c:SourceConfig)=>c.wecom?.chats.length?c.wecom.chats:undefined}:{})})
    this.register(githubPlugin)
    this.register(feishuPlugin)
  }
  register(plugin:SourcePlugin){
    if(!plugin||plugin.apiVersion!==1||!/^[a-z][a-z0-9_-]*$/.test(plugin.kind)||typeof plugin.label!=='string'||typeof plugin.create!=='function')throw Error('Invalid source plugin; expected API version 1')
    if(this.plugins.has(plugin.kind))throw Error('Duplicate source plugin: '+plugin.kind)
    if(plugin.connection){
      const setup=pluginManifestSchema.shape.setup.safeParse(plugin.connection.setup),credentials=pluginManifestSchema.shape.credentials.safeParse(plugin.connection.credentials??{})
      if(!setup.success||!credentials.success||plugin.connection.scopesPath&&!pluginManifestSchema.shape.scopesPath.safeParse(plugin.connection.scopesPath).success)throw Error('Invalid source plugin setup metadata')
      plugin={...plugin,connection:{...plugin.connection,setup:setup.data,credentials:credentials.data}}
    }
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
  catalog(){return [...this.plugins.values()].map(({kind,label,apiVersion})=>{const pkg=this.packages.find(p=>p.manifest.kind===kind);return pkg?{kind,label,apiVersion:2,pluginId:pkg.manifest.id,version:pkg.manifest.version,digest:pkg.digest,configSchema:pkg.manifest.configSchema,setup:pkg.manifest.setup,methods:pkg.manifest.methods,tools:pkg.manifest.tools,network:pkg.manifest.network}:{kind,label,apiVersion}})}
  /** Static metadata only: no instance construction, credential reads or remote calls. */
  connectionDefinitions(){return [...this.plugins.values()].map(plugin=>{
    const pkg=this.packages.find(p=>p.manifest.kind===plugin.kind)
    return {kind:plugin.kind,label:plugin.label,...(pkg?{pluginId:pkg.manifest.id,version:pkg.manifest.version,digest:pkg.digest,setup:pkg.manifest.setup,credentials:pkg.manifest.credentials,scopesPath:pkg.manifest.scopesPath,configSchema:pkg.manifest.configSchema,network:pkg.manifest.network}:{setup:plugin.connection?.setup,credentials:plugin.connection?.credentials??{},scopesPath:plugin.connection?.scopesPath,network:!!plugin.connection?.setup?.serviceUrl})}
  })}
  validate(config:SourceConfig){
    const plugin=this.plugins.get(config.kind);if(!plugin)throw Error('Source kind is unavailable')
    plugin.validate?.(config);plugin.connection?.validate?.(config)
    const pkg=this.packages.find(p=>p.manifest.kind===config.kind)
    if(pkg&&!new Ajv2020({strict:false,validateFormats:false}).compile(pkg.manifest.configSchema)(config))throw Error('Source fields do not match the plugin schema')
  }
  /** Optional local issue metadata; validation remains authoritative. */
  validationIssues(config:SourceConfig){return this.plugins.get(config.kind)?.connection?.validateFields?.(config)??[]}
  observed(config:SourceConfig){return config.observed??this.plugins.get(config.kind)?.observed?.(config)??true}
  authorizeRead(config:SourceConfig,ticket:Ticket,resource:string){this.plugins.get(config.kind)?.authorizeRead?.(config,ticket,resource)}
  scopes(config:SourceConfig){return this.plugins.get(config.kind)?.scopes?.(config)}
  allowsScope(config:SourceConfig,id:string){const native=this.scopes(config);return (!config.listenScopes||config.listenScopes.includes(id))&&(!native||native.includes(id))}
  replayCursors(config:SourceConfig){return this.plugins.get(config.kind)?.replayCursors?.(config)??[]}
  static async load(config:Config){
    const registry=new SourceRegistry()
    for(const entry of config.sourcePlugins){
      if('directory'in entry){
        const pkg=installPluginPackage(entry.directory,config.stateDir,entry.digest)
        if(registry.packages.some(p=>p.manifest.kind===pkg.manifest.kind))throw Error('Duplicate plugin package kind')
        if(registry.plugins.has(pkg.manifest.kind)){if(!entry.replaceBuiltin)throw Error('Explicit replacement required for built-in adapter');registry.plugins.delete(pkg.manifest.kind)}
        registry.packages.push(pkg)
        registry.register({apiVersion:1,kind:pkg.manifest.kind,label:pkg.manifest.label,
          observed:c=>pkg.manifest.observedPath?!!pointer(c,pkg.manifest.observedPath):true,
          scopes:c=>pointer(c,pkg.manifest.scopesPath) as string[],
          replayCursors:c=>pkg.manifest.cursorMode==='scope'?(pointer(c,pkg.manifest.scopesPath) as string[]).map(id=>c.id+':'+id):pkg.manifest.cursorMode==='source'?[c.id]:[],
          create:c=>new ProcessSource(c,pkg,{sandboxDriver:config.work.sandboxDriver,codex:config.codex,stateDir:config.stateDir,readPaths:entry.readPaths}),
        });continue
      }
      if(!isAbsolute(entry.module))throw Error('Source plugin module must be absolute; loadConfig resolves paths relative to the configuration file')
      const module=await import(pathToFileURL(entry.module).href)
      registry.register(module.default)
    }
    return registry
  }
}
export const builtinSources=new SourceRegistry()
