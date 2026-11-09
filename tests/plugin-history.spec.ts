import {mkdtempSync,mkdirSync,rmSync,existsSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {afterEach,it,expect} from 'vitest'
import {configSchema} from '../src/config.ts'
import {Store} from '../src/store.ts'
import {BackendRegistry} from '../src/backends/registry.ts'
import {buildBackendPackage,activateBackendPackages} from '../src/backends/plugin-package.ts'
import {HistoryCleanup,planHistory} from '../src/history-cleanup.ts'
import {configuredHistoryReader,exportHistoryIndex,verifyHistoryIndex} from '../src/history-backup.ts'
import {Resources} from '../src/resources.ts'

const roots:string[]=[],stores:Store[]=[]
const originalAccount=process.env.HISTORY_FIXTURE_ACCOUNT
afterEach(()=>{
 for(const s of stores.splice(0))s.close()
 for(const r of roots.splice(0))rmSync(r,{recursive:true,force:true})
 if(originalAccount===undefined)delete process.env.HISTORY_FIXTURE_ACCOUNT;else process.env.HISTORY_FIXTURE_ACCOUNT=originalAccount
})
const manifest={id:'history-fixture',label:'Local history fixture',version:'1.0.0',stateVersion:1,configSchema:{type:'object'},parametersSchema:{type:'object'},capabilities:{resume:true,tools:true,managed:true,contextBudget:true,steering:false,promptRefresh:false,images:false,nativeTakeover:false,history:true,purge:true,modelCatalog:false},network:false,environment:['FIXTURE_ACCOUNT']}
async function fixture(options:Record<string,unknown>={},recordOnly=false){
 const root=mkdtempSync(join(tmpdir(),'plugin-history-'));roots.push(root)
 const pkg=await buildBackendPackage(resolve('tests/fixtures/history-backend.ts'),manifest,join(root,'package'))
 const config=configSchema.parse({stateDir:join(root,'state'),sources:[{id:'local',kind:'local',cwd:root,allowedActors:['operator']}],work:{sandboxDriver:process.platform==='darwin'?'seatbelt':'bubblewrap'},turnTimeoutMs:10000,backendPlugins:[{directory:pkg.directory,digest:pkg.digest}],backends:{external:{kind:'plugin',plugin:manifest.id,config:options,env:{FIXTURE_ACCOUNT:'HISTORY_FIXTURE_ACCOUNT'}}},execution:{backend:'external'}})
 process.env.HISTORY_FIXTURE_ACCOUNT='a'.repeat(64)
 const cwd=join(config.stateDir,'work','task');mkdirSync(cwd,{recursive:true})
 const store=new Store(join(config.stateDir,'state.sqlite'));stores.push(store);activateBackendPackages(store,config)
 const registry=new BackendRegistry(config,store),request={cwd,instructions:'fixture',input:'private history marker',schema:{},managed:true}
 const first=await registry.run(request),record=store.get<any>('backend-plugin-thread',first.threadId)
 store.put('ticket','ticket',{id:'ticket',assignments:[]})
 store.put('task-ownership','ticket',{ticketId:'ticket',scopeId:'scope'})
 if(recordOnly)store.put('backend-plugin-thread',first.threadId,{...record,ticketId:'ticket'})
 else{
  store.put('model-session',first.threadId,{threadId:first.threadId,cwd,ticketId:'ticket',ephemeral:false})
  store.put('run','ticket',{ticketId:'ticket',threadId:first.threadId,cwd,backendId:'external',backendKind:'plugin',phase:'idle'})
 }
 const directory=join(config.stateDir,'backend-plugin-data','external',record.identity),nativeFile=join(directory,record.nativeId+'.json'),counter=join(directory,record.nativeId+'.purge-count')
 return {root,config,pkg,cwd,store,registry,request,first,record,nativeFile,counter}
}
function reopen(f:Awaited<ReturnType<typeof fixture>>){
 f.store.close();stores.splice(stores.indexOf(f.store),1)
 const store=new Store(join(f.config.stateDir,'state.sqlite'));stores.push(store)
 return {...f,store,registry:new BackendRegistry(f.config,store)}
}
const mapping=['pluginId','stateVersion','identity','nativeId','accountIdentity']
function assertMapping(f:Awaited<ReturnType<typeof fixture>>,retained:boolean){
 const value=f.store.get<any>('backend-plugin-thread',f.first.threadId)
 for(const key of mapping)expect(value[key]).toEqual(retained?f.record[key]:undefined)
 if(!retained)expect(value.deleted).toBe(true)
}
function retryNow(f:Awaited<ReturnType<typeof fixture>>,id:string){const r=f.store.get<any>('history-cleanup',id);f.store.put('history-cleanup',id,{...r,nextAt:0})}

it('maps native history to the host identity for direct reads, transcripts and verified exports after restart',async()=>{
 const f=reopen(await fixture()),id=f.first.threadId
 const history=await f.registry.history(id,f.cwd)
 expect(id).not.toBe(f.record.nativeId)
 expect(history).toMatchObject({id,model:'fixture-model',turns:[{id:f.first.turnId,items:[{text:'private history marker'}]}]})
 expect(f.store.get<any>('backend-plugin-thread',id).nativeId).toBe(f.record.nativeId)
 const resources=new Resources({store:f.store,model:f.registry,scopes:{enabled:()=>false}} as any)
 expect((await resources.read({resource:'ticket/ticket/transcript'})).items[0]).toMatchObject({threadId:id,turnId:f.first.turnId,backendId:'external'})
 const directory=join(f.root,'export');mkdirSync(directory)
 const exported=await exportHistoryIndex(f.store.db,directory,configuredHistoryReader(f.config,f.store.db))
 expect(exported).toMatchObject({status:'verified',count:1})
 const index=verifyHistoryIndex(directory,exported)
 expect(JSON.parse(readFileSync(join(directory,'history',index.items[0].file),'utf8')).id).toBe(id)
})
it.each(['wrong-id','missing-id','invalid-turns','array'])('rejects %s history before projecting or exporting it',async history=>{
 const f=await fixture({history})
 await expect(f.registry.history(f.first.threadId,f.cwd)).rejects.toMatchObject({code:'invalid_output'})
 const directory=join(f.root,'export');mkdirSync(directory)
 await expect(exportHistoryIndex(f.store.db,directory,configuredHistoryReader(f.config,f.store.db))).rejects.toMatchObject({code:'invalid_output'})
 expect(existsSync(join(directory,'history-index.json'))).toBe(false)
})
it.each(['fail-before','fail-after'])('retains the purge mapping through %s failure and restart, then clears it after verified deletion',async purge=>{
 let f=await fixture({purge})
 const cleanup=new HistoryCleanup(f.store,f.config.stateDir),plan=planHistory(f.store,f.config.stateDir,'scope','delete-history',Date.now())
 f.store.put('backend-plugin-thread',f.first.threadId,{...f.record,secretPayload:'must be erased'})
 cleanup.apply(plan);assertMapping(f,true)
 expect(f.store.get<any>('backend-plugin-thread',f.first.threadId).secretPayload).toBeUndefined()
 await expect(f.registry.history(f.first.threadId,f.cwd)).rejects.toThrow('deletion fence')
 await expect(f.registry.run({...f.request,threadId:f.first.threadId})).rejects.toThrow('deletion fence')
 await cleanup.process(f.registry,async()=>false)
 expect(existsSync(f.counter)).toBe(false)
 await cleanup.process(f.registry,async()=>true)
 expect(cleanup.receipts()[0]).toMatchObject({status:'processing',phase:'native_history',nativeDone:[]})
 expect(existsSync(f.nativeFile)).toBe(purge==='fail-before');assertMapping(f,true)
 f=reopen(f);const restarted=new HistoryCleanup(f.store,f.config.stateDir);retryNow(f,plan.id);assertMapping(f,true)
 await restarted.process(f.registry,async()=>true)
 expect(restarted.receipts()[0]).toMatchObject({status:'completed',phase:'verified',local:'verified'})
 expect(existsSync(f.nativeFile)).toBe(false);expect(readFileSync(f.counter,'utf8')).toBe('2');assertMapping(f,false)
 // A late callback cannot repopulate the deleted native/account mapping.
 f.store.put('backend-plugin-thread',f.first.threadId,f.record);assertMapping(f,false)
 await expect(f.registry.purge(f.first.threadId,f.root)).rejects.toThrow('workspace')
 // Replaying cleanup after restart needs no vanished native identity.
 f=reopen(f);const replayed=new HistoryCleanup(f.store,f.config.stateDir);replayed.apply(plan)
 await replayed.process(f.registry,async()=>true)
 expect(replayed.receipts()[0]?.status).toBe('completed');expect(readFileSync(f.counter,'utf8')).toBe('2');assertMapping(f,false)
})
it('discovers a selected plugin session even when only its own record carries the task reference',async()=>{
 const f=await fixture({},true),cleanup=new HistoryCleanup(f.store,f.config.stateDir),plan=planHistory(f.store,f.config.stateDir,'scope','delete-record-only',Date.now())
 expect(plan.sessions).toEqual([{threadId:f.first.threadId,cwd:f.record.cwd}])
 cleanup.apply(plan);await cleanup.process(f.registry,async()=>true)
 expect(cleanup.receipts()[0]?.status).toBe('completed');expect(existsSync(f.nativeFile)).toBe(false);assertMapping(f,false)
})
it('does not discard mapping or mark deletion verified when the adapter returns an invalid receipt',async()=>{
 const f=await fixture({purge:'invalid-receipt'}),cleanup=new HistoryCleanup(f.store,f.config.stateDir)
 cleanup.apply(planHistory(f.store,f.config.stateDir,'scope','invalid-receipt',Date.now()))
 await cleanup.process(f.registry,async()=>true)
 expect(cleanup.receipts()[0]).toMatchObject({status:'processing',phase:'native_history',nativeDone:[]})
 expect(f.store.get('backend-deleted',f.first.threadId)).toBeUndefined()
 expect(existsSync(f.nativeFile)).toBe(true);assertMapping(f,true)
})
it('recovers a verified purge whose cleanup checkpoint was interrupted without invoking the adapter again',async()=>{
 let f=await fixture();const cleanup=new HistoryCleanup(f.store,f.config.stateDir),plan=planHistory(f.store,f.config.stateDir,'scope','checkpoint',Date.now())
 cleanup.apply(plan)
 await cleanup.process({run:r=>f.registry.run(r),purge:async(id,cwd)=>{await f.registry.purge(id,cwd);throw Error('Interrupted before cleanup checkpoint')}},async()=>true)
 expect(cleanup.receipts()[0]).toMatchObject({status:'processing',nativeDone:[]})
 expect(existsSync(f.nativeFile)).toBe(false);expect(f.store.get('backend-deleted',f.first.threadId)).toBeDefined()
 f=reopen(f);const restarted=new HistoryCleanup(f.store,f.config.stateDir);retryNow(f,plan.id)
 await restarted.process(f.registry,async()=>true)
 expect(restarted.receipts()[0]?.status).toBe('completed');expect(readFileSync(f.counter,'utf8')).toBe('1');assertMapping(f,false)
})
it('checks the original account and backend configuration before deleting pending native history',async()=>{
 const f=await fixture(),cleanup=new HistoryCleanup(f.store,f.config.stateDir),plan=planHistory(f.store,f.config.stateDir,'scope','account-check',Date.now())
 cleanup.apply(plan);process.env.HISTORY_FIXTURE_ACCOUNT='b'.repeat(64)
 await cleanup.process(f.registry,async()=>true)
 expect(cleanup.receipts()[0]?.error).toContain('auth_required');expect(existsSync(f.counter)).toBe(false);assertMapping(f,true)
 process.env.HISTORY_FIXTURE_ACCOUNT='a'.repeat(64)
 const definition=f.config.backends.external!;if(definition.kind!=='plugin')throw Error('Expected plugin')
 definition.config={changed:true};retryNow(f,plan.id)
 await cleanup.process(f.registry,async()=>true)
 expect(cleanup.receipts()[0]?.error).toContain('identity');expect(existsSync(f.counter)).toBe(false);assertMapping(f,true)
 definition.config={};retryNow(f,plan.id);await cleanup.process(f.registry,async()=>true)
 expect(cleanup.receipts()[0]?.status).toBe('completed');assertMapping(f,false)
})
it('uses the pinned package for history and purge across upgrade, and retains deletion across rollback',async()=>{
 let f=await fixture()
 f.store.put('ticket','ticket',{id:'ticket',assignments:[],ended:Date.now()})
 const next=await buildBackendPackage(resolve('tests/fixtures/history-backend.ts'),{...manifest,version:'1.1.0',capabilities:{...manifest.capabilities,history:false,purge:false}},join(f.root,'v2'))
 f.config.backendPlugins=[{directory:next.directory,digest:next.digest}];activateBackendPackages(f.store,f.config)
 f=reopen(f)
 expect((await f.registry.history(f.first.threadId,f.cwd)).id).toBe(f.first.threadId)
 const cleanup=new HistoryCleanup(f.store,f.config.stateDir),plan=planHistory(f.store,f.config.stateDir,'scope','upgrade',Date.now())
 cleanup.apply(plan);await cleanup.process(f.registry,async()=>true)
 expect(cleanup.receipts()[0]?.status).toBe('completed');expect(existsSync(f.nativeFile)).toBe(false);assertMapping(f,false)
 f.config.backendPlugins=[{directory:f.pkg.directory,digest:f.pkg.digest}];activateBackendPackages(f.store,f.config)
 f=reopen(f);const replayed=new HistoryCleanup(f.store,f.config.stateDir);replayed.apply(plan)
 await replayed.process(f.registry,async()=>true)
 expect(replayed.receipts()[0]?.status).toBe('completed');expect(readFileSync(f.counter,'utf8')).toBe('1')
})
it.each(['all','nativeId'])('does not invent a purge identity when legacy cleanup erased %s mapping fields',async missing=>{
 const f=await fixture(),cleanup=new HistoryCleanup(f.store,f.config.stateDir),broken={...f.record}
 for(const key of missing==='all'?mapping:['nativeId'])delete broken[key]
 f.store.put('backend-plugin-thread',f.first.threadId,broken)
 cleanup.apply(planHistory(f.store,f.config.stateDir,'scope','legacy',Date.now()))
 await cleanup.process(f.registry,async()=>true)
 expect(cleanup.receipts()[0]).toMatchObject({status:'processing',phase:'native_history',nativeDone:[]})
 expect(cleanup.receipts()[0]?.error).toContain(missing==='all'?'identity changed':'invalid_output')
 expect(existsSync(f.nativeFile)).toBe(true);expect(existsSync(f.counter)).toBe(false)
})
