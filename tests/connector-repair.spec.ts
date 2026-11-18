import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach,expect,it,vi} from 'vitest'
import {Runtime} from '../src/runtime.ts'
import {configSchema,type Config} from '../src/config.ts'
import {SourceRegistry} from '../src/source-plugins.ts'
import {MessageSource} from '../src/sources.ts'
import {serve} from '../src/server.ts'
import * as managed from '../src/managed-config.ts'
import {ConnectorManagement} from '../src/connector-management.ts'
import {Onboarding} from '../src/onboarding.ts'
import {request as httpRequest} from 'node:http'
const cleanups:(()=>Promise<void>)[]=[]
afterEach(async()=>{for(const cleanup of cleanups.splice(0))await cleanup();vi.restoreAllMocks()})
async function fixture(){
 let failures=0
 const initialEnv=new Set(Object.keys(process.env))
 const root=mkdtempSync(join(tmpdir(),'connector-draft-http-')),calls={identity:0,members:0,poll:0,start:0,deliver:0,model:0},registry=new SourceRegistry()
 class FixtureSource extends MessageSource {
  async identity(){calls.identity++;return {id:'fixture-bot',type:'bot',verified:true}}
  async members(){calls.members++;return [{id:'USER',bot:false}]}
  async poll(){calls.poll++}
  async start(){calls.start++}
  override async deliver(){calls.deliver++}
 }
 registry.register({apiVersion:1,kind:'fixture-im',label:'Fixture IM',create:c=>new FixtureSource(c),connection:{scopesPath:'/options/rooms',credentials:{TOKEN:'/options/tokenEnv'},validate:c=>{if(!Array.isArray(c.options.rooms)||!c.options.rooms.length)throw Error('SECRET_SCHEMA')},setup:{description:'Local fixture',fields:[{name:'rooms',path:'/options/rooms',label:'Rooms',input:'tags',required:true,secret:false},{name:'token',path:'/options/tokenEnv',label:'Token',required:true,secret:true}]}}})
 let host:Runtime
 const create=(config:Config,_activation?:string,startupSourceIds?:readonly string[])=>{if(failures-->0)throw Error('SECRET_REBUILD_FAILURE');host=new Runtime(config,{sourceRegistry:registry,startupSourceIds,model:{async run(){calls.model++;throw Error('No inference allowed')}}});return host}
 const startup=configSchema.parse({port:0,stateDir:join(root,'state'),work:{sandboxDriver:'disabled',autoRecover:false},sources:[{id:'local',kind:'local',cwd:root,allowedActors:['operator'],workspace:{mode:'source'}}]});create(structuredClone(startup));host!.pause(true)
 const http=await serve(host!,{createRuntime:create}),headers={'content-type':'application/json',authorization:'Bearer '+readFileSync(http.tokenPath,'utf8').trim()}
 cleanups.push(async()=>{await new Promise<void>(resolve=>http.server.close(()=>resolve()));if(!host.shuttingDown)await host.close();for(const key of Object.keys(process.env))if(!initialEnv.has(key)&&key.startsWith('AGENTHUB_SETUP_CONNECTOR_'))delete process.env[key];rmSync(root,{recursive:true,force:true})})
 const post=(path:string,input:unknown)=>fetch(http.url+path,{method:'POST',headers,body:JSON.stringify(input)})
 const draft={revision:0,kind:'fixture-im',label:'Draft',intent:'draft',actors:[],fields:{rooms:'ROOM'},credentials:{token:'SECRET_DRAFT_CREDENTIAL'}}
 return {host:()=>host,http,headers,post,draft,calls,startup,registry,create,fail:(count=1)=>{failures=count}}
}
async function installed(){
 const f=await fixture(),p=await (await f.post('/api/connectors/plan',f.draft)).json()
 expect((await f.post('/api/plugin-market/connection/apply',{id:p.id})).status).toBe(200)
 const source=f.host().config.sources.find(s=>s.kind==='fixture-im')!
 const input=(extra={})=>({sourceId:source.id,revision:f.host().settings.current().revision,fields:{rooms:'REPAIRED'},credentials:{},...extra})
 const plan=async(extra={})=>{const r=await f.post('/api/connectors/repair/plan',input(extra));expect(r.status).toBe(200);return r.json()}
 return {...f,source,input,plan}
}
it('repairs the managed disabled source in place, retains authority and persists from the original startup configuration',async()=>{
 const f=await installed(),before=structuredClone(f.source),oldKey=String(before.options.tokenEnv),read=await f.post('/api/connectors/repair/read',{sourceId:before.id,revision:1})
 expect(await read.json()).toMatchObject({sourceId:before.id,fields:{rooms:['ROOM']},enabled:false,credentialAvailability:[{field:'token',available:true}]})
 const probe=await f.post('/api/connectors/probe',{sourceId:before.id,revision:1,level:'configuration',requestId:crypto.randomUUID()});expect((await probe.json()).status).toBe('passed')
 const p=await f.plan({credentials:{token:'SECRET_REPAIR_VALUE'}})
 expect(JSON.stringify(p)).not.toMatch(/SECRET|tokenEnv/)
 expect((await f.post('/onboarding/check',{id:p.id})).status).toBe(400)
 const response=await f.post('/api/plugin-market/connection/apply',{id:p.id}),receipt=await response.json();expect(response.status).toBe(200)
 const source=f.host().config.sources.find(s=>s.id===before.id)!,newKey=String(source.options.tokenEnv)
 expect({...source,options:before.options}).toEqual(before);expect(source.options.rooms).toEqual(['REPAIRED']);expect(newKey).not.toBe(oldKey)
 expect(managed.managedSecrets(f.host().config.stateDir)).toMatchObject({[oldKey]:'SECRET_DRAFT_CREDENTIAL',[newKey]:'SECRET_REPAIR_VALUE'})
 expect(f.host().config.toolConnections).toEqual({});expect(receipt.ready).toBe(false)
 expect(new ConnectorManagement(f.host).snapshot().instances[0]!.layers.configuration).toMatchObject({status:'stale',current:false})
 expect((await (await f.post('/api/plugin-market/connection/apply',{id:p.id})).json()).replayed).toBe(true)
 await f.host().close();const fresh=f.create(structuredClone(f.startup));fresh.pause(true)
 expect(fresh.config.sources.find(s=>s.id===before.id)).toEqual(source);expect(process.env[newKey]).toBe('SECRET_REPAIR_VALUE')
 expect(JSON.stringify(new ConnectorManagement(()=>fresh).snapshot())).not.toContain('SECRET_');expect(JSON.stringify(new ConnectorManagement(()=>fresh).snapshot().instances)).not.toContain(newKey)
 expect(f.calls).toEqual({identity:0,members:0,poll:0,start:0,deliver:0,model:0})
})
it('blank credentials preserve their existing reference and illegal authority edits are rejected',async()=>{
 const f=await installed(),p=await f.plan({credentials:{token:''}})
 expect((await f.post('/api/plugin-market/connection/apply',{id:p.id})).status).toBe(200)
 expect(f.host().config.sources.find(s=>s.id===f.source.id)?.options.tokenEnv).toBe(f.source.options.tokenEnv)
 for(const extra of [{actors:['ATTACKER']},{enabled:true},{fields:{allowedActors:'ATTACKER'}},{credentials:{arbitrary:'SECRET'}}])expect((await f.post('/api/connectors/repair/plan',{...f.input(),...extra})).status).toBe(400)
 const unmanaged=f.host().config.sources[0]!
 expect((await f.post('/api/connectors/repair/read',{sourceId:unmanaged.id,revision:2})).status).toBe(400)
})
it('rejects stale revision and changes during pause without committing repaired files or settings',async()=>{
 const f=await installed(),p=await f.plan(),host=f.host(),before=managed.managedConnections(host.config.stateDir)
 const pause=vi.spyOn(host,'pauseForConfiguration').mockImplementation(async()=>{host.updateSettings(1,{sources:host.config.sources.map(s=>s.id===f.source.id?{...s,enabled:true,allowedActors:['USER']}:s)});return true})
 const response=await f.post('/api/plugin-market/connection/apply',{id:p.id});expect(response.status).not.toBe(200)
 expect(managed.managedConnections(host.config.stateDir)).toEqual(before);expect(host.config.sources.find(s=>s.id===f.source.id)?.options.rooms).toEqual(['ROOM'])
 pause.mockRestore();expect((await f.post('/api/connectors/repair/plan',{...f.input(),revision:1})).status).toBe(409)
})
it('rolls back a failed rebuild and safely retries the same reviewed plan without losing old secrets',async()=>{
 const f=await installed(),before=f.host().settings.current(),files=managed.managedConnections(f.host().config.stateDir),secrets=managed.managedSecrets(f.host().config.stateDir),p=await f.plan({credentials:{token:'SECRET_NEW'}})
 f.fail();const failed=await f.post('/api/plugin-market/connection/apply',{id:p.id});expect(failed.status).toBe(503);expect(await failed.json()).toMatchObject({code:'setup_apply_failed'})
 expect(f.host().settings.current()).toEqual(before);expect(managed.managedConnections(f.host().config.stateDir)).toEqual(files);expect(managed.managedSecrets(f.host().config.stateDir)).toEqual(secrets);expect(f.host().status().paused).toBe(true)
 // A rebuild changes the host identity; an uncommitted plan requires fresh review.
 expect((await f.post('/api/plugin-market/connection/apply',{id:p.id})).status).toBe(409)
 const fresh=await f.plan({credentials:{token:'SECRET_NEW'}});expect((await f.post('/api/plugin-market/connection/apply',{id:fresh.id})).status).toBe(200)
})
it('reports recovery-required, not restored, when rollback itself fails',async()=>{
 const f=await installed(),p=await f.plan(),real=managed.prepareManagedConfig
 const mock=vi.spyOn(managed,'prepareManagedConfig').mockImplementation((...args)=>{const txn=real(...args);return {...txn,rollback(){throw Error('SECRET_ROLLBACK_FAILURE')}}})
 f.fail();const response=await f.post('/api/plugin-market/connection/apply',{id:p.id}),body=await response.json()
 expect(response.status).toBe(503);expect(body.code).toBe('setup_recovery_required');expect(body.error).toContain('could not be fully restored');expect(JSON.stringify(body)).not.toContain('SECRET')
 mock.mockRestore()
})
it('fences definition or host changes and preserves the startup deployment conflict check',async()=>{
 const f=await installed(),manager=new ConnectorManagement(f.host),p=manager.repairPlan(f.input())
 const definitions=f.registry.connectionDefinitions(),changed=vi.spyOn(f.registry,'connectionDefinitions').mockReturnValue(definitions.map(d=>d.kind==='fixture-im'?{...d,label:'Changed definition'}:d))
 expect(()=>p.revalidate()).toThrow('connector_conflict');changed.mockRestore()
 await f.host().close();f.create(structuredClone(f.startup));expect(()=>p.revalidate()).toThrow('connector_conflict')
 const collision=structuredClone(f.startup);collision.sources.push({...f.source,options:{...f.source.options,rooms:['STARTUP_OWNED']}})
 expect(()=>managed.loadManagedConfig(collision)).toThrow('Managed workspace conflicts')
})
it.each(['/api/connectors/repair/read','/api/connectors/repair/plan','/api/plugin-market/connection/apply','/onboarding/apply','/entry-setup/apply','/entry-setup/model/apply'])('rechecks operator after slow body for %s',async path=>{
 const f=await installed(),p=await f.plan()
 clearInterval((f.host() as unknown as {timer:ReturnType<typeof setInterval>}).timer)
 const post=(path:string,body:unknown,cookie?:string)=>new Promise<{status:number;cookie?:string}>((resolve,reject)=>{
  const req=httpRequest(f.http.url+path,{method:'POST',agent:false,headers:{origin:f.http.url,'content-type':'application/json',...(cookie?{cookie}:{})}},res=>{res.resume();res.on('end',()=>resolve({status:res.statusCode!,cookie:res.headers['set-cookie']?.[0]?.split(';')[0]}))});req.on('error',reject);req.end(JSON.stringify(body))
 })
 const paired=await post('/pair',{code:new URL(f.http.operatorUrl).hash.slice('#pair='.length)});expect(paired.status).toBe(200)
 const cookie=paired.cookie!,text=JSON.stringify(path.endsWith('/apply')?{id:p.id}:path.endsWith('/read')?{sourceId:f.source.id,revision:1}:f.input())
 let arrived!:()=>void;const started=new Promise<void>(r=>{arrived=r});f.http.server.on('request',req=>{if(req.url===path)req.once('data',arrived)})
 let req!:ReturnType<typeof httpRequest>;const response=new Promise<number>((resolve,reject)=>{req=httpRequest(f.http.url+path,{method:'POST',agent:false,headers:{cookie,origin:f.http.url,'content-type':'application/json','content-length':Buffer.byteLength(text)}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode!))});req.on('error',reject)})
 req.write(text.slice(0,1));await started;expect((await post('/logout',{},cookie)).status).toBe(200);req.end(text.slice(1));expect(await response).toBe(401)
 expect(f.host().settings.current().revision).toBe(1);expect(f.host().config.sources.find(s=>s.id===f.source.id)?.options.rooms).toEqual(['ROOM'])
})
it('does not overwrite managed credentials changed while waiting for configuration quiescence',async()=>{
 const f=await installed(),p=await f.plan({credentials:{token:'SECRET_NEW'}}),host=f.host(),before=host.settings.current(),secrets=managed.managedSecrets(host.config.stateDir),key=String(f.source.options.tokenEnv),pause=host.pauseForConfiguration.bind(host)
 vi.spyOn(host,'pauseForConfiguration').mockImplementation(async()=>{const previous=await pause();managed.atomicPrivateFile(managed.managedFiles(host.config.stateDir).secrets,JSON.stringify({...secrets,[key]:'EXTERNAL_CHANGE'}));return previous})
 const response=await f.post('/api/plugin-market/connection/apply',{id:p.id});expect(response.status).toBe(409);expect(await response.json()).toMatchObject({code:'settings_conflict'})
 expect(host.settings.current()).toEqual(before);expect(managed.managedSecrets(host.config.stateDir)).toEqual({...secrets,[key]:'EXTERNAL_CHANGE'});expect(host.status().paused).toBe(true)
})
it('refuses repair when the same managed source is also declared by the original startup configuration',async()=>{
 const f=await installed(),startup=structuredClone(f.startup);startup.sources.push(structuredClone(f.source))
 await f.host().close();const reopened=f.create(startup),manager=new ConnectorManagement(()=>reopened)
 expect(reopened.startupSourceIds).toContain(f.source.id);expect(manager.snapshot().instances[0]!.repairAvailable).toBe(false)
 expect(()=>manager.repairPlan(f.input())).toThrow('connector_unsupported')
})
it.each(['/api/plugin-market/connection/apply','/onboarding/apply','/entry-setup/apply','/entry-setup/model/apply'])('rechecks the applying operator after pause at %s',async path=>{
 const f=await installed(),p=await f.plan({credentials:{token:'SECRET_NOT_COMMITTED'}}),host=f.host(),before=host.settings.current(),connections=managed.managedConnections(host.config.stateDir),secrets=managed.managedSecrets(host.config.stateDir)
 clearInterval((host as unknown as {timer:ReturnType<typeof setInterval>}).timer)
 const post=(path:string,body:unknown,cookie?:string)=>new Promise<{status:number;cookie?:string}>((resolve,reject)=>{
  const req=httpRequest(f.http.url+path,{method:'POST',agent:false,headers:{origin:f.http.url,'content-type':'application/json',...(cookie?{cookie}:{})}},res=>{res.resume();res.on('end',()=>resolve({status:res.statusCode!,cookie:res.headers['set-cookie']?.[0]?.split(';')[0]}))});req.on('error',reject);req.end(JSON.stringify(body))
 })
 const paired=await post('/pair',{code:new URL(f.http.operatorUrl).hash.slice('#pair='.length)});expect(paired.status).toBe(200)
 let release!:()=>void,arrive!:()=>void;const waiting=new Promise<void>(r=>{arrive=r}),gate=new Promise<void>(r=>{release=r}),pause=host.pauseForConfiguration.bind(host)
 vi.spyOn(host,'pauseForConfiguration').mockImplementation(async()=>{const previous=await pause();arrive();await gate;return previous})
 const request=post(path,{id:p.id},paired.cookie);await waiting
 try{expect((await post('/logout',{},paired.cookie)).status).toBe(200)}finally{release()}
 expect((await request).status).toBe(401);expect(host.settings.current()).toEqual(before);expect(host.status().paused).toBe(true)
 expect(managed.managedConnections(host.config.stateDir)).toEqual(connections);expect(managed.managedSecrets(host.config.stateDir)).toEqual(secrets)
})
it('does not claim rollback succeeded when file preparation fails before returning its transaction handle',async()=>{
 const f=await installed(),p=await f.plan({credentials:{token:'SECRET_PREPARE'}}),real=managed.prepareManagedConfig
 vi.spyOn(managed,'prepareManagedConfig').mockImplementation((...args)=>{real(...args);throw Error('SECRET_PREPARE_AND_ROLLBACK_FAILURE')})
 const response=await f.post('/api/plugin-market/connection/apply',{id:p.id}),body=await response.json()
 expect(response.status).toBe(503);expect(body.code).toBe('setup_recovery_required');expect(body.error).toContain('could not be fully restored');expect(JSON.stringify(body)).not.toContain('SECRET')
 expect(f.host().settings.current().revision).toBe(1);expect(f.host().status().paused).toBe(true)
})
