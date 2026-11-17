import {spawn,execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {randomUUID} from 'node:crypto'
import {StringDecoder} from 'node:string_decoder'
import {mkdirSync,existsSync,readFileSync,rmSync,openSync,closeSync,writeFileSync,copyFileSync,realpathSync,chmodSync} from 'node:fs'
import {join,dirname} from 'node:path'
import {BackendAdapterError,type BackendPlugin,type ModelRequest} from '../backend-sdk.ts'
import {checkBudget,protocolBytes,receiptReference} from '../../src/context-budget.ts'
import {digest,privateFile,readJson,endpoint} from './files.ts'
import {toolBridge} from './mcp.ts'
import {wireBridge} from './wire.ts'
import type {CliDriver,CliConfig} from './contract.ts'
import {cliFailure} from './errors.ts'
export {cliFailure} from './errors.ts'

type Turn={id:string;input:string;instructions:string;state:'running'|'completed'|'interrupted';text:string;protocolBytes:number;tools:{id:string;name:string;args:unknown;result?:unknown}[]}
type Session={format:1;folder:string;nativeId?:string;cwd:string;cliVersion:string;turns:Turn[]}
const exec=promisify(execFile)
export function createCliPlugin(driver:CliDriver):BackendPlugin{return {create(raw,{dataDirectory}){
 const config=raw as unknown as CliConfig
 if(config.cliVersion!==driver.version)throw new BackendAdapterError('unsupported')
 if(config.authMode==='anonymous'&&!driver.anonymous?.(config))throw new BackendAdapterError('configuration_invalid')
 endpoint(config.baseUrl)
 mkdirSync(dataDirectory,{recursive:true,mode:0o700})
 const auth=()=>{
  if(config.authMode==='anonymous')return undefined
  const keys=(driver.credentialKeys?.(config)??driver.credentialEnvs).filter(k=>process.env[k]?.trim())
  if(keys.length)return {identity:digest(JSON.stringify([driver.id,config.baseUrl,keys.map(k=>[k,process.env[k]])])),files:[]}
  try{return config.authDirectory?driver.auth?.(config.authDirectory,config):undefined}catch{throw new BackendAdapterError('configuration_invalid')}
 }
 const locate=(id:string,cwd:string,deleting=false)=>{
  const mapping=readJson(join(dataDirectory,'index',digest(id)+'.json'))
  if(!mapping||!/^[a-f0-9-]{36}$/.test(mapping.folder)||mapping.id!==id)throw new BackendAdapterError('invalid_output')
  const root=join(dataDirectory,'sessions',mapping.folder)
  if(mapping.deleting){
   if(!deleting||mapping.cwd!==realpathSync(cwd))throw new BackendAdapterError('configuration_invalid')
   return {root,session:undefined,mapping}
  }
  const session=readJson(join(root,'session.json')) as Session
  if(!session||session.nativeId!==id||session.cwd!==realpathSync(cwd)||session.cliVersion!==config.cliVersion)throw new BackendAdapterError('configuration_invalid')
  return {root,session,mapping}
 }
 function lock(root:string){
  const path=join(root,'writer.lock');let fd:number
  try{fd=openSync(path,'wx',0o600)}catch{
   const pid=Number(readFileSync(path,'utf8'))
   if(!Number.isInteger(pid)||pid<1)throw new BackendAdapterError('outcome_unknown')
   try{process.kill(pid,0);throw new BackendAdapterError('outcome_unknown')}catch(error:any){if(error.code!=='ESRCH')throw error}
   rmSync(path);fd=openSync(path,'wx',0o600)
  }
  writeFileSync(fd,String(process.pid));closeSync(fd)
  return ()=>rmSync(path,{force:true})
 }
 return {
  async probe(){
   let version:string
   try{version=(await exec(config.command,[...(config.args??[]),'--version'],{timeout:15000,maxBuffer:64000})).stdout.trim()}catch{throw new BackendAdapterError('configuration_invalid')}
   if(version.match(/\d+\.\d+\.\d+/)?.[0]!==config.cliVersion)throw new BackendAdapterError('configuration_invalid')
   const account=auth()
   return {available:true,authenticated:account?true:driver.anonymous?.(config)?'unknown' as const:false,remoteVerified:false as const,version,...(account?{accountIdentity:account.identity}:{})}
  },
  async run(request){
   if(request.workerMcp&&!request.tools?.length||request.compactBeforeTurn||request.ephemeral&&request.threadId)throw new BackendAdapterError('unsupported')
   if(request.options?.maxOutputTokens!==undefined)throw new BackendAdapterError('unsupported')
   const account=auth();if(!account&&(!driver.anonymous?.(config)||request.managed))throw new BackendAdapterError('auth_required')
   if(config.authMode==='anonymous'&&request.model&&request.model!==config.model)throw new BackendAdapterError('unsupported')
   const initial=request.threadId?locate(request.threadId,request.cwd):undefined
   const folder=initial?.session?.folder??randomUUID(),root=initial?.root??join(dataDirectory,'sessions',folder)
   mkdirSync(root,{recursive:true,mode:0o700});const unlock=lock(root)
   const session:Session=initial?.session??{format:1,folder,cwd:realpathSync(request.cwd),cliVersion:config.cliVersion,turns:[]}
   // A completed host receipt does not prove the native CLI durably consumed it.
   // Replaying an interrupted tool turn with fresh MCP IDs could duplicate an
   // external write. Preserve it for reconciliation instead of guessing.
   if(session.turns.some(t=>t.state!=='completed'&&t.tools.length)){unlock();throw new BackendAdapterError('outcome_unknown')}
   const turn:Turn={id:randomUUID(),input:request.input,instructions:request.instructions,state:'running',text:'',protocolBytes:0,tools:[]}
   // A killed CLI leaves its exact native session and an explicitly incomplete turn.
   for(const old of session.turns)if(old.state==='running')old.state='interrupted'
   session.turns.push(turn)
   const save=()=>privateFile(join(root,'session.json'),JSON.stringify(session))
   let child:ReturnType<typeof spawn>|undefined,bridge:Awaited<ReturnType<typeof toolBridge>>|undefined,failure:unknown,done=false,buffer='',stderr='',outputBytes=0
   const decoder=new StringDecoder('utf8'),errorDecoder=new StringDecoder('utf8')
   let wire:Awaited<ReturnType<typeof wireBridge>>|undefined
   const fail=(error:unknown)=>{failure??=error;child?.kill('SIGKILL')}
   const budget=(phase:string,extra?:unknown)=>{
    if(!request.contextBudget)return
    // Deliberately conservative native protocol accounting: all prior public
    // input/output, full tool receipts and counted (unexposed) native events.
    const protocol={instructions:request.instructions,schema:request.schema,tools:request.tools??[],turns:session.turns,extra}
    const counted=session.turns.reduce((n,t)=>n+t.protocolBytes,0)
    const adjusted={...request.contextBudget,maxBytes:Math.max(1,request.contextBudget.maxBytes-counted)}
    checkBudget(protocol,adjusted,'native-protocol',phase,r=>request.onBudget?.({...r,bytes:r.bytes+counted,maxBytes:request.contextBudget!.maxBytes}),true)
   }
   const bind=(id:string)=>{
    if(!id||id.length>1000||session.nativeId&&session.nativeId!==id)throw new BackendAdapterError('invalid_output')
    if(!session.nativeId){session.nativeId=id;save();privateFile(join(dataDirectory,'index',digest(id)+'.json'),JSON.stringify({id,folder}))}
    request.onThread?.(id)
   }
   const abort=()=>fail(new BackendAdapterError('cancelled'))
   try{
    save();budget('cli-input');if(session.nativeId)bind(session.nativeId);request.onTurn?.(turn.id)
    for(const file of account?.files??[]){const target=join(root,file.target);mkdirSync(dirname(target),{recursive:true,mode:0o700});if(!existsSync(target)){copyFileSync(file.source,target);chmodSync(target,0o600)}}
    bridge=await toolBridge(request.tools??[],async(name,args,id)=>{
     if(failure)throw failure
     if(!session.nativeId){const native=driver.discoverSession?.(root);if(native)bind(native)}
     if(!session.nativeId||!request.onTool)throw new BackendAdapterError('unsupported')
     budget('cli-tool-input',{name,args})
     wire?.check('before-native-tool',{name,args})
     const call={id,name,args} as Turn['tools'][number];turn.tools.push(call);save()
     let result=await request.onTool(name,args,id)
     if(request.contextBudget&&protocolBytes(result)>request.contextBudget.toolReserveBytes){
      if(!request.retainToolResult)throw new BackendAdapterError('unsupported')
      result=receiptReference(result,await request.retainToolResult(id,result))
     }
     call.result=result;save();budget('cli-tool-result');wire?.check('native-tool-result',{id,result})
     return call.result as Awaited<ReturnType<NonNullable<ModelRequest['onTool']>>>
    },fail)
    const prompt=request.input+'\n\nReturn the final answer as JSON matching this schema: '+JSON.stringify(request.schema)+'. No Markdown fences. Use only the supplied Roppo tools for external actions.'
    wire=await wireBridge(endpoint(driver.upstream(config,request.model))!,driver,request,fail,()=>{
     if(failure)throw failure
     if(!session.nativeId){const id=driver.discoverSession?.(root);if(id)bind(id)}
     if(!session.nativeId)throw new BackendAdapterError('invalid_output')
    })
    const prepared=driver.prepare({config:{...config,baseUrl:wire.url},root,cwd:session.cwd,nativeId:session.nativeId,newId:folder,request,mcp:bridge,prompt})
    request.onConfiguration?.({requested:request.options??{},sent:{model:request.model??config.model,parameters:request.options?.parameters,effort:request.options?.effort,cliVersion:config.cliVersion}})
    request.onCapabilities?.({mcpServers:['roppo'],disabledPlugins:['native-tools','workspace-plugins','workspace-hooks'],managed:request.managed===true})
    request.onContextReady?.()
    request.onActive?.({interrupt:async()=>abort(),steer:async()=>{throw new BackendAdapterError('unsupported')}})
    if(failure)throw failure
    request.signal?.throwIfAborted();request.signal?.addEventListener('abort',abort,{once:true})
    child=spawn(config.command,[...(config.args??[]),...prepared.args],{cwd:join(root,'work'),env:{...process.env,...prepared.env},stdio:['pipe','pipe','pipe']})
    const accept=(line:string)=>{
     if(!line.trim())return
     const value=JSON.parse(line),event=driver.event(value)
     turn.protocolBytes+=Buffer.byteLength(line);if(event.session)bind(event.session)
     if(event.error)throw new BackendAdapterError(cliFailure(event.error))
     if(event.tool&&!request.tools?.some(t=>t.name===driver.toolName(event.tool!)))throw new BackendAdapterError('unsupported')
     if(event.tool)turn.text=''
     if(event.model)request.onModel?.(event.model)
     if(event.text)turn.text+=event.text
     if(event.final!==undefined)turn.text=event.final
     if(event.done)done=true
     save();budget('cli-output')
    }
    child.stdout!.on('data',chunk=>{try{outputBytes+=chunk.length;if(outputBytes>16_000_000)throw new BackendAdapterError('invalid_output');buffer+=decoder.write(chunk);let i;while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);accept(line)}}catch(error){fail(error)}})
    child.stderr!.on('data',chunk=>{stderr=(stderr+errorDecoder.write(chunk)).slice(-64000)})
    child.stdin!.on('error',()=>fail(new BackendAdapterError('process_failed')))
    const code=await new Promise<number|null>((resolve,reject)=>{child!.once('error',()=>reject(new BackendAdapterError('process_failed')));child!.once('close',resolve);child!.stdin!.end(prepared.stdin)})
    buffer+=decoder.end();stderr+=errorDecoder.end()
    if(buffer.trim())try{accept(buffer)}catch(error){fail(error)}
    if(failure)throw failure
    if(code!==0)throw new BackendAdapterError(cliFailure(stderr),{operation:'run',reason:'process_exit',exitCode:code})
    if(!session.nativeId||!done||!turn.text.trim())throw new BackendAdapterError('invalid_output')
    turn.state='completed';save()
    request.onOutput?.({id:turn.id,type:'start',phase:'answer'});request.onOutput?.({id:turn.id,type:'delta',phase:'answer',text:turn.text});request.onOutput?.({id:turn.id,type:'end',phase:'answer'})
    return {threadId:session.nativeId,turnId:turn.id,text:turn.text}
   }catch(error){turn.state='interrupted';save();throw error}
   finally{request.signal?.removeEventListener('abort',abort);child?.kill('SIGKILL');await bridge?.close();await wire?.close();unlock()}
  },
  async history(id,cwd){const {session}=locate(id,cwd);return {id,source:'native-cli-events',turns:session!.turns.map(t=>({id:t.id,state:t.state==='running'?'interrupted':t.state,items:[{type:'userMessage',text:t.input},...t.tools.map(x=>({type:'toolCall',...x})),...(t.text?[{type:'agentMessage',text:t.text}]:[])]}))}},
  async purge(id,cwd){
   const {root,mapping}=locate(id,cwd,true),unlock=existsSync(root)?lock(root):()=>{}
   try{
    // Persist intent first. A host crash after deletion must permit the same
    // cleanup to finish, but must never permit this native ID to run again.
    privateFile(join(dataDirectory,'index',digest(id)+'.json'),JSON.stringify({...mapping,deleting:true,cwd:realpathSync(cwd)}))
    rmSync(root,{recursive:true,force:true})
    if(existsSync(root))throw new BackendAdapterError('process_failed')
    return {local:'verified' as const,provider:'not_managed' as const}
   }finally{if(existsSync(root))unlock()}
  },
 }
}}}
