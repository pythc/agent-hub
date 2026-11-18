import {ProcessSource} from '../src/plugin-process.ts'
import {afterEach,expect,it,vi} from 'vitest'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {randomUUID} from 'node:crypto'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
import {SourceRegistry} from '../src/source-plugins.ts'
import {MessageSource} from '../src/sources.ts'
import {ConnectorManagement} from '../src/connector-management.ts'
import {pluginManifestSchema} from '../src/plugin-package.ts'
import {serve} from '../src/server.ts'

const roots:string[]=[],hosts:Runtime[]=[]
afterEach(async()=>{for(const host of hosts.splice(0))await host.close();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});delete process.env.CONNECTOR_TEST_TOKEN})
function fixture(options:ConstructorParameters<typeof ConnectorManagement>[1]={},events=true){
 process.env.CONNECTOR_TEST_TOKEN='fixture-local-credential'
 const root=mkdtempSync(join(tmpdir(),'connector-management-'));roots.push(root)
 const registry=new SourceRegistry()
 registry.register({apiVersion:1,kind:'fixture-im',label:'Fixture IM',create:c=>new MessageSource(c),scopes:c=>c.options.channels as string[],connection:{scopesPath:'/options/channels',credentials:{TOKEN:'/options/tokenEnv'},validate:c=>{if(!Array.isArray(c.options.channels)||!c.options.channels.length||typeof c.options.team!=='string')throw Error('Invalid fixture fields')},setup:{description:'Fixture app setup',serviceUrl:'http://127.0.0.1:1234/',fields:[{name:'team',label:'Team ID',path:'/options/team',required:true,secret:false},{name:'channels',label:'Channel IDs',path:'/options/channels',input:'tags',required:true,secret:false},{name:'token',label:'Bot credential',path:'/options/tokenEnv',required:true,secret:true}]}}})
 const config=configSchema.parse({stateDir:join(root,'state'),port:0,work:{sandboxDriver:'disabled',network:false},sources:[{id:'local',kind:'local',cwd:root,allowedActors:['operator'],workspace:{mode:'source'}},{id:'team',kind:'fixture-im',cwd:root,allowedActors:['USER'],capabilities:{events,replies:true,resources:true},options:{channels:['C1','C2'],team:'T1',tokenEnv:'CONNECTOR_TEST_TOKEN'}}]})
 const host=new Runtime(config,{sourceRegistry:registry,model:{async run(){throw Error('No model calls expected')}}});hosts.push(host)
 const source=host.sources.get('team')!;source.identity=vi.fn(async()=>({id:'verified-bot',type:'bot',verified:true}));source.members=vi.fn(async()=>[{id:'USER',bot:false}]);source.deliver=vi.fn(async()=>{});source.poll=vi.fn(async()=>{})
 const manager=new ConnectorManagement(()=>host,{evidenceMode:'fixture',...options})
 const probe=(level:'configuration'|'reachable'|'authentication'|'capabilities',requestId=randomUUID(),revision=host.settings.current().revision)=>manager.probe({sourceId:'team',level,requestId,revision})
 const draft={revision:0,kind:'fixture-im',label:'New team',actors:['USER'],fields:{team:'T1',channels:'C1, C2'},credentials:{token:'never-echo-this-credential'}}
 return {host,manager,source,probe,draft}
}
it('uses registered plugin metadata and keeps definitions, instances and diagnostics separate',()=>{
 const f=fixture();delete process.env.CONNECTOR_TEST_TOKEN;const view=f.manager.snapshot()
 expect(view.definitions.find(d=>d.kind==='fixture-im')).toMatchObject({setupAvailable:true,fields:expect.arrayContaining([expect.objectContaining({name:'token',path:'/options/tokenEnv',credential:true})])})
 expect(view.definitions.some(d=>d.kind==='slack')).toBe(false)
 expect(view.instances).toMatchObject([{id:'team',scopeCount:2,configured:true,realCall:{status:'not_tested'},credentialReferences:[{field:'Bot credential',available:false}]}])
 expect(view.diagnostics).toEqual([]);expect(view.instances[0]).not.toHaveProperty('options');expect(view.instances[0]).not.toHaveProperty('tokenEnv')
})
it('builds a disabled source recipe for existing onboarding without saving, granting tools or invoking adapters',()=>{
 const f=fixture(),plan=f.manager.plan(f.draft)
 expect(plan.source).toMatchObject({kind:'fixture-im',enabled:false,allowedActors:['USER'],options:{team:'T1',channels:['C1','C2']},sandbox:'read-only'})
 expect(Object.values(plan.credentials)).toEqual(['never-echo-this-credential']);expect(plan.source.options.tokenEnv).toMatch(/^AGENTHUB_SETUP_CONNECTOR_/)
 expect(f.manager.validate(f.draft)).toEqual({valid:true,revision:0,code:'configuration_valid',networkTested:false,realCall:false,startsDisabled:true,credentialAvailability:[{field:'token',available:true}]})
 expect(f.host.config.sources).toHaveLength(2);expect(f.host.config.toolConnections).toEqual({});expect(f.source.identity).not.toHaveBeenCalled()
 expect(JSON.stringify(f.manager.snapshot())).not.toContain('never-echo-this-credential')
})
it('accepts credential environment references without reading or returning secret values',()=>{
 const f=fixture();process.env.CONNECTOR_TEST_TOKEN='host-only-token'
 const plan=f.manager.plan({...f.draft,credentialMode:'environment',credentials:{token:'CONNECTOR_TEST_TOKEN'}})
 expect(plan.credentials).toEqual({});expect(plan.source.options.tokenEnv).toBe('CONNECTOR_TEST_TOKEN')
 expect(f.manager.snapshot().instances[0]?.credentialReferences).toEqual([{field:'Bot credential',available:true}])
 expect(JSON.stringify(f.manager.snapshot())).not.toContain('host-only-token')
 expect(()=>f.manager.plan({...f.draft,credentialMode:'environment',credentials:{token:'bad env name'}})).toThrow('connector_invalid')
})
it('rejects wrong field placement, unknown fields, missing scopes and stale setup plans with fixed error codes',()=>{
 const f=fixture()
 for(const change of [{fields:{...f.draft.fields,token:'secret'}},{credentials:{token:'secret',team:'T1'}},{fields:{...f.draft.fields,arbitrary:'/etc/passwd'}},{fields:{team:'T1',channels:''}},{kind:'not-installed'}])expect(()=>f.manager.plan({...f.draft,...change})).toThrow(/connector_invalid|connector_missing/)
 f.host.updateSettings(0,{sources:f.host.config.sources});expect(()=>f.manager.plan(f.draft)).toThrow('connector_conflict')
})
it('validates the builtin Feishu recipe using the same form contract and requires explicit chat IDs',()=>{
 const f=fixture(),draft={revision:0,kind:'feishu',label:'Feishu bot',actors:['ou_user'],fields:{chats:'oc_chat'},credentials:{'app-id':'cli_app','app-secret':'feishu-secret'}}
 expect(f.manager.plan(draft).source).toMatchObject({kind:'feishu',feishu:{chats:['oc_chat'],liveEvents:false,directMessages:false,otherChats:'ignore'}})
 expect(f.manager.validate({...draft,fields:{chats:'not-a-chat'}})).toMatchObject({valid:false,code:'connector_invalid'})
})
it('checks reachability separately using HEAD and does not infer authentication or message capabilities',async()=>{
 const request=vi.fn<typeof fetch>(async()=>new Response(null,{status:403})),f=fixture({fetch:request}),result=await f.probe('reachable')
 expect(result).toMatchObject({status:'passed',level:'reachable',code:'service_reachable',evidenceMode:'fixture',realCall:false})
 expect(request).toHaveBeenCalledWith('http://127.0.0.1:1234/',expect.objectContaining({method:'HEAD',redirect:'error',signal:expect.any(AbortSignal)}))
 expect(f.source.identity).not.toHaveBeenCalled();expect(f.source.deliver).not.toHaveBeenCalled()
 const layers=f.manager.snapshot().instances[0]!.layers;expect(layers.authentication).toBeNull();expect(layers.capabilities).toBeNull()
})
it('never stores or returns adapter identities, exception text, raw responses or credentials',async()=>{
 const f=fixture(),secret='stderr-token-and-provider-response';f.source.identity=async()=>{throw Error(secret)}
 const result=await f.probe('authentication');expect(result).toMatchObject({status:'failed',code:'authentication_not_verified',realCall:false})
 expect(JSON.stringify(result)+JSON.stringify(f.manager.snapshot())+JSON.stringify(f.host.store.list('connector-diagnostic'))).not.toContain(secret)
 f.source.identity=async()=>({id:secret,type:'bot',verified:true,rawResponse:{token:secret}} as any)
 expect((await f.probe('authentication')).status).toBe('passed')
 const output=JSON.stringify(f.manager.snapshot());expect(output).not.toContain(secret);expect(output).not.toContain('requestFingerprint');expect(output).not.toContain('rawResponse');expect(output).not.toContain('fingerprint')
})
it('verifies directory reads only for current allowed scopes without calling send, receive or history APIs',async()=>{
 const f=fixture();f.host.updateSettings(0,{sources:f.host.config.sources.map(s=>s.id==='team'?{...s,listenScopes:['C2']}:s)})
 expect(await f.probe('capabilities')).toMatchObject({status:'passed',checkedCapabilities:['member_directory'],checkedScopes:1,realCall:false})
 expect(f.source.members).toHaveBeenCalledExactlyOnceWith('C2');expect(f.source.deliver).not.toHaveBeenCalled();expect(f.source.poll).not.toHaveBeenCalled();expect(f.manager.snapshot().instances[0]?.realCall).toEqual({status:'not_tested'})
})
it('does not turn an unverified identity into authenticated state or claim unavailable diagnostics passed',async()=>{
 const f=fixture();f.source.identity=async()=>({id:'bot',type:'bot'})
 expect(await f.probe('authentication')).toMatchObject({status:'unknown',code:'identity_unverified'})
 f.source.members=undefined;expect(await f.probe('capabilities')).toMatchObject({status:'unsupported',code:'directory_probe_unavailable'})
})
it('deduplicates request receipts and rejects reusing a request ID with another operation',async()=>{
 const f=fixture(),requestId=randomUUID(),[first,second]=await Promise.all([f.probe('authentication',requestId),f.probe('authentication',requestId)])
 expect(first).toEqual(second);expect(f.source.identity).toHaveBeenCalledTimes(1)
 expect(await f.probe('authentication',requestId)).toEqual(first);expect(f.source.identity).toHaveBeenCalledTimes(1)
 await expect(f.probe('configuration',requestId)).rejects.toThrow('connector_request_conflict')
})
it('fences an older probe at the same revision from replacing newer evidence',async()=>{
 const f=fixture();let release!:(v:any)=>void
 f.source.identity=vi.fn().mockImplementationOnce(()=>new Promise(r=>{release=r})).mockResolvedValue({id:'bot',type:'bot',verified:true})
 const older=f.probe('authentication');await Promise.resolve();const newer=await f.probe('authentication');release({id:'old-bot',type:'bot',verified:true})
 expect(await older).toMatchObject({status:'stale',code:'configuration_changed'})
 expect(f.manager.snapshot().instances[0]!.layers.authentication).toMatchObject({id:newer.id,status:'passed',current:true})
})
it('marks in-flight results stale when settings change and leaves fresh settings authoritative',async()=>{
 const f=fixture();let release!:(v:any)=>void;f.source.identity=()=>new Promise(r=>{release=r})
 const pending=f.probe('authentication');await Promise.resolve();f.host.updateSettings(0,{sources:f.host.config.sources.map(s=>s.id==='team'?{...s,allowedActors:['OTHER']}:s)})
 release({id:'bot',type:'bot',verified:true});expect(await pending).toMatchObject({status:'stale',revision:0});expect(f.manager.snapshot().instances[0]!.layers.authentication).toMatchObject({current:false})
})
it('revokes new diagnostics through existing settings and does not undo previous effects',async()=>{
 const f=fixture(),requestId=randomUUID(),result=f.manager.control({sourceId:'team',revision:0,enabled:false,requestId})
 expect(result).toEqual({sourceId:'team',enabled:false,revision:1,previousEffects:'unchanged'})
 expect(f.manager.control({sourceId:'team',revision:0,enabled:false,requestId})).toEqual(result);expect(f.host.config.sources.find(s=>s.id==='team')!.enabled).toBe(false)
 await expect(f.probe('authentication')).rejects.toThrow('connector_disabled');expect(f.source.identity).not.toHaveBeenCalled();expect(await f.probe('configuration')).toMatchObject({status:'passed'})
 expect(()=>f.manager.control({sourceId:'local',revision:1,enabled:false,requestId:randomUUID()})).toThrow('connector_unsupported')
})
it('rechecks revocation between directory calls so a stopped connection cannot continue across scopes',async()=>{
 const f=fixture();let release!:(v:any)=>void;f.source.members=vi.fn(()=>new Promise<{id:string}[]>(r=>{release=r}))
 const pending=f.probe('capabilities');await Promise.resolve();f.manager.control({sourceId:'team',revision:0,enabled:false,requestId:randomUUID()});release([]);await pending;await Promise.resolve();await Promise.resolve()
 expect(f.source.members).toHaveBeenCalledTimes(1);const record=f.manager.snapshot().instances[0]!.layers.capabilities;expect(['stale','interrupted']).toContain(record?.status);expect(record?.current).toBe(false)
})
it('times out bounded diagnostics and never promotes late replies to a passed result',async()=>{
 const f=fixture({timeoutMs:10});let release!:(v:any)=>void;f.source.identity=()=>new Promise(r=>{release=r})
 expect(await f.probe('authentication')).toMatchObject({status:'interrupted',code:'probe_interrupted'})
 release({id:'late',type:'bot',verified:true});await Promise.resolve();await Promise.resolve();expect(f.manager.snapshot().instances[0]!.layers.authentication?.status).toBe('interrupted')
})
it('does not replay a persisted interrupted probe after reconstructing the management service',async()=>{
 const f=fixture(),requestId=randomUUID(),input={sourceId:'team',revision:0,level:'authentication' as const,requestId},result=await f.manager.probe(input),record=f.host.store.get<any>('connector-diagnostic',requestId)
 f.host.store.put('connector-diagnostic',requestId,{...record,status:'running',finishedAt:undefined})
 expect(await new ConnectorManagement(()=>f.host).probe(input)).toMatchObject({id:result.id,status:'interrupted',code:'probe_interrupted'});expect(f.source.identity).toHaveBeenCalledTimes(1)
})
it('keeps old plugin manifests compatible while validating safe setup metadata',()=>{
 const base={apiVersion:2,id:'sample',kind:'sample',label:'Sample',version:'1.0.0',stateVersion:1,entry:'plugin.mjs',codeSha256:'a'.repeat(64),configSchema:{},scopesPath:'/options/rooms',methods:[],setup:{description:'Old setup',fields:[{name:'rooms',label:'Rooms'}]}}
 expect(pluginManifestSchema.parse(base).setup?.fields[0]).toMatchObject({name:'rooms',required:false,secret:false})
 expect(pluginManifestSchema.safeParse({...base,setup:{...base.setup,serviceUrl:'https://token:secret@example.com'}}).success).toBe(false)
 expect(pluginManifestSchema.safeParse({...base,setup:{...base.setup,serviceUrl:'https://example.com/?token=secret'}}).success).toBe(false)
})
it('rejects plugin setup paths that would overwrite host authority or workspace controls',()=>{
 const f=fixture()
 for(const [kind,path] of [['bad-grant','/allowedActors/users'],['bad-workspace','/workspace/mode']]){
  f.host.sourceRegistry.register({apiVersion:1,kind:kind!,label:'Invalid setup',create:c=>new MessageSource(c),connection:{scopesPath:'/options/channels',setup:{description:'Unsafe metadata fixture',fields:[{name:'value',label:'Value',path,required:true,secret:false}]}}})
  expect(f.manager.snapshot().definitions.find(d=>d.kind===kind)?.setupAvailable).toBe(false);expect(()=>f.manager.plan({...f.draft,kind,fields:{value:'workspace-write'},credentials:{}})).toThrow('connector_unsupported')
 }
})
it('rejects invalid local-plugin setup URLs before constructing instances',()=>{
 const f=fixture()
 expect(()=>f.host.sourceRegistry.register({apiVersion:1,kind:'bad-endpoint',label:'Bad endpoint',create:c=>new MessageSource(c),connection:{setup:{description:'Unsafe endpoint',serviceUrl:'https://user:secret@example.com',fields:[]}}})).toThrow('Invalid source plugin setup metadata')
 expect(()=>f.host.sourceRegistry.register({apiVersion:1,kind:'bad-path',label:'Bad path',create:c=>new MessageSource(c),connection:{setup:{description:'Unsafe path',fields:[{name:'value',label:'Value',path:'/options/__proto__/value',required:true,secret:false}]}}})).toThrow('Invalid source plugin setup metadata')
})

