import {createServer,type Server} from 'node:http'
import {mkdtempSync,rmSync,mkdirSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {afterEach,it,expect} from 'vitest'
import {ApiModel,type ThreadStore} from '../src/backends/api.ts'
import {BackendRegistry} from '../src/backends/registry.ts'
import {backendDefinition,type ApiDefinition} from '../src/backend-config.ts'
import {configSchema} from '../src/config.ts'
import {Runtime} from '../src/runtime.ts'
import type {ModelRequest} from '../src/model.ts'
import {TransientModelError} from '../src/model.ts'
import {ContextBudgetExceeded,scopeBudget} from '../src/context-budget.ts'
const servers:Server[]=[],roots:string[]=[],hosts:Runtime[]=[]
afterEach(async()=>{for(const h of hosts.splice(0))await h.close();await Promise.all(servers.splice(0).map(s=>new Promise<void>(r=>{s.closeAllConnections();s.close(()=>r())})));for(const p of roots.splice(0))rmSync(p,{recursive:true,force:true});delete process.env.AGENTHUB_FIXTURE_KEY})
const kinds=['openai-chat','openai-responses','anthropic'] as const
type Kind=typeof kinds[number]
function memory():ThreadStore{const records=new Map<string,any>();return {get:(k,id)=>structuredClone(records.get(k+':'+id)),put:(k,id,v)=>{records.set(k+':'+id,structuredClone(v))}}}
async function server(fn:(body:any,url:string,headers:any)=>any){
 const requests:any[]=[],s=createServer(async(req,res)=>{try{let text='';for await(const chunk of req)text+=chunk;const body=JSON.parse(text);requests.push({path:req.url,body,headers:req.headers});const value=await fn(body,req.url!,req.headers);res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(value))}catch{res.writeHead(400,{'content-type':'application/json'});res.end('{"error":"fixture validation failed"}')}});servers.push(s)
 await new Promise<void>(r=>s.listen(0,'127.0.0.1',r));return {url:'http://127.0.0.1:'+(s.address() as any).port,requests}
}
function output(kind:Kind,text:string,calls:{id:string;name:string;args:any}[]=[]):any{
 if(kind==='openai-chat')return {choices:[{finish_reason:calls.length?'tool_calls':'stop',message:{role:'assistant',content:text||null,reasoning_content:'fixture reasoning',...(calls.length?{tool_calls:calls.map(c=>({id:c.id,type:'function',function:{name:c.name,arguments:JSON.stringify(c.args)}}))}:{})}}]}
 if(kind==='anthropic')return {stop_reason:calls.length?'tool_use':'end_turn',content:[...(text?[{type:'text',text}]:[]),...calls.map(c=>({type:'tool_use',id:c.id,name:c.name,input:c.args}))]}
 return {status:'completed',output:[{type:'reasoning',id:'rs-fixture-'+Math.random(),summary:[],encrypted_content:'opaque-fixture'},...(text?[{type:'message',role:'assistant',content:[{type:'output_text',text}]}]:[]),...calls.map(c=>({type:'function_call',call_id:c.id,name:c.name,arguments:JSON.stringify(c.args)}))]}
}
const definition=(kind:Kind,url:string,extra:any={}):ApiDefinition=>backendDefinition.parse({kind,baseUrl:url+'/v1',model:'fixture-model',requestTimeoutMs:3000,...extra}) as ApiDefinition
const schema={type:'object',additionalProperties:false,properties:{answer:{type:'string'}},required:['answer']}
const request=(extra:Partial<ModelRequest>={}):ModelRequest=>({cwd:tmpdir(),instructions:'Synthetic test',input:'read marker',schema,managed:true,tools:[{type:'function',name:'read_marker',description:'Read a synthetic marker',inputSchema:{type:'object',additionalProperties:false,properties:{path:{type:'string'}},required:['path']}}],...extra})
it.each(kinds)('%s integrates streaming text with the managed tool loop without replaying tools',async kind=>{
 const frame=(v:any)=>'data: '+(typeof v==='string'?v:JSON.stringify(v))+'\n\n',requests:any[]=[],deltas:string[]=[];let tools=0,finalSent=false,sawLive=false
 const fixture=createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;const b=JSON.parse(raw);requests.push(b)
  const tool=requests.length===1,text=JSON.stringify({answer:'Streamed marker'}),call={id:'stream-tool',name:'read_marker',args:{path:'marker.txt'}}
  let data:any[]=[],terminal:any
  if(kind==='openai-responses'){
   data=tool?[]:[{type:'response.output_text.delta',item_id:'answer',content_index:0,delta:text.slice(0,12)},{type:'response.output_text.delta',item_id:'answer',content_index:0,delta:text.slice(12)}]
   terminal={type:'response.completed',response:output(kind,tool?'':text,tool?[call]:[])}
  }else if(kind==='openai-chat'){
   data=tool?[{choices:[{index:0,delta:{tool_calls:[{index:0,id:call.id,type:'function',function:{name:call.name,arguments:JSON.stringify(call.args)}}]},finish_reason:'tool_calls'}]}]:[{choices:[{index:0,delta:{content:text.slice(0,12)}}]},{choices:[{index:0,delta:{content:text.slice(12)},finish_reason:'stop'}]}]
   terminal='[DONE]'
  }else{
   data=[{type:'message_start',message:{id:'m',model:'fixture-model'}},{type:'content_block_start',index:0,content_block:tool?{type:'tool_use',id:call.id,name:call.name,input:{}}:{type:'text',text:''}},...(tool?[{type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json:JSON.stringify(call.args)}}]:[{type:'content_block_delta',index:0,delta:{type:'text_delta',text:text.slice(0,12)}},{type:'content_block_delta',index:0,delta:{type:'text_delta',text:text.slice(12)}}]),{type:'content_block_stop',index:0},{type:'message_delta',delta:{stop_reason:tool?'tool_use':'end_turn'}}]
   terminal={type:'message_stop'}
  }
  res.writeHead(200,{'content-type':'text/event-stream'});for(const d of data)res.write(frame(d))
  setTimeout(()=>{if(!tool)finalSent=true;res.end(frame(terminal))},30)
 });servers.push(fixture);await new Promise<void>(r=>fixture.listen(0,'127.0.0.1',r))
 const model=new ApiModel('stream',definition(kind,'http://127.0.0.1:'+(fixture.address() as any).port),memory(),5000)
 const result=await model.run(request({onOutput:e=>{if(e.type==='delta'){deltas.push(e.text??'');if(!finalSent)sawLive=true}},onTool:async(name,args)=>{tools++;expect(name).toBe('read_marker');expect(args).toEqual({path:'marker.txt'});return {success:true,contentItems:[{type:'inputText',text:'marker'}]}}}))
 expect(requests.every(b=>b.stream===true)).toBe(true);expect(tools).toBe(1);expect(sawLive).toBe(true)
 expect(JSON.parse(deltas.join(''))).toEqual({answer:'Streamed marker'});expect(JSON.parse(result.text)).toEqual({answer:'Streamed marker'})
})
function results(kind:Kind,b:any){return kind==='openai-chat'?b.messages.filter((m:any)=>m.role==='tool'):kind==='anthropic'?b.messages.flatMap((m:any)=>Array.isArray(m.content)?m.content.filter((c:any)=>c.type==='tool_result'):[]):b.input.filter((i:any)=>i.type==='function_call_output')}
it.each(kinds)('%s budgets full instructions, tools and provider parameters before HTTP',async kind=>{
 const f=await server(()=>output(kind,'{"answer":"never"}')),store=memory()
 const model=new ApiModel('test',definition(kind,f.url,{parameters:{metadata:{padding:'x'.repeat(9000)}}}),store,10000)
 const receipts:any[]=[]
 await expect(model.run(request({contextBudget:scopeBudget(8000),input:'tiny',instructions:'system'.repeat(500),onBudget:r=>receipts.push(r)}))).rejects.toBeInstanceOf(ContextBudgetExceeded)
 expect(f.requests).toHaveLength(0);expect(receipts.at(-1).bytes).toBeGreaterThan(8000)
})
it.each(kinds)('%s retains a full oversized tool result and sends a complete receipt reference',async kind=>{
 let effects=0
 const f=await server(b=>results(kind,b).length?output(kind,'{"answer":"done"}'):output(kind,'',[{id:'effect-once',name:'read_marker',args:{path:'marker'}}]))
 const store=memory(),saved:any[]=[],model=new ApiModel('test',definition(kind,f.url),store,10000)
 const r=await model.run(request({contextBudget:scopeBudget(12000),retainToolResult:(id,result)=>{saved.push({id,result});return id},onTool:async()=>{effects++;return {success:true,contentItems:[{type:'inputText',text:'完整结果'.repeat(5000)}]}}}))
 expect(effects).toBe(1);expect(saved[0].result.contentItems[0].text.length).toBe(20000)
 expect(JSON.stringify(f.requests[1].body)).toContain('receiptId');expect(JSON.stringify(f.requests[1].body)).not.toContain('完整结果')
 expect(store.get<any>('backend-thread',r.threadId).effects['effect-once'].result).toEqual(saved[0].result)
})
it.each(kinds)('%s closes all tool pairs without effects if generated calls exhaust the context',async kind=>{
 const calls=Array.from({length:5},(_,i)=>({id:'c'+i,name:'read_marker',args:{path:'x'.repeat(3000)}}))
 const f=await server(()=>output(kind,'',calls)),store=memory(),model=new ApiModel('test',definition(kind,f.url),store,10000)
 let effects=0,id=''
 await expect(model.run(request({contextBudget:scopeBudget(8000),onThread:x=>{id=x},onTool:async()=>{effects++;return {success:true,contentItems:[]}}}))).rejects.toBeInstanceOf(ContextBudgetExceeded)
 const t=store.get<any>('backend-thread',id);expect(effects).toBe(0);expect(t.pending).toBeUndefined();expect(Object.keys(t.effects)).toHaveLength(5)
 expect(t.turns[0].items.filter((i:any)=>i.type==='functionCallOutput')).toHaveLength(5)
 expect(f.requests).toHaveLength(1)
})
it.each(kinds)('%s recovers a reset connection in the same session without repeating a completed tool',async kind=>{
 const bodies:any[]=[]
 const root=mkdtempSync(join(tmpdir(),'api-recovery-'));roots.push(root);writeFileSync(join(root,'marker.txt'),'retained-tool-result')
 const fixture=createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk
  const b=JSON.parse(raw);bodies.push(b)
  if(bodies.length===3){req.socket.destroy();return}
  const answer=bodies.length===1?output(kind,JSON.stringify({action:'accept',title:'Read marker',scope:'Read marker.txt',reason:'Requested',rules:[],ruleAssessments:[],targetTicketId:null})):
   bodies.length===2?output(kind,'',[{id:'read-once',name:'superagent_read',args:{resource:'files/marker.txt'}}]):output(kind,JSON.stringify({state:'ready',summary:'Read',reply:'retained-tool-result',question:null,askedBy:null,handbacks:[]}))
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(answer))
 });servers.push(fixture);await new Promise<void>(r=>fixture.listen(0,'127.0.0.1',r))
 const url='http://127.0.0.1:'+(fixture.address() as any).port
 const config=configSchema.parse({stateDir:join(root,'state'),port:0,execution:{backend:'test'},backends:{test:definition(kind,url)},sources:[{id:'local',kind:'local',cwd:root,allowedActors:['alice']}]})
 const host=new Runtime(config);hosts.push(host)
 host.receive('local','alice',{id:'request',thread:'recovery',text:'Read marker.txt',addressed:true})
 for(let n=0;n<600;n++){await host.tick();await new Promise(r=>setTimeout(r,5));if(host.store.deliveries().some(d=>d.text==='retained-tool-result'&&d.status==='sent'))break}
 expect(host.store.deliveries().some(d=>d.text==='retained-tool-result'&&d.status==='sent')).toBe(true)
 expect(bodies).toHaveLength(4);expect(JSON.stringify(bodies[3])).toContain('retained-tool-result')
 const ticket=host.status().tickets[0]!,thread=host.store.get<any>('backend-thread',ticket.run!.threadId!)
 expect(Object.keys(thread.effects)).toEqual(['read-once'])
 expect(thread.turns.map((t:any)=>t.status)).toEqual(['failed','completed'])
 expect(host.store.list<any>('execution-call').filter(c=>c.name==='superagent_read')).toHaveLength(1)
})

