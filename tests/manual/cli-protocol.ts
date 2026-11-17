/** Opt-in: real, pinned vendor CLI binaries against a deterministic LOCAL provider.
 * This proves CLI/MCP/session compatibility, not a real model/provider response.
 * Usage: tsx tests/manual/cli-protocol.ts claude|gemini|opencode CLI_PREFIX
 */
import {createServer} from 'node:http'
import {mkdtempSync,writeFileSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {strict as assert} from 'node:assert'
import claude from '../../plugins/backend-claude/index.ts'
import gemini from '../../plugins/backend-gemini/index.ts'
import opencode from '../../plugins/backend-opencode/index.ts'
import {buildBackendPackage,activateBackendPackages} from '../../src/backends/plugin-package.ts'
import {configSchema} from '../../src/config.ts'
import {Store} from '../../src/store.ts'
import {BackendRegistry} from '../../src/backends/registry.ts'
const kind=process.argv[2]!,prefix=resolve(process.argv[3]!),root=mkdtempSync(join(tmpdir(),'roppo-real-cli-'+kind+'-'))
const requests:any[]=[],errors:string[]=[]
const server=createServer(async(req,res)=>{
 try{
  let input='';for await(const chunk of req)input+=chunk
  const body=input?JSON.parse(input):{}
  requests.push({path:req.url,body})
  writeFileSync(join(root,'requests.json'),JSON.stringify(requests,null,2))
  if(req.url?.includes('count_tokens')){res.setHeader('content-type','application/json');res.end(JSON.stringify({input_tokens:100}));return}
  if(req.url?.includes('messages')){
   const names=(body.tools??[]).map((t:any)=>t.name)
   assert(names.every((n:string)=>n.startsWith('mcp__roppo__')||n.startsWith('roppo_')||n==='EndConversation'),'native tools leaked: '+names)
   const name=names.find((n:string)=>n.endsWith('read_sample'))
   const last=body.messages?.at(-1),got=last?.content?.some?.((p:any)=>p.type==='tool_result')
   const content=name&&!got?{type:'tool_use',id:'call_'+requests.length,name,input:{}}:{type:'text',text:'{"answer":"你好，验证通过"}'}
   const message={id:'msg_'+requests.length,type:'message',role:'assistant',model:body.model,content:[content],stop_reason:content.type==='tool_use'?'tool_use':'end_turn',stop_sequence:null,usage:{input_tokens:100,output_tokens:20}}
   if(!body.stream){res.setHeader('content-type','application/json');res.end(JSON.stringify(message));return}
   res.setHeader('content-type','text/event-stream')
   const event=(type:string,data:any)=>res.write('event: '+type+'\ndata: '+JSON.stringify({type,...data})+'\n\n')
   event('message_start',{message:{...message,content:[],stop_reason:null,usage:{input_tokens:100,output_tokens:0}}})
   event('content_block_start',{index:0,content_block:content.type==='tool_use'?{...content,input:{}}:{type:'text',text:''}})
   event('content_block_delta',{index:0,delta:content.type==='tool_use'?{type:'input_json_delta',partial_json:'{}'}:{type:'text_delta',text:content.text}})
   event('content_block_stop',{index:0});event('message_delta',{delta:{stop_reason:message.stop_reason,stop_sequence:null},usage:{output_tokens:20}});event('message_stop',{});res.end();return
  }
  if(req.url?.includes('generateContent')||req.url?.includes('streamGenerateContent')){
   const names=(body.tools??[]).flatMap((t:any)=>t.functionDeclarations??[]).map((t:any)=>t.name)
   assert(names.every((n:string)=>n==='read_sample'||n.includes('roppo')),'native tools leaked: '+names)
   const name=names.find((n:string)=>n.endsWith('read_sample'))
   const got=body.contents?.at(-1)?.parts?.some((p:any)=>p.functionResponse)
   const part=name&&!got?{functionCall:{name,args:{}}}:{text:'{"answer":"你好，验证通过"}'}
   const response={candidates:[{content:{role:'model',parts:[part]},finishReason:'STOP',index:0}],usageMetadata:{promptTokenCount:100,candidatesTokenCount:20,totalTokenCount:120},modelVersion:body.model??'gemini-2.5-flash',responseId:'response_'+requests.length}
   res.setHeader('content-type',req.url?.includes('alt=sse')?'text/event-stream':'application/json')
   res.end(req.url?.includes('alt=sse')?'data: '+JSON.stringify(response)+'\n\n':JSON.stringify(response));return
  }
  res.writeHead(404);res.end('{}')
 }catch(e){errors.push(String(e));res.writeHead(500);res.end('{}')}
})
await new Promise<void>(r=>server.listen(0,'127.0.0.1',r))
const baseUrl='http://127.0.0.1:'+(server.address() as any).port
const selections={
 claude:{plugin:claude,config:{command:join(prefix,'node_modules/.bin/claude'),cliVersion:'2.1.319',model:'claude-sonnet-4-6',baseUrl}},
 gemini:{plugin:gemini,config:{command:process.execPath,args:[join(prefix,'node_modules/@google/gemini-cli/bundle/gemini.js')],cliVersion:'0.67.0',model:'gemini-2.5-flash',baseUrl}},
 opencode:{plugin:opencode,config:{command:join(prefix,'node_modules/.bin/opencode'),cliVersion:'1.19.5',model:'anthropic/claude-sonnet-4-6',baseUrl}},
}
const selected=selections[kind as keyof typeof selections];if(!selected)throw Error('Select claude, gemini or opencode')
// Capture ONLY this local fixture's vendor process output for protocol diagnosis.
const wrapper=join(root,'capture.mjs')
writeFileSync(wrapper,`import {spawn} from 'node:child_process';import {appendFileSync} from 'node:fs';const p=spawn(process.argv[2],process.argv.slice(3),{stdio:['pipe','pipe','pipe']});process.stdin.pipe(p.stdin);for(const [s,o] of [[p.stdout,process.stdout],[p.stderr,process.stderr]])s.on('data',b=>{if(process.env.XDG_STATE_HOME)appendFileSync(process.env.XDG_STATE_HOME+'/cli-fixture.log',b);o.write(b)});p.on('close',c=>process.exit(c??1));p.on('error',()=>process.exit(1));`)
const wrappedConfig={...selected.config,command:process.execPath,args:[wrapper,selected.config.command,...('args' in selected.config?selected.config.args:[])]}
process.env.ANTHROPIC_API_KEY='local-fixture-not-a-key';process.env.GEMINI_API_KEY='local-fixture-not-a-key'
let calls=0
const request={cwd:root,instructions:'You are a validation agent. Call read_sample exactly once per user turn, then answer in JSON.',input:'Read the sample and say hello.',schema:{type:'object',properties:{answer:{type:'string'}},required:['answer'],additionalProperties:false},tools:[{type:'function' as const,name:'read_sample',description:'Read the validation sample.',inputSchema:{type:'object',properties:{},additionalProperties:false}}],onTool:async()=>{calls++;return {success:true,contentItems:[{type:'inputText' as const,text:'sample=你好'}]}},onProgress:(text:string)=>console.log(text),signal:AbortSignal.timeout(90000)}
const hosted=process.argv.includes('--host')
let store:Store|undefined
try{
 const manifest=JSON.parse(readFileSync(resolve('plugins/backend-'+kind+'/manifest.json'),'utf8'))
 const pkg=hosted?await buildBackendPackage(resolve('plugins/backend-'+kind+'/index.ts'),manifest,join(root,'package')):undefined
 const config=hosted?configSchema.parse({stateDir:join(root,'host-state'),sources:[{id:'local',kind:'local',cwd:root,allowedActors:['operator']}],work:{sandboxDriver:process.platform==='darwin'?'seatbelt':'bubblewrap'},turnTimeoutMs:90000,backendPlugins:[{directory:pkg!.directory,digest:pkg!.digest}],backends:{external:{kind:'plugin',plugin:manifest.id,config:wrappedConfig,readPaths:[prefix,wrapper],env:kind==='gemini'?{GEMINI_API_KEY:'GEMINI_API_KEY'}:{ANTHROPIC_API_KEY:'ANTHROPIC_API_KEY'}}},execution:{backend:'external'}}):undefined
 if(config){store=new Store(join(config.stateDir,'state.sqlite'));activateBackendPackages(store,config)}
 const adapter=config?new BackendRegistry(config,store!):selected.plugin.create(wrappedConfig,{dataDirectory:join(root,'state')})
 console.log(JSON.stringify({kind,root,probe:await (adapter instanceof BackendRegistry?adapter.probe('external'):adapter.probe!())}))
 const runRequest={...request,...(hosted?{managed:true,contextBudget:{maxBytes:1_000_000,outputReserveBytes:8192,toolReserveBytes:4096}}:{})}
 const first=await adapter.run(runRequest)
 let upgraded:Awaited<ReturnType<typeof buildBackendPackage>>|undefined
 if(config){
  upgraded=await buildBackendPackage(resolve('plugins/backend-'+kind+'/index.ts'),{...manifest,version:'1.0.1'},join(root,'upgraded'))
  config.backendPlugins=[{directory:upgraded.directory,digest:upgraded.digest}];activateBackendPackages(store!,config)
  store!.close();store=new Store(join(config.stateDir,'state.sqlite'))
 }
 const restarted=config?new BackendRegistry(config,store!):selected.plugin.create(wrappedConfig,{dataDirectory:join(root,'state')})
 const second=await restarted.run({...runRequest,threadId:first.threadId,input:'Read the sample again after restarting.'})
 assert.equal(second.threadId,first.threadId);assert.equal(JSON.parse(second.text).answer,'你好，验证通过');assert.equal(calls,2);assert.deepEqual(errors,[])
  assert(JSON.stringify(requests.at(-1).body).includes('Read the sample and say hello.'))
  assert(JSON.stringify(requests.at(-1).body).includes('Read the sample again after restarting.'))
  if(config){
   assert.equal(store!.get<any>('backend-plugin-thread',first.threadId).digest,pkg!.digest)
   const fresh=await restarted.run(runRequest)
   assert.equal(store!.get<any>('backend-plugin-thread',fresh.threadId).digest,upgraded!.digest)
   config.backendPlugins=[{directory:pkg!.directory,digest:pkg!.digest}];activateBackendPackages(store!,config)
   store!.close();store=new Store(join(config.stateDir,'state.sqlite'))
   const rolledBack=new BackendRegistry(config,store)
   const continued=await rolledBack.run({...runRequest,threadId:fresh.threadId,input:'Read the sample again after restarting.'})
   assert.equal(continued.threadId,fresh.threadId);assert.equal(store.get<any>('backend-plugin-thread',fresh.threadId).digest,upgraded!.digest);assert.equal(calls,4)
   await rolledBack.purge(fresh.threadId,root)
  }
 const inspector=config?new BackendRegistry(config,store!):restarted
 assert.equal((await inspector.history!(first.threadId,root) as any).turns.length,2)
 await inspector.purge!(first.threadId,root);await inspector.purge!(first.threadId,root)
 console.log(JSON.stringify({kind,hosted,result:'pass',calls,requests:requests.length,session:first.threadId,root}))
}catch(e){console.error(JSON.stringify({kind,root,errors,requests:requests.length,error:String(e)}));process.exitCode=1}
finally{store?.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()))}
