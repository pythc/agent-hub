import {it,expect,afterEach} from 'vitest'
import {createServer,type Server} from 'node:http'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'
import {LinearSource} from '../plugins/linear/index.ts'
import {configSchema} from '../src/config.ts'
import {Store} from '../src/store.ts'
import {bodyDigest,UncertainDelivery,type SourceContext} from '../src/sources.ts'
import {buildPluginPackage,activatePluginPackages} from '../src/plugin-package.ts'
import {SourceRegistry} from '../src/source-plugins.ts'
import type {ProcessSource} from '../src/plugin-process.ts'
import type {Trigger} from '../plugins/sdk.ts'
const id=(n:number)=>'00000000-0000-4000-a000-'+String(n).padStart(12,'0')
const team=id(1),workspace=id(2),actor=id(3),app=id(4),issueId=id(5),commentId=id(6)
const at='2026-11-08T00:00:00.000Z',human={id:actor,name:'Human',app:false,active:true},bot={id:app,name:'AgentHub',app:true,active:true}
const issue=()=>({id:issueId,identifier:'TEST-1',title:'/agent evaluate this task',description:'Acceptance criteria stay fixed.',createdAt:at,updatedAt:at,archivedAt:null,trashed:false,team:{id:team},creator:human,botActor:null,state:{id:id(8),name:'Todo',type:'unstarted'},project:null,url:'https://linear.app/test/issue/TEST-1'})
const comment=()=>({id:commentId,body:'/agent continue the task',createdAt:at,updatedAt:at,editedAt:null,archivedAt:null,user:human,botActor:null,parent:null,issue:issue(),url:'https://linear.app/test/issue/TEST-1#comment'})
const page=(nodes:any[],next:string|null=null)=>({nodes,pageInfo:{hasNextPage:!!next,endCursor:next}})
const roots:string[]=[],stores:Store[]=[],servers:Server[]=[],sources:ProcessSource[]=[]
afterEach(async()=>{for(const s of sources.splice(0))await s.close();for(const s of servers.splice(0)){s.closeAllConnections();await new Promise<void>(r=>s.close(()=>r()))}for(const s of stores.splice(0))if(s.db.isOpen)s.close();for(const p of roots.splice(0))rmSync(p,{recursive:true,force:true});delete process.env.AGENTHUB_LINEAR_TEST_TOKEN})
function fixture(override:(op:string,v:any)=>any=()=>undefined){
  const root=mkdtempSync(join(tmpdir(),'linear-plugin-'));roots.push(root)
  const config=configSchema.parse({stateDir:root,sources:[{id:'linear',kind:'linear',cwd:root,options:{teams:[team],workspaceId:workspace,issueIds:[issueId],tokenEnv:'AGENTHUB_LINEAR_TEST_TOKEN',command:'/agent'}}]}).sources[0]!
  const store=new Store(join(root,'state.sqlite'));stores.push(store);const events:Trigger[]=[],changes:any[]=[],calls:{op:string;v:any}[]=[]
  const ctx:SourceContext={store,receive(t){events.push(t);store.triggers.save(t)},change(e){changes.push(e)},bind(){throw Error('No task binding allowed')},closed(){throw Error('No task completion allowed')}}
  const api=async(query:string,v:any={})=>{const op=query.match(/(?:query|mutation)\s+(\w+)/)?.[1]??'';calls.push({op,v});const value=await override(op,v);if(value!==undefined)return value
    if(op==='AgentHubIdentity')return {viewer:bot,organization:{id:workspace}}
    if(op==='AgentHubIssues')return {issues:page([issue()])}
    if(op==='AgentHubComments')return {comments:page([comment()])}
    if(op==='AgentHubIssue')return {issue:issue()}
    if(op==='AgentHubComment'||op==='AgentHubReplyAnchor')return {comment:comment()}
    if(op==='AgentHubThread')return {issue:{...issue(),comments:page([comment()])}}
    if(op==='AgentHubTeam')return {team:{id:team,name:'Test',organization:{id:workspace}}}
    if(op==='AgentHubMembers')return {team:{id:team,organization:{id:workspace},members:page([human,bot])}}
    if(op==='AgentHubReply')return {commentCreate:{success:true,comment:{id:v.input.id,body:v.input.body,issue:issue()}}}
    throw Error('Unexpected query '+op)
  }
  const source=new LinearSource(config,api)
  return {root,config,store,ctx,events,changes,calls,api,source}
}
const outbound=(trigger:Trigger,id='delivery-1')=>({id,kind:'reply' as const,channel:trigger.channel!,text:'[AgentHub validation] verified result'})

