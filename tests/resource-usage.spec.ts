import {mkdtempSync,mkdirSync,rmSync,readFileSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {afterEach,expect,it,vi} from 'vitest'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
import {Store} from '../src/store.ts'
import {serve} from '../src/server.ts'
import {ResourceUsage} from '../src/resource-usage.ts'
const roots:string[]=[],hosts:Runtime[]=[],observers:Store[]=[],servers:Awaited<ReturnType<typeof serve>>[]=[]
afterEach(async()=>{vi.restoreAllMocks();for(const s of servers.splice(0)){s.server.closeAllConnections();await new Promise<void>(done=>s.server.close(()=>done()))}for(const host of hosts.splice(0)){host.store.db.prepare("DELETE FROM records WHERE kind='work'").run();await host.close();}for(const db of observers.splice(0))db.close();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true})})
function fixture(maxAgents=3){
 const root=mkdtempSync(join(tmpdir(),'resource-usage-'));roots.push(root)
 const host=new Runtime(configSchema.parse({port:0,stateDir:join(root,'state'),work:{sandboxDriver:'disabled',autoRecover:false,maxAgents},sources:[{id:'local',kind:'local',cwd:root,allowedActors:['operator']}]}),{model:{async run(){throw Error('No model calls permitted')}}});hosts.push(host)
 return {root,host,view:new ResourceUsage(()=>host,()=>1000)}
}
function db(store:Store){return store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row=>{const name=String(row.name);return [name,store.db.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'"').all().sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))]})}
const context=(extra:Record<string,unknown>={})=>({activity:'activity',basis:'api-wire',phase:'before_turn',bytes:20,maxBytes:100,reservedBytes:10,status:'within_budget',at:900,...extra})
const work=(extra:Record<string,unknown>={})=>({id:'work',kind:'shell',state:'running',ticketId:'SECRET_TASK',assignmentId:'SECRET_ASSIGNMENT',cwd:'/SECRET_PATH',depth:0,sandbox:'read-only',notify:'auto',createdAt:100,command:'SECRET_COMMAND',...extra})
async function http(){const f=fixture();f.host.pause(true);const server=await serve(f.host);servers.push(server);clearInterval((f.host as any).timer);const endpoint=server.url+'/api/resource-usage',headers={authorization:'Bearer '+readFileSync(server.tokenPath,'utf8').trim()};return {...f,server,endpoint,headers}}
it('reuses the existing unknown/partial/zero/deduplicated usage contract without writing any host table',()=>{
 const f=fixture(),u=f.host.usage
 u.begin('reported','router');u.attempt('reported',0,'failed');u.attempt('reported',1,'completed')
 u.record('reported',0,{id:'step',inputTokens:100,cachedInputTokens:40,outputTokens:10,reasoningOutputTokens:2});u.record('reported',0,{id:'step',inputTokens:100,cachedInputTokens:40,outputTokens:10,reasoningOutputTokens:2});u.record('reported',1,{id:'step',inputTokens:120,outputTokens:20});u.finish('reported','completed')
 u.begin('zero','worker');u.record('zero',0,{id:'step',inputTokens:0,outputTokens:0});u.finish('zero','completed')
 u.begin('unknown','subagent');u.record('unknown',0,{id:'step',inputTokens:-1});u.finish('unknown','failed')
 f.host.store.put('context-budget','a',context());f.host.store.put('work','w',work())
 const expected=u.summary(),before=db(f.host.store),changes=f.host.store.db.prepare('SELECT total_changes() AS n').get()!.n
 for(let i=0;i<3;i++)expect(f.view.snapshot().usage).toEqual(expected)
 expect(f.view.snapshot().usage).toMatchObject({calls:3,reportedCalls:2,unknownCalls:1,partialCalls:1,steps:3,tokens:{inputTokens:220,cachedInputTokens:40,outputTokens:30,totalTokens:250}})
 expect(db(f.host.store)).toEqual(before);expect(f.host.store.db.prepare('SELECT total_changes() AS n').get()!.n).toBe(changes)
})
it('does not finish host or observer running calls, create observer records or invoke models',()=>{
 const f=fixture();f.host.usage.begin('host-running','worker');f.host.usage.record('host-running',0,{id:'step',inputTokens:10,outputTokens:2})
 const directory=join(f.root,'state','watchdog');mkdirSync(directory,{recursive:true});const observer=new Store(join(directory,'state.sqlite'));observers.push(observer)
 observer.put('model-usage','observer-running',{id:'observer-running',role:'subagent',purpose:'watchdog',state:'running',at:100,steps:{'0:step':{id:'step',inputTokens:20,outputTokens:3,totalTokens:23}}})
 const hostBefore=db(f.host.store),observerBefore=db(observer)
 for(let i=0;i<2;i++)expect(f.view.snapshot().usage).toMatchObject({calls:2,reportedCalls:2,partialCalls:2,tokens:{totalTokens:35},groups:expect.arrayContaining([expect.objectContaining({purpose:'watchdog'})])})
 expect(db(f.host.store)).toEqual(hostBefore);expect(db(observer)).toEqual(observerBefore);expect(observer.get<any>('model-usage','observer-running').state).toBe('running');expect(f.host.store.get<any>('model-usage','host-running').state).toBe('running')
})
it('retains host coverage if observer accounting is unreadable, without exposing its error or path',()=>{
 const f=fixture();f.host.usage.begin('known','worker');f.host.usage.record('known',0,{id:'step',inputTokens:2,outputTokens:3});f.host.usage.finish('known','completed')
 mkdirSync(join(f.root,'state','watchdog'),{recursive:true});writeFileSync(join(f.root,'state','watchdog','state.sqlite'),'SECRET not a SQLite database')
 const before=db(f.host.store),snapshot=f.view.snapshot();expect(snapshot.usage).toMatchObject({calls:1,watchdogUnavailable:true,tokens:{totalTokens:5}});expect(JSON.stringify(snapshot)).not.toContain('SECRET');expect(db(f.host.store)).toEqual(before)
})
it('preserves absent telemetry as null and explicit zero as zero',()=>{
 const f=fixture();expect(f.view.snapshot().usage.tokens.totalTokens).toBeNull()
 f.host.usage.begin('zero','worker');f.host.usage.record('zero',0,{id:'s',inputTokens:0,outputTokens:0});f.host.usage.finish('zero','completed')
 expect(f.view.snapshot().usage.tokens).toMatchObject({totalTokens:0,inputTokens:0,cachedInputTokens:null})
})
it('keeps overflowed token sums unknown using the existing ledger instead of emitting rounded totals',()=>{
 const f=fixture();for(const id of ['one','two']){f.host.usage.begin(id,'worker');f.host.usage.record(id,0,{id:'s',inputTokens:Number.MAX_SAFE_INTEGER,outputTokens:0});f.host.usage.finish(id,'completed')}
 expect(f.view.snapshot().usage).toMatchObject({calls:2,reportedCalls:2,tokens:{inputTokens:null,totalTokens:null,outputTokens:0}})
})
it('counts only the final retained context check per activity without accumulating bytes or changing held tasks',()=>{
 const f=fixture();f.host.store.put('context-budget','a',context());f.host.store.put('context-budget','a',context({bytes:100,status:'exceeded',at:950}));f.host.store.put('context-budget','b',context({activity:'b',basis:'native-protocol'}));f.host.store.put('context-rebuild','task',{state:'held',reason:'context_budget_exceeded',secret:'SECRET'})
 const before=db(f.host.store);expect(f.view.snapshot().context).toEqual({retainedActivities:2,withinBudgetActivities:1,exceededActivities:1,unrecognizedActivities:0,lastCheckAt:950});expect(db(f.host.store)).toEqual(before)
 expect(f.view.snapshot().context).not.toHaveProperty('bytes');expect(f.view.snapshot()).not.toHaveProperty('cost')
})
for(const [name,value]of [
 ['null',null],['array',[]],['unknown basis',context({basis:'secret'})],['coerced basis',context({basis:['api-wire']})],['unknown status',context({status:'passed'})],['coerced status',context({status:['exceeded'],bytes:100})],['missing activity',context({activity:''})],['missing phase',context({phase:undefined})],['negative bytes',context({bytes:-1})],['fractional bytes',context({bytes:1.5})],['unsafe number',context({bytes:Number.MAX_SAFE_INTEGER+1})],['zero maximum',context({maxBytes:0})],['invalid reserve',context({reservedBytes:'10'})],['bad timestamp',context({at:'SECRET'})],['mismatched within result',context({bytes:100})],['mismatched exceeded result',context({status:'exceeded'})],
] as const)it('counts invalid context '+name+' as unrecognized rather than within budget',()=>{
 const f=fixture();f.host.store.put('context-budget','bad',value);expect(f.view.snapshot().context).toEqual({retainedActivities:1,withinBudgetActivities:0,exceededActivities:0,unrecognizedActivities:1,lastCheckAt:null})
})
it('compares large safe byte fields without overflowing their sum',()=>{
 const f=fixture();f.host.store.put('context-budget','a',context({bytes:Number.MAX_SAFE_INTEGER,reservedBytes:Number.MAX_SAFE_INTEGER,maxBytes:Number.MAX_SAFE_INTEGER,status:'exceeded'}));expect(f.view.snapshot().context.exceededActivities).toBe(1)
})
it('reports retained work state and only nonterminal valid recorded deadlines, without enforcing or stopping anything',()=>{
 const f=fixture();for(const [id,row]of [
 ['a',work({deadline:999})],['b',work({id:'b',kind:'agent',state:'starting',deadline:1001})],['c',work({id:'c',state:'completed',deadline:1})],['d',work({id:'d',state:'failed'})],['e',work({id:'e',state:'cancelled'})],['f',work({id:'f',state:'interrupted'})],['g',work({id:'g',deadline:'SECRET_BAD'})],['h',work({state:'unknown'})],['i',null],['j',work({kind:'unknown'})],
 ] as const)f.host.store.put('work',id,row)
 const before=db(f.host.store);expect(f.view.snapshot().work).toEqual({retainedItems:10,states:{starting:1,running:2,completed:1,failed:1,cancelled:1,interrupted:1},unrecognizedStateItems:3,deadlineItems:2,pastDeadlineItems:1,invalidDeadlineItems:1,limits:{maxAgentsPerTicket:3,maxDepth:3,backgroundTimeoutMs:1800000,maxOutputBytesPerShell:1000000}});expect(db(f.host.store)).toEqual(before)
 expect(JSON.stringify(f.view.snapshot())).not.toContain('SECRET')
})
it('captures the getter once per read and keeps revision/config/records from the same Runtime even if it switches mid-read',()=>{
 const a=fixture(3),b=fixture(6);a.host.updateSettings(0,{work:{...a.host.config.work,maxAgents:4}});b.host.updateSettings(0,{work:{...b.host.config.work,maxAgents:7}});b.host.updateSettings(1,{work:{...b.host.config.work,maxAgents:8}})
 a.host.store.put('work','a',work());b.host.store.put('context-budget','b',context())
 let active=a.host,calls=0;const view=new ResourceUsage(()=>{calls++;return active},()=>1000),original=a.host.usage.summary.bind(a.host.usage)
 vi.spyOn(a.host.usage,'summary').mockImplementation(()=>{active=b.host;return original()})
 expect(view.snapshot()).toMatchObject({settingsRevision:1,context:{retainedActivities:0},work:{retainedItems:1,limits:{maxAgentsPerTicket:4}}});expect(calls).toBe(1)
 expect(view.snapshot()).toMatchObject({settingsRevision:2,context:{retainedActivities:1},work:{retainedItems:0,limits:{maxAgentsPerTicket:8}}});expect(calls).toBe(2)
})
it('does not cache by settings revision when new telemetry arrives',()=>{
 const f=fixture(),first=f.view.snapshot();f.host.usage.begin('new','worker');f.host.usage.record('new',0,{id:'s',inputTokens:5,outputTokens:2})
 const next=f.view.snapshot();expect(next.settingsRevision).toBe(first.settingsRevision);expect(next.usage.calls).toBe(first.usage.calls+1);expect(next.usage.tokens.totalTokens).toBe(7)
})
it('whitelists usage fields rather than returning accidental raw metadata',()=>{
 const f=fixture(),summary=f.host.usage.summary();vi.spyOn(f.host.usage,'summary').mockReturnValue({...summary,prompt:'SECRET',tokens:{...summary.tokens,rawResponse:'SECRET'}} as any)
 expect(JSON.stringify(f.view.snapshot())).not.toContain('SECRET')
})
it('requires current operator, GET-only and genuinely empty query without accepting a workspace selector',async()=>{
 const f=await http(),before=db(f.host.store)
 expect((await fetch(f.endpoint)).status).toBe(401);expect((await fetch(f.endpoint,{headers:{authorization:'Bearer wrong'}})).status).toBe(401)
 for(const method of ['POST','PATCH','DELETE','HEAD','OPTIONS'])expect((await fetch(f.endpoint,{method,headers:f.headers})).status).toBe(405)
 for(const query of ['?workspace=one','?workspace=','?source=','?foo=bar','?foo=a&foo=b','?=','?%77orkspace=one','?&&']){const response=await fetch(f.endpoint+query,{headers:f.headers});expect(response.status,query).toBe(400);expect(await response.json()).toEqual({code:'resource_usage_query_invalid'})}
 const response=await fetch(f.endpoint,{headers:f.headers});expect(response.status).toBe(200);expect(await response.json()).toMatchObject({schema:1,scope:'host',settingsRevision:0});expect(db(f.host.store)).toEqual(before)
})
it('returns a fixed unavailable response when the ledger or store throws, without leaking errors or mutating state',async()=>{
 const f=await http(),before=db(f.host.store);vi.spyOn(f.host.usage,'summary').mockImplementation(()=>{throw Error('SECRET_PROVIDER_ERROR /SECRET_PATH')})
 const response=await fetch(f.endpoint,{headers:f.headers});expect(response.status).toBe(503);expect(await response.json()).toEqual({code:'resource_usage_unavailable'});expect(db(f.host.store)).toEqual(before)
})
it('returns fixed unavailable for structurally corrupt summaries instead of inventing coverage counts',async()=>{
 const f=await http(),summary=f.host.usage.summary();vi.spyOn(f.host.usage,'summary').mockReturnValue({...summary,calls:Number.MAX_SAFE_INTEGER+1} as any)
 const response=await fetch(f.endpoint,{headers:f.headers});expect(response.status).toBe(503);expect(await response.json()).toEqual({code:'resource_usage_unavailable'})
})
it('returns fixed unavailable when a later projection store read fails, without exposing the stored exception',async()=>{
 const f=await http(),before=db(f.host.store),original=f.host.store.list.bind(f.host.store)
 vi.spyOn(f.host.store,'list').mockImplementation((kind:string)=>{if(kind==='context-budget')throw Error('SECRET_STORE_PATH');return original(kind)})
 const response=await fetch(f.endpoint,{headers:f.headers});expect(response.status).toBe(503);expect(await response.json()).toEqual({code:'resource_usage_unavailable'});expect(db(f.host.store)).toEqual(before)
})
it('does not accept overflowing group coverage sums as a precise total',async()=>{
 const f=await http(),summary=f.host.usage.summary(),max=Number.MAX_SAFE_INTEGER
 const group={calls:max,reportedCalls:0,unknownCalls:max,partialCalls:0,steps:0,tokens:summary.tokens}
 vi.spyOn(f.host.usage,'summary').mockReturnValue({...summary,since:100,calls:max,unknownCalls:max,groups:[{...group,purpose:'router'},{...group,purpose:'worker'}]})
 const response=await fetch(f.endpoint,{headers:f.headers});expect(response.status).toBe(503);expect(await response.json()).toEqual({code:'resource_usage_unavailable'})
})
it('does not publish an unrecognized ledger purpose or malformed numeric totals',async()=>{
 const f=await http(),summary=f.host.usage.summary()
 vi.spyOn(f.host.usage,'summary').mockReturnValue({...summary,calls:1,reportedCalls:0,unknownCalls:1,groups:[{purpose:'SECRET_PURPOSE',calls:1,reportedCalls:0,unknownCalls:1,partialCalls:0,steps:0,tokens:summary.tokens}]} as any)
 const response=await fetch(f.endpoint,{headers:f.headers});expect(response.status).toBe(503);expect(await response.json()).toEqual({code:'resource_usage_unavailable'})
})
