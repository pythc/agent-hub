/** Isolated real host + local MCP fixture. No external model/provider is called. */
import {mkdirSync,writeFileSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
import {serve} from '../src/server.ts'
import type {Model} from '../src/model.ts'
import type {WorkOwner} from '../src/work.ts'

const root=resolve(process.argv[2]||'.local/frontend-integrated-preview')
mkdirSync(root,{recursive:true})
const model:Model={async run(request){
  const threadId=request.threadId??'ui-fixture-thread';request.onThread?.(threadId)
  request.onConfiguration?.({requested:request.options??{},sent:{model:'local-test-model',fixture:true,largeValue:'paginated receipt '.repeat(600)}})
  return {threadId,turnId:'ui-fixture-turn',text:JSON.stringify(request.ephemeral?{action:'accept',title:'Local MCP acceptance',scope:'Read fixture output',reason:'Integration verification',rules:[]}:{state:'waiting',summary:'Local fixture ready',reply:'',question:null,handbacks:[]})}
}}
const config=configSchema.parse({stateDir:join(root,'state'),port:Number(process.argv[3]||0),codex:'/not-installed/ui-fixture-only',work:{sandboxDriver:'disabled',network:false},
  sourcePlugins:[{module:fileURLToPath(new URL('./plugins/team-events.ts',import.meta.url))}],
  sources:[{id:'local',kind:'local',cwd:root,allowedActors:['operator'],workspace:{mode:'source'}},{id:'team',kind:'team-events',cwd:root,allowedActors:['operator'],options:{tenant:'demo'},capabilities:{events:true,replies:false,resources:false}}],
  execution:{management:{enabled:true,maxWorkers:10},workers:[{id:'worker-1',label:'Research',backend:'codex',toolConnections:['docs']},{id:'worker-2',label:'Review',backend:'codex',toolConnections:[]}]},
  backends:{claude:{kind:'anthropic',baseUrl:'http://127.0.0.1:9/v1',model:'fixture-claude'}},
  toolConnections:{docs:{label:'Local MCP fixture',transport:{kind:'stdio',command:process.execPath,args:[fileURLToPath(new URL('../tests/fixtures/mcp-tool-server.mjs',import.meta.url)),join(root,'mcp-calls.jsonl')]},allowedTools:['echo'],timeoutMs:2000},disabled:{enabled:false,label:'Disabled fixture',transport:{kind:'http',url:'http://127.0.0.1:9/mcp'},allowedTools:['echo']}}
})
const runtime=await Runtime.create(config,{model})
if(!runtime.store.tickets.list().length){
  runtime.receive('local','operator',{id:'integration-check',thread:'integration-check',text:'Read fixture output',addressed:true})
  for(let i=0;i<200;i++){await runtime.tick();await new Promise(done=>setTimeout(done,5));if(runtime.status().tickets[0]?.run?.phase==='idle')break}
  const ticket=runtime.store.tickets.list()[0]
  if(!ticket)throw Error('Fixture task was not created')
  const owner:WorkOwner={ticketId:ticket.id,assignmentId:ticket.assignments.at(-1)!.id,cwd:root,sandbox:'read-only',depth:0}
  const result=await runtime.workerTools.call(owner,'superagent_tool',{connection:'docs',tool:'echo',arguments:{text:'Local MCP integration verified'},requestId:'frontend-acceptance'})
  if(!result.success)throw Error('Local MCP fixture failed')
}
runtime.pause(true)
const server=await serve(runtime),info=join(root,'browser.json')
writeFileSync(info,JSON.stringify({url:server.operatorUrl,base:server.url}),{mode:0o600})
console.log(JSON.stringify({url:server.url,info,fixture:'real host; local MCP; synthetic model; paused'}))
process.once('SIGTERM',()=>{server.server.close();void server.closeRuntime()})