it('returns stale evidence when a late identity reply arrives while the old runtime store is closed',async()=>{
 const f=fixture({timeoutMs:1000});let release!:(v:any)=>void;f.source.identity=()=>new Promise(r=>{release=r})
 const pending=f.probe('authentication');await Promise.resolve()
 await f.host.close();hosts.splice(hosts.indexOf(f.host),1)
 release({id:'late-after-close',type:'bot',verified:true})
 expect(await pending).toMatchObject({status:'stale',code:'configuration_changed'})
})
it('resolves timeout callbacks safely while the getter still points to a closed runtime',async()=>{
 const f=fixture({timeoutMs:20});let release!:(v:any)=>void;f.source.identity=()=>new Promise(r=>{release=r})
 const pending=f.probe('authentication');await Promise.resolve()
 await f.host.close();hosts.splice(hosts.indexOf(f.host),1)
 expect(await pending).toMatchObject({status:'stale',code:'configuration_changed'})
 release({id:'late',type:'bot',verified:true});await Promise.resolve();await Promise.resolve()
})
it('does not claim passed evidence when the metadata receipt cannot be persisted',async()=>{
 const f=fixture(),original=f.host.store.put.bind(f.host.store)
 f.source.identity=async()=>{
  f.host.store.put=((kind:string,id:string,value:unknown)=>{if(kind==='connector-diagnostic')throw Error('fixture metadata storage unavailable');original(kind,id,value)})
  return {id:'bot',type:'bot',verified:true}
 }
 expect(await f.probe('authentication')).toMatchObject({status:'interrupted',code:'diagnostic_store_unavailable'})
 f.host.store.put=original
})


