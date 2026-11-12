import {taskView,type TaskContinuation} from './task-context.ts'
import {randomUUID} from 'node:crypto'
import {readFileSync,readdirSync,realpathSync,statSync,mkdirSync,writeFileSync} from 'node:fs'
import {resolve,relative,sep,join,basename,extname} from 'node:path'
import {z} from 'zod'
import {stableDigest} from './sources.ts'
import type {Runtime} from './runtime.ts'
import type {Ticket,Trigger} from './vendor/dsh-core/index.ts'
import type {Run} from './store.ts'
import {builtins,promptStatus} from './prompts.ts'
import {isHostPrivateFile} from './private-files.ts'

export const readSchema=z.object({resource:z.string().min(1).max(2000),offset:z.number().int().min(0).default(0),limit:z.number().int().min(1).max(8000).default(4000),pageSize:z.number().int().min(1).max(50).default(20),cursor:z.string().optional()}).strict()
export interface Principal {ticketId?:string;assignmentId?:string;agentId?:string;triggerId?:string}
export interface ImageResource {kind:'image';mimeType:string;data:string;description?:string}
export const resourceCatalog=[
 'tool-calls','tool-call/<id>','model-tool-receipt/<id>',
 'tickets','triggers','threads','decisions','decision/<id>','thread/<key>','trigger/<id>',
 'ticket/<id>','ticket/<id>/assignment','ticket/<id>/assignments','ticket/<id>/inputs','ticket/<id>/input/<id>',
 'ticket/<id>/result','ticket/<id>/report/<id>','ticket/<id>/transcript','ticket/<id>/message/<n>',
 'agent-configuration/<call-id>','prompt-preview/<id>','settings','settings/<block>','prompts','prompts/current','prompts/defaults','prompts/<revision>',
 'asset/<id>','feishu/<trigger-id>/file/<key>','models','models/<provider>','jobs','job/<id>','files/<path>','directory/<path>','image/<path>',
 'source/<source-id>/<resource>','trigger-source/<trigger-id>/<resource>','github/issues/<n>','github/pulls/<n>','github/pulls/<n>/comments/<page>',
 'github/pulls/<n>/reviews/<page>','github/pulls/<n>/thread/<comment>','github/pulls/<n>/checks',
 'github/commits/<sha>/checks','github/file/<path>','github/directory/<path>',
 'feishu/<trigger-id>/message','feishu/<trigger-id>/root','feishu/<trigger-id>/parent','feishu/<trigger-id>/thread',
 'feishu/<trigger-id>/around','feishu/<trigger-id>/image/<key>'
 ,'wecom/<trigger-id>/message','wecom/<trigger-id>/conversation','wecom/<trigger-id>/asset/<n>'
]
const inside=(root:string,path:string)=>{const r=relative(root,path);return !r||(!r.startsWith('..'+sep)&&r!=='..'&&!r.startsWith(sep))}
function attachmentName(value:unknown){
 const full=basename(String(value??'attachment')).replace(/[^\p{L}\p{N}._-]/gu,'_')||'attachment',extension=extname(full)
 const suffix=/^\.[a-zA-Z0-9]{1,16}$/.test(extension)?extension:'',stem=suffix?full.slice(0,-suffix.length):full
 let name='';for(const c of stem){if(Buffer.byteLength(name+c+suffix)>200)break;name+=c}
 name+=suffix;return name==='.'||name==='..'?'attachment':name
}
/** The resource grammar is shared by native tools, MCP, HTTP and the panel. */
export class Resources {
 constructor(private host:Runtime){}
 private ticket(principal:Principal,id?:string):Ticket{
  const ticket=this.host.store.tickets.get(id??principal.ticketId??'')
  if(!ticket||(principal.ticketId&&principal.ticketId!==ticket.id))throw Error('Ticket is outside this reader')
  return principal.ticketId?taskView(this.host.store,ticket):ticket
 }
 private reached(principal:Principal,id:string){
  if(principal.triggerId&&principal.triggerId!==id)throw Error('Source is outside this admission context')
  const trigger=this.host.store.triggers.get(id);if(!trigger)throw Error('Unknown trigger')
  if(principal.ticketId){const ticket=this.ticket(principal);if(!ticket.origin.triggerIds.includes(id)&&!ticket.inputs.some(i=>i.kind==='trigger'&&i.triggerId===id)&&!trigger.threads.some(r=>ticket.follows?.some(f=>f.thread===r.source+':'+r.id)))throw Error('Trigger is outside this reader')}
  return trigger
 }
 private thread(principal:Principal,key:string){
  const thread=this.host.store.threads.get(key);if(!thread)throw Error('Unknown thread')
  if(principal.ticketId){const t=this.ticket(principal);if(!t.channels.some(c=>c.source+':'+c.thread===key)&&!t.follows?.some(f=>f.thread===key)&&!thread.subscriptions.includes(t.id))throw Error('Thread is outside this reader')}
  return thread
 }
 private admin(principal:Principal){if(principal.ticketId||principal.triggerId)throw Error('Resource is only available to the operator')}
 private visibleRevision(principal:Principal,revision:number){
  if(!principal.ticketId)return
  const used=this.host.store.list<any>('prompt-use').some(p=>p.ticketId===principal.ticketId&&p.revision===revision)
  if(!used)throw Error('Prompt revision was not used by this worker')
 }
 async read(value:unknown,principal:Principal={}):Promise<any>{
  this.host.store.prunePages()
  const input=readSchema.parse(value),{resource,offset,limit,pageSize}=input
  if(principal.triggerId){
   const trigger=this.reached(principal,principal.triggerId);this.host.scopes.assertTrigger(trigger)
   const allowed=['trigger/'+trigger.id,'trigger-source/'+trigger.id+'/message','feishu/'+trigger.id+'/message','wecom/'+trigger.id+'/message']
   if(resource==='catalog')return {resources:[...allowed,'feishu/'+trigger.id+'/image/<key>','feishu/'+trigger.id+'/file/<key>'],admission:true}
   if(!allowed.includes(resource)&&!['image','file'].some(kind=>resource.startsWith('feishu/'+trigger.id+'/'+kind+'/')))throw Error('Admission may only read its current source message and attachments')
  }
  if(resource.startsWith('model-tool-receipt/')){
   this.admin(principal)
   const id=resource.slice('model-tool-receipt/'.length),value=this.host.store.get('model-tool-receipt',id)
   if(!value||this.host.memory.cleanup.blocked('model-tool-receipt',id,value))throw Error('Tool receipt unavailable or deleted')
   return this.textPage(JSON.stringify(value),offset,limit,'',resource)
  }
  const scopeSignature=()=>{if(principal.triggerId){const t=this.reached(principal,principal.triggerId);this.host.scopes.assertTrigger(t);return stableDigest(this.host.scopes.context(t,t.source+':'+t.threads[0]!.id)?.route??t.id)}if(!principal.ticketId||!this.host.scopes.enabled())return;const context=this.host.store.get<{manifest:import('./router-memory.ts').ContextManifest}>('task-context',principal.ticketId);if(!context)throw Error('Scoped reads require a verified task context');this.host.memory.validate(context.manifest);return stableDigest(context.manifest)}
  const signature=scopeSignature()
  if(resource==='catalog'){
   const run=principal.ticketId?this.host.store.get<Run>('run',this.ticket(principal).id):undefined
   const threadId=principal.agentId?this.host.store.get<{threadId?:string}>('work',principal.agentId)?.threadId:run?.threadId
   return {resources:resourceCatalog,worker:!!principal.ticketId,backend:this.host.model.describe?.(threadId,principal.agentId?'subagent':'worker'),commandSandbox:{driver:this.host.config.work.sandboxDriver,enabled:this.host.config.work.sandboxDriver!=='disabled'}}
  }
  if(input.cursor){
   const cached=this.host.store.get<any>('resource-page',input.cursor)
   if(!cached||cached.expires<Date.now()||cached.resource!==resource||cached.principal!==JSON.stringify(principal)||cached.scopeSignature!==signature)throw Error('Unknown or expired page cursor')
   return this.textPage(cached.text,offset,limit,input.cursor,resource)
  }
  let data=await this.load(resource,principal,pageSize)
  if(scopeSignature()!==signature)throw Error('Context changed during resource read')
  if(data?.kind==='file'){
   const bytes=Buffer.from(data.data,'base64');if(bytes.length>8000000)throw Error('Attachment exceeds 8 MB')
   const id=randomUUID(),name=attachmentName(data.name)
   const directory=join(this.host.config.stateDir,'assets',id);mkdirSync(directory,{recursive:true,mode:0o700})
   const path=join(directory,name==='.'||name==='..'?'attachment':name);writeFileSync(path,bytes,{mode:0o600})
   data={id,name,bytes:bytes.length,path,ticketId:principal.ticketId,resource:'asset/'+id}
   this.host.store.put('asset',id,data)
  }
  if(data&&typeof data==='object'&&data.kind==='image')return data
  if(Array.isArray(data))return {items:data.slice(offset,offset+pageSize),nextOffset:offset+pageSize<data.length?offset+pageSize:null,total:data.length,resource}
  const text=typeof data==='string'?data:JSON.stringify(data,null,2),cursor=randomUUID()
  this.host.store.put('resource-page',cursor,{resource,principal:JSON.stringify(principal),scopeSignature:signature,text,expires:Date.now()+3600000})
  return this.textPage(text,offset,limit,cursor,resource)
 }
 private textPage(text:string,offset:number,limit:number,cursor:string,resource:string){return {text:text.slice(offset,offset+limit),characters:text.length,offset,nextOffset:offset+limit<text.length?offset+limit:null,cursor,resource}}
 private async load(resource:string,p:Principal,pageSize:number):Promise<any>{
  const store=this.host.store,parts=resource.split('/'),head=parts[0],id=parts[1]
  if(resource==='tool-calls'){if(p.ticketId)this.ticket(p);return this.host.toolConnections.receipts(p.ticketId)}
  const continuation=p.ticketId?store.get<TaskContinuation>('task-continuation',p.ticketId):undefined
  if(continuation&&(['asset','prompts'].includes(head!)||head==='tool-call'&&continuation.priorToolCalls.includes(id!)||head==='job'&&continuation.priorJobs.includes(id!)))throw Error('Prior context body is quarantined; inspect effect identities only')
  if(head==='tool-call'){
   const receipt=store.get<any>('tool-receipt',id!);if(!receipt)throw Error('Unknown tool call')
   if(p.ticketId&&receipt.ticketId!==this.ticket(p).id)throw Error('Tool call is outside this worker')
   return receipt
  }
  if(['tickets','triggers','threads','decisions'].includes(resource)){
   this.admin(p)
   const kind={tickets:'ticket',triggers:'trigger',threads:'thread',decisions:'decision'}[resource]!
   return store.list<any>(kind).reverse()
  }
  if(head==='decision'){this.admin(p);const d=store.decisions.get(id!);if(!d)throw Error('Unknown decision');return d}
  if(head==='trigger'){
   const trigger=this.reached(p,parts.slice(1).join('/'))
   const thread=store.threads.get(trigger.source+':'+trigger.threads[0]?.id)
   return {trigger,disposition:store.triggers.disposition(trigger.id),thread:thread?.key}
  }
  if(head==='thread'){
   const key=parts.slice(1).join('/'),t=this.thread(p,key)
   const triggers=store.list<Trigger>('trigger').filter(x=>x.threads.some(r=>r.source+':'+r.id===key)).filter(x=>!p.ticketId||this.visibleTrigger(p,x))
   return {thread:p.ticketId?{key:t.key,ref:t.ref,meta:t.meta}:t,triggers:triggers.map(x=>({id:x.id,text:x.text.slice(0,100),resource:'trigger/'+x.id})),...(!p.ticketId?{decisions:store.decisions.byThread(key)}:{})}
  }
  if(head==='ticket'){
   const t=this.ticket(p,id),section=parts[2],run=store.get<Run>('run',t.id)
   if(!section)return {...t,run,resources:['assignment','assignments','inputs','result','transcript'].map(r=>'ticket/'+t.id+'/'+r)}
   if(section==='assignments')return [...t.assignments].reverse()
   if(section==='assignment')return {mandate:t.mandate,assignment:t.assignments.at(-1),cwd:run?.cwd}
   if(section==='inputs')return [...t.inputs].reverse()
   if(section==='input'){const i=t.inputs.find(i=>i.id===parts.slice(3).join('/'));if(!i)throw Error('Unknown input');return i}
   if(section==='result')return {result:run?.result,report:t.assignments.at(-1)?.report}
   if(section==='report'){const a=t.assignments.find(a=>a.id===parts[3]);if(!a)throw Error('Unknown assignment');return a.report??{state:a.state}}
   if(section==='transcript'||section==='message'){
    const data=run?.threadId&&this.host.model.history?await this.host.model.history(run.threadId,run.cwd):{turns:store.list<any>('transcript').filter(x=>x.ticketId===t.id&&!x.agentId&&(!continuation||x.at>continuation.at))}
    const turns=[...(data.turns??[])].reverse()
    const threadId=data.id??run?.threadId,backendId=run?.backendId??'codex',native=!run?.backendKind||run.backendKind==='codex'
    const identity=(turn:any)=>({threadId,turnId:turn.id??turn.turnId,backendId,...(native?{nativeThreadId:threadId,nativeTurnId:turn.id??turn.turnId}:{})})
    if(section==='transcript')return turns.map((turn:any,index:number)=>({index,id:turn.id??turn.turnId,...identity(turn),status:turn.status,resource:'ticket/'+t.id+'/message/'+index}))
    const n=Number(parts[3]);if(!Number.isSafeInteger(n)||!turns[n])throw Error('Unknown transcript message');return {...turns[n],...identity(turns[n])}
   }
  }
  if(head==='agent-configuration'){this.admin(p);const value=store.get('agent-configuration',id!);if(!value)throw Error('No configuration receipt for this call');return value}
  if(head==='prompt-preview'){this.admin(p);if(id==='worker'||id==='router')return {...this.host.previewPrompt({role:id}),revision:this.host.settings.current().revision};const preview=store.get('prompt-preview',id!);if(!preview)throw Error('Unknown prompt preview');return preview}
  if(head==='settings'){
   this.admin(p);const current=this.host.settings.current()
   if(!id)return {revision:current.revision,blocks:Object.keys(current.config),history:this.host.settings.history().map(x=>({revision:x.revision,at:x.at}))}
   if(!(id in current.config))throw Error('Unknown settings block')
   return {revision:current.revision,value:(current.config as any)[id]}
  }
  if(head==='prompts'){
   if(id==='defaults'){this.admin(p);return builtins}
   if(!id){this.admin(p);return {parts:promptStatus(this.host.config),history:this.host.settings.history().map(x=>({revision:x.revision,at:x.at}))}}
   const revision=id==='current'?this.host.settings.current().revision:Number(id)
   this.visibleRevision(p,revision)
   const version=this.host.settings.history().find(v=>v.revision===revision);if(!version)throw Error('Unknown prompt revision');return {revision,at:version.at,prompts:version.config.prompts}
  }
  if(head==='models'){
   this.admin(p);return this.host.model.catalog?this.host.model.catalog(id):{provider:id??'codex',model:this.host.config.model,roles:this.host.config.models,effort:this.host.config.effort}
  }
  if(resource==='jobs')return this.host.work.list(p.ticketId).filter(w=>!continuation?.priorJobs.includes(w.id)).filter(w=>!p.agentId||w.agentId===p.agentId).reverse().map(w=>({...w,resource:'job/'+w.id}))
  if(head==='asset'){
   const asset=store.get<any>('asset',id!);if(!asset||p.ticketId&&asset.ticketId!==p.ticketId)throw Error('Attachment is outside this reader')
   if(statSync(asset.path).size>8000000)throw Error('Attachment is too large')
   const data=readFileSync(asset.path);if(data.includes(0))return asset
   return data.toString('utf8')
  }
  if(head==='job'){
   const item=store.get<any>('work',id!);if(!item||p.ticketId&&item.ticketId!==p.ticketId||p.agentId&&item.agentId!==p.agentId)throw Error('Work item is outside this reader')
   return this.host.work.view(item)
  }
  if(['files','directory','image'].includes(head!)){
   if(!p.ticketId)throw Error('Local filesystem resources require an explicit task scope')
   const t=this.ticket(p),run=store.get<Run>('run',t.id);if(!run)throw Error('Work directory is not prepared')
   if(parts.slice(1).some(x=>['.git','.superagent','node_modules'].includes(x)))throw Error('Private local directory')
   const root=realpathSync(run.cwd),path=realpathSync(resolve(root,parts.slice(1).join('/')))
   if(isHostPrivateFile(path))throw Error('Host credentials are private')
   if(!inside(root,path)||inside(realpathSync(this.host.config.stateDir),path)&&!inside(realpathSync(this.host.config.stateDir),root))throw Error('Path is outside this task directory')
   if(head==='directory')return readdirSync(path,{withFileTypes:true}).filter(e=>!['.git','.superagent','node_modules'].includes(e.name)).map(e=>({name:e.name,directory:e.isDirectory()}))
   if(statSync(path).size>8000000)throw Error('File exceeds 8 MB resource limit')
   const data=readFileSync(path)
   if(head==='image')return imageResource(data)
   if(data.includes(0))throw Error('Binary file requires an image or source resource')
   return data.toString('utf8')
  }
  if(head==='github'||head==='source'){
   let sourceId:string|undefined,request:string
   if(head==='source'){sourceId=id;request=parts.slice(2).join('/')}
   else{sourceId=p.ticketId?this.ticket(p).mandate.actor.source:undefined;const matches=[...this.host.sources.values()].filter(s=>s.config.kind==='github');if(!sourceId||this.host.sources.get(sourceId)?.config.kind!=='github'){if(matches.length!==1)throw Error('Select source/<id>/github/...');sourceId=matches[0]!.config.id}request=resource}
   const source=this.host.sources.get(sourceId!)
   if(!source?.read||!source.config.enabled||!source.config.capabilities.resources)throw Error('Source does not provide enabled resource reads')
   if(p.ticketId)this.sourcePermission(this.ticket(p),sourceId!,request)
   this.scopedSourceRead(p,request)
   return source.read({resource:request,pageSize})
  }
  if(head==='trigger-source'){
   const {trigger,source}=this.authorizeSourceRead(p,parts[1]!,parts.slice(2).join('/'))
   return source.read({resource:parts.slice(2).join('/'),trigger,pageSize})
  }
  if(head==='feishu'){
   const triggerId=parts[1]!,trigger=this.reached(p,triggerId),source=this.host.sources.get(trigger.source)
   if(source?.config.kind!=='feishu'||!source.read||!source.config.enabled||!source.config.capabilities.resources)throw Error('Not an enabled Feishu resource')
   this.scopedSourceRead(p,parts.slice(2).join('/'),trigger)
   return source.read({resource:parts.slice(2).join('/'),trigger,pageSize})
  }
  if(head==='wecom'){
   const trigger=this.reached(p,parts[1]!),source=this.host.sources.get(trigger.source)
   if(source?.config.kind!=='wecom'||!source.read||!source.config.enabled||!source.config.capabilities.resources)throw Error('Not an enabled WeCom resource')
   this.scopedSourceRead(p,parts.slice(2).join('/'),trigger)
   return source.read({resource:parts.slice(2).join('/'),trigger,pageSize})
  }
  throw Error('Unknown resource. Read catalog for the supported grammar')
 }
 authorizeSourceRead(p:Principal,triggerId:string,resource:string){
   const trigger=this.reached(p,triggerId),source=this.host.sources.get(trigger.source)
   if(!source?.read||!source.config.enabled||!source.config.capabilities.resources)throw Error('Source does not provide enabled resource reads')
   if(!this.host.sourceRegistry.allowsScope(source.config,String(trigger.meta.scope??trigger.meta.chat)))throw Error('Source scope is unavailable')
   if(p.ticketId)this.sourcePermission(this.ticket(p),trigger.source,resource)
   this.scopedSourceRead(p,resource,trigger)
   return {trigger,source:source as typeof source&{read:NonNullable<typeof source.read>}}
 }
 private visibleTrigger(p:Principal,t:Trigger){const own=this.ticket(p);return own.origin.triggerIds.includes(t.id)||own.inputs.some(i=>i.kind==='trigger'&&i.triggerId===t.id)}
 private scopedSourceRead(p:Principal,resource:string,trigger?:Trigger){
  if(!p.ticketId||!this.host.scopes.enabled())return
  const context=this.host.store.get<{manifest:import('./router-memory.ts').ContextManifest}>('task-context',p.ticketId)
  if(!context)throw Error('Scoped source reads require a verified task context')
  this.host.memory.validate(context.manifest)
  const entry=this.host.scopes.binding(context.manifest.entryId),origin=trigger&&this.host.scopes.entry(trigger)
  if(trigger&&origin?.id!==entry.id)throw Error('Task sharing does not grant access to another entry source history')
  if(entry.history!=='group'&&(!trigger||resource!=='message'))throw Error('Source history visibility is unknown; use the admitted current message or an explicit authorized snapshot')
 }
 private sourcePermission(t:Ticket,source:string,resource:string){
  if(t.mandate.actor.source!==source&&!t.follows?.some(f=>f.thread.startsWith(source+':')))throw Error('Source is outside this worker')
  const adapter=this.host.sources.get(source)
  if(adapter){
   // A delegated task may read its admitted native conversation. This is a
   // transient read projection, never a public Worker reply capability.
   const owner=this.host.taskAuthority(t.id),parent=owner?.parentTrigger?this.host.store.triggers.get(owner.parentTrigger):undefined
   if(owner?.mode==='host'&&parent?.source===source&&parent.channel){this.host.routerIngress.authority(parent.id,owner.discussion);t={...t,channels:[...t.channels,parent.channel]}}
   this.host.sourceRegistry.authorizeRead(adapter.config,t,resource);adapter.authorizeRead?.(t,resource)
  }
 }
}
export function imageResource(data:Buffer):ImageResource{
 const mime=data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'image/png':data[0]===255&&data[1]===216?'image/jpeg':data.subarray(0,6).toString().startsWith('GIF8')?'image/gif':data.subarray(0,4).toString()==='RIFF'&&data.subarray(8,12).toString()==='WEBP'?'image/webp':undefined
 if(!mime)throw Error('Unsupported image format')
 return {kind:'image',mimeType:mime,data:data.toString('base64')}
}