it.each(['request timeout','response reset'])('classifies %s as transient but not a user/turn cancellation',async mode=>{
 const fixture=createServer((_req,res)=>{
  if(mode==='response reset'){res.writeHead(200,{'content-type':'application/json','content-length':'1000'});res.write('{');setTimeout(()=>res.destroy(),10)}
 });servers.push(fixture);await new Promise<void>(r=>fixture.listen(0,'127.0.0.1',r))
 const url='http://127.0.0.1:'+(fixture.address() as any).port
 const d=definition('openai-chat',url,{requestTimeoutMs:100})
 await expect(new ApiModel('test',d,memory(),3000).run(request())).rejects.toBeInstanceOf(TransientModelError)
 const abort=new AbortController();abort.abort(Error('Operator stopped'))
 await expect(new ApiModel('test',d,memory(),3000).run(request({signal:abort.signal}))).rejects.toThrow('Operator stopped')
 if(mode==='request timeout'){
  const model=new ApiModel('test',definition('openai-chat',url,{requestTimeoutMs:3000}),memory(),100)
  try{await model.run(request());throw Error('Expected turn deadline')}catch(error){expect(error).not.toBeInstanceOf(TransientModelError);expect(String(error)).toContain('deadline')}
 }
})

it.each(kinds)('%s acknowledges source steering only when it enters the next persisted model step',async kind=>{
 let control:any,consumed=0,release!:()=>void,calls=0,threadId=''
 const gate=new Promise<void>(r=>{release=r})
 const f=await server(async b=>{calls++;if(calls===1){await gate;return output(kind,'{"answer":"old"}')}expect(JSON.stringify(b)).toContain('new source input');return output(kind,'{"answer":"new"}')})
 const store=memory(),model=new ApiModel('test',definition(kind,f.url),store,10000)
 const running=model.run(request({onActive:c=>{control=c},onThread:id=>{threadId=id}}))
 while(calls===0)await new Promise(r=>setTimeout(r,2))
 await control.steer('new source input',()=>{consumed++;expect(JSON.stringify(store.get('backend-thread',threadId))).toContain('new source input')})
 // The callback is not an enqueue receipt. The in-flight old response cannot finish this turn.
 expect(consumed).toBe(0);release()
 expect(JSON.parse((await running).text).answer).toBe('new');expect(consumed).toBe(1);expect(calls).toBe(2)
})
it.each(kinds)('%s executes a real HTTP tool loop and resumes persisted history without Codex',async kind=>{
 let calls=0
 const fixture=await server((b,path,h)=>{
  expect(path).toBe('/v1/'+(kind==='openai-chat'?'chat/completions':kind==='anthropic'?'messages':'responses'))
  if(kind==='anthropic'){expect(h['anthropic-version']).toBe('2023-06-01');expect(h['x-api-key']).toBe('synthetic-fixture-key')}
  else expect(h.authorization).toBe('Bearer synthetic-fixture-key')
  if(++calls===1){expect(b.tools[0][kind==='openai-chat'?'function':'name']).toBeDefined();return output(kind,'',[{id:'first-call',name:'read_marker',args:{path:'marker.txt'}}])}
  expect(JSON.stringify(b)).toContain('marker-value');expect(results(kind,b)).toHaveLength(1)
  if(kind==='openai-responses'){expect(b.store).toBe(false);expect(b.input.some((i:any)=>i.type==='reasoning'&&i.encrypted_content==='opaque-fixture')).toBe(true)}
  if(kind==='openai-chat')expect(b.messages.some((m:any)=>m.reasoning_content==='fixture reasoning')).toBe(true)
  return output(kind,'{"answer":"marker-value"}')
 })
 process.env.AGENTHUB_FIXTURE_KEY='synthetic-fixture-key';const store=memory(),d=definition(kind,fixture.url,{apiKeyEnv:'AGENTHUB_FIXTURE_KEY'}),model=new ApiModel('test',d,store,10000);let effects=0
 const first=await model.run(request({onTool:async(name,args)=>{effects++;expect(name).toBe('read_marker');expect(args).toEqual({path:'marker.txt'});return {success:true,contentItems:[{type:'inputText',text:'marker-value'}]}}}))
 expect(JSON.parse(first.text).answer).toBe('marker-value');expect(effects).toBe(1)
 const resumed=await new ApiModel('test',d,store,10000).run(request({threadId:first.threadId,input:'continue',onTool:async()=>{throw Error('Unexpected replay')}}))
 expect(resumed.threadId).toBe(first.threadId);expect(resumed.turnId).not.toBe(first.turnId)
 const history=await model.history(first.threadId,tmpdir());expect(history.turns.map((t:any)=>t.status)).toEqual(['completed','completed'])
 expect(JSON.stringify(store.get('backend-thread',first.threadId))).not.toContain('synthetic-fixture-key')
})
it.each(kinds)('%s returns scoped tool errors for unknown tools or invalid arguments without invoking them',async kind=>{
 let n=0,executed=0
 const f=await server(b=>++n===1?output(kind,'',[{id:'unknown',name:'native_shell',args:{path:'x'}},{id:'invalid',name:'read_marker',args:{path:42}}]):(expect(results(kind,b)).toHaveLength(2),output(kind,'{"answer":"blocked"}')))
 const model=new ApiModel('test',definition(kind,f.url),memory(),10000)
 await expect(model.run(request({onTool:async()=>{executed++;throw Error('Must not execute')}}))).resolves.toMatchObject({text:'{"answer":"blocked"}'})
 expect(executed).toBe(0)
})
it.each(kinds)('%s bounds malformed final-output repair instead of accepting an invalid report',async kind=>{
 const f=await server(()=>output(kind,'{"wrong":true}')),model=new ApiModel('test',definition(kind,f.url),memory(),10000)
 await expect(model.run(request())).rejects.toThrow('JSON schema');expect(f.requests).toHaveLength(3)
})
it.each(kinds)('%s refuses duplicate call IDs before repeating side effects',async kind=>{
 let effects=0;const f=await server(()=>output(kind,'',[{id:'repeat',name:'read_marker',args:{path:'x'}}]))
 await expect(new ApiModel('test',definition(kind,f.url),memory(),10000).run(request({onTool:async()=>{effects++;return {success:true,contentItems:[{type:'inputText',text:'x'}]}}}))).rejects.toThrow('repeated tool call ID')
 expect(effects).toBe(1)
})
it.each(kinds)('%s recovers a lost tool receipt without replaying the side effect',async kind=>{
 let n=0,effects=0,snapshot:any
 const f=await server(b=>++n===1?output(kind,'',[{id:'effect',name:'read_marker',args:{path:'x'}}]):(expect(JSON.stringify(results(kind,b))).toContain('not replayed'),output(kind,'{"answer":"inspected"}')))
 const store=memory(),d=definition(kind,f.url),model=new ApiModel('test',d,store,10000),abort=new AbortController();let id=''
 await expect(model.run(request({signal:abort.signal,onThread:x=>id=x,onTool:async()=>{snapshot=store.get('backend-thread',id);effects++;abort.abort();throw Error('receipt lost')}}))).rejects.toThrow()
 store.put('backend-thread',id,snapshot)
 await new ApiModel('test',d,store,10000).run(request({threadId:id,input:'inspect interrupted work',onTool:async()=>{effects++;throw Error('must not replay')}}))
 expect(effects).toBe(1)
})
it('pins existing conversations to their backend while new roles select different backends',async()=>{
 const a=await server(()=>output('openai-chat','{"answer":"A"}')),b=await server(()=>output('anthropic','{"answer":"B"}')),config=configSchema.parse({execution:{backend:'a',roles:{worker:'b'}},backends:{a:definition('openai-chat',a.url),b:definition('anthropic',b.url)},sources:[{id:'local',kind:'local',cwd:tmpdir(),allowedActors:['operator']}]})
 const store=memory(),registry=new BackendRegistry(config,store),first=await registry.run(request({role:'worker'}));expect(JSON.parse(first.text).answer).toBe('B')
 config.execution.roles.worker='a'
 expect(JSON.parse((await registry.run(request({role:'worker'}))).text).answer).toBe('A')
 expect(JSON.parse((await registry.run(request({threadId:first.threadId}))).text).answer).toBe('B')
 ;(config.backends.b as ApiDefinition).baseUrl=a.url+'/v1'
 await expect(new BackendRegistry(config,store).run(request({threadId:first.threadId}))).rejects.toThrow('explicit migration')
})
it('reserves the codex backend ID so legacy native conversations cannot be reinterpreted as API sessions',()=>{
 const config=configSchema.parse({backends:{codex:definition('anthropic','https://example.com')},sources:[{id:'local',kind:'local',cwd:tmpdir(),allowedActors:['operator']}]})
 expect(()=>new BackendRegistry(config,memory())).toThrow('reserved')
})
it.each(kinds)('%s preserves tool/image ordering and applies prompt refresh and steering at the next step',async kind=>{
 let n=0,control:any
 const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+yR5cAAAAASUVORK5CYII='
 const f=await server(b=>{
  if(++n===1)return output(kind,'',[{id:'image',name:'read_marker',args:{path:'image'}},{id:'text',name:'read_marker',args:{path:'text'}}])
  expect(JSON.stringify(b)).toContain('updated-instructions');expect(JSON.stringify(b)).toContain('steering-marker');expect(results(kind,b)).toHaveLength(2)
  if(kind==='openai-chat'){const m=b.messages,first=m.findIndex((x:any)=>x.role==='tool');expect(m[first+1].role).toBe('tool');expect(m[first+2].content[1].type).toBe('image_url')}
  if(kind==='anthropic')expect(results(kind,b)[0].content[0].source.media_type).toBe('image/png')
  if(kind==='openai-responses')expect(results(kind,b)[0].output[0]).toMatchObject({type:'input_image',image_url:png})
  return output(kind,'{"answer":"image-handled"}')
 })
 await new ApiModel('test',definition(kind,f.url,{images:true}),memory(),10000).run(request({onActive:c=>control=c,onTool:async(_name,args)=>{await control.refresh('updated-instructions');await control.steer('steering-marker');return {success:true,contentItems:(args as any).path==='image'?[{type:'inputImage',imageUrl:png}]:[{type:'inputText',text:'text-marker'}]}}}))
})
it('cancels an in-flight API request and retains an interrupted turn',async()=>{
 const f=await server(()=>new Promise(()=>{})),store=memory(),model=new ApiModel('test',definition('openai-chat',f.url),store,5000);let thread=''
 await expect(model.run(request({onThread:id=>thread=id,onActive:c=>{setTimeout(()=>void c.interrupt(),25)}}))).rejects.toThrow()
 expect((await model.history(thread,tmpdir())).turns[0].status).toBe('interrupted')
})
it('rejects unsafe endpoints and protocol-owned parameter overrides before network access',()=>{
 for(const baseUrl of ['http://example.com/v1','https://key:secret@example.com','https://example.com/v1?api_key=x'])expect(()=>definition('openai-chat',baseUrl)).toThrow()
 for(const parameters of [{messages:[]},{tools:[]},{model:'override'},{store:true},{n:5},{max_completion_tokens:1000000}])expect(()=>definition('openai-chat','https://example.com',{parameters})).toThrow('cannot replace')
 for(const parameters of [{output_config:{format:{}}},{text:{format:{}}}])expect(()=>definition('openai-chat','https://example.com',{parameters})).toThrow('managed by AgentHub')
})
it.each(['anthropic','openai-responses'] as const)('%s preserves provider output options alongside the managed response schema',async kind=>{
 const parameters=kind==='anthropic'?{thinking:{type:'disabled'},output_config:{effort:'high'}}:{text:{verbosity:'low'}}
 const f=await server(body=>{if(kind==='anthropic'){expect(body.thinking).toEqual({type:'disabled'});expect(body.output_config).toMatchObject({effort:'high',format:{schema}})}else expect(body.text).toMatchObject({verbosity:'low',format:{schema}});return output(kind,'{"answer":"valid"}')})
 await new ApiModel('test',definition(kind,f.url,{parameters,outputFormat:'json-schema'}),memory(),10000).run(request())
})
it.each(kinds)('%s maps structured output to the protocol-specific server schema field',async kind=>{
 const f=await server(b=>{
  if(kind==='openai-chat')expect(b.response_format.json_schema.schema).toEqual(schema)
  else if(kind==='openai-responses')expect(b.text.format.schema).toEqual(schema)
  else expect(b.output_config.format.schema).toEqual(schema)
  return output(kind,'{"answer":"valid"}')
 })
 await new ApiModel('test',definition(kind,f.url,{outputFormat:'json-schema'}),memory(),10000).run(request())
})
it('enforces the tool-call budget before a large batch can execute any tool',async()=>{
 let calls=0;const f=await server(()=>output('openai-chat','',[{id:'one',name:'read_marker',args:{path:'x'}},{id:'two',name:'read_marker',args:{path:'x'}}]))
 await expect(new ApiModel('test',definition('openai-chat',f.url,{maxToolCalls:1}),memory(),10000).run(request({onTool:async()=>{calls++;return {success:true,contentItems:[]}}}))).rejects.toThrow('budget')
 expect(calls).toBe(0)
})
it.each(kinds.flatMap(kind=>[{kind,separate:false},{kind,separate:true}]))('$kind executes managed subagents without Codex (separate connection=$separate)',async({kind,separate})=>{
 const root=mkdtempSync(join(tmpdir(),'api-delegation-'));roots.push(root);const cwd=join(root,'files');mkdirSync(cwd);writeFileSync(join(cwd,'input.txt'),'delegated-file-marker')
 let childRequests=0
 const f=await server(b=>{
  const instructions=kind==='anthropic'?b.system:kind==='openai-responses'?b.instructions:b.messages[0].content
  if(instructions.includes('"targetTicketId"'))return output(kind,JSON.stringify({action:'accept',title:'Delegate',scope:'Delegate reading input.txt',rules:[],ruleAssessments:[],reason:'Synthetic request',targetTicketId:null}))
  const values=results(kind,b).map((r:any)=>{const text=kind==='openai-chat'?r.content:JSON.stringify(kind==='anthropic'?r.content:r.output);try{return JSON.parse(kind==='openai-chat'?text:(kind==='anthropic'?r.content[0].text:r.output[0].text))}catch{return {raw:text}}})
  const ready={state:'ready',summary:'Delegation complete',reply:'delegated-file-marker',question:null,askedBy:null,handbacks:[]}
  if(instructions.includes('You are a managed subagent')){childRequests++;expect(b.model).toBe(separate?'child-model':'parent-model');expect(b.parent_option).toBe(separate?undefined:true);return JSON.stringify(values).includes('delegated-file-marker')?output(kind,JSON.stringify(ready)):output(kind,'',[{id:'child-read',name:'superagent_read',args:{resource:'files/input.txt'}}])}
  const job=values.find((v:any)=>v.id&&v.kind==='agent')
  if(!job)return output(kind,'',[{id:'spawn',name:'superagent_spawn',args:{prompt:'Read input.txt using resources, report its contents.',requestId:'child-one'}}])
  const latest=values.filter((v:any)=>v.id===job.id).at(-1)
  if(latest.state==='completed')return output(kind,JSON.stringify(ready))
  return output(kind,'',[{id:'wait-'+values.length,name:'superagent_job',args:{id:job.id,action:'wait',yieldMs:1000}}])
 })
 const config=configSchema.parse({stateDir:join(root,'state'),codex:'/missing/codex',execution:{backend:'api',roles:separate?{subagent:'child'}:{},workers:[{id:'one',backend:'api',model:'parent-model',parameters:{parent_option:true}}]},backends:{api:definition(kind,f.url),child:definition(kind,f.url,{model:'child-model'})},work:{sandboxDriver:'disabled'},sources:[{id:'local',kind:'local',cwd,allowedActors:['operator']}]})
 const host=new Runtime(config);hosts.push(host);host.receive('local','operator',{id:'one',thread:'delegation',addressed:true,text:'Delegate reading input.txt to a managed child'})
 for(let i=0;i<200&&!host.store.deliveries().some(d=>d.kind==='reply'&&d.status==='sent');i++){await host.tick();await host.flush();await new Promise(r=>setTimeout(r,5))}
 expect(childRequests).toBeGreaterThanOrEqual(2);expect(host.work.list().some(w=>w.kind==='agent'&&w.state==='completed')).toBe(true)
 expect(host.store.deliveries().some(d=>d.kind==='reply'&&d.text==='delegated-file-marker'&&d.status==='sent')).toBe(true)
})
it.each(kinds)('%s runs the actual Runtime routing/file/result/follow-up path with a missing Codex binary',async kind=>{
 const root=mkdtempSync(join(tmpdir(),'api-runtime-'));roots.push(root);const cwd=join(root,'files');mkdirSync(cwd);writeFileSync(join(cwd,'input.txt'),'api-backend-file-marker')
 const f=await server(b=>{
  const instructions=kind==='anthropic'?b.system:kind==='openai-responses'?b.instructions:b.messages[0].content
  if(instructions.includes('"targetTicketId"'))return output(kind,JSON.stringify({action:'accept',title:'Read',scope:'Read input.txt',rules:[],ruleAssessments:[],reason:'Synthetic human request',targetTicketId:null}))
  if(JSON.stringify(results(kind,b)).includes('api-backend-file-marker'))return output(kind,JSON.stringify({state:'ready',summary:'Read actual file',reply:'api-backend-file-marker',question:null,askedBy:null,handbacks:[]}))
  return output(kind,'',[{id:'read-'+Math.random(),name:'superagent_read',args:{resource:'files/input.txt'}}])
 })
 const config=configSchema.parse({stateDir:join(root,'state'),codex:'/missing/codex',execution:{backend:'api'},backends:{api:definition(kind,f.url)},work:{sandboxDriver:'disabled'},sources:[{id:'local',kind:'local',cwd,allowedActors:['operator']}]})
 let host=new Runtime(config);hosts.push(host);expect((await host.setup.check()).status).toBe('ok')
 host.receive('local','operator',{id:'one',thread:'topic',addressed:true,text:'Read input.txt'})
 for(let i=0;i<150&&!host.store.deliveries().some(d=>d.kind==='reply'&&d.status==='sent');i++){await host.tick();await host.flush();await new Promise(r=>setTimeout(r,5))}
 const ticket=host.store.tickets.list()[0]!,run=host.store.get<any>('run',ticket.id);expect(run.result).toBe('api-backend-file-marker');expect(run.backendId).toBe('api')
 await host.close();hosts.splice(hosts.indexOf(host),1);host=new Runtime(config);hosts.push(host)
 host.receive('local','operator',{id:'two',thread:'topic',addressed:true,text:'Read it again'})
 for(let i=0;i<150&&host.store.tickets.get(ticket.id)!.assignments.length<2;i++){await host.tick();await new Promise(r=>setTimeout(r,5))}
 for(let i=0;i<150&&host.store.tickets.get(ticket.id)!.assignments.at(-1)!.state!=='ended';i++){await host.tick();await host.flush();await new Promise(r=>setTimeout(r,5))}
 expect(host.store.get<any>('run',ticket.id).threadId).toBe(run.threadId)
 expect(host.store.tickets.get(ticket.id)!.assignments.at(-1)!.state).toBe('ended')
 await expect(host.takeover(ticket.id)).rejects.toThrow('no native desktop takeover');expect(host.store.get<any>('run',ticket.id).phase).not.toBe('human')
})
it.skipIf(!['darwin','linux'].includes(process.platform)).each(kinds)('%s executes a real managed shell through the platform sandbox with no Codex binary',async kind=>{
 const root=mkdtempSync(join(tmpdir(),'api-shell-'));roots.push(root);const cwd=join(root,'files');mkdirSync(cwd);writeFileSync(join(cwd,'input.txt'),'shell-api-marker')
 const f=await server(b=>{
  const instructions=kind==='anthropic'?b.system:kind==='openai-responses'?b.instructions:b.messages[0].content
  if(instructions.includes('"targetTicketId"'))return output(kind,JSON.stringify({action:'accept',title:'Command',scope:'Write and read result.txt with a sandboxed command',rules:[],ruleAssessments:[],reason:'Synthetic request',targetTicketId:null}))
  const receipts=JSON.stringify(results(kind,b))
  if(receipts.includes('shell-api-marker'))return output(kind,JSON.stringify({state:'ready',summary:'Command verified',reply:'shell-api-marker',question:null,askedBy:null,handbacks:[]}))
  return output(kind,'',[{id:'shell',name:'superagent_shell',args:{command:'printf shell-api-marker > result.txt; cat result.txt',requestId:'one',yieldMs:1000}}])
 })
 const config=configSchema.parse({stateDir:join(root,'state'),codex:'/missing/codex',execution:{backend:'api'},backends:{api:definition(kind,f.url)},work:{sandboxDriver:process.platform==='linux'?'bubblewrap':'seatbelt',network:false},sources:[{id:'local',kind:'local',cwd,sandbox:'workspace-write',allowedActors:['operator']}]})
 const host=new Runtime(config);hosts.push(host);host.receive('local','operator',{id:'one',thread:'shell',addressed:true,text:'Write and read result.txt with a sandboxed command'})
 for(let i=0;i<200&&!host.store.deliveries().some(d=>d.kind==='reply'&&d.status==='sent');i++){await host.tick();await host.flush();await new Promise(r=>setTimeout(r,10))}
 expect(host.work.list()).toEqual([expect.objectContaining({kind:'shell',state:'completed',exitCode:0})])
 expect(host.work.list()[0]!.cwd.startsWith(join(config.stateDir,'work'))).toBe(true)
 expect(host.store.deliveries().some(d=>d.kind==='reply'&&d.text==='shell-api-marker'&&d.status==='sent')).toBe(true)
})