it('accepts empty actors only for an explicit disabled draft without grants, adapter calls or writes',()=>{
 const f=fixture(),before=f.host.store.db.prepare('SELECT * FROM records ORDER BY rowid').all(),settings=f.host.settings.current()
 const draft={...f.draft,intent:'draft',actors:[]},plan=f.manager.plan(draft)
 expect(plan.source).toMatchObject({enabled:false,allowedActors:[],allowedBots:[],admission:{},sandbox:'read-only'})
 expect(plan.source.memberSync).toBeUndefined();expect(f.manager.validate(draft)).toMatchObject({valid:true,startsDisabled:true,networkTested:false,realCall:false})
 expect(f.manager.validate({...f.draft,actors:[]})).toMatchObject({valid:false,issues:[{field:'actors',code:'required'}]})
 expect(f.manager.validate({...f.draft,intent:'draft'})).toMatchObject({valid:false,issues:[{field:'actors',code:'invalid_format'}]})
 expect(f.host.settings.current()).toEqual(settings);expect(f.host.store.db.prepare('SELECT * FROM records ORDER BY rowid').all()).toEqual(before)
 expect(f.host.config.toolConnections).toEqual({});expect(f.source.identity).not.toHaveBeenCalled();expect(f.source.members).not.toHaveBeenCalled();expect(f.source.poll).not.toHaveBeenCalled();expect(f.source.deliver).not.toHaveBeenCalled()
})
it('returns only declared field names and fixed issue codes for local validation',()=>{
 const f=fixture()
 expect(f.manager.validate({...f.draft,credentials:{}})).toMatchObject({valid:false,issues:[{field:'token',code:'required'}]})
 expect(f.manager.validate({...f.draft,fields:{...f.draft.fields,channels:''}})).toMatchObject({valid:false,issues:[{field:'channels',code:'required'}]})
 expect(f.manager.validate({...f.draft,credentialMode:'environment',credentials:{token:'SECRET bad env'}})).toMatchObject({valid:false,issues:[{field:'token',code:'invalid_environment_reference'}]})
 const result=f.manager.validate({revision:0,kind:'feishu',label:'Feishu',actors:['ou_user'],fields:{chats:'SECRET_NOT_CHAT'},credentials:{'app-id':'cli_demo','app-secret':'SECRET_VALUE'}})
 expect(result).toMatchObject({valid:false,issues:[{field:'chats',code:'invalid_format'}]});expect(JSON.stringify(result)).not.toMatch(/SECRET_|Zod|instancePath/)
})
it('reports missing environment material locally without authenticating or preventing disabled storage',()=>{
 const f=fixture(),draft={...f.draft,intent:'draft',actors:[],credentialMode:'environment',credentials:{token:'CONNECTOR_TEST_TOKEN'}}
 delete process.env.CONNECTOR_TEST_TOKEN
 expect(f.manager.validate(draft)).toMatchObject({valid:true,credentialAvailability:[{field:'token',available:false}],networkTested:false,realCall:false})
 expect(f.manager.plan(draft).source.enabled).toBe(false)
 process.env.CONNECTOR_TEST_TOKEN='SECRET_LOCAL_CREDENTIAL'
 const result=f.manager.validate(draft)
 expect(result).toMatchObject({valid:true,credentialAvailability:[{field:'token',available:true}]});expect(JSON.stringify(result)).not.toMatch(/SECRET_|CONNECTOR_TEST_TOKEN/)
 expect(f.source.identity).not.toHaveBeenCalled();expect(f.source.members).not.toHaveBeenCalled()
})
it('rejects ordinary empty-admission enable before any settings or receipt write while allowing disable',()=>{
 const f=fixture();f.host.updateSettings(0,{sources:f.host.config.sources.map(s=>s.id==='team'?{...s,enabled:false,allowedActors:[]}:s)})
 const before=f.host.store.db.prepare('SELECT * FROM records ORDER BY rowid').all(),update=vi.spyOn(f.host,'updateSettings'),put=vi.spyOn(f.host.store,'put')
 expect(()=>f.manager.control({sourceId:'team',revision:1,enabled:true,requestId:randomUUID()})).toThrow('connector_actors_required')
 expect(update).not.toHaveBeenCalled();expect(put).not.toHaveBeenCalled();expect(f.host.store.db.prepare('SELECT * FROM records ORDER BY rowid').all()).toEqual(before)
 expect(f.host.config.sources.find(s=>s.id==='team')).toMatchObject({enabled:false,allowedActors:[]})
 expect(f.manager.control({sourceId:'team',revision:1,enabled:false,requestId:randomUUID()})).toMatchObject({enabled:false});expect(f.source.identity).not.toHaveBeenCalled()
})
it.each(['bots','custom','tools'])('preserves existing explicit %s admission or separate tool authority',mode=>{
 const f=fixture({},mode!=='tools'),source=f.host.config.sources.find(s=>s.id==='team')!
 f.host.updateSettings(0,{sources:f.host.config.sources.map(s=>s.id===source.id?{...s,enabled:false,allowedActors:[],...(mode==='bots'?{allowedBots:['BOT']}:mode==='custom'?{admission:{C1:{unlistedAddressed:'explicit',unlistedUnaddressed:'ignore',listedUnaddressed:'inferred'}}}:{capabilities:{events:false,replies:true,resources:true}})}:s)})
 const tools=structuredClone(f.host.config.toolConnections)
 expect(f.manager.control({sourceId:'team',revision:1,enabled:true,requestId:randomUUID()})).toMatchObject({enabled:true})
 expect(f.host.config.toolConnections).toEqual(tools);expect(f.source.identity).not.toHaveBeenCalled();expect(f.source.members).not.toHaveBeenCalled();expect(f.source.poll).not.toHaveBeenCalled()
})
it('does not trust arbitrary local-plugin issue text or let validation mutate a draft into an enabled source',()=>{
 const f=fixture()
 f.host.sourceRegistry.register({apiVersion:1,kind:'issue-plugin',label:'Issue plugin',create:c=>new MessageSource(c),connection:{scopesPath:'/options/rooms',validate:()=>{throw Error('SECRET_EXCEPTION')},validateFields:()=>[{field:'rooms',code:'invalid_format',raw:'SECRET_RAW'},{field:'SECRET_FIELD',code:'invalid_format'},{field:'rooms',code:'SECRET_CODE'},null] as any,setup:{description:'Fixture',fields:[{name:'rooms',label:'Rooms',path:'/options/rooms',required:true,secret:false}]}}})
 const value={revision:0,kind:'issue-plugin',label:'Plugin',intent:'draft',actors:[],fields:{rooms:'room'},credentials:{}}
 expect(f.manager.validate(value)).toMatchObject({valid:false,issues:[{field:'rooms',code:'invalid_format'}]});expect(JSON.stringify(f.manager.validate(value))).not.toContain('SECRET')
 f.host.sourceRegistry.register({apiVersion:1,kind:'mutating-plugin',label:'Mutating plugin',create:c=>new MessageSource(c),connection:{scopesPath:'/options/rooms',validate:c=>{c.enabled=true;c.allowedActors.push('UNAUTHORIZED')},setup:{description:'Fixture',fields:[{name:'rooms',label:'Rooms',path:'/options/rooms',required:true,secret:false}]}}})
 expect(f.manager.validate({...value,kind:'mutating-plugin'})).toMatchObject({valid:false});expect(f.host.config.sources).toHaveLength(2)
})

