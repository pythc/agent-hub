import {afterEach,expect,it,vi} from 'vitest'
import {OperationError,operationErrorCode} from '../src/operation-errors.ts'
import {backendErrorCodes} from '../src/backends/plugin-contract.ts'
import {readResponsesStream,readChatStream,readAnthropicStream} from '../src/backends/stream.ts'
import {ApiModel,type ThreadStore} from '../src/backends/api.ts'
import {backendDefinition,type ApiDefinition} from '../src/backend-config.ts'
import {TransientModelError} from '../src/model.ts'
import {classifyGoalFailure} from '../src/goal-contract.ts'
import {ToolConnections} from '../src/tool-connections.ts'
import type {Runtime} from '../src/runtime.ts'
import type {WorkOwner} from '../src/work.ts'

const sentinel='SYNTHETIC_ERROR_SENTINEL_NOT_A_REAL_SECRET'
const raw={code:sentinel,type:sentinel,message:sentinel,stack:sentinel,cause:{body:sentinel},stderr:sentinel}
const frame=(v:unknown)=>'data: '+JSON.stringify(v)+'\n\n'
const stream=(v:unknown)=>new Response(frame(v),{headers:{'content-type':'text/event-stream'}})
const parsers=[readResponsesStream,readChatStream,readAnthropicStream]
const kinds=['openai-responses','openai-chat','anthropic'] as const
const closers:ToolConnections[]=[]
afterEach(async()=>{for(const t of closers.splice(0))await t.close();vi.unstubAllGlobals()})
function safe(error:unknown){
 expect(error).toBeInstanceOf(OperationError)
 expect(String(error)).not.toContain(sentinel);expect(JSON.stringify(error)).not.toContain(sentinel)
 expect((error as Error).stack).not.toContain(sentinel);expect((error as Error).cause).toBeUndefined()
}
async function rejected(promise:Promise<unknown>){try{await promise}catch(error){return error}throw Error('Expected failure')}

