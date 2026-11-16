import {afterEach,expect,it,vi} from 'vitest'
import {mkdtempSync,mkdirSync,readFileSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import * as childProcess from 'node:child_process'
import {CredentialReferences,type CredentialReferencesSnapshot} from '../src/credential-references.ts'
import {Runtime} from '../src/runtime.ts'
import {Store} from '../src/store.ts'
import {configSchema} from '../src/config.ts'
import {SourceRegistry} from '../src/source-plugins.ts'
import {MessageSource} from '../src/sources.ts'
import {serve} from '../src/server.ts'

vi.mock('node:child_process',async importOriginal=>({...await importOriginal<typeof import('node:child_process')>(),spawn:vi.fn(()=>{throw Error('No process calls permitted')})}))

const roots:string[]=[],hosts:Runtime[]=[],observers:Store[]=[],servers:Awaited<ReturnType<typeof serve>>[]=[]
afterEach(async()=>{
 vi.restoreAllMocks();vi.unstubAllEnvs();vi.unstubAllGlobals()
 for(const server of servers.splice(0)){server.server.closeAllConnections();await new Promise<void>(done=>server.server.close(()=>done()))}
 for(const host of hosts.splice(0))await host.close()
 for(const observer of observers.splice(0))observer.close()
 for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true})
})
const row=(value:CredentialReferencesSnapshot,kind:string,id:string)=>value.connections.find(c=>c.kind===kind&&c.id===id)!
function fake(config:Record<string,unknown>={},definitions:unknown[]=[]){
 const host={config:{sources:[],toolConnections:{},backends:{},...config},settings:{current:()=>({revision:7})},sourceRegistry:{connectionDefinitions:()=>definitions}} as unknown as Runtime
 return {host,view:new CredentialReferences(()=>host,()=>1000)}
}
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'credential-references-'));roots.push(root)
 const registry=new SourceRegistry()
 registry.register({apiVersion:1,kind:'credential-fixture',label:'Local fixture',create:c=>new MessageSource(c),connection:{credentials:{TOKEN:'/options/tokenEnv'},setup:{description:'Synthetic local fixture',fields:[{name:'token',label:'Credential',path:'/options/tokenEnv',secret:true,required:true}]}}})
 const config=configSchema.parse({port:0,stateDir:join(root,'state'),work:{sandboxDriver:'disabled',autoRecover:false},sources:[{id:'local',kind:'local',cwd:root,allowedActors:['operator']},{id:'test-source',kind:'credential-fixture',cwd:root,allowedActors:['operator'],options:{tokenEnv:'O18_SENTINEL_ENV_NAME'}}],backends:{api:{kind:'openai-responses',baseUrl:'http://127.0.0.1:1',model:'fixture',apiKeyEnv:'O18_SENTINEL_ENV_NAME'}},execution:{backend:'api'}})
 const model={run:vi.fn(async()=>{throw Error('No model calls permitted')})}
 const host=new Runtime(config,{sourceRegistry:registry,model});hosts.push(host)
 return {root,host,model,view:new CredentialReferences(()=>host,()=>1000)}
}
function db(store:Store){return store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row=>{const name=String(row.name);return [name,store.db.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'"').all().sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))]})}
async function http(){const f=fixture();f.host.pause(true);const server=await serve(f.host);servers.push(server);clearInterval((f.host as any).timer);return {...f,server,endpoint:server.url+'/api/credential-references',headers:{authorization:'Bearer '+readFileSync(server.tokenPath,'utf8').trim()}}}