it.each(kinds)('%s assesses proactive messages, delegates and receives results in one persistent Router conversation',async kind=>{
 let step=0
 const decision={action:'accept',title:'Correct label',scope:'Correct the agreed typo',reason:'Agreed correction',rules:['typo'],targetTicketId:null,ruleAssessments:[{id:'typo',matched:true,reason:'Existing copy standard'}],direction:{implementation_requested:true,target_basis:'existing-standard',requires_design_decision:false,evidence:'Match the agreed existing label'},intent_evidence:'Correct the typo on the settings page to the agreed existing label'}
 const wire=await server(body=>{
  const instructions=body.instructions??body.system??body.messages?.[0]?.content??''
  if(!instructions.startsWith('You are the persistent Router'))return output(kind,JSON.stringify({state:'ready',summary:'Fixture checked',reply:'Worker fixture evidence',question:null,askedBy:null,handbacks:[]}))
  const turns=body.input??body.messages,latest=turns.findLast((m:any)=>m.role==='user'&&typeof m.content==='string')
  if(latest?.content.includes('"kind":"worker_result"'))return output(kind,JSON.stringify({reply:'Router verified fixture evidence'}))
  const actions=[{id:'context',name:'orchestrator_eval',args:{}},{id:'decision',name:'orchestrator_eval_decide',args:decision},{id:'assign',name:'worker_manage',args:{action:'assign',id:'one',revision:0,requestId:'once',text:decision.scope}}]
  const call=actions[step++];return output(kind,JSON.stringify({reply:''}),call?[call]:[])
 })
 const root=mkdtempSync(join(tmpdir(),'router-api-parity-'));roots.push(root)
 const config=configSchema.parse({stateDir:join(root,'state'),port:0,acceptMode:'auto',rules:[{id:'typo',instruction:'Fix agreed copy errors'}],backends:{fixture:{kind,baseUrl:wire.url,model:'fixture'}},execution:{router:{mode:'host',backend:'fixture'},management:{enabled:true},workers:[{id:'one',backend:'fixture'}]},work:{sandboxDriver:'disabled'},sources:[{id:'local',kind:'local',cwd:root,allowedActors:['alice']}]})
 const host=new Runtime(config);hosts.push(host)
 host.receive('local','alice',{id:'one',thread:'topic',text:'Correct the typo to match the existing label',addressed:false})
 for(let i=0;i<400&&!host.store.deliveries().some(d=>d.text==='Router verified fixture evidence');i++){await host.tick();await new Promise(r=>setTimeout(r,5))}
 expect(host.routerIngress.get('local:one')?.state).toBe('accepted');expect(host.store.tickets.list()).toHaveLength(1)
 expect(host.store.deliveries().filter(d=>!d.channel.address.routerInbox).map(d=>d.text)).toEqual(['Router verified fixture evidence'])
 const router=host.store.list<any>('router-session')[0],thread=host.store.get<any>('backend-thread',router.threadId)
 expect(thread.turns).toHaveLength(2);expect(thread.turns[0].items.filter((i:any)=>i.type==='functionCall').map((i:any)=>i.name)).toEqual(['orchestrator_eval','orchestrator_eval_decide','worker_manage'])
 expect(host.store.list('backend-thread')).toHaveLength(2)
})
