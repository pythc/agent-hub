import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach,expect,it,vi} from 'vitest'
import {Runtime} from '../src/runtime.ts'
import {configSchema,type Config} from '../src/config.ts'
import {SourceRegistry} from '../src/source-plugins.ts'
import {MessageSource} from '../src/sources.ts'
import {serve} from '../src/server.ts'
const cleanups:(()=>Promise<void>)[]=[]
afterEach(async()=>{for(const cleanup of cleanups.splice(0))await cleanup();vi.restoreAllMocks()})
async function fixture(){
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
 const create=(config:Config)=>{host=new Runtime(config,{sourceRegistry:registry,model:{async run(){calls.model++;throw Error('No inference allowed')}}});return host}
 create(configSchema.parse({port:0,stateDir:join(root,'state'),work:{sandboxDriver:'disabled',autoRecover:false},sources:[{id:'local',kind:'local',cwd:root,allowedActors:['operator'],workspace:{mode:'source'}}]}));host!.pause(true)
 const http=await serve(host!,{createRuntime:create}),headers={'content-type':'application/json',authorization:'Bearer '+readFileSync(http.tokenPath,'utf8').trim()}
 cleanups.push(async()=>{await new Promise<void>(resolve=>http.server.close(()=>resolve()));await host.close();rmSync(root,{recursive:true,force:true})})
 const post=(path:string,input:unknown)=>fetch(http.url+path,{method:'POST',headers,body:JSON.stringify(input)})
 const draft={revision:0,kind:'fixture-im',label:'Draft',intent:'draft',actors:[],fields:{rooms:'ROOM'},credentials:{token:'SECRET_DRAFT_CREDENTIAL'}}
 return {host:()=>host,http,headers,post,draft,calls}
}
it('preserves the existing reviewed plan/apply chain while storing an inert explicit draft',async()=>{
 const f=await fixture(),before=f.host().settings.current()
 expect((await fetch(f.http.url+'/api/connectors/validate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(f.draft)})).status).toBe(401)
 const validation=await f.post('/api/connectors/validate',f.draft)
 expect(validation.status).toBe(200);expect(await validation.json()).toMatchObject({valid:true,startsDisabled:true,networkTested:false,realCall:false,credentialAvailability:[{field:'token',available:true}]})
 const planned=await f.post('/api/connectors/plan',f.draft),plan=await planned.json()
 expect(planned.status).toBe(200);expect(JSON.stringify(plan)).not.toContain('SECRET');expect(f.host().settings.current()).toEqual(before)
 const response=await f.post('/api/plugin-market/connection/apply',{id:plan.id});expect(response.status).toBe(200)
 const result=await response.json(),source=f.host().config.sources.find(s=>s.id===result.sourceId)!
 expect(source).toMatchObject({enabled:false,allowedActors:[],allowedBots:[],admission:{}});expect(source.memberSync).toBeUndefined();expect(f.host().config.toolConnections).toEqual({})
 const denied=await f.post('/api/connectors/control',{sourceId:source.id,revision:f.host().settings.current().revision,enabled:true,requestId:crypto.randomUUID()})
 expect(denied.status).toBe(409);expect(await denied.json()).toMatchObject({code:'connector_actors_required',issues:[{field:'actors',code:'required'}]})
 expect(source.enabled).toBe(false);expect(f.calls).toEqual({identity:0,members:0,poll:0,start:0,deliver:0,model:0})
 const replay=await f.post('/api/plugin-market/connection/apply',{id:plan.id});expect(replay.status).toBe(200);expect(f.host().config.sources).toHaveLength(2)
})
it('keeps field errors fixed and public while refusing omitted draft intent and incorrect fields',async()=>{
 const f=await fixture()
 for(const [body,issue]of [[{...f.draft,intent:undefined},{field:'actors',code:'required'}],[{...f.draft,credentials:{}},{field:'token',code:'required'}],[{...f.draft,credentialMode:'environment',credentials:{token:'SECRET invalid env'}},{field:'token',code:'invalid_environment_reference'}]] as const){
  const validation=await f.post('/api/connectors/validate',body),checked=await validation.json();expect(checked).toMatchObject({valid:false,issues:[issue]})
  const plan=await f.post('/api/connectors/plan',body),error=await plan.json();expect(plan.status).toBe(400);expect(error).toMatchObject({code:'connector_invalid',issues:[issue]});expect(JSON.stringify(error)).not.toMatch(/SECRET|Zod|stack|invalid env/)
 }
 expect(f.host().config.sources).toHaveLength(1);expect(f.calls).toEqual({identity:0,members:0,poll:0,start:0,deliver:0,model:0})
})
it('rolls back an injected precommit apply write failure without enabling, granting or running a draft',async()=>{
 const f=await fixture(),before=f.host().settings.current(),plan=await (await f.post('/api/connectors/plan',f.draft)).json(),host=f.host(),put=host.store.put.bind(host.store)
 const failure=vi.spyOn(host.store,'put').mockImplementation((kind,key,value)=>{if(kind==='settings-history')throw Error('SECRET_WRITE_FAILURE');return put(kind,key,value)})
 const response=await f.post('/api/plugin-market/connection/apply',{id:plan.id}),result=await response.json()
 expect(response.status).toBe(503);expect(result.code).toBe('setup_apply_failed');expect(JSON.stringify(result)).not.toContain('SECRET');expect(f.host().settings.current()).toEqual(before);expect(f.host().config.sources).toHaveLength(1);expect(f.host().config.toolConnections).toEqual({})
 failure.mockRestore();const retry=await f.post('/api/plugin-market/connection/apply',{id:plan.id});expect(retry.status).toBe(200)
 expect(f.host().config.sources.filter(s=>s.kind==='fixture-im')).toMatchObject([{enabled:false,allowedActors:[],allowedBots:[]}]);expect(f.calls).toEqual({identity:0,members:0,poll:0,start:0,deliver:0,model:0})
})
