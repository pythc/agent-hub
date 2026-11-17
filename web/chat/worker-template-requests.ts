import type {WorkspaceTransportContext} from './workspace-transport.ts'
/** Keep the exact request across settings refreshes, within its proven UI context. */
export interface TemplateAttempt {path:string;body:Record<string,unknown>;requestId:string}
export interface TemplateLedgerScope {origin:string;managed:boolean;workspaceId:string;accountId:string|null;sessionIsolation:string}
interface SessionStorage {getItem(key:string):string|null;setItem(key:string,value:string):void}
const legacyKey='roppo.worker-template.pending.v1'
export function templateLedgerScope(context:WorkspaceTransportContext,origin:string):TemplateLedgerScope{
 if(context.state!=='ready')throw Error('template_ledger_context_invalid')
 return {origin,managed:context.managed,workspaceId:context.activeId,accountId:context.accountId,sessionIsolation:context.sessionIsolation}
}
function namespace(scope:TemplateLedgerScope){
 const origin=new URL(scope.origin)
 if(typeof scope.managed!=='boolean'||origin.origin!==scope.origin||!['http:','https:'].includes(origin.protocol)||scope.managed&&!/^[a-zA-Z0-9_-]{1,80}$/.test(scope.workspaceId)||!scope.managed&&scope.workspaceId!==''||scope.accountId!==null&&(typeof scope.accountId!=='string'||!scope.accountId||scope.accountId.length>200)||typeof scope.sessionIsolation!=='string'||!scope.sessionIsolation||scope.sessionIsolation.length>200)throw Error('template_ledger_context_invalid')
 return 'roppo.worker-template.pending.v2.'+encodeURIComponent(JSON.stringify([scope.origin,scope.managed?['workspace',scope.workspaceId]:['single-runtime'],scope.accountId===null?['page',scope.sessionIsolation]:['account',scope.accountId]]))
}
function identity(path:string,body:Record<string,unknown>){const {revision,settingsRevision,...intent}=body;return path+JSON.stringify(Object.fromEntries(Object.entries(intent).sort(([a],[b])=>a.localeCompare(b))))}
function retained(value:unknown):TemplateAttempt|null{
 if(!value||typeof value!=='object'||Array.isArray(value))return null
 const attempt=value as Record<string,unknown>,body=attempt.body
 if(attempt.path!=='/create'||typeof attempt.requestId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(attempt.requestId)||!body||typeof body!=='object'||Array.isArray(body))return null
 const data=body as Record<string,unknown>,allowed=['id','version','digest','revision','settingsRevision','workerId','label','backend','model']
 if(Object.keys(data).some(k=>!allowed.includes(k))||['id','version','workerId','label','backend'].some(k=>typeof data[k]!=='string'||!data[k]||String(data[k]).length>200)||typeof data.digest!=='string'||!/^[0-9a-f]{64}$/.test(data.digest)||!Number.isSafeInteger(data.revision)||Number(data.revision)<0||!Number.isSafeInteger(data.settingsRevision)||Number(data.settingsRevision)<0||data.model!==undefined&&(typeof data.model!=='string'||data.model.length>200))return null
 return Object.freeze({path:'/create',body:Object.freeze(structuredClone(data)),requestId:attempt.requestId})
}
export class TemplateRequestLedger {
 private attempts=new Map<string,TemplateAttempt>()
 private uncertainCleanup=new Map<string,TemplateAttempt>()
 private readonly storageKey:string
 private unrecognized=false
 readonly hasUnattributedLegacy:boolean
 get hasUnrecognizedPending(){return this.unrecognized}
 constructor(scope:TemplateLedgerScope,private storage?:SessionStorage){
  this.storageKey=namespace(scope)
  if(!storage)try{this.storage=globalThis.sessionStorage}catch{}
  // The old key has no reliable account/workspace provenance. Preserve it untouched;
  // never display its bodies or adopt them into the currently selected partition.
  let legacy=false
  try{const value=this.storage?.getItem(legacyKey);legacy=!!value&&value!=='[]'}catch{}
  this.hasUnattributedLegacy=legacy
  try{this.refresh()}catch{/* A new create must prove persistence before sending. */}
 }
 private refresh(){
  if(!this.storage)throw Error('template_storage_unavailable')
  let raw:string|null
  try{raw=this.storage.getItem(this.storageKey)}catch{throw Error('template_storage_unavailable')}
  const fresh=new Map<string,TemplateAttempt>();let invalid=false
  if(raw){
   if(raw.length>128000)invalid=true
   else try{const saved=JSON.parse(raw);if(!Array.isArray(saved)||saved.length>20)invalid=true;else for(const value of saved){const attempt=retained(value);if(!attempt){invalid=true;continue}const key=identity(attempt.path,attempt.body);if(fresh.has(key))invalid=true;else fresh.set(key,attempt)}}catch{invalid=true}
  }
  this.unrecognized=invalid
  for(const [key,attempt] of this.attempts)if(attempt.path==='/create')this.attempts.delete(key)
  for(const [key,attempt] of fresh)this.attempts.set(key,attempt)
  return fresh
 }
 private save(creations:Map<string,TemplateAttempt>){
  if(!this.storage)throw Error('template_storage_unavailable')
  const encoded=JSON.stringify([...creations.values()])
  try{this.storage.setItem(this.storageKey,encoded);if(this.storage.getItem(this.storageKey)!==encoded)throw Error()}catch{throw Error('template_storage_unavailable')}
  for(const [key,attempt] of this.attempts)if(attempt.path==='/create')this.attempts.delete(key)
  for(const [key,attempt] of creations)this.attempts.set(key,attempt)
 }
 prepare(path:string,body:Record<string,unknown>):TemplateAttempt{
  const key=identity(path,body)
  // Storage updates are synchronous and always begin with the latest same-partition
  // contents, so a second mounted instance cannot overwrite another one's intent.
  const creations=path==='/create'?this.refresh():null,old=this.attempts.get(key)??this.uncertainCleanup.get(key)
  if(old){if(creations&&!creations.has(key)){if(this.unrecognized||creations.size>=20)throw Error('template_pending_review_required');creations.set(key,old);this.save(creations)}return old}
  if(creations&&(this.unrecognized||creations.size>=20))throw Error('template_pending_review_required')
  const attempt=Object.freeze({path,body:Object.freeze(structuredClone(body)),requestId:crypto.randomUUID()})
  if(creations){creations.set(key,attempt);this.save(creations)}else this.attempts.set(key,attempt)
  return attempt
 }
 finish(attempt:TemplateAttempt){
  const key=identity(attempt.path,attempt.body)
  if(attempt.path!=='/create'){if(this.attempts.get(key)?.requestId===attempt.requestId)this.attempts.delete(key);return}
  try{
  const creations=this.refresh()
  if(creations.get(key)?.requestId!==attempt.requestId)return
  // Preserve an unrecognized raw partition untouched even after a valid receipt is
  // reconciled. Retrying that same valid ID remains safe; new intents stay blocked.
  if(this.unrecognized){this.attempts.delete(key);return}
  creations.delete(key);this.save(creations);this.uncertainCleanup.delete(key)
  }catch(error){this.uncertainCleanup.set(key,attempt);this.attempts.set(key,attempt);throw error}
 }
 pendingCreations(){return [...this.attempts.values()].filter(a=>a.path==='/create')}
}
