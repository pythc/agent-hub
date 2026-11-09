import {it,expect,afterEach} from 'vitest'
import {mkdtempSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createServer,type Server} from 'node:http'
import {configSchema} from '../src/config.ts'
import {buildPluginPackage,activatePluginPackages,type PluginPackage} from '../src/plugin-package.ts'
import {SourceRegistry} from '../src/source-plugins.ts'
import {ProcessSource} from '../src/plugin-process.ts'
import {Store} from '../src/store.ts'
import {Runtime} from '../src/runtime.ts'
import {isRepositorySource} from '../src/repository-source.ts'

const repo=fileURLToPath(new URL('../',import.meta.url)),roots:string[]=[],sources:ProcessSource[]=[],stores:Store[]=[],servers:Server[]=[],hosts:Runtime[]=[]
afterEach(async()=>{for(const h of hosts.splice(0))await h.close();for(const s of sources.splice(0))await s.close();for(const s of stores.splice(0))s.close();for(const server of servers.splice(0))await new Promise<void>(r=>server.close(()=>r()));for(const p of roots.splice(0))rmSync(p,{recursive:true,force:true});delete process.env.GITHUB_PLUGIN_TEST_TOKEN;delete process.env.GITHUB_PLUGIN_TEST_MERGE})
const dir=()=>{const p=mkdtempSync(join(tmpdir(),'github-plugin-'));roots.push(p);return p}
async function pack(root:string,version='1.0.0',kind='github'){
 const manifest=JSON.parse(readFileSync(join(repo,'plugins/github/manifest.json'),'utf8'));Object.assign(manifest,{version,kind})
 return buildPluginPackage(join(repo,'plugins/github/package.ts'),manifest,join(root,'pkg-'+version+'-'+kind))
}
async function fixture(kind='github'){
 const root=dir(),pkg=await pack(root,'1.0.0',kind),calls:{method:string;path:string;body:any;actor:string}[]=[],observations:any[]=[],events:any[]=[]
 let beforeWrite=()=>{},status='failure',edited=false,emptyHistory=false
 const server=createServer(async(req,res)=>{
  const chunks=[];for await(const c of req)chunks.push(c)
  const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined,path=req.url!,method=req.method!,actor=req.headers.authorization==='Bearer merge-fixture'?'merger':'agent'
  calls.push({method,path,body,actor});let value:any=[]
  if(path==='/user')value={login:actor,type:'User'}
  else if(path==='/repos/owner/repo')value={full_name:'owner/repo',default_branch:'main',permissions:{pull:true,push:true}}
  else if(path.startsWith('/repos/owner/repo/issues/comments?'))value=emptyHistory?[]:[{id:2,issue_url:'https://api.github.com/repos/owner/repo/issues/7',body:'Also handle empty input',updated_at:new Date().toISOString(),user:{login:'alice',type:'User'}}]
  else if(path.startsWith('/repos/owner/repo/issues?'))value=emptyHistory?[]:[{id:1,number:7,title:'Parser',body:'/agent fix parser',state:'open',user:{login:'alice',type:'User'}}]
  else if(path==='/repos/owner/repo/issues/7')value={id:1,number:7,title:'Parser',body:edited?'Changed request':'/agent fix parser',state:'open',pull_request:{},user:{login:'alice',type:'User'}}
  else if(path==='/repos/owner/repo/pulls/7')value={number:7,title:'Parser',state:'open',draft:false,merged:false,mergeable:true,additions:1,deletions:1,head:{sha:'a'.repeat(40),ref:'superagent/test',repo:{full_name:'owner/repo'}},base:{ref:'main',repo:{full_name:'owner/repo'}}}
  else if(path.includes('/check-runs'))value={check_runs:[]}
  else if(path.includes('/statuses'))value=[{id:9,context:'legacy-ci',state:status,target_url:'https://example.test/ci'}]
  else if(path.includes('/reviews?'))value=[{id:3,state:'APPROVED',body:'',commit_id:'a'.repeat(40),submitted_at:new Date().toISOString(),user:{login:'reviewer',type:'User'}}]
  else if(path.startsWith('/repos/owner/repo/pulls?')){beforeWrite();value=[]}
  else if(path==='/repos/owner/repo/pulls'&&method==='POST')value={number:8,html_url:'https://github.com/owner/repo/pull/8'}
  else if(path==='/repos/owner/repo/pulls/7/merge'&&method==='PUT')value={merged:true,sha:'b'.repeat(40)}
  else if(path==='/graphql')value=body.query.trim().startsWith('mutation')?{data:{resolveReviewThread:{thread:{isResolved:true}}}}:{data:{repository:{pullRequest:{id:'PR',autoMergeRequest:null,reviewThreads:{nodes:[{id:'THREAD',isResolved:false,isOutdated:false,comments:{nodes:[{databaseId:42}]}}],pageInfo:{hasNextPage:false}}}}}}
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(value))
 });servers.push(server);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r))
 process.env.GITHUB_PLUGIN_TEST_TOKEN='agent-fixture';process.env.GITHUB_PLUGIN_TEST_MERGE='merge-fixture'
 const config=configSchema.parse({stateDir:join(root,'state'),work:{sandboxDriver:process.platform==='darwin'?'seatbelt':'bubblewrap'},sourcePlugins:[{directory:pkg.directory,digest:pkg.digest,replaceBuiltin:kind==='github'}],sources:[{id:'repo',kind,repository:'owner/repo',cwd:root,github:{tokenEnv:'GITHUB_PLUGIN_TEST_TOKEN'},options:{repositories:['owner/repo'],mergeTokenEnv:'GITHUB_PLUGIN_TEST_MERGE',apiBase:'http://127.0.0.1:'+(server.address() as any).port+'/'},allowedActors:['alice']}]})
 const store=new Store(join(root,'transport.sqlite'));stores.push(store)
 store.put('ticket','task',{id:'task'});store.threads.save({key:'repo:owner/repo#7',ref:{source:'repo',id:'owner/repo#7'},subscriptions:['task'],createdAt:new Date().toISOString(),correlated:[],pending:[],meta:{}})
 store.threads.save({key:'repo:delegation:internal',ref:{source:'repo',id:'delegation:internal'},subscriptions:['task'],createdAt:new Date().toISOString(),correlated:[],pending:[],meta:{}})
 const ctx={store,receive:(t:any)=>{events.push(t);store.triggers.save(t)},repositoryUpdate:(v:any)=>observations.push(v),bind(){throw Error('No task mutation')},closed(){throw Error('No task completion')}}
 const launch=async()=>{const source=(await SourceRegistry.load(config)).create(config.sources[0]!) as ProcessSource;sources.push(source);source.attach(store,()=>config.sources[0]);await source.start(ctx);return source}
 const source=await launch()
 return {root,pkg,config,source,store,ctx,events,calls,observations,launch,setBeforeWrite:(fn:()=>void)=>beforeWrite=fn,edit:()=>edited=true,quiet:()=>emptyHistory=true,setStatus:(v:string)=>status=v}
}
it('runs GitHub ingress, anchored reads, CI and durable cursors in the sandboxed package',async()=>{
 const f=await fixture();expect(await f.source.probe()).toMatchObject({identity:{id:'agent'},choices:[{id:'owner/repo'}]})
 await f.source.poll(f.ctx)
 expect(f.events.some(t=>t.meta.eventKind==='comment'&&!t.addressed)).toBe(true)
 expect(f.events.some(t=>t.meta.eventKind==='ci-status'&&JSON.parse(t.text).conclusion==='failure')).toBe(true)
 expect(f.events.every(t=>t.meta.scope==='owner/repo'&&t.channel.thread==='owner/repo#7')).toBe(true)
 expect(f.calls.some(c=>c.path.includes('NaN')||c.path.includes('delegation'))).toBe(false)
 const initial=f.events.find(t=>t.meta.eventKind==='issue')
 expect(await f.source.read({resource:'message',trigger:initial,pageSize:20})).toMatchObject({message:{text:'Parser\n/agent fix parser'}})
 f.edit();await expect(f.source.read({resource:'message',trigger:initial,pageSize:20})).rejects.toThrow('failed')
 const cursor=f.store.get('source-cursor','repo'),threadCursor=f.store.get('thread-cursor','repo:owner/repo#7')
 await f.source.close();sources.splice(sources.indexOf(f.source),1)
 const resumed=await f.launch();expect(f.store.get('source-cursor','repo')).toEqual(cursor)
 expect(f.store.get('thread-cursor','repo:owner/repo#7')).toEqual(threadCursor)
 f.quiet();await resumed.poll(f.ctx)
 expect(f.store.triggers.get(initial.id)).toBeDefined()
})
it('uses generic repository methods for third-party kinds and rechecks authority immediately before writes',async()=>{
 const f=await fixture('custom-code-host');expect(isRepositorySource(f.source)).toBe(true)
 expect(f.source.code?.id).toBe('owner/repo')
 const snapshot=await f.source.mergeSnapshot(7);expect(snapshot.actor).toBe('agent');expect(snapshot.checks.statuses[0].state).toBe('failure')
 expect(await f.source.mergeIdentity()).toEqual({login:'merger'})
 let allowed=true;f.setBeforeWrite(()=>{allowed=false})
 await expect(f.source.draft('superagent/test','Test','Body',()=>allowed)).rejects.toThrow('failed')
 expect(f.calls.some(c=>c.method==='POST'&&c.path==='/repos/owner/repo/pulls')).toBe(false)
 f.setBeforeWrite(()=>{});allowed=true
 expect(await f.source.draft('superagent/test','Test','Body',()=>allowed)).toMatchObject({number:8})
 await f.source.resolveReview(7,'THREAD',()=>true)
 expect(await f.source.merge(7,'a'.repeat(40),'squash',undefined,()=>true)).toMatchObject({merged:true})
 expect(f.calls.find(c=>c.method==='PUT')).toMatchObject({actor:'merger',body:{sha:'a'.repeat(40),merge_method:'squash'}})
 f.config.sources[0]!.capabilities.replies=false
 await expect(f.source.draft('superagent/test','Test','Body')).rejects.toThrow('revoked')
})
it('upgrades and rolls back the real GitHub package while retaining identity and cursor state',async()=>{
 const f=await fixture(),v2=await pack(f.root,'1.1.0');await f.source.close();sources.splice(sources.indexOf(f.source),1)
 const launch=async(pkg:PluginPackage)=>{const config=configSchema.parse({...f.config,sourcePlugins:[{directory:pkg.directory,digest:pkg.digest,replaceBuiltin:true}]});const h=await Runtime.create(config,{model:{async run(){throw Error('No model')}}});hosts.push(h);return h}
 const stop=async(h:Runtime)=>{await h.close();hosts.splice(hosts.indexOf(h),1)}
 let h=await launch(f.pkg);h.store.put('source-cursor','repo',{since:'2026-11-09T00:00:00Z'});h.store.put('source-identity','repo',{principal:'agent',revision:3});await stop(h)
 h=await launch(v2);expect(h.store.get<any>('plugin-installation','repo').version).toBe('1.1.0');await stop(h)
 h=await launch(f.pkg);expect(h.store.get<any>('plugin-installation','repo')).toMatchObject({version:'1.0.0',revision:3});expect(h.store.get('source-cursor','repo')).toEqual({since:'2026-11-09T00:00:00Z'});expect(h.store.get<any>('source-identity','repo').principal).toBe('agent')
})
it('refuses code changes while repository writes need reconciliation, without advancing installation revision',async()=>{
 const f=await fixture(),v2=await pack(f.root,'1.1.0')
 f.store.db.prepare("DELETE FROM records WHERE kind='ticket'").run()
 activatePluginPackages(f.store,f.config,[f.pkg])
 for(const [kind,phase] of [['pr-delivery','pushing'],['pr-delivery','creating'],['pr-delivery','uncertain'],['merge-attempt','submitting'],['merge-attempt','uncertain'],['review-action','pending']]){
  f.store.put(kind!,'effect',{phase})
  expect(()=>activatePluginPackages(f.store,f.config,[v2])).toThrow('reconcile external effects')
  expect(f.store.get<any>('plugin-installation','repo')).toMatchObject({version:'1.0.0',revision:1})
  f.store.db.prepare('DELETE FROM records WHERE kind=? AND id=?').run(kind!,'effect')
 }
 activatePluginPackages(f.store,f.config,[v2]);expect(f.store.get<any>('plugin-installation','repo').revision).toBe(2)
})
