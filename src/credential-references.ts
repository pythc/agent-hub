import type {Runtime} from './runtime.ts'
import type {BackendDefinition} from './backend-config.ts'

export type CredentialReferenceState='present'|'missing'|'unknown'
export type CredentialConnectionState=CredentialReferenceState|'not_declared'
export interface CredentialReference {
 slot:number;purpose:'authentication'|'process_environment';state:CredentialReferenceState
}
export interface CredentialReferencesSnapshot {
 schema:1;observedAt:number;settingsRevision:number;scope:'host'
 connections:{kind:'source'|'tool'|'backend';id:string;state:CredentialConnectionState;references:CredentialReference[];verification:'not_checked'}[]
}
const pointerPath=/^\/(?:[a-zA-Z][a-zA-Z0-9_-]*\/?)+$/
const envName=/^[A-Za-z_][A-Za-z0-9_]*$/
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value)
/** The existing adapters intentionally have different presence rules. Do not change their enforcement here. */
function reference(value:unknown,rule:'nonempty'|'trimmed'|'defined'):CredentialReferenceState{
 if(typeof value!=='string'||!envName.test(value))return 'unknown'
 const material=Object.hasOwn(process.env,value)?process.env[value]:undefined
 return (rule==='defined'?material!==undefined:rule==='trimmed'?!!material?.trim():!!material)?'present':'missing'
}
function pointer(value:unknown,path:unknown):unknown{
 if(typeof path!=='string'||!pointerPath.test(path))return undefined
 for(const key of path.slice(1).split('/')){
  if(!object(value)||!Object.hasOwn(value,key))return undefined
  value=value[key]
 }
 return value
}
function state(refs:CredentialReference[],known:boolean):CredentialConnectionState{
 if(refs.some(r=>r.state==='missing'))return 'missing'
 if(!known||refs.some(r=>r.state==='unknown'))return 'unknown'
 return refs.length?'present':'not_declared'
}
/** Read-only view of existing wiring, not a credential store, authentication check or grant. */
export class CredentialReferences {
 constructor(private readonly host:()=>Runtime,private readonly clock:()=>number=Date.now){}
 snapshot():CredentialReferencesSnapshot{
  const host=this.host(),observedAt=this.clock(),settingsRevision=host.settings.current().revision
  if(!Number.isSafeInteger(observedAt)||observedAt<0||observedAt>8640000000000000||!Number.isSafeInteger(settingsRevision)||settingsRevision<0)throw Error('Credential references unavailable')
  const connections:CredentialReferencesSnapshot['connections']=[]
  const add=(kind:'source'|'tool'|'backend',id:string,refs:CredentialReference[],known=true)=>{
   if(!/^[a-z][a-z0-9_-]*$/.test(id))throw Error('Credential references unavailable')
   connections.push({kind,id,state:state(refs,known),references:refs,verification:'not_checked'})
  }
  const definitions=host.sourceRegistry.connectionDefinitions()
  for(const source of host.config.sources){
   const matches=definitions.filter(d=>d.kind===source.kind),definition=matches.length===1?matches[0]:undefined
   // Older native sources may have credentials outside the setup metadata. Absence of metadata is not absence of authentication.
   const known=!!definition&&(!!definition.setup||'pluginId'in definition)&&object(definition.credentials)
   const refs:CredentialReference[]=[]
   if(known)for(const path of Object.values(definition!.credentials)){
    if(typeof path!=='string'||!pointerPath.test(path)){refs.push({slot:refs.length,purpose:'authentication',state:'unknown'});continue}
    const value=pointer(source,path)
    // An absent optional pointer is not a declared host-environment reference. Required-field validation remains with the adapter.
    if(value===undefined)continue
    refs.push({slot:refs.length,purpose:'authentication',state:reference(value,'nonempty')})
   }
   add('source',source.id,refs,known)
  }
  for(const [id,connection]of Object.entries(host.config.toolConnections)){
   const refs:CredentialReference[]=[],transport=connection.transport
   if(transport.kind==='plugin'){add('tool',id,refs,false);continue} // Delegated source authentication is not checked here.
   for(const value of Object.values(transport.kind==='stdio'?transport.env:transport.headerEnv))refs.push({slot:refs.length,purpose:transport.kind==='stdio'?'process_environment':'authentication',state:reference(value,'nonempty')})
   add('tool',id,refs)
  }
  // Native Codex also serves pre-registry conversations without an explicit backend definition.
  const backends:Record<string,BackendDefinition>={codex:{kind:'codex'},...host.config.backends}
  for(const [id,definition]of Object.entries(backends)){
   const refs:CredentialReference[]=[]
   if(definition.kind==='codex'||definition.kind==='plugin'){
    for(const value of Object.values(definition.env??{}))refs.push({slot:refs.length,purpose:'process_environment',state:reference(value,'defined')})
    if(definition.kind==='codex')refs.push({slot:refs.length,purpose:'authentication',state:'unknown'})
   }else{
    if(definition.apiKeyEnv!==undefined)refs.push({slot:refs.length,purpose:'authentication',state:reference(definition.apiKeyEnv,'trimmed')})
    for(const value of Object.values(definition.headerEnv??{}))refs.push({slot:refs.length,purpose:'authentication',state:reference(value,'nonempty')})
    if(definition.subscription)refs.push({slot:refs.length,purpose:'authentication',state:'unknown'})
   }
   add('backend',id,refs)
  }
  return {schema:1,observedAt,settingsRevision,scope:'host',connections}
 }
}