it('binds identity, configured team membership, issue/comment events and resources without closing a task',async()=>{
  const f=fixture();await f.source.start(f.ctx)
  expect(await f.source.probe()).toMatchObject({identity:{id:workspace+':'+app,type:'bot'},choices:[{id:team}]})
  expect(await f.source.members(team)).toEqual([{id:actor,name:'Human',bot:false},{id:app,name:'AgentHub',bot:true}])
  await f.source.poll(f.ctx);expect(f.events).toHaveLength(2)
  const trigger=f.events[1]!;expect(trigger).toMatchObject({human:true,addressed:'direct',meta:{scope:team,issueId,messageId:'comment:'+commentId}})
  expect(await f.source.read({resource:'message',trigger,pageSize:20})).toMatchObject({message:{id:commentId}})
  expect(await f.source.read({resource:'issue',trigger,pageSize:20})).toMatchObject({issue:{id:issueId,state:{type:'unstarted'}}})
  expect(await f.source.read({resource:'thread',trigger,pageSize:20})).toMatchObject({messages:[{id:commentId}],next_resource:null})
  await f.source.poll(f.ctx);expect(f.events).toHaveLength(2)
  for(const call of f.calls.filter(c=>['AgentHubIssues','AgentHubComments'].includes(c.op))){const filter=call.op==='AgentHubIssues'?call.v.filter:call.v.filter.issue;expect(filter).toMatchObject({team:{id:{eq:team}},id:{in:[issueId]}});expect(call.v.filter.updatedAt).toMatchObject({gte:expect.any(String),lte:expect.any(String)})}
})
it('retains a fixed pagination window across a source restart and advances only after both streams finish',async()=>{
  let pages=0;const windows:any[]=[]
  const f=fixture((op,v)=>{if(op==='AgentHubIssues'){windows.push(v.filter.updatedAt);pages++;return {issues:page([],pages<=6?'cursor-'+pages:null)}}})
  f.store.put('source-cursor','linear:'+team,{since:at});await f.source.poll(f.ctx)
  expect(f.store.get('source-cursor','linear:'+team)).toEqual({since:at});expect(pages).toBe(5)
  const resumed=new LinearSource(f.config,f.api);await resumed.poll(f.ctx)
  expect(f.calls.filter(c=>c.op==='AgentHubIssues')[5]!.v.after).toBe('cursor-5')
  expect(new Set(windows.map(w=>JSON.stringify(w))).size).toBe(1)
  expect(f.store.get('plugin-state','window:'+team)).toBeNull()
  expect(f.store.get<any>('source-cursor','linear:'+team).since).not.toBe(at)
})
it('keeps the last committed page on failure and rejects malformed/repeated pagination',async()=>{
  let fail=true;const f=fixture((op,v)=>{if(op==='AgentHubIssues'){if(!v.after)return {issues:page([],'page-two')};if(fail)throw Error('network failure');return {issues:page([],'page-two')}}})
  f.store.put('source-cursor','linear:'+team,{since:at})
  await expect(f.source.poll(f.ctx)).rejects.toThrow('network failure')
  expect(f.store.get<any>('plugin-state','window:'+team).after).toBe('page-two');expect(f.store.get('source-cursor','linear:'+team)).toEqual({since:at})
  fail=false;await expect(new LinearSource(f.config,f.api).poll(f.ctx)).rejects.toThrow('did not advance')
})
it('fences edited/archived first deliveries and emits lifecycle facts for known content changes',async()=>{
  let c:any={...comment(),editedAt:at},i:any={...issue(),updatedAt:'2026-11-08T00:00:01.000Z'}
  const f=fixture(op=>op==='AgentHubComments'?{comments:page([c])}:op==='AgentHubIssues'?{issues:page([i])}:undefined)
  await f.source.poll(f.ctx);expect(f.events).toHaveLength(0);expect(f.changes).toMatchObject([{kind:'message.updated',messageId:'comment:'+commentId}])
  c={...comment(),id:id(10)};i=issue();await f.source.poll(f.ctx);expect(f.events).toHaveLength(2)
  i={...i,title:'different requirements'};c={...c,archivedAt:at};await f.source.poll(f.ctx)
  expect(f.events).toHaveLength(2);expect(f.changes.slice(-2).map(c=>c.kind)).toEqual(['message.updated','message.deleted'])
  c={...comment()};await f.source.poll(f.ctx);expect(f.events).toHaveLength(2)
})
it('does not treat apps as humans and allows the personal API-key owner to submit their own request',async()=>{
  const f=fixture(op=>op==='AgentHubIdentity'?{viewer:human,organization:{id:workspace}}:op==='AgentHubComments'?{comments:page([{...comment(),user:bot}])}:undefined)
  await f.source.poll(f.ctx);expect(f.events[0]!.human).toBe(true);expect(f.events[1]!.human).toBe(false)
})
it('fails closed for wrong workspace, swapped principal, foreign issue scope and moved resources',async()=>{
  const wrong=fixture(op=>op==='AgentHubIdentity'?{viewer:bot,organization:{id:id(99)}}:undefined)
  await expect(wrong.source.poll(wrong.ctx)).rejects.toThrow('identity mismatch')
  const f=fixture();f.store.put('source-identity','linear',{principal:workspace+':'+actor});await expect(f.source.poll(f.ctx)).rejects.toThrow('account changed')
  const foreign=fixture(op=>op==='AgentHubComments'?{comments:page([{...comment(),issue:{...issue(),team:{id:id(99)}}}])}:undefined)
  await expect(foreign.source.poll(foreign.ctx)).rejects.toThrow('escaped')
  await expect(f.source.members(id(99))).rejects.toThrow('outside')
  await expect(f.source.context(team+':'+id(99))).rejects.toThrow('outside')
})
it('checks the full anchor on every resource read and rejects changed issue/comment destinations before writing',async()=>{
  let moved=false,changed=false
  const f=fixture(op=>op==='AgentHubIssue'&&moved?{issue:{...issue(),team:{id:id(99)}}}:['AgentHubComment','AgentHubReplyAnchor'].includes(op)&&changed?{comment:{...comment(),body:'changed content'}}:undefined)
  await f.source.poll(f.ctx);const trigger=f.events[1]!
  changed=true;await expect(f.source.read({resource:'issue',trigger,pageSize:10})).rejects.toThrow('changed')
  await expect(f.source.deliver(outbound(trigger))).rejects.toThrow('content changed');expect(f.calls.some(c=>c.op==='AgentHubReply')).toBe(false)
  changed=false;moved=true;await expect(f.source.read({resource:'thread',trigger,pageSize:10})).rejects.toThrow('outside')
  await expect(f.source.deliver({...outbound(trigger),channel:{...trigger.channel!,thread:team+':'+id(99)}})).rejects.toThrow('outside')
})
it('persists an own-message fence before an uncertain write and never invents a successful receipt',async()=>{
  let posted:any,committed=false
  const f=fixture((op,v)=>{if(op==='AgentHubReply'){expect(committed).toBe(true);posted={...comment(),id:v.input.id,body:v.input.body,user:human};throw Error('response lost')}if(op==='AgentHubComments'&&posted)return {comments:page([posted])}})
  f.ctx.checkpoint=async()=>{committed=true};await f.source.poll(f.ctx);committed=false
  await expect(f.source.deliver(outbound(f.events[1]!))).rejects.toBeInstanceOf(UncertainDelivery)
  expect(f.store.get<any>('source-message-observation','linear:'+team+':comment:'+posted.id).outgoing).toBe(true)
  const before=f.events.length;await new LinearSource(f.config,f.api).poll(f.ctx);expect(f.events).toHaveLength(before)
  expect(f.calls.filter(c=>c.op==='AgentHubReply')).toHaveLength(1)
})
it('returns explicit comment pagination and rejects issue tools carrying a cursor',async()=>{
  const f=fixture(op=>op==='AgentHubThread'?{issue:{...issue(),comments:page([comment()],'more')}}:undefined)
  await f.source.poll(f.ctx);const trigger=f.events[1]!
  expect((await f.source.read({resource:'thread',trigger,pageSize:1000})).next_resource).toBe('trigger-source/'+trigger.id+'/thread/more')
  expect(f.calls.at(-1)!.v.first).toBe(100)
  await expect(f.source.read({resource:'issue/arbitrary',trigger,pageSize:10})).rejects.toThrow('Invalid')
})

