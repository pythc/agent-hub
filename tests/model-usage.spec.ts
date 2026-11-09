import {mkdtempSync,rmSync,mkdirSync,writeFileSync,chmodSync,statSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach,expect,it} from 'vitest'
import {Store} from '../src/store.ts'
import {UsageLedger} from '../src/usage-ledger.ts'
import {normalizeUsage,providerUsage} from '../src/model-usage.ts'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
import {TransientModelError} from '../src/model.ts'
import {HistoryCleanup} from '../src/history-cleanup.ts'
const roots:string[]=[],stores:Store[]=[],hosts:Runtime[]=[]
const root=()=>{const p=mkdtempSync(join(tmpdir(),'model-usage-'));roots.push(p);return p}
afterEach(async()=>{for(const h of hosts.splice(0))await h.close();for(const s of stores.splice(0))s.close();for(const p of roots.splice(0))rmSync(p,{recursive:true,force:true})})
function ledger(){const store=new Store(join(root(),'state.sqlite'));stores.push(store);return {store,usage:new UsageLedger(store)}}

it('replaces repeated step snapshots and keeps retries, failed usage, and missing counts distinct',()=>{
 const {usage}=ledger();usage.begin('call','router',{sourceId:'one'})
 usage.record('call',0,{id:'step',inputTokens:100,cachedInputTokens:80,outputTokens:10,reasoningOutputTokens:4})
 usage.record('call',0,{id:'step',inputTokens:100,cachedInputTokens:80,outputTokens:10,reasoningOutputTokens:4})
 usage.attempt('call',0,'failed');usage.attempt('call',1,'completed')
 usage.record('call',1,{id:'step',inputTokens:120,outputTokens:20});usage.finish('call','completed')
 usage.begin('unknown','worker',{sourceId:'two'});usage.finish('unknown','failed')
 expect(usage.summary()).toMatchObject({calls:2,reportedCalls:1,unknownCalls:1,partialCalls:1,steps:2,tokens:{inputTokens:220,cachedInputTokens:80,outputTokens:30,reasoningOutputTokens:4,totalTokens:250},fieldReported:{cachedInputTokens:1}})
 expect(usage.summary('one')).toMatchObject({calls:1,tokens:{totalTokens:250}})
 expect(usage.summary('two')).toMatchObject({calls:1,tokens:{inputTokens:null,totalTokens:null}})
})
it('retains durable accounting after activity pruning and restart without exposing raw events',()=>{
 const {store,usage}=ledger();usage.begin('retained','worker',{sourceId:'one',workerId:'w'});usage.record('retained',0,{id:'step',inputTokens:0,outputTokens:0});usage.finish('retained','completed')
 usage.begin('crash','subagent');store.db.prepare("DELETE FROM records WHERE kind='execution-call'").run()
 const restarted=new UsageLedger(store)
 expect(restarted.summary()).toMatchObject({calls:2,reportedCalls:1,unknownCalls:1,tokens:{inputTokens:0,outputTokens:0,totalTokens:0}})
 expect(store.get<any>('model-usage','crash').state).toBe('interrupted')
 expect(JSON.stringify(restarted.summary())).not.toContain('retained') // no call ids or raw events
})
it('rejects malformed telemetry without accepting sensitive fields or inventing missing zeroes',()=>{
 for(const value of [{id:'x',inputTokens:-1},{id:'x',inputTokens:1.5},{id:'x',inputTokens:Infinity},{id:'x',inputTokens:5,prompt:'PRIVATE'}])expect(normalizeUsage(value)).toBeUndefined()
 expect(normalizeUsage({id:'x',inputTokens:20,cachedInputTokens:21,outputTokens:3,reasoningOutputTokens:4})).toEqual({id:'x',inputTokens:20,outputTokens:3,totalTokens:23})
 expect(providerUsage('x','openai-responses',undefined)).toEqual({id:'x'})
})
it('normalizes cache and reasoning as subsets and includes Anthropic cache read/write in input',()=>{
 expect(providerUsage('r','openai-responses',{input_tokens:100,input_tokens_details:{cached_tokens:80},output_tokens:20,output_tokens_details:{reasoning_tokens:5}})).toEqual({id:'r',inputTokens:100,cachedInputTokens:80,outputTokens:20,reasoningOutputTokens:5,totalTokens:120})
 expect(providerUsage('c','openai-chat',{prompt_tokens:100,prompt_tokens_details:{cached_tokens:40},completion_tokens:20})).toEqual({id:'c',inputTokens:100,cachedInputTokens:40,outputTokens:20,totalTokens:120})
 expect(providerUsage('a','anthropic',{input_tokens:10,cache_read_input_tokens:80,cache_creation_input_tokens:20,output_tokens:5})).toEqual({id:'a',inputTokens:110,cachedInputTokens:80,cacheWriteInputTokens:20,outputTokens:5,totalTokens:115})
})
it('replaces a corrected snapshot without retaining absent or invalid old subdivisions',()=>{
 const {usage}=ledger();usage.begin('call','worker')
 usage.record('call',0,{id:'step',inputTokens:100,cachedInputTokens:80,outputTokens:10,reasoningOutputTokens:4})
 usage.record('call',0,{id:'step',inputTokens:20,outputTokens:3});usage.finish('call','completed')
 expect(usage.summary()).toMatchObject({steps:1,reportedCalls:1,unknownCalls:0,partialCalls:0,tokens:{inputTokens:20,cachedInputTokens:null,outputTokens:3,reasoningOutputTokens:null,totalTokens:23}})
 usage.record('call',0,{id:'step',inputTokens:20,cachedInputTokens:80,outputTokens:3,reasoningOutputTokens:4})
 expect(usage.summary().tokens).toMatchObject({cachedInputTokens:null,reasoningOutputTokens:null})
 usage.record('call',0,{id:'step',inputTokens:20,cachedInputTokens:0,outputTokens:3,reasoningOutputTokens:0})
 expect(usage.summary().tokens).toMatchObject({cachedInputTokens:0,reasoningOutputTokens:0,totalTokens:23})
})
it('keeps unknown and partial disjoint, including subset-only reported usage',()=>{
 const {usage}=ledger();usage.begin('unknown','worker');usage.finish('unknown','failed')
 usage.begin('partial','worker');usage.record('partial',0,{id:'subset-only',cachedInputTokens:10});usage.finish('partial','completed')
 expect(usage.summary()).toMatchObject({calls:2,reportedCalls:1,unknownCalls:1,partialCalls:1,tokens:{inputTokens:null,cachedInputTokens:10,outputTokens:null,totalTokens:null}})
})
it('keeps deleted history unknown and does not resurrect its detail from late usage callbacks',()=>{
 const {store,usage}=ledger();usage.begin('deleted','router',{triggerId:'forgotten',sourceId:'one'});usage.record('deleted',0,{id:'step',inputTokens:100,outputTokens:10});usage.finish('deleted','completed')
 usage.begin('retained','worker',{sourceId:'two'});usage.record('retained',0,{id:'step',inputTokens:20,outputTokens:3});usage.finish('retained','completed')
 const cleanup=new HistoryCleanup(store,root())
 cleanup.apply({id:'delete',scopeId:'scope',at:Date.now(),roots:['forgotten'],records:[['model-usage','deleted']],tickets:[],triggers:[],sessions:[],files:[]})
 expect(store.get<any>('model-usage','deleted').steps).toBeUndefined()
 usage.record('deleted',0,{id:'late',inputTokens:999,outputTokens:999});usage.attempt('deleted',1,'completed');usage.finish('deleted','completed')
 expect(store.get<any>('model-usage','deleted').steps).toBeUndefined()
 expect(new UsageLedger(store).summary()).toMatchObject({calls:2,reportedCalls:1,unknownCalls:1,partialCalls:0,tokens:{totalTokens:23},groups:[{purpose:'router',unknownCalls:1},{purpose:'worker',reportedCalls:1}]})
 expect(usage.summary('one').tokens.totalTokens).toBeNull()
})
it('includes source-filtered observer usage read-only without completing or duplicating its live calls',()=>{
 const dir=root(),state=join(dir,'state'),path=join(state,'watchdog','state.sqlite');mkdirSync(join(state,'watchdog'),{recursive:true})
 const observerStore=new Store(path);stores.push(observerStore);const observer=new UsageLedger(observerStore)
 const host=new Runtime(configSchema.parse({stateDir:state,sources:[{id:'local',kind:'local',cwd:dir,allowedActors:['operator']}]}),{model:{async run(){throw Error('No inference in accounting test')}}});hosts.push(host)
 host.usage.begin('same-id','router',{sourceId:'one'});host.usage.record('same-id',0,{id:'step',inputTokens:20,outputTokens:10});host.usage.finish('same-id','completed')
 observer.begin('same-id','subagent',{sourceId:'two'},'watchdog');observer.record('same-id',0,{id:'step',inputTokens:60,cachedInputTokens:40,outputTokens:10})
 for(let i=0;i<2;i++)expect(host.usage.summary()).toMatchObject({calls:2,reportedCalls:2,partialCalls:1,tokens:{totalTokens:100},groups:[{purpose:'router'},{purpose:'watchdog',tokens:{totalTokens:70}}]})
 expect(host.usage.summary('two')).toMatchObject({calls:1,tokens:{totalTokens:70}})
 expect(observerStore.get<any>('model-usage','same-id').state).toBe('running')
 expect(host.store.list('model-usage')).toHaveLength(1)
 expect(JSON.stringify(host.usage.summary())).not.toContain('same-id')
})
it('reports unreadable observer accounting without losing the available host counts',()=>{
 const {store,usage}=ledger(),path=join(root(),'unreadable.sqlite');writeFileSync(path,'Not a SQLite database')
 usage.begin('call','worker');usage.record('call',0,{id:'step',inputTokens:20,outputTokens:10});usage.finish('call','completed')
 expect(new UsageLedger(store,path).summary()).toMatchObject({calls:1,tokens:{totalTokens:30},watchdogUnavailable:true})
})
it.skipIf(process.platform==='win32'||process.getuid?.()===0)('distinguishes observer path permission failure from a database that has not been created',()=>{
 const {store}=ledger(),directory=join(root(),'observer');mkdirSync(directory);const path=join(directory,'state.sqlite');writeFileSync(path,'unreachable')
 chmodSync(directory,0)
 try{expect(()=>statSync(path)).toThrow(expect.objectContaining({code:'EACCES'}));expect(new UsageLedger(store,path).summary().watchdogUnavailable).toBe(true)}finally{chmodSync(directory,0o700)}
})
it('records every runtime retry and classifies verification without changing the model request',async()=>{
 const dir=root();let calls=0
 const h=new Runtime(configSchema.parse({stateDir:join(dir,'state'),sources:[{id:'local',kind:'local',cwd:dir,allowedActors:['operator']}]}),{model:{async run(r){r.onThread?.('owned');r.onUsage?.({id:'same-provider-id',inputTokens:100,outputTokens:10});if(calls++===0)throw new TransientModelError('synthetic retry');return {threadId:'owned',turnId:'t',text:'{}'}}}});hosts.push(h)
 await (h as any).runModel({cwd:dir,role:'subagent',activity:{agentId:'goal-verify:round'},instructions:'test',input:'{}',schema:{}})
 expect(h.usage.summary()).toMatchObject({calls:1,partialCalls:1,steps:2,tokens:{inputTokens:200,outputTokens:20,totalTokens:220},groups:[{purpose:'verification'}]})
})
