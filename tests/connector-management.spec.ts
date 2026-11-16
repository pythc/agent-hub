import {afterEach,expect,it,vi} from 'vitest'
import {mkdtempSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {randomUUID} from 'node:crypto'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
import {SourceRegistry} from '../src/source-plugins.ts'
import {MessageSource} from '../src/sources.ts'
import {ConnectorManagement} from '../src/connector-management.ts'
import {pluginManifestSchema} from '../src/plugin-package.ts'

const roots:string[]=[],hosts:Runtime[]=[]
afterEach(async()=>{for(const host of hosts.splice(0))await host.close();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});delete process.env.CONNECTOR_TEST_TOKEN})
function fixture(options:ConstructorParameters<typeof ConnectorManagement>[1]={}){
 const root=mkdtempSync(join(tmpdir(),'connector-management-'));roots.push(root)
 const registry=new SourceRegistry()
 registry.register({apiVersion:1,kind:'fixture-im',label:'Fixture IM',create:c=>new MessageSource(c),scopes:c=>c.options.channels as string[],connection:{scopesPath:'/options/channels',credentials:{TOKEN:'/options/tokenEnv'},validate:c=>{if(!Array.isArray(c.options.channels)||!c.options.channels.length||typeof c.options.team!=='string')throw Error('Invalid fixture fields')},setup:{description:'Fixture app setup',serviceUrl:'http://127.0.0.1:1234/',fields:[{name:'team',label:'Team ID',path:'/options/team',required:true,secret:false},{name:'channels',label:'Channel IDs',path:'/options/channels',input:'tags',required:true,secret:false},{name:'token',label:'Bot credential',path:'/options/tokenEnv',required:true,secret:true}]}}})
 const config=configSchema.parse({stateDir:join(root,'state'),port:0,work:{sandboxDriver:'disabled',network:false},sources:[{id:'local',kind:'local',cwd:root,allowedActors:['operator'],workspace:{mode:'source'}},{id:'team',kind:'fixture-im',cwd:root,allowedActors:['USER'],options:{channels:['C1','C2'],team:'T1',tokenEnv:'CONNECTOR_TEST_TOKEN'}}]})
 const host=new Runtime(config,{sourceRegistry:registry,model:{async run(){throw Error('No model calls expected')}}});hosts.push(host)
 const source=host.sources.get('team')!;source.identity=vi.fn(async()=>({id:'verified-bot',type:'bot',verified:true}));source.members=vi.fn(async()=>[{id:'USER',bot:false}]);source.deliver=vi.fn(async()=>{});source.poll=vi.fn(async()=>{})
 const manager=new ConnectorManagement(()=>host,{evidenceMode:'fixture',...options})
 const probe=(level:'configuration'|'reachable'|'authentication'|'capabilities',requestId=randomUUID(),revision=host.settings.current().revision)=>manager.probe({sourceId:'team',level,requestId,revision})
 const draft={revision:0,kind:'fixture-im',label:'New team',actors:['USER'],fields:{team:'T1',channels:'C1, C2'},credentials:{token:'never-echo-this-credential'}}
 return {host,manager,source,probe,draft}
}
it('uses registered plugin metadata and keeps definitions, instances and diagnostics separate',()=>{
 const f=fixture(),view=f.manager.snapshot()
 expect(view.definitions.find(d=>d.kind==='fixture-im')).toMatchObject({setupAvailable:true,fields:expect.arrayContaining([expect.objectContaining({name:'token',path:'/options/tokenEnv',credential:true})])})
 expect(view.definitions.some(d=>d.kind==='slack')).toBe(false)
 expect(view.instances).toMatchObject([{id:'team',scopeCount:2,configured:true,realCall:{status:'not_tested'},credentialReferences:[{field:'Bot credential',available:false}]}])
 expect(view.diagnostics).toEqual([]);expect(view.instances[0]).not.toHaveProperty('options');expect(view.instances[0]).not.toHaveProperty('tokenEnv')
})
it('builds a disabled source recipe for existing onboarding without saving, granting tools or invoking adapters',()=>{
 const f=fixture(),plan=f.manager.plan(f.draft)
 expect(plan.source).toMatchObject({kind:'fixture-im',enabled:false,allowedActors:['USER'],options:{team:'T1',channels:['C1','C2']},sandbox:'read-only'})
 expect(Object.values(plan.credentials)).toEqual(['never-echo-this-credential']);expect(plan.source.options.tokenEnv).toMatch(/^AGENTHUB_SETUP_CONNECTOR_/)
 expect(f.manager.validate(f.draft)).toEqual({valid:true,revision:0,code:'configuration_valid',networkTested:false,realCall:false,startsDisabled:true})
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
