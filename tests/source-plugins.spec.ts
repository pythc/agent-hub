import {mkdtempSync,readFileSync,writeFileSync,rmSync,existsSync} from 'node:fs'
import {join,relative} from 'node:path'
import {fileURLToPath} from 'node:url'
import {tmpdir} from 'node:os'
import {createServer,type Server} from 'node:http'
import {spawn} from 'node:child_process'
import {it,expect,afterEach} from 'vitest'
import {Runtime} from '../src/runtime.ts'
import {SourceRegistry} from '../src/source-plugins.ts'
import {MessageSource} from '../src/sources.ts'
import {configSchema,loadConfig,type Config} from '../src/config.ts'
import {serve} from '../src/server.ts'
import type {Model,ModelRequest} from '../src/model.ts'
import {GithubSource} from '../src/connectors/github.ts'
import {FeishuSource} from '../src/connectors/feishu.ts'
const roots:string[]=[],hosts:Runtime[]=[],servers:Server[]=[]
const plugin=fileURLToPath(new URL('../examples/plugins/team-events.ts',import.meta.url))
afterEach(async()=>{for(const server of servers.splice(0)){server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()))}for(const h of hosts.splice(0))await h.close();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});delete process.env.AGENTHUB_EVENT_FIXTURE_TOKEN})
function configuration(extra:Record<string,unknown>={}){
 const root=mkdtempSync(join(tmpdir(),'source-plugin-'));roots.push(root)
 return configSchema.parse({stateDir:join(root,'state'),port:0,work:{sandboxDriver:'disabled'},sources:[{id:'local',kind:'local',cwd:root,allowedActors:['alice']},{id:'team',kind:'team-events',cwd:root,allowedActors:['alice'],options:{tenant:'acme'},tokenEnv:'AGENTHUB_EVENT_FIXTURE_TOKEN',workspace:{mode:'source'}}],sourcePlugins:[{module:plugin}],...extra})
}
const quiet:Model={async run(){throw Error('No model execution expected')}}
async function host(config=configuration(),model=quiet){const h=await Runtime.create(config,{model});hosts.push(h);return h}
async function endpoint(h:Runtime){process.env.AGENTHUB_EVENT_FIXTURE_TOKEN='fixture-connector-token';const http=await serve(h);servers.push(http.server);return {http,headers:{'content-type':'application/json',authorization:'Bearer fixture-connector-token'},operator:{'content-type':'application/json',authorization:'Bearer '+readFileSync(http.tokenPath,'utf8').trim()}}}
const event={id:'one',thread:'acme/topic',text:'Review this work',addressed:true,scope:'engineering',message:{id:'original-message',url:'https://example.test/thread'},attachments:[{id:'file-1',name:'requirements.txt',mimeType:'text/plain'}]}
async function ticks(h:Runtime,done:()=>boolean){for(let i=0;i<400;i++){await h.tick();await new Promise(r=>setTimeout(r,3));if(done())return}throw Error('Contract did not settle: '+JSON.stringify({tickets:h.status().tickets.map(t=>({id:t.id,ended:t.ended,run:t.run})),routerErrors:h.status().routerErrors,deliveries:h.status().deliveries}))}

it('loads an adapter from config alone, resolves file paths and exposes inventory',async()=>{
 const c=configuration(),path=join(roots.at(-1)!,'config.json')
 writeFileSync(path,JSON.stringify({...c,sourcePlugins:[{module:relative(roots.at(-1)!,plugin)}]}))
 const h=await host(loadConfig(path));h.pause(true)
 const e=await endpoint(h),inventory=await fetch(e.http.url+'/integrations',{headers:e.operator}).then(r=>r.json()) as any
 expect(inventory.adapters).toContainEqual({kind:'team-events',label:'Team events (example)',apiVersion:1})
 expect(h.sources.get('team')!.trigger(event,'alice').meta.tenant).toBe('acme')
 expect(()=>h.receive('team','alice',{...event,thread:'another-org/topic'})).toThrow('outside')
})

