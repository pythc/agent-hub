/** Real local Runtime/adapter acceptance. All provider/MCP responses below are synthetic. */
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {randomUUID} from 'node:crypto'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
import {serve} from '../src/server.ts'
import {ApiModel} from '../src/backends/api.ts'
import {backendDefinition,type ApiDefinition} from '../src/backend-config.ts'
import type {Model,ModelRequest} from '../src/model.ts'
import type {WorkOwner} from '../src/work.ts'
import type {Run} from '../src/store.ts'
import {ExecutionTrace} from '../src/execution-trace.ts'

const root=resolve(process.argv[2]??'.local/operation-errors-acceptance'),workspace=join(root,'workspace')
mkdirSync(workspace,{recursive:true,mode:0o700})
if(existsSync(join(root,'browser.json')))throw Error('Use a fresh private acceptance directory')
const markers=['SYNTHETIC_M4_SENTINEL','SYNTHETIC_M4_RAW_BODY','SYNTHETIC_M4_ENV_NAME','SYNTHETIC_M4_STDERR']
const prose=markers.join(' '),syntheticOrigin='https://m4-local-transport.invalid'
const counts={fixtureModelRuns:0,apiAdapterRuns:0,syntheticApiRequests:0,syntheticMcpRequests:0,mcpToolDispatches:0,sameRequestChecks:0,realProviderRequests:0,sdkAuthentication:0,externalMessages:0,blockedNetworkRequests:0,localAppRequests:0}
const originalFetch=globalThis.fetch
let appOrigin='',runtime:Runtime
const tasks:{id:string;title:string;case:string}[]=[],owners=new Map<string,WorkOwner>()
const apiModels=new Map<string,ApiModel>(),receiptRequest={connection:'mcp-unknown',tool:'synthetic_write',arguments:{label:'Local synthetic effect'},requestId:'same-local-request'}
const response=(id:unknown,result:unknown)=>new Response(JSON.stringify({jsonrpc:'2.0',id,result}),{headers:{'content-type':'application/json'}})
globalThis.fetch=async(input,init)=>{
 const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url)
 if(url.origin!==syntheticOrigin){
  if(appOrigin&&url.origin===appOrigin){counts.localAppRequests++;return originalFetch(input,init)}
  counts.blockedNetworkRequests++;throw Error('Fixture blocked an unapproved network request')
 }
 if(url.pathname.startsWith('/api/')){
  counts.syntheticApiRequests++
  return new Response('data: '+JSON.stringify({type:'error',error:{code:prose,type:prose,message:prose,cause:prose,stderr:prose}})+'\n\n',{headers:{'content-type':'text/event-stream'}})
 }
 counts.syntheticMcpRequests++
 if(init?.method==='GET')return new Response(null,{status:405})
 if(init?.method==='DELETE')return new Response(null,{status:200})
 const request=JSON.parse(String(init?.body??'{}'))
 if(url.pathname==='/mcp/init')return new Response(prose,{status:500})
 if(request.method==='initialize')return response(request.id,{protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'M4 synthetic transport',version:'1'}})
 if(request.method==='notifications/initialized')return new Response(null,{status:202})
 if(request.method==='tools/list'){
  if(url.pathname==='/mcp/catalog')return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,error:{code:-32603,message:prose,data:{stderr:prose}}}),{headers:{'content-type':'application/json'}})
  return response(request.id,{tools:[{name:'synthetic_write',description:'No external effect; intercepted local transport only.',inputSchema:{type:'object',properties:{label:{type:'string'}},required:['label'],additionalProperties:false}}]})
 }
 if(request.method==='tools/call'){counts.mcpToolDispatches++;throw Error(prose)}
 throw Error('Unexpected synthetic MCP method')
}
const titles={responses:'Responses stream · local simulation',chat:'Chat stream · local simulation',anthropic:'Anthropic stream · local simulation',init:'Tool setup · local simulation',catalog:'Tool directory · local simulation',unknown:'Tool outcome · local simulation'}
const caseByTitle=new Map(Object.entries(titles).map(([key,title])=>[title,key]))
function ownerFor(request:ModelRequest){
 const ticketId=request.activity?.ticketId!,run=runtime.store.get<Run>('run',ticketId)!
 const owner:WorkOwner={ticketId,assignmentId:run.assignmentId,cwd:request.cwd,sandbox:'read-only',depth:0}
 owners.set(ticketId,owner);return owner
}
const model:Model={
 async history(id,cwd){const adapter=[...apiModels.values()].find(value=>id.startsWith('api:'+value.id+':'));return adapter?adapter.history(id,cwd):{id,turns:[]}},
 async run(request){
  counts.fixtureModelRuns++
  const kind=caseByTitle.get(request.title??'')
  if(request.role!=='worker'||!kind){
   const threadId=request.threadId??'local-router-'+randomUUID();request.onThread?.(threadId)
   return {threadId,turnId:randomUUID(),text:JSON.stringify({reply:'Local failure acceptance fixture.'})}
  }
  ownerFor(request)
  if(['responses','chat','anthropic'].includes(kind)){
   counts.apiAdapterRuns++
   const protocol=kind==='responses'?'openai-responses':kind==='chat'?'openai-chat':'anthropic'
   const definition=backendDefinition.parse({kind:protocol,baseUrl:syntheticOrigin+'/api/'+kind,model:'local-synthetic',requestTimeoutMs:3000}) as ApiDefinition
   let adapter=apiModels.get(kind);if(!adapter){adapter=new ApiModel('m4-'+kind,definition,runtime.store,5000);apiModels.set(kind,adapter)}
   request.onBackend?.(adapter.id)
   return adapter.run({...request,onOutput:request.onOutput??(()=>{})})
  }
  const threadId=request.threadId??'m4-local-tool-'+randomUUID(),turnId=randomUUID();request.onThread?.(threadId);request.onTurn?.(turnId)
  if(kind==='init')await request.onTool!('superagent_tools',{connection:'mcp-init'},'local-init')
  if(kind==='catalog')await request.onTool!('superagent_tool',{...receiptRequest,connection:'mcp-catalog'},'local-catalog')
  if(kind==='unknown'){
   const result=await request.onTool!('superagent_tool',receiptRequest,'local-dispatch')
   if(result.success||!result.contentItems.some(item=>item.text?.includes('uncertain')))throw Error('Expected retained unknown tool outcome')
   return {threadId,turnId,text:JSON.stringify({state:'blocked',summary:'Tool result is unconfirmed. Inspect existing records before repeating work.',reply:'',question:null,askedBy:null,handbacks:[]})}
  }
  throw Error('Expected an actual adapter error')
 }
}
const transport=(path:string)=>({enabled:true,transport:{kind:'http',url:syntheticOrigin+'/mcp/'+path},allowedTools:['synthetic_write'],timeoutMs:3000})
const config=configSchema.parse({stateDir:join(root,'state'),port:0,watchdog:{enabled:false},work:{sandboxDriver:'disabled',network:false,autoRecover:false},execution:{router:{mode:'assessment'},workers:[{id:'local-worker',label:'Local Worker',backend:'codex',toolConnections:['mcp-init','mcp-catalog','mcp-unknown']}]},sources:[{id:'local',kind:'local',cwd:workspace,workspace:{mode:'source'},allowedActors:['operator']}],toolConnections:{'mcp-init':transport('init'),'mcp-catalog':transport('catalog'),'mcp-unknown':transport('unknown')}})
runtime=new Runtime(config,{model})
// Install the existing trace projection before exercising real receipt transitions.
new ExecutionTrace(()=>runtime).snapshot()
for(const [mode,title] of Object.entries(titles)){
 const received=runtime.receive('local','operator',{id:'m4-'+mode,thread:'m4-'+mode,text:'Inspect a synthetic local failure; do not contact any real service or repeat uncertain work.',addressed:true}) as {triggerId:string}
 const decision=runtime.engine.decide(received.triggerId,{kind:'accept',title,scope:'Inspect this bounded synthetic local failure.',reason:'Authorized local acceptance fixture',rules:[]})
 const id=decision.ticketId!;tasks.push({id,title,case:mode})
 const deadline=Date.now()+15000
 while(!['uncertain','idle'].includes(runtime.store.get<Run>('run',id)?.phase??'')){
  await runtime.tick();if(Date.now()>deadline)throw Error('Local task did not settle');await new Promise(done=>setTimeout(done,5))
 }
}
runtime.pause(true)
const host=await serve(runtime,{createRuntime:()=>{throw Error('Runtime replacement is outside this fixture')}})
appOrigin=host.url
const token=readFileSync(host.tokenPath,'utf8').trim(),setup=await fetch(host.url+'/account/setup',{method:'POST',headers:{authorization:'Bearer '+token,origin:host.url,'content-type':'application/json'},body:JSON.stringify({username:'operation-preview',displayName:'Local failure acceptance',password:'Local-'+randomUUID()+'A!',remember:true})})
if(!setup.ok)throw Error('Local fixture account setup failed')
const mode='Actual protected Runtime and API/MCP adapters; synthetic intercepted provider/MCP Responses; no real provider, SDK authentication, fee, or external message'
function evidence(){
 const records=runtime.store.db.prepare('SELECT kind,id,body FROM records ORDER BY kind,id').all(),audit=runtime.store.db.prepare('SELECT seq,body FROM audit ORDER BY seq').all(),jobs=runtime.store.db.prepare('SELECT kind,state,error FROM jobs').all()
 const text=JSON.stringify({records,audit,jobs}),leaks=markers.filter(marker=>text.includes(marker))
 const rows=tasks.map(task=>{const run=runtime.store.get<Run>('run',task.id),ticket=runtime.store.tickets.get(task.id)!;return {...task,phase:run?.phase,error:run?.error??null,threadId:run?.threadId??null,reportSummary:ticket.assignments.at(-1)?.report?.summary??null,receipts:runtime.toolConnections.receipts(task.id).map(({id,state})=>({id,state}))}})
 const retainedThreads=runtime.store.list<any>('backend-thread').map(thread=>({id:thread.id,turns:thread.turns.map((turn:any)=>({status:turn.status,errors:turn.items.filter((item:any)=>item.type==='error').map((item:any)=>item.text)}))}))
 return {mode,counts:{...counts},tasks:rows,retainedThreads,receiptTransitions:audit.map(row=>JSON.parse(String(row.body))).filter(body=>body.type==='execution.trace'&&body.entity==='tool-receipt').map(body=>({id:body.entityId,state:body.state})),leakCount:leaks.length,auditRows:audit.length,recordRows:records.length,realProviderRequests:counts.realProviderRequests}
}
writeFileSync(join(root,'browser.json'),JSON.stringify({base:host.url,url:host.url+'/configure#tasks/history',cookie:setup.headers.get('set-cookie')!.split(';')[0]!,tasks,mode}),{mode:0o600})
let previous='',busy=false,closing=false
const timer=setInterval(()=>{void (async()=>{
 if(busy||closing)return
 const path=join(root,'control.json');if(!existsSync(path))return
 const raw=readFileSync(path,'utf8');if(raw===previous||raw.length>1024)return;previous=raw
 let input:any;try{input=JSON.parse(raw)}catch{return}
 if(typeof input.id!=='string'||!/^[a-f0-9-]{36}$/.test(input.id)||!['stats','same_request'].includes(input.action))return
 busy=true
 try{
  if(input.action==='same_request'){
   const task=tasks.find(item=>item.case==='unknown')!,owner=owners.get(task.id)!,before=counts.mcpToolDispatches
   const result=await runtime.toolConnections.call(owner,receiptRequest);counts.sameRequestChecks++
   if(result.success||counts.mcpToolDispatches!==before||!result.contentItems.some(item=>item.text?.includes('uncertain')))throw Error('Original requestId was not retained')
  }
  const result={id:input.id,result:'ok',...evidence()};writeFileSync(join(root,'runtime-evidence.json'),JSON.stringify(result,null,2),{mode:0o600});writeFileSync(join(root,'control-result.json'),JSON.stringify(result),{mode:0o600})
 }catch{writeFileSync(join(root,'control-failed.json'),'\x7b"result":"fixture_control_failed"}',{mode:0o600})}finally{busy=false}
})()},50)
console.log(JSON.stringify({ready:true,mode}))
async function close(){if(closing)return;closing=true;clearInterval(timer);host.server.closeAllConnections();await new Promise<void>(done=>host.server.close(()=>done()));await host.closeRuntime();globalThis.fetch=originalFetch}
process.once('SIGTERM',()=>void close());process.once('SIGINT',()=>void close())
