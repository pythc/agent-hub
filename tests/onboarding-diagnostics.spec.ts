import {afterEach,it,expect,vi} from 'vitest'
import {mkdtempSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {Onboarding} from '../src/onboarding.ts'
import {configSchema} from '../src/config.ts'
const roots:string[]=[]
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true})})
async function check(protocol='openai-chat'){
 const root=mkdtempSync(join(tmpdir(),'diagnostic-test-'));roots.push(root)
 const config=configSchema.parse({stateDir:join(root,'state'),sources:[{id:'local',kind:'local',cwd:join(root,'workspace'),allowedActors:['operator']}]})
 const onboarding=new Onboarding(()=>({config,settings:{current:()=>({revision:0})}} as any))
 const plan=onboarding.plan({revision:0,connection:{kind:'api',protocol,baseUrl:'http://127.0.0.1:1/v1',model:'synthetic-model',apiKey:'synthetic-never-transmitted-secret'}})
 return onboarding.check(plan.id)
}
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}})
it.each([[400,'api_request_invalid'],[401,'api_key_rejected'],[403,'model_access_denied'],[404,'model_not_found'],[422,'api_request_invalid'],[429,'api_rate_limited'],[500,'provider_unavailable'],[418,'api_request_invalid']])('classifies HTTP %s without exposing upstream data',async(status,code)=>{
 const fetch=vi.fn(async()=>json({error:{message:'synthetic-never-transmitted-secret https://secret.example/?token=private',code:'invalid_request'}},status as number));vi.stubGlobal('fetch',fetch)
 const result=await check();expect(result.checks).toEqual([{id:'connection',status:'required',code,detail:'HTTP '+status+' · invalid_request'}]);expect(fetch).toHaveBeenCalledTimes(1);expect(JSON.stringify(result)).not.toMatch(/secret|private|https:|headers/)
})
it.each(['openai-chat','openai-responses'])('distinguishes quota and truncation for %s',async protocol=>{
 const fetch=vi.fn(async()=>json({error:{code:'insufficient_quota',message:'secret'}},429));vi.stubGlobal('fetch',fetch)
 expect((await check(protocol)).checks[0]?.code).toBe('api_quota_exhausted')
 fetch.mockImplementation(async()=>json(protocol==='openai-chat'?{choices:[{finish_reason:'length',message:{content:'{"ok":true}'}}]}:{status:'incomplete',incomplete_details:{reason:'max_output_tokens'},output:[]}))
 expect((await check(protocol)).checks[0]?.code).toBe('model_output_limit')
})
it.each(['openai-chat','openai-responses'])('uses one successful %s check request and a 4096 output token budget',async protocol=>{
 const fetch=vi.fn(async(_url:any,init:any)=>{const body=JSON.parse(init.body);expect(body[protocol==='openai-chat'?'max_completion_tokens':'max_output_tokens']).toBe(4096);expect(body.tools).toBeUndefined();return json(protocol==='openai-chat'?{choices:[{finish_reason:'stop',message:{content:'{"ok":true}'}}]}:{status:'completed',output:[{type:'message',content:[{type:'output_text',text:'{"ok":true}'}]}]})});vi.stubGlobal('fetch',fetch)
 expect((await check(protocol)).ok).toBe(true);expect(fetch).toHaveBeenCalledTimes(1)
})
it('bounds invalid JSON repair to two check requests',async()=>{
 const fetch=vi.fn(async()=>json({choices:[{finish_reason:'stop',message:{content:'not JSON'}}]}));vi.stubGlobal('fetch',fetch)
 expect((await check()).checks[0]?.code).toBe('model_reply_invalid');expect(fetch).toHaveBeenCalledTimes(2)
})
it('drops arbitrary network errors and bounded malformed quota responses',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>{throw Error('secret key and private URL')}));expect((await check()).checks[0]?.code).toBe('connection_unreachable')
 vi.stubGlobal('fetch',vi.fn(async()=>new Response('x'.repeat(9000),{status:429})));expect((await check()).checks[0]?.code).toBe('api_rate_limited')
})