it('maps packaged JSON-schema paths only to declared form fields without exposing schema input',()=>{
 const f=fixture(),definition=f.host.sourceRegistry.connectionDefinitions().find(d=>d.kind==='fixture-im')!
 f.host.sourceRegistry.packages.push({manifest:{id:'fixture-package',kind:'fixture-im',label:'Fixture IM',version:'1.0.0',setup:definition.setup,credentials:definition.credentials,scopesPath:definition.scopesPath,configSchema:{type:'object',properties:{options:{type:'object',properties:{team:{type:'string',pattern:'^T[A-Z0-9]+$'}}}}}}} as any)
 const result=f.manager.validate({...f.draft,fields:{...f.draft.fields,team:'SECRET_BAD_TEAM'}})
 expect(result).toMatchObject({valid:false,issues:[{field:'team',code:'invalid_format'}]});expect(JSON.stringify(result)).not.toMatch(/SECRET|pattern|instancePath|params/)
})
it('does not mistake inherited object properties for available credential material',()=>{
 const f=fixture(),value={...f.draft,credentialMode:'environment',credentials:{token:'constructor'}}
 expect(f.manager.validate(value)).toMatchObject({valid:true,credentialAvailability:[{field:'token',available:false}]});expect(f.source.identity).not.toHaveBeenCalled()
})