it('starts and stops the actual CLI with an external adapter and releases its lock',async()=>{
 const c=configuration(),path=join(roots.at(-1)!,'cli.json');writeFileSync(path,JSON.stringify(c))
 const child=spawn(process.execPath,['--import',fileURLToPath(new URL('../node_modules/tsx/dist/loader.mjs',import.meta.url)),fileURLToPath(new URL('../src/cli.ts',import.meta.url)),'serve',path],{stdio:['ignore','pipe','pipe']})
 const exited=new Promise<number|null>(resolve=>child.once('exit',resolve));let stdout='',stderr=''
 child.stderr.on('data',chunk=>{stderr+=chunk})
 try{
  const info=await new Promise<any>((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('CLI startup timeout: '+stderr.slice(-1000))),5000)
   child.once('error',e=>{clearTimeout(timer);reject(e)})
   child.stdout.on('data',chunk=>{stdout+=chunk;const line=stdout.split('\n').find(s=>s.startsWith('{'));if(line)try{const info=JSON.parse(line);clearTimeout(timer);resolve(info)}catch{}})
  })
  const inventory=await fetch(new URL(info.url).origin+'/integrations',{headers:{authorization:'Bearer '+readFileSync(info.tokenFile,'utf8').trim()}}).then(r=>r.json()) as any
  expect(inventory.sources).toContainEqual(expect.objectContaining({id:'team',kind:'team-events'}))
 }finally{child.kill('SIGTERM');await exited}
 expect(existsSync(join(c.stateDir,'host.lock'))).toBe(false)
})

it('upgrades saved pre-plugin configuration without changing existing admission or connections',async()=>{
 const c=configuration({sourcePlugins:[],sources:[{id:'local',kind:'local',cwd:'.',allowedActors:['alice']}]}),h=await host(c)
 const old=structuredClone(h.settings.current()) as any;delete old.config.sourcePlugins;delete old.config.toolConnections
 for(const source of old.config.sources){delete source.options;delete source.capabilities}
 h.store.put('settings','current',old);hosts.splice(hosts.indexOf(h),1);await h.close()
 const restored=await host(c)
 expect(restored.config.sources[0]!.allowedActors).toEqual(['alice'])
 expect(restored.config.sources[0]!.capabilities).toEqual({events:true,replies:true,resources:true})
 expect(restored.config.toolConnections).toEqual({})
})

it('rejects unknown, duplicate and invalid plugins without leaking the state lock',async()=>{
 const registry=new SourceRegistry()
 expect(()=>registry.register({apiVersion:1,kind:'github',label:'Duplicate',create:c=>new MessageSource(c)})).toThrow('Duplicate')
 const unknown=configuration({sourcePlugins:[]});expect(()=>new Runtime(unknown,{model:quiet})).toThrow('Unknown source kind')
 expect(existsSync(join(unknown.stateDir,'host.lock'))).toBe(false)
 const invalid=configuration();invalid.sources[1]!.options={}
 await expect(Runtime.create(invalid,{model:quiet})).rejects.toThrow('options.tenant')
 expect(existsSync(join(invalid.stateDir,'host.lock'))).toBe(false)
 invalid.sources[1]!.options={tenant:'acme'};await host(invalid)
})

