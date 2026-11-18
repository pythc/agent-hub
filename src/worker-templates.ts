import {z} from 'zod'
import {parseTree,type ParseError,type Node as JsonNode} from 'jsonc-parser'
import {stableDigest} from './sources.ts'
import {backendPackages} from './backends/plugin-package.ts'
import type {Runtime} from './runtime.ts'

export const TEMPLATE_MAX_BYTES=128_000
const id=z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/)
const version=z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[a-zA-Z0-9.-]+)?$/).max(64)
const digest=z.string().regex(/^[a-f0-9]{64}$/)
const plain=z.string().trim().min(1)
const capabilities=['managed','tools','resume','history','contextBudget','images','steering','promptRefresh'] as const
const sourceSchema=z.object({name:plain.max(160),url:z.string().url().max(1000).refine(v=>{try{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash}catch{return false}},'Use an HTTPS source URL without credentials or query'),license:plain.max(100)}).strict()
export const workerTemplateSchema=z.object({
 apiVersion:z.literal(1),type:z.literal('worker-template'),id,version,label:plain.max(100),description:plain.max(1000),
 instructions:plain.max(32_000),requirements:z.object({capabilities:z.array(z.enum(capabilities)).max(16),tools:z.array(z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.:-]{0,127}$/)).max(64)}).strict(),
 examples:z.array(z.object({request:plain.max(2000),expected:plain.max(2000)}).strict()).max(12),
 acceptance:z.array(plain.max(1000)).min(1).max(24),source:sourceSchema,digest,
}).strict()
export type WorkerTemplate=z.infer<typeof workerTemplateSchema>
export type TemplateEntry={manifest:WorkerTemplate;installedAt:string;removedAt?:string}
export class WorkerTemplateError extends Error {constructor(readonly code:string,readonly status=400){super(code)}}
function fail(code:string,status=400):never{throw new WorkerTemplateError(code,status)}
const reference=z.object({id,version}).strict()
const mutation=z.object({revision:z.number().int().nonnegative(),requestId:z.string().min(1).max(200)}).strict()
function parse<T>(schema:z.ZodType<T>,value:unknown):T{const result=schema.safeParse(value);return result.success?result.data:fail('template_validation_failed')}
function canonicalDigest(manifest:Omit<WorkerTemplate,'digest'>|WorkerTemplate){const {digest:ignored,...body}=manifest as WorkerTemplate;return stableDigest(body)}
export function sealWorkerTemplate(body:Omit<WorkerTemplate,'digest'>):WorkerTemplate{const parsed=workerTemplateSchema.parse({...body,digest:'0'.repeat(64)});return {...parsed,digest:canonicalDigest(parsed)}}
/** Data-only import. No archive, path, executable, credential or history API exists. */
export function readWorkerTemplate(value:unknown):WorkerTemplate{
 let bytes:string
 try{bytes=typeof value==='string'?value:JSON.stringify(value)}catch{return fail('template_validation_failed')}
 if(typeof bytes!=='string'||Buffer.byteLength(bytes)>TEMPLATE_MAX_BYTES)fail('template_size_exceeded')
 // Bound nesting before the recursive JSON parser allocates its syntax tree.
 let nesting=0,quoted=false,escaped=false
 for(const char of bytes){if(quoted){if(escaped)escaped=false;else if(char==='\\')escaped=true;else if(char==='"')quoted=false}else if(char==='"')quoted=true;else if(char==='{'||char==='['){if(++nesting>12)fail('template_depth_exceeded')}else if(char==='}'||char===']')nesting--}
 const errors:ParseError[]=[],tree=parseTree(bytes,errors,{disallowComments:true,allowTrailingComma:false})
 if(!tree||errors.length)fail('template_json_required')
 const pending:{node:JsonNode;depth:number}[]=[{node:tree,depth:0}]
 while(pending.length){const {node,depth}=pending.pop()!;if(depth>12)fail('template_depth_exceeded');if(node.type==='object'){const keys=node.children?.map(p=>String(p.children?.[0]?.value))??[];if(new Set(keys).size!==keys.length)fail('template_duplicate_field')};for(const child of node.children??[])pending.push({node:child,depth:depth+1})}
 let decoded:unknown;try{decoded=JSON.parse(bytes)}catch{return fail('template_json_required')}
 const manifest=parse(workerTemplateSchema,decoded)
 // Scan decoded data so JSON Unicode escapes cannot hide a recognizable credential.
 if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:sk-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{15,}|gh[pousr]_[A-Za-z0-9]{20,})\b/.test(JSON.stringify(manifest)))fail('template_secret_detected')
 if(canonicalDigest(manifest)!==manifest.digest)fail('template_digest_mismatch')
 return manifest
}
const entryKey=(r:{id:string;version:string})=>r.id+'@'+r.version
const starter=sealWorkerTemplate({apiVersion:1,type:'worker-template',id:'evidence-reviewer',version:'1.0.0',label:'Evidence reviewer',description:'Review a supplied result against explicit acceptance criteria.',instructions:'Review the supplied task artifacts against the user’s acceptance criteria. Cite the evidence used for each conclusion. Identify missing evidence and unresolved questions. Ask before performing any action outside the assigned review.',requirements:{capabilities:['managed','tools','resume','history','contextBudget'],tools:['superagent_read']},examples:[{request:'Review the attached implementation against its acceptance criteria.',expected:'A concise evidence-based assessment with unmet criteria clearly identified.'}],acceptance:['Every conclusion identifies its supporting evidence.','Missing evidence remains explicitly unverified.'],source:{name:'Roppo original starter recipe',url:'https://github.com/pythc/agent-hub',license:'Apache-2.0'}})