it('never evaluates throwing or changing issue accessors before either public validation boundary',()=>{
 const f=fixture(),read=vi.fn(()=>{throw Error('SECRET_GETTER_EXCEPTION')})
 let metadata:unknown=[{get field(){return read()},code:'invalid_format'}]
 f.host.sourceRegistry.register({apiVersion:1,kind:'accessor-issues',label:'Accessor issues',create:c=>new MessageSource(c),connection:{scopesPath:'/options/rooms',validate:()=>{throw Error('SECRET_VALIDATOR')},validateFields:()=>metadata as any,setup:{description:'Local fixture',fields:[{name:'rooms',path:'/options/rooms',label:'Rooms',secret:false,required:true}]}}})
 const value={revision:0,kind:'accessor-issues',label:'Draft',intent:'draft',actors:[],fields:{rooms:'ROOM'},credentials:{}}
 const verify=()=>{expect(f.manager.validate(value)).toMatchObject({valid:false,code:'connector_invalid',issues:[]});try{f.manager.plan(value);throw Error('Expected rejection')}catch(error){expect(error).toMatchObject({code:'connector_invalid',issues:[]});expect(String(error)).not.toContain('SECRET')}}
 verify();expect(read).not.toHaveBeenCalled()
 let fieldReads=0,codeReads=0
 metadata=[{get field(){return ++fieldReads<=2?'rooms':'SECRET_CHANGED_FIELD'},get code(){return ++codeReads<=2?'invalid_format':'SECRET_CHANGED_CODE'}}]
 verify();expect(fieldReads).toBe(0);expect(codeReads).toBe(0)
})
it('accepts only bounded own data issues without invoking proxy traps, inherited fields or array iterators',()=>{
 const f=fixture(),trap=vi.fn(()=>{throw Error('SECRET_PROXY_TRAP')})
 let metadata:unknown
 f.host.sourceRegistry.register({apiVersion:1,kind:'data-issues',label:'Data issues',create:c=>new MessageSource(c),connection:{scopesPath:'/options/rooms',validate:()=>{throw Error('SECRET_VALIDATOR')},validateFields:()=>metadata as any,setup:{description:'Local fixture',fields:[{name:'rooms',path:'/options/rooms',label:'Rooms',secret:false,required:true}]}}})
 const value={revision:0,kind:'data-issues',label:'Draft',intent:'draft',actors:[],fields:{rooms:'ROOM'},credentials:{}}
 const revoked=Proxy.revocable({field:'rooms',code:'required'},{});revoked.revoke()
 const indexed:unknown[]=[];Object.defineProperty(indexed,'0',{get:trap});indexed.length=1
 const inherited=Object.create({get field(){return trap()},code:'required'})
 for(metadata of [null,{},'SECRET_STRING',new Set([{field:'rooms',code:'required'}]),Promise.resolve([]),new Proxy([],{get:trap,getOwnPropertyDescriptor:trap}),[new Proxy({field:'rooms',code:'required'},{get:trap,getPrototypeOf:trap,getOwnPropertyDescriptor:trap})],[revoked.proxy],indexed,[inherited],[['rooms','required']],Array(257).fill({field:'rooms',code:'required'})]){
  expect(f.manager.validate(value)).toMatchObject({valid:false,code:'connector_invalid',issues:[]})
 }
 const safe=Object.assign(Object.create(null),{field:'rooms',code:'required',raw:'SECRET_IGNORED'})
 metadata=[safe,safe,{field:'rooms',code:'invalid_format',raw:'SECRET_IGNORED'}]
 Object.defineProperty(metadata,Symbol.iterator,{get:trap})
 expect(f.manager.validate(value)).toMatchObject({valid:false,issues:[{field:'rooms',code:'required'},{field:'rooms',code:'invalid_format'}]})
 expect(trap).not.toHaveBeenCalled()
})
it('keeps accessor and malformed-plugin failures inside fixed HTTP validate and plan envelopes',async()=>{
 const f=fixture();let metadata:unknown
 f.host.sourceRegistry.register({apiVersion:1,kind:'http-issues',label:'HTTP issues',create:c=>new MessageSource(c),connection:{scopesPath:'/options/rooms',validate:()=>{throw Error('SECRET_VALIDATOR')},validateFields:()=>metadata as any,setup:{description:'Local fixture',fields:[{name:'rooms',path:'/options/rooms',label:'Rooms',secret:false,required:true}]}}})
 const http=await serve(f.host),headers={'content-type':'application/json',authorization:'Bearer '+readFileSync(http.tokenPath,'utf8').trim()},value={revision:0,kind:'http-issues',label:'Draft',intent:'draft',actors:[],fields:{rooms:'ROOM'},credentials:{}}
 try{
  for(metadata of [[{get field(){throw Error('SECRET_GETTER_EXCEPTION')},code:'required'}],[{get code(){throw Error('SECRET_CODE_EXCEPTION')},field:'rooms'}],new Proxy([],{get(){throw Error('SECRET_ARRAY_PROXY')}})]){
   for(const path of ['/api/connectors/validate','/api/connectors/plan']){
    const response=await fetch(http.url+path,{method:'POST',headers,body:JSON.stringify(value)}),body=await response.json()
    expect(response.status).toBe(path.endsWith('/validate')?200:400);expect(body).toMatchObject({code:'connector_invalid'});expect(body.issues??[]).toEqual([]);expect(JSON.stringify(body)).not.toMatch(/SECRET|stack|instancePath|rawResponse/)
   }
  }
  expect(f.source.identity).not.toHaveBeenCalled();expect(f.source.members).not.toHaveBeenCalled();expect(f.host.config.sources).toHaveLength(2)
 }finally{await new Promise<void>(resolve=>http.server.close(()=>resolve()))}
})