async function serve(handler:(input:any,authorization:string|undefined)=>any){
  const server=createServer(async(req,res)=>{let text='';for await(const c of req)text+=c;const result=await handler(JSON.parse(text),req.headers.authorization);res.writeHead(result.status??200,{'content-type':'application/json',...result.headers});res.end(JSON.stringify(result.body))});servers.push(server)
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));return 'http://127.0.0.1:'+(server.address() as any).port+'/graphql'
}
it('rejects GraphQL partial success, persists rate-limit backoff and sends the correct authentication scheme',async()=>{
  let mode='partial',count=0
  const endpoint=await serve((_,authorization)=>{count++;expect(authorization).toBe('Bearer test-token');return mode==='partial'?{body:{data:{viewer:bot,organization:{id:workspace}},errors:[{message:'Sensitive server content'}]}}:{status:429,headers:{'retry-after':'60'},body:{errors:[]}}})
  process.env.AGENTHUB_LINEAR_TEST_TOKEN='test-token';const f=fixture();Object.assign(f.config.options,{apiBase:endpoint,authType:'oauth'})
  const source=new LinearSource(f.config);await expect(source.start(f.ctx)).rejects.toThrow('partial data rejected')
  mode='rate';await expect(source.poll(f.ctx)).rejects.toThrow('rate limited');expect(count).toBe(2)
  await expect(new LinearSource(f.config).poll(f.ctx)).rejects.toThrow('retry window');expect(count).toBe(2)
  Object.assign(f.config.options,{apiBase:'https://untrusted.example/graphql'});await expect(new LinearSource(f.config).identity()).rejects.toThrow('official endpoint')
})
it('loads as an external sandboxed package, resumes host state, and upgrades/rolls back without core changes',async()=>{
  const f=fixture();let offline=false,writes=0
  const endpoint=await serve(async({query,variables},authorization)=>{expect(authorization).toBe('test-token');if(query.includes('AgentHubComments')&&offline)return {body:{data:{comments:page([{...comment(),id:id(11),body:'/agent arrived offline'}])}}};if(query.includes('mutation AgentHubReply'))writes++;return {body:{data:await f.api(query,variables)}}})
  process.env.AGENTHUB_LINEAR_TEST_TOKEN='test-token'
  const manifest=JSON.parse(readFileSync(new URL('../plugins/linear/manifest.json',import.meta.url),'utf8'))
  const v1=await buildPluginPackage(fileURLToPath(new URL('../plugins/linear/index.ts',import.meta.url)),manifest,join(f.root,'v1'))
  const v2=await buildPluginPackage(fileURLToPath(new URL('../plugins/linear/index.ts',import.meta.url)),{...manifest,version:'1.2.0'},join(f.root,'v2'))
  const config=configSchema.parse({stateDir:f.root,work:{sandboxDriver:process.platform==='darwin'?'seatbelt':'bubblewrap'},sourcePlugins:[{directory:v1.directory,digest:v1.digest}],sources:[{...f.config,options:{...f.config.options,apiBase:endpoint}}]})
  const create=async()=>{const source=(await SourceRegistry.load(config)).create(config.sources[0]!) as ProcessSource;source.attach(f.store);sources.push(source);await source.start(f.ctx);return source}
  activatePluginPackages(f.store,config,[v1]);const source=await create();await source.poll(f.ctx)
  expect(f.events).toHaveLength(2);await source.deliver(outbound(f.events[1]!));expect(writes).toBe(1)
  await source.close();sources.splice(sources.indexOf(source),1)
  const before=f.store.get('source-cursor','linear:'+team);offline=true
  const resumed=await create();expect(f.store.get('source-cursor','linear:'+team)).toEqual(before);await resumed.poll(f.ctx);expect(f.events.at(-1)!.text).toBe('/agent arrived offline')
  await resumed.poll(f.ctx);expect(f.events.filter(e=>e.text==='/agent arrived offline')).toHaveLength(1);await resumed.close();sources.splice(sources.indexOf(resumed),1)
  const protectedRecords=()=>f.store.db.prepare("SELECT kind,id,body FROM records WHERE kind!='plugin-installation' ORDER BY kind,id").all()
  const saved=protectedRecords();activatePluginPackages(f.store,config,[v2]);activatePluginPackages(f.store,config,[v1]);expect(f.store.get<any>('plugin-installation','linear').revision).toBe(3);expect(protectedRecords()).toEqual(saved);expect(writes).toBe(1)
  f.store.put('router-goal','unfinished',{state:'running'});expect(()=>activatePluginPackages(f.store,config,[v2])).toThrow('Drain');expect(f.store.get<any>('plugin-installation','linear').revision).toBe(3)
},20000)