it('only admits exact existing codes without stringifying arbitrary values or copying exceptions',()=>{
 for(const code of backendErrorCodes){const error=new OperationError('backend_stream',code);expect(error.code).toBe(code);expect(error).not.toBeInstanceOf(TransientModelError)}
 let accessed=0
 const hostile={toString(){accessed++;throw Error(sentinel)},get code(){accessed++;throw Error(sentinel)}}
 for(const code of [hostile,raw,429,null,undefined,'RATE_LIMITED','rate_limited '+sentinel,'transient\n'+sentinel]){
  const error=new OperationError('backend_stream',code);safe(error);expect(error.code).toBe('operation_failed');expect(error.message).toBe('Backend stream failed: provider_error')
 }
 expect(accessed).toBe(0);expect(operationErrorCode('quota_exhausted')).toBe('quota_exhausted')
})
it('keeps quota, rate, cancellation and unknown outcome distinctions without adding runtime retries',()=>{
 for(const code of ['rate_limited','quota_exhausted'] as const)expect(classifyGoalFailure(String(new OperationError('backend_stream',code)),0,0).kind).toBe('quota')
 for(const code of ['outcome_unknown','process_failed','cancelled'] as const)expect(classifyGoalFailure(String(new OperationError('backend_stream',code)),0,0).kind).toBe('uncertain')
 const retryPattern=/HTTP (408|429|5\d\d)|ECONNRESET|ECONNREFUSED|ETIMEDOUT|connection reset|stream disconnected|temporar(?:y|ily)|error sending request/i
 for(const code of backendErrorCodes)expect(retryPattern.test(String(new OperationError('backend_stream',code)))).toBe(false)
})
it.each(parsers)('projects untrusted SSE error code/type/body into fixed diagnostics (%#)',async parse=>{
 for(const error of [raw,{...raw,code:undefined},{...raw,code:{private:sentinel}},sentinel]){
  const result=await rejected(parse(stream({type:'error',error}).body!.getReader(),10000,new AbortController().signal));safe(result);expect((result as OperationError).code).toBe('operation_failed')
 }
 const result=await rejected(parse(stream({type:'error',error:{...raw,code:'quota_exhausted'}}).body!.getReader(),10000,new AbortController().signal));safe(result);expect((result as OperationError).code).toBe('quota_exhausted')
})
it.each(kinds)('%s retains only a safe error in the actual ApiModel thread, with no retry or real network',async kind=>{
 let fetches=0,threadId='';const values=new Map<string,unknown>()
 const store:ThreadStore={get:<T>(k:string,id:string)=>structuredClone(values.get(k+':'+id)) as T|undefined,put:(k,id,value)=>{values.set(k+':'+id,structuredClone(value))}}
 vi.stubGlobal('fetch',async()=>{fetches++;return stream({type:'error',error:raw})})
 const d=backendDefinition.parse({kind,baseUrl:'http://127.0.0.1:1/never-contacted',model:'fixture'}) as ApiDefinition
 const model=new ApiModel('fixture',d,store,5000)
 const error=await rejected(model.run({cwd:process.cwd(),instructions:'Local synthetic',input:'test',schema:{type:'object'},onOutput:()=>{},onThread:id=>{threadId=id}}))
 safe(error);expect(fetches).toBe(1);expect(JSON.stringify([...values])).not.toContain(sentinel)
 expect(await model.history(threadId,process.cwd())).toMatchObject({turns:[{status:'failed',items:[{type:'error',text:'OperationError: Backend stream failed: provider_error'}]}]})
})
it('keeps existing HTTP-body rejection fixed, and stream I/O transient and cancellation behavior unchanged',async()=>{
 vi.stubGlobal('fetch',async()=>new Response(sentinel,{status:500}))
 const d=backendDefinition.parse({kind:'openai-chat',baseUrl:'http://127.0.0.1:1/never-contacted',model:'fixture'}) as ApiDefinition
 const values=new Map<string,unknown>(),store:ThreadStore={get:<T>(k:string,id:string)=>values.get(k+':'+id) as T|undefined,put:(k,id,v)=>{values.set(k+':'+id,structuredClone(v))}}
 const error=await rejected(new ApiModel('fixture',d,store,5000).run({cwd:process.cwd(),instructions:'Synthetic',input:'test',schema:{},onOutput:()=>{}}))
 expect(String(error)).toContain('HTTP 500');expect(JSON.stringify([...values])).not.toContain(sentinel)
 for(const parse of parsers){
  const interrupted=new ReadableStream<Uint8Array>({start(c){c.error(Error(sentinel))}})
  const failure=await rejected(parse(interrupted.getReader(),1000,new AbortController().signal));expect(failure).toBeInstanceOf(TransientModelError);expect(String(failure)).not.toContain(sentinel)
  const controller=new AbortController(),pending=parse(new ReadableStream<Uint8Array>().getReader(),1000,controller.signal),cancel=Error('Cancelled by local test');controller.abort(cancel)
  expect(await rejected(pending)).toBe(cancel)
 }
})

