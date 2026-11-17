import {afterEach,it,expect} from 'vitest'
import {mkdtempSync,readFileSync,rmSync} from 'node:fs'
import {createServer} from 'node:http'
import {join,resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {configSchema} from '../src/config.ts'
import {Store} from '../src/store.ts'
import {BackendRegistry} from '../src/backends/registry.ts'
import {buildBackendPackage,activateBackendPackages} from '../src/backends/plugin-package.ts'
import type {ModelRequest} from '../src/model.ts'
const cleanups:(()=>void|Promise<void>)[]=[]
afterEach(async()=>{for(const cleanup of cleanups.splice(0).reverse())await cleanup();delete process.env.CLI_TEST_KEY})
async function setup(kind:string){
 const root=mkdtempSync(join(tmpdir(),'cli-adapter-'));cleanups.push(()=>rmSync(root,{recursive:true,force:true}))
 let requests=0,status=200,body='{}'
 const server=createServer((_req,res)=>{requests++;res.writeHead(status,{'content-type':'application/json'});res.end(body)})
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));cleanups.push(()=>new Promise<void>(r=>{server.closeAllConnections();server.close(()=>r())}))
 const manifest=JSON.parse(readFileSync(resolve('plugins/backend-'+kind+'/manifest.json'),'utf8'))
 const pkg=await buildBackendPackage(resolve('plugins/backend-'+kind+'/index.ts'),manifest,join(root,'pkg'))
 process.env.CLI_TEST_KEY='synthetic-account'
 const fixture=resolve('tests/fixtures/vendor-cli.mjs'),config=configSchema.parse({stateDir:join(root,'state'),sources:[{id:'local',kind:'local',cwd:root,allowedActors:['operator']}],work:{sandboxDriver:process.platform==='darwin'?'seatbelt':'bubblewrap'},turnTimeoutMs:10000,backendPlugins:[{directory:pkg.directory,digest:pkg.digest}],backends:{external:{kind:'plugin',plugin:manifest.id,config:{command:process.execPath,args:[fixture,kind,manifest.configSchema.properties.cliVersion.const],cliVersion:manifest.configSchema.properties.cliVersion.const,model:kind==='opencode'?'anthropic/fixture':'fixture',baseUrl:'http://127.0.0.1:'+(server.address() as any).port},readPaths:[fixture],env:{[kind==='gemini'?'GEMINI_API_KEY':'ANTHROPIC_API_KEY']:'CLI_TEST_KEY'}}},execution:{backend:'external'}})
 let store=new Store(join(config.stateDir,'state.sqlite'));cleanups.push(()=>store.close());activateBackendPackages(store,config)
 let registry=new BackendRegistry(config,store)
 const request:ModelRequest={cwd:root,instructions:'A validation task',input:'first',schema:{type:'object',properties:{answer:{type:'string'},inputs:{type:'array'}},required:['answer','inputs'],additionalProperties:false},managed:true,contextBudget:{maxBytes:80000,outputReserveBytes:8192,toolReserveBytes:4096},tools:[{type:'function',name:'allowed',description:'allowed operation',inputSchema:{type:'object',properties:{n:{type:'number'}},required:['n'],additionalProperties:false}}]}
 return {root,manifest,pkg,config,request,setResponse(s:number,b:string){status=s;body=b},get store(){return store},get registry(){return registry},get requests(){return requests},restart(){store.close();store=new Store(join(config.stateDir,'state.sqlite'));registry=new BackendRegistry(config,store)}}
}
for(const kind of ['claude','gemini','opencode']){
 it(kind+' fences a completed effect whose native acknowledgement was lost',async()=>{
  const f=await setup(kind);let id='',calls=0
  const request={...f.request,onThread:(v:string)=>id=v,onTool:async()=>{calls++;return {success:true,contentItems:[{type:'inputText' as const,text:'external write completed'}]}}}
  await expect(f.registry.run({...request,input:'tool-crash'})).rejects.toMatchObject({code:'process_failed'})
  expect(f.store.list<any>('backend-plugin-tool').every(r=>r.state==='complete')).toBe(true)
  f.restart();await expect(f.registry.run({...request,threadId:id,input:'tool'})).rejects.toMatchObject({code:'outcome_unknown'});expect(calls).toBe(1)
 })
 it.each(['wire-native-tool','wire-opaque'])(kind+' rejects %s before provider inference',async(input)=>{
  const f=await setup(kind)
  await expect(f.registry.run({...f.request,input})).rejects.toMatchObject({code:'unsupported'});expect(f.requests).toBe(0)
 })
 it(kind+' rejects unsupported output limits before inference',async()=>{
  const f=await setup(kind)
  await expect(f.registry.run({...f.request,options:{maxOutputTokens:1000}})).rejects.toMatchObject({code:'unsupported'});expect(f.requests).toBe(0)
 })
 it(kind+' keeps the native session bound to the authenticated account',async()=>{
  const f=await setup(kind),first=await f.registry.run(f.request);process.env.CLI_TEST_KEY='different-account';f.restart()
  await expect(f.registry.run({...f.request,threadId:first.threadId})).rejects.toMatchObject({code:'auth_required'});expect(f.requests).toBe(1)
 })
 it(kind+' reports provider quota without waiting for a native CLI retry timeout',async()=>{
  const f=await setup(kind);f.setResponse(429,'{"error":"Free usage limit reached"}')
  await expect(f.registry.run(f.request)).rejects.toMatchObject({code:'quota_exhausted'});expect(f.requests).toBe(1)
 })
 it(kind+' uses host receipts, preserves native context across restart and pins upgrade/rollback',async()=>{
  const f=await setup(kind);let calls=0
  const request={...f.request,input:'tool',onTool:async()=>{calls++;return {success:true,contentItems:[{type:'inputText' as const,text:'done'}]}}}
  const first=await f.registry.run(request),native=f.store.get<any>('backend-plugin-thread',first.threadId).nativeId
  expect(calls).toBe(1)
  const next=await buildBackendPackage(resolve('plugins/backend-'+kind+'/index.ts'),{...f.manifest,version:'1.0.1'},join(f.root,'v2'))
  f.config.backendPlugins=[{directory:next.directory,digest:next.digest}];activateBackendPackages(f.store,f.config);f.restart()
  const resumed=await f.registry.run({...request,input:'second',threadId:first.threadId})
  expect(JSON.parse(resumed.text).inputs).toEqual(['tool','second']);expect(f.store.get<any>('backend-plugin-thread',first.threadId).nativeId).toBe(native)
  expect(f.store.get<any>('backend-plugin-thread',first.threadId).digest).toBe(f.pkg.digest)
  const fresh=await f.registry.run({...request,input:'fresh'})
  f.config.backendPlugins=[{directory:f.pkg.directory,digest:f.pkg.digest}];activateBackendPackages(f.store,f.config);f.restart()
  await f.registry.run({...request,input:'rolled-back',threadId:fresh.threadId});expect(f.store.get<any>('backend-plugin-thread',fresh.threadId).digest).toBe(next.digest)
  expect((await f.registry.history(first.threadId,f.root)).turns).toHaveLength(2)
  await f.registry.purge(first.threadId,f.root);await f.registry.purge(first.threadId,f.root)
  await expect(f.registry.run({...request,threadId:first.threadId})).rejects.toThrow('deletion fence')
 })
 it(kind+' rejects false success and continues repair in the same native session',async()=>{
  const f=await setup(kind);let id=''
  await expect(f.registry.run({...f.request,input:'bad-result',onThread:v=>id=v})).rejects.toMatchObject({code:'invalid_output'})
  expect(id).toMatch(/^plugin:/);f.restart()
  const fixed=await f.registry.run({...f.request,input:'repair',threadId:id})
  expect(fixed.threadId).toBe(id);expect(JSON.parse(fixed.text).inputs).toEqual(['bad-result','repair'])
  await expect(f.registry.run({...f.request,input:'error-after-text',threadId:id})).rejects.toMatchObject({code:'auth_required'})
 })
 it(kind+' blocks invalid tools and retains uncertainty after an external operation throws',async()=>{
  const f=await setup(kind);let id='',calls=0
  const request={...f.request,onThread:(v:string)=>id=v,onTool:async()=>{calls++;throw Error('lost acknowledgement')}}
  await expect(f.registry.run({...request,input:'bad-args'})).rejects.toMatchObject({code:'unsupported'});expect(calls).toBe(0)
  await expect(f.registry.run({...request,input:'tool'})).rejects.toMatchObject({code:'outcome_unknown'});f.restart()
  await expect(f.registry.run({...request,threadId:id,input:'tool'})).rejects.toMatchObject({code:'outcome_unknown'});expect(calls).toBe(1)
 })
 it(kind+' checks the full native wire request before any upstream request',async()=>{
  const f=await setup(kind),receipts:any[]=[]
  await expect(f.registry.run({...f.request,input:'wire-budget',onBudget:r=>receipts.push(r)})).rejects.toMatchObject({code:'context_budget_exceeded'})
  expect(f.requests).toBe(0);expect(receipts.some(r=>r.basis==='api-wire'&&r.status==='exceeded')).toBe(true)
 })
 it(kind+' preserves interrupted native sessions and rejects identity replacement',async()=>{
  const f=await setup(kind);let id=''
  await expect(f.registry.run({...f.request,input:'crash',onThread:v=>id=v})).rejects.toMatchObject({code:'process_failed'})
  f.restart();const result=await f.registry.run({...f.request,input:'recover',threadId:id})
  expect(result.threadId).toBe(id);expect(JSON.parse(result.text).inputs).toEqual(['crash','recover'])
  await expect(f.registry.run({...f.request,input:'replace',threadId:id})).rejects.toMatchObject({code:'invalid_output'})
 })
}
