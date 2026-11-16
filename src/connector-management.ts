import {randomUUID} from 'node:crypto'
import {z} from 'zod'
import {configSchema,type SourceConfig} from './config.ts'
import type {Runtime} from './runtime.ts'
import {pointer} from './plugin-package.ts'
import {stableDigest} from './sources.ts'

const id=z.string().regex(/^[a-z][a-z0-9_-]{0,100}$/)
const revision=z.number().int().nonnegative()
const draftSchema=z.object({revision,kind:id,label:z.string().trim().min(1).max(100),actors:z.array(z.string().trim().min(1).max(200)).min(1).max(100),fields:z.record(z.string().max(100),z.union([z.string().max(16000),z.array(z.string().max(300)).max(100)])).default({}),credentials:z.record(z.string().max(100),z.string().min(1).max(16000)).default({}),credentialMode:z.enum(['value','environment']).default('value')}).strict()
export const connectorProbeSchema=z.object({sourceId:id,revision,level:z.enum(['configuration','reachable','authentication','capabilities']),requestId:z.string().uuid()}).strict()
const controlSchema=z.object({sourceId:id,revision,enabled:z.boolean(),requestId:z.string().uuid()}).strict()
export type ConnectorLayer=z.infer<typeof connectorProbeSchema>['level']
export type DiagnosticStatus='running'|'passed'|'failed'|'unsupported'|'unknown'|'stale'|'interrupted'
export interface ConnectorDiagnostic {
 id:string;sourceId:string;revision:number;level:ConnectorLayer;status:DiagnosticStatus;code:string;startedAt:number;finishedAt?:number
 checkedCapabilities?:'member_directory'[];checkedScopes?:number;realCall:false;evidenceMode:'configured-adapter'|'fixture'
}
/** Fixed codes are deliberately the only error material exposed by this service. */
export class ConnectorError extends Error {
 constructor(readonly code:'connector_invalid'|'connector_conflict'|'connector_missing'|'connector_disabled'|'connector_unsupported'|'connector_request_conflict'|'connector_busy',readonly status=400){super(code)}
}
const safeParse=<T>(schema:z.ZodType<T>,value:unknown):T=>{const parsed=schema.safeParse(value);if(!parsed.success)throw new ConnectorError('connector_invalid');return parsed.data}
type Definition=ReturnType<Runtime['sourceRegistry']['connectionDefinitions']>[number]
function fieldPath(definition:Definition,field:NonNullable<Definition['setup']>['fields'][number]){
 if(field.path)return field.path
 const camel=field.name.replace(/-([a-z])/g,(_,c:string)=>c.toUpperCase())
 return (definition.scopesPath?.slice(0,definition.scopesPath.lastIndexOf('/'))??'/options')+'/'+camel
}
function writableField(definition:Definition,path:string){
 const parts=path.slice(1).split('/'),root=parts[0]
 // Setup fields may edit only a plugin-specific subtree. Identity, authority,
 // grants, workspace and instance switches remain host-controlled.
 const reserved=new Set(['id','label','kind','allowedActors','allowedBots','enabled','cwd','workspace','sandbox','capabilities','observed','admission','listenScopes','pollSeconds','memberSync','repository','replyUrl','tokenEnv'])
 return !!root&&parts.length>1&&!reserved.has(root)&&!parts.some(part=>['__proto__','prototype','constructor'].includes(part))&&(root==='options'||definition.scopesPath?.startsWith('/'+root+'/')===true)
}
function setField(target:Record<string,unknown>,path:string,value:unknown){
 const parts=path.slice(1).split('/');if(!parts.length||parts.some(p=>['__proto__','prototype','constructor'].includes(p)))throw new ConnectorError('connector_invalid')
 let parent=target
 for(const part of parts.slice(0,-1)){
  const existing=parent[part];if(existing!==undefined&&(!existing||typeof existing!=='object'||Array.isArray(existing)))throw new ConnectorError('connector_invalid')
  parent=parent[part] as Record<string,unknown>??(parent[part]={}) as Record<string,unknown>
 }
 parent[parts.at(-1)!]=value
}
/** A view/control layer over SourceRegistry, existing settings and onboarding.
 * It owns diagnostic evidence only; it never owns a second connection registry. */