it('keeps connector identity, scope, original references and replay identity across restart',async()=>{
 const c=configuration(),h=await host(c);h.pause(true);const e=await endpoint(h)
 const post=(body:any,headers=e.headers)=>fetch(e.http.url+'/events/team',{method:'POST',headers,body:JSON.stringify(body)})
 expect((await post({actor:'alice',human:true,event},e.operator)).status).toBe(401)
 expect((await post({actor:'alice',human:true,event})).status).toBe(202)
 const saved=h.store.triggers.get('team:one')!
 expect(saved).toMatchObject({source:'team',actor:{source:'team',id:'alice'},human:true,meta:{scope:'engineering',message:event.message,attachments:event.attachments,tenant:'acme'},channel:{source:'team',thread:'acme/topic',address:{messageId:'original-message'}}})
 expect((await (await post({actor:'alice',human:true,event})).json() as any).disposition).toBe('duplicate')
 expect(h.store.triggers.get('team:one')!.at).toBe(saved.at)
 for(const change of [{human:false},{actor:'bob'},{event:{...event,scope:'finance'}},{event:{...event,message:{id:'other'}}},{event:{...event,attachments:[]}}])expect((await post({actor:'alice',human:true,event,...change})).status).toBe(400)
 servers.splice(servers.indexOf(e.http.server),1);e.http.server.closeAllConnections();await new Promise<void>(r=>e.http.server.close(()=>r()));hosts.splice(hosts.indexOf(h),1);await h.close()
 const restored=await host(c)
 expect(restored.receive('team','alice',event)).toMatchObject({disposition:'duplicate',triggerId:'team:one'})
 expect(restored.store.triggers.get('team:one')!.at).toBe(saved.at)
})

it('separates event reception, reply delivery and resource access',async()=>{
 const c=configuration(),h=await host(c),source=h.sources.get('team')!;h.pause(true)
 source.read=async()=>({text:'read without event monitoring'})
 source.config.capabilities.events=false
 expect(()=>h.receive('team','alice',event)).toThrow('disabled')
 expect((await h.resources.read({resource:'source/team/document'})).text).toContain('read without event monitoring')
 source.config.capabilities.resources=false
 await expect(h.resources.read({resource:'source/team/document'})).rejects.toThrow('enabled resource')
 source.config.capabilities.events=true;source.config.capabilities.replies=false
 let delivered=0;source.deliver=async()=>{delivered++}
 h.store.outbox.send({id:'reply',kind:'reply',text:'Result',channel:{source:'team',thread:'acme/topic',address:{}}})
 h.pause(false);await h.flush();expect(delivered).toBe(0);expect(h.store.deliveries()[0]!.status).toBe('pending')
 source.config.capabilities.replies=true;await h.flush();expect(delivered).toBe(1)
})

it('does not silently apply deployment changes and preserves legacy replay semantics in adapters',async()=>{
 const c=configuration(),h=await host(c)
 expect(()=>h.updateSettings(0,{sources:c.sources.map(s=>s.id==='team'?{...s,options:{tenant:'different'}}:s)})).toThrow('restart')
 expect(()=>h.updateSettings(0,{sources:c.sources.map(s=>s.id==='team'?{...s,capabilities:{...s.capabilities,events:false}}:s)})).toThrow('restart')
 const e=await endpoint(h),response=await fetch(e.http.url+'/source-replay',{method:'POST',headers:e.operator,body:JSON.stringify({source:'team',since:'2026-01-01T00:00:00Z'})})
 expect(response.status).toBe(400);expect(await response.text()).toContain('does not support')
 const source=(value:any)=>configSchema.parse({sources:[{id:'source',cwd:'.',...value}]}).sources[0]!
 expect(new GithubSource(source({kind:'github',repository:'org/repo'})).replay(undefined,'2026-01-01T00:00:00Z')).toEqual({key:'source',since:'2026-01-01T00:00:00Z'})
 const feishu=new FeishuSource(source({kind:'feishu',feishu:{cli:'fixture',chats:['chat']}}))
 expect(feishu.replay('chat','2026-01-01T00:00:00Z')).toEqual({key:'source:chat',since:String(Date.parse('2026-01-01T00:00:00Z')/1000)})
 expect(()=>feishu.replay('unlisted','2026-01-01T00:00:00Z')).toThrow('not configured')
})

it('retains uncertain callback delivery across restart without automatically resending',async()=>{
 let received=0;const callback=createServer(async(req,res)=>{for await(const _ of req){}received++;res.destroy()});servers.push(callback)
 await new Promise<void>(r=>callback.listen(0,'127.0.0.1',r))
 const c=configuration();c.sources[1]!.replyUrl='http://127.0.0.1:'+(callback.address() as any).port
 const h=await host(c);h.store.outbox.send({id:'lost-reply',kind:'reply',text:'Result',channel:{source:'team',thread:'acme/topic',address:{messageId:'original'}}})
 await h.flush();expect(received).toBe(1);expect(h.store.deliveries()[0]!.status).toBe('uncertain')
 hosts.splice(hosts.indexOf(h),1);await h.close()
 const restored=await host(c);await restored.flush();expect(received).toBe(1);expect(restored.store.deliveries()[0]!.status).toBe('uncertain')
})

