import {managedConnections} from './managed-config.ts'
import {sourceDeployment} from './connector-config.ts'
import {ProcessSource} from './plugin-process.ts'
import {FeishuSource} from '../plugins/feishu/feishu.ts'
import {randomUUID,randomBytes,createHmac} from 'node:crypto'
import {types as nodeTypes} from 'node:util'
import {z} from 'zod'
import {Ajv2020} from 'ajv/dist/2020.js'
import {configSchema,type SourceConfig} from './config.ts'
import type {Runtime} from './runtime.ts'
import {pointer} from './plugin-package.ts'
import {stableDigest} from './sources.ts'

const id=z.string().regex(/^[a-z][a-z0-9_-]{0,100}$/)
const revision=z.number().int().nonnegative()
const credentialPresent=(name:string)=>Object.hasOwn(process.env,name)&&typeof process.env[name]==='string'&&process.env[name]!.length>0
const draftSchema=z.object({revision,kind:id,label:z.string().trim().min(1).max(100),actors:z.array(z.string().trim().min(1).max(200)).max(100),intent:z.literal('draft').optional(),fields:z.record(z.string().max(100),z.union([z.string().max(16000),z.array(z.string().max(300)).max(100)])).default({}),credentials:z.record(z.string().max(100),z.string().min(1).max(16000)).default({}),credentialMode:z.enum(['value','environment']).default('value')}).strict()
export const connectorProbeSchema=z.object({sourceId:id,revision,level:z.enum(['configuration','reachable','authentication','capabilities']),requestId:z.string().uuid()}).strict()
const controlSchema=z.object({sourceId:id,revision,enabled:z.boolean(),requestId:z.string().uuid()}).strict()
export type ConnectorLayer=z.infer<typeof connectorProbeSchema>['level']
export type DiagnosticStatus='running'|'passed'|'failed'|'unsupported'|'unknown'|'stale'|'interrupted'
export interface ConnectorDiagnostic {
 id:string;sourceId:string;revision:number;level:ConnectorLayer;status:DiagnosticStatus;code:string;startedAt:number;finishedAt?:number
 checkedCapabilities?:'member_directory'[];checkedScopes?:number;realCall:false;evidenceMode:'configured-adapter'|'fixture'
}
export type ConnectorIssueCode='required'|'invalid_format'|'invalid_environment_reference'|'credential_unavailable'|'too_many'|'unsupported_field'
export interface ConnectorFieldIssue {field:string;code:ConnectorIssueCode}
const issueCodes:readonly string[]=['required','invalid_format','invalid_environment_reference','credential_unavailable','too_many','unsupported_field']
/** Only declared field names and fixed codes may cross the error boundary. */
export class ConnectorError extends Error {
 constructor(readonly code:'connector_invalid'|'connector_conflict'|'connector_missing'|'connector_disabled'|'connector_unsupported'|'connector_request_conflict'|'connector_busy'|'connector_actors_required',readonly status=400,readonly issues?:ConnectorFieldIssue[]){super(code)}
}
const safeParse=<T>(schema:z.ZodType<T>,value:unknown):T=>{const parsed=schema.safeParse(value);if(!parsed.success)throw new ConnectorError('connector_invalid');return parsed.data}
interface EvidenceBasis {lifecycle:string;adapter:string;credentials?:string;known:boolean;missing:boolean;restart?:boolean}
type SavedDiagnostic=ConnectorDiagnostic&{fingerprint?:string;basis?:EvidenceBasis;requestFingerprint?:string}
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
 private readonly evidenceKey=randomBytes(32)
 private readonly identities=new WeakMap<object,string>()
 private identity(value:object){let id=this.identities.get(value);if(!id){id=randomUUID();this.identities.set(value,id)}return id}
 private sealed(value:unknown){return createHmac('sha256',this.evidenceKey).update(JSON.stringify(value)).digest('hex')}
 private basis(config:SourceConfig,level:ConnectorLayer):EvidenceBasis {
  const host=this.host(),definition=this.definition(config.kind),adapter=host.sources.get(config.id)
  const lifecycle=this.sealed(this.identity(host)),identity=this.sealed({definition,instance:adapter?this.identity(adapter):null,identity:adapter?.identity?this.identity(adapter.identity):null,members:adapter?.members?this.identity(adapter.members):null})
  if(level==='reachable')return {lifecycle,adapter:identity,known:true,missing:false}
  if(level==='configuration'){
   const presence=Object.entries(definition.credentials).sort(([a],[b])=>a.localeCompare(b)).map(([slot,path])=>{const name=pointer(config,path);return [slot,typeof name==='string'&&/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)?credentialPresent(name):false]})
   return {lifecycle,adapter:identity,credentials:this.sealed(presence),known:true,missing:false}
  }
  // Only supported adapters prove which material an identity call consumes.
  // Arbitrary native adapters may cache credentials and cannot be inferred safe.
  let known=(!!definition.setup||'pluginId'in definition)&&(adapter instanceof ProcessSource||adapter instanceof FeishuSource&&!config.feishu?.cli||this.options.evidenceMode==='fixture'),missing=false
  const material=Object.entries(definition.credentials).sort(([a],[b])=>a.localeCompare(b)).map(([slot,path])=>{
   const name=pointer(config,path)
   if(name===undefined)return [slot,'not_declared']
   if(typeof name!=='string'||!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)){known=false;return [slot,'unknown']}
   const value=Object.hasOwn(process.env,name)?process.env[name]:undefined
   if(!value)missing=true
   return [slot,name,value??null]
  })
  return {lifecycle,adapter:identity,credentials:this.sealed(material),known,missing,restart:adapter instanceof ProcessSource&&!adapter.diagnosticCredentialsCurrent(config)}
 }
 private invalidation(record:SavedDiagnostic):string|undefined {
  try{
   const host=this.host(),config=host.config.sources.find(s=>s.id===record.sourceId)
   if(!config||host.settings.current().revision!==record.revision||this.fingerprint(config)!==record.fingerprint)return 'configuration_changed'
   const basis=this.basis(config,record.level),old=record.basis
   if(!old||old.lifecycle!==basis.lifecycle)return 'evidence_lifecycle_changed'
   if(old.adapter!==basis.adapter)return 'adapter_changed'
   if(basis.restart)return 'adapter_restart_required'
   if(!basis.known)return 'credential_basis_unavailable'
   if(basis.missing)return 'credential_missing'
   if(old.credentials!==basis.credentials)return record.level==='configuration'?'configuration_changed':'credential_changed'
  }catch{return 'configuration_changed'}
 }
 private observed(record:SavedDiagnostic){
  const reason=this.invalidation(record)
  return reason?this.publicRecord({...record,status:reason==='credential_basis_unavailable'?'unknown':'stale',code:reason,checkedCapabilities:undefined,checkedScopes:undefined}):this.publicRecord(record)
 }
 private readonly active=new Map<string,Promise<ConnectorDiagnostic>>()
 private readonly controllers=new Map<string,{sourceId:string;controller:AbortController}>()
 constructor(private readonly host:()=>Runtime,private readonly options:{fetch?:typeof fetch;timeoutMs?:number;clock?:()=>number;evidenceMode?:'configured-adapter'|'fixture'}={}){}
 private now(){return this.options.clock?.()??Date.now()}
 private checkRevision(expected:number){if(this.host().settings.current().revision!==expected)throw new ConnectorError('connector_conflict',409)}
 private definition(kind:string){const definition=this.host().sourceRegistry.connectionDefinitions().find(d=>d.kind===kind);if(!definition)throw new ConnectorError('connector_missing',404);return definition}
 private source(sourceId:string){const config=this.host().config.sources.find(s=>s.id===sourceId);if(!config)throw new ConnectorError('connector_missing',404);return config}
 private fingerprint(config:SourceConfig){return stableDigest(config)}
 private issues(definition:Definition|undefined,values:unknown):ConnectorFieldIssue[]{
  try{
   // Hook results are metadata, never objects whose getters/iterators we execute.
   if(nodeTypes.isProxy(values)||!Array.isArray(values))return []
   const length=Object.getOwnPropertyDescriptor(values,'length')?.value
   if(!Number.isSafeInteger(length)||length<0||length>256)return []
   const names=new Set(['label','actors',...(definition?.setup?.fields.map(f=>f.name)??[])]),seen=new Set<string>(),result:ConnectorFieldIssue[]=[]
   for(let i=0;i<length&&result.length<32;i++){
    const slot=Object.getOwnPropertyDescriptor(values,String(i))
    if(!slot||!Object.hasOwn(slot,'value'))continue
    const issue=slot.value
    if(!issue||typeof issue!=='object'||nodeTypes.isProxy(issue))continue
    const prototype=Object.getPrototypeOf(issue)
    if(prototype!==Object.prototype&&prototype!==null)continue
    const fieldProperty=Object.getOwnPropertyDescriptor(issue,'field'),codeProperty=Object.getOwnPropertyDescriptor(issue,'code')
    if(!fieldProperty||!codeProperty||!Object.hasOwn(fieldProperty,'value')||!Object.hasOwn(codeProperty,'value'))continue
    const field:unknown=fieldProperty.value,code:unknown=codeProperty.value
    if(typeof field!=='string'||!names.has(field)||typeof code!=='string'||!issueCodes.includes(code))continue
    const key=field+':'+code;if(seen.has(key))continue
    seen.add(key);result.push({field,code:code as ConnectorIssueCode})
   }
   return result
  }catch{return []} // Malformed hook metadata remains a fixed form-level error.
 }
 private parseDraft(value:unknown){
  const parsed=draftSchema.safeParse(value)
  if(!parsed.success){
   const kind=value&&typeof value==='object'?'kind'in value?value.kind:undefined:undefined
   const definition=typeof kind==='string'?this.host().sourceRegistry.connectionDefinitions().find(d=>d.kind===kind):undefined
   const issues=parsed.error.issues.map(issue=>({field:issue.path[0]==='fields'||issue.path[0]==='credentials'?issue.path[1]:issue.path[0],code:issue.code==='too_small'?'required':issue.code==='too_big'?'too_many':'invalid_format'}))
   throw new ConnectorError('connector_invalid',400,this.issues(definition,issues))
  }
  if(!parsed.data.actors.length&&parsed.data.intent!=='draft')throw new ConnectorError('connector_invalid',400,[{field:'actors',code:'required'}])
  if(parsed.data.intent==='draft'&&parsed.data.actors.length)throw new ConnectorError('connector_invalid',400,[{field:'actors',code:'invalid_format'}])
  return parsed.data
 }
 private configurationIssues(definition:Definition,config:SourceConfig):ConnectorFieldIssue[]{
  const fields=definition.setup?.fields??[],reported:{field:unknown;code:unknown}[]=[]
  if('configSchema'in definition&&definition.configSchema){
   try{
    const validate=new Ajv2020({strict:false,validateFormats:false}).compile(definition.configSchema)
    if(!validate(config))for(const error of validate.errors??[]){
     const path=error.instancePath+(error.keyword==='required'?'/'+String(error.params.missingProperty):'')
     const field=fields.find(f=>{const target=fieldPath(definition,f);return path===target||path.startsWith(target+'/')})
     if(field)reported.push({field:field.name,code:error.keyword==='required'||error.keyword==='minItems'||error.keyword==='minLength'?'required':error.keyword==='maxItems'||error.keyword==='maxLength'?'too_many':'invalid_format'})
    }
   }catch{/* Unmappable schema failures stay form-level, never raw Ajv material. */}
  }
  try{reported.push(...this.issues(definition,this.host().sourceRegistry.validationIssues(config)))}catch{/* Plugin errors cannot become public exception text. */}
  return this.issues(definition,reported)
 }
 private credentialAvailability(plan:{source:SourceConfig;credentials:Record<string,string>}){
  const definition=this.definition(plan.source.kind)
  return (definition.setup?.fields??[]).filter(field=>Object.values(definition.credentials).includes(fieldPath(definition,field))).flatMap(field=>{
   const name=pointer(plan.source,fieldPath(definition,field))
   return typeof name==='string'?[{field:field.name,available:Object.hasOwn(plan.credentials,name)&&typeof plan.credentials[name]==='string'&&plan.credentials[name]!.length>0||credentialPresent(name)}]:[]
  })
 }

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
    const saved=record?host.store.get<SavedDiagnostic>('connector-diagnostic',record.id):undefined
    return [level,saved?{...this.observed(saved),current:!this.invalidation(saved)}:null]
   }))
   return {repairAvailable:this.repairAvailable(config),id:config.id,kind:config.kind,label:config.label??definition.label,enabled:config.enabled,configured:this.configured(config),scopeCount:Array.isArray(scopes)?scopes.length:0,capabilities:config.capabilities,layers,realCall:{status:'not_tested' as const},credentialReferences:Object.values(definition.credentials).filter(path=>typeof pointer(config,path)==='string').map(path=>({field:definition.setup?.fields.find(f=>fieldPath(definition,f)===path)?.label??'Credential',available:credentialPresent(String(pointer(config,path)))}))}
  }),tools:host.toolConnections.configured().map(({id,label,enabled,transport,allowedTools})=>({id,label,enabled,transport,toolCount:allowedTools.length,verification:'not_tested' as const})),diagnostics:diagnostics.slice(-100)}
 }
 /** Secret values stay in this host-only return value. The server passes them
  * directly to Onboarding.sourcePlan and returns only its reviewed plan. */
 plan(value:unknown):{revision:number;source:SourceConfig;credentials:Record<string,string>}{
  return this.buildPlan(value)
 }
 private buildPlan(value:unknown,original?:SourceConfig):{revision:number;source:SourceConfig;credentials:Record<string,string>}{
  const input=this.parseDraft(value);this.checkRevision(input.revision)
  const host=this.host(),definition=this.definition(input.kind),fields=definition.setup?.fields
  if(!fields?.length)throw new ConnectorError('connector_unsupported')
  const credentials:Record<string,string>={},supplied=new Set([...Object.keys(input.fields),...Object.keys(input.credentials)])
  if([...supplied].some(key=>!fields.some(f=>f.name===key)))throw new ConnectorError('connector_invalid')
  const draft:Record<string,unknown>=original?structuredClone(original):{id:'app-'+randomUUID().slice(0,12),kind:input.kind,label:input.label,allowedActors:[...new Set(input.actors)],cwd:host.config.sources.find(s=>s.kind==='local')?.cwd??host.config.sources[0]!.cwd,sandbox:'read-only',enabled:false,allowedBots:[]}
  const invalid=(field:string,code:ConnectorIssueCode)=>new ConnectorError('connector_invalid',400,this.issues(definition,[{field,code}]))
  for(const field of fields){
   const path=fieldPath(definition,field),credential=Object.values(definition.credentials).includes(path)
   if(!writableField(definition,path))throw new ConnectorError('connector_unsupported')
   if(credential){
    if(input.fields[field.name]!==undefined)throw invalid(field.name,'unsupported_field')
    const secret=input.credentials[field.name]
    if(!secret){if(field.required&&!(original&&typeof pointer(original,path)==='string'))throw invalid(field.name,'required');continue}
    const name=input.credentialMode==='environment'?secret:'AGENTHUB_SETUP_CONNECTOR_'+randomUUID().replaceAll('-','').toUpperCase()
    if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name))throw invalid(field.name,'invalid_environment_reference')
    if(input.credentialMode==='value')credentials[name]=secret
    setField(draft,path,name)
   }else{
    if(input.credentials[field.name]!==undefined)throw invalid(field.name,'unsupported_field')
    let raw=input.fields[field.name]
    if(original&&raw===undefined)continue
    if(field.input==='tags'&&typeof raw==='string')raw=raw.split(/[\n,]/).map(s=>s.trim()).filter(Boolean)
    if(field.required&&(raw===undefined||raw===''||Array.isArray(raw)&&!raw.length))throw invalid(field.name,'required')
    if(raw!==undefined&&(raw!==''||original))setField(draft,path,raw)
   }
  }
  const parsed=configSchema.shape.sources.element.safeParse(draft);if(!parsed.success)throw new ConnectorError('connector_invalid',400,this.issues(definition,parsed.error.issues.flatMap(issue=>{const path='/'+issue.path.join('/'),field=fields.find(f=>{const target=fieldPath(definition,f);return path===target||path.startsWith(target+'/')});return field?[{field:field.name,code:'invalid_format'}]:[]})))
  const validationConfig=structuredClone(parsed.data),freeze=(value:unknown):void=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value)}};freeze(validationConfig)
  try{host.sourceRegistry.validate(validationConfig)}catch{throw new ConnectorError('connector_invalid',400,this.configurationIssues(definition,validationConfig))}
  return {revision:input.revision,source:parsed.data,credentials}
 }
 private repairSource(sourceId:string){
  const host=this.host(),source=this.source(sourceId),definition=this.definition(source.kind)
  let managed:SourceConfig|undefined
  try{managed=managedConnections(host.config.stateDir).sources.find(s=>s.id===sourceId)}catch{throw new ConnectorError('connector_unsupported')}
  const created=host.store.list<{receipt?:{sourceId?:string}}>('onboarding-deployment').some(r=>r.receipt?.sourceId===sourceId)
  if(host.startupSourceIds.includes(sourceId)||source.enabled||!managed||!created||stableDigest(sourceDeployment(source))!==stableDigest(sourceDeployment(managed))||!definition.setup?.fields.length||!definition.setup.fields.every(f=>writableField(definition,fieldPath(definition,f))))throw new ConnectorError('connector_unsupported')
  return source
 }
 private repairAvailable(source:SourceConfig){try{this.repairSource(source.id);return true}catch{return false}}
 repairRead(value:unknown){
  const input=safeParse(z.object({sourceId:id,revision}).strict(),value);this.checkRevision(input.revision)
  const source=this.repairSource(input.sourceId),definition=this.definition(source.kind),fields:Record<string,string|string[]>={}
  for(const field of definition.setup!.fields){const path=fieldPath(definition,field);if(Object.values(definition.credentials).includes(path))continue
   const value=pointer(source,path);if(typeof value==='string'||Array.isArray(value)&&value.every(v=>typeof v==='string'))fields[field.name]=value
  }
  return {sourceId:source.id,revision:input.revision,kind:source.kind,label:source.label??definition.label,fields,enabled:false,credentialAvailability:this.credentialAvailability({source,credentials:{}})}
 }
 repairPlan(value:unknown){
  const input=safeParse(draftSchema.pick({revision:true,fields:true,credentialMode:true}).extend({sourceId:id,credentials:z.record(z.string().max(100),z.string().max(16000)).default({})}).strict(),value)
  this.checkRevision(input.revision)
  const host=this.host(),source=this.repairSource(input.sourceId),definition=this.definition(source.kind),fingerprint=this.fingerprint(source),definitionDigest=stableDigest(definition),registry=host.sourceRegistry
  const {sourceId:_,...draft}=input
  draft.credentials=Object.fromEntries(Object.entries(input.credentials).filter(([,value])=>value.trim().length))
  const planned=this.buildPlan({...draft,kind:source.kind,label:source.label??definition.label,actors:source.allowedActors,...(!source.allowedActors.length?{intent:'draft'}:{})},source)
  const revalidate=()=>{
   if(this.host()!==host||this.host().sourceRegistry!==registry)throw new ConnectorError('connector_conflict',409)
   this.checkRevision(input.revision)
   if(this.fingerprint(this.repairSource(input.sourceId))!==fingerprint||stableDigest(this.definition(source.kind))!==definitionDigest)throw new ConnectorError('connector_conflict',409)
  }
  revalidate();return {...planned,revalidate}
 }
 validate(value:unknown){
  try{const plan=this.plan(value);return {valid:true,revision:plan.revision,code:'configuration_valid',networkTested:false,realCall:false,startsDisabled:true,credentialAvailability:this.credentialAvailability(plan)}}
  catch(error){if(error instanceof ConnectorError&&error.code==='connector_invalid')return {valid:false,code:error.code,networkTested:false,realCall:false,issues:error.issues??[]};throw error}
 }
 control(value:unknown){
  const input=safeParse(controlSchema,value),host=this.host(),fingerprint=stableDigest(input),receipt=host.store.get<{fingerprint:string;result:unknown}>('connector-control',input.requestId)
  if(receipt){if(receipt.fingerprint!==fingerprint)throw new ConnectorError('connector_request_conflict',409);return receipt.result}
  this.checkRevision(input.revision);this.source(input.sourceId)
  const source=this.source(input.sourceId)
  if(['local','delegation'].includes(source.kind))throw new ConnectorError('connector_unsupported')
  const deliberateAdmission=Object.values(source.admission).some(rule=>rule.unlistedAddressed!=='ignore'||rule.unlistedUnaddressed!=='ignore')
  if(input.enabled&&source.capabilities.events&&!source.allowedActors.length&&!source.allowedBots.length&&!deliberateAdmission)throw new ConnectorError('connector_actors_required',409,[{field:'actors',code:'required'}])
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
  const existing=host.store.get<SavedDiagnostic>('connector-diagnostic',input.requestId)
  if(existing){
   if(existing.requestFingerprint!==requestFingerprint)throw new ConnectorError('connector_request_conflict',409)
   const active=this.active.get(input.requestId);if(active)return active
   if(existing.status==='running'){const interrupted={...existing,status:'interrupted' as const,code:'probe_interrupted',finishedAt:this.now()};host.store.put('connector-diagnostic',existing.id,interrupted);return this.publicRecord(interrupted)}
   return this.observed(existing)
  }
  this.checkRevision(input.revision)
  const source=this.source(input.sourceId),adapter=host.sources.get(source.id),definition=this.definition(source.kind)
  if(!source.enabled&&input.level!=='configuration')throw new ConnectorError('connector_disabled',409)
  if(this.controllers.size>=16)throw new ConnectorError('connector_busy',429)
  const record:ConnectorDiagnostic&{fingerprint:string;basis:EvidenceBasis}={id:input.requestId,sourceId:source.id,revision:input.revision,fingerprint:this.fingerprint(source),basis:this.basis(source,input.level),level:input.level,status:'running',code:'probe_running',startedAt:this.now(),realCall:false,evidenceMode:this.options.evidenceMode??'configured-adapter'}
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),this.options.timeoutMs??20000)
  this.controllers.set(record.id,{sourceId:source.id,controller})
  host.store.atomic(()=>{host.store.put('connector-diagnostic',record.id,{...record,requestFingerprint});host.store.put('connector-diagnostic-head',source.id+':'+input.level,{id:record.id})})
  const currentMatches=()=>{
   // During a controlled restart the getter can briefly point to the closed
   // old runtime. Diagnostic evidence must never keep that store alive or
   // turn a late reply / timeout callback into an unhandled SQLite exception.
   try{
    const current=this.host(),config=current.config.sources.find(s=>s.id===source.id)
    return current===host&&!!config&&current.settings.current().revision===record.revision&&this.fingerprint(config)===record.fingerprint&&!this.invalidation(record)&&(input.level==='configuration'||config.enabled)&&current.store.get<{id:string}>('connector-diagnostic-head',source.id+':'+input.level)?.id===record.id
   }catch{return false}
  }
  const persist=(result:ConnectorDiagnostic)=>{
   try{if(this.host()!==host)return false;host.store.put('connector-diagnostic',record.id,{...result,requestFingerprint});return true}catch{return false}
  }
  const guard=()=>{
   if(!currentMatches())throw new ConnectorError('connector_conflict',409)
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
   if(!currentMatches()){code=this.invalidation(record)??'configuration_changed';status=code==='credential_basis_unavailable'?'unknown':'stale';checkedCapabilities=undefined;checkedScopes=undefined}
   const result={...record,status,code,finishedAt:this.now(),...(checkedCapabilities?{checkedCapabilities,checkedScopes}:{})}
   if(!persist(result)&&result.status!=='stale'){result.status='interrupted';result.code='diagnostic_store_unavailable';delete result.checkedCapabilities;delete result.checkedScopes}
   // Metadata receipts cannot contain provider errors, identities or raw responses.
   return this.publicRecord(result)
  })()
  const interrupted=new Promise<ConnectorDiagnostic>(resolve=>{controller.signal.addEventListener('abort',()=>{
   const stale=!currentMatches(),result={...record,status:stale?'stale' as const:'interrupted' as const,code:stale?(this.invalidation(record)??'configuration_changed'):'probe_interrupted',finishedAt:this.now()}
   persist(result)
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