it('returns only the versioned, host-scoped whitelist, with implicit native authentication unknown',()=>{
 const {view}=fake(),value=view.snapshot()
 expect(value).toEqual({schema:1,observedAt:1000,settingsRevision:7,scope:'host',connections:[{kind:'backend',id:'codex',state:'unknown',references:[{slot:0,purpose:'authentication',state:'unknown'}],verification:'not_checked'}]})
})
for(const [name,value,nonempty,trimmed,defined]of [
 ['missing',undefined,'missing','missing','missing'],['empty','','missing','missing','present'],['whitespace','  ','present','missing','present'],['value','O18_SENTINEL_VALUE','present','present','present'],
]as const)it('preserves existing adapter presence rules for '+name,()=>{
 vi.stubEnv('O18_SENTINEL_ENV_NAME',value)
 const {view}=fake({sources:[{id:'source',kind:'fixture',options:{token:'O18_SENTINEL_ENV_NAME'}}],toolConnections:{stdio:{transport:{kind:'stdio',env:{SECRET_CHILD_NAME:'O18_SENTINEL_ENV_NAME'}}},http:{transport:{kind:'http',headerEnv:{'X-Secret-Header':'O18_SENTINEL_ENV_NAME'}}}},backends:{api:{kind:'openai-responses',apiKeyEnv:'O18_SENTINEL_ENV_NAME',headerEnv:{'X-Secret-Header':'O18_SENTINEL_ENV_NAME'}},plugin:{kind:'plugin',env:{SECRET_CHILD_NAME:'O18_SENTINEL_ENV_NAME'}},native:{kind:'codex',env:{SECRET_CHILD_NAME:'O18_SENTINEL_ENV_NAME'}}}},[{kind:'fixture',setup:{fields:[]},credentials:{TOKEN:'/options/token'}}])
 const result=view.snapshot()
 expect(row(result,'source','source').references).toEqual([{slot:0,purpose:'authentication',state:nonempty}])
 expect(row(result,'tool','stdio').references).toEqual([{slot:0,purpose:'process_environment',state:nonempty}])
 expect(row(result,'tool','http').references[0]!.state).toBe(nonempty)
 expect(row(result,'backend','api').references.map(r=>r.state)).toEqual([trimmed,nonempty])
 expect(row(result,'backend','plugin').references).toEqual([{slot:0,purpose:'process_environment',state:defined}])
 expect(row(result,'backend','native').references.map(r=>r.state)).toEqual([defined,'unknown'])
 const serialized=JSON.stringify(result)
 for(const secret of ['O18_SENTINEL_ENV_NAME','O18_SENTINEL_VALUE','SECRET_CHILD_NAME','X-Secret-Header','/options/token'])expect(serialized).not.toContain(secret)
})
it('keeps OAuth/native and delegated source authentication unknown without reading account or plugin config',()=>{
 const {view}=fake({toolConnections:{delegated:{transport:{kind:'plugin',sourceId:'SECRET_SOURCE'}}},backends:{subscription:{kind:'openai-responses',subscription:{account:'SECRET_ACCOUNT',owner:{actor:'SECRET_ACTOR',source:'SECRET_SOURCE'}},headers:{Authorization:'SECRET_TOKEN'},baseUrl:'https://SECRET_HOST',config:{password:'SECRET_PASSWORD'}},native:{kind:'codex',command:'/SECRET_PATH',args:['SECRET_ARG']}}})
 const result=view.snapshot()
 for(const [kind,id]of [['tool','delegated'],['backend','subscription'],['backend','native']])expect(row(result,kind!,id!).state).toBe('unknown')
 expect(row(result,'backend','subscription').references).toEqual([{slot:0,purpose:'authentication',state:'unknown'}])
 expect(JSON.stringify(result)).not.toContain('SECRET_')
})
it('distinguishes no declared references from unavailable source metadata and absent optional pointers',()=>{
 const {view}=fake({sources:[{id:'missing',kind:'missing'},{id:'legacy',kind:'legacy'},{id:'empty',kind:'empty'},{id:'optional',kind:'optional',options:{}}],toolConnections:{open:{transport:{kind:'http',headerEnv:{}}}},backends:{open:{kind:'openai-chat'},plugin:{kind:'plugin',env:{}}}},[{kind:'legacy',credentials:{}},{kind:'empty',setup:{fields:[]},credentials:{}},{kind:'optional',pluginId:'fixture',credentials:{TOKEN:'/options/token'}}])
 const result=view.snapshot()
 for(const id of ['missing','legacy'])expect(row(result,'source',id)).toMatchObject({state:'unknown',references:[]})
 for(const id of ['empty','optional'])expect(row(result,'source',id)).toMatchObject({state:'not_declared',references:[]})
 expect(row(result,'tool','open').state).toBe('not_declared');expect(row(result,'backend','open').state).toBe('not_declared');expect(row(result,'backend','plugin').state).toBe('not_declared')
})
for(const [name,definition,options]of [
 ['bad pointer',{kind:'fixture',setup:{},credentials:{TOKEN:'SECRET_INVALID_PATH'}},{}],
 ['bad reference',{kind:'fixture',setup:{},credentials:{TOKEN:'/options/token'}},{token:'BAD ENV SECRET'}],
 ['non-string reference',{kind:'fixture',setup:{},credentials:{TOKEN:'/options/token'}},{token:3}],
 ['bad metadata',{kind:'fixture',setup:{},credentials:[]},{}],
 ['duplicate metadata',null,{}],
]as const)it('keeps '+name+' unknown without publishing unrecognized material',()=>{
 const definitions=definition?[definition]:[{kind:'fixture',setup:{},credentials:{}},{kind:'fixture',setup:{},credentials:{}}]
 const {view}=fake({sources:[{id:'source',kind:'fixture',options}]},definitions)
 const result=view.snapshot();expect(row(result,'source','source').state).toBe('unknown');expect(JSON.stringify(result)).not.toContain('SECRET')
})
it('prioritizes a known missing reference over unknown without claiming authentication',()=>{
 vi.stubEnv('O18_SENTINEL_ENV_NAME',undefined)
 const {view}=fake({backends:{native:{kind:'codex',env:{TOKEN:'O18_SENTINEL_ENV_NAME'}}}})
 expect(row(view.snapshot(),'backend','native')).toMatchObject({state:'missing',verification:'not_checked',references:[{state:'missing'},{state:'unknown'}]})
})
it('captures one Runtime per snapshot and does not cache by revision or retain environment values',()=>{
 vi.stubEnv('O18_SENTINEL_ENV_NAME',undefined)
 const a=fake({backends:{one:{kind:'plugin',env:{TOKEN:'O18_SENTINEL_ENV_NAME'}}}}),b=fake({backends:{two:{kind:'plugin',env:{}}}})
 let active=a.host,calls=0
 const view=new CredentialReferences(()=>{calls++;return active},()=>1000)
 vi.spyOn(a.host.settings,'current').mockImplementation(()=>{active=b.host;return {revision:7}as any})
 expect(view.snapshot().connections.map(c=>c.id)).toEqual(['codex','one']);expect(calls).toBe(1)
 expect(view.snapshot().connections.map(c=>c.id)).toEqual(['codex','two']);expect(calls).toBe(2)
 const other=new CredentialReferences(()=>a.host,()=>1000),first=other.snapshot()
 vi.stubEnv('O18_SENTINEL_ENV_NAME','O18_SENTINEL_VALUE');const next=other.snapshot()
 expect(first.settingsRevision).toBe(next.settingsRevision);expect(row(first,'backend','one').state).toBe('missing');expect(row(next,'backend','one').state).toBe('present');expect(row(first,'backend','one').state).toBe('missing')
})
it('leaves every host and observer table unchanged, including running records, with no connection/model/network/process calls',()=>{
 const f=fixture(),directory=join(f.root,'state','watchdog');mkdirSync(directory,{recursive:true});const observer=new Store(join(directory,'state.sqlite'));observers.push(observer)
 f.host.store.put('model-usage','running',{state:'running',secret:'SECRET_RUNNING'});observer.put('model-usage','running',{state:'running'})
 const before=db(f.host.store),observerBefore=db(observer),changes=f.host.store.db.prepare('SELECT total_changes() AS n').get()!.n
 const forbidden=()=>{throw Error('Forbidden operation')}
 const fetch=vi.fn(forbidden);vi.stubGlobal('fetch',fetch)
 const spawn=vi.mocked(childProcess.spawn);spawn.mockClear()
 const create=vi.spyOn(f.host.sourceRegistry,'create').mockImplementation(forbidden),validate=vi.spyOn(f.host.sourceRegistry,'validate').mockImplementation(forbidden),catalog=vi.spyOn(f.host.sourceRegistry,'catalog').mockImplementation(forbidden)
 const tools=vi.spyOn(f.host.toolConnections,'catalog').mockImplementation(forbidden),call=vi.spyOn(f.host.toolConnections,'call').mockImplementation(forbidden)
 for(const source of f.host.sources.values()){source.poll=vi.fn(forbidden);source.identity=vi.fn(forbidden);source.members=vi.fn(forbidden)}
 for(let i=0;i<3;i++)expect(f.view.snapshot()).toMatchObject({schema:1,settingsRevision:0})
 for(const spy of [fetch,spawn,create,validate,catalog,tools,call,f.model.run])expect(spy).not.toHaveBeenCalled()
 for(const source of f.host.sources.values())for(const fn of [source.poll,source.identity,source.members])expect(fn).not.toHaveBeenCalled()
 expect(db(f.host.store)).toEqual(before);expect(db(observer)).toEqual(observerBefore);expect(f.host.store.db.prepare('SELECT total_changes() AS n').get()!.n).toBe(changes)
})
it('requires an operator, accepts GET only and rejects every query including empty workspace selectors',async()=>{
 const f=await http(),before=db(f.host.store)
 expect((await fetch(f.endpoint)).status).toBe(401);expect((await fetch(f.endpoint,{headers:{authorization:'Bearer wrong'}})).status).toBe(401)
 for(const method of ['POST','PATCH','DELETE','HEAD','OPTIONS'])expect((await fetch(f.endpoint,{method,headers:f.headers})).status).toBe(405)
 for(const query of ['?workspace=','?workspace=one','?x=','?%77orkspace=one','?&&','?foo=a&foo=b']){const response=await fetch(f.endpoint+query,{headers:f.headers});expect(response.status).toBe(400);expect(await response.json()).toEqual({code:'credential_references_query_invalid'})}
 const response=await fetch(f.endpoint,{headers:f.headers});expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('no-store');expect(await response.json()).toMatchObject({schema:1,scope:'host',settingsRevision:0});expect(db(f.host.store)).toEqual(before)
})
it('returns a fixed 503 for metadata errors and recovers on the next read without recording the exception',async()=>{
 const f=await http(),before=db(f.host.store),original=f.host.sourceRegistry.connectionDefinitions.bind(f.host.sourceRegistry)
 const definitions=vi.spyOn(f.host.sourceRegistry,'connectionDefinitions').mockImplementation(()=>{throw Error('SECRET_RAW_PROVIDER_ERROR /SECRET_PATH')})
 const response=await fetch(f.endpoint,{headers:f.headers});expect(response.status).toBe(503);expect(await response.json()).toEqual({code:'credential_references_unavailable'});expect(db(f.host.store)).toEqual(before)
 definitions.mockImplementation(original);expect((await fetch(f.endpoint,{headers:f.headers})).status).toBe(200);expect(db(f.host.store)).toEqual(before)
})
for(const clock of [NaN,-1,Infinity,Number.MAX_SAFE_INTEGER])it('rejects invalid observation time '+clock,()=>{expect(()=>new CredentialReferences(()=>fake().host,()=>clock).snapshot()).toThrow('Credential references unavailable')})
it('rejects invalid current revision without treating it as a cache key',()=>{const f=fake();vi.spyOn(f.host.settings,'current').mockReturnValue({revision:-1}as any);expect(()=>f.view.snapshot()).toThrow('Credential references unavailable')})
