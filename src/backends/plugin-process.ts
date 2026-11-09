import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process'
import {mkdtempSync,mkdirSync,rmSync,realpathSync,existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve,relative,isAbsolute,sep} from 'node:path'
import {fileURLToPath} from 'node:url'
import {randomUUID} from 'node:crypto'
import {z} from 'zod'
import {Ajv} from 'ajv'
import type {Config} from '../config.ts'
import type {PluginBackendDefinition} from '../backend-config.ts'
import type {Model,ModelRequest,ModelResult,BackendDescription} from '../model.ts'
import type {ThreadStore} from './api.ts'
import {sandboxCommand} from '../sandbox.ts'
import {hostPrivateFiles} from '../private-files.ts'
import {stableDigest} from '../sources.ts'
import {ContextBudgetExceeded,type BudgetReceipt} from '../context-budget.ts'
import {TransientModelError} from '../model.ts'
import {normalizeUsage} from '../model-usage.ts'
import {backendEnvelope,backendResult,backendDiagnosticSchema,BackendPluginError,type BackendDiagnostic} from './plugin-contract.ts'
import {installBackendPackage,readBackendPackage,backendObjects,validatePluginValue,type BackendPackage} from './plugin-package.ts'

interface Thread {id:string;backendId:string;pluginId:string;digest:string;stateVersion:number;nativeId?:string;cwd:string;identity:string;accountIdentity?:string;state:'running'|'completed'|'failed'|'interrupted';effectIds:string[];turnId?:string;lastFailure?:{at:number;code:string;diagnostic?:BackendDiagnostic}}
interface Effect {fingerprint:string;state:'running'|'complete';result?:Awaited<ReturnType<NonNullable<ModelRequest['onTool']>>>;failure?:BackendDiagnostic}
const text=z.string().min(1).max(1000)
const healthSchema=z.object({available:z.boolean(),authenticated:z.union([z.boolean(),z.literal('unknown')]),remoteVerified:z.literal(false),accountIdentity:z.string().regex(/^[a-f0-9]{64}$/).optional(),version:z.string().max(200).optional()}).strict()
const historySchema=z.object({id:z.string().min(1).max(1000),turns:z.array(z.unknown())}).passthrough()
const quote=(value:string)=>"'"+value.replaceAll("'","'\\''")+"'"
const inside=(root:string,path:string)=>{const r=relative(root,path);return !r||r!=='..'&&!r.startsWith('..'+sep)&&!isAbsolute(r)}
const canonical=(path:string)=>existsSync(path)?realpathSync(path):resolve(path)
const ajv=new Ajv({strict:false,validateFormats:false})
export const pluginIdentity=(definition:PluginBackendDefinition,pkg:BackendPackage)=>stableDigest({plugin:pkg.manifest.id,stateVersion:pkg.manifest.stateVersion,config:definition.config,env:definition.env,readPaths:definition.readPaths,writePaths:definition.writePaths})

