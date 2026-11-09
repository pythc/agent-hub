import {mkdtempSync,readFileSync,rmSync,existsSync} from 'node:fs'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {tmpdir} from 'node:os'
import {createServer} from 'node:http'
import {Server} from '@modelcontextprotocol/sdk/server/index.js'
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {ListToolsRequestSchema,CallToolRequestSchema} from '@modelcontextprotocol/sdk/types.js'
import {it,expect,afterEach} from 'vitest'
import {Runtime} from '../src/runtime.ts'
import {configSchema,type Config} from '../src/config.ts'
import type {Model} from '../src/model.ts'
import type {WorkOwner} from '../src/work.ts'
import {backupState,restoreState} from '../src/backup.ts'

const roots:string[]=[],hosts:Runtime[]=[],closers:(()=>Promise<void>)[]=[]
afterEach(async()=>{for(const host of hosts.splice(0))await host.close();for(const close of closers.splice(0))await close();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true})})
const waiting:Model={async run(r){const threadId=r.threadId??'fixture-thread';r.onThread?.(threadId);return {threadId,turnId:'fixture-turn',text:JSON.stringify(r.ephemeral?{action:'accept',title:'Read',scope:'Use granted tools',reason:'requested',rules:[]}:{state:'waiting',summary:'Waiting',reply:'',question:null,handbacks:[]})}}}
async function fixture(override:Partial<Config>={}){
  const root=mkdtempSync(join(tmpdir(),'mcp-consumer-'));roots.push(root);const log=join(root,'calls.jsonl')
  const config=configSchema.parse({stateDir:join(root,'state'),work:{sandboxDriver:'disabled'},sources:[{id:'local',kind:'local',cwd:root,allowedActors:['alice'],workspace:{mode:'source'}}],execution:{workers:[{id:'one',backend:'codex',toolConnections:['docs']}]},toolConnections:{docs:{transport:{kind:'stdio',command:process.execPath,args:[fileURLToPath(new URL('./fixtures/mcp-tool-server.mjs',import.meta.url)),log]},allowedTools:['echo','write','crash','hang','fail','image','constrained'],timeoutMs:1500}},...override})
  const host=new Runtime(config,{model:waiting});hosts.push(host)
  host.receive('local','alice',{id:'one',thread:'topic',text:'Use the tools',addressed:true})
  for(let i=0;i<200;i++){await host.tick();await new Promise(r=>setTimeout(r,2));if(host.status().tickets[0]?.run?.phase==='idle')break}
  const ticket=host.store.tickets.list()[0]!,owner:WorkOwner={ticketId:ticket.id,assignmentId:ticket.assignments.at(-1)!.id,cwd:root,sandbox:'read-only',depth:0}
  expect(host.validWork(owner)).toBe(true)
  const calls=()=>existsSync(log)?readFileSync(log,'utf8').trim().split('\n').map(x=>JSON.parse(x)):[]
  return {host,root,config,owner,calls}
}
const input=(tool='echo',requestId=tool)=>({connection:'docs',tool,arguments:{text:'actual tool output'},requestId})

it('rejects an older backup after an MCP write and retains deduplication after restart',async()=>{
 const f=await fixture(),backup=join(f.root,'backup'),operation=input('write','stable-write')
 await backupState(f.config,backup)
 const result=await f.host.workerTools.call(f.owner,'superagent_tool',operation)
 expect(result.success).toBe(true);expect(f.calls()).toHaveLength(1)
 hosts.splice(hosts.indexOf(f.host),1);await f.host.close()
 await expect(restoreState(f.config,backup)).rejects.toThrow('External tool or merge effects advanced')
 const restored=new Runtime(f.config,{model:waiting});hosts.push(restored)
 expect(await restored.workerTools.call(f.owner,'superagent_tool',operation)).toEqual(result)
 expect(f.calls()).toHaveLength(1);expect(restored.toolConnections.receipts(f.owner.ticketId)).toHaveLength(1)
})

