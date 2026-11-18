import {createHash,randomUUID} from 'node:crypto'
import {isAbsolute,resolve} from 'node:path'
import {realpathSync} from 'node:fs'
import {BackendAdapterError,type BackendPlugin,type ModelRequest,type ModelResult} from '../backend-sdk.ts'
import {ACP_PROTOCOL_VERSION,AcpTransport,AcpRpcError,object} from './transport.ts'
import {AcpPermissions} from './permission.ts'
import {AcpState,type AcpSession} from './state.ts'

const allowedEnvironment=['ACP_TOKEN','ACP_API_KEY','HTTP_PROXY','HTTPS_PROXY','NO_PROXY'] as const
export const acpCompatibility={protocolVersion:ACP_PROTOCOL_VERSION,adapterVersion:'0.1.0',managed:false,missing:['host_tool_isolation','authoritative_history','context_budget'] as const}
export interface AcpConfig {
 command:string;args:string[];environment:string[];authenticationMethod?:string
 requestTimeoutMs:number;permissionTimeoutMs:number;cancelTimeoutMs:number
}
function configValue(value:Record<string,unknown>):AcpConfig {
 const c={command:undefined,args:[],environment:[],requestTimeoutMs:120000,permissionTimeoutMs:30000,cancelTimeoutMs:2000,...value} as unknown as AcpConfig
 if(Object.keys(value).some(k=>!['command','args','environment','authenticationMethod','requestTimeoutMs','permissionTimeoutMs','cancelTimeoutMs'].includes(k))||typeof c.command!=='string'||!isAbsolute(c.command)||c.command.includes('\0')||c.command.length>2000||!Array.isArray(c.args)||c.args.length>100||c.args.some(v=>typeof v!=='string'||v.includes('\0')||v.length>8000)||!Array.isArray(c.environment)||c.environment.some(v=>!allowedEnvironment.includes(v as typeof allowedEnvironment[number]))||new Set(c.environment).size!==c.environment.length||c.authenticationMethod!==undefined&&(typeof c.authenticationMethod!=='string'||!c.authenticationMethod||c.authenticationMethod.length>200))throw new BackendAdapterError('configuration_invalid')
 for(const [k,min,max] of [['requestTimeoutMs',100,600000],['permissionTimeoutMs',100,120000],['cancelTimeoutMs',100,10000]] as const)if(!Number.isInteger(c[k])||c[k]<min||c[k]>max)throw new BackendAdapterError('configuration_invalid')
 return c
}
export function acpEnvironment(names:readonly string[],source:NodeJS.ProcessEnv=process.env):NodeJS.ProcessEnv {
 const env:NodeJS.ProcessEnv={}
 for(const name of ['HOME','PATH','TMPDIR'])if(source[name]!==undefined)env[name]=source[name]
 for(const name of names){if(!allowedEnvironment.includes(name as typeof allowedEnvironment[number]))throw new BackendAdapterError('configuration_invalid');if(source[name]!==undefined)env[name]=source[name]}
 return env
}
interface Initialized {agentCapabilities:Record<string,any>;authMethods:{id:string;type?:string}[]}
function initialized(value:unknown):Initialized {
 if(!object(value)||value.protocolVersion!==ACP_PROTOCOL_VERSION||value.agentCapabilities!==undefined&&!object(value.agentCapabilities)||value.authMethods!==undefined&&(!Array.isArray(value.authMethods)||value.authMethods.length>100))throw new BackendAdapterError('unsupported')
 const methods=value.authMethods??[]
 if(methods.some((m:unknown)=>!object(m)||typeof m.id!=='string'||!m.id||m.id.length>200||m.type!==undefined&&typeof m.type!=='string'))throw new BackendAdapterError('invalid_output')
 return {agentCapabilities:value.agentCapabilities??{},authMethods:methods}
}
function canonicalCwd(cwd:string){try{return realpathSync(cwd)}catch{throw new BackendAdapterError('configuration_invalid')}}
const sessionId=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=1000&&!/[\x00-\x1f\x7f]/.test(v)