/** Native IDs never escape this adapter. Host thread bindings retain an immutable package digest. */
export class ProcessBackend implements Model {
 constructor(readonly id:string,readonly definition:PluginBackendDefinition,readonly pkg:BackendPackage,private config:Pick<Config,'stateDir'|'codex'|'work'|'turnTimeoutMs'>,private store:ThreadStore){
  validatePluginValue(pkg.manifest.configSchema,definition.config,'configuration')
  if(Object.keys(definition.env).some(k=>!pkg.manifest.environment.includes(k)||['HOME','PATH','NODE_OPTIONS','NODE_PATH','TMPDIR','TMP','TEMP'].includes(k)))throw Error('Execution backend environment is not declared or is host-owned')
 }
 describe():BackendDescription{return {id:this.id,kind:'plugin',model:this.definition.model,...this.pkg.manifest.capabilities}}
 private record(id:string){
  const record=this.store.get<Thread>('backend-plugin-thread',id)
  if(!record||record.backendId!==this.id||record.identity!==pluginIdentity(this.definition,this.pkg)||record.pluginId!==this.pkg.manifest.id||record.stateVersion!==this.pkg.manifest.stateVersion)throw Error('Execution backend session identity changed; explicit migration required')
  return record
 }
 private pinned(record?:Thread){return record?readBackendPackage(join(backendObjects(this.config.stateDir),record.digest),record.digest):installBackendPackage(this.pkg.directory,this.config.stateDir,this.pkg.digest)}
 private save(record:Thread){this.store.put('backend-plugin-thread',record.id,record)}
 async run(request:ModelRequest):Promise<ModelResult>{
  const old=request.threadId?this.record(request.threadId):undefined,pkg=this.pinned(old),caps=pkg.manifest.capabilities
  if(old&&!caps.resume)throw new BackendPluginError('unsupported',this.id)
  if(request.managed&&(!caps.managed||!caps.tools||!caps.resume||!caps.history||!caps.contextBudget))throw new BackendPluginError('unsupported',this.id)
  if(request.contextBudget&&!caps.contextBudget||request.tools?.length&&!caps.tools||request.workerMcp&&!caps.managed||request.compactBeforeTurn)throw new BackendPluginError('unsupported',this.id)
  validatePluginValue(pkg.manifest.parametersSchema,request.options?.parameters??{},'parameters')
  const cwd=canonical(request.cwd)
  if(old&&old.cwd!==cwd)throw Error('Execution backend workspace changed; explicit migration required')
  const record:Thread=old??{id:'plugin:'+randomUUID(),backendId:this.id,pluginId:pkg.manifest.id,digest:pkg.digest,stateVersion:pkg.manifest.stateVersion,identity:pluginIdentity(this.definition,pkg),cwd,state:'running',effectIds:[]}
  if(record.effectIds.some(id=>this.store.get<Effect>('backend-plugin-tool',id)?.state==='running'))throw new BackendPluginError('outcome_unknown',this.id)
  let transport:Awaited<ReturnType<ProcessBackend['launch']>>|undefined
  try{
   transport=await this.launch(pkg,cwd,request,record)
   const probe=await transport.call('probe',{args:[]})
   const health=healthSchema.parse(probe)
   if(!health.available)throw new BackendPluginError('configuration_invalid',this.id)
   if(health.authenticated===false)throw new BackendPluginError('auth_required',this.id)
   if(request.managed&&(!health.accountIdentity||health.authenticated!==true))throw new BackendPluginError('auth_required',this.id)
   if(record.accountIdentity&&record.accountIdentity!==health.accountIdentity)throw new BackendPluginError('auth_required',this.id)
   record.accountIdentity=health.accountIdentity;record.state='running';this.save(record)
   const callbacks=['onThread','onTurn','onConfiguration','onBudget','onActive',...Object.keys(request).filter(k=>k.startsWith('on')&&typeof (request as any)[k]==='function'),...(request.retainToolResult?['retainToolResult']:[])]
   const input=Object.fromEntries(Object.entries(request).filter(([k,v])=>typeof v!=='function'&&!['signal','threadId','activity'].includes(k)))
   const result=backendResult.parse(await transport.call('run',{...input,model:request.model??this.definition.model,threadId:record.nativeId,callbacks}))
   if(record.effectIds.some(id=>this.store.get<Effect>('backend-plugin-tool',id)?.state==='running'))throw new BackendPluginError('outcome_unknown',this.id)
   if(!record.nativeId||result.threadId!==record.nativeId||result.turnId!==record.turnId)throw new BackendPluginError('invalid_output',this.id)
   if(Object.keys(request.schema).length){let output:unknown;try{output=JSON.parse(result.text)}catch{throw new BackendPluginError('invalid_output',this.id)}if(!ajv.compile(request.schema)(output))throw new BackendPluginError('invalid_output',this.id)}
   record.state='completed';this.save(record)
   return {threadId:record.id,turnId:result.turnId,text:result.text}
  }catch(error){record.state=request.signal?.aborted?'interrupted':'failed';record.lastFailure={at:Date.now(),code:error instanceof BackendPluginError?error.code:error instanceof TransientModelError?'transient':'process_failed',...(error instanceof BackendPluginError&&error.diagnostic?{diagnostic:error.diagnostic}:error instanceof TransientModelError&&record.lastFailure?.diagnostic?{diagnostic:record.lastFailure.diagnostic}:{})};this.save(record);throw error}
  finally{await transport?.close()}
 }
 async history(threadId:string,cwd:string){return this.inspect('history',threadId,cwd)}
 async purge(threadId:string,cwd:string){
  const tombstone=this.store.get<Thread&{deleted?:boolean}>('backend-plugin-thread',threadId)
  // A completed cleanup erases the native mapping. Its paired durable receipt
  // permits retries/replayed cleanup without inventing a replacement identity.
  if(tombstone?.deleted&&this.store.get('backend-deleted',threadId)){
   if(tombstone.id!==threadId||tombstone.backendId!==this.id||canonical(cwd)!==tombstone.cwd)throw Error('Execution backend workspace or identity changed')
   return {local:'verified' as const,provider:'not_managed' as const}
  }
  const value=await this.inspect('purge',threadId,cwd)
  return z.object({local:z.literal('verified'),provider:z.literal('not_managed')}).strict().parse(value)
 }
 async expose(threadId:string,cwd:string){await this.inspect('expose',threadId,cwd)}
 private async inspect(method:'history'|'purge'|'expose',threadId:string,cwd:string){
  const record=this.record(threadId),pkg=this.pinned(record)
  if(!text.safeParse(record.nativeId).success)throw new BackendPluginError('invalid_output',this.id)
  if(canonical(cwd)!==record.cwd||!pkg.manifest.capabilities[method==='expose'?'nativeTakeover':method])throw new BackendPluginError('unsupported',this.id)
  const transport=await this.launch(pkg,record.cwd,undefined,record)
  try{
   const health=healthSchema.parse(await transport.call('probe',{args:[]}))
   if(record.accountIdentity&&record.accountIdentity!==health.accountIdentity)throw new BackendPluginError('auth_required',this.id)
   const value=await transport.call(method,{args:[record.nativeId,record.cwd]})
   if(method!=='history')return value
   const history=historySchema.safeParse(value)
   if(!history.success||!record.nativeId||history.data.id!==record.nativeId)throw new BackendPluginError('invalid_output',this.id)
   return {...history.data,id:record.id}
  }finally{await transport.close()}
 }
 async catalog(){
  if(!this.pkg.manifest.capabilities.modelCatalog)throw new BackendPluginError('unsupported',this.id)
  const transport=await this.launch(this.pinned(),this.config.stateDir)
  try{return await transport.call('catalog',{args:[]})}finally{await transport.close()}
 }
 async probe(){
  const transport=await this.launch(this.pinned(),this.config.stateDir)
  try{return healthSchema.parse(await transport.call('probe',{args:[]}))}finally{await transport.close()}
 }
 private async launch(pkg:BackendPackage,cwd:string,request?:ModelRequest,record?:Thread){
  const scratch=mkdtempSync(join(tmpdir(),'agenthub-backend-')),dataDirectory=join(this.config.stateDir,'backend-plugin-data',this.id,pluginIdentity(this.definition,pkg))
  mkdirSync(dataDirectory,{recursive:true,mode:0o700})
  let child:ChildProcessWithoutNullStreams|undefined,closed=false,sequence=0,toolCalls=0,lastBudget:BudgetReceipt|undefined,buffer=''
  const pending=new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void}>(),readReceipts=new Map<number,()=>void>(),inflightTools=new Set<string>(),callbackIds=new Set<number>()
  const fail=(error:Error)=>{if(closed)return;closed=true;for(const p of pending.values())p.reject(error);pending.clear();if(child?.pid)try{process.kill(-child.pid,'SIGKILL')}catch{child.kill('SIGKILL')}}
  const send=(value:unknown)=>{if(closed)throw new BackendPluginError('process_failed',this.id);const line=JSON.stringify(value);if(Buffer.byteLength(line)>16_000_000)throw new BackendPluginError('invalid_output',this.id);child!.stdin.write(line+'\n',error=>{if(error)fail(new BackendPluginError('process_failed',this.id))})}
  const call=(method:string,params:unknown,onRead?:()=>void)=>new Promise<any>((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});if(onRead)readReceipts.set(id,onRead);try{send({type:'call',id,method,params})}catch(error){pending.delete(id);reject(error)}})
  const alive=()=>{if(closed||request?.signal?.aborted)throw new BackendPluginError('cancelled',this.id)}
  const callback=async(m:Extract<z.infer<typeof backendEnvelope>,{type:'request'}>)=>{
   try{
    alive();if(!request||!record?.nativeId)throw new BackendPluginError('unsupported',this.id)
    if(callbackIds.has(m.id)||callbackIds.size>=10000)throw new BackendPluginError('invalid_output',this.id)
    callbackIds.add(m.id)
    let result:unknown
    if(m.method==='tool'){
     // A thrown host operation is not permission to try the write with a new
     // native call ID. Keep the durable uncertainty fence within this turn too.
     if(record.effectIds.some(id=>this.store.get<Effect>('backend-plugin-tool',id)?.failure))throw new BackendPluginError('outcome_unknown',this.id)
     const p=z.object({name:text,args:z.unknown(),callId:text}).strict().parse(m.params),spec=request.tools?.find(t=>t.name===p.name)
     if(!spec||!request.onTool||!ajv.compile(spec.inputSchema)(p.args))throw new BackendPluginError('unsupported',this.id)
     const id=stableDigest([record.id,record.turnId,p.callId]),fingerprint=stableDigest([p.name,p.args]),saved=this.store.get<Effect>('backend-plugin-tool',id)
     if(saved){if(saved.fingerprint!==fingerprint||saved.state!=='complete')throw new BackendPluginError('outcome_unknown',this.id);result=saved.result}
     else{
      if(inflightTools.has(id)||record.effectIds.length>=10000)throw new BackendPluginError('outcome_unknown',this.id)
      if(++toolCalls>(request.options?.maxToolCalls??256))throw new BackendPluginError('unsupported',this.id)
      inflightTools.add(id);record.effectIds.push(id);this.save(record)
      this.store.put('backend-plugin-tool',id,{fingerprint,state:'running'})
      try{result=await request.onTool(p.name,p.args,p.callId)}
      catch(error){const diagnostic=backendDiagnosticSchema.safeParse((error as any)?.diagnostic);this.store.put('backend-plugin-tool',id,{fingerprint,state:'running',failure:diagnostic.success?diagnostic.data:{operation:'tool',reason:'exception'}});throw error}
      this.store.put('backend-plugin-tool',id,{fingerprint,state:'complete',result});inflightTools.delete(id)
     }
    }else if(m.method==='human'){
     if(!request.onHumanRequest)throw new BackendPluginError('unsupported',this.id)
     const value=z.object({id:text,method:text,params:z.unknown()}).strict().parse(m.params.request)
     result=await request.onHumanRequest(value)
    }else{
     const p=z.object({callId:text,result:z.unknown()}).strict().parse(m.params)
     if(!request.retainToolResult)throw new BackendPluginError('unsupported',this.id)
     result=await request.retainToolResult(p.callId,p.result)
    }
    alive();send({type:'response',id:m.id,result})
   }catch(error){if(!closed)send({type:'response',id:m.id,error:{code:error instanceof BackendPluginError?error.code:'outcome_unknown'}})}
  }
  const event=(m:Extract<z.infer<typeof backendEnvelope>,{type:'event'}>)=>{
   alive();if(!request||!record)throw Error('Unexpected backend event')
   const value=m.value
   switch(m.event){
    case 'thread':{const id=text.parse(value);if(record.nativeId&&record.nativeId!==id)throw Error('Backend replaced its native session');record.nativeId=id;this.save(record);request.onThread?.(record.id);break}
    case 'turn':record.turnId=text.parse(value);this.save(record);request.onTurn?.(record.turnId);break
    case 'model':request.onModel?.(text.parse(value));break
    case 'usage':{const usage=normalizeUsage(value);if(usage)request.onUsage?.(usage);break}
    case 'configuration':request.onConfiguration?.(z.object({requested:z.record(z.string(),z.unknown()),sent:z.record(z.string(),z.unknown()),confirmed:z.record(z.string(),z.unknown()).optional()}).strict().parse(value) as any);break
    case 'capabilities':request.onCapabilities?.(z.object({mcpServers:z.array(text),disabledPlugins:z.array(text),managed:z.boolean()}).strict().parse(value));break
    case 'progress':request.onProgress?.(text.parse(value));break
    case 'output':request.onOutput?.(z.object({id:text,type:z.enum(['start','delta','end']),text:z.string().max(1_000_000).optional(),phase:z.enum(['answer','commentary'])}).strict().parse(value));break
    case 'contextReady':request.onContextReady?.();break
    case 'budget':{lastBudget=z.object({basis:z.enum(['api-wire','native-protocol']),phase:text,bytes:z.number().nonnegative(),maxBytes:z.number().positive(),reservedBytes:z.number().nonnegative(),status:z.enum(['within_budget','exceeded'])}).strict().parse(value);request.onBudget?.(lastBudget);if(lastBudget.status==='exceeded')throw new ContextBudgetExceeded(lastBudget);break}
    case 'inputRead':{const id=z.number().int().positive().parse(value),read=readReceipts.get(id);if(!read)throw Error('Unexpected input acknowledgement');readReceipts.delete(id);read();break}
    case 'active':request.onActive?.({interrupt:async()=>{await call('control',{action:'interrupt'})},steer:async(value,onRead)=>{if(!pkg.manifest.capabilities.steering)throw new BackendPluginError('unsupported',this.id);await call('control',{action:'steer',text:value},onRead)},...(pkg.manifest.capabilities.promptRefresh?{refresh:async(value:string)=>{await call('control',{action:'refresh',text:value})}}:{})});break
   }
  }
  const abort=()=>{if(!closed){try{send({type:'cancel'})}catch{}fail(new BackendPluginError('cancelled',this.id))}}
  const timer=setTimeout(()=>fail(new BackendPluginError('outcome_unknown',this.id,{operation:'transport',reason:'timeout'})),request?.options?.timeoutMs??this.config.turnTimeoutMs)
  let exited:Promise<void>=Promise.resolve()
  const close=async()=>{clearTimeout(timer);request?.signal?.removeEventListener('abort',abort);fail(new BackendPluginError('process_failed',this.id));readReceipts.clear();await exited;rmSync(scratch,{recursive:true,force:true})}
  try{
   const runner=fileURLToPath(new URL('./plugin-worker.mjs',import.meta.url)),env:Record<string,string>={PATH:process.env.PATH??'',HOME:scratch,TMPDIR:scratch,LANG:process.env.LANG??'en_US.UTF-8'}
   for(const [key,reference] of Object.entries(this.definition.env)){if(process.env[reference]===undefined)throw new BackendPluginError('auth_required',this.id);env[key]=process.env[reference]!}
   for(const path of [...this.definition.readPaths,...this.definition.writePaths])if(!isAbsolute(path))throw Error('Execution backend paths must be absolute')
   const state=canonical(this.config.stateDir)
   for(const path of this.definition.writePaths)if(inside(canonical(path),state)||inside(state,canonical(path)))throw Error('Execution plugin cannot request writes to host state')
   const workDirectory=record?cwd:scratch
   const command=sandboxCommand({sandboxDriver:this.config.work.sandboxDriver,codex:this.config.codex,cwd:workDirectory,scratch,sandbox:'read-only',network:pkg.manifest.network,privateState:state,privatePaths:hostPrivateFiles(),attachments:[runner,process.execPath,join(pkg.directory,'plugin.mjs'),...this.definition.readPaths],writablePaths:[dataDirectory,...this.definition.writePaths],command:'exec '+[process.execPath,runner].map(quote).join(' ')})
   child=spawn(command.command,command.args,{cwd:workDirectory,env,stdio:['pipe','pipe','pipe'],detached:true})
   exited=new Promise<void>(done=>child!.once('close',()=>done()))
   child.stderr.resume();child.stdin.on('error',()=>fail(new BackendPluginError('process_failed',this.id)))
   child.once('error',()=>fail(new BackendPluginError('process_failed',this.id,{operation:'transport',reason:'spawn_error'})));child.once('close',code=>fail(new BackendPluginError('process_failed',this.id,{operation:'transport',reason:'process_exit',exitCode:code})))
   child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{
    if(closed)return;buffer+=chunk;if(Buffer.byteLength(buffer)>16_000_000){fail(new BackendPluginError('invalid_output',this.id));return}
    let i:number
    while(!closed&&(i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1)
     try{
      const m=backendEnvelope.parse(JSON.parse(line))
      if(m.type==='event')event(m)
      else if(m.type==='request')void callback(m)
      else{const waiter=pending.get(m.id);if(!waiter)throw Error('Unexpected backend response');pending.delete(m.id);if(m.error){const code=m.error.code;if(record)record.lastFailure={at:Date.now(),code,diagnostic:m.error.diagnostic};waiter.reject(code==='context_budget_exceeded'&&lastBudget?new ContextBudgetExceeded(lastBudget):code==='transient'?new TransientModelError('Execution backend temporarily unavailable'):new BackendPluginError(code,this.id,m.error.diagnostic))}else waiter.resolve(m.result)}
     }catch(error){fail(error instanceof ContextBudgetExceeded?error:new BackendPluginError('invalid_output',this.id))}
    }
   })
   request?.signal?.addEventListener('abort',abort,{once:true});if(request?.signal?.aborted)abort()
   await call('initialize',{module:join(pkg.directory,'plugin.mjs'),config:this.definition.config,dataDirectory})
   return {call,close}
  }catch(error){await close();throw error}
 }
}
