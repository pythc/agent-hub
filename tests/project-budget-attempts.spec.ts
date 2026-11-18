import {it,expect,afterEach} from 'vitest'
import {mkdtempSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {Store} from '../src/store.ts'
import {UsageLedger,type UsageRecord} from '../src/usage-ledger.ts'
import {projectBudget} from '../src/project-budget.ts'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
import {TransientModelError,type ModelRequest} from '../src/model.ts'
import type {RouterGoal} from '../src/router-goals.ts'
const roots:string[]=[],stores:Store[]=[],hosts:Runtime[]=[]
afterEach(async()=>{for(const host of hosts.splice(0))await host.close();for(const store of stores.splice(0))store.close();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true})})
function root(){const path=mkdtempSync(join(tmpdir(),'project-attempt-budget-'));roots.push(path);return path}
function goal(inputRate=1,outputRate=1):RouterGoal{return {id:'project',triggerId:'budget-input',scopeId:'scope',entryId:'entry',discussion:'discussion',actor:'operator',bindingRevision:1,revision:1,title:'Budget fixture',objective:'No external effects',criteria:[],plan:[],state:'active',taskIds:[],nextAction:'Inspect',turns:0,maxTurns:2,failures:0,at:Date.now(),project:{base:'a'.repeat(40),sourceId:'local',integration:'integration',triggerIds:['budget-input'],reviewWaitMs:0,policy:{testCommand:'true',budget:{cost:{maxUsd:1,inputUsdPerMillion:inputRate,outputUsdPerMillion:outputRate}}}}}}
function fixture(){const store=new Store(join(root(),'state.sqlite'));stores.push(store);return {store,usage:new UsageLedger(store)}}
it.each(['failed','completed','interrupted'])('holds on a partial %s attempt while its call remains running',state=>{
 const {store,usage}=fixture(),g=goal();usage.begin('call','worker',{triggerId:g.triggerId});usage.attempt('call',0,state);usage.record('call',0,{id:'step',inputTokens:100})
 expect(projectBudget(store,g,Date.now())).toMatchObject({unknownCalls:1,estimatedUsd:0.0001,reason:expect.any(String)})
 usage.attempt('call',1,'running');usage.record('call',1,{id:'step',inputTokens:20,outputTokens:30})
 expect(projectBudget(store,g,Date.now())?.unknownCalls).toBe(1)
 for(let i=0;i<2;i++)usage.record('call',0,{id:'step',inputTokens:100,outputTokens:50})
 expect(projectBudget(store,g,Date.now())).toMatchObject({unknownCalls:0,reason:undefined});expect(projectBudget(store,g,Date.now())!.estimatedUsd).toBeCloseTo(0.0002,10)
})
it('preserves running-stream and legacy settlement semantics without treating missing zero-price fields as costs',()=>{
 const {store,usage}=fixture(),g=goal();usage.begin('call','worker',{triggerId:g.triggerId});usage.attempt('call',0,'running');usage.record('call',0,{id:'step',inputTokens:100})
 expect(projectBudget(store,g,Date.now())?.unknownCalls).toBe(0)
 usage.attempt('call',0,'failed');expect(projectBudget(store,goal(1,0),Date.now())?.unknownCalls).toBe(0)
 const row=store.get<UsageRecord>('model-usage','call')!;delete row.attempts;store.put('model-usage','call',row)
 expect(projectBudget(store,g,Date.now())?.unknownCalls).toBe(0)
 usage.finish('call','completed');expect(projectBudget(store,g,Date.now())?.unknownCalls).toBe(1)
 usage.begin('missing','worker',{triggerId:g.triggerId});usage.attempt('missing',0,'failed')
 expect(projectBudget(store,g,Date.now())?.unknownCalls).toBe(2)
 expect(projectBudget(store,goal(0,0),Date.now())?.unknownCalls).toBe(0)
})
it('does not confuse attempt 1 with 10 or count unrelated project calls',()=>{
 const {store,usage}=fixture(),g=goal();usage.begin('call','worker',{triggerId:g.triggerId});usage.attempt('call',1,'failed');usage.attempt('call',10,'running');usage.record('call',10,{id:'provider:step',inputTokens:10,outputTokens:10})
 usage.begin('other','worker',{triggerId:'other-input'});usage.attempt('other',0,'failed')
 expect(projectBudget(store,g,Date.now())?.unknownCalls).toBe(1)
 usage.record('call',1,{id:'provider:step',inputTokens:0,outputTokens:0});expect(projectBudget(store,g,Date.now())?.unknownCalls).toBe(0)
})
for(const first of ['partial','missing','complete','free-output'] as const)it(`uses the production retry boundary for ${first} usage without changing backend or authority`,async()=>{
 const dir=root(),requests:ModelRequest[]=[],g=goal(1,first==='free-output'?0:1)
 const host=new Runtime(configSchema.parse({stateDir:join(dir,'state'),sources:[{id:'local',kind:'local',cwd:dir,allowedActors:['operator']}]}),{model:{async run(request){
  requests.push(request)
  if(first!=='missing')request.onUsage?.({id:'same-step',inputTokens:100,...(first==='complete'?{outputTokens:10}:{})})
  if(requests.length===1)throw new TransientModelError('Controlled retry fixture')
  return {threadId:'owned',turnId:'turn',text:'{}'}
 }}});hosts.push(host);host.store.put('router-goal',g.id,g)
 const input={cwd:dir,role:'subagent',backendId:'codex',activity:{triggerId:g.triggerId},instructions:'Fixture',input:'{}',tools:[],schema:{}}
 const run=()=> (host as unknown as {runModel(input:unknown):Promise<unknown>}).runModel(input)
 if(first==='partial'||first==='missing'){
  await expect(run()).rejects.toThrow('模型用量回执不完整')
  expect(requests).toHaveLength(1);expect(host.goals.get(g.id)?.state).toBe('held')
  const receipt=host.store.list<UsageRecord>('model-usage')[0]!
  expect(receipt.attempts).toEqual({'0':'failed'})
  host.usage.record(receipt.id,0,{id:'same-step',inputTokens:100,outputTokens:10})
  expect(projectBudget(host.store,host.goals.get(g.id)!,Date.now())?.unknownCalls).toBe(0)
  expect(host.goals.get(g.id)?.state).toBe('held')
  await expect(run()).rejects.toThrow();expect(requests).toHaveLength(1)
 }else{await run();expect(requests).toHaveLength(2);expect(host.goals.get(g.id)?.state).toBe('active')}
 expect(requests.every(r=>r.backendId==='codex'&&r.role==='subagent'&&r.tools?.length===0)).toBe(true)
})

it('does not let an ended complete attempt make a current partial stream unknown and ignores nonbillable counters',()=>{
 const {store,usage}=fixture(),g=goal();usage.begin('call','worker',{triggerId:g.triggerId});usage.attempt('call',0,'completed');usage.record('call',0,{id:'step:one',inputTokens:0,outputTokens:0})
 usage.attempt('call',1,'running');usage.record('call',1,{id:'step:one',inputTokens:20,totalTokens:30,cachedInputTokens:10,reasoningOutputTokens:10})
 expect(projectBudget(store,g,Date.now())?.unknownCalls).toBe(0)
 usage.attempt('call',1,'failed');expect(projectBudget(store,g,Date.now())?.unknownCalls).toBe(1)
 delete g.project!.policy.budget!.cost
 expect(projectBudget(store,g,Date.now())).toMatchObject({unknownCalls:0,reason:undefined,estimatedUsd:undefined})
})
