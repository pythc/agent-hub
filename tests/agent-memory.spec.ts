import {it,expect,afterEach} from 'vitest'
import {mkdtempSync,rmSync,copyFileSync} from 'node:fs'
import {join} from 'node:path'
import {backup} from 'node:sqlite'
import {tmpdir} from 'node:os'
import {Runtime} from '../src/runtime.ts'
import {configSchema} from '../src/config.ts'
import type {ModelRequest} from '../src/model.ts'
import type {MemoryFact} from '../src/router-memory.ts'
import type {EmbedMemory} from '../src/memory-vectors.ts'
import type {RerankMemory} from '../src/memory-rerank.ts'
const hosts:Runtime[]=[],roots:string[]=[]
afterEach(async()=>{for(const h of hosts.splice(0))await h.close();for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true})})
function fixture(output?:(input:any,request:ModelRequest)=>unknown|Promise<unknown>,embed?:EmbedMemory,rerank?:RerankMemory){
 const root=mkdtempSync(join(tmpdir(),'agent-memory-'));roots.push(root);let now=Date.now(),seq=0,h!:Runtime
 const calls:ModelRequest[]=[]
 const config=configSchema.parse({stateDir:join(root,'state'),acceptMode:'auto',port:0,work:{sandboxDriver:'disabled'},execution:{router:{mode:'host'},management:{enabled:true},workers:[{id:'one',backend:'codex'}]},sources:[{id:'local',kind:'local',cwd:root,workspace:{mode:'source'},allowedActors:['alice','bob']}]})
 const model={async run(r:ModelRequest){calls.push(r);const input=JSON.parse(r.input),text=JSON.stringify(await output?.(input,r)??{memories:[],topics:[]});return {threadId:'memory-'+calls.length,turnId:'turn-'+calls.length,text}}}
 const open=()=>{h=new Runtime(config,{model,clock:()=>now,memoryEmbed:embed,memoryRerank:rerank});hosts.push(h)};open()
 h.scopes.command({action:'scope.put',operationId:'scope',expectedRevision:0,scope:{id:'team',tenantId:'org',name:'Memory test',managers:[JSON.stringify(['local','alice'])],workerIds:['one'],sourceIds:['local'],backendIds:['codex']}})
 for(const name of ['g1','g2'])h.scopes.command({action:'entry.bind',operationId:name,expectedRevision:0,scopeId:'team',sourceId:'local',accountNamespace:'account',nativeId:name,history:'group'})
 const send=(text='Setup',thread='session',actor='alice',group='g1')=>{const result=h.receive('local',actor,{id:'input-'+(++seq),scope:group,thread,text,addressed:true}) as any;return context(result.triggerId)}
 const context=(id:string)=>{const trigger=h.store.triggers.get(id)!;return h.scopes.context(trigger,trigger.source+':'+trigger.threads[0]!.id)!}
 const initial=send()
 const configure=(value:any={})=>{const c=context(initial.trigger.id);return h.agentMemory.manage(c,{action:'configure',expectedRevision:h.agentMemory.policyRevision(c),policy:{...h.agentMemory.policy(c),delayMs:0,minIntervalMs:0,...value}})}
 const learn=async()=>{h.agentMemory.tick();await h.agentMemory.drain()}
 const remember=(c:any,content:string,extra:any={})=>h.memory.command(c,{action:'remember',operationId:'manual-'+(++seq),expectedRevision:0,subject:'work style',content,sourceIds:[h.memory.ingest(c).id],candidate:false,...extra},true) as MemoryFact
 return {get h(){return h},root,config,calls,send,context,configure,learn,remember,advance:(ms=10000)=>{now+=ms},restart:async(snapshot?:string)=>{hosts.splice(hosts.indexOf(h),1);await h.close();if(snapshot)copyFileSync(snapshot,join(config.stateDir,'state.sqlite'));open()}}
}
function decision(input:any,extra:any={}){return {action:'add',target:null,kind:'preference',topic:'回答风格',content:'回答先给结论',importance:4,source:0,quote:input.messages[0].text,expiresAt:null,inferred:false,...extra}}

it('applies stated adaptive preferences, revises them across sessions and preserves provenance after restart',async()=>{
 const f=fixture(input=>({memories:[decision(input,input.existing.length?{action:'update',target:0,content:'报告先列未验证项',condition:'技术报告'}:{condition:'技术报告'})],topics:[]}));f.configure({writeMode:'adaptive'})
 const first=f.send('以后技术报告先给结论','first');await f.learn()
 const old=f.h.agentMemory.applicable(first)[0]!
 expect(old).toMatchObject({state:'active',protected:false,learning:{inferred:false,condition:'技术报告',quote:'以后技术报告先给结论'}})
 const next=f.send('改一下，以后技术报告先列未验证项','second');await f.learn()
 expect(f.h.memory.fact(old.id)?.state).toBe('superseded')
 expect(f.h.agentMemory.applicable(next).map(f=>f.content)).toEqual(['报告先列未验证项'])
 await f.restart();const current=f.context(next.trigger.id),packet=f.h.memory.build(current,{},'test')
 expect(JSON.parse(packet.input).memory).toMatchObject({learning:{mode:'adaptive',coldStart:false},facts:[{learning:{inferred:false,condition:'技术报告'}}]})
 f.h.memory.validate(packet.manifest)
})

it('keeps a temporary exception alongside the standing preference and out of later sessions',async()=>{
 const f=fixture(input=>({memories:[decision(input,input.existing.length?{action:'update',target:0,content:'这次详细解释',scope:'discussion',condition:'本次修复说明'}:{content:'日常报告简短'})],topics:[]}));f.configure({writeMode:'adaptive'})
 const first=f.send('日常报告简短','first');await f.learn();const standing=f.h.agentMemory.applicable(first)[0]!
 const second=f.send('这次详细解释','second');await f.learn()
 expect(f.h.agentMemory.applicable(second).map(f=>f.content)).toEqual(expect.arrayContaining(['日常报告简短','这次详细解释']))
 expect(f.h.memory.fact(standing.id)?.state).toBe('active')
 const third=f.send('继续下一项任务','third')
 expect(f.h.agentMemory.recall(third,'解释').items.map(f=>f.content)).toEqual(['日常报告简短'])
 expect((await f.h.agentMemory.search(third,'这次详细解释')).items.some(f=>f.learning?.discussion)).toBe(false)
 await f.restart();expect(f.h.agentMemory.applicable(f.context(third.trigger.id)).map(f=>f.id)).toEqual([standing.id])
})

it('shows the same cold-start state in the workbench and runtime after a temporary-only preference',async()=>{
 const f=fixture(input=>({memories:[decision(input,{scope:'discussion'})],topics:[]}));f.configure({writeMode:'adaptive'})
 const first=f.send('仅本次回答先给结论','first');await f.learn()
 expect(f.h.agentMemory.learning(first).coldStart).toBe(false)
 const next=f.send('开始下一项任务','next'),view=f.h.agentMemory.manage(next,{action:'inspect'}) as any
 expect(view.adaptation).toMatchObject({coldStart:true,preferences:[]})
 expect(JSON.parse(f.h.memory.build(next,{},'test').input).memory.learning.coldStart).toBe(true)
})

it('does not duplicate an unchanged legacy preference without learning metadata',async()=>{
 const f=fixture(input=>({memories:[decision(input)],topics:[]}));f.configure({writeMode:'adaptive'})
 const c=f.send('回答先给结论'),original=f.remember(c,'回答先给结论',{kind:'preference'})
 await f.learn()
 expect(f.h.agentMemory.authorized(c,true).map(f=>f.id)).toEqual([original.id])
})