it('invalidates only credential-dependent evidence on rotation without exposing private basis or writing on GET',async()=>{
 const f=fixture(),authId=randomUUID()
 await f.probe('configuration');await f.probe('authentication',authId);await f.probe('capabilities')
 const config=f.host.config.sources.find(s=>s.id==='team')!
 const other=configSchema.shape.sources.element.parse({...config,id:'other',options:{...config.options,tokenEnv:'CONNECTOR_OTHER_TOKEN'}})
 f.host.config.sources.push(other);const adapter:import('../src/sources.ts').Source=new MessageSource(other);adapter.identity=vi.fn(async()=>({id:'other',type:'bot',verified:true}));f.host.sources.set('other',adapter)
 process.env.CONNECTOR_OTHER_TOKEN='other-unchanged'
 try{
  await f.manager.probe({sourceId:'other',revision:0,level:'authentication',requestId:randomUUID()})
  process.env.CONNECTOR_TEST_TOKEN='SECRET_ROTATED_TOKEN'
  const before=JSON.stringify(f.host.store.db.prepare('SELECT * FROM records ORDER BY kind,id').all()),view=f.manager.snapshot()
  const team=view.instances.find(s=>s.id==='team')!
  expect(team.layers.authentication).toMatchObject({status:'stale',code:'credential_changed',current:false})
  expect(team.layers.capabilities).toMatchObject({status:'stale',code:'credential_changed',current:false})
  expect(team.layers.capabilities).not.toHaveProperty('checkedCapabilities')
  expect(team.layers.configuration).toMatchObject({status:'passed',current:true})
  expect(view.instances.find(s=>s.id==='other')!.layers.authentication).toMatchObject({status:'passed',current:true})
  expect(JSON.stringify(f.host.store.db.prepare('SELECT * FROM records ORDER BY kind,id').all())).toBe(before)
  expect(JSON.stringify(view)).not.toMatch(/SECRET_ROTATED|basis|fingerprint|lifecycle/)
  expect(before).not.toContain('fixture-local-credential');expect(before).not.toContain('other-unchanged')
  expect(await f.probe('authentication',authId)).toMatchObject({status:'stale',code:'credential_changed'})
  expect(f.source.identity).toHaveBeenCalledTimes(1)
  expect(await f.probe('authentication')).toMatchObject({status:'passed'})
  delete process.env.CONNECTOR_TEST_TOKEN
  expect(f.manager.snapshot().instances[0]!.layers.configuration).toMatchObject({status:'stale',code:'configuration_changed',current:false})
  expect(f.manager.snapshot().instances[0]!.layers.authentication).toMatchObject({status:'stale',code:'credential_missing'})
  const calls=(f.source.identity as any).mock.calls.length
  expect(await f.probe('authentication')).toMatchObject({status:'stale',code:'credential_missing'})
  expect(f.source.identity).toHaveBeenCalledTimes(calls)
 }finally{delete process.env.CONNECTOR_OTHER_TOKEN}
})
it('fences an in-flight successful authentication after credential rotation',async()=>{
 const f=fixture();let release!:(v:any)=>void
 f.source.identity=vi.fn(()=>new Promise<any>(resolve=>{release=resolve}))
 const id=randomUUID(),pending=f.probe('authentication',id)
 process.env.CONNECTOR_TEST_TOKEN='rotated-in-flight';release({id:'old-account',type:'bot',verified:true})
 expect(await pending).toMatchObject({status:'stale',code:'credential_changed'})
 expect(await f.probe('authentication',id)).toMatchObject({status:'stale',code:'credential_changed'})
 expect(f.manager.snapshot().instances[0]!.layers.authentication).toMatchObject({current:false})
})
it('invalidates adapter changes and old service lifecycle receipts, including original request retries',async()=>{
 const f=fixture(),id=randomUUID();await f.probe('authentication',id)
 const original=f.source.identity
 f.source.identity=async()=>({id:'changed',type:'bot',verified:true})
 expect(f.manager.snapshot().instances[0]!.layers.authentication).toMatchObject({status:'stale',code:'adapter_changed',current:false})
 f.source.identity=original
 const replacement=new ConnectorManagement(()=>f.host)
 expect(replacement.snapshot().instances[0]!.layers.authentication).toMatchObject({status:'stale',code:'evidence_lifecycle_changed',current:false})
 expect(await replacement.probe({sourceId:'team',revision:0,level:'authentication',requestId:id})).toMatchObject({status:'stale',code:'evidence_lifecycle_changed'})
 expect(f.source.identity).toHaveBeenCalledTimes(1)
})
it('never trusts legacy receipts that have no private evidence basis',async()=>{
 const f=fixture(),id=randomUUID();await f.probe('authentication',id)
 const record=f.host.store.get<any>('connector-diagnostic',id);delete record.basis;f.host.store.put('connector-diagnostic',id,record)
 expect(f.manager.snapshot().instances[0]!.layers.authentication).toMatchObject({status:'stale',code:'evidence_lifecycle_changed',current:false})
 expect(await f.probe('authentication',id)).toMatchObject({status:'stale',code:'evidence_lifecycle_changed'})
})
it('binds loaded adapter metadata without rereading packages and refuses untracked credential basis',async()=>{
 const f=fixture();await f.probe('authentication')
 const original=f.host.sourceRegistry.connectionDefinitions.bind(f.host.sourceRegistry)
 const metadata=vi.spyOn(f.host.sourceRegistry,'connectionDefinitions').mockImplementation(()=>original().map(d=>d.kind==='fixture-im'?{...d,pluginId:'fixture-package',version:'2.0.0',digest:'b'.repeat(64)}:d))
 expect(f.manager.snapshot().instances[0]!.layers.authentication).toMatchObject({status:'stale',code:'adapter_changed'})
 metadata.mockImplementation(()=>original().map(d=>d.kind==='fixture-im'?{...d,setup:undefined}:d))
 const count=(f.source.identity as any).mock.calls.length
 expect(await f.probe('authentication')).toMatchObject({code:'credential_basis_unavailable'})
 expect(f.source.identity).toHaveBeenCalledTimes(count)
 expect(f.manager.snapshot().instances[0]!.layers.authentication).toMatchObject({status:'unknown',code:'credential_basis_unavailable',current:false})
})

