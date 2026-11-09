import {randomUUID,createHash} from 'node:crypto'
import {resolve} from 'node:path'
import {Ajv} from 'ajv'
import type {ApiDefinition} from '../backend-config.ts'
import type {BackendDescription,Model,ModelRequest,ModelResult,ToolContent} from '../model.ts'
import {TransientModelError} from '../model.ts'
import {checkBudget,protocolBytes,receiptReference,ContextBudgetExceeded} from '../context-budget.ts'
import {protocolTombstone} from '../history-cleanup.ts'
import {readResponsesStream,readChatStream,readAnthropicStream} from './stream.ts'
import {contextProjection,recall,recallSpec} from './context.ts'
export {readResponsesStream} from './stream.ts'

export interface ThreadStore {get<T>(kind:string,id:string):T|undefined;put(kind:string,id:string,value:unknown):void}
type Call={id:string;name:string;arguments:string}
type ToolResult={contentItems:ToolContent[];success:boolean}
type Effect={call:Call;digest:string;state:'started'|'completed';result?:ToolResult}
interface ApiThread {
 format:1;id:string;backendId:string;kind:string;endpoint:string;model:string;cwd:string;messages:any[];turns:any[];effects:Record<string,Effect>;pending?:Call[]
}
const ajv=new Ajv({strict:false,allErrors:true})
const hash=(s:string)=>createHash('sha256').update(s).digest('hex')
const failure=(text:string):ToolResult=>({success:false,contentItems:[{type:'inputText',text}]})
const image=(s:string)=>{const m=/^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/.exec(s);if(!m)throw Error('Tool image must be bounded base64 image data');return {mime:m[1]!,data:m[2]!}}
const errorText=(result:ToolResult)=>result.contentItems.filter(c=>c.type==='inputText').map(c=>c.text??'').join('\n')
/** Provider-neutral agent loop. Providers propose calls; only the host executes scoped tools. */
export class ApiModel implements Model {
 private active=new Set<string>()
 constructor(readonly id:string,readonly definition:ApiDefinition,private store:ThreadStore,private turnTimeoutMs:number,private credential?:()=>string|undefined|Promise<string|undefined>){}
 describe():BackendDescription{return {id:this.id,kind:this.definition.kind,model:this.definition.model,nativeTakeover:false,images:this.definition.images,resume:true,tools:true,steering:true,promptRefresh:true}}
 private endpoint(path:string){return this.definition.baseUrl.replace(/\/+$/,'')+'/'+path}
 private async http(path:string,signal:AbortSignal,body?:unknown,onOutput?:ModelRequest['onOutput']):Promise<any>{
  const d=this.definition,credential=this.credential?await this.credential():d.apiKeyEnv?process.env[d.apiKeyEnv]:undefined
  if(d.apiKeyEnv&&!credential?.trim())throw Error('Backend '+this.id+' requires environment variable '+d.apiKeyEnv)
  const headers:Record<string,string>={...d.headers,...Object.fromEntries(Object.entries(d.headerEnv??{}).map(([key,env])=>{const value=process.env[env];if(!value)throw Error('Missing header environment variable '+env);return [key,value]})),'content-type':'application/json'}
  if(d.kind==='anthropic'){headers['anthropic-version']='2023-06-01';if(credential)headers['x-api-key']=credential}
  else if(credential)headers.authorization='Bearer '+credential
  let response:Response
  try{response=await fetch(this.endpoint(path),{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined,signal:AbortSignal.any([signal,AbortSignal.timeout(d.requestTimeoutMs)]),redirect:'error'})}
  catch{signal.throwIfAborted();throw new TransientModelError('Backend '+this.id+' network request failed or timed out')}
  if(!response.ok){await response.body?.cancel();throw Error('Backend '+this.id+' HTTP '+response.status)}
  const reader=response.body?.getReader();if(!reader)throw Error('Backend response is empty')
  if(response.headers.get('content-type')?.includes('text/event-stream'))return (d.kind==='anthropic'?readAnthropicStream:d.kind==='openai-chat'?readChatStream:readResponsesStream)(reader,d.maxContextBytes,signal,onOutput)
  if(d.subscription&&body)throw Error('Subscription response must be an event stream')
  const chunks:Uint8Array[]=[];let bytes=0
  for(;;){
   let value:ReadableStreamReadResult<Uint8Array>
   try{value=await reader.read()}catch{signal.throwIfAborted();throw new TransientModelError('Backend '+this.id+' response connection interrupted')}
   if(value.done)break;bytes+=value.value.length;if(bytes>d.maxContextBytes){await reader.cancel();throw Error('Backend response size limit exceeded')}chunks.push(value.value)
  }
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{throw Error('Backend returned invalid JSON')}
 }
 async catalog(provider?:string){
  if(provider&&provider!==this.id&&provider!==this.definition.kind)throw Error('Unknown backend model catalog: '+provider)
  if(this.definition.subscription)return this.http('models',AbortSignal.timeout(20000))
  return {provider:this.id,kind:this.definition.kind,data:[{id:this.definition.model}],configuredOnly:true,capabilities:this.describe()}
 }
 async history(threadId:string,cwd:string){const t=this.thread(threadId,cwd);return {id:t.id,backendId:this.id,model:t.model,turns:t.turns}}
 async purge(threadId:string,cwd:string){
  if(this.active.has(threadId))throw Error('Thread writer must stop before deletion')
  const t=this.store.get<any>('backend-thread',threadId)
  if(t&&!t.deleted)this.thread(threadId,cwd)
  this.store.put('backend-thread',threadId,protocolTombstone(threadId,t))
  if(!this.store.get<any>('backend-thread',threadId)?.deleted)throw Error('Protocol deletion readback failed')
  return {local:'verified' as const,provider:'not_managed' as const}
 }
 private thread(id:string,cwd:string){const t=this.store.get<ApiThread>('backend-thread',id);if(!t||t.format!==1||t.backendId!==this.id||t.kind!==this.definition.kind||t.endpoint!==this.definition.baseUrl.replace(/\/+$/,'')||t.cwd!==resolve(cwd))throw Error('Backend thread format, identity, endpoint or directory changed; explicit migration is required');return t}
 private appendResults(t:ApiThread,calls:Call[],results:ToolResult[]){
  const kind=this.definition.kind
  if(kind==='anthropic')t.messages.push({role:'user',content:calls.map((c,i)=>({type:'tool_result',tool_use_id:c.id,is_error:!results[i]!.success,content:results[i]!.contentItems.map(x=>x.type==='inputText'?{type:'text',text:x.text??''}:{type:'image',source:{type:'base64',media_type:image(x.imageUrl!).mime,data:image(x.imageUrl!).data}})}))})
  else {const imageParts:any[]=[];for(const [i,call] of calls.entries()){
   const result=results[i]!,text=(result.success?'':'Tool error: ')+errorText(result)
   if(kind==='openai-responses')t.messages.push({type:'function_call_output',call_id:call.id,output:result.contentItems.map(x=>x.type==='inputText'?{type:'input_text',text:(result.success?'':'Tool error: ')+(x.text??'')}:{type:'input_image',image_url:x.imageUrl,detail:'auto'})})
   else{
    t.messages.push({role:'tool',tool_call_id:call.id,content:text||(!result.success?'Tool failed':'Tool returned image data in the following message.')})
    const images=result.contentItems.filter(x=>x.type==='inputImage');if(images.length)imageParts.push({type:'text',text:'Image output from tool call '+call.id},...images.map(x=>({type:'image_url',image_url:{url:x.imageUrl}})))
   }
  }if(imageParts.length)t.messages.push({role:'user',content:imageParts})}
 }
 private body(t:ApiThread,instructions:string,r:ModelRequest){
  const d=this.definition,tools=r.tools??[]
  const context=tools.some(t=>t.name===recallSpec.name)?contextProjection(t,Math.min(128000,Math.floor(d.maxContextBytes/2))):{messages:t.messages,notice:''}
  t={...t,messages:context.messages}
  const finalInstructions=instructions+(context.notice?'\n'+context.notice:'')+'\nReturn the final answer as exactly one JSON object matching this schema, without Markdown fences. Use tools before reporting completion when the task requires evidence.\n'+JSON.stringify(r.schema)
  if(d.kind==='anthropic')return {...d.parameters,...(r.onOutput?{stream:true}:{}),model:t.model,max_tokens:d.maxOutputTokens,system:finalInstructions,messages:t.messages,...(d.outputFormat==='json-schema'?{output_config:{...(d.parameters.output_config as object??{}),format:{type:'json_schema',schema:r.schema}}}:{}),...(tools.length?{tools:tools.map(s=>({name:s.name,description:s.description,input_schema:s.inputSchema}))}:{})}
  if(d.kind==='openai-responses')return {...d.parameters,model:t.model,max_output_tokens:d.maxOutputTokens,instructions:finalInstructions,input:t.messages,store:false,...(d.subscription||r.onOutput?{stream:true}:{}),include:['reasoning.encrypted_content'],...(tools.length?{tools:tools.map(s=>({type:'function',name:s.name,description:s.description,parameters:s.inputSchema,strict:false}))}:{}),...(d.outputFormat==='prompt'?{}:{text:{...(d.parameters.text as object??{}),format:d.outputFormat==='json-object'?{type:'json_object'}:{type:'json_schema',name:'agent_result',strict:true,schema:r.schema}}})}
  return {[d.chatTokenField]:d.maxOutputTokens,...d.parameters,...(r.onOutput?{stream:true}:{}),model:t.model,messages:[{role:'system',content:finalInstructions},...t.messages],...(tools.length?{tools:tools.map(s=>({type:'function',function:{name:s.name,description:s.description,parameters:s.inputSchema,strict:false}}))}:{}),...(d.outputFormat==='prompt'?{}:{response_format:d.outputFormat==='json-object'?{type:'json_object'}:{type:'json_schema',json_schema:{name:'agent_result',strict:true,schema:r.schema}}})}
 }
 private accept(response:any,t:ApiThread):{calls:Call[];text:string;wire:any[]}{
  const kind=this.definition.kind
  if(kind==='openai-chat'){
   const choice=response.choices?.[0],m=choice?.message
   if(!m||choice.finish_reason&& !['stop','tool_calls'].includes(choice.finish_reason)||m.refusal)throw Error('Backend did not complete a usable response')
   const calls=(m.tool_calls??[]).map((c:any)=>{if(c.type!=='function')throw Error('Unsupported provider tool type');return {id:c.id,name:c.function?.name,arguments:c.function?.arguments}})
   const text=typeof m.content==='string'?m.content:typeof m.content==='object'&&Array.isArray(m.content)?m.content.filter((x:any)=>x.type==='text').map((x:any)=>x.text).join(''):''
   return {calls,text,wire:[{role:'assistant',content:m.content??null,...(m.reasoning_content!==undefined?{reasoning_content:m.reasoning_content}:{}),...(calls.length?{tool_calls:m.tool_calls}:{})}]}
  }
  if(kind==='anthropic'){
   if(!['tool_use','end_turn'].includes(response.stop_reason)||!Array.isArray(response.content))throw Error('Backend did not complete a usable response')
   const calls=response.content.filter((x:any)=>x.type==='tool_use').map((c:any)=>({id:c.id,name:c.name,arguments:JSON.stringify(c.input)}))
   return {calls,text:response.content.filter((x:any)=>x.type==='text').map((x:any)=>x.text).join(''),wire:[{role:'assistant',content:response.content}]}
  }
  if(response.status!=='completed'||!Array.isArray(response.output))throw Error('Backend response is incomplete or failed')
  const calls:Call[]=[],wire:any[]=[],texts:string[]=[]
  for(const item of response.output){
   if(item.type==='function_call'){calls.push({id:item.call_id,name:item.name,arguments:item.arguments});wire.push({type:'function_call',call_id:item.call_id,name:item.name,arguments:item.arguments})}
   else if(item.type==='message'){
    if(item.content?.some((c:any)=>c.type==='refusal'))throw Error('Backend refused the request')
    const content=(item.content??[]).filter((x:any)=>x.type==='output_text').map((x:any)=>({type:'output_text',text:x.text,annotations:[]}));texts.push(...content.map((x:any)=>x.text));wire.push({type:'message',role:'assistant',content})
   }else if(item.type==='reasoning')wire.push({...item})
   else throw Error('Unsupported provider output item')
  }
  return {calls,text:texts.join(''),wire}
 }
 async run(r:ModelRequest):Promise<ModelResult>{
  if(r.workerMcp)throw Error('API backends require explicit host tool definitions, not a native MCP bridge')
  if(r.ephemeral&&r.threadId)throw Error('Ephemeral backend calls cannot resume retained threads')
  const canRecall=!r.ephemeral&&r.role==='router'&&r.managed&&(!r.options?.tools||r.options.tools.includes(recallSpec.name))
  if(canRecall){if(r.tools?.some(t=>t.name===recallSpec.name))throw Error('backend_recall is reserved for retained API history');r={...r,tools:[...r.tools??[],recallSpec]}}
  const t:ApiThread=r.threadId?this.thread(r.threadId,r.cwd):{format:1,id:'api:'+this.id+':'+randomUUID(),backendId:this.id,kind:this.definition.kind,endpoint:this.definition.baseUrl.replace(/\/+$/,''),model:r.model??this.definition.model,cwd:resolve(r.cwd),messages:[],turns:[],effects:{}}
  if(this.active.has(t.id))throw Error('Backend thread already has an active writer')
  this.active.add(t.id)
  const controller=new AbortController(),signal=r.signal?AbortSignal.any([controller.signal,r.signal]):controller.signal
  const timer=setTimeout(()=>controller.abort(Error('Backend turn deadline exceeded')),this.turnTimeoutMs)
  const turn={id:randomUUID(),status:'inProgress',items:[] as any[],model:t.model,input:r.input,wireStart:0},queue:{text:string;onRead?:()=>void}[]=[]
  let instructions=r.instructions,repairs=0,toolCalls=0
  const persist=()=>{if(!r.ephemeral)this.store.put('backend-thread',t.id,t)}
  const appendUser=(text:string)=>t.messages.push({role:'user',content:text})
  try{
   signal.throwIfAborted()
   // A process may have died after a side effect and before its receipt. Never replay it.
   if(t.pending?.length){const results=t.pending.map(call=>{const effect=t.effects[call.id]!;return effect?.state==='completed'?effect.result!:failure('Previous tool execution was interrupted and may have taken effect. Inspect retained jobs and external state before any explicit retry; it was not replayed.')});this.appendResults(t,t.pending,results);delete t.pending}
   for(const old of t.turns)if(old.status==='inProgress')old.status='interrupted'
   turn.wireStart=t.messages.length;t.turns.push(turn);appendUser(r.input);persist()
   r.onThread?.(t.id);r.onTurn?.(turn.id);r.onModel?.(t.model)
   r.onCapabilities?.({mcpServers:[],disabledPlugins:[],managed:true,backend:this.describe()})
   r.onActive?.({interrupt:async()=>{controller.abort(Error('Backend turn interrupted'))},steer:async(text,onRead)=>{signal.throwIfAborted();queue.push({text,onRead})},refresh:async text=>{signal.throwIfAborted();instructions=text}})
   const validators=new Map((r.tools??[]).map(s=>[s.name,ajv.compile(s.inputSchema)])),validateOutput=ajv.compile(r.schema)
   for(let step=0;step<this.definition.maxSteps;step++){
    signal.throwIfAborted()
    const incoming=queue.splice(0)
    for(const item of incoming)appendUser((item.onRead?'Source input within the existing mandate: ':'Operator steering within the existing mandate: ')+item.text)
    const body=this.body(t,instructions,r);if(Buffer.byteLength(JSON.stringify(body))>this.definition.maxContextBytes)throw Error('Backend context size limit exceeded; explicit compaction or a new task is required')
    checkBudget(body,r.contextBudget,'api-wire','request',r.onBudget)
    persist();for(const item of incoming)item.onRead?.()
    r.onConfiguration?.({requested:r.options??{},sent:{model:t.model,parameters:this.definition.parameters,maxOutputTokens:this.definition.maxOutputTokens,maxSteps:this.definition.maxSteps,maxToolCalls:this.definition.maxToolCalls,stream:!!(this.definition.subscription||r.onOutput)}})
    r.onProgress?.('backend/request')
    r.onOutput?.({id:turn.id+':'+step,type:'start',phase:'answer'})
    const response=await this.http(this.definition.kind==='openai-chat'?'chat/completions':this.definition.kind==='anthropic'?'messages':'responses',signal,body,r.onOutput)
    signal.throwIfAborted();if(typeof response.model==='string'){(turn as any).providerModel=response.model;r.onModel?.(response.model)}const accepted=this.accept(response,t),seen=new Set<string>()
    if((toolCalls+=accepted.calls.length)>this.definition.maxToolCalls)throw Error('Backend tool call budget exceeded')
    for(const call of accepted.calls){if(typeof call.id!=='string'||!call.id||typeof call.name!=='string'||typeof call.arguments!=='string'||call.arguments.length>1000000||seen.has(call.id)||t.effects[call.id])throw Error('Backend returned an invalid or repeated tool call ID');seen.add(call.id)}
    t.messages.push(...accepted.wire)
    turn.items.push(...accepted.calls.map(c=>({type:'functionCall',callId:c.id,name:c.name,arguments:c.arguments})),...(accepted.text?[{type:'agentMessage',text:accepted.text}]:[]))
    if(accepted.calls.length){
     t.pending=accepted.calls;persist();const results:ToolResult[]=[]
     // A provider can return many calls in one response. Reserve the entire pair set
     // before executing any effect; a refusal receipt still closes every call.
     let budgetError:ContextBudgetExceeded|undefined
     try{checkBudget({request:this.body(t,instructions,r),pendingResults:accepted.calls.map(c=>({callId:c.id,result:'reserved'}))},r.contextBudget,'api-wire','before_tools',r.onBudget,true)}catch(error){if(!(error instanceof ContextBudgetExceeded))throw error;budgetError=error}
     for(const call of accepted.calls){
      if(!budgetError)try{checkBudget({request:this.body(t,instructions,r),completedResults:results},r.contextBudget,'api-wire','before_tool',r.onBudget,true)}catch(error){if(!(error instanceof ContextBudgetExceeded))throw error;budgetError=error}
      signal.throwIfAborted();const effect:Effect={call,digest:hash(call.name+'\n'+call.arguments),state:'started'};t.effects[call.id]=effect;persist()
      let result:ToolResult
      try{const args=JSON.parse(call.arguments),validate=validators.get(call.name);if(budgetError)result=failure('Context budget exceeded before execution; tool was not executed');else if(!validate||!r.onTool&&!(canRecall&&call.name===recallSpec.name))result=failure('Tool is not in this activation capability set');else if(!validate(args))result=failure('Invalid tool arguments: '+ajv.errorsText(validate.errors));else{r.onProgress?.('backend/tool/'+call.name);result=canRecall&&call.name===recallSpec.name?recall(t,args as Parameters<typeof recall>[1]):await r.onTool!(call.name,args,call.id)}}
      catch{result=failure('Host tool failed. Inspect task state and permissions before retrying; side effects may be uncertain.')}
      if(result.contentItems.some(c=>c.type==='inputImage')&&!this.definition.images)result=failure('This backend is configured without image support. Image bytes were not sent to the model.')
      for(const item of result.contentItems)if(item.type==='inputImage')image(item.imageUrl!)
      effect.state='completed';effect.result=result;persist();turn.items.push({type:'functionCallOutput',callId:call.id,success:result.success,contentItems:result.contentItems})
      const reference=r.contextBudget&&protocolBytes(result)>r.contextBudget.toolReserveBytes&&r.retainToolResult?receiptReference(result,await r.retainToolResult(call.id,result)):undefined
      results.push(reference??result)
     }
     this.appendResults(t,accepted.calls,results);delete t.pending;persist();if(budgetError)throw budgetError;continue
    }
    persist();checkBudget(this.body(t,instructions,r),r.contextBudget,'api-wire','complete',r.onBudget);if(queue.length)continue
    let value:any;try{value=JSON.parse(accepted.text)}catch{}
    if(value===undefined||!validateOutput(value)){
     if(++repairs>2)throw Error('Backend final output failed the required JSON schema')
     appendUser('Your final output must be a single valid JSON object matching the supplied schema. Correct its structure; do not repeat completed tools.');persist();continue
    }
    turn.status='completed';persist();return {threadId:t.id,turnId:turn.id,text:JSON.stringify(value)}
   }
   throw Error('Backend agent step limit exceeded')
  }catch(error){turn.status=signal.aborted?'interrupted':'failed';turn.items.push({type:'error',text:signal.aborted?'Backend turn interrupted':String(error)});persist();throw error}
  finally{clearTimeout(timer);this.active.delete(t.id)}
 }
}
