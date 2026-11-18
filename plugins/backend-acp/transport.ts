import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process'
import {BackendAdapterError} from '../backend-sdk.ts'

/** Stable ACP v1, JSON-RPC 2.0 newline transport. No protocol/SDK auto-upgrade. */
export const ACP_PROTOCOL_VERSION=1 as const
const MAX_FRAME=1_000_000
export type RpcId=string|number
export interface AcpNotification {method:string;params:Record<string,unknown>}
export interface AcpRequest extends AcpNotification {id:RpcId}
export const object=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v)
const validId=(id:unknown):id is RpcId=>typeof id==='number'&&Number.isSafeInteger(id)||typeof id==='string'&&id.length>0&&id.length<=200
export class AcpRpcError extends BackendAdapterError {
 constructor(readonly rpcCode:number){super(rpcCode===-32000?'auth_required':rpcCode===-32601?'unsupported':rpcCode===-32602?'configuration_invalid':'provider_rejected')}
}

export class AcpTransport {
 private readonly child:ChildProcessWithoutNullStreams
 private readonly pending=new Map<number,{resolve:(value:any)=>void;reject:(error:Error)=>void;timer:NodeJS.Timeout}>()
 private readonly incoming=new Set<string>()
 private sequence=0
 private buffer=''
 private failure?:BackendAdapterError
 private ended=false
 constructor(command:string,args:string[],cwd:string,env:NodeJS.ProcessEnv,
  private readonly onRequest:(request:AcpRequest)=>Promise<unknown>,
  private readonly onNotification:(notification:AcpNotification)=>void,
 ){
  this.child=spawn(command,args,{cwd,env,shell:false,stdio:['pipe','pipe','pipe']})
  this.child.stdout.setEncoding('utf8')
  this.child.stdout.on('data',(chunk:string)=>this.receive(chunk))
  // Drain without retaining, logging or forwarding provider stderr.
  this.child.stderr.on('data',()=>{})
  this.child.once('error',()=>this.fail(new BackendAdapterError('configuration_invalid',{operation:'transport',reason:'spawn_error'})))
  this.child.once('close',()=>{if(!this.ended)this.fail(new BackendAdapterError('process_failed',{operation:'transport',reason:'process_exit'}))})
  this.child.stdin.on('error',()=>this.fail(new BackendAdapterError('process_failed',{operation:'transport',reason:'process_exit'})))
 }
 private fail(error:BackendAdapterError){
  if(this.failure||this.ended)return
  this.failure=error
  for(const waiter of this.pending.values()){clearTimeout(waiter.timer);waiter.reject(error)}
  this.pending.clear();this.child.kill('SIGKILL')
 }
 private send(value:unknown){
  if(this.failure)throw this.failure
  if(this.ended)throw new BackendAdapterError('process_failed')
  const line=JSON.stringify(value)
  if(Buffer.byteLength(line)>MAX_FRAME)throw new BackendAdapterError('configuration_invalid')
  this.child.stdin.write(line+'\n')
 }
 notify(method:string,params:Record<string,unknown>){this.send({jsonrpc:'2.0',method,params})}
 request(method:string,params:Record<string,unknown>,timeoutMs:number):Promise<any>{
  return new Promise((resolve,reject)=>{
   const id=++this.sequence
   const timer=setTimeout(()=>{this.pending.delete(id);const error=new BackendAdapterError('process_failed',{operation:'transport',reason:'timeout'});reject(error);this.fail(error)},timeoutMs)
   this.pending.set(id,{resolve,reject,timer})
   try{this.send({jsonrpc:'2.0',id,method,params})}catch(error){clearTimeout(timer);this.pending.delete(id);reject(error)}
  })
 }
 private receive(chunk:string){
  if(this.failure||this.ended)return
  this.buffer+=chunk
  if(!this.buffer.includes('\n')&&Buffer.byteLength(this.buffer)>MAX_FRAME){this.fail(new BackendAdapterError('invalid_output'));return}
  for(;;){
   const end=this.buffer.indexOf('\n');if(end<0)break
   const line=this.buffer.slice(0,end);this.buffer=this.buffer.slice(end+1)
   if(!line.trim())continue
   if(Buffer.byteLength(line)>MAX_FRAME){this.fail(new BackendAdapterError('invalid_output'));return}
   let m:any;try{m=JSON.parse(line)}catch{this.fail(new BackendAdapterError('invalid_output'));return}
   if(!object(m)||m.jsonrpc!=='2.0'){this.fail(new BackendAdapterError('invalid_output'));return}
   if(typeof m.method==='string'){
    if(!object(m.params)){this.fail(new BackendAdapterError('invalid_output'));return}
    if('id'in m){
     if(!validId(m.id)){this.fail(new BackendAdapterError('invalid_output'));return}
     const key=typeof m.id+':'+m.id
     if(this.incoming.has(key)||this.incoming.size>=1000){this.fail(new BackendAdapterError('invalid_output'));return}
     this.incoming.add(key)
     void this.answer({id:m.id,method:m.method,params:m.params})
    }else {try{this.onNotification({method:m.method,params:m.params})}catch{this.fail(new BackendAdapterError('invalid_output'));return}}
   }else{
    if(typeof m.id!=='number'||!Number.isSafeInteger(m.id)||('result'in m)===('error'in m)){this.fail(new BackendAdapterError('invalid_output'));return}
    const waiter=this.pending.get(m.id)
    if(!waiter){this.fail(new BackendAdapterError('invalid_output'));return}
    this.pending.delete(m.id);clearTimeout(waiter.timer)
    if('error'in m){if(!object(m.error)||!Number.isSafeInteger(m.error.code)){waiter.reject(new BackendAdapterError('invalid_output'));this.fail(new BackendAdapterError('invalid_output'));return};waiter.reject(new AcpRpcError(m.error.code))}
    else waiter.resolve(m.result)
   }
  }
  if(Buffer.byteLength(this.buffer)>MAX_FRAME)this.fail(new BackendAdapterError('invalid_output'))
 }
 private async answer(request:AcpRequest){
  try{
   if(request.method!=='session/request_permission'){this.send({jsonrpc:'2.0',id:request.id,error:{code:-32601,message:'Client method unavailable'}});return}
   const result=await this.onRequest(request)
   if(!this.failure&&!this.ended)this.send({jsonrpc:'2.0',id:request.id,result})
  }catch{if(!this.failure&&!this.ended)this.send({jsonrpc:'2.0',id:request.id,result:{outcome:{outcome:'cancelled'}}})}
 }
 close(){
  if(this.ended)return
  this.ended=true
  for(const waiter of this.pending.values()){clearTimeout(waiter.timer);waiter.reject(new BackendAdapterError('process_failed'))}
  this.pending.clear();this.child.stdin.end();this.child.kill('SIGKILL')
 }
}