it('does not bless rotated credentials while a warm ProcessSource still retains its old launch environment',async()=>{
 const f=fixture(),config=f.host.config.sources.find(s=>s.id==='team')!
 const pkg={manifest:{id:'fixture',credentials:{TOKEN:'/options/tokenEnv'},configSchema:{type:'object'},scopesPath:'/options/channels',stateKinds:[]},digest:'a'.repeat(64),directory:'/not-read-by-fixture'} as any
 const adapter=new ProcessSource(config,pkg,{sandboxDriver:'disabled',codex:'unused',stateDir:f.host.config.stateDir})
 // Simulate an already launched adapter retaining an older environment. No
 // subprocess or provider is invoked; the private capture mirrors launch().
 ;(adapter as any).launchedCredentials=(adapter as any).credentialBasis(process.env)
 ;(adapter as any).ready=Promise.resolve()
 adapter.identity=vi.fn(async()=>({id:'cached-old-account',type:'bot',verified:true}))
 f.host.sources.set('team',adapter)
 expect(await f.probe('authentication')).toMatchObject({status:'passed'})
 process.env.CONNECTOR_TEST_TOKEN='new-host-material'
 expect(adapter.diagnosticCredentialsCurrent()).toBe(false)
 expect(await f.probe('authentication')).toMatchObject({status:'stale',code:'adapter_restart_required'})
 expect(adapter.identity).toHaveBeenCalledTimes(1)
 expect(f.manager.snapshot().instances[0]!.layers.authentication).toMatchObject({current:false,code:'adapter_restart_required'})
 // A genuinely new adapter instance, not another diagnostic request, is the
 // restart boundary. Creation here is a local fixture, never an API action.
 const replacement=new ProcessSource(config,pkg,{sandboxDriver:'disabled',codex:'unused',stateDir:f.host.config.stateDir})
 replacement.identity=vi.fn(async()=>({id:'new-account',type:'bot',verified:true}));f.host.sources.set('team',replacement)
 expect(await f.probe('authentication')).toMatchObject({status:'passed'})
})
it('does not infer credential refresh safety for an arbitrary cached native adapter',async()=>{
 const f=fixture(),manager=new ConnectorManagement(()=>f.host)
 expect(await manager.probe({sourceId:'team',revision:0,level:'authentication',requestId:randomUUID()})).toMatchObject({code:'credential_basis_unavailable'})
 expect(f.source.identity).not.toHaveBeenCalled()
})