it('uses an inferred preference as tentative context without replacing a stated preference',async()=>{
 const f=fixture(input=>({memories:[decision(input,{inferred:true,...(input.existing.length?{action:'update',target:0,content:'报告可以省略证据'}:{condition:'代码交付'})})],topics:[]}));f.configure({writeMode:'adaptive'})
 const c=f.send('用户的选择可能偏向先给结论');await f.learn()
 const tentative=f.h.agentMemory.applicable(c)[0]!
 expect(tentative).toMatchObject({state:'active',protected:false,learning:{inferred:true}})
 f.h.memory.command(c,{action:'remember',operationId:'stated-edit',id:tentative.id,expectedRevision:tentative.revision,subject:tentative.subject,content:'报告必须提供证据',sourceIds:tentative.sources.map(s=>s.id),kind:'preference',candidate:false,learning:{...tentative.learning!,inferred:false}},true)
 const next=f.send('本次没有继续追问证据','next');await f.learn()
 expect(f.h.agentMemory.applicable(next).map(f=>f.content)).toEqual(['报告必须提供证据'])
 expect(f.h.agentMemory.authorized(next,true).some(f=>f.state==='candidate'&&f.learning?.inferred)).toBe(true)
})

it('keeps unrelated facts in review under adaptive learning',async()=>{
 const f=fixture(input=>({memories:[decision(input,{kind:'fact',content:'项目使用 TypeScript'})],topics:[]}));f.configure({writeMode:'adaptive'})
 const c=f.send('项目使用 TypeScript');await f.learn()
 expect(f.h.agentMemory.applicable(c)).toHaveLength(0)
 expect(f.h.agentMemory.authorized(c,true)[0]?.state).toBe('candidate')
})

it('does not replace a human-confirmed inference with a new inferred preference',async()=>{
 const f=fixture(input=>({memories:[decision(input,{action:'update',target:0,inferred:true,content:'推断用户改为喜欢长报告'})],topics:[]}));f.configure({writeMode:'adaptive'})
 const c=f.send('确认短报告偏好'),original=f.remember(c,'喜欢短报告',{kind:'preference',learning:{inferred:true,condition:'工作报告',quote:c.trigger.text}})
 await f.learn()
 expect(f.h.memory.fact(original.id)).toMatchObject({state:'active',protected:true})
 expect(f.h.agentMemory.applicable(c).map(f=>f.content)).toEqual(['喜欢短报告'])
 expect(f.h.agentMemory.authorized(c,true).some(f=>f.state==='candidate'&&f.replaces?.[0]?.id===original.id)).toBe(true)
})

it('keeps automatic deletion proposals pending even in adaptive mode',async()=>{
 const f=fixture(input=>({memories:[decision(input,{action:'delete',target:0,scope:'discussion',content:'不再保留旧偏好'})],topics:[]}));f.configure({writeMode:'adaptive'})
 const c=f.send('考虑忘掉旧偏好'),original=f.remember(c,'旧偏好',{kind:'preference'})
 await f.learn()
 expect(f.h.memory.fact(original.id)?.state).toBe('active')
 expect(f.h.agentMemory.authorized(c,true).find(f=>f.proposalAction==='forget')).toMatchObject({state:'candidate',replaces:[{id:original.id,revision:original.revision}]})
})

it('learns working methods from accepted execution evidence and removes them with the original source',async()=>{
 const f=fixture(input=>input.sources?{lessons:[{topic:'Unicode 回归',content:'修改摘要截断时运行 Unicode 回归测试',condition:'本项目的摘要截断修改',source:0,quote:'node --test tests/reader-brief.test.mjs'}]}:{memories:[],topics:[]})
 f.configure({writeMode:'adaptive'});const c=f.send('修复摘要的 emoji 截断问题')
 const goal=f.h.goals.command({action:'start',operationId:'experience-goal',expectedRevision:0,objective:c.trigger.text,authorizationQuote:c.trigger.text,criteria:[{id:'unicode',description:'Unicode 回归通过'}]},c)
 const round:any={id:'acceptance-experience',goalId:goal.id,triggerId:c.trigger.id,scopeId:c.route.scopeId,entryId:c.route.entryId,ticketIds:[],state:'passed',attempts:1,at:Date.now(),finishedAt:Date.now(),snapshot:{contract:'contract',tasks:[],evidence:[{id:'execution',kind:'execution',key:'host-execution',content:'node --test tests/reader-brief.test.mjs exited with code 0',hash:'evidence'}]},checks:[{criterionId:'unicode',verdict:'passed',explanation:'Unicode 回归通过',evidenceIds:['execution'],method:'agent'}]}
 f.h.store.put('goal-verification',round.id,round)
 const completed={...f.h.goals.get(goal.id)!,state:'completed' as const,finalRoundId:round.id};f.h.store.put('router-goal',goal.id,completed)
 f.h.agentMemory.observeExperience(completed,round);f.h.agentMemory.observeExperience(completed,round)
 expect(f.h.agentMemory.observations().filter(r=>r.kind==='experience')).toHaveLength(1)
 await f.learn();await f.learn()
 const learned=f.h.agentMemory.applicable(c).find(f=>f.origin==='experience')!
 expect(learned).toMatchObject({state:'active',protected:false,learning:{inferred:true,condition:'本项目的摘要截断修改'}})
 expect(learned.sources).toHaveLength(2)
 const execution=f.h.memory.evidence(learned.sources.find(ref=>f.h.memory.evidence(ref.id)?.parentId)!.id)!
 expect(execution.locator).toBe('goal-verification:'+round.id)
 await f.restart();const current=f.context(c.trigger.id)
 expect((await f.h.agentMemory.search(current,'Unicode 回归')).items.some(f=>f.id===learned.id)).toBe(true)
 const parent=f.h.memory.ingest(current)
 f.h.memory.command(current,{action:'source.delete',id:parent.id,expectedRevision:parent.version,operationId:'delete-experience-input'},true)
 expect(f.h.memory.evidence(execution.id)).toMatchObject({revoked:true,text:''})
 expect(f.h.memory.fact(learned.id)).toMatchObject({state:'revoked',content:''})
 expect(f.h.memory.fact(learned.id)?.learning).toBeUndefined()
})

it('clears learning conditions and quotes from facts and history when forgotten',async()=>{
 const f=fixture(input=>({memories:[decision(input,{condition:'私人报告'})],topics:[]}));f.configure({writeMode:'adaptive'})
 const c=f.send('以后私人报告先给结论');await f.learn();const fact=f.h.agentMemory.applicable(c)[0]!
 f.h.memory.command(c,{action:'forget',operationId:'forget-adaptive',id:fact.id,expectedRevision:fact.revision},true)
 expect(f.h.memory.fact(fact.id)).toMatchObject({state:'tombstoned',content:''})
 expect(f.h.memory.fact(fact.id)?.learning).toBeUndefined()
 expect(f.h.store.list<MemoryFact>('memory-version').filter(f=>f.id===fact.id).every(f=>!f.learning)).toBe(true)
 await f.restart();expect(f.h.agentMemory.applicable(f.context(c.trigger.id))).toHaveLength(0)
})

