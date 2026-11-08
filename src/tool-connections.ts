import {ProcessSource} from './plugin-process.ts'
import type {TaskContinuation} from './task-context.ts'
import {Client} from '@modelcontextprotocol/sdk/client/index.js'
import {StdioClientTransport,getDefaultEnvironment} from '@modelcontextprotocol/sdk/client/stdio.js'
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import {Ajv} from 'ajv'
import {Ajv2020} from 'ajv/dist/2020.js'
import type {jsonSchemaValidator,JsonSchemaType} from '@modelcontextprotocol/sdk/validation/types.js'
import type {Tool} from '@modelcontextprotocol/sdk/types.js'
import {bodyDigest,stableDigest} from './sources.ts'
import type {Runtime} from './runtime.ts'
import type {WorkOwner} from './work.ts'
import type {ToolContent} from './model.ts'

interface Receipt {id:string;ticketId:string;agentId?:string;connection:string;tool:string;fingerprint:string;state:'running'|'complete'|'uncertain';result?:any;reason?:string}
type ToolResult={success:boolean;contentItems:ToolContent[]}
const schemas:jsonSchemaValidator={getValidator<T>(schema:JsonSchemaType){
  const dialect=schema.$schema
  if(dialect&&!['http://json-schema.org/draft-07/schema#','https://json-schema.org/draft/2020-12/schema'].includes(dialect))throw Error('Unsupported tool schema dialect: '+dialect)
  const validator=dialect==='http://json-schema.org/draft-07/schema#'?new Ajv({strict:false,validateFormats:false}):new Ajv2020({strict:false,validateFormats:false})
  const validate=validator.compile(schema)
  return (input:unknown)=>validate(input)?{valid:true as const,data:input as T,errorMessage:undefined}:{valid:false as const,data:undefined,errorMessage:validator.errorsText(validate.errors)}
}}
function abortable<T>(promise:Promise<T>,signal?:AbortSignal):Promise<T>{
  if(!signal)return promise
  signal.throwIfAborted()
  return new Promise((resolve,reject)=>{
    const abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true})
    promise.then(value=>{signal.removeEventListener('abort',abort);resolve(value)},error=>{signal.removeEventListener('abort',abort);reject(error)})
  })
}
interface Connection {client:Client;ready:Promise<Client>;controller:AbortController}
/** Outbound MCP is independent of conversation sources and model backends. */
export class ToolConnections {
  private readonly clients=new Map<string,Connection>()
  private readonly calls=new Map<string,{fingerprint:string;promise:Promise<ToolResult>;controller:AbortController;owner:WorkOwner}>()
  private closing=false
  private readonly shutdown=new AbortController()
  constructor(private readonly host:Runtime){
    for(const receipt of host.store.list<Receipt>('tool-receipt'))if(receipt.state==='running')host.store.put('tool-receipt',receipt.id,{...receipt,state:'uncertain',reason:'Host stopped during the call; inspect the destination before issuing a new request'})
  }
  configured(){return Object.entries(this.host.config.toolConnections).map(([id,c])=>({id,label:c.label??id,enabled:c.enabled,transport:c.transport.kind,allowedTools:c.allowedTools}))}
  receipts(ticketId?:string){return this.host.store.list<Receipt>('tool-receipt').filter(r=>!ticketId||r.ticketId===ticketId).map(({result,fingerprint,...r})=>({...r,resource:'tool-call/'+r.id}))}
  private allowed(owner:WorkOwner,id:string){
    if(this.closing||!this.host.validWork(owner))throw Error('Assignment capability has ended')
    const grant=this.host.store.get<any>('run',owner.ticketId)?.agentOptions?.toolConnections??[]
    const connection=this.host.config.toolConnections[id]
    if(!grant.includes(id)||!connection?.enabled)throw Error('Tool connection is not enabled for this Worker')
    return connection
  }
  private connect(id:string):Promise<Client>{
    const existing=this.clients.get(id);if(existing)return existing.ready
    const c=this.host.config.toolConnections[id]!,client=new Client({name:'agenthub-tools',version:'1.0.0'},{capabilities:{},jsonSchemaValidator:schemas})
    const entry:Connection={client,ready:Promise.resolve(client),controller:new AbortController()}
    entry.ready=(async()=>{
      const resolveEnv=(refs:Record<string,string>)=>Object.fromEntries(Object.entries(refs).map(([key,env])=>{const value=process.env[env];if(!value)throw Error('Missing tool credential environment variable '+env);return [key,value]}))
      const t=c.transport
      if(t.kind==='plugin')throw Error('Native plugin tools do not use an MCP transport')
      const transport=t.kind==='stdio'?new StdioClientTransport({command:t.command,args:t.args,cwd:t.cwd,env:{...getDefaultEnvironment(),...resolveEnv(t.env)},stderr:'ignore',maxBufferSize:8_000_000}):new StreamableHTTPClientTransport(new URL(t.url),{requestInit:{headers:resolveEnv(t.headerEnv),redirect:'error'}})
      client.onclose=()=>{if(this.clients.get(id)===entry)this.clients.delete(id)}
      try{await client.connect(transport,{timeout:c.timeoutMs,signal:entry.controller.signal});if(this.closing)throw Error('Host is stopping');return client}
      catch(error){await client.close().catch(()=>{});throw error}
    })()
    this.clients.set(id,entry)
    void entry.ready.catch(()=>{if(this.clients.get(id)===entry)this.clients.delete(id)})
    return entry.ready
  }
  private async tools(owner:WorkOwner,id:string,signal?:AbortSignal):Promise<Tool[]>{
    const config=this.allowed(owner,id)
    if(config.transport.kind==='plugin'){
      const source=this.host.sources.get(config.transport.sourceId)
      if(!(source instanceof ProcessSource)||!this.host.config.sources.find(s=>s.id===source.config.id)?.enabled)throw Error('Plugin connection is unavailable')
      return source.pkg.manifest.tools.filter(t=>config.allowedTools.includes(t.name)).map(t=>({name:t.name,description:t.description,inputSchema:t.inputSchema as Tool['inputSchema']}))
    }
    const client=await abortable(this.connect(id),signal),result:Tool[]=[],seen=new Set<string>();let cursor:string|undefined
    do{
      signal?.throwIfAborted();this.allowed(owner,id)
      const page=await client.listTools(cursor?{cursor}:{},{timeout:config.timeoutMs,signal})
      result.push(...page.tools);cursor=page.nextCursor
      if(result.length>5000||seen.size>=100||cursor&&seen.has(cursor))throw Error('Tool catalog pagination did not finish')
      if(cursor)seen.add(cursor)
    }while(cursor)
    return result.filter(t=>config.allowedTools.includes(t.name))
  }
  async catalog(owner:WorkOwner){
    const ids:string[]=this.host.store.get<any>('run',owner.ticketId)?.agentOptions?.toolConnections??[]
    const result=[]
    const signal=AbortSignal.any([this.shutdown.signal,AbortSignal.timeout(60000)])
    for(const id of ids){this.allowed(owner,id);result.push({connection:id,tools:await this.tools(owner,id,signal)})}
    return result
  }
  call(owner:WorkOwner,input:{connection:string;tool:string;arguments:Record<string,unknown>;requestId:string}):Promise<ToolResult>{
    const config=this.allowed(owner,input.connection)
    if(!config.allowedTools.includes(input.tool))throw Error('Tool is not allowed on this connection')
    if(config.transport.kind==='plugin')this.pluginAuthorization(owner,input)
    if(JSON.stringify(input.arguments).length>100000)throw Error('Tool arguments exceed 100 KB')
    const id=bodyDigest([owner.ticketId,owner.agentId??'',input.requestId]),fingerprint=stableDigest([input.connection,config,input.tool,input.arguments])
    const inflight=this.calls.get(id)
    if(inflight){if(inflight.fingerprint!==fingerprint)throw Error('Tool requestId was reused with different content');return inflight.promise}
    const receipt=this.host.store.get<Receipt>('tool-receipt',id)
    if(receipt){
      if(receipt.fingerprint!==fingerprint)throw Error('Tool requestId was reused with different content or connection configuration')
      if(this.host.store.get<TaskContinuation>('task-continuation',owner.ticketId)?.priorToolCalls.includes(id))return Promise.resolve({success:false,contentItems:[{type:'inputText',text:JSON.stringify({id:receipt.id,state:receipt.state,body:'quarantined',replayed:false})}]})
      return Promise.resolve(this.result(receipt))
    }
    const controller=new AbortController(),signal=AbortSignal.any([controller.signal,AbortSignal.timeout(config.timeoutMs)]),promise=this.execute(owner,input,id,fingerprint,signal).finally(()=>this.calls.delete(id))
    this.calls.set(id,{fingerprint,promise,controller,owner})
    return promise
  }
  private async execute(owner:WorkOwner,input:{connection:string;tool:string;arguments:Record<string,unknown>;requestId:string},id:string,fingerprint:string,signal:AbortSignal):Promise<ToolResult>{
    const config=this.allowed(owner,input.connection),tools=await this.tools(owner,input.connection,signal),tool=tools.find(t=>t.name===input.tool)
    if(!tool)throw Error('Tool is not advertised by the configured MCP server')
    if(tool.execution?.taskSupport==='required')throw Error('This tool requires MCP task execution, which is not supported by this adapter')
    const validation=schemas.getValidator(tool.inputSchema)(input.arguments)
    if(!validation.valid)throw Error('Invalid tool arguments: '+validation.errorMessage)
    const client=config.transport.kind==='plugin'?undefined:await this.connect(input.connection)
    signal.throwIfAborted();this.allowed(owner,input.connection)
    const receipt:Receipt={id,ticketId:owner.ticketId,agentId:owner.agentId,connection:input.connection,tool:input.tool,fingerprint,state:'running'}
    this.host.store.put('tool-receipt',id,receipt)
    try{
      const result=client?await client.callTool({name:input.tool,arguments:input.arguments},undefined,{signal,timeout:config.timeoutMs}):await abortable(this.pluginRead(owner,input),signal)
      if(JSON.stringify(result).length>8_000_000)throw Error('Tool result exceeds the durable receipt limit')
      receipt.state='complete';receipt.result=result
    }catch{
      if(config.transport.kind==='plugin'){receipt.state='complete';receipt.result={isError:true,content:[{type:'text',text:'Plugin resource read failed; this requestId retains the failure.'}]}}
      else {receipt.state='uncertain';receipt.reason='No confirmed tool result. Inspect the destination; this requestId will not execute again.'}
      if(this.clients.get(input.connection)?.client===client)this.clients.delete(input.connection)
      await client?.close().catch(()=>{})
    }
    this.host.store.put('tool-receipt',id,receipt)
    try{this.allowed(owner,input.connection);if(config.transport.kind==='plugin')this.pluginAuthorization(owner,input)}catch{return {success:false,contentItems:[{type:'inputText',text:JSON.stringify({id:receipt.id,state:receipt.state,body:'withheld',reason:'Assignment capability ended'})}]}}
    return this.result(receipt)
  }
  private pluginAuthorization(owner:WorkOwner,input:{connection:string;tool:string;arguments:Record<string,unknown>}){
    const config=this.allowed(owner,input.connection)
    if(config.transport.kind!=='plugin')throw Error('Not a plugin connection')
    const source=this.host.sources.get(config.transport.sourceId)
    if(!(source instanceof ProcessSource))throw Error('Plugin is unavailable')
    const tool=source.pkg.manifest.tools.find(t=>t.name===input.tool),triggerId=input.arguments.triggerId
    if(!tool||typeof triggerId!=='string'||this.host.store.triggers.get(triggerId)?.source!==source.config.id)throw Error('A trigger from this plugin connection is required')
    const cursor=input.arguments.cursor
    if(cursor!==undefined&&typeof cursor!=='string')throw Error('Invalid cursor')
    // Use the same reached-trigger, source, task context and history checks as resource_read.
    const resource=tool.resource+(cursor?'/'+encodeURIComponent(cursor):'')
    this.host.resources.authorizeSourceRead({ticketId:owner.ticketId,agentId:owner.agentId},triggerId,resource)
    return 'trigger-source/'+triggerId+'/'+resource
  }
  private async pluginRead(owner:WorkOwner,input:{connection:string;tool:string;arguments:Record<string,unknown>}){
    const resource=this.pluginAuthorization(owner,input)
    const result=await this.host.resources.read({resource},{ticketId:owner.ticketId,agentId:owner.agentId})
    return {content:[{type:'text',text:JSON.stringify(result)}]}
  }
  private result(receipt:Receipt):ToolResult{
    if(receipt.state!=='complete')return {success:false,contentItems:[{type:'inputText',text:JSON.stringify({status:'uncertain',receipt:receipt.id,reason:receipt.reason})}]}
    const result=receipt.result,items:ToolContent[]=[]
    for(const block of result.content??[]){
      if(block.type==='text')items.push({type:'inputText',text:block.text})
      else if(block.type==='image')items.push({type:'inputImage',imageUrl:'data:'+block.mimeType+';base64,'+block.data})
      else items.push({type:'inputText',text:JSON.stringify(block)})
    }
    if(result.structuredContent)items.push({type:'inputText',text:JSON.stringify({structuredContent:result.structuredContent})})
    if(!items.length)items.push({type:'inputText',text:JSON.stringify(result)})
    return {success:!result.isError,contentItems:items}
  }
  cancel(ticketId:string){for(const call of this.calls.values())if(call.owner.ticketId===ticketId)call.controller.abort()}
  async close(){
    this.closing=true
    this.shutdown.abort()
    for(const call of this.calls.values())call.controller.abort()
    await Promise.allSettled([...this.clients.values()].map(async c=>{c.controller.abort();await c.client.close();await c.ready.catch(()=>{})}))
    await Promise.allSettled([...this.calls.values()].map(c=>c.promise))
    this.clients.clear()
  }
}
