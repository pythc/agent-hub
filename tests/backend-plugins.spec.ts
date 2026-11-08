import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs'
import {spawn} from 'node:child_process'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {afterEach,it,expect} from 'vitest'
import {configSchema} from '../src/config.ts'
import {Store} from '../src/store.ts'
import {Settings} from '../src/settings.ts'
import {Setup} from '../src/setup.ts'
import {BackendRegistry} from '../src/backends/registry.ts'
import {activateBackendPackages,buildBackendPackage,readBackendPackage} from '../src/backends/plugin-package.ts'
import {backendPluginCommand} from '../src/backends/plugin-cli.ts'
import {BackendPluginError} from '../src/backends/plugin-contract.ts'
import {classifyGoalFailure} from '../src/goal-contract.ts'
import type {ModelRequest} from '../src/model.ts'
const roots:string[]=[],stores:Store[]=[]
afterEach(()=>{for(const s of stores.splice(0))s.close();for(const r of roots.splice(0))rmSync(r,{recursive:true,force:true});delete process.env.PRIVATE_FIXTURE_SECRET;delete process.env.TEST_ACCOUNT})
const manifest={id:'third-party-cli',label:'Independent test adapter',version:'1.0.0',stateVersion:1,configSchema:{type:'object'},parametersSchema:{type:'object',properties:{flavor:{enum:['highest']}},additionalProperties:false},capabilities:{resume:true,tools:true,managed:true,contextBudget:true,steering:true,promptRefresh:true,images:false,nativeTakeover:false,history:true,purge:false,modelCatalog:true},network:false,environment:['FIXTURE_ACCOUNT']}
it('keeps typed plugin failures out of quality repair and autonomous replanning',()=>{
 for(const code of ['outcome_unknown','process_failed','cancelled'] as const)expect(classifyGoalFailure(String(new BackendPluginError(code,'external')),0,0).kind).toBe('uncertain')
 for(const code of ['auth_required','provider_rejected','configuration_invalid','unsupported'] as const)expect(classifyGoalFailure(String(new BackendPluginError(code,'external')),0,0).kind).toBe('environment')
 expect(classifyGoalFailure(String(new BackendPluginError('quota_exhausted','external')),0,0).kind).toBe('quota')
 expect(classifyGoalFailure(String(new BackendPluginError('invalid_output','external')),0,0).kind).toBe('quality')
})
async function fixture(patch:Record<string,unknown>={}){
 const root=mkdtempSync(join(tmpdir(),'backend-plugin-test-'));roots.push(root)
 const pkg=await buildBackendPackage(resolve('tests/fixtures/execution-backend.ts'),{...manifest,...patch},join(root,'package'))
 const config=configSchema.parse({stateDir:join(root,'state'),sources:[{id:'local',kind:'local',cwd:root,allowedActors:['operator']}],work:{sandboxDriver:process.platform==='darwin'?'seatbelt':'bubblewrap'},turnTimeoutMs:10000,backendPlugins:[{directory:pkg.directory,digest:pkg.digest}],backends:{external:{kind:'plugin',plugin:manifest.id,config:{secret:join(root,'state','secret')},env:{FIXTURE_ACCOUNT:'TEST_ACCOUNT'}}},execution:{backend:'external'}})
 const cwd=join(config.stateDir,'work','task');mkdirSync(cwd,{recursive:true});writeFileSync(join(config.stateDir,'secret'),'HOST-SECRET');process.env.TEST_ACCOUNT='a'.repeat(64)
 const store=new Store(join(config.stateDir,'state.sqlite'));stores.push(store);activateBackendPackages(store,config)
 const registry=new BackendRegistry(config,store),request:ModelRequest={cwd,instructions:'test',input:'first',schema:{},managed:true}
 return {root,pkg,config,cwd,store,registry,request}
}
it('loads an independent package without provider switches and resumes the original native session after reopening the store',async()=>{
 const f=await fixture(),first=await f.registry.run(f.request)
 expect(first.threadId).toMatch(/^plugin:/)
 const native=f.store.get<any>('backend-plugin-thread',first.threadId).nativeId
 f.store.close();stores.splice(stores.indexOf(f.store),1)
 const store=new Store(join(f.config.stateDir,'state.sqlite'));stores.push(store)
 const registry=new BackendRegistry(f.config,store),second=await registry.run({...f.request,threadId:first.threadId,input:'second'})
 expect(second.threadId).toBe(first.threadId);expect(JSON.parse(second.text).history).toEqual(['first','second'])
 expect(store.get<any>('backend-plugin-thread',first.threadId).nativeId).toBe(native)
 expect(await registry.history!(first.threadId,f.cwd)).toEqual(['first','second'])
})
it('isolates host secrets, task writes and unreferenced environment, including a nested workspace',async()=>{
 const f=await fixture();process.env.PRIVATE_FIXTURE_SECRET='do-not-inherit'
 await f.registry.run({...f.request,input:'isolation'})
 expect(existsSync(join(f.cwd,'native-write'))).toBe(false)
})
it.each(['unknown-tool','bad-args'])('rejects %s before host execution',async(input)=>{
 const f=await fixture();let calls=0
 await expect(f.registry.run({...f.request,input,tools:[{type:'function',name:'allowed',description:'test',inputSchema:{type:'object',properties:{value:{type:'number'}},required:['value']}}],onTool:async()=>{calls++;return {contentItems:[],success:true}}})).rejects.toMatchObject({code:'unsupported'})
 expect(calls).toBe(0)
})
it('persists uncertain effects and blocks retry after an effect throws',async()=>{
 const f=await fixture();let threadId='',calls=0
 const r={...f.request,input:'tool',onThread:(id:string)=>threadId=id,tools:[{type:'function' as const,name:'allowed',description:'test',inputSchema:{type:'object'}}],onTool:async()=>{calls++;throw Error('Transport lost after external write')}}
 await expect(f.registry.run(r)).rejects.toMatchObject({code:'outcome_unknown'})
 const restarted=new BackendRegistry(f.config,f.store)
 await expect(restarted.run({...r,threadId})).rejects.toMatchObject({code:'outcome_unknown'})
 expect(calls).toBe(1)
})
it('reuses completed tool receipts for replayed native calls',async()=>{
 const f=await fixture();let calls=0
 const r={...f.request,input:'replay',tools:[{type:'function' as const,name:'allowed',description:'test',inputSchema:{type:'object'}}],onTool:async()=>{calls++;return {contentItems:[],success:true}}}
 const first=await f.registry.run(r);await f.registry.run({...r,threadId:first.threadId})
 expect(calls).toBe(1)
})
it('binds the authenticated account and prevents native session replacement',async()=>{
 const f=await fixture(),first=await f.registry.run(f.request)
 await expect(f.registry.run({...f.request,threadId:first.threadId,input:'replace'})).rejects.toMatchObject({code:'invalid_output'})
 process.env.TEST_ACCOUNT='b'.repeat(64)
 await expect(f.registry.run({...f.request,threadId:first.threadId})).rejects.toMatchObject({code:'auth_required'})
})
it('pins old sessions through upgrade and rollback without restoring the database',async()=>{
 const f=await fixture(),first=await f.registry.run(f.request),v2=await buildBackendPackage(resolve('tests/fixtures/execution-backend.ts'),{...manifest,version:'1.1.0'},join(f.root,'v2'))
 f.config.backendPlugins=[{directory:v2.directory,digest:v2.digest}];activateBackendPackages(f.store,f.config)
 const registry=new BackendRegistry(f.config,f.store),second=await registry.run({...f.request,threadId:first.threadId}),fresh=await registry.run(f.request)
 expect(second.threadId).toBe(first.threadId)
 expect(f.store.get<any>('backend-plugin-thread',first.threadId).digest).toBe(f.pkg.digest)
 expect(f.store.get<any>('backend-plugin-thread',fresh.threadId).digest).toBe(v2.digest)
 f.config.backendPlugins=[{directory:f.pkg.directory,digest:f.pkg.digest}];activateBackendPackages(f.store,f.config)
 await new BackendRegistry(f.config,f.store).run({...f.request,threadId:fresh.threadId})
 expect(f.store.get<any>('backend-plugin-thread',fresh.threadId).digest).toBe(v2.digest)
 expect(f.store.get<any>('backend-plugin-installation',manifest.id).revision).toBe(3)
})
it('refuses package changes with unresolved effects or incompatible state protocols',async()=>{
 const f=await fixture(),v2=await buildBackendPackage(resolve('tests/fixtures/execution-backend.ts'),{...manifest,version:'1.1.0'},join(f.root,'v2'))
 f.store.put('backend-plugin-tool','unknown',{state:'running'});f.config.backendPlugins=[{directory:v2.directory,digest:v2.digest}]
 expect(()=>activateBackendPackages(f.store,f.config)).toThrow('Drain')
 f.store.put('backend-plugin-tool','unknown',{state:'complete'})
 const v3=await buildBackendPackage(resolve('tests/fixtures/execution-backend.ts'),{...manifest,stateVersion:2},join(f.root,'v3'));f.config.backendPlugins=[{directory:v3.directory,digest:v3.digest}]
 expect(()=>activateBackendPackages(f.store,f.config)).toThrow('migration')
})
it('fails capability and parameter admission before creating a session',async()=>{
 const f=await fixture({capabilities:{...manifest.capabilities,managed:false}})
 await expect(f.registry.run(f.request)).rejects.toMatchObject({code:'unsupported'})
 await expect(f.registry.run({...f.request,managed:false,options:{parameters:{invalid:true}}})).rejects.toThrow('parameters')
 expect(f.store.list('backend-plugin-thread')).toHaveLength(0)
 const readiness=await new Setup({model:f.registry,config:f.config,store:f.store,sources:new Map()} as any).check()
 expect(readiness.status).toBe('setup-required');expect(readiness.checks.find(c=>c.id==='backend:external').status).toBe('required')
})
it('reports actual parameter transmission and acknowledges steering only on read',async()=>{
 const f=await fixture();let reads=0,configuration:any
 const result=await f.registry.run({...f.request,input:'steer',options:{parameters:{flavor:'highest'}},onConfiguration:v=>configuration=v,onActive:control=>{void control.steer('additional requirement',()=>reads++)}})
 expect(reads).toBe(1);expect(JSON.parse(result.text).history).toContain('additional requirement');expect(configuration.sent.parameters).toEqual({flavor:'highest'})
})
it.each(['crash','malformed'])('retains session identity on %s and recovers on the next process',async(input)=>{
 const f=await fixture();let id=''
 await expect(f.registry.run({...f.request,input,onThread:v=>id=v})).rejects.toThrow()
 expect(id).toMatch(/^plugin:/)
 const next=await new BackendRegistry(f.config,f.store).run({...f.request,threadId:id})
 expect(next.threadId).toBe(id)
})
it('cancels a hung process and can resume its persisted native session',async()=>{
 const f=await fixture(),controller=new AbortController();let id=''
 await expect(f.registry.run({...f.request,input:'hang',signal:controller.signal,onThread:v=>{id=v;controller.abort()}})).rejects.toMatchObject({code:'cancelled'})
 expect((await f.registry.run({...f.request,threadId:id})).threadId).toBe(id)
})
it('stages reviewed packages without overwriting existing config or accepting tampered code',async()=>{
 const f=await fixture(),file=join(f.root,'config.json'),out=join(f.root,'staged.json');writeFileSync(file,JSON.stringify(f.config))
 await backendPluginCommand(['stage',file,f.pkg.directory,f.pkg.digest,out])
 expect(JSON.parse(readFileSync(out,'utf8')).stateDir).toBe(f.config.stateDir)
 await expect(backendPluginCommand(['stage',file,f.pkg.directory,f.pkg.digest,out])).rejects.toThrow('new file')
 writeFileSync(join(f.pkg.directory,'plugin.mjs'),'tampered')
 expect(()=>readBackendPackage(f.pkg.directory,f.pkg.digest)).toThrow('checksum')
})