it('upgrades existing memory without changing its policy or activating pending proposals',async()=>{
 const f=fixture(input=>({memories:[decision(input)],topics:[]}));f.configure({writeMode:'auto'})
 const c=f.send('偏好应保持等待确认');await f.learn();const before=f.h.memory.query(c,{candidates:true}).items
 f.h.store.put('memory-schema','current',2);await f.restart()
 expect(f.h.store.get('memory-schema','current')).toBe(3)
 expect(f.h.agentMemory.policy(f.context(c.trigger.id)).writeMode).toBe('auto')
 expect(f.h.memory.query(f.context(c.trigger.id),{candidates:true}).items).toEqual(before)
})

it('learns through the real ingress hook, keeps proposals out of context and persists restart recovery',async()=>{
 const f=fixture(input=>({memories:[decision(input)],topics:[{label:'后端开发',existing:null}]}));f.configure({writeMode:'auto'})
 const c=f.send('我希望回答先给结论')
 expect(f.h.agentMemory.observations()).toHaveLength(1)
 await f.restart();await f.learn()
 const current=f.context(c.trigger.id),items=f.h.memory.query(current,{candidates:true}).items
 expect(items).toHaveLength(1);expect(items[0]).toMatchObject({state:'candidate',kind:'preference',origin:'extracted'})
 expect(JSON.parse(f.h.memory.build(current,{},'test').input).memory.facts).toHaveLength(0)
 f.h.memory.command(current,{action:'confirm',operationId:'confirm',id:items[0]!.id,expectedRevision:1},true)
 expect(JSON.parse(f.h.memory.build(current,{},'test').input).memory.facts[0].kind).toBe('preference')
 await f.restart();await f.learn();expect(f.calls).toHaveLength(1)
 expect(f.h.agentMemory.observations()[0]).toMatchObject({state:'done',attempts:1})
 expect(f.h.store.list('router-goal')).toHaveLength(0)
})
it('preserves the active old fact until confirmation and rejects a stale replacement',()=>{
 const f=fixture(),c=f.send(),old=f.remember(c,'旧偏好',{kind:'preference'})
 const candidate=f.h.memory.command(c,{action:'remember',operationId:'update',id:old.id,expectedRevision:1,subject:'work style',content:'新偏好',sourceIds:old.sources.map(s=>s.id),kind:'preference'}) as MemoryFact
 expect(candidate.id).not.toBe(old.id);expect(f.h.memory.query(c,{}).items.map(x=>x.content)).toEqual(['旧偏好'])
 f.h.memory.command(c,{action:'remember',operationId:'manual-edit',id:old.id,expectedRevision:1,subject:old.subject,content:'人工修正',sourceIds:old.sources.map(s=>s.id),candidate:false},true)
 expect(()=>f.h.memory.command(c,{action:'confirm',operationId:'stale-confirm',id:candidate.id,expectedRevision:1},true)).toThrow('target changed')
 expect(f.h.memory.fact(old.id)?.content).toBe('人工修正')
})
it('confirms a replacement atomically, preserves history, and does not rewrite any goal contract',()=>{
 const f=fixture(),c=f.send(),old=f.remember(c,'旧事实')
 const contract={objective:'retain original objective',criteria:[{id:'one',expected:73}],mandate:{strength:'explicit'}}
 f.h.store.put('router-goal','untouched',{id:'untouched',contract})
 const proposal=f.h.memory.command(c,{action:'remember',operationId:'propose',expectedRevision:0,subject:'work style',content:'新事实',sourceIds:old.sources.map(s=>s.id),replaces:[{id:old.id,revision:old.revision}]}) as MemoryFact
 f.h.memory.command(c,{action:'confirm',operationId:'approve',id:proposal.id,expectedRevision:1},true)
 expect(f.h.memory.query(c,{}).items.map(x=>x.content)).toEqual(['新事实'])
 expect(f.h.memory.fact(old.id)?.state).toBe('superseded')
 expect(f.h.store.get<any>('router-goal','untouched').contract).toEqual(contract)
})
it('retains malformed-output failure intervals and lets another session continue',async()=>{
 const f=fixture(input=>input.messages[0].text==='bad'?{invalid:true}:{memories:[decision(input)],topics:[]});f.configure({writeMode:'auto'})
 f.send('bad','bad-session');f.send('good','good-session')
 await f.learn();await f.learn();f.advance();await f.learn();f.advance();await f.learn()
 expect(f.h.agentMemory.observations().map(r=>r.state).sort()).toEqual(['done','held'])
 const failed=f.h.agentMemory.observations().find(r=>r.state==='held')!
 expect(failed.attempts).toBe(3);expect(failed.sourceId).toBeTruthy()
 expect(f.h.store.list<any>('memory-extraction-session').some(r=>r.session==='local:bad-session')).toBe(false)
})
it('rejects an invented source quote without partial writes or advancing the cursor',async()=>{
 const f=fixture(input=>({memories:[decision(input),decision(input,{content:'unsupported',quote:'not in the input'})],topics:[]}));f.configure({writeMode:'auto'});f.send('回答先给结论');await f.learn()
 expect(f.h.store.list('memory-fact')).toHaveLength(0);expect(f.h.store.list('memory-extraction-session')).toHaveLength(0)
 expect(f.h.agentMemory.observations()[0]?.error).toBe('unverifiable_memory_source')
})
it('fences a late extraction after clear and never revives it after restart',async()=>{
 let release!:(v:unknown)=>void,started=false
 const f=fixture(input=>{started=true;return new Promise(resolve=>{release=()=>resolve({memories:[decision(input)],topics:[]})})});f.configure({writeMode:'auto'});const c=f.send('回答先给结论')
 f.h.agentMemory.tick();for(let i=0;i<50&&!started;i++)await new Promise(r=>setTimeout(r,1));expect(started).toBe(true)
 f.h.memory.command(c,{action:'clear',operationId:'clear',expectedRevision:0},true);release(undefined);await f.h.agentMemory.drain()
 expect(f.h.store.list('memory-fact')).toHaveLength(0);expect(f.h.agentMemory.observations()[0]?.state).toBe('stale')
 await f.restart();await f.learn();expect(f.calls).toHaveLength(1)
})
it('counts independent sessions once and normalizes model-resolved topic aliases',async()=>{
 const f=fixture(input=>({memories:[],topics:[{label:input.topics.length?'Golang 后端':'Go 后端',existing:input.topics.length?0:null}]}));f.configure({writeMode:'auto',interestThreshold:2})
 f.send('讨论 Go 后端','one');await f.learn();f.send('继续 Go 后端','one');await f.learn()
 expect(f.h.store.list<any>('memory-topic')[0].sessions).toHaveLength(1)
 expect(f.h.store.list('memory-fact')).toHaveLength(0)
 f.send('讨论 Golang 后端','two');await f.learn()
 expect(f.h.store.list<any>('memory-topic')).toHaveLength(1);expect(f.h.store.list<any>('memory-topic')[0].aliases).toContain('Golang 后端')
 expect(f.h.store.list<MemoryFact>('memory-fact')[0]).toMatchObject({kind:'interest',state:'candidate'})
})
it('does not let another member or entry inherit personal preferences',()=>{
 const f=fixture(),alice=f.send('Alice prefers concise answers'),bob=f.send('Bob asks','bob','bob'),other=f.send('Other entry','other','alice','g2')
 const fact=f.remember(alice,'Alice prefers concise answers',{kind:'preference'})
 expect(JSON.parse(f.h.memory.build(alice,{},'test').input).memory.facts.map((x:any)=>x.id)).toContain(fact.id)
 expect(JSON.parse(f.h.memory.build(bob,{},'test').input).memory.facts).toHaveLength(0)
 expect(JSON.parse(f.h.memory.build(other,{},'test').input).memory.facts).toHaveLength(0)
})
it('recalls semantic paraphrases from all authorized facts and reports embedding degradation',async()=>{
 const f=fixture(undefined,async text=>text.includes('unavailable')?Promise.reject(Error('offline')):[1,0]);f.configure({embedding:{url:'http://localhost/embeddings',model:'test'}})
 const c=f.send('我的生产服务使用 PostgreSQL'),fact=f.remember(c,'生产环境使用 PostgreSQL',{subject:'database',kind:'fact'})
 await f.h.agentMemory.index(c,new AbortController().signal)
 const result=await f.h.agentMemory.search(c,'线上数据存在哪里')
 expect(result.items.map(x=>x.id)).toContain(fact.id);expect(result.mode).toBe('hybrid')
 expect((await f.h.agentMemory.search(c,'unavailable PostgreSQL')).status).toBe('partial')
})
it('rejects an embedding that completes after clear',async()=>{
 let release!:(v:number[])=>void
 const f=fixture(undefined,()=>new Promise(resolve=>{release=resolve}));f.configure({embedding:{url:'http://localhost/embeddings',model:'test'}})
 const c=f.send(),fact=f.remember(c,'vector source');const pending=f.h.agentMemory.index(c,new AbortController().signal)
 f.h.memory.command(c,{action:'clear',operationId:'clear',expectedRevision:0},true);release([1,0]);await expect(pending).rejects.toThrow()
 expect(f.h.store.list('memory-vector')).toHaveLength(0);expect(f.h.memory.fact(fact.id)?.state).toBe('tombstoned')
})
const reranker={url:'http://test.invalid/rerank',model:'test'}
it('recovers low-cosine candidates by reranking and rejects a higher-scoring lexical distractor',async()=>{
 let sent:string[]=[]
 const f=fixture(undefined,async text=>text==='semantic question'?[1,0]:text.includes('correct')?[.4,Math.sqrt(.84)]:[.9,Math.sqrt(.19)],async(_q,docs)=>{sent=docs;return docs.map((doc,index)=>({index,score:doc.includes('correct')?.9:.01}))})
 f.configure({embedding:{url:'http://test.invalid/embeddings',model:'test'},reranker});const c=f.send()
 const correct=f.remember(c,'correct answer'),wrong=f.remember(c,'semantic question is unrelated background')
 await f.h.agentMemory.index(c,new AbortController().signal)
 const result=await f.h.agentMemory.search(c,'semantic question');expect(sent).toHaveLength(2);expect(result.mode).toBe('reranked');expect(result.items.map(f=>f.id)).toEqual([correct.id]);expect(result.items.some(f=>f.id===wrong.id)).toBe(false)
})
it('sends only current authorized active candidates to the reranker and refreshes the cache after mutation',async()=>{
 const calls:string[][]=[]
 const f=fixture(undefined,async()=>[1,0],async(_q,docs)=>{calls.push(docs);return docs.map((_doc,index)=>({index,score:.9}))}),alice=f.send(),bob=f.send('Bob','bob','bob'),other=f.send('Other','other','alice','g2')
 const own=f.remember(alice,'visible own memory');f.remember(bob,'hidden personal marker',{kind:'preference'});f.remember(other,'other entry marker')
 f.h.memory.command(alice,{action:'remember',operationId:'candidate',expectedRevision:0,subject:'candidate marker',content:'not confirmed',sourceIds:own.sources.map(s=>s.id)})
 f.configure({embedding:{url:'http://test.invalid/embeddings',model:'test'},reranker});await f.h.agentMemory.index(alice,new AbortController().signal)
 await f.h.agentMemory.search(alice,'query');await f.h.agentMemory.search(alice,'query');expect(calls).toHaveLength(1);expect(calls[0]).toEqual(['work style visible own memory'])
 f.h.memory.command(alice,{action:'remember',operationId:'edit',id:own.id,expectedRevision:own.revision,subject:own.subject,content:'visible updated memory',sourceIds:own.sources.map(s=>s.id),candidate:false},true)
 await f.h.agentMemory.index(alice,new AbortController().signal);const result=await f.h.agentMemory.search(alice,'query');expect(calls).toHaveLength(2);expect(result.items[0]?.content).toBe('visible updated memory');expect(calls[1]?.join(' ')).not.toContain('visible own memory')
})
it('marks reranker failure as partial and never presents unfiltered dense candidates as verified relevance',async()=>{
 const f=fixture(undefined,async text=>text==='question'?[1,0]:[.4,Math.sqrt(.84)],async()=>{throw Error('provider down')}),c=f.send();f.remember(c,'low cosine note')
 f.configure({embedding:{url:'http://test.invalid/embeddings',model:'test'},reranker});await f.h.agentMemory.index(c,new AbortController().signal)
 expect(await f.h.agentMemory.search(c,'question')).toMatchObject({items:[],status:'partial',mode:'rerank_unavailable'})
})
it('rejects malformed reranker mappings even when an injected provider bypasses transport validation',async()=>{
 const f=fixture(undefined,async()=>[1,0],async()=>[{index:99,score:.99}]),c=f.send();f.remember(c,'valid note');f.configure({embedding:{url:'http://test.invalid/embeddings',model:'test'},reranker});await f.h.agentMemory.index(c,new AbortController().signal)
 expect((await f.h.agentMemory.search(c,'query')).mode).toBe('rerank_unavailable')
})
it.each(['clear','pause','edit'] as const)('fences a reranker result completing after %s',async action=>{
 let started=false,release!:()=>void
 const f=fixture(undefined,async()=>[1,0],async(_q,docs)=>{started=true;return new Promise(resolve=>{release=()=>resolve(docs.map((_doc,index)=>({index,score:1})))})}),c=f.send(),fact=f.remember(c,'old rerank marker')
 f.configure({embedding:{url:'http://test.invalid/embeddings',model:'test'},reranker});await f.h.agentMemory.index(c,new AbortController().signal)
 const pending=f.h.agentMemory.search(c,'query').catch(error=>String(error));for(let i=0;i<50&&!started;i++)await new Promise(r=>setTimeout(r,1));expect(started).toBe(true)
 if(action==='clear')f.h.memory.command(c,{action:'clear',operationId:'rerank-clear',expectedRevision:0},true)
 else if(action==='pause')f.h.agentMemory.manage(c,{action:'personal',enabled:false})
 else f.h.memory.command(c,{action:'remember',operationId:'edit-inflight',id:fact.id,expectedRevision:fact.revision,subject:fact.subject,content:'new version',sourceIds:fact.sources.map(s=>s.id),candidate:false},true)
 release();const result=await pending
 if(typeof result!=='string'){expect(result.items.some(f=>f.content==='old rerank marker')).toBe(false);expect(result.status).not.toBe('complete')}
})
it('invalidates reranking when incomplete vector indexing finishes and after source revocation',async()=>{
 let calls=0;const f=fixture(undefined,async()=>[1,0],async(_q,docs)=>{calls++;return docs.map((_doc,index)=>({index,score:.9}))}),c=f.send(),fact=f.remember(c,'indexed fact')
 f.configure({embedding:{url:'http://test.invalid/embeddings',model:'test'},reranker});expect((await f.h.agentMemory.search(c,'question')).items).toEqual([])
 await f.h.agentMemory.index(c,new AbortController().signal);expect((await f.h.agentMemory.search(c,'question')).items[0]?.id).toBe(fact.id);expect(calls).toBe(1)
 const source=f.h.memory.evidence(fact.sources[0]!.id)!;f.h.store.put('memory-evidence',source.id,{...source,revoked:true,version:source.version+1,text:''})
 expect(f.h.agentMemory.recall(c,'question')).toMatchObject({items:[],status:'partial',reason:'rerank_stale'})
})
it('does not send sensitive queries or legacy secret facts to reranking',async()=>{
 let calls=0;const f=fixture(undefined,async()=>[1,0],async(_q,docs)=>{calls++;expect(docs.join(' ')).not.toContain('password:');return docs.map((_doc,index)=>({index,score:.9}))}),c=f.send(),fact=f.remember(c,'old safe fact')
 f.h.store.put('memory-fact',fact.id,{...fact,content:'password: synthetic-secret'});f.configure({reranker})
 expect((await f.h.agentMemory.search(c,'password: synthetic-query')).status).toBe('partial');await f.h.agentMemory.search(c,'password');expect(calls).toBe(0)
})
it('aborts and drains reranking before closing the store',async()=>{
 let started=false,aborted=false
 const f=fixture(undefined,async()=>[1,0],async(_q,_docs,_config,signal)=>{started=true;return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(Error('aborted'))},{once:true}))}),c=f.send()
 f.remember(c,'query fact');f.configure({reranker})
 const pending=f.h.agentMemory.search(c,'query').then(()=> 'unexpected success',()=> 'cancelled')
 await expect.poll(()=>started).toBe(true);await f.h.close();hosts.splice(hosts.indexOf(f.h),1)
 expect(aborted).toBe(true);expect(await pending).toBe('cancelled');await expect(f.h.agentMemory.search(c,'query')).rejects.toThrow('closed')
})
function relevant(input:any,predicate:(content:string)=>boolean=()=>true){return {reviewed:input.candidates.map((f:any)=>f.index),supported:input.candidates.filter((f:any)=>predicate(f.content)).map((f:any)=>({index:f.index,quote:f.content}))}}
it('verifies source support independently of both low and high rerank scores',async()=>{
 const f=fixture(input=>relevant(input,c=>c.includes('evidence')),async()=>[1,0],async(_q,docs)=>docs.map((doc,index)=>({index,score:doc.includes('evidence')?.000001:.99}))),c=f.send()
 const fact=f.remember(c,'useful evidence'),wrong=f.remember(c,'unrelated text');f.configure({verifyRelevance:true,embedding:{url:'http://test.invalid/embeddings',model:'test'},reranker:{...reranker,minScore:.999}})
 await f.h.agentMemory.index(c,new AbortController().signal)
 expect(await f.h.agentMemory.search(c,'query')).toMatchObject({items:[{id:fact.id}],mode:'verified',status:'complete'})
 const input=JSON.parse(f.calls[0]!.input);expect(input.candidates.map((x:any)=>Object.keys(x))).toEqual([['index','subject','content'],['index','subject','content']]);expect(f.calls[0]).toMatchObject({tools:[],managed:true,sandbox:'read-only',ephemeral:true});expect(f.calls[0]!.instructions).not.toContain('OpenAPI');expect(f.h.memory.fact(wrong.id)?.state).toBe('active')
 await f.h.agentMemory.search(c,'query');expect(f.calls).toHaveLength(1)
 await f.restart();expect((await f.h.agentMemory.search(f.context(c.trigger.id),'query')).items[0]?.id).toBe(fact.id);expect(f.calls).toHaveLength(2)
})
it.each(['missing','duplicate','outside','invented_quote','empty_quote','duplicate_support'] as const)('fails closed for invalid relevance evidence: %s',async kind=>{
 const f=fixture(input=>{const output=relevant(input),one=output.supported[0]!;if(kind==='missing')output.reviewed=[];if(kind==='duplicate')output.reviewed[1]=output.reviewed[0];if(kind==='outside')one.index=100;if(kind==='invented_quote')one.quote='not present in source';if(kind==='empty_quote')one.quote=' ';if(kind==='duplicate_support')output.supported[1]={...one};return output}),c=f.send()
 f.remember(c,'query first fact');f.remember(c,'query second fact');f.configure({verifyRelevance:true})
 expect(await f.h.agentMemory.search(c,'query')).toMatchObject({items:[],mode:'relevance_unavailable',status:'partial'})
 expect(f.h.agentMemory.recall(c,'query')).toMatchObject({items:[],status:'partial'})
})
it('charges relevance against the model budget and never falls back to unverified matches',async()=>{
 const f=fixture(input=>relevant(input)),c=f.send();f.remember(c,'query memory');f.configure({verifyRelevance:true,maxCallsPerDay:1})
 expect((await f.h.agentMemory.search(c,'query')).status).toBe('complete');expect((await f.h.agentMemory.search(c,'query')).status).toBe('complete')
 expect(await f.h.agentMemory.search(c,'memory')).toMatchObject({items:[],status:'partial',mode:'relevance_budget_exhausted'});expect(f.calls).toHaveLength(1)
})
it('bounds legacy long-note input before spending verifier budget',async()=>{
 const f=fixture(input=>relevant(input)),c=f.send();for(let i=0;i<18;i++)f.remember(c,'query '+i+' '+ 'x'.repeat(15000))
 f.configure({verifyRelevance:true});expect(await f.h.agentMemory.search(c,'query')).toMatchObject({items:[],mode:'relevance_unavailable',status:'partial'})
 expect(f.calls).toHaveLength(0);expect(f.h.store.list('memory-call-count')).toHaveLength(0)
})
it('keeps inaccessible, candidate and sensitive notes out of the relevance request',async()=>{
 const f=fixture(input=>relevant(input),async()=>[1,0]),c=f.send(),b=f.send('Bob','bob','bob'),other=f.send('Other','other','alice','g2')
 f.remember(c,'query visible');f.remember(b,'query DENIED_ACTOR',{kind:'preference'});f.remember(other,'query DENIED_ENTRY');f.remember(c,'query DENIED_CANDIDATE',{candidate:true});const secret=f.remember(c,'query legacy');f.h.store.put('memory-fact',secret.id,{...secret,content:'password: synthetic-secret'})
 f.configure({verifyRelevance:true,embedding:{url:'http://test.invalid/embeddings',model:'test'}});await f.h.agentMemory.index(c,new AbortController().signal);await f.h.agentMemory.search(c,'query')
 expect(JSON.parse(f.calls[0]!.input).candidates.map((x:any)=>x.content)).toEqual(['query visible']);await f.h.agentMemory.search(c,'password: synthetic-query');expect(f.calls).toHaveLength(1)
})
it.each(['clear','edit','pause','revoke','policy'] as const)('rejects a relevance decision completing after %s',async action=>{
 let release!:()=>void,started=false
 const f=fixture(input=>new Promise(resolve=>{started=true;release=()=>resolve(relevant(input))})),c=f.send(),fact=f.remember(c,'query original')
 f.configure({verifyRelevance:true});const pending=f.h.agentMemory.search(c,'query').catch(error=>String(error));await expect.poll(()=>started).toBe(true)
 if(action==='clear')f.h.memory.command(c,{action:'clear',operationId:'clear-relevance',expectedRevision:0},true)
 else if(action==='pause')f.h.agentMemory.manage(c,{action:'personal',enabled:false})
 else if(action==='edit')f.h.memory.command(c,{action:'remember',operationId:'edit-relevance',id:fact.id,expectedRevision:fact.revision,subject:fact.subject,content:'changed content',sourceIds:fact.sources.map(s=>s.id),candidate:false},true)
 else if(action==='revoke'){const source=f.h.memory.evidence(fact.sources[0]!.id)!;f.h.store.put('memory-evidence',source.id,{...source,version:source.version+1,revoked:true,text:''})}
 else f.configure({maxCallsPerDay:99})
 release();const result=await pending;if(typeof result!=='string'){expect(result.items).toEqual([]);expect(result.status).not.toBe('complete')}
})
it('rechecks candidate revisions between reranking and verifier egress',async()=>{
 let release!:()=>void,started=false
 const f=fixture(input=>relevant(input),async()=>[1,0],async(_q,docs)=>new Promise(resolve=>{started=true;release=()=>resolve(docs.map((_d,index)=>({index,score:.99})))})),c=f.send(),fact=f.remember(c,'query old')
 f.configure({verifyRelevance:true,reranker});const pending=f.h.agentMemory.search(c,'query');await expect.poll(()=>started).toBe(true)
 f.h.memory.command(c,{action:'forget',operationId:'forget-before-verification',id:fact.id,expectedRevision:fact.revision},true);release();await pending.catch(()=>{});expect(f.calls).toHaveLength(0)
})
it('aborts active semantic verification before closing SQLite',async()=>{
 let started=false,aborted=false
 const f=fixture((_input,r)=>new Promise((_resolve,reject)=>{started=true;r.signal!.addEventListener('abort',()=>{aborted=true;reject(Error('aborted'))},{once:true})})),c=f.send();f.remember(c,'query fact');f.configure({verifyRelevance:true})
 const pending=f.h.agentMemory.search(c,'query').then(()=>false,()=>true);await expect.poll(()=>started).toBe(true);await f.h.close();hosts.splice(hosts.indexOf(f.h),1);expect(await pending).toBe(true);expect(aborted).toBe(true)
})
it('keeps successful reranking when query embedding is unavailable in the legacy policy',async()=>{
 const f=fixture(undefined,async()=>{throw Error('embedding down')},async(_q,docs)=>docs.map((_d,index)=>({index,score:.9}))),c=f.send(),fact=f.remember(c,'query fact');f.configure({embedding:{url:'http://test.invalid/embeddings',model:'test'},reranker})
 expect(await f.h.agentMemory.search(c,'query')).toMatchObject({items:[{id:fact.id}],mode:'embedding_unavailable',status:'partial'})
})
it('archives excess unconfirmed proposals without evicting protected facts',()=>{
 const f=fixture();f.configure({maxItems:1});const c=f.send(),one=f.remember(c,'保留人工事实一'),two=f.remember(c,'保留人工事实二')
 for(let i=0;i<3;i++)f.h.memory.command(c,{action:'remember',operationId:'candidate-'+i,expectedRevision:0,subject:'candidate '+i,content:'candidate '+i,sourceIds:one.sources.map(s=>s.id)})
 expect(f.h.memory.query(c,{}).items.map(x=>x.id).sort()).toEqual([one.id,two.id].sort())
 expect(f.h.memory.query(c,{candidates:true}).items.filter(x=>x.state==='candidate')).toHaveLength(1)
})
it('keeps explicit-only quiet and prevents paused personal memory from capture and recall',async()=>{
 const f=fixture();f.send('我偏好中文');await f.learn();expect(f.calls).toHaveLength(0)
 const c=f.send('记住：中文回复');expect(f.h.store.list('memory-fact')).toHaveLength(1)
 f.h.agentMemory.manage(c,{action:'personal',enabled:false});f.send('记住：另一个偏好')
 expect(f.h.store.list('memory-fact')).toHaveLength(1);expect(f.h.agentMemory.recall(c,'中文').status).toBe('unavailable')
})
it('only proposes consolidation and retains every source until human confirmation',async()=>{
 const f=fixture(()=>({merges:[{indices:[0,1],content:'偏好 Go 后端开发'}]})),c=f.send()
 const a=f.remember(c,'偏好 Go 后端'),b=f.remember(c,'偏好 Go 后端开发')
 expect((await f.h.agentMemory.consolidate(c) as any).proposed).toBe(1)
 expect(f.h.memory.query(c,{}).items).toHaveLength(2)
 const proposed=f.h.memory.query(c,{candidates:true}).items.find(x=>x.state==='candidate')!
 expect(proposed.replaces?.map(r=>r.id).sort()).toEqual([a.id,b.id].sort())
 f.h.memory.command(c,{action:'confirm',operationId:'merge-confirm',id:proposed.id,expectedRevision:1},true)
 expect(f.h.memory.query(c,{}).items.map(x=>x.content)).toEqual(['偏好 Go 后端开发'])
})
it('recovers interrupted automatic consolidation without waiting a day and does not resume while paused',async()=>{
 const f=fixture(()=>({merges:[{indices:[0,1],content:'偏好 Go 后端开发'}]})),c=f.send()
 for(let i=0;i<6;i++)f.remember(c,'偏好 Go 后端开发 '+i)
 f.configure({writeMode:'auto'})
 const space=f.h.agentMemory.space(c),at=Date.now()
 f.h.store.put('memory-consolidation',space,{at,status:'running',reviewed:6});f.h.store.put('memory-maintenance',space,at)
 await f.restart();const current=f.context(c.trigger.id)
 expect(f.h.store.get<any>('memory-consolidation',space).status).toBe('interrupted')
 f.h.agentMemory.manage(current,{action:'personal',enabled:false});await f.learn();expect(f.calls).toHaveLength(0)
 f.h.agentMemory.manage(current,{action:'personal',enabled:true});await f.learn()
 expect(f.calls).toHaveLength(1);expect(f.h.store.get<any>('memory-consolidation',space)).toMatchObject({status:'completed',proposed:1})
 expect(f.h.memory.query(current,{}).items).toHaveLength(6)
 await f.restart();await f.learn();expect(f.calls).toHaveLength(1)
})
it('does not automatically resume an interrupted manual consolidation under explicit-only policy',async()=>{
 const f=fixture(()=>({merges:[]})),c=f.send();for(let i=0;i<6;i++)f.remember(c,'偏好 Go 后端开发 '+i)
 const space=f.h.agentMemory.space(c);f.h.store.put('memory-consolidation',space,{at:Date.now(),status:'running'})
 await f.restart();await f.learn();expect(f.calls).toHaveLength(0)
 expect(await f.h.agentMemory.consolidate(f.context(c.trigger.id))).toMatchObject({status:'completed'})
 expect(f.calls).toHaveLength(1)
})
it('drains and aborts manual consolidation on close and rejects overlapping calls',async()=>{
 let started=false
 const f=fixture((_input,r)=>{started=true;return new Promise((_resolve,reject)=>r.signal!.addEventListener('abort',()=>reject(Error('aborted')),{once:true}))}),c=f.send()
 f.remember(c,'偏好 Go 后端');f.remember(c,'偏好 Go 后端开发')
 const pending=f.h.agentMemory.consolidate(c).catch(error=>String(error))
 for(let i=0;i<50&&!started;i++)await new Promise(r=>setTimeout(r,1));expect(started).toBe(true)
 f.advance(120000);expect(await f.h.agentMemory.consolidate(c)).toEqual({status:'busy'});expect(f.calls).toHaveLength(1)
 await f.h.agentMemory.close();expect(await pending).toContain('aborted')
 expect(f.h.store.get<any>('memory-consolidation',f.h.agentMemory.space(c)).status).toBe('interrupted')
 await expect(f.h.agentMemory.consolidate(c)).rejects.toThrow('closed')
})
it('commits consolidation proposals and its completion receipt in the same transaction',async()=>{
 const f=fixture(()=>({merges:[{indices:[0,1],content:'偏好 Go 后端开发'}]})),c=f.send()
 f.remember(c,'偏好 Go 后端');f.remember(c,'偏好 Go 后端开发')
 const put=f.h.store.put.bind(f.h.store)
 f.h.store.put=(kind,id,value:any)=>{if(kind==='memory-consolidation'&&value.status==='completed')throw Error('simulated receipt write failure');put(kind,id,value)}
 await expect(f.h.agentMemory.consolidate(c)).rejects.toThrow('simulated receipt write failure')
 expect(f.h.memory.query(c,{candidates:true}).items).toHaveLength(2)
 expect(f.h.store.get<any>('memory-consolidation',f.h.agentMemory.space(c)).status).toBe('failed')
})
it('blocks further model calls at the daily scope budget and exposes the held input',async()=>{
 const f=fixture(()=>({memories:[],topics:[]}));f.configure({writeMode:'auto',maxCallsPerDay:1})
 f.send('first','one');await f.learn();f.send('second','two');await f.learn()
 expect(f.calls).toHaveLength(1);expect(f.h.agentMemory.observations().find(r=>r.state==='held')?.error).toBe('daily_model_budget')
})
it('preserves every part of a long message and source attribution through bounded batches',async()=>{
 const f=fixture(()=>({memories:[],topics:[]}));f.configure({writeMode:'auto'});const text='长'.repeat(37000);f.send(text)
 expect(f.h.agentMemory.observations()).toHaveLength(4)
 await f.learn();await f.learn()
 expect(f.h.agentMemory.observations().every(r=>r.state==='done')).toBe(true)
 expect(f.calls.flatMap(r=>JSON.parse(r.input).messages).map(m=>m.text).join('')).toBe(text)
})
it('gates inspect and in-flight manifests with the same personal and policy controls as recall',async()=>{
 const f=fixture(),a=f.send('我是 alice'),item=f.remember(a,'个人表达偏好',{kind:'preference'}),b=f.send('我是 bob','bob','bob')
 expect((await f.h.agentMemory.tool(b,{action:'inspect',id:item.id}) as any).items).toHaveLength(0)
 const manifest=f.h.memory.build(a,{},'test').manifest
 f.configure({enabled:false})
 expect((await f.h.agentMemory.tool(a,{action:'inspect'}) as any).items).toHaveLength(0)
 expect(()=>f.h.memory.validate(manifest)).toThrow('Memory use disabled')
 f.configure({enabled:true});f.h.agentMemory.manage(a,{action:'personal',enabled:false})
 expect((await f.h.agentMemory.tool(a,{action:'inspect'}) as any).items).toHaveLength(0)
 await expect(f.h.agentMemory.tool(a,{action:'query',query:{unexpected:true}})).rejects.toThrow()
})
it('publishes only the selected fact revision, never its source transcript or older versions',()=>{
 const f=fixture(),a=f.send('Public statement and SOURCE_ONLY'),e=f.h.memory.ingest(a),old=f.remember(a,'OLDER_UNPUBLISHED')
 const updated=f.h.memory.command(a,{action:'remember',operationId:'edit-for-share',id:old.id,expectedRevision:1,subject:old.subject,content:'PUBLISHED',sourceIds:[e.id],candidate:false},true) as MemoryFact
 const b=f.send('other entry','b','alice','g2');f.h.memory.command(a,{action:'share',operationId:'publish',id:old.id,expectedRevision:updated.revision,targetEntry:b.route.entryId},true)
 const inspected=f.h.agentMemory.manage(b,{action:'inspect',id:old.id}) as any
 expect(inspected.detail.fact.content).toBe('PUBLISHED');expect(inspected.detail.evidence).toEqual([]);expect(inspected.detail.versions).toEqual([])
})
it('honors the extraction interval for observations queued before the first batch commits',async()=>{
 const f=fixture();f.configure({writeMode:'auto',minIntervalMs:300000});f.send('甲'.repeat(30000))
 await f.learn();expect(f.calls).toHaveLength(1);await f.learn();expect(f.calls).toHaveLength(1)
 f.advance(300000);await f.learn();expect(f.calls).toHaveLength(2)
})
it('forgets topic content and known aliases durably and excludes them from subsequent extraction',async()=>{
 let next='Go 后端'
 const f=fixture(input=>({memories:[],topics:[{label:next,existing:input.topics.length?0:null}]}));f.configure({writeMode:'auto'})
 const c=f.send('Go 后端','one');await f.learn();next='Golang 后端';f.send('Golang 后端','two');await f.learn()
 const topic=f.h.store.list<any>('memory-topic')[0];f.h.agentMemory.manage(c,{action:'topics.forget',id:topic.id})
 expect(f.h.store.list('memory-topic')).toEqual([]);expect(f.h.memory.topicSuppressed(c.route.scopeId,'Golang 后端')).toBe(true)
 await f.restart();f.send('Golang 后端 again','three');await f.learn()
 expect(JSON.parse(f.calls.at(-1)!.input).topics).toEqual([]);expect(f.h.store.list('memory-topic')).toEqual([])
 expect(f.h.store.list<any>('memory-fact').every(row=>!row.topicAliases?.length&&!row.content)).toBe(true)
})
it('rejects contradictory replace-and-depend links before mutation and does not report archived candidates as active',()=>{
 const f=fixture(),c=f.send(),old=f.remember(c,'Protected item')
 expect(()=>f.h.memory.command(c,{action:'remember',operationId:'self-defeat',expectedRevision:0,subject:'x',content:'new',sourceIds:old.sources.map(s=>s.id),derivedFrom:[old.id],replaces:[{id:old.id,revision:old.revision}]})).toThrow('cannot depend')
 f.configure({maxItems:1});f.remember(c,'first candidate',{candidate:true,importance:5})
 const candidate=f.remember(c,'lower candidate',{candidate:true,importance:1})
 expect(candidate.archived).toBe(true);expect(candidate.revision).toBe(2)
})
it('refuses explicit and manual credential memories without losing the input',()=>{
 const f=fixture(),c=f.send('记住：password=synthetic-unsafe-token')
 expect(f.h.memory.query(c,{candidates:true}).items).toEqual([])
 expect(()=>f.remember(c,'api_key=synthetic-long-secret')).toThrow('sensitive_content')
 expect(f.h.store.triggers.get(c.trigger.id)?.text).toContain('synthetic-unsafe-token')
})
it('cleans up the host lock when a future memory schema refuses startup',async()=>{
 const f=fixture();f.h.store.put('memory-schema','current',99)
 hosts.splice(hosts.indexOf(f.h),1);await f.h.close()
 expect(()=>new Runtime(f.config)).toThrow('Memory schema is newer')
 expect(()=>new Runtime(f.config)).toThrow('Memory schema is newer')
})
it('marks the upgraded database so an older host cannot misread candidate replacement semantics',async()=>{
 const f=fixture();expect(f.h.store.db.prepare('PRAGMA user_version').get()?.user_version).toBe(7)
 await f.restart();expect(f.h.store.db.prepare('PRAGMA user_version').get()?.user_version).toBe(7)
})
it('rejects a memory backend outside the current scope even if supplied by management',()=>{
 const f=fixture();expect(()=>f.configure({extractBackend:'ungranted'})).toThrow('outside scope')
})