it('starts push-only plugins, awaits startup failures and fences their event source',async()=>{
 const c=configuration({sourcePlugins:[]}),registry=new SourceRegistry();let starts=0
 class Push extends MessageSource {async start(ctx:any){starts++;await Promise.resolve();ctx.receive({...this.trigger(event,'alice'),source:'local'})}}
 registry.register({apiVersion:1,kind:'team-events',label:'Push fixture',create:c=>new Push(c)})
 const h=new Runtime(c,{model:quiet,sourceRegistry:registry});hosts.push(h);h.pause(true)
 await h.pollSources();for(let n=0;n<100&&!h.store.get('source-health','team');n++)await new Promise(r=>setTimeout(r,2))
 expect(starts).toBe(1);expect(h.store.get<any>('source-health','team')?.error).toContain('outside its configured source')
 expect(h.store.list('trigger')).toHaveLength(0)
})

it('aborts a push-only source lifetime after its startup poll has already finished',async()=>{
 const c=configuration({sourcePlugins:[]}),registry=new SourceRegistry();let stopped=0
 class Push extends MessageSource {start(ctx:any){ctx.signal.addEventListener('abort',()=>{stopped++},{once:true})}}
 registry.register({apiVersion:1,kind:'team-events',label:'Push lifecycle fixture',create:c=>new Push(c)})
 const h=new Runtime(c,{model:quiet,sourceRegistry:registry});hosts.push(h);h.pause(true)
 await h.pollSources();for(let n=0;n<100&&!h.store.get('source-health','team');n++)await new Promise(r=>setTimeout(r,2))
 expect(h.store.get<any>('source-health','team')?.status).toBe('ok')
 hosts.splice(hosts.indexOf(h),1);await h.close();expect(stopped).toBe(1)
})

