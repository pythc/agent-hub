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
it.each([[400,'api_request_rejected'],[401,'api_key_rejected'],[403,'api_key_rejected'],[404,'api_model_or_endpoint_missing'],[422,'api_request_rejected'],[429,'api_rate_limited'],[500,'api_service_unavailable'],[418,'api_http_error']])('classifies HTTP %s without exposing upstream data',async(status,code)=>{
 const fetch=vi.fn(async()=>json({error:{message:'synthetic-never-transmitted-secret https://secret.example/?token=private',code:'private-provider-code'}},status as number));vi.stubGlobal('fetch',fetch)
 const result=await check();expect(result.checks).toEqual([{id:'connection',status:'required',code}]);expect(fetch).toHaveBeenCalledTimes(1);expect(JSON.stringify(result)).not.toMatch(/secret|private|https:|headers/)
})
it.each(['openai-chat','openai-responses'])('distinguishes quota and truncation for %s',async protocol=>{
 const fetch=vi.fn(async()=>json({error:{code:'insufficient_quota',message:'secret'}},429));vi.stubGlobal('fetch',fetch)
 expect((await check(protocol)).checks[0]?.code).toBe('api_quota_exhausted')
 fetch.mockImplementation(async()=>json(protocol==='openai-chat'?{choices:[{finish_reason:'length',message:{content:'{"ok":true}'}}]}:{status:'incomplete',incomplete_details:{reason:'max_output_tokens'},output:[]}))
 expect((await check(protocol)).checks[0]?.code).toBe('model_output_truncated')
})
it.each(['openai-chat','openai-responses'])('bounds %s checking to one request and 1024 output tokens',async protocol=>{
 const fetch=vi.fn(async(_url:any,init:any)=>{const body=JSON.parse(init.body);expect(body[protocol==='openai-chat'?'max_completion_tokens':'max_output_tokens']).toBe(1024);expect(body.tools).toBeUndefined();return json(protocol==='openai-chat'?{choices:[{finish_reason:'stop',message:{content:'{"ok":true}'}}]}:{status:'completed',output:[{type:'message',content:[{type:'output_text',text:'{"ok":true}'}]}]})});vi.stubGlobal('fetch',fetch)
 expect((await check(protocol)).ok).toBe(true);expect(fetch).toHaveBeenCalledTimes(1)
})
it('does not repair invalid JSON with a second billable check',async()=>{
 const fetch=vi.fn(async()=>json({choices:[{finish_reason:'stop',message:{content:'not JSON'}}]}));vi.stubGlobal('fetch',fetch)
 expect((await check()).checks[0]?.code).toBe('model_reply_invalid');expect(fetch).toHaveBeenCalledTimes(1)
})
it('drops arbitrary network errors and bounded malformed quota responses',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>{throw Error('secret key and private URL')}));expect((await check()).checks[0]?.code).toBe('connection_network_failed')
 vi.stubGlobal('fetch',vi.fn(async()=>new Response('x'.repeat(9000),{status:429})));expect((await check()).checks[0]?.code).toBe('api_rate_limited')
})

it('classifies a request deadline without returning transport details',async()=>{
 const original=AbortSignal.timeout.bind(AbortSignal)
 vi.spyOn(AbortSignal,'timeout').mockImplementation(ms=>ms===30000?AbortSignal.abort(new DOMException('Synthetic timeout','TimeoutError')):original(ms))
 vi.stubGlobal('fetch',vi.fn(async(_url:any,init:any)=>{init.signal.throwIfAborted();throw Error('Unexpected live request')}))
 expect((await check()).checks[0]?.code).toBe('connection_timeout')
})
it('classifies Anthropic output truncation without exposing body text',async()=>{
 vi.stubGlobal('fetch',vi.fn(async()=>json({stop_reason:'max_tokens',content:[{type:'text',text:'synthetic-secret'}]})))
 expect((await check('anthropic')).checks[0]?.code).toBe('model_output_truncated')
})
it.each(['application/json','text/event-stream'])('classifies body timeout after %s response headers and cancels the reader',async contentType=>{
 const original=AbortSignal.timeout.bind(AbortSignal)
 vi.spyOn(AbortSignal,'timeout').mockImplementation(ms=>original(ms===30000?20:ms))
 let cancelled=false
 vi.stubGlobal('fetch',vi.fn(async()=>new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(contentType==='application/json'?'{':'data: {}\n\n'))},cancel(){cancelled=true}}),{headers:{'content-type':contentType}})))
 const result=await check();expect(result.checks[0]?.code).toBe('connection_timeout');expect(cancelled).toBe(true)
})
it('classifies Responses SSE output-budget exhaustion without retaining event details',async()=>{
 const event={type:'response.incomplete',response:{status:'incomplete',incomplete_details:{reason:'max_output_tokens'},output:[],secret:'synthetic-private-response'}}
 vi.stubGlobal('fetch',vi.fn(async()=>new Response('data: '+JSON.stringify(event)+'\n\n',{headers:{'content-type':'text/event-stream'}})))
 const result=await check('openai-responses');expect(result.checks[0]?.code).toBe('model_output_truncated');expect(JSON.stringify(result)).not.toContain('synthetic-private-response')
})
it('classifies a slow 429 body request timeout and releases its reader',async()=>{
 const original=AbortSignal.timeout.bind(AbortSignal)
 vi.spyOn(AbortSignal,'timeout').mockImplementation(ms=>original(ms===30000?20:ms))
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