it('replays forget fences against an older SQLite snapshot, including auxiliary topic and vector state',async()=>{
 const f=fixture(input=>({memories:[],topics:[{label:'DurableTopicMarker',existing:null}]}),async()=>[1,0]);f.configure({writeMode:'auto',embedding:{url:'http://test.invalid/embeddings',model:'test'}})
 const c=f.send('DurableTopicMarker');await f.learn();const topic=f.h.store.list<any>('memory-topic')[0]
 const fact=f.remember(c,'DurableFactMarker');await f.h.agentMemory.index(c,new AbortController().signal)
 const snapshot=join(f.root,'before-forget.sqlite');await backup(f.h.store.db,snapshot)
 f.h.agentMemory.manage(c,{action:'topics.forget',id:topic.id})
 const current=f.context(c.trigger.id);f.h.memory.command(current,{action:'forget',operationId:'forget-native-fact',id:fact.id,expectedRevision:fact.revision},true)
 await f.restart(snapshot)
 const restored=f.context(c.trigger.id);expect(f.h.agentMemory.authorized(restored,true)).toEqual([]);expect(f.h.store.list('memory-topic')).toEqual([]);expect(f.h.store.list('memory-vector')).toEqual([])
 expect(f.h.memory.topicSuppressed(restored.route.scopeId,'DurableTopicMarker')).toBe(true)
})
it('holds credential-bearing automatic observations before sending them to any model or embedding provider',async()=>{
 const f=fixture();f.configure({writeMode:'auto'});f.send('Project credentials: password=synthetic-only-12345');await f.learn()
 expect(f.calls).toEqual([]);expect(f.h.agentMemory.observations()[0]).toMatchObject({state:'held',error:'sensitive_content',attempts:0})
})
it('refreshes still-authorized pending inputs after an unrelated epoch change without replaying cleared input',async()=>{
 const f=fixture(input=>({memories:[decision(input)],topics:[]}));const old=f.remember(f.send('old source'),'old unrelated memory');f.configure({writeMode:'auto'})
 const pending=f.send('回答先给结论');f.h.memory.command(pending,{action:'forget',operationId:'forget-other',id:old.id,expectedRevision:1},true)
 expect(f.h.agentMemory.observations()[0]?.state).toBe('pending');await f.learn()
 expect(f.h.agentMemory.observations()[0]?.state).toBe('done');expect(f.h.memory.query(f.context(pending.trigger.id),{candidates:true}).items).toHaveLength(1)
})
it('never sends credential-like retrieval queries or legacy secret facts to the embedding endpoint',async()=>{
 let calls=0;const f=fixture(undefined,async()=>{calls++;return [1,0]});f.configure({embedding:{url:'http://test.invalid',model:'test'}})
 const c=f.send('ordinary'),fact=f.remember(c,'ordinary note');f.h.store.put('memory-fact',fact.id,{...fact,content:'password=synthetic-legacy-secret'})
 await f.h.agentMemory.prepare(c,'api_key=synthetic-query-secret');await f.h.agentMemory.index(c,new AbortController().signal)
 expect(calls).toBe(0)
})
it('forgets a topic even when capacity immediately archives its fence candidate',async()=>{
 const f=fixture(()=>({memories:[],topics:[{label:'ArchiveTopic',existing:null}]}));f.configure({writeMode:'auto',maxItems:1});const c=f.send('ArchiveTopic');await f.learn()
 f.remember(c,'higher priority candidate',{candidate:true,importance:5});const topic=f.h.store.list<any>('memory-topic')[0]
 f.h.agentMemory.manage(c,{action:'topics.forget',id:topic.id});expect(f.h.store.list('memory-topic')).toEqual([]);expect(f.h.memory.topicSuppressed(c.route.scopeId,'ArchiveTopic')).toBe(true)
})
it('does not reattach a forgotten alias to a live topic or promote the alias through memories',async()=>{
 let step=0
 const f=fixture(input=>{step++;return {memories:[],topics:step===1?[{label:'Go 后端',existing:null}]:step===2?[{label:'Golang 后端',existing:0}]:step===3?[{label:'Python 开发',existing:null}]:[{label:'Golang 后端',existing:0}]}});f.configure({writeMode:'auto'})
 const c=f.send('Go','one');await f.learn();f.send('Golang','two');await f.learn();const topic=f.h.store.list<any>('memory-topic')[0];f.h.agentMemory.manage(c,{action:'topics.forget',id:topic.id})
 f.send('Python','three');await f.learn();const after=f.send('new','four');await f.learn()
 expect(JSON.stringify(f.h.store.list('memory-topic'))).not.toContain('Golang');expect(()=>f.remember(after,'Golang 后端',{kind:'interest',candidate:true})).toThrow('forgotten')
})
it('rejects transitive replacement dependencies on creation and on confirmation of old proposals',()=>{
 const f=fixture(),c=f.send(),a=f.remember(c,'A'),b=f.remember(c,'B',{derivedFrom:[a.id]})
 const command={action:'remember',operationId:'transitive',expectedRevision:0,subject:'C',content:'C',sourceIds:a.sources.map(s=>s.id),derivedFrom:[b.id],replaces:[{id:a.id,revision:a.revision}]}
 expect(()=>f.h.memory.command(c,command)).toThrow('cannot depend')
 const candidate=f.remember(c,'C',{candidate:true,derivedFrom:[b.id]});f.h.store.put('memory-fact',candidate.id,{...candidate,replaces:[{id:a.id,revision:a.revision}]})
 expect(()=>f.h.memory.command(c,{action:'confirm',operationId:'confirm-legacy',id:candidate.id,expectedRevision:1},true)).toThrow('cannot depend');expect(f.h.memory.fact(a.id)?.state).toBe('active');expect(f.h.memory.fact(b.id)?.state).toBe('active')
})
it('erases both a confirmed deletion proposal and its target across an older-state restore',async()=>{
 const f=fixture(),c=f.send(),old=f.remember(c,'DeleteMemoryMarker')
 const proposal=f.h.memory.command(c,{action:'remember',operationId:'delete-proposal',expectedRevision:0,subject:old.subject,content:old.content,sourceIds:old.sources.map(s=>s.id),replaces:[{id:old.id,revision:old.revision}],proposalAction:'forget'}) as MemoryFact
 const snapshot=join(f.root,'before-delete.sqlite');await backup(f.h.store.db,snapshot)
 f.h.memory.command(c,{action:'confirm',operationId:'approve-delete',id:proposal.id,expectedRevision:1},true)
 expect(f.h.memory.fact(proposal.id)?.content).toBe('');expect(f.h.memory.fact(old.id)?.content).toBe('')
 await f.restart(snapshot);expect(f.h.memory.fact(proposal.id)?.content).toBe('');expect(f.h.memory.fact(old.id)?.content).toBe('')
})
it('hides revoked topic sources immediately even when background scheduling is paused',async()=>{
 const f=fixture(()=>({memories:[],topics:[{label:'RevokedTopicMarker',existing:null}]}));f.configure({writeMode:'auto'});const c=f.send('topic source');await f.learn()
 const e=f.h.memory.ingest(c);f.h.store.put('memory-evidence',e.id,{...e,revoked:true,version:e.version+1,text:''});f.h.pause(true)
 const view=f.h.agentMemory.manage(f.send('new current input'),{action:'inspect'}) as any;expect(view.topics).toEqual([])
})