export class ConnectorManagement {
 private readonly active=new Map<string,Promise<ConnectorDiagnostic>>()
 private readonly controllers=new Map<string,{sourceId:string;controller:AbortController}>()
 constructor(private readonly host:()=>Runtime,private readonly options:{fetch?:typeof fetch;timeoutMs?:number;clock?:()=>number;evidenceMode?:'configured-adapter'|'fixture'}={}){}
 private now(){return this.options.clock?.()??Date.now()}
 private checkRevision(expected:number){if(this.host().settings.current().revision!==expected)throw new ConnectorError('connector_conflict',409)}
 private definition(kind:string){const definition=this.host().sourceRegistry.connectionDefinitions().find(d=>d.kind===kind);if(!definition)throw new ConnectorError('connector_missing',404);return definition}
 private source(sourceId:string){const config=this.host().config.sources.find(s=>s.id===sourceId);if(!config)throw new ConnectorError('connector_missing',404);return config}
 private fingerprint(config:SourceConfig){return stableDigest(config)}
 private configured(config:SourceConfig){
  try{configSchema.shape.sources.element.parse(config);this.host().sourceRegistry.validate(config);return true}catch{return false}
 }
 snapshot(){
  const host=this.host(),current=host.settings.current().revision
  const definitions=host.sourceRegistry.connectionDefinitions().map(d=>({kind:d.kind,label:d.label,pluginId:'pluginId'in d?d.pluginId:undefined,version:'version'in d?d.version:undefined,setup:d.setup,scopesPath:d.scopesPath,fields:d.setup?.fields.map(f=>({...f,path:fieldPath(d,f),credential:Object.values(d.credentials).includes(fieldPath(d,f))})),network:d.network,setupAvailable:!!d.setup?.fields.length&&d.setup.fields.every(field=>writableField(d,fieldPath(d,field)))}))
  const diagnostics=host.store.list<ConnectorDiagnostic>('connector-diagnostic').map(record=>{const safe=this.publicRecord(record);return safe.status==='running'&&!this.active.has(safe.id)?{...safe,status:'interrupted' as const,code:'probe_interrupted'}:safe})
  return {revision:current,definitions,instances:host.config.sources.filter(s=>!['local','delegation'].includes(s.kind)).map(config=>{
   const definition=this.definition(config.kind),scopes=host.sourceRegistry.scopes(config)??(definition.scopesPath?pointer(config,definition.scopesPath):[])??[]
   const records=diagnostics.filter(d=>d.sourceId===config.id)
   const layers=Object.fromEntries((['configuration','reachable','authentication','capabilities'] as const).map(level=>{
    const head=host.store.get<{id:string}>('connector-diagnostic-head',config.id+':'+level),record=records.find(d=>d.id===head?.id)
    return [level,record?{...record,current:record.revision===current&&host.store.get<ConnectorDiagnostic&{fingerprint:string}>('connector-diagnostic',record.id)?.fingerprint===this.fingerprint(config)}:null]
   }))
   return {id:config.id,kind:config.kind,label:config.label??definition.label,enabled:config.enabled,configured:this.configured(config),scopeCount:Array.isArray(scopes)?scopes.length:0,capabilities:config.capabilities,layers,realCall:{status:'not_tested' as const},credentialReferences:Object.values(definition.credentials).filter(path=>typeof pointer(config,path)==='string').map(path=>({field:definition.setup?.fields.find(f=>fieldPath(definition,f)===path)?.label??'Credential',available:!!process.env[String(pointer(config,path))]}))}
  }),tools:host.toolConnections.configured().map(({id,label,enabled,transport,allowedTools})=>({id,label,enabled,transport,toolCount:allowedTools.length,verification:'not_tested' as const})),diagnostics:diagnostics.slice(-100)}
 }
 /** Secret values stay in this host-only return value. The server passes them
  * directly to Onboarding.sourcePlan and returns only its reviewed plan. */
 plan(value:unknown):{revision:number;source:SourceConfig;credentials:Record<string,string>}{
  const input=safeParse(draftSchema,value);this.checkRevision(input.revision)
  const host=this.host(),definition=this.definition(input.kind),fields=definition.setup?.fields
  if(!fields?.length)throw new ConnectorError('connector_unsupported')
  const credentials:Record<string,string>={},supplied=new Set([...Object.keys(input.fields),...Object.keys(input.credentials)])
  if([...supplied].some(key=>!fields.some(f=>f.name===key)))throw new ConnectorError('connector_invalid')
  const draft:Record<string,unknown>={id:'app-'+randomUUID().slice(0,12),kind:input.kind,label:input.label,allowedActors:[...new Set(input.actors)],cwd:host.config.sources.find(s=>s.kind==='local')?.cwd??host.config.sources[0]!.cwd,sandbox:'read-only',enabled:false}
  for(const field of fields){
   const path=fieldPath(definition,field),credential=Object.values(definition.credentials).includes(path)
   if(!writableField(definition,path))throw new ConnectorError('connector_unsupported')
   if(credential){
    if(input.fields[field.name]!==undefined)throw new ConnectorError('connector_invalid')
    const secret=input.credentials[field.name]
    if(!secret){if(field.required)throw new ConnectorError('connector_invalid');continue}
    const name=input.credentialMode==='environment'?secret:'AGENTHUB_SETUP_CONNECTOR_'+randomUUID().replaceAll('-','').toUpperCase()
    if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))throw new ConnectorError('connector_invalid')
    if(input.credentialMode==='value')credentials[name]=secret
    setField(draft,path,name)
   }else{
    if(input.credentials[field.name]!==undefined)throw new ConnectorError('connector_invalid')
    let raw=input.fields[field.name]
    if(field.input==='tags'&&typeof raw==='string')raw=raw.split(/[\n,]/).map(s=>s.trim()).filter(Boolean)
    if(field.required&&(raw===undefined||raw===''||Array.isArray(raw)&&!raw.length))throw new ConnectorError('connector_invalid')
    if(raw!==undefined&&raw!=='')setField(draft,path,raw)
   }
  }
  const parsed=configSchema.shape.sources.element.safeParse(draft);if(!parsed.success)throw new ConnectorError('connector_invalid')
  try{host.sourceRegistry.validate(parsed.data)}catch{throw new ConnectorError('connector_invalid')}
  return {revision:input.revision,source:parsed.data,credentials}
 }
 validate(value:unknown){
  try{const plan=this.plan(value);return {valid:true,revision:plan.revision,code:'configuration_valid',networkTested:false,realCall:false,startsDisabled:true}}
  catch(error){if(error instanceof ConnectorError&&error.code==='connector_invalid')return {valid:false,code:error.code,networkTested:false,realCall:false};throw error}
 }
 control(value:unknown){
  const input=safeParse(controlSchema,value),host=this.host(),fingerprint=stableDigest(input),receipt=host.store.get<{fingerprint:string;result:unknown}>('connector-control',input.requestId)
  if(receipt){if(receipt.fingerprint!==fingerprint)throw new ConnectorError('connector_request_conflict',409);return receipt.result}
  this.checkRevision(input.revision);this.source(input.sourceId)
  if(['local','delegation'].includes(this.source(input.sourceId).kind))throw new ConnectorError('connector_unsupported')
  return host.store.atomic(()=>{
   this.checkRevision(input.revision)
   const saved=host.updateSettings(input.revision,{sources:host.config.sources.map(s=>s.id===input.sourceId?{...s,enabled:input.enabled}:s)})
   if(!input.enabled)for(const pending of this.controllers.values())if(pending.sourceId===input.sourceId)pending.controller.abort()
   const result={sourceId:input.sourceId,enabled:input.enabled,revision:saved.revision,previousEffects:'unchanged' as const}
   host.store.put('connector-control',input.requestId,{fingerprint,result});host.store.audit({type:'connector.control',sourceId:input.sourceId,enabled:input.enabled,revision:saved.revision})
   return result
  })
 }
 async probe(value:unknown):Promise<ConnectorDiagnostic>{
  const input=safeParse(connectorProbeSchema,value),host=this.host(),requestFingerprint=stableDigest(input)
  const existing=host.store.get<ConnectorDiagnostic&{requestFingerprint:string}>('connector-diagnostic',input.requestId)
  if(existing){
   if(existing.requestFingerprint!==requestFingerprint)throw new ConnectorError('connector_request_conflict',409)
   const active=this.active.get(input.requestId);if(active)return active
   if(existing.status==='running'){const interrupted={...existing,status:'interrupted' as const,code:'probe_interrupted',finishedAt:this.now()};host.store.put('connector-diagnostic',existing.id,interrupted);return this.publicRecord(interrupted)}
   return this.publicRecord(existing)
  }
  this.checkRevision(input.revision)
  const source=this.source(input.sourceId),adapter=host.sources.get(source.id),definition=this.definition(source.kind)
  if(!source.enabled&&input.level!=='configuration')throw new ConnectorError('connector_disabled',409)
  if(this.controllers.size>=16)throw new ConnectorError('connector_busy',429)
  const record:ConnectorDiagnostic&{fingerprint:string}={id:input.requestId,sourceId:source.id,revision:input.revision,fingerprint:this.fingerprint(source),level:input.level,status:'running',code:'probe_running',startedAt:this.now(),realCall:false,evidenceMode:this.options.evidenceMode??'configured-adapter'}
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),this.options.timeoutMs??20000)
  this.controllers.set(record.id,{sourceId:source.id,controller})
  host.store.atomic(()=>{host.store.put('connector-diagnostic',record.id,{...record,requestFingerprint});host.store.put('connector-diagnostic-head',source.id+':'+input.level,{id:record.id})})
  const guard=()=>{
   const current=this.host(),config=current.config.sources.find(s=>s.id===source.id)
   if(current!==host||!config||current.settings.current().revision!==record.revision||this.fingerprint(config)!==record.fingerprint||input.level!=='configuration'&&!config.enabled||current.store.get<{id:string}>('connector-diagnostic-head',source.id+':'+input.level)?.id!==record.id)throw new ConnectorError('connector_conflict',409)
   controller.signal.throwIfAborted()
  }
  const work=(async()=>{
   let status:DiagnosticStatus='passed',code='configuration_valid',checkedCapabilities:ConnectorDiagnostic['checkedCapabilities'],checkedScopes:number|undefined
   try{
    guard()
    if(!this.configured(source)){status='failed';code='configuration_invalid'}
    else if(input.level==='configuration')code='configuration_valid'
    else if(input.level==='reachable'){
     if(!definition.network||!definition.setup?.serviceUrl){status='unsupported';code='reachability_probe_unavailable'}
     else{await (this.options.fetch??fetch)(definition.setup.serviceUrl,{method:'HEAD',redirect:'error',signal:controller.signal});guard();code='service_reachable'}
    }else if(input.level==='authentication'){
     if(!adapter?.identity){status='unsupported';code='identity_probe_unavailable'}
     else{const identity=await adapter.identity();guard();if(identity?.verified!==true){status='unknown';code='identity_unverified'}else code='identity_verified'}
    }else{
     const scopes=host.sourceRegistry.scopes(source)??(definition.scopesPath?pointer(source,definition.scopesPath):[])
     const allowed=Array.isArray(scopes)?scopes.filter((scope):scope is string=>typeof scope==='string'&&(!source.listenScopes||source.listenScopes.includes(scope))):[]
     if(!source.capabilities.resources||!adapter?.members||!allowed.length||allowed.length>20){status='unsupported';code='directory_probe_unavailable'}
     else{
      for(const scope of allowed){guard();const members=await adapter.members(scope);guard();if(!Array.isArray(members))throw new Error('Invalid directory result')}
      checkedCapabilities=['member_directory'];checkedScopes=allowed.length;code='directory_read_verified'
     }
    }
   }catch(error){
    if(error instanceof ConnectorError&&error.code==='connector_conflict'){status='stale';code='configuration_changed'}
    else if(controller.signal.aborted){status='interrupted';code='probe_interrupted'}
    else{status='failed';code=input.level==='reachable'?'service_unreachable':input.level==='authentication'?'authentication_not_verified':input.level==='capabilities'?'directory_not_verified':'configuration_invalid'}
   }
   const current=this.host(),config=current.config.sources.find(s=>s.id===source.id)
   if(current!==host||!config||current.settings.current().revision!==record.revision||this.fingerprint(config)!==record.fingerprint||current.store.get<{id:string}>('connector-diagnostic-head',source.id+':'+input.level)?.id!==record.id){status='stale';code='configuration_changed';checkedCapabilities=undefined;checkedScopes=undefined}
   const result={...record,status,code,finishedAt:this.now(),...(checkedCapabilities?{checkedCapabilities,checkedScopes}:{})}
   current.store.put('connector-diagnostic',record.id,{...result,requestFingerprint})
   // Metadata receipts cannot contain provider errors, identities or raw responses.
   return this.publicRecord(result)
  })()
  const interrupted=new Promise<ConnectorDiagnostic>(resolve=>{controller.signal.addEventListener('abort',()=>{
   const current=this.host(),result={...record,status:'interrupted' as const,code:'probe_interrupted',finishedAt:this.now()}
   if(current===host)current.store.put('connector-diagnostic',record.id,{...result,requestFingerprint})
   resolve(this.publicRecord(result))
  },{once:true})})
  const pending=Promise.race([work,interrupted]).finally(()=>{clearTimeout(timeout);this.controllers.delete(record.id);this.active.delete(record.id)})
  this.active.set(record.id,pending)
  return pending
 }
 private publicRecord(record:ConnectorDiagnostic):ConnectorDiagnostic {
  const {id,sourceId,revision,level,status,code,startedAt,finishedAt,checkedCapabilities,checkedScopes,evidenceMode}=record
  return {id,sourceId,revision,level,status,code,startedAt,...(finishedAt!==undefined?{finishedAt}:{}),...(checkedCapabilities?{checkedCapabilities,checkedScopes}:{}),realCall:false,evidenceMode}
 }
}