it('discovers real stdio tools, validates arguments, preserves structured/image/error results and fences grants',async()=>{
  const {host,owner,calls}=await fixture()
  const list=await host.workerTools.call(owner,'superagent_tools',{})
  expect(list.contentItems[0]!.text).toContain('echo');expect(list.contentItems[0]!.text).not.toContain('hidden')
  const output=await host.workerTools.call(owner,'superagent_tool',input())
  expect(output).toMatchObject({success:true,contentItems:[{type:'inputText',text:'actual tool output'},{type:'inputText',text:JSON.stringify({structuredContent:{text:'actual tool output'}})}]})
  expect((await host.workerTools.call(owner,'superagent_tool',input('image'))).contentItems[0]!.type).toBe('inputImage')
  expect((await host.workerTools.call(owner,'superagent_tool',input('fail'))).success).toBe(false)
  await expect(host.workerTools.call(owner,'superagent_tool',{...input('write'),arguments:{text:3}})).rejects.toThrow('Invalid tool arguments')
  await expect(host.workerTools.call(owner,'superagent_tool',{...input('constrained'),arguments:{text:'valid',extra:'reject under draft 2020-12'}})).rejects.toThrow('Invalid tool arguments')
  await expect(host.workerTools.call(owner,'superagent_tool',input('hidden'))).rejects.toThrow('not allowed')
  const run=host.store.get<any>('run',owner.ticketId);host.store.put('run',owner.ticketId,{...run,agentOptions:{...run.agentOptions,toolConnections:[]}})
  await expect(host.workerTools.call(owner,'superagent_tool',input('write'))).rejects.toThrow('not enabled')
  expect(calls().map(c=>c.name)).toEqual(['echo','image','fail'])
})

it('rejects unknown connections and explicit Router execution grants instead of accepting unused settings',async()=>{
  const {host}=await fixture()
  expect(()=>host.updateSettings(0,{execution:{...host.config.execution,workers:[{id:'one',backend:'codex',toolConnections:['missing']}]}})).toThrow('Unknown tool connection')
  expect(()=>host.updateSettings(0,{execution:{...host.config.execution,router:{mode:'host',toolConnections:['docs']}}})).toThrow('executed by Workers')
  expect(host.settings.current().revision).toBe(0)
})

it('deduplicates concurrent and restarted calls and rejects request identity reuse',async()=>{
  const f=await fixture(),operation=input('write','stable')
  const [a,b]=await Promise.all([f.host.workerTools.call(f.owner,'superagent_tool',operation),f.host.workerTools.call(f.owner,'superagent_tool',operation)])
  expect(a).toEqual(b);expect(f.calls()).toHaveLength(1)
  await expect(f.host.workerTools.call(f.owner,'superagent_tool',{...operation,arguments:{text:'different'}})).rejects.toThrow('reused')
  hosts.splice(hosts.indexOf(f.host),1);await f.host.close()
  const restored=new Runtime(f.config,{model:waiting});hosts.push(restored)
  expect(await restored.workerTools.call(f.owner,'superagent_tool',operation)).toEqual(a)
  expect(f.calls()).toHaveLength(1)
})

it('never replays a write after disconnect, including restart, and reconnects for a distinct operation',async()=>{
  const f=await fixture(),operation=input('crash','lost-reply')
  const unknown=await f.host.workerTools.call(f.owner,'superagent_tool',operation)
  expect(unknown.success).toBe(false);expect(unknown.contentItems[0]!.text).toContain('uncertain')
  const receipts=await f.host.resources.read({resource:'tool-calls'},f.owner)
  expect(receipts.items[0]).toMatchObject({state:'uncertain',connection:'docs',tool:'crash'})
  expect((await f.host.resources.read({resource:receipts.items[0].resource},f.owner)).text).toContain('uncertain')
  await expect(f.host.resources.read({resource:receipts.items[0].resource},{ticketId:'another-task'})).rejects.toThrow('outside')
  expect(await f.host.workerTools.call(f.owner,'superagent_tool',operation)).toEqual(unknown)
  hosts.splice(hosts.indexOf(f.host),1);await f.host.close()
  const restored=new Runtime(f.config,{model:waiting});hosts.push(restored)
  expect(await restored.workerTools.call(f.owner,'superagent_tool',operation)).toEqual(unknown)
  expect((await restored.workerTools.call(f.owner,'superagent_tool',input('echo','read-after-disconnect'))).success).toBe(true)
  expect(f.calls().map(c=>c.name)).toEqual(['crash','echo'])
})

