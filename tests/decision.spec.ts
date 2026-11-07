import {afterEach,expect,it,vi} from 'vitest'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createServer} from 'node:http'
import {configSchema} from '../src/config.ts'
import {decisionConfigSchema} from '../src/decision-config.ts'
import {DecisionLayer,type DecisionInput} from '../src/decision.ts'
import {Store} from '../src/store.ts'
import {Settings} from '../src/settings.ts'

const cleanups:(()=>Promise<unknown>|void)[]=[]
afterEach(async()=>{vi.unstubAllGlobals();for(const fn of cleanups.splice(0).reverse())await fn()})
const input:DecisionInput={kind:'task_followups',messages:[{id:'m1',text:'不要停止；日志里的 “stop” 是引用。',human:true,truncated:false}],tasks:[{id:'t1',scope:'Test only'}]}
function fixture(provider:any={kind:'openai-chat',baseUrl:'https://example.invalid/v1',model:'small'},patch:any={}){
 const root=mkdtempSync(join(tmpdir(),'roppo-decision-'));cleanups.push(()=>rmSync(root,{recursive:true,force:true}))
 const config=configSchema.parse({stateDir:root,sources:[{id:'local',kind:'local',allowedActors:['operator'],cwd:root}],decision:{mode:'advisory',provider,...patch}})
 const store=new Store(join(root,'state.db'));cleanups.push(()=>store.close())
 const settings=new Settings(store,config),layer=new DecisionLayer(config,store,()=>settings.current().revision);cleanups.push(()=>layer.close())
 return {config,store,settings,layer}
}
function reply(action='CONTINUE'){return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({decisions:[{id:'m1',action}]})}}],usage:{prompt_tokens:24,completion_tokens:9}}}
function mock(value:any){const fetch=vi.fn(async(_url:unknown,_init?:RequestInit)=>Response.json(value));vi.stubGlobal('fetch',fetch);return fetch}
it('defaults off, retains settings across restart, and rejects invalid provider references or protocol overrides',async()=>{
 const f=fixture();f.settings.save(0,{decision:{mode:'off'}})
 const fetch=mock(reply());expect(await f.layer.evaluate(input,{id:'off'})).toBeUndefined();expect(fetch).not.toHaveBeenCalled()
 expect(f.config.decision.mode).toBe('off');expect(f.config.execution.backend).toBe('codex')
 f.settings.save(1,{decision:{mode:'shadow',provider:{kind:'jev'}}})
 const fresh=configSchema.parse({...f.config,decision:{mode:'off'}});new Settings(f.store,fresh);expect(fresh.decision.mode).toBe('shadow')
 expect(()=>f.settings.save(2,{decision:{mode:'advisory',provider:{kind:'backend',id:'codex'}}})).toThrow('API backend')
 expect(()=>decisionConfigSchema.parse({mode:'advisory'})).toThrow()
 for(const value of [{provider:{kind:'openai-chat',baseUrl:'http://remote.invalid',model:'x'}},{provider:{kind:'jev'},effort:'high'},{parameters:{tools:[]}}])expect(()=>decisionConfigSchema.parse(value)).toThrow()
})
it.each(['openai-chat','openai-responses','anthropic','jev'])('uses the real %s wire protocol over HTTP with one request and no tools',async kind=>{
 const requests:any[]=[]
 const server=createServer(async(req,res)=>{const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(chunk);requests.push({url:req.url,body:JSON.parse(Buffer.concat(chunks).toString()),headers:req.headers})
 const text=JSON.stringify({decisions:[{id:'m1',action:'CONTINUE'}]})
 const data=kind==='jev'?{answers:{message_0:{type:'choice',choice:'CONTINUE',confidence:.8,probabilities:{STOP:.01,CONTINUE:.9,IGNORE:.03,INTERVENE:.01,REVIEW:.05}}},usage:{input_tokens:30,output_tokens:4}}:kind==='openai-responses'?{status:'completed',output:[{type:'message',content:[{type:'output_text',text}]}],usage:{input_tokens:24,output_tokens:9}}:kind==='anthropic'?{stop_reason:'end_turn',content:[{type:'text',text}],usage:{input_tokens:24,output_tokens:9}}:reply()
 res.setHeader('content-type','application/json');res.end(JSON.stringify(data))})
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));cleanups.push(()=>new Promise<void>(r=>server.close(()=>r())))
 const f=fixture({kind,baseUrl:'http://127.0.0.1:'+(server.address() as any).port+'/v1',model:'fixture',...(kind==='jev'?{}:{outputFormat:'json-schema',parameters:{temperature:0},chatTokenField:'max_tokens'})})
 const record=await f.layer.evaluate(input,{id:'http'})
 expect(record).toMatchObject({status:'ok',decisions:[{id:'m1',action:'CONTINUE'}]});expect(record?.usage?.inputTokens).toBeGreaterThan(0)
 expect(requests).toHaveLength(1);const b=requests[0].body;expect(b.tools).toBeUndefined();expect(b.stream).not.toBe(true);expect(b.model).toBe('fixture')
 expect(requests[0].url).toBe('/v1/'+({jev:'systemone',anthropic:'messages','openai-chat':'chat/completions','openai-responses':'responses'} as any)[kind])
 if(kind==='jev'){expect(b.questions.message_0.type).toBe('choice');expect(record?.confidence?.m1?.confidence).toBe(.8);expect(record?.confidence?.m1?.probabilities.CONTINUE).toBe(.9)}
 else{expect(b.temperature).toBe(0);expect(b.max_tokens??b.max_output_tokens).toBe(512)}
 expect(JSON.stringify(f.layer.records())).not.toContain(input.messages[0]!.text)
})
it('deduplicates a call and applies independent parameter overrides on a shared backend',async()=>{
 const f=fixture();f.settings.save(0,{backends:{shared:{kind:'openai-chat',baseUrl:'http://localhost:8080/v1',model:'cpu',parameters:{temperature:.7}}},decision:{mode:'advisory',provider:{kind:'backend',id:'shared'},effort:'none',parameters:{temperature:0}}})
 const fetch=mock(reply());const [a,b]=await Promise.all([f.layer.evaluate(input,{id:'same'}),f.layer.evaluate(input,{id:'same'})]);expect(a).toEqual(b)
 await f.layer.evaluate(input,{id:'same'});expect(fetch).toHaveBeenCalledTimes(1)
 const body=JSON.parse(fetch.mock.calls[0]![1]!.body as string);expect(body).toMatchObject({model:'cpu',temperature:0,reasoning_effort:'none'});expect(f.config.backends.shared?.kind).toBe('openai-chat')
})
it.each([
 ['invalid_json',()=>new Response('bad')],['http_401',()=>new Response('secret from service',{status:401})],
 ['incomplete_output',()=>Response.json({...reply(),choices:[{finish_reason:'length',message:{content:'{}'}}]})],
 ['invalid_output',()=>Response.json(reply('UNKNOWN'))],['invalid_output',()=>Response.json({...reply(),choices:[{finish_reason:'stop',message:{content:'{"decisions":[{"id":"foreign","action":"STOP"}]}'}}]})],
 ['response_too_large',()=>new Response('x'.repeat(65537))],
])('retains sanitized failure %s and never converts it to IGNORE',async(code,response)=>{
 const f=fixture();vi.stubGlobal('fetch',vi.fn(async()=>response()));const record=await f.layer.evaluate(input,{id:'fail'})
 expect(record).toMatchObject({status:'unavailable',code});expect(record?.decisions).toBeUndefined();expect(JSON.stringify(record)).not.toContain('secret from service')
})
it('limits concurrency, times out stalled bodies, and closes active calls before the store',async()=>{
 const server=createServer((_req,res)=>{res.writeHead(200,{'content-type':'application/json'});res.write('{')})
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));cleanups.push(()=>{server.closeAllConnections();server.close()})
 const f=fixture({kind:'openai-chat',baseUrl:'http://127.0.0.1:'+(server.address() as any).port,model:'cpu'},{timeoutMs:100,maxConcurrent:1})
 const pending=f.layer.evaluate(input,{id:'slow'});expect(await f.layer.evaluate(input,{id:'another'})).toMatchObject({status:'skipped',code:'capacity'})
 expect(await pending).toMatchObject({status:'unavailable',code:'timeout'})
 const closing=f.layer.evaluate(input,{id:'close'});await f.layer.close();expect(await closing).toMatchObject({status:'stale',code:'cancelled'})
})
it.each(['revision','authority','cancel'])('discards a late response after %s changes',async type=>{
 const f=fixture();let resolve!:(response:Response)=>void;vi.stubGlobal('fetch',vi.fn(()=>new Promise<Response>(r=>resolve=r)))
 let valid=true;const controller=new AbortController(),pending=f.layer.evaluate(input,{id:'late',signal:controller.signal,valid:()=>valid})
 if(type==='revision')f.settings.save(0,{decision:{mode:'off'}});else if(type==='authority')valid=false;else controller.abort()
 resolve(Response.json(reply('STOP')));expect(await pending).toMatchObject({status:'stale'});expect((await pending)?.decisions).toBeUndefined()
})
it('skips oversized input and missing credentials before network access',async()=>{
 const f=fixture({kind:'jev',apiKeyEnv:'ROPPO_TEST_ABSENT_KEY'},{maxInputChars:1000});const fetch=mock(reply())
 expect(await f.layer.evaluate({...input,messages:[{...input.messages[0]!,text:'x'.repeat(1001)}]},{id:'long'})).toMatchObject({code:'input_too_large'})
 expect(await f.layer.evaluate(input,{id:'credential'})).toMatchObject({code:'missing_credentials'});expect(fetch).not.toHaveBeenCalled()
})