export class WorkerTemplates {
 constructor(private readonly runtime:()=>Runtime){}
 private revision(){return this.runtime().store.get<{revision:number}>('worker-template-library','current')?.revision??0}
 private entry(input:{id:string;version:string},active=true){const entry=this.runtime().store.get<TemplateEntry>('worker-template',entryKey(input));if(!entry||active&&entry.removedAt)fail('template_not_installed',404);return entry!}
 snapshot(){
  const h=this.runtime(),pkgs=backendPackages(h.config)
  return {revision:this.revision(),settingsRevision:h.settings.current().revision,templates:h.store.list<TemplateEntry>('worker-template').filter(t=>!t.removedAt),starters:[starter],backends:[{id:'codex',label:'Codex',eligible:true},...Object.entries(h.config.backends).filter(([id])=>id!=='codex').map(([id,d])=>({id,label:d.label??id,eligible:d.kind!=='plugin'||!!pkgs.get(d.plugin)&&['managed','tools','resume','history','contextBudget'].every(c=>(pkgs.get(d.plugin)!.manifest.capabilities as Record<string,boolean>)[c])}))],managementEnabled:h.config.execution.management?.enabled===true}
 }
 preview(value:unknown){const input=parse(z.object({manifest:z.unknown()}).strict(),value),manifest=readWorkerTemplate(input.manifest),old=this.runtime().store.get<TemplateEntry>('worker-template',entryKey(manifest));return {manifest,revision:this.revision(),installed:!!old&&!old.removedAt,conflict:!!old&&old.manifest.digest!==manifest.digest,grants:[],startsWorker:false,warnings:['Template content is untrusted role guidance.','Creating a Worker pauses it with no tools or MCP connections.','Tool requirements need separate operator configuration.']}}
 private mutate(value:unknown,action:'install'|'remove',work:(input:any)=>unknown){
  const input=action==='install'?parse(mutation.extend({manifest:z.unknown(),digest}).strict(),value):parse(mutation.extend({id,version}).strict(),value)
  const h=this.runtime(),key=stableDigest(['templates',input.requestId]),fingerprint=stableDigest({action,...input})
  return h.store.atomic(()=>{const receipt=h.store.get<any>('worker-template-command',key);if(receipt){if(receipt.fingerprint!==fingerprint)fail('template_request_conflict',409);return receipt.result};if(input.revision!==this.revision())fail('template_revision_conflict',409);const result=work(input);h.store.put('worker-template-command',key,{fingerprint,result,at:new Date().toISOString()});return result})
 }
 install(value:unknown){return this.mutate(value,'install',input=>{
  const manifest=readWorkerTemplate(input.manifest);if(input.digest!==manifest.digest)fail('template_preview_changed',409)
  const h=this.runtime(),key=entryKey(manifest),old=h.store.get<TemplateEntry>('worker-template',key)
  if(old&&old.manifest.digest!==manifest.digest)fail('template_version_conflict',409)
  if(!old||old.removedAt){const entry={manifest,installedAt:new Date().toISOString()};h.store.put('worker-template',key,entry);h.store.put('worker-template-library','current',{revision:this.revision()+1});h.store.audit({type:'worker-template.installed',id:manifest.id,version:manifest.version,digest:manifest.digest})}
  return {revision:this.revision(),installed:true,id:manifest.id,version:manifest.version,digest:manifest.digest}
 })}
 export(value:unknown){return this.entry(parse(reference,value)).manifest}
 remove(value:unknown){return this.mutate(value,'remove',input=>{const h=this.runtime(),entry=this.entry(input);h.store.put('worker-template',entryKey(input),{...entry,removedAt:new Date().toISOString()});h.store.put('worker-template-library','current',{revision:this.revision()+1});h.store.audit({type:'worker-template.removed',id:input.id,version:input.version});return {revision:this.revision(),removed:true,workersChanged:false,historyRetained:true}})}
 async create(value:unknown){
  const input=parse(mutation.extend({id,version,digest,settingsRevision:z.number().int().nonnegative(),workerId:id,label:plain.max(100),backend:id,model:plain.max(300).optional()}).strict(),value)
  const h=this.runtime(),key=stableDigest(['template-create',input.requestId]),fingerprint=stableDigest(input)
  let staged=h.store.get<{fingerprint:string;manifest:WorkerTemplate;result?:unknown}>('worker-template-create',key)
  if(staged){if(staged.fingerprint!==fingerprint)fail('template_request_conflict',409);if(staged.result)return staged.result}
  else {
   if(input.revision!==this.revision())fail('template_revision_conflict',409)
   const manifest=this.entry(input).manifest;if(manifest.digest!==input.digest)fail('template_preview_changed',409)
   const definition=h.config.backends[input.backend]??(input.backend==='codex'?{kind:'codex' as const}:undefined)
   if(!definition)fail('template_backend_unavailable')
   const declared=definition.kind==='plugin'?backendPackages(h.config).get(definition.plugin)?.manifest.capabilities:undefined
   const available=definition.kind==='codex'?Object.fromEntries(capabilities.map(k=>[k,true])):definition.kind==='plugin'?declared:{managed:true,tools:true,resume:true,history:true,contextBudget:true,images:definition.images,steering:true,promptRefresh:true}
   if(!available||[...new Set([...manifest.requirements.capabilities,'managed','tools','resume','history','contextBudget'])].some(c=>!(available as Record<string,boolean>)[c]))fail('template_capabilities_unavailable')
   staged={fingerprint,manifest};h.store.put('worker-template-create',key,staged)
  }
  const result=await h.manager.call({action:'create',revision:input.settingsRevision,requestId:'template:'+key,profile:{id:input.workerId,label:input.label,backend:input.backend,...(input.model?{model:input.model}:{}),state:'paused',prompt:staged.manifest.instructions,tools:[],toolConnections:[]}})
  const origin={workerId:input.workerId,id:input.id,version:input.version,digest:input.digest,requirements:staged.manifest.requirements,acceptance:staged.manifest.acceptance,createdAt:new Date().toISOString()}
  const response={...result,template:origin,requiresConfiguration:true,requires:{operatorConfiguration:true,activation:true,tools:staged.manifest.requirements.tools,capabilities:staged.manifest.requirements.capabilities},grants:[],started:false}
  return h.store.atomic(()=>{const completed=h.store.get<{result?:unknown}>('worker-template-create',key)?.result;if(completed)return completed;h.store.put('worker-template-origin',input.workerId,origin);h.store.put('worker-template-create',key,{...staged,result:response});h.store.audit({type:'worker-template.worker_created',workerId:input.workerId,template:entryKey(input),digest:input.digest});return response})
 }
}