it('bounds tool deadlines and does not retry an uncertain timed-out call',async()=>{
  const f=await fixture();await f.host.workerTools.call(f.owner,'superagent_tools',{})
  f.config.toolConnections.docs!.timeoutMs=100
  const operation=input('hang','timeout'),result=await f.host.workerTools.call(f.owner,'superagent_tool',operation)
  expect(result.success).toBe(false);expect(result.contentItems[0]?.text).toContain('uncertain')
  expect(await f.host.workerTools.call(f.owner,'superagent_tool',operation)).toEqual(result)
  expect(f.calls()).toHaveLength(1)
})

it('cancels in-flight tools with the assignment and recovers unfinished receipts conservatively',async()=>{
  const f=await fixture(),operation=input('hang')
  const pending=f.host.workerTools.call(f.owner,'superagent_tool',operation)
  for(let n=0;n<200&&!f.calls().length;n++)await new Promise(r=>setTimeout(r,5))
  expect(f.calls()).toHaveLength(1)
  await f.host.stop(f.owner.ticketId)
  expect((await pending).success).toBe(false)
  await expect(f.host.workerTools.call(f.owner,'superagent_tool',operation)).rejects.toThrow('ended')
  f.host.store.put('tool-receipt','interrupted',{id:'interrupted',ticketId:f.owner.ticketId,connection:'docs',tool:'write',fingerprint:'x',state:'running'})
  hosts.splice(hosts.indexOf(f.host),1);await f.host.close()
  const restored=new Runtime(f.config,{model:waiting});hosts.push(restored)
  expect(restored.store.get<any>('tool-receipt','interrupted')?.state).toBe('uncertain')
  expect(f.calls()).toHaveLength(1)
})

it('uses the Streamable HTTP protocol and configured credential references',async()=>{
  const seen:string[]=[],instances:Server[]=[]
  const http=createServer(async(req,res)=>{
    seen.push(String(req.headers.authorization))
    const mcp=new Server({name:'http-tools',version:'1'},{capabilities:{tools:{}}});instances.push(mcp)
    mcp.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[{name:'echo',inputSchema:{type:'object',properties:{text:{type:'string'}}}}]}))
    mcp.setRequestHandler(CallToolRequestSchema,async r=>({content:[{type:'text',text:'HTTP '+r.params.arguments!.text}]}))
    const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true})
    await mcp.connect(transport);await transport.handleRequest(req,res)
    res.on('close',()=>{void mcp.close()})
  })
  await new Promise<void>(r=>http.listen(0,'127.0.0.1',r))
  process.env.AGENTHUB_MCP_FIXTURE_AUTH='Bearer fixture-only'
  closers.push(async()=>{delete process.env.AGENTHUB_MCP_FIXTURE_AUTH;await Promise.allSettled(instances.map(s=>s.close()));http.closeAllConnections();await new Promise<void>(r=>http.close(()=>r()))})
  const f=await fixture({toolConnections:{docs:{enabled:true,transport:{kind:'http',url:'http://127.0.0.1:'+(http.address() as any).port,headerEnv:{Authorization:'AGENTHUB_MCP_FIXTURE_AUTH'}},allowedTools:['echo'],timeoutMs:1500}}})
  expect((await f.host.workerTools.call(f.owner,'superagent_tool',input())).contentItems[0]?.text).toBe('HTTP actual tool output')
  expect(seen.length).toBeGreaterThan(2);expect(new Set(seen)).toEqual(new Set(['Bearer fixture-only']))
})