it('classifies a request deadline without returning transport details',async()=>{
 const original=AbortSignal.timeout.bind(AbortSignal)
 vi.spyOn(AbortSignal,'timeout').mockImplementation(ms=>ms===45000?AbortSignal.abort(new DOMException('Synthetic timeout','TimeoutError')):original(ms))
 vi.stubGlobal('fetch',vi.fn(async(_url:any,init:any)=>{init.signal.throwIfAborted();throw Error('Unexpected live request')}))
 expect((await check()).checks[0]?.code).toBe('connection_timeout')
})
it('classifies Anthropic output truncation without exposing body text',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>json({stop_reason:'max_tokens',content:[{type:'text',text:'synthetic-secret'}]})))
 expect((await check('anthropic')).checks[0]?.code).toBe('model_output_limit')
})
it.each(['application/json','text/event-stream'])('classifies body timeout after %s response headers and cancels the reader',async contentType=>{
 const original=AbortSignal.timeout.bind(AbortSignal)
 vi.spyOn(AbortSignal,'timeout').mockImplementation(ms=>original(ms===45000?20:ms))
 let cancelled=false
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(contentType==='application/json'?'{':'data: {}\n\n'))},cancel(){cancelled=true}}),{headers:{'content-type':contentType}})))
 const result=await check();expect(result.checks[0]?.code).toBe('connection_timeout');expect(cancelled).toBe(true)
})
it('classifies Responses SSE output-budget exhaustion without retaining event details',async()=>{
 const event={type:'response.incomplete',response:{status:'incomplete',incomplete_details:{reason:'max_output_tokens'},output:[],secret:'synthetic-private-response'}}
 vi.stubGlobal('fetch',vi.fn(async()=>new Response('data: '+JSON.stringify(event)+'\n\n',{headers:{'content-type':'text/event-stream'}})))
 const result=await check('openai-responses');expect(result.checks[0]?.code).toBe('model_output_limit');expect(JSON.stringify(result)).not.toContain('synthetic-private-response')
})
it('classifies a slow 429 body request timeout and releases its reader',async()=>{
 const original=AbortSignal.timeout.bind(AbortSignal)
 vi.spyOn(AbortSignal,'timeout').mockImplementation(ms=>original(ms===45000?20:ms))
 let cancelled=false;const body=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{'))},cancel(){cancelled=true}})
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(body,{status:429,headers:{'content-type':'application/json'}})))
 expect((await check()).checks[0]?.code).toBe('connection_timeout');expect(cancelled).toBe(true);expect(body.locked).toBe(false)
})
it.each(['caller','turn'] as const)('preserves %s cancellation while reading 429 and cleans up',async kind=>{
 const {ApiModel}=await import('../src/backends/api.ts'),{backendDefinition}=await import('../src/backend-config.ts')
 let cancelled=false;const body=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{'))},cancel(){cancelled=true}})
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(body,{status:429,headers:{'content-type':'application/json'}})))
 const controller=new AbortController(),reason=Error('Synthetic operator stopped'),timer=kind==='caller'?setTimeout(()=>controller.abort(reason),5):undefined
 const d=backendDefinition.parse({kind:'openai-chat',baseUrl:'http://127.0.0.1:1/v1',model:'synthetic',requestTimeoutMs:1000})
 const model=new ApiModel('synthetic',d as any,{get(){return undefined},put(){}},kind==='turn'?10:1000)
 try{const run=model.run({cwd:tmpdir(),instructions:'synthetic',input:'synthetic',schema:{type:'object'},ephemeral:true,tools:[],signal:controller.signal})
  if(kind==='caller')await expect(run).rejects.toBe(reason)
  else await expect(run).rejects.toThrow('deadline')
  expect(cancelled).toBe(true);expect(body.locked).toBe(false)
 }finally{clearTimeout(timer)}
})

it.each([401,429])('redacts HTTP %s body stream failures in checks and persisted turns',async status=>{
 const {ApiModel}=await import('../src/backends/api.ts'),{backendDefinition}=await import('../src/backend-config.ts')
 const secret='synthetic-sensitive-token https://private.example/path'
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(new ReadableStream({pull(){throw Error(secret)}}),{status})))
 expect((await check()).checks[0]?.code).toBe('connection_unreachable')
 const records=new Map<string,unknown>(),store={get:<T>(kind:string,id:string)=>records.get(kind+id) as T|undefined,put:(kind:string,id:string,value:unknown)=>{records.set(kind+id,value)}}
 const definition=backendDefinition.parse({kind:'openai-chat',baseUrl:'http://127.0.0.1:1/v1',model:'synthetic'})
 const model=new ApiModel('synthetic',definition as any,store,1000)
 await expect(model.run({cwd:tmpdir(),instructions:'fixture',input:'fixture',schema:{type:'object'},tools:[]})).rejects.toThrow('connection_network_failed')
 expect(JSON.stringify([...records.values()])).not.toContain(secret)
})
it.each(['TimeoutError','UND_ERR_CONNECT_TIMEOUT'])('retains native transport timeout classification for %s',async kind=>{
 const error=kind==='TimeoutError'?new DOMException('private detail',kind):Object.assign(new Error('private detail'),{cause:{code:kind}})
 vi.stubGlobal('fetch',vi.fn(async()=>{throw error}))
 expect((await check()).checks[0]?.code).toBe('connection_timeout')
})