/** Outbound only. Standard ACP cannot prove Agent Hub managed execution invariants. */
export class AcpModel {
 private readonly config:AcpConfig
 private readonly state:AcpState
 private readonly env:NodeJS.ProcessEnv
 private readonly endpoint:string
 private busy=false
 constructor(config:Record<string,unknown>,dataDirectory:string){
  this.config=configValue(config);this.state=new AcpState(dataDirectory)
  this.env=acpEnvironment(this.config.environment)
  this.endpoint=createHash('sha256').update(JSON.stringify([this.config.command,this.config.args,this.config.authenticationMethod,this.config.environment.map(k=>[k,this.env[k]??null])])).digest('hex')
 }
 private launch(cwd:string,onRequest:ConstructorParameters<typeof AcpTransport>[4]=async()=>({outcome:{outcome:'cancelled'}}),onNotification:ConstructorParameters<typeof AcpTransport>[5]=()=>{}){
  return new AcpTransport(this.config.command,this.config.args,cwd,this.env,onRequest,onNotification)
 }
 private async initialize(transport:AcpTransport){return initialized(await transport.request('initialize',{protocolVersion:ACP_PROTOCOL_VERSION,clientCapabilities:{fs:{readTextFile:false,writeTextFile:false},terminal:false},clientInfo:{name:'agent-hub-acp-outbound',version:'0.1.0'}},Math.min(this.config.requestTimeoutMs,10000)))}
 async probe(){
  if(this.busy)throw new BackendAdapterError('unsupported')
  const transport=this.launch(resolve(process.cwd()))
  try{
   await this.initialize(transport)
   return {available:true,authenticated:'unknown' as const,remoteVerified:false as const,version:'ACP v1 / adapter 0.1.0'}
  }finally{transport.close()}
 }
 async run(r:ModelRequest):Promise<ModelResult>{
  if(this.busy||r.managed||r.tools?.length||r.workerMcp||r.contextBudget||r.compactBeforeTurn||r.model||r.attachments?.length||Object.keys(r.options??{}).some(k=>!['timeoutMs','parameters'].includes(k))||r.options?.parameters&&Object.keys(r.options.parameters).length)throw new BackendAdapterError('unsupported')
  if(r.signal?.aborted)throw new BackendAdapterError('cancelled')
  const cwd=canonicalCwd(r.cwd),turnId=randomUUID()
  let saved:AcpSession|undefined,unlock:(()=>void)|undefined,promptSent=false,promptConfirmed=false,cancelRequested=false,permissions:AcpPermissions|undefined,cancelTimer:NodeJS.Timeout|undefined
  if(r.threadId!==undefined){
   if(!sessionId(r.threadId))throw new BackendAdapterError('configuration_invalid')
   unlock=this.state.lock(r.threadId)
   try{saved=this.state.read(r.threadId);if(saved.cwd!==cwd||saved.endpoint!==this.endpoint)throw new BackendAdapterError('configuration_invalid');if(saved.state==='prompt_pending'||saved.state==='uncertain')throw new BackendAdapterError('outcome_unknown');if(saved.state==='closed')throw new BackendAdapterError('unsupported')}catch(error){unlock();throw error}
  }
  this.busy=true
  let text='',outputStarted=false,loading=false,transport:AcpTransport
  let rejectCancel:(error:Error)=>void=()=>{}
  const cancellationDeadline=new Promise<never>((_,reject)=>{rejectCancel=reject})
  const cancel=()=>{
   if(cancelRequested)return
   cancelRequested=true;permissions?.cancel()
   if(!promptSent){transport.close();return}
   if(saved){
    try{transport.notify('session/cancel',{sessionId:saved.sessionId})}catch{}
    cancelTimer=setTimeout(()=>{transport.close();rejectCancel(new BackendAdapterError('outcome_unknown'))},this.config.cancelTimeoutMs)
   }
  }
  transport=this.launch(cwd,request=>permissions?.request(request)??Promise.resolve({outcome:{outcome:'cancelled'}}),notification=>{
   if(notification.method!=='session/update'||loading||!saved||notification.params.sessionId!==saved.sessionId||!object(notification.params.update))return
   const update=notification.params.update
   if(update.sessionUpdate!=='agent_message_chunk'||!object(update.content)||update.content.type!=='text'||typeof update.content.text!=='string')return
   if(!promptSent||promptConfirmed||cancelRequested)return
   const chunk=update.content.text
   if(Buffer.byteLength(text)+Buffer.byteLength(chunk)>8_000_000)throw new BackendAdapterError('invalid_output')
   text+=chunk
   if(!outputStarted){r.onOutput?.({id:turnId,type:'start',phase:'answer'});outputStarted=true}
   r.onOutput?.({id:turnId,type:'delta',phase:'answer',text:chunk})
  })
  r.signal?.addEventListener('abort',cancel,{once:true})
  try{
   const peer=await this.initialize(transport)
   if(cancelRequested||r.signal?.aborted)throw new BackendAdapterError('cancelled')
   if(this.config.authenticationMethod){
    const method=peer.authMethods.find(m=>m.id===this.config.authenticationMethod)
    if(!method||method.type!==undefined&&method.type!=='agent')throw new BackendAdapterError('auth_required')
    await transport.request('authenticate',{methodId:method.id},this.config.requestTimeoutMs)
   }
   if(saved){
    if(peer.agentCapabilities.loadSession!==true)throw new BackendAdapterError('unsupported')
    loading=true
    await transport.request('session/load',{sessionId:saved.sessionId,cwd,mcpServers:[]},this.config.requestTimeoutMs)
    loading=false
   }else{
    const result=await transport.request('session/new',{cwd,mcpServers:[]},this.config.requestTimeoutMs)
    if(!object(result)||!sessionId(result.sessionId))throw new BackendAdapterError('invalid_output')
    saved={version:1,sessionId:result.sessionId,cwd,endpoint:this.endpoint,state:'ready',createdAt:Date.now(),updatedAt:Date.now()}
    unlock=this.state.lock(saved.sessionId);this.state.create(saved)
   }
   r.onThread?.(saved.sessionId);r.onTurn?.(turnId)
   r.onCapabilities?.({mcpServers:[],disabledPlugins:[],managed:false})
   r.onActive?.({interrupt:async()=>cancel(),steer:async()=>{throw new BackendAdapterError('unsupported')}})
   if(cancelRequested||r.signal?.aborted)throw new BackendAdapterError('cancelled')
   permissions=new AcpPermissions(saved.sessionId,turnId,this.config.permissionTimeoutMs,r.onHumanRequest)
   saved={...saved,state:'prompt_pending',lastTurnId:turnId,updatedAt:Date.now()};this.state.write(saved)
   promptSent=true
   const result=await Promise.race([transport.request('session/prompt',{sessionId:saved.sessionId,prompt:[{type:'text',text:r.instructions+'\n\n'+r.input}]},Math.min(r.options?.timeoutMs??this.config.requestTimeoutMs,600000)),cancellationDeadline])
   if(!object(result)||!['end_turn','cancelled','max_tokens','max_turn_requests','refused'].includes(result.stopReason))throw new BackendAdapterError('invalid_output')
   promptConfirmed=true
   saved={...saved,state:'ready',updatedAt:Date.now()};this.state.write(saved)
   if(outputStarted)r.onOutput?.({id:turnId,type:'end',phase:'answer'})
   if(result.stopReason==='cancelled')throw new BackendAdapterError('cancelled')
   if(cancelRequested){promptConfirmed=false;throw new BackendAdapterError('outcome_unknown')}
   if(result.stopReason==='refused')throw new BackendAdapterError('provider_rejected')
   if(result.stopReason!=='end_turn'||!text.trim())throw new BackendAdapterError('invalid_output')
   if(object(peer.agentCapabilities.sessionCapabilities?.close)){
    try{await transport.request('session/close',{sessionId:saved.sessionId},Math.min(this.config.requestTimeoutMs,2000));saved.closeConfirmed=true;this.state.write(saved)}catch{/* A confirmed prompt is never replayed because close failed. */}
   }
   return {threadId:saved.sessionId,turnId,text}
  }catch(error){
   if(saved&&promptSent&&!promptConfirmed){saved={...saved,state:'uncertain',updatedAt:Date.now()};this.state.write(saved);throw new BackendAdapterError('outcome_unknown')}
   if(cancelRequested&&!promptSent)throw new BackendAdapterError('cancelled')
   throw error instanceof BackendAdapterError?error:new BackendAdapterError('process_failed')
  }finally{
   permissions?.cancel();if(cancelTimer)clearTimeout(cancelTimer);r.signal?.removeEventListener('abort',cancel);transport.close();unlock?.();this.busy=false
  }
 }
 /** Explicit close is idempotent locally and does not claim to undo prior effects. */
 async closeSession(id:string,cwd:string){
  const unlock=this.state.lock(id)
  let transport:AcpTransport|undefined
  try{
   const saved=this.state.read(id)
   if(saved.cwd!==canonicalCwd(cwd)||saved.endpoint!==this.endpoint)throw new BackendAdapterError('configuration_invalid')
   if(saved.state==='closed')return {closed:true,previousEffects:'not_reverted' as const}
   if(saved.state==='uncertain'||saved.state==='prompt_pending')throw new BackendAdapterError('outcome_unknown')
   transport=this.launch(saved.cwd);const peer=await this.initialize(transport)
   if(!object(peer.agentCapabilities.sessionCapabilities?.close))throw new BackendAdapterError('unsupported')
   try{await transport.request('session/close',{sessionId:id},this.config.requestTimeoutMs)}catch(error){if(!(error instanceof AcpRpcError)||error.rpcCode!==-32002)throw error}
   this.state.write({...saved,state:'closed',updatedAt:Date.now(),closeConfirmed:true})
   return {closed:true,previousEffects:'not_reverted' as const}
  }finally{transport?.close();unlock()}
 }
}
export default {create:(config,context)=>new AcpModel(config,context.dataDirectory)} satisfies BackendPlugin