it('routes a plugin conversation through one Router and four Workers with actual MCP execution and retained follow-up',async()=>{
 const delivered:any[]=[],requests:ModelRequest[]=[],callback=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;delivered.push(JSON.parse(body));res.end('{}')});servers.push(callback)
 await new Promise<void>(r=>callback.listen(0,'127.0.0.1',r))
 const c=configuration({execution:{router:{mode:'host',model:'terra',effort:'medium'},management:{enabled:true},workers:Array.from({length:4},(_,i)=>({id:'worker-'+i,backend:'codex',model:'sol',effort:'high',toolConnections:['docs']}))}})
 const log=join(roots.at(-1)!,'calls.jsonl');c.sources[1]!.replyUrl='http://127.0.0.1:'+(callback.address() as any).port
 c.toolConnections={docs:{enabled:true,transport:{kind:'stdio',command:process.execPath,args:[fileURLToPath(new URL('./fixtures/mcp-tool-server.mjs',import.meta.url)),log],env:{}},allowedTools:['echo'],timeoutMs:2000}}
 let h:Runtime
 const model:Model={async run(r){requests.push(r);const threadId=r.threadId??'thread-'+requests.length;r.onThread?.(threadId);const turnId='turn-'+requests.length,data=JSON.parse(r.input)
  if(r.role==='router'){
   if(data.kind==='user_message'){
    if(data.trigger.text==='Continue')await r.onTool!('worker_manage',{action:'send',revision:0,requestId:'followup',ticketId:h.store.tickets.list()[0]!.id,text:'Check again'},'followup')
    else for(let i=0;i<4;i++)await r.onTool!('worker_manage',{action:'assign',revision:0,requestId:'task-'+i,id:'worker-'+i,text:'Read evidence '+i},'assign-'+i)
   }
   return {threadId,turnId,text:JSON.stringify({reply:data.kind==='worker_result'?'Router summary: evidence reviewed':''})}
  }
  const result=await r.onTool!('superagent_tool',{connection:'docs',tool:'echo',arguments:{text:'evidence'},requestId:r.threadId?'second-read':'first-read'},'tool')
  expect(result.success).toBe(true)
  return {threadId,turnId,text:JSON.stringify({state:'ready',summary:'Evidence read',reply:'PRIVATE WORKER RESULT',question:null,handbacks:[]})}
 }}
 h=await host(c,model);const e=await endpoint(h)
 const submit=(id:string,text:string)=>fetch(e.http.url+'/events/team',{method:'POST',headers:e.headers,body:JSON.stringify({actor:'alice',human:true,event:{...event,id,text}})})
 expect((await submit('start','Start')).status).toBe(202)
 await ticks(h,()=>h.store.tickets.list().length===4&&h.store.tickets.list().every(t=>!!t.ended)&&delivered.length>0&&h.status().active===0&&!h.store.jobs().some(j=>j.kind==='router'))
 const first=new Map<string,ModelRequest[]>();for(const r of requests.filter(r=>r.role==='worker'))first.set(r.activity!.ticketId!,[...(first.get(r.activity!.ticketId!)??[]),r])
 expect(first.size).toBe(4);expect(h.store.list('router-inbox')).toHaveLength(4)
 expect((await submit('next','Continue')).status).toBe(202)
 await ticks(h,()=>requests.filter(r=>r.role==='worker').length===5&&h.store.list('router-inbox').length===5&&h.status().active===0&&!h.store.jobs().some(j=>j.kind==='router'))
 const workers=requests.filter(r=>r.role==='worker'),last=workers.at(-1)!,previous=first.get(last.activity!.ticketId!)![0]!
 expect(last.threadId).toBe('thread-'+(requests.indexOf(previous)+1))
 expect(workers.slice(0,4).every(r=>r.model==='sol'&&r.options?.effort==='high')).toBe(true);expect(last.options?.effort).toBe('high');expect(last.model).toBeUndefined()
 expect(c.execution.router?.model).toBe('terra');expect(requests.filter(r=>r.role==='router').every(r=>r.options?.effort==='medium')).toBe(true)
 expect(new Set(h.store.list<any>('router-session').map(s=>s.threadId)).size).toBe(1)
 expect(delivered.every(d=>d.text==='Router summary: evidence reviewed'&&!d.channel.address.routerInbox)).toBe(true)
 expect(readFileSync(log,'utf8').trim().split('\n')).toHaveLength(5)
 const count=requests.length;expect((await (await submit('next','Continue')).json() as any).disposition).toBe('duplicate');await h.tick();expect(requests).toHaveLength(count)
})

it('routes all delegated pending messages internally, retaining uncertainty on older external sends',async()=>{
 const c=configuration({execution:{router:{mode:'client'},management:{enabled:true},workers:[{id:'one',backend:'codex'}]}}),h=await host(c)
 const assigned=await h.manager.call({action:'assign',revision:0,requestId:'task',id:'one',discussion:'operator-session',text:'Work'})
 const external={source:'team',thread:'acme/topic',address:{messageId:'original'}}
 for(const kind of ['reply','acknowledgement','notice'] as const)h.store.outbox.send({id:kind,ticketId:assigned.ticketId,kind,text:'Worker output',channel:external})
 h.store.outbox.send({id:'previous-uncertain',ticketId:assigned.ticketId,kind:'reply',text:'Unknown outcome',channel:external})
 h.store.deliveryFailed('previous-uncertain',1,'Unknown external outcome',true)
 await h.flush()
 expect(h.store.list('router-inbox')).toHaveLength(3)
 for(const d of h.store.deliveries().filter(d=>d.id!=='previous-uncertain'))expect(d).toMatchObject({status:'sent',channel:{source:'local',address:{routerInbox:'operator-session'}}})
 expect(h.store.deliveries().find(d=>d.id==='previous-uncertain')).toMatchObject({status:'uncertain',channel:external})
})