function tools(transport:any={kind:'http',url:'http://127.0.0.1:1/never-contacted',headerEnv:{}}){
 const records=new Map<string,any>(),writes:any[]=[]
 const host={config:{toolConnections:{fixture:{enabled:true,transport,allowedTools:['echo'],timeoutMs:3000}}},validWork:()=>true,
  store:{list:()=>[],get:(kind:string,id:string)=>kind==='run'?{agentOptions:{toolConnections:['fixture']}}:records.get(kind+':'+id),put:(kind:string,id:string,value:any)=>{records.set(kind+':'+id,structuredClone(value));writes.push({kind,id,value:structuredClone(value)})}}} as unknown as Runtime
 const connection=new ToolConnections(host);closers.push(connection)
 const owner={ticketId:'ticket',assignmentId:'assignment',cwd:process.cwd(),sandbox:'read-only',depth:0} as WorkOwner
 return {connection,owner,writes,records}
}
const call={connection:'fixture',tool:'echo',arguments:{text:'synthetic'},requestId:'original-request'}
it.each(['catalog','call'] as const)('drops SDK initialization HTTP bodies before %s and starts no receipt',async action=>{
 let fetches=0;vi.stubGlobal('fetch',async()=>{fetches++;return new Response(sentinel,{status:500})})
 const t=tools(),error=await rejected(action==='catalog'?t.connection.catalog(t.owner):t.connection.call(t.owner,call))
 safe(error);expect((error as OperationError).code).toBe('transient');expect(t.writes).toEqual([]);expect(fetches).toBe(1)
})
it.each([401,403,429,408,500,400])('classifies actual SDK HTTP %i by bounded status, never its body, without retry',async status=>{
 let requests=0;vi.stubGlobal('fetch',async()=>{requests++;return new Response(sentinel,{status})})
 const t=tools(),error=await rejected(t.connection.catalog(t.owner)) as OperationError
 safe(error);expect(error.code).toBe(({401:'auth_required',403:'provider_rejected',429:'rate_limited',408:'transient',500:'transient'} as Record<number,string>)[status]??'operation_failed');expect(error).not.toBeInstanceOf(TransientModelError);expect(requests).toBe(1);expect(t.writes).toEqual([])
})
function mcpFetch(failure:'catalog'|'dispatch'){
 const methods:string[]=[]
 vi.stubGlobal('fetch',async(_url:unknown,init:RequestInit)=>{
  if(init.method==='GET')return new Response(null,{status:405})
  if(init.method==='DELETE')return new Response(null,{status:200})
  const request=JSON.parse(init.body as string);methods.push(request.method)
  if(request.method==='notifications/initialized')return new Response(null,{status:202})
  const result=request.method==='initialize'?{protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'synthetic',version:'1'}}:request.method==='tools/list'?{tools:[{name:'echo',inputSchema:{type:'object'}}]}:undefined
  if(request.method==='tools/list'&&failure==='catalog')return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,error:{code:-32603,message:sentinel,data:raw}}),{headers:{'content-type':'application/json'}})
  if(request.method==='tools/call')throw Error(sentinel)
  return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result}),{headers:{'content-type':'application/json'}})
 })
 return methods
}
it.each(['catalog','call'] as const)('drops SDK listTools JSON-RPC errors before %s, with zero effects/receipts',async action=>{
 const methods=mcpFetch('catalog'),t=tools(),error=await rejected(action==='catalog'?t.connection.catalog(t.owner):t.connection.call(t.owner,call))
 safe(error);expect((error as OperationError).operation).toBe('tool_catalog');expect(t.writes).toEqual([]);expect(methods).not.toContain('tools/call');expect(methods.filter(x=>x==='tools/list')).toHaveLength(1)
})
it('does not leak missing credential environment names or perform network initialization',async()=>{
 let fetches=0;vi.stubGlobal('fetch',async()=>{fetches++;throw Error('Unexpected synthetic fetch')})
 const t=tools({kind:'http',url:'http://127.0.0.1:1/never-contacted',headerEnv:{Authorization:sentinel}}),error=await rejected(t.connection.catalog(t.owner))
 safe(error);expect((error as OperationError).code).toBe('configuration_invalid');expect(fetches).toBe(0);expect(t.writes).toEqual([])
})
it('does not trust a remote AbortError name or retain its error/cause without a real aborted signal',async()=>{
 vi.stubGlobal('fetch',async()=>{throw Object.assign(Error(sentinel,{cause:raw}),{name:'AbortError'})})
 const t=tools(),error=await rejected(t.connection.call(t.owner,call));safe(error)
 expect((error as OperationError).code).toBe('operation_failed');expect(t.writes).toEqual([])
})
it('normalizes a real pre-dispatch cancellation before SDK auth errors and never carries the abort reason',async()=>{
 let start!:()=>void;const started=new Promise<void>(r=>{start=r})
 vi.stubGlobal('fetch',async(_url:unknown,init:RequestInit)=>new Promise((_resolve,reject)=>{start();init.signal?.addEventListener('abort',()=>reject(Error(sentinel)),{once:true})}))
 const t=tools(),pending=t.connection.call(t.owner,call);await started;t.connection.cancel(t.owner.ticketId)
 const error=await rejected(pending);safe(error);expect((error as OperationError).code).toBe('cancelled');expect(t.writes).toEqual([])
})
it('keeps dispatched disconnect uncertain and deduplicates the original request instead of replaying',async()=>{
 const methods=mcpFetch('dispatch'),t=tools(),first=await t.connection.call(t.owner,call)
 expect(first.success).toBe(false);expect(first.contentItems[0]?.text).toContain('uncertain');expect(JSON.stringify(first)).not.toContain(sentinel)
 expect(t.writes.map(x=>x.value.state)).toEqual(['running','uncertain'])
 expect(await t.connection.call(t.owner,call)).toEqual(first);expect(methods.filter(x=>x==='tools/call')).toHaveLength(1)
 expect(JSON.stringify([...t.records])).not.toContain(sentinel)
})