it('retains live model defaults but never restores old plugin deployment over staged configuration',async()=>{
 const f=await fixture(),settings=new Settings(f.store,f.config),updated=structuredClone(f.config.backends)
 updated.external!.model='chosen-model';settings.save(0,{backends:updated})
 const staged=structuredClone(f.config),backend=staged.backends.external!;if(backend.kind!=='plugin')throw Error('Expected plugin')
 backend.config={...backend.config,newDeployment:true};new Settings(f.store,staged)
 expect((staged.backends.external as typeof backend).config.newDeployment).toBe(true);expect(staged.backends.external!.model).toBe('chosen-model')
 const changed=structuredClone(staged.backends);if(changed.external!.kind==='plugin')changed.external!.writePaths=['/new/grant']
 expect(()=>new Settings(f.store,staged).save(1,{backends:changed})).toThrow('controlled restart')
})

it('stops a native descendant when the owning host process is killed',async()=>{
 const f=await fixture(),file=join(f.root,'config.json'),script=join(f.root,'owner.mjs')
 writeFileSync(file,JSON.stringify(f.config))
 writeFileSync(script,`import {loadConfig} from ${JSON.stringify(resolve('src/config.ts'))};import {Store} from ${JSON.stringify(resolve('src/store.ts'))};import {BackendRegistry} from ${JSON.stringify(resolve('src/backends/registry.ts'))};const c=loadConfig(${JSON.stringify(file)}),s=new Store(c.stateDir+'/crash.sqlite');await new BackendRegistry(c,s).run({...${JSON.stringify({...f.request,input:'descendant'})},onThread:()=>console.log('started')});`)
 const owner=spawn(process.execPath,['--import','tsx',script],{cwd:process.cwd(),env:process.env,stdio:['ignore','pipe','pipe']})
 try{
  await new Promise<void>((ok,fail)=>{const timer=setTimeout(()=>fail(Error('Child did not start')),5000);owner.stdout.on('data',chunk=>{if(String(chunk).includes('started')){clearTimeout(timer);ok()}});owner.once('exit',()=>{clearTimeout(timer);fail(Error('Owner exited before starting'))})})
  owner.kill('SIGKILL');await new Promise<void>(ok=>owner.once('close',()=>ok()));await new Promise(ok=>setTimeout(ok,1200))
  const {readdirSync}=await import('node:fs'),data=join(f.config.stateDir,'backend-plugin-data','external')
  expect(readdirSync(data).some(name=>existsSync(join(data,name,'descendant')))).toBe(true)
  expect(readdirSync(data).some(name=>existsSync(join(data,name,'escaped')))).toBe(false)
 }finally{owner.kill('SIGKILL')}
})
